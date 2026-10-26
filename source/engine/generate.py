#!/usr/bin/env python3
"""Generate images through the OpenRouter Images API into a node, and record every call next to the images it made
(calls.jsonl).

The prompt is always written by the agent (--prompt or --prompt-file), from style.md and the prompting file at the
node's revision, and document/prompting.md. References are chosen per generation (document/workflow.md) and attached
in the order given (--ref), each recorded with its role and its object, so the record keeps naming the image after
the style's references change.

The node says what draws it: a draft its draft model, any other node the model of its style at its revision.

The API key is the workspace's (see workspace.py).
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
from style import annotation
from workspace import RecordError, append_json, timestamp

API = "https://openrouter.ai/api/v1"


class Target:
    """The node images go into and what draws them."""

    def __init__(self, path):
        from node import Node
        node = Node.at(path)
        if node.output != "image" or node.kind != "generation" or node.result() is not None:
            raise RecordError(f"{node.id} is not waiting for images")
        self.project, self.directory, self.revision = node.project, node.directory, node.revision
        self.model = node.draft or node.project.style(node.style).snapshot(self.revision).config()["model"]


def main():
    arguments = parse_arguments()
    workspace.enter()
    try:
        target = Target(arguments.target)
        model = target.model
        references = [reference(target.project, item) for item in arguments.ref]
    except RecordError as error:
        sys.exit(str(error))
    prompt = read_prompt(arguments)
    capability = Capability(model)
    failed = False

    for index, batch in enumerate(capability.batches(arguments.n or 1)):
        body, dropped = capability.request_body(
            prompt=prompt,
            references=[item["file"] for item in references],
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
        if not target.directory.is_dir():
            sys.exit(f"{workspace.relative(target.directory)} was deleted; stopped before drawing more")
        failed |= not generate(target, arguments, model, prompt, references, body, dropped)

    if failed:
        sys.exit(1)


def reference(project, item):
    """An image to attach, as role=path or path; the role defaults to the reference's annotation."""
    role, separator, path = item.partition("=")
    if not separator:
        role, path = "", item
    file = workspace.resolve(path)
    if not file.is_file() or file.suffix.lower() not in workspace.IMAGE_SUFFIXES:
        raise RecordError(f"reference not found: {path}")
    note = annotation(file) or {}
    return {
        "file": file,
        # A reference attached from a materialized revision is named by its file; its object says which image it was.
        "path": project.relative(file) if workspace.inside(file, project.path) else file.name,
        "object": workspace.put_object(file.read_bytes()),
        "role": role or note.get("role") or ("style" if file.parent.name == "references" else "attachment")
    }


def generate(target, arguments, model, prompt, references, body, dropped):
    (target.directory / ".drawing").touch()
    workspace.heartbeat()
    started = time.time()
    entry = {
        "time": timestamp(),
        "model": model,
        "revision": target.revision,
        "request": arguments.request,
        "prompt": prompt,
        "references": [{key: item[key] for key in ("path", "object", "role")} for item in references],
        "options": {key: value for key, value in body.items() if key not in ("model", "prompt", "input_references")},
        "dropped": dropped
    }
    try:
        response = post_json(f"{API}/images", body, workspace.read_key())
        entry["cost"] = response.get("usage", {}).get("cost")
        if not target.directory.is_dir():
            raise RequestError(f"{workspace.relative(target.directory)} was deleted while drawing; the images were not kept")
        files = save_images(response.get("data", []), target.directory, model)
        entry.update({
            "status": "ok",
            "outputs": [path.relative_to(target.directory).as_posix() for path in files],
            "flags": inspect(files, wants_transparency=body.get("background") == "transparent")
        })
    except RequestError as error:
        entry.update({"status": "failed", "error": str(error)})
    entry["seconds"] = round(time.time() - started, 1)
    if target.directory.is_dir():
        append_json(target.directory / "calls.jsonl", entry)
    print(json.dumps({key: entry.get(key) for key in ("status", "outputs", "cost", "flags", "error", "seconds")}, ensure_ascii=False))
    return entry["status"] == "ok"


def parse_arguments():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("target", help="a node folder, projects/<p>/nodes/<id>")
    parser.add_argument("--prompt")
    parser.add_argument("--prompt-file")
    parser.add_argument("--ref", action="append", default=[], help="[role=]image to attach, in order, repeatable: a style reference, a subject, an attachment, a parent image; role is style, subject, or composition")
    parser.add_argument("--request", help="the user's words, before the agent turned them into the prompt")
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
