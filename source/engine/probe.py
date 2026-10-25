#!/usr/bin/env python3
"""Probe runs: a style's probe requests drawn with one revision, or with a proposal, so two can be compared.

  projects/<project>/styles/<style>/runs/<n>/
    run.json        written once by the surface that asked: the revision or proposal drawn, the requests, when, where
    result.json     written once by the agent: one image per request in request order, its note, its reviews
    calls.jsonl     every generation call made for it
    *.png ...       the images

The requests are the style's probes (probes.md) when the run is asked for, and any extra requests the user adds,
such as trying a style on a subject of their own before it has references. A run of a style that has no references
yet draws from the words alone; its images are where the first references are picked from.

Commands:
  request <style> [--proposal ID] [--request TEXT ...]     ask for a run
  publish <run> [--note N] [--review V ...] <file> ...     the images, one per request in request order
  show <run>
"""

import argparse
import json
import sys
from pathlib import Path

import workspace
from proposal import Proposal
from style import Style
from workspace import RecordError, read_json, read_lines, timestamp, write_once


class ProbeRun:
    def __init__(self, style, directory):
        self.style = style
        self.directory = Path(directory)
        self.number = int(self.directory.name)
        self.record = read_json(self.directory / "run.json")

    @classmethod
    def at(cls, path):
        directory = workspace.resolve(path)
        style = Style.at(path)
        if directory.parent != style.path / "runs" or not (directory / "run.json").exists():
            raise RecordError(f"{path} is not a probe run")
        return cls(style, directory)

    @classmethod
    def all(cls, style):
        folder = style.path / "runs"
        if not folder.is_dir():
            return []
        return sorted((cls(style, path) for path in folder.iterdir() if path.name.isdigit() and (path / "run.json").exists()), key=lambda run: run.number)

    @classmethod
    def request(cls, style, proposal=None, extra=(), surface="chat"):
        if style.guide():
            raise RecordError(f"{style.name} is a guide; probe the styles that extend it")
        requests = style.probes() + [text.strip() for text in extra if text.strip()]
        if not requests:
            raise RecordError(f"{style.name} has no probes yet; the agent writes probes.md first")
        if proposal is not None:
            proposal = Proposal(style, proposal)
            if proposal.record["status"] != "open":
                raise RecordError(f"proposal {proposal.id} is already {proposal.record['status']}")
            target = {"proposal": proposal.id, "base": proposal.record["base"]}
            model = proposal.snapshot().config()["model"]
        else:
            target = {"revision": style.revision()}
            model = style.model()
        if not model:
            raise RecordError(f"{style.name} has no model to draw its probes with")
        directory = workspace.claim_number(style.path / "runs")
        write_once(directory / "run.json", {**target, "model": model, "requests": requests, "time": timestamp(), "surface": surface})
        return cls(style, directory)

    def result(self):
        return read_json(self.directory / "result.json")

    def calls(self):
        return read_lines(self.directory / "calls.jsonl")

    def revision(self):
        """The revision the run shows: its own, or the one its proposal became when accepted."""
        if "revision" in self.record:
            return self.record["revision"]
        proposal = Proposal(self.style, self.record["proposal"])
        return proposal.record.get("revision")

    def publish(self, files, note="", reviews=()):
        files = [Path(file).resolve() for file in files]
        if len(files) != len(self.record["requests"]):
            raise RecordError(f"run {self.number} has {len(self.record['requests'])} requests; give one image for each, in order")
        if len(reviews) not in (0, len(files)):
            raise RecordError(f"{len(reviews)} reviews for {len(files)} images")
        for file in files:
            if self.directory.resolve() not in file.parents or not file.is_file():
                raise RecordError(f"{file} is not an image drawn into run {self.number}")
        write_once(self.directory / "result.json", {
            "images": [file.relative_to(self.directory.resolve()).as_posix() for file in files],
            "note": note,
            "reviews": list(reviews),
            "time": timestamp()
        })
        workspace.heartbeat()

    def view(self):
        result = self.result()
        made = {output: call for call in self.calls() for output in call.get("outputs", [])}
        images = []
        for index, request in enumerate(self.record["requests"]):
            file = result["images"][index] if result else None
            call = made.get(file, {})
            images.append({
                "request": request,
                "path": self.style.relative(self.directory / file) if file else None,
                "prompt": call.get("prompt"),
                "review": (result.get("reviews") or [None] * len(result["images"]))[index] if result else None
            })
        return {
            "number": self.number,
            "revision": self.revision(),
            "proposal": self.record.get("proposal"),
            "model": self.record["model"],
            "time": self.record["time"],
            "status": "done" if result else "drawing" if self.calls() or (self.directory / ".drawing").exists() else "queued",
            "note": (result or {}).get("note", ""),
            "images": images,
            "cost": sum(call.get("cost") or 0 for call in self.calls())
        }


def main():
    arguments = parse_arguments()
    workspace.enter()
    try:
        if arguments.command == "request":
            run = ProbeRun.request(Style.at(arguments.style), arguments.proposal, arguments.request)
            print(workspace.relative(run.directory))
            return
        run = ProbeRun.at(arguments.run)
        if arguments.command == "publish":
            run.publish(arguments.files, arguments.note, arguments.review)
        elif arguments.command == "show":
            print(json.dumps(run.view(), ensure_ascii=False, indent=2))
    except RecordError as error:
        sys.exit(str(error))


def parse_arguments():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    requesting = commands.add_parser("request")
    requesting.add_argument("style", help="projects/<project>/styles/<style>")
    requesting.add_argument("--proposal", help="draw with this proposal instead of the current revision")
    requesting.add_argument("--request", action="append", default=[], help="an extra request after the probes, repeatable")
    publishing = commands.add_parser("publish")
    publishing.add_argument("run", help="projects/<project>/styles/<style>/runs/<n>")
    publishing.add_argument("--note", default="", help="what the run shows, in the user's language: what changed against the revision it is compared with")
    publishing.add_argument("--review", action="append", default=[], help="one verdict per image in request order (document/review.md)")
    publishing.add_argument("files", nargs="+")
    commands.add_parser("show").add_argument("run")
    return parser.parse_args()


if __name__ == "__main__":
    main()
