#!/usr/bin/env python3
"""Wait until the agent has work, and print the folder of every place that has some.

The agent's work, read from the records:
  projects/<p>/threads/<id>             a thread whose last round the user answered
  projects/<p>/nodes/<id>               a generation node with no result yet, to draw or to write
  projects/<p>/styles/<s>               an image reference with no annotation, or a set of image references changed
                                        since its check

It looks at the records rather than at changes, so work that comes in while the agent is busy is printed by the
next run, and work already waiting is printed at once. Every look is recorded in agent.json, so the page can show
that an agent is attached.

Options:
  --once    print what is waiting now, even nothing, without waiting
"""

import argparse
import time

import workspace
from project import Project


def pending():
    found = []
    for project in Project.all():
        for thread in project.threads():
            if not thread.waiting():
                found.append(thread.directory)
        for node in project.nodes():
            if node.kind == "generation" and node.result() is None:
                found.append(node.directory)
        for style in project.styles():
            if unchecked(style):
                found.append(style.path)
    return [workspace.relative(path) for path in found]


def unchecked(style):
    """An image reference without its annotation, or a set of image references that is not the one last checked."""
    images = [item for item in style.references() if item["kind"] == "image"]
    if any(item["annotation"] is None for item in images):
        return True
    if not images:
        return False
    check = style.set_check() or {}
    return check.get("references") != {item["path"]: item["object"] for item in images}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--once", action="store_true")
    arguments = parser.parse_args()
    workspace.enter()
    while True:
        workspace.heartbeat()
        try:
            found = pending()
        except OSError:
            # Something deleted while it was being read; the next look finds it gone.
            found = []
        if found or arguments.once:
            break
        time.sleep(2)
    for path in found:
        print(path)


if __name__ == "__main__":
    main()
