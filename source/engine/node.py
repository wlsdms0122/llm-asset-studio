#!/usr/bin/env python3
"""A node: one thing made in a project, with everything it was made from.

  projects/<project>/nodes/<id>/        id is n1, n2, ...: short, so the user can name a node in conversation
    node.json       written once by the surface that asked: kind, request, style, parents, attachments, tool
    attachments/    images sent with the request
    result.json     written once by whoever made it: the images, the agent's note and reviews, the style revision
                    and model it was drawn with, the references attached and the ones left out with why
    calls.jsonl     every generation call made for it, with its prompt, references, and cost
    *.png ...       the images

Three kinds:
  generation  the user's request drawn with a style by the agent; parents are the images it builds on, so refining
              an image is a new node whose parent is that image
  tool        work on finished images that needs no drawing, done here by the engine at no cost (cutout)
  upload      an image the user brought

The canvas draws an edge from every parent to its node; nothing else records edges.

Commands:
  add <project> --style S --request R [--parent IMG ...] [--attach FILE ...]   a generation node
  add <project> --tool cutout --parent IMG ...                                 a tool node, run at once
  add <project> --upload FILE                                                  an upload node
  publish <node> [--note N] [--describe D ...] [--review V ...] [--drop REF=WHY ...] [files]
  show <node>
  delete <node>
"""

import argparse
import json
import shutil
import subprocess
import sys
import threading
from pathlib import Path

import workspace
from project import Project
from workspace import RecordError, images_in, read_json, read_lines, timestamp, write_once

ENGINE = Path(__file__).resolve().parent
KINDS = {"generation", "tool", "upload"}
TOOLS = {"cutout"}


