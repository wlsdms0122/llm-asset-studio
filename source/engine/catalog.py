#!/usr/bin/env python3
"""Every image model on OpenRouter with its price, read at most once a day, and what each has cost here so far.

The studio offers models from this list and the agent chooses draft models from it (document/models.md).

Commands:
  models            every image model: id, price of one output image by its billing unit, references it takes
  models --free     only the models whose output images cost nothing
"""

import argparse
import concurrent.futures
import json
import sys
import time
import urllib.request

import workspace
from style import Style

API = "https://openrouter.ai/api/v1"
CATALOG = workspace.CACHE / "catalog.json"
CATALOG_TTL = 24 * 60 * 60


def catalog(styles):
    if CATALOG.exists() and time.time() - CATALOG.stat().st_mtime < CATALOG_TTL:
        models = json.loads(CATALOG.read_text())
    else:
        with urllib.request.urlopen(f"{API}/images/models", timeout=30) as response:
            rows = json.load(response)
        rows = rows.get("data", rows) if isinstance(rows, dict) else rows
        with concurrent.futures.ThreadPoolExecutor(12) as pool:
            prices = list(pool.map(lambda row: price_of(row["id"]), rows))
        models = [{
            "id": row["id"],
            "name": row.get("name") or row["id"],
            "references": (row.get("supported_parameters", {}).get("input_references") or {}).get("max", 0),
            "created": row.get("created"),
            "price": price
        } for row, price in zip(rows, prices)]
        CATALOG.parent.mkdir(parents=True, exist_ok=True)
        CATALOG.write_text(json.dumps(models, indent=2))
    measured = {}
    for style in styles:
        for entry in style.ledger().generations():
            if entry.get("cost") is not None:
                measured.setdefault(entry["model"], []).append(entry["cost"] / len(entry["outputs"]))
    return [{**model, "measured": sum(measured[model["id"]]) / len(measured[model["id"]]) if model["id"] in measured else None} for model in models]


def price_of(model):
    """The lowest price of one output image, by its billing unit (image, megapixel, token), and of one reference."""
    try:
        with urllib.request.urlopen(f"{API}/images/models/{model}/endpoints", timeout=30) as response:
            endpoints = json.load(response).get("endpoints", [])
    except (OSError, ValueError):
        return None
    pricing = (endpoints[0].get("pricing") or []) if endpoints else []
    outputs = [item for item in pricing if item.get("billable") == "output_image"]
    if not outputs:
        return None
    lowest = min(outputs, key=lambda item: item.get("cost_usd") or 0)
    reference = next((item for item in pricing if item.get("billable") in ("input_image", "input_reference") and item.get("unit") in ("image", "request")), None)
    return {
        "unit": lowest.get("unit"),
        "cost": lowest.get("cost_usd"),
        "varies": len(outputs) > 1,
        "reference": reference.get("cost_usd") if reference and reference.get("cost_usd") else None
    }


def free(model):
    return bool(model["price"]) and model["price"]["cost"] == 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--free", action="store_true", help="only the models whose output images cost nothing")
    arguments = parser.parse_args()
    workspace.enter()

    models = catalog(Style.all(workspace.STYLES))
    if arguments.free:
        models = [model for model in models if free(model)]
        if not models:
            sys.exit("no free image model on OpenRouter today")
    for model in sorted(models, key=lambda model: model["id"]):
        price = model["price"]
        cost = "unknown" if not price or price["cost"] is None else "free" if price["cost"] == 0 else f"${price['cost']:g}/{price['unit']}{' and up' if price['varies'] else ''}"
        measured = f"  measured ${model['measured']:.4f}/image" if model["measured"] is not None else ""
        print(f"{model['id']}  {cost}  references {model['references']}{measured}")


if __name__ == "__main__":
    main()
