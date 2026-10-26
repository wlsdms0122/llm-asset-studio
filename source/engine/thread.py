#!/usr/bin/env python3
"""Threads: conversations with the user about the project or a style, in rounds.

A thread holds words. What the agent makes while talking (a draft, a text) and what the user sends (an image) are
nodes on the canvas, and a round points to them, so everything made in a project is in one place. A round is one
message from the agent and the user's answer to it. Every surface reads and writes through this file, so an answer
given on the web page and one given in conversation leave the same records:

  projects/<project>/threads/<id>/      id is t1, t2, ...
    thread.json         kind, the style (none for a project thread), when it started, the name the user gave it
    NNN/round.json      written once by the agent: its message, the nodes it shows in display order, and their images
                        numbered as they were shown
    NNN/feedback.json   written once by a surface: the user's reply, picks and notes on the images shown, the nodes
                        sent with it

Two kinds, by the document the thread is under:
  project   the project: what it is for, which the agent writes into project.md, the brief every style and
            generation in the project reads; and working out what to make (document/ideation.md), with drafts of
            ideas and texts such as a palette or a brief for an image.
  style     making a style and improving it. The agent describes the style back in plain words, asks, shows drafts,
            and writes style.md, recording each change as a revision.

Commands:
  open <project> project [--message M]        open a thread about the project
  open <style> style [--message M]            open a thread about a style; a message is the user's first words,
                                              answering its opening
  publish <thread> [--note N] [--node ID ...] the agent's next round: its message and the nodes it shows
  show <thread>                               the thread as the surfaces see it
  answer <thread> [--picked 1,3] [--note 2=text] [--comment C] [--node ID ...]
  rename <thread> <name>
  delete <thread>
"""

import argparse
import json
import shutil
import sys
from pathlib import Path

import workspace
from node import Node
from project import Project
from workspace import RecordError, read_json, timestamp, write_json, write_once

KINDS = {"project", "style"}

# What the user reads first. The rounds keep it, since a round records what was shown.
NEW_STYLE_QUESTION = "어떤 스타일을 만들까요? 스타일은 그림에 무엇이 나오는지가 아니라, 어떤 그림이든 같은 느낌으로 그리는 방식이에요. 납작한 벡터인지 손그림인지 3D인지, 선과 색, 빛과 질감 같은 것들이요. 어디에 쓸 그림인지, 떠오르는 느낌을 편하게 적어 주세요. 비슷한 느낌의 이미지가 있으면 함께 올려 주세요."
STYLE_QUESTION = "{style} 에서 무엇을 바꿀까요? 고치고 싶은 점, 더하고 싶은 모델, 레퍼런스 이야기 모두 괜찮아요."
NEW_PROJECT_QUESTION = "이 프로젝트는 무엇을 위한 건가요? 그림이 어디에 쓰이는지, 누가 보는지, 어떤 톤이어야 하는지 편하게 적어 주세요. 대화를 바탕으로 프로젝트 브리프를 정리해 둘게요. 모든 스타일과 생성이 이 브리프를 읽어요. 브랜드 색처럼 값으로 정해진 것이 있으면 캔버스에 텍스트로 써 둘게요."
PROJECT_QUESTION = "무엇을 이야기할까요? 브리프 고치기, 무엇을 그릴지 같이 정하기, 색 팔레트 같은 텍스트 쓰기 모두 괜찮아요."