class Node:
    def __init__(self, project, directory):
        self.project = project
        self.directory = Path(directory)
        self.id = self.directory.name
        self.record = read_json(self.directory / "node.json")
        self.kind = self.record["kind"]

    @classmethod
    def at(cls, path):
        directory = workspace.resolve(path)
        project = Project.at(path)
        if directory.parent != project.path / "nodes" or not (directory / "node.json").exists():
            raise RecordError(f"{path} is not a node")
        return cls(project, directory)

    @classmethod
    def all(cls, project):
        folder = project.path / "nodes"
        if not folder.is_dir():
            return []
        found = [cls(project, path) for path in folder.iterdir() if path.is_dir() and (path / "node.json").exists()]
        return sorted(found, key=lambda node: int(node.id[1:]))

    @classmethod
    def create(cls, project, kind, request="", style=None, parents=(), attachments=(), tool=None, thread=None, surface="chat"):
        """attachments are (file name, content) pairs."""
        if kind not in KINDS:
            raise RecordError(f"a node is one of {', '.join(sorted(KINDS))}")
        request = " ".join(request.split()) if kind != "generation" else request.strip()
        parents = [cls.image(project, path) for path in parents]
        if kind == "generation":
            if not request:
                raise RecordError("a generation needs a request")
            reason = project.style(style or "").blocked()
            if reason:
                raise RecordError(reason)
        if kind == "tool":
            if tool not in TOOLS:
                raise RecordError(f"a tool is one of {', '.join(sorted(TOOLS))}")
            if not parents:
                raise RecordError("a tool works on images: give the images as parents")
        if kind == "upload" and len(attachments) != 1:
            raise RecordError("an upload is one image")
        directory = workspace.claim_number(project.path / "nodes", "n")
        names = []
        if attachments:
            (directory / "attachments").mkdir()
            for name, content in attachments:
                name = workspace.upload_name(name)
                while name in names:
                    name = f"{Path(name).stem}-{len(names)}{Path(name).suffix}"
                (directory / "attachments" / name).write_bytes(content)
                names.append(name)
        record = {"kind": kind, "request": request, "parents": parents, "attachments": names, "time": timestamp(), "surface": surface}
        if kind == "generation":
            record["style"] = project.style(style).name
        if tool:
            record["tool"] = tool
        if thread:
            record["thread"] = thread
        write_once(directory / "node.json", record)
        node = cls(project, directory)
        if kind == "upload":
            write_once(directory / "result.json", {"images": [f"attachments/{names[0]}"], "time": timestamp()})
        return node

    @staticmethod
    def image(project, path):
        """A parent: an image made in this project, named by its path in the project (nodes/n3/a.png)."""
        resolved = project.resolve(path)
        if not resolved.is_file() or resolved.suffix.lower() not in workspace.IMAGE_SUFFIXES or not workspace.inside(resolved, project.path / "nodes"):
            raise RecordError(f"{path} is not an image of {project.name}")
        return project.relative(resolved)

    @property
    def style(self):
        return self.record.get("style")

    def result(self):
        return read_json(self.directory / "result.json")

    def calls(self):
        return read_lines(self.directory / "calls.jsonl")

    def status(self):
        result = self.result()
        if result is not None:
            return "failed" if not result.get("images") else "done"
        if self.kind == "tool":
            return "running"
        return "drawing" if (self.directory / ".drawing").exists() or self.calls() else "queued"

    def run_tool(self):
        """Run the node's tool on its parents and write its result."""
        sources = [self.project.resolve(path) for path in self.record["parents"]]
        targets = [self.directory / f"cutout-{index + 1}.png" for index in range(len(sources))]
        run = subprocess.run(["swift", str(ENGINE / "cutout.swift"), *[str(path) for pair in zip(sources, targets) for path in pair]], capture_output=True, text=True)
        made = [target.name for target in targets if target.exists()]
        result = {"images": made, "time": timestamp()}
        if run.returncode != 0:
            result["error"] = run.stderr.strip() or f"{self.record['tool']} failed"
        write_once(self.directory / "result.json", result)

    def publish(self, files=None, note="", descriptions=(), reviews=(), dropped=()):
        """The agent's result for a generation node: the images it shows, in display order."""
        if self.kind != "generation":
            raise RecordError(f"{self.id} is a {self.kind} node; only generations are published by the agent")
        images = [Path(file).resolve() for file in files] if files else drawn(self.directory)
        for image in images:
            if self.directory.resolve() not in image.parents or not image.is_file() or image.parent.name == "attachments":
                raise RecordError(f"{image} is not an image drawn into {self.id}")
        if len(descriptions) not in (0, len(images)) or len(reviews) not in (0, len(images)):
            raise RecordError(f"give one description and one review per image, {len(images)} images")
        names = [image.relative_to(self.directory.resolve()).as_posix() for image in images]
        calls = [call for call in self.calls() if call.get("status") == "ok"]
        used = {}
        for call in calls:
            for item in call.get("references", []):
                used.setdefault(item["object"], item)
        style = self.project.style(self.style)
        write_once(self.directory / "result.json", {
            "images": names,
            "note": note,
            "descriptions": dict(zip(names, descriptions)),
            "reviews": dict(zip(names, reviews)),
            "style": style.name,
            "revision": next((call["revision"] for call in reversed(calls) if call.get("revision")), None) or style.revision(),
            "model": calls[-1]["model"] if calls else None,
            "references": list(used.values()),
            "dropped": [dict(zip(("reference", "reason"), [part.strip() for part in item.partition("=")[::2]])) for item in dropped],
            "time": timestamp()
        })
        if (self.directory / ".drawing").exists():
            (self.directory / ".drawing").unlink()
        workspace.heartbeat()

    def view(self):
        """What the canvas and the conversation show."""
        result = self.result() or {}
        made = {output: call for call in self.calls() for output in call.get("outputs", [])}
        return {
            "id": self.id,
            "kind": self.kind,
            "request": self.record.get("request", ""),
            "style": self.style,
            "tool": self.record.get("tool"),
            "thread": self.record.get("thread"),
            "parents": self.record["parents"],
            "attachments": [self.project.relative(self.directory / "attachments" / name) for name in self.record["attachments"]],
            "time": self.record["time"],
            "status": self.status(),
            "note": result.get("note", ""),
            "error": result.get("error"),
            "revision": result.get("revision"),
            "model": result.get("model"),
            "references": result.get("references", []),
            "dropped": result.get("dropped", []),
            "images": [{
                "path": self.project.relative(self.directory / name),
                "description": result.get("descriptions", {}).get(name),
                "prompt": made.get(name, {}).get("prompt"),
                "model": made.get(name, {}).get("model"),
                "review": result.get("reviews", {}).get(name)
            } for name in result.get("images", [])],
            "cost": sum(call.get("cost") or 0 for call in self.calls())
        }

    def delete(self):
        shutil.rmtree(self.directory)


