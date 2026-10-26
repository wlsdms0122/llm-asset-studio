#!/usr/bin/env python3
"""Every image model on OpenRouter with its price, read at most once a day, and what each has cost here so far.

The studio offers models from this list and the agent chooses draft models from it (document/models.md).

Commands:
  models            every image model: id, price of one output image by its billing unit, references it takes
  models --free     only the models whose output images cost nothing; exits 1 when none is free, and 3 when
                    none was found but some prices could not be read, so whether one is free is unknown
"""

import argparse
import concurrent.futures
import json
import sys
import time
import urllib.request

import workspace
from workspace import read_lines

API = "https://openrouter.ai/api/v1"
CATALOG = workspace.CACHE / "catalog.json"
CATALOG_TTL = 24 * 60 * 60


def catalog():
    if CATALOG.exists() and time.time() - CATALOG.stat().st_mtime < CATALOG_TTL:
        models = json.loads(CATALOG.read_text())
    else:
        with urllib.request.urlopen(f"{API}/images/models", timeout=30) as response:
            rows = json.load(response)
        rows = rows.get("data", rows) if isinstance(rows, dict) else rows
        with concurrent.futures.ThreadPoolExecutor(12) as pool:
            prices = list(pool.map(lambda row: read_price(row["id"]), rows))
        models = [{
            "id": row["id"],
            "name": row.get("name") or row["id"],
            "references": (row.get("supported_parameters", {}).get("input_references") or {}).get("max", 0),
            "created": row.get("created"),
            "price": None if price is UNREAD else price,
            "unread": price is UNREAD
        } for row, price in zip(rows, prices)]
        # A price that could not be read is not kept for the day: the next read asks again.
        if not any(model["unread"] for model in models):
            CATALOG.parent.mkdir(parents=True, exist_ok=True)
            CATALOG.write_text(json.dumps(models, indent=2))
    measured = {}
    for record in workspace.PROJECTS.glob("**/calls.jsonl"):
        for call in read_lines(record):
            if call.get("status") == "ok" and call.get("outputs") and call.get("cost") is not None:
                measured.setdefault(call["model"], []).append(call["cost"] / len(call["outputs"]))
    return [{**model, "measured": sum(measured[model["id"]]) / len(measured[model["id"]]) if model["id"] in measured else None} for model in models]


UNREAD = object()


def read_price(model):
    try:
        return price_of(model)
    except (OSError, ValueError):
        return UNREAD


def price_of(model):
    """The lowest price of one output image, by its billing unit (image, megapixel, token), and of one reference;
    None when OpenRouter lists no price for its output images."""
    with urllib.request.urlopen(f"{API}/images/models/{model}/endpoints", timeout=30) as response:
        endpoints = json.load(response).get("endpoints", [])
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

    models = catalog()
    if arguments.free:
        unread = [model["id"] for model in models if model.get("unread")]
        models = [model for model in models if free(model)]
        if not models and unread:
            print(f"no free image model found, but the prices of {', '.join(unread)} could not be read; try again", file=sys.stderr)
            sys.exit(3)
        if not models:
            sys.exit("no free image model on OpenRouter today")
    for model in sorted(models, key=lambda model: model["id"]):
        price = model["price"]
        cost = "unread" if model.get("unread") else "unknown" if not price or price["cost"] is None else "free" if price["cost"] == 0 else f"${price['cost']:g}/{price['unit']}{' and up' if price['varies'] else ''}"
        measured = f"  measured ${model['measured']:.4f}/image" if model["measured"] is not None else ""
        print(f"{model['id']}  {cost}  references {model['references']}{measured}")


if __name__ == "__main__":
    main()
