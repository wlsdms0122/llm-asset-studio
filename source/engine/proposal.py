#!/usr/bin/env python3
"""A change to a style waiting for the user: written by the agent, tried with probes, accepted or rejected by the user.

  projects/<project>/styles/<style>/proposals/<id>/proposal.json      id is p1, p2, ...
    summary     the change in a line, in the user's language
    reason      what prompted it, in the user's language: the reaction it answers and why it belongs in the style
    source      where the reaction was: a node ("n12"), a thread round ("t3/004"), or the user's words
    base        the revision it was written against
    changes     every file it changes: the new content's object hash, or null to remove the file
    conflicts   what the change fights, such as a property every reference shares that the words now contradict
    status      open, accepted, or rejected; accepted names the revision it became

A proposal changes any tracked file (style.md, prompting files, style.json, probes.md, references and their
annotations), so adding a model is a proposal that writes its prompting file and makes it the model in use.
It is accepted only while the files it changes are still as they were at its base.

Commands:
  propose <style> --summary S --reason R [--source SRC] [--set PATH=FILE ...] [--remove PATH ...] [--conflict TEXT ...]
  accept <style> <id>
  reject <style> <id>
  show <style> <id>             the proposal with a diff of every file it changes
"""

import argparse
import json
import sys
from pathlib import Path

import workspace
from style import Style, diff
from workspace import RecordError, put_object, read_json, read_object, timestamp, write_json


class Proposal:
    def __init__(self, style, identifier):
        self.style = style
        self.id = identifier
        self.directory = style.path / "proposals" / identifier
        if not (self.directory / "proposal.json").exists() or "/" in identifier:
            raise RecordError(f"{style.name} has no proposal {identifier}")
        self.record = read_json(self.directory / "proposal.json")

    @classmethod
    def all(cls, style):
        folder = style.path / "proposals"
        if not folder.is_dir():
            return []
        found = [cls(style, path.name) for path in folder.iterdir() if (path / "proposal.json").exists()]
        return sorted(found, key=lambda proposal: int(proposal.id[1:]))

    @classmethod
    def create(cls, style, summary, reason, source, changes, conflicts=()):
        """changes maps a tracked path to its new content (bytes), or to None to remove it."""
        if not changes:
            raise RecordError("a proposal changes at least one file")
        tracked = set(style.tree())
        for path in changes:
            if path.startswith(("/", "..")) or Path(path).parts[0] in ("proposals", "runs") or path in ("revisions.jsonl", "references/set.json"):
                raise RecordError(f"{path} is not a file of the style")
            if changes[path] is None and path not in tracked:
                raise RecordError(f"{style.name} has no {path} to remove")
        directory = workspace.claim_number(style.path / "proposals", "p")
        record = {
            "id": directory.name,
            "summary": summary.strip(),
            "reason": reason.strip(),
            "source": source,
            "base": style.revision(),
            "changes": {path: None if content is None else put_object(content) for path, content in changes.items()},
            "conflicts": list(conflicts),
            "status": "open",
            "time": timestamp()
        }
        write_json(directory / "proposal.json", record)
        return cls(style, directory.name)

    def snapshot(self):
        return self.style.snapshot(self.record["base"], self.record["changes"])

    def files(self):
        """Each changed file with its diff against the base revision, or for an image whether it is added or removed."""
        base = self.style.revisions()[self.record["base"] - 1]["files"]
        shown = []
        for path, content in self.record["changes"].items():
            if Path(path).suffix.lower() in workspace.IMAGE_SUFFIXES:
                shown.append({"path": path, "image": True, "change": "removed" if content is None else "changed" if path in base else "added", "object": content or base.get(path)})
            else:
                before = read_object(base[path]).decode("utf-8") if path in base else None
                after = read_object(content).decode("utf-8") if content else None
                shown.append({"path": path, "image": False, "change": "removed" if content is None else "changed" if path in base else "added", "diff": diff(before, after, path)})
        return shown

    def view(self):
        return {**self.record, "files": self.files(), "applies": self.applies()}

    def applies(self):
        """Whether the files it changes are still as they were at its base."""
        base = self.style.revisions()[self.record["base"] - 1]["files"]
        now = self.style.tree()
        return all(now.get(path) == base.get(path) for path in self.record["changes"])

    def accept(self):
        if self.record["status"] != "open":
            raise RecordError(f"proposal {self.id} is already {self.record['status']}")
        if not self.applies():
            raise RecordError(f"{self.style.name} changed since proposal {self.id} was written; the agent writes it again")
        for path, content in self.record["changes"].items():
            target = self.style.path / path
            if content is None:
                target.unlink()
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(read_object(content))
        number = self.style.revision(self.record["summary"], f"proposal {self.id}")
        self.decide("accepted", revision=number)
        return number

    def reject(self):
        if self.record["status"] != "open":
            raise RecordError(f"proposal {self.id} is already {self.record['status']}")
        self.decide("rejected")

    def decide(self, status, **fields):
        self.record.update({"status": status, "decided": timestamp(), **fields})
        write_json(self.directory / "proposal.json", self.record)


def main():
    arguments = parse_arguments()
    workspace.enter()
    try:
        style = Style.at(arguments.style)
        if arguments.command == "propose":
            changes = {}
            for item in arguments.set:
                path, separator, file = item.partition("=")
                if not separator:
                    raise RecordError(f"--set is PATH=FILE, got {item}")
                changes[path.strip()] = Path(file).read_bytes()
            changes.update({path: None for path in arguments.remove})
            proposal = Proposal.create(style, arguments.summary, arguments.reason, arguments.source, changes, arguments.conflict)
            print(proposal.id)
        else:
            proposal = Proposal(style, arguments.id)
            if arguments.command == "accept":
                print(proposal.accept())
            elif arguments.command == "reject":
                proposal.reject()
            elif arguments.command == "show":
                view = proposal.view()
                print(json.dumps({key: value for key, value in view.items() if key != "files"}, ensure_ascii=False, indent=2))
                for item in view["files"]:
                    print(item["diff"] if not item["image"] else f"{item['change']}: {item['path']}")
    except (RecordError, OSError) as error:
        sys.exit(str(error))


def parse_arguments():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    proposing = commands.add_parser("propose")
    proposing.add_argument("style", help="projects/<project>/styles/<style>")
    proposing.add_argument("--summary", required=True)
    proposing.add_argument("--reason", required=True)
    proposing.add_argument("--source", default="", help="a node (n12), a thread round (t3/004), or the user's words")
    proposing.add_argument("--set", action="append", default=[], help="PATH=FILE: the file of the style at PATH gets FILE's content, such as style.md=/tmp/style.md or references/07.png=<image>")
    proposing.add_argument("--remove", action="append", default=[], help="a file of the style to remove, such as references/03.jpg")
    proposing.add_argument("--conflict", action="append", default=[], help="something the change fights, in a line")
    for command in ("accept", "reject", "show"):
        deciding = commands.add_parser(command)
        deciding.add_argument("style")
        deciding.add_argument("id")
    return parser.parse_args()


if __name__ == "__main__":
    main()
