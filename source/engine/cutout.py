#!/usr/bin/env python3
"""Remove the background of images into a session's next round, and record it in the style's ledger.

Each image's subjects are lifted off its background on this Mac (Vision, through cutout.swift) and
written as a transparent PNG next to the round's other images, so publishing the round shows them like
drawn images. Nothing is sent anywhere and nothing is billed. Needs macOS 14 or later and Swift
(the Xcode Command Line Tools).
"""

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import workspace
from session import Session
from style import StyleError, timestamp

ENGINE = Path(__file__).resolve().parent


def main():
    arguments = parse_arguments()
    workspace.enter()
    try:
        session = Session.at(arguments.session)
    except StyleError as error:
        sys.exit(str(error))
    style = session.style
    sources = [Path(image).resolve() for image in arguments.images]
    for source in sources:
        if not source.is_file():
            sys.exit(f"image not found: {source}")

    output = session.next_round() / (arguments.into or "")
    output.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    targets = [output / f"{stamp}-cutout-{index}.png" for index in range(len(sources))]

    started = time.time()
    run = subprocess.run(["swift", str(ENGINE / "cutout.swift"), *[str(path) for pair in zip(sources, targets) for path in pair]], capture_output=True, text=True)
    made = [target for target in targets if target.exists()]
    entry = {
        "time": timestamp(),
        "tag": arguments.tag,
        "session": session.id,
        "model": None,
        "tool": "cutout",
        "request": arguments.request,
        "sources": [style.relative(source) for source in sources],
        "status": "ok" if made else "failed",
        "outputs": [style.relative(path) for path in made],
        "cost": 0,
        "seconds": round(time.time() - started, 1)
    }
    if run.returncode != 0:
        entry["error"] = run.stderr.strip()
    style.ledger().append(entry)
    print(json.dumps({key: entry.get(key) for key in ("status", "outputs", "error", "seconds")}, ensure_ascii=False))
    if run.returncode != 0:
        sys.exit(1)


def parse_arguments():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("session", help="the session folder, such as sessions/app-icon/20261011-230012")
    parser.add_argument("images", nargs="+", help="the images whose background to remove, such as an image on the session's board")
    parser.add_argument("--request", help="the user's words that asked for it")
    parser.add_argument("--into", help="a subfolder of the round for these images, to keep candidates apart")
    parser.add_argument("--tag", default="generate", help="label stored in the ledger: the kind of round the images are for")
    return parser.parse_args()


if __name__ == "__main__":
    main()
