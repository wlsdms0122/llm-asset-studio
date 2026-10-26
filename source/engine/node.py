#!/usr/bin/env python3
"""A node: one request in a project and what came out of it, images or a text, with everything it was made from.
What comes out of a node is material: it can go into a style's references, or be what another request builds on.

  projects/<project>/nodes/<id>/        id is n1, n2, ...: short, so the user can name a node in conversation
    node.json       written once by whoever asked: kind, request, style and revision, the draft model, parents,
                    attachments, tool, the thread it was made in
    attachments/    images sent with the request, or the file the user brought
    result.json     written once by whoever made it: the images or the text, the agent's note and reviews, the model
                    it was drawn with, the references attached and the ones left out with why
    calls.jsonl     every generation call made for it, with its prompt, references, and cost
    *.png ...       the images
    text.md         the text the agent wrote

Three kinds:
  generation  a request answered by the agent: drawn with a style at a revision, or, with no style, written as a text
              (a palette, design tokens, a brief for an image); parents are what it builds on, so refining an image
              or a text is a new node whose parent is it. A draft is drawn with the draft model to settle a question
              in a conversation (a reading of a style, an idea for an image), not to show the style; the agent asks
              for it, with the style when there is one
  tool        work on finished images that needs no drawing, done here by the engine at no cost (cutout)
  upload      an image or a text the user brought

A generation names the revision it draws with when it is asked for: the one the user chose, else the latest, recorded
then if the style changed since. The canvas draws an edge from every parent to its node; nothing else records edges.
Everything made in a project is a node, whatever asked for it: a thread round points to the nodes it shows, and an
image the user sends in a thread is an upload node.

Commands:
  add <project> --style S [--revision N] --request R [--parent FILE ...] [--attach IMG ...]
                                                            a generation node drawn with a style
  add <project> --request R [--parent FILE ...]             a generation node the agent writes as a text
  add <project> --draft MODEL [--style S] --request R [--thread T]
                                                            a draft, drawn with the draft model
  add <project> --tool cutout --parent IMG ...              a tool node, run at once
  add <project> --upload FILE [--thread T]                  an upload node: an image, or a text (.md, .txt)
  publish <node> [--note N] [--describe D ...] [--review V ...] [--drop REF=WHY ...] [files]
  publish <node> --text FILE [--note N]                     a written generation's text
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
from workspace import IMAGE_SUFFIXES, TEXT_SUFFIXES, RecordError, images_in, read_json, read_lines, read_text, timestamp, write_once

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
    def create(cls, project, kind, request="", style=None, revision=None, parents=(), attachments=(), tool=None, draft=None, thread=None, surface="chat"):
        """attachments are (file name, content) pairs; draft is the draft model a draft is drawn with."""
        if kind not in KINDS:
            raise RecordError(f"a node is one of {', '.join(sorted(KINDS))}")
        request = " ".join(request.split()) if kind != "generation" else request.strip()
        parents = [cls.parent(project, path) for path in parents]
        if kind == "generation":
            if not request:
                raise RecordError("a generation needs a request")
            if style:
                style = project.style(style)
                # A chosen revision must exist. A draft tries the words before the style can draw; otherwise the latest
                # is checked before it is recorded, so a refused request leaves no revision behind.
                snapshot = style if revision is None else style.snapshot(int(revision))
                reason = None if draft else snapshot.blocked()
                if reason:
                    raise RecordError(reason)
                revision = style.revision() if revision is None else int(revision)
            elif attachments and not draft:
                raise RecordError("images are attached to a request that is drawn")
        elif draft:
            raise RecordError("only a generation is drawn as a draft")
        if kind == "tool":
            if tool not in TOOLS:
                raise RecordError(f"a tool is one of {', '.join(sorted(TOOLS))}")
            if not parents or any(Path(path).suffix.lower() not in IMAGE_SUFFIXES for path in parents):
                raise RecordError("a tool works on images: give the images as parents")
        if kind == "upload" and len(attachments) != 1:
            raise RecordError("an upload is one image or one text")
        thread = thread and project.thread(thread).id
        directory = workspace.claim_number(project.path / "nodes", "n")
        names = []
        if attachments:
            (directory / "attachments").mkdir()
            for name, content in attachments:
                name = workspace.upload_name(name, text=kind == "upload")
                if Path(name).suffix in TEXT_SUFFIXES:
                    try:
                        content.decode("utf-8")
                    except UnicodeDecodeError:
                        shutil.rmtree(directory)
                        raise RecordError("a text is UTF-8 text")
                while name in names:
                    name = f"{Path(name).stem}-{len(names)}{Path(name).suffix}"
                (directory / "attachments" / name).write_bytes(content)
                names.append(name)
        record = {"kind": kind, "request": request, "parents": parents, "attachments": names, "time": timestamp(), "surface": surface}
        if kind == "generation" and style:
            record["style"] = style.name
            record["revision"] = revision
        if draft:
            record["draft"] = draft
        if tool:
            record["tool"] = tool
        if thread:
            record["thread"] = thread
        write_once(directory / "node.json", record)
        node = cls(project, directory)
        if kind == "upload":
            made = f"attachments/{names[0]}"
            write_once(directory / "result.json", {"text": made, "time": timestamp()} if Path(made).suffix in TEXT_SUFFIXES else {"images": [made], "time": timestamp()})
        return node

    @staticmethod
    def parent(project, path):
        """A parent: an image or a text that came out of a node of this project, named by its path in the project
        (nodes/n3/a.png, nodes/n4/text.md)."""
        resolved = project.resolve(path)
        if not resolved.is_file() or resolved.suffix.lower() not in IMAGE_SUFFIXES | TEXT_SUFFIXES or not workspace.inside(resolved, project.path / "nodes"):
            raise RecordError(f"{path} is not an image or a text of {project.name}")
        return project.relative(resolved)

    @property
    def style(self):
        return self.record.get("style")

    @property
    def revision(self):
        """The style revision a drawn generation draws with, named when it was asked for."""
        return self.record.get("revision")

    @property
    def draft(self):
        """The draft model a draft is drawn with; None for a node drawn with its style's model."""
        return self.record.get("draft")

    @property
    def output(self):
        """What comes out of it: image, or text for a generation the agent writes and an upload of a text."""
        if self.kind == "generation":
            return "image" if self.style or self.draft else "text"
        if self.kind == "upload":
            return "text" if Path(self.record["attachments"][0]).suffix in TEXT_SUFFIXES else "image"
        return "image"

    def result(self):
        return read_json(self.directory / "result.json")

    def calls(self):
        return read_lines(self.directory / "calls.jsonl")

    def status(self):
        result = self.result()
        if result is not None:
            return "done" if result.get("images") or result.get("text") else "failed"
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

    def publish(self, files=None, note="", descriptions=(), reviews=(), dropped=(), text=None):
        """The agent's result for a generation node: the images it shows, in display order, or the text it wrote."""
        if self.kind != "generation":
            raise RecordError(f"{self.id} is a {self.kind} node; only generations are published by the agent")
        if (text is not None) != (self.output == "text"):
            raise RecordError(f"{self.id} is drawn as images; publish its images" if text is not None else f"{self.id} is written; publish its text with --text")
        if text is not None:
            if self.result() is not None:
                raise RecordError(f"{self.id} is already published")
            content = Path(text).read_bytes()
            try:
                content.decode("utf-8")
            except UnicodeDecodeError:
                raise RecordError("the text is not UTF-8")
            (self.directory / "text.md").write_bytes(content)
            write_once(self.directory / "result.json", {"text": "text.md", "note": note, "time": timestamp()})
            workspace.heartbeat()
            return
        images = [Path(file).resolve() for file in files] if files else images_in(self.directory)
        for image in images:
            if image.parent != self.directory.resolve() or not image.is_file():
                raise RecordError(f"{image} is not an image drawn into {self.id}")
        if len(descriptions) not in (0, len(images)) or len(reviews) not in (0, len(images)):
            raise RecordError(f"give one description and one review per image, {len(images)} images")
        names = [image.relative_to(self.directory.resolve()).as_posix() for image in images]
        calls = [call for call in self.calls() if call.get("status") == "ok"]
        used = {}
        for call in calls:
            for item in call.get("references", []):
                used.setdefault(item["object"], item)
        write_once(self.directory / "result.json", {
            "images": names,
            "note": note,
            "descriptions": dict(zip(names, descriptions)),
            "reviews": dict(zip(names, reviews)),
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
            "output": self.output,
            "request": self.record.get("request", ""),
            "style": self.style,
            "revision": self.revision,
            "draft": self.draft,
            "tool": self.record.get("tool"),
            "thread": self.record.get("thread"),
            "parents": self.record["parents"],
            "attachments": [self.project.relative(self.directory / "attachments" / name) for name in self.record["attachments"]],
            "time": self.record["time"],
            "status": self.status(),
            "note": result.get("note", ""),
            "error": result.get("error"),
            "text": read_text(self.directory / result["text"]) if result.get("text") else None,
            "text_path": self.project.relative(self.directory / result["text"]) if result.get("text") else None,
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


def views(project):
    """Every node of a project as the canvas shows it. A node made in a thread the user deleted names no thread."""
    threads = {thread.id for thread in project.threads()}
    return [{**view, "thread": view["thread"] if view["thread"] in threads else None} for view in (node.view() for node in project.nodes())]


def in_project(project, path):
    """A workspace path given on the command line, as a path in the project."""
    resolved = workspace.resolve(path)
    if not workspace.inside(resolved, project.path):
        raise RecordError(f"{path} is not in {project.name}; give it from the workspace, as projects/{project.name}/nodes/...")
    return project.relative(resolved)


def run_in_background(node):
    threading.Thread(target=node.run_tool, daemon=True).start()


def main():
    arguments = parse_arguments()
    workspace.enter()
    try:
        if arguments.command == "add":
            project = Project.at(arguments.project if "/" in arguments.project else f"projects/{arguments.project}")
            parents = [in_project(project, path) for path in arguments.parent]
            thread = arguments.thread
            if arguments.upload:
                node = Node.create(project, "upload", attachments=[(Path(arguments.upload).name, Path(arguments.upload).read_bytes())], thread=thread)
            elif arguments.tool:
                node = Node.create(project, "tool", request=arguments.request, parents=parents, tool=arguments.tool, draft=arguments.draft)
                node.run_tool()
            else:
                attachments = [(Path(path).name, Path(path).read_bytes()) for path in arguments.attach]
                node = Node.create(project, "generation", arguments.request, arguments.style, arguments.revision, parents, attachments, draft=arguments.draft, thread=thread)
            print(workspace.relative(node.directory))
            return
        node = Node.at(arguments.node)
        if arguments.command == "publish":
            node.publish(arguments.files or None, arguments.note, arguments.describe, arguments.review, arguments.drop, arguments.text)
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
    adding.add_argument("--style", help="generation: the style to draw with; without one the agent writes a text")
    adding.add_argument("--revision", type=int, help="generation: the style's revision to draw with; defaults to the latest")
    adding.add_argument("--request", default="", help="the user's words, as written")
    adding.add_argument("--parent", action="append", default=[], help="an image or a text it builds on, such as projects/deckit/nodes/n3/a.png, repeatable")
    adding.add_argument("--attach", action="append", default=[], help="a drawn generation: an image the user sent with the request, repeatable")
    adding.add_argument("--draft", help="a draft: the draft model to draw it with (document/models.md)")
    adding.add_argument("--thread", help="the thread it is made in, t3 or projects/<project>/threads/t3")
    adding.add_argument("--tool", choices=sorted(TOOLS))
    adding.add_argument("--upload", help="an image or a text the user brought")
    publishing = commands.add_parser("publish")
    publishing.add_argument("node", help="projects/<project>/nodes/<id>")
    publishing.add_argument("--note", default="", help="the agent's message on the node, in the user's language")
    publishing.add_argument("--describe", action="append", default=[], help="one line per image, in order: what to say about it")
    publishing.add_argument("--review", action="append", default=[], help="one verdict per image, in order (document/review.md)")
    publishing.add_argument("--drop", action="append", default=[], help="REFERENCE=WHY: a style reference left out of this generation and why, repeatable")
    publishing.add_argument("--text", help="a written generation: the file with its text")
    publishing.add_argument("files", nargs="*", help="the images in display order; defaults to every image drawn into the node")
    for command in ("show", "delete"):
        commands.add_parser(command).add_argument("node")
    return parser.parse_args()


if __name__ == "__main__":
    main()