class Thread:
    def __init__(self, project, directory):
        self.project = project
        self.directory = Path(directory)
        self.id = self.directory.name
        self.record = read_json(self.directory / "thread.json")
        self.kind = self.record["kind"]

    @classmethod
    def at(cls, path):
        directory = workspace.resolve(path)
        project = Project.at(path)
        if directory.parent != project.path / "threads" or not (directory / "thread.json").exists():
            raise RecordError(f"{path} is not a thread")
        return cls(project, directory)

    @classmethod
    def all(cls, project):
        folder = project.path / "threads"
        if not folder.is_dir():
            return []
        found = [cls(project, path) for path in folder.iterdir() if path.is_dir() and (path / "thread.json").exists()]
        return sorted(found, key=lambda thread: int(thread.id[1:]))

    @classmethod
    def open(cls, project, kind, question, style=None):
        if kind not in KINDS:
            raise RecordError(f"a thread is one of {', '.join(sorted(KINDS))}")
        if (style is None) != (kind == "project"):
            raise RecordError("a project thread has no style; a style thread has one")
        directory = workspace.claim_number(project.path / "threads", "t")
        write_json(directory / "thread.json", {"kind": kind, "style": style.name if style else None, "started": timestamp()})
        thread = cls(project, directory)
        thread.publish(question)
        return thread

    @property
    def style(self):
        return self.project.style(self.record["style"]) if self.record["style"] else None

    def rounds(self):
        return [Round(self, path) for path in sorted(self.directory.iterdir()) if path.is_dir() and path.name.isdigit() and (path / "round.json").exists()]

    def latest(self):
        rounds = self.rounds()
        return rounds[-1] if rounds else None

    def waiting(self):
        """The user's turn: the last round waits for an answer. Otherwise it is the agent's."""
        latest = self.latest()
        return bool(latest and latest.feedback() is None)

    def title(self):
        """What the user calls the thread: the name they gave it, or the first thing they wrote."""
        if self.record.get("name"):
            return self.record["name"]
        for item in self.rounds():
            feedback = item.feedback()
            if feedback and feedback.get("comment"):
                return feedback["comment"]
        return None

    def summary(self):
        latest = self.latest()
        answer = latest.feedback() if latest else None
        return {
            "id": self.id,
            "kind": self.kind,
            "style": self.record["style"],
            "title": self.title(),
            "started": self.record["started"],
            "updated": (answer or {}).get("time") or (latest.record.get("time") if latest else self.record["started"]),
            "waiting": self.waiting()
        }

    def view(self):
        known = {node.id: node for node in self.project.nodes()}
        brief = self.project.brief() if self.kind == "project" else None
        return {**self.summary(), "brief": brief, "rounds": [item.view(known) for item in self.rounds()]}

    def publish(self, note, nodes=()):
        """The agent's next round: its message and the nodes it shows, which are made before it is published."""
        shown = existing(self.project, nodes)
        for node in shown:
            if node.result() is None:
                raise RecordError(f"{node.id} is not made yet; publish it first")
        # The images are numbered once, as they are shown, so a pick means the image the user saw under that number.
        candidates = [image["path"] for node in shown for image in node.view()["images"]]
        record = {"note": note, "nodes": list(nodes), "candidates": candidates, "time": timestamp()}
        # What the user read is copied in, since style.md and the brief change while they are written.
        if self.style:
            record["spec"] = self.style.spec()
        else:
            record["brief"] = self.project.brief()
        directory = workspace.claim_number(self.directory, "", width=3)
        write_once(directory / "round.json", record)
        return Round(self, directory)

    def rename(self, name):
        name = " ".join(name.split())
        if not name:
            raise RecordError("a thread's name cannot be empty")
        self.record["name"] = name
        write_json(self.directory / "thread.json", self.record)

    def delete(self):
        shutil.rmtree(self.directory)


class Round:
    def __init__(self, thread, directory):
        self.thread = thread
        self.project = thread.project
        self.directory = Path(directory)
        self.number = int(self.directory.name)
        self.record = read_json(self.directory / "round.json")

    def feedback(self):
        return read_json(self.directory / "feedback.json")

    def shown(self, known):
        """The nodes the round shows, as the surfaces see them. A node the user deleted from the canvas is gone from
        here too."""
        return [known[identifier].view() for identifier in self.record.get("nodes", []) if identifier in known]

    def candidates(self, shown):
        """The images shown, under the numbers they were shown with. One whose node the user deleted is gone."""
        images = {image["path"]: image for view in shown for image in view["images"]}
        return [{"number": number, "path": path, "node": path.split("/")[1], "image": images.get(path)} for number, path in enumerate(self.record["candidates"], 1)]

    def view(self, known):
        feedback = self.feedback() or {}
        chosen = set(feedback.get("picked", []))
        notes = feedback.get("notes", {})
        shown = self.shown(known)
        return {
            "round": self.number,
            "note": self.record.get("note", ""),
            "time": self.record.get("time"),
            "spec": self.record.get("spec"),
            "brief": self.record.get("brief"),
            "nodes": shown,
            "candidates": [{
                "number": item["number"],
                "node": item["node"],
                "path": item["path"],
                "gone": item["image"] is None,
                "description": (item["image"] or {}).get("description"),
                "model": (item["image"] or {}).get("model"),
                "picked": item["path"] in chosen,
                "note": notes.get(item["path"])
            } for item in self.candidates(shown)],
            "sent": [known[identifier].view() for identifier in feedback.get("nodes", []) if identifier in known],
            "feedback": self.feedback()
        }

    def submit(self, picked, notes, comment, nodes, surface):
        """The user's answer: picks and notes by candidate number, a reply, and the nodes sent with it (images the
        user brought, made into upload nodes first)."""
        if self.feedback() is not None:
            raise RecordError(f"round {self.number} is already answered")
        paths = self.record["candidates"]

        def path_of(number):
            if not 1 <= number <= len(paths):
                raise RecordError(f"round {self.number} has no candidate {number}")
            return paths[number - 1]

        existing(self.project, nodes)
        feedback = {
            "round": self.number,
            "picked": [path_of(number) for number in sorted(set(picked))],
            "notes": {path_of(number): text.strip() for number, text in sorted(notes.items()) if text.strip()},
            "comment": comment.strip(),
            "nodes": list(dict.fromkeys(nodes)),
            "surface": surface,
            "time": timestamp()
        }
        write_once(self.directory / "feedback.json", feedback)
        return feedback