def drawn(directory):
    """The images generated into a node or a round, its subfolders included, attachments left out."""
    directory = Path(directory)
    return images_in(directory) + [path for folder in sorted(directory.iterdir()) if folder.is_dir() and folder.name != "attachments" for path in images_in(folder)]


def views(project):
    """Every node of a project as the canvas shows it."""
    return [node.view() for node in project.nodes()]


def leaks(project, style):
    """How many reviewed images of a style the reviews found carrying something over from a reference."""
    reviews = [review for node in project.nodes() if node.style == style for review in ((node.result() or {}).get("reviews") or {}).values()]
    return {"reviewed": len(reviews), "leaked": sum(1 for review in reviews if review.lower().startswith("leak"))}


def run_in_background(node):
    threading.Thread(target=node.run_tool, daemon=True).start()


def main():
    arguments = parse_arguments()
    workspace.enter()
    try:
        if arguments.command == "add":
            project = Project.at(arguments.project if "/" in arguments.project else f"projects/{arguments.project}")
            parents = [project.relative(workspace.resolve(path)) for path in arguments.parent]
            if arguments.upload:
                node = Node.create(project, "upload", attachments=[(Path(arguments.upload).name, Path(arguments.upload).read_bytes())])
            elif arguments.tool:
                node = Node.create(project, "tool", request=arguments.request, parents=parents, tool=arguments.tool)
                node.run_tool()
            else:
                attachments = [(Path(path).name, Path(path).read_bytes()) for path in arguments.attach]
                node = Node.create(project, "generation", arguments.request, arguments.style, parents, attachments)
            print(workspace.relative(node.directory))
            return
        node = Node.at(arguments.node)
        if arguments.command == "publish":
            node.publish(arguments.files or None, arguments.note, arguments.describe, arguments.review, arguments.drop)
        elif arguments.command == "show":
            print(json.dumps(node.view(), ensure_ascii=False, indent=2))
        elif arguments.command == "delete":
            node.delete()
    except (RecordError, OSError) as error:
        sys.exit(str(error))


def parse_arguments():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    adding = commands.add_parser("add")
    adding.add_argument("project", help="the project name, or projects/<project>")
    adding.add_argument("--style", help="generation: the style to draw with")
    adding.add_argument("--request", default="", help="the user's words, as written")
    adding.add_argument("--parent", action="append", default=[], help="an image it builds on, such as projects/deckit/nodes/n3/a.png, repeatable")
    adding.add_argument("--attach", action="append", default=[], help="generation: an image the user sent with the request, repeatable")
    adding.add_argument("--tool", choices=sorted(TOOLS))
    adding.add_argument("--upload", help="an image the user brought")
    publishing = commands.add_parser("publish")
    publishing.add_argument("node", help="projects/<project>/nodes/<id>")
    publishing.add_argument("--note", default="", help="the agent's message on the node, in the user's language")
    publishing.add_argument("--describe", action="append", default=[], help="one line per image, in order: what to say about it")
    publishing.add_argument("--review", action="append", default=[], help="one verdict per image, in order (document/review.md); hidden until the user acts on the node")
    publishing.add_argument("--drop", action="append", default=[], help="REFERENCE=WHY: a style reference left out of this generation and why, repeatable")
    publishing.add_argument("files", nargs="*", help="the images in display order; defaults to every image drawn into the node")
    for command in ("show", "delete"):
        commands.add_parser(command).add_argument("node")
    return parser.parse_args()


if __name__ == "__main__":
    main()
