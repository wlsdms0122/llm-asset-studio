#!/usr/bin/env python3
"""Wait until the agent has work, and print the folder of every place that has some.

The agent's work, read from the records:
  projects/<p>/threads/<id>             a thread whose last round the user answered
  projects/<p>/nodes/<id>               a generation node with no result yet
  projects/<p>/styles/<s>/runs/<n>      a probe run with no result yet
  projects/<p>/styles/<s>               a style reference with no annotation, or a reference set changed since its check
  projects/<p>/subjects                 a subject reference with no annotation

It looks at the records rather than at changes, so work that comes in while the agent is busy is printed by the
next run, and work already waiting is printed at once. Every look is recorded in agent.json, so the page can show
that an agent is attached.

Options:
  --once    print what is waiting now, even nothing, without waiting
"""

import argparse
import time

import workspace
from probe import ProbeRun
from project import Project
from workspace import digest, images_in


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
            found.extend(run.directory for run in ProbeRun.all(style) if run.result() is None)
            if unchecked(style):
                found.append(style.path)
        if any(not path.with_suffix(".json").exists() for path in images_in(project.subject_folder)):
            found.append(project.subject_folder)
    return [workspace.relative(path) for path in found]


def unchecked(style):
    """A reference without its annotation, or a set of style references that is not the one last checked."""
    references = style.references()
    if any(item["annotation"] is None for item in references):
        return True
    if not references:
        return False
    check = style.set_check() or {}
    return check.get("references") != {item["path"]: digest(style.project.resolve(item["path"])) for item in references}


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