def existing(project, identifiers):
    """The nodes named, in order; a name the project has no node for is refused."""
    known = {node.id: node for node in project.nodes()}
    missing = [identifier for identifier in identifiers if identifier not in known]
    if missing:
        raise RecordError(f"{project.name} has no node {', '.join(missing)}")
    return [known[identifier] for identifier in identifiers]


def open_project_thread(project, message="", uploads=(), surface="chat"):
    """A conversation about the project: writing its brief when there is none."""
    thread = Thread.open(project, "project", PROJECT_QUESTION if project.brief().strip() else NEW_PROJECT_QUESTION)
    answer_first(thread, message, uploads, surface)
    return thread


def open_style_thread(style, first=False, message="", uploads=(), surface="chat"):
    """A conversation about a style: making it when it is new, improving it otherwise. A message is the user's
    first words, and answers the opening round at once so the agent sees it."""
    question = NEW_STYLE_QUESTION if first else STYLE_QUESTION.format(style=style.name)
    thread = Thread.open(style.project, "style", question, style)
    answer_first(thread, message, uploads, surface)
    return thread


def answer_first(thread, message, uploads, surface):
    """uploads are (file name, content) pairs, each made into an upload node of the thread."""
    if not message.strip() and not uploads:
        return
    nodes = [Node.create(thread.project, "upload", attachments=[upload], thread=thread.id, surface=surface).id for upload in uploads]
    thread.latest().submit([], {}, message, nodes, surface)


def main():
    arguments = parse_arguments()
    workspace.enter()
    try:
        if arguments.command == "open":
            from style import Style
            if arguments.kind == "project":
                thread = open_project_thread(Project.at(arguments.target), arguments.message)
            else:
                thread = open_style_thread(Style.at(arguments.target), message=arguments.message)
            print(workspace.relative(thread.directory))
            return
        thread = Thread.at(arguments.thread)
        if arguments.command == "publish":
            thread.publish(arguments.note, arguments.node)
            # The agent's publish, unlike the opening question a surface writes, says an agent is at work.
            workspace.heartbeat()
        elif arguments.command == "show":
            print(json.dumps(thread.view(), ensure_ascii=False, indent=2))
        elif arguments.command == "answer":
            current = thread.latest()
            if current is None:
                raise RecordError("no round to answer")
            feedback = current.submit(
                picked=[int(number) for number in arguments.picked.split(",") if number.strip()],
                notes=dict(parse_note(note) for note in arguments.note),
                comment=arguments.comment,
                nodes=arguments.node,
                surface="chat"
            )
            print(json.dumps(feedback, ensure_ascii=False, indent=2))
        elif arguments.command == "rename":
            thread.rename(arguments.name)
        elif arguments.command == "delete":
            thread.delete()
    except RecordError as error:
        sys.exit(str(error))


def parse_arguments():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    opening = commands.add_parser("open")
    opening.add_argument("target", help="projects/<project> for a project thread, projects/<project>/styles/<style> for a style thread")
    opening.add_argument("kind", choices=sorted(KINDS))
    opening.add_argument("--message", default="", help="the user's first words")
    for command in ("show", "delete"):
        commands.add_parser(command).add_argument("thread", help="projects/<project>/threads/<id>")
    renaming = commands.add_parser("rename")
    renaming.add_argument("thread")
    renaming.add_argument("name")
    publishing = commands.add_parser("publish")
    publishing.add_argument("thread")
    publishing.add_argument("--note", default="", help="the agent's message, in the user's language")
    publishing.add_argument("--node", action="append", default=[], help="a node the round shows, in display order, repeatable")
    answering = commands.add_parser("answer")
    answering.add_argument("thread")
    answering.add_argument("--picked", default="", help="candidate numbers, comma separated")
    answering.add_argument("--note", action="append", default=[], help="number=text, a note on a candidate, picked or not, repeatable")
    answering.add_argument("--comment", default="", help="the user's reply")
    answering.add_argument("--node", action="append", default=[], help="a node sent with the reply: an image the user brought, added with node.py add --upload, repeatable")
    return parser.parse_args()


def parse_note(text):
    number, separator, note = text.partition("=")
    if not separator or not number.strip().isdigit():
        raise RecordError(f"a note is number=text, got {text}")
    return int(number), note


if __name__ == "__main__":
    main()
