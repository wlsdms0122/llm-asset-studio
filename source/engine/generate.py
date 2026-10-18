#!/usr/bin/env python3
"""Generate images for a session through the OpenRouter Images API, and record every call in the style's ledger.

The prompt is always written by the agent (--prompt or --prompt-file), from the style's style.md, the
session's prompting file, and document/prompting.md. Images go into the session's next round (--into
names a subfolder there, to keep several candidates apart); the call is recorded in the style's
ledger.jsonl with the session and the user's words (--request) next to the prompt written from them.
--references attaches the style's references first, as Image 1..N.

The model defaults to the session's: the one a model session adds, otherwise the style's. The API key
is the workspace's (see workspace.py).
"""

import argparse
import base64
import hashlib
import json
import mimetypes
import struct
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import workspace
from capability import Capability
from session import Session
from style import StyleError, images_in, timestamp

API = "https://openrouter.ai/api/v1"


def main():
    arguments = parse_arguments()
    workspace.enter()
    try:
        session = Session.at(arguments.session)
    except StyleError as error:
        sys.exit(str(error))
    style = session.style
    model = arguments.model or session.model
    if not model:
        sys.exit(f"{style.name} has no model yet; give --model")
    prompt = read_prompt(arguments)
    references = (images_in(style.reference_folder) if arguments.references else []) + expand_references(arguments.ref)
    # What the ledger names: the references by their archived copies, which keep meaning one image after curation.
    named = (style.reference_records() if arguments.references else []) + [style.relative(path) for path in expand_references(arguments.ref)]
    capability = Capability(model)
    failed = False

    for index, batch in enumerate(capability.batches(arguments.n or 1)):
        body, dropped = capability.request_body(
            prompt=prompt,
            references=references,
            options={
                "n": batch if batch > 1 else None,
                "aspect_ratio": arguments.aspect_ratio,
                "resolution": arguments.resolution,
                "quality": arguments.quality,
                "background": arguments.background,
                # Split calls with one fixed seed would return the same image each time.
                "seed": None if arguments.seed is None else arguments.seed + index
            }
        )

        if arguments.dry_run:
            print(json.dumps(redacted(body), ensure_ascii=False, indent=2))
            if dropped:
                print(f"dropped (unsupported by {model}): {', '.join(dropped)}", file=sys.stderr)
            continue

        if not session.directory.is_dir():
            sys.exit(f"session {session.id} was deleted or its style renamed; stopped before drawing more")
        output = session.next_round() / (arguments.into or "")
        failed |= not generate(session, arguments, model, prompt, named, body, dropped, output)

    if failed:
        sys.exit(1)


def generate(session, arguments, model, prompt, references, body, dropped, output):
    style = session.style
    output.mkdir(parents=True, exist_ok=True)
    started = time.time()
    entry = {
        "time": timestamp(),
        "tag": arguments.tag,
        "session": session.id,
        "model": model,
        "request": arguments.request,
        "prompt": prompt,
        "references": references,
        "options": {key: value for key, value in body.items() if key not in ("model", "prompt", "input_references")},
        "dropped": dropped
    }

    try:
        response = post_json(f"{API}/images", body, workspace.read_key())
        if not session.directory.is_dir():
            entry["cost"] = response.get("usage", {}).get("cost")
            raise RequestError(f"session {session.id} was deleted or its style renamed while drawing; the images were not kept")
        files = save_images(response.get("data", []), output, model)
        entry.update({
            "status": "ok",
            "outputs": [style.relative(path) for path in files],
            "cost": response.get("usage", {}).get("cost"),
            "flags": inspect(files, wants_transparency=body.get("background") == "transparent")
        })
    except RequestError as error:
        entry.update({"status": "failed", "error": str(error)})

    entry["seconds"] = round(time.time() - started, 1)
    try:
        style.ledger().append(entry)
    except StyleError as error:
        entry.update({"status": "failed", "error": str(error)})
    print(json.dumps({key: entry.get(key) for key in ("status", "outputs", "cost", "flags", "error", "seconds")}, ensure_ascii=False))

    return entry["status"] == "ok"


def parse_arguments():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("session", help="the session folder, such as sessions/app-icon/20261011-230012")
    parser.add_argument("--prompt")
    parser.add_argument("--prompt-file")
    parser.add_argument("--model", help="OpenRouter model id; defaults to the session's model")
    parser.add_argument("--references", action="store_true", help="attach the style's references first")
    parser.add_argument("--ref", action="append", default=[], help="another image or directory to attach after the references, repeatable")
    parser.add_argument("--request", help="the user's words, before the agent turned them into the prompt")
    parser.add_argument("--into", help="a subfolder of the round for these images, to keep candidates apart")
    parser.add_argument("--tag", default="", help="label stored in the ledger: the kind of round the images are for, such as discover, sample, confirm, generate, or model")
    parser.add_argument("--n", type=int, help="images wanted; split into as many calls as the model needs")
    parser.add_argument("--aspect-ratio")
    parser.add_argument("--resolution")
    parser.add_argument("--quality")
    parser.add_argument("--background", choices=["auto", "transparent", "opaque"])
    parser.add_argument("--seed", type=int)
    parser.add_argument("--dry-run", action="store_true", help="print the request body without sending it")
    return parser.parse_args()


def read_prompt(arguments):
    if arguments.prompt_file:
        return Path(arguments.prompt_file).read_text(encoding="utf-8")
    if arguments.prompt:
        return arguments.prompt
    sys.exit("give --prompt or --prompt-file")


def expand_references(items):
    paths = []
    for item in items:
        path = Path(item)
        if path.is_dir():
            paths.extend(images_in(path))
        elif path.is_file():
            paths.append(path)
        else:
            sys.exit(f"reference not found: {path}")
    return paths


class RequestError(Exception):
    pass


def post_json(url, body, key):
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RequestError(f"HTTP {error.code}: {error.read().decode(errors='replace')[:500]}")
    except urllib.error.URLError as error:
        raise RequestError(str(error.reason))


def save_images(items, output, model):
    stamp = time.strftime("%Y%m%d-%H%M%S")
    name = model.split("/")[-1]
    files = []

    for index, item in enumerate(items):
        payload = base64.b64decode(item["b64_json"])
        suffix = mimetypes.guess_extension(item.get("media_type", "image/png")) or ".png"
        digest = hashlib.sha1(payload).hexdigest()[:8]
        path = output / f"{stamp}-{name}-{index}-{digest}{suffix}"
        path.write_bytes(payload)
        files.append(path)

    return files


def inspect(files, wants_transparency):
    """Flags only. A flagged image is reported, never regenerated from here."""
    flags = []
    for path in files:
        if wants_transparency and path.suffix == ".png" and not png_has_alpha(path):
            flags.append(f"{path.name}: transparency requested but no alpha channel")
    return flags


def png_has_alpha(path):
    with path.open("rb") as file:
        header = file.read(33)
    # IHDR color type: 4 is gray + alpha, 6 is RGBA. A tRNS chunk can also carry alpha but generators do not use it.
    color_type = struct.unpack(">B", header[25:26])[0]
    return color_type in (4, 6)


def redacted(body):
    copy = dict(body)
    if "input_references" in copy:
        copy["input_references"] = [f"<{len(copy['input_references'])} images as data URLs>"]
    return copy


if __name__ == "__main__":
    main()
