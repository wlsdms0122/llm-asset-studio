#!/usr/bin/env python3
"""Threads: conversations with the user about the project, a style, or an image, in rounds.

A round is one message from the agent and the user's answer to it. Every surface reads and writes through this
file, so an answer given on the web page and one given in conversation leave the same records:

  projects/<project>/threads/<id>/      id is t1, t2, ...
    thread.json         kind, the style (none for a project thread), when it started, the name the user gave it
    brief.md            an ideation thread's brief: the image the agent and the user settled on
    NNN/round.json      written once by the agent: its message, the candidate images in display order, what each
                        shows, and the proposals and nodes the message points to
    NNN/feedback.json   written once by a surface: the user's reply, picks, notes on images, attachments, decision
    NNN/attachments/    images the user attaches while the round is open
    NNN/calls.jsonl     the generation calls for the round's candidates

Three kinds:
  project   what the project is for. The agent asks and writes project.md, the brief every style and generation in
            the project reads.
  style     making a style and improving it. The agent describes the style back in plain words, asks, shows
            candidates from the draft model, and writes style.md; once the style has references, changes go to
            the user as proposals (proposal.py) tried with probes.
  ideation  working out an image with a style for a user who does not know yet what to make. The agent, as the
            designer, writes brief.md; the user's "generate" turns the brief into a generation node.

Commands:
  open <project> project [--message M]        open a thread about the project's brief
  open <style> style|ideation [--message M]   open a thread about a style or an image; a message is the user's first
                                              words, answering its opening
  next <thread>                               print the directory for the thread's next round, creating it
  publish <round dir> [--note N] [--describe D ...] [--proposal ID ...] [--node ID ...] [files]
  show <thread>                               the thread as the surfaces see it
  answer <thread> [--picked 1,3] [--note 2=text] [--comment C] [--decision generate]
  rename <thread> <name>
  delete <thread>
"""

import argparse
import json
import shutil
import sys
from pathlib import Path

import workspace
from node import Node, drawn
from project import Project
from workspace import RecordError, images_in, read_json, read_lines, read_text, timestamp, write_json, write_once

KINDS = {"project", "style", "ideation"}
DECISIONS = {"project": {None}, "style": {None}, "ideation": {None, "generate"}}

# What the user reads first. The rounds keep it, since a round records what was shown.
NEW_STYLE_QUESTION = "어떤 스타일을 만들까요? 스타일은 그림에 무엇이 나오는지가 아니라, 어떤 그림이든 같은 느낌으로 그리는 방식이에요. 납작한 벡터인지 손그림인지 3D인지, 선과 색, 빛과 질감 같은 것들이요. 어디에 쓸 그림인지, 떠오르는 느낌을 편하게 적어 주세요. 비슷한 느낌의 이미지가 있으면 함께 올려 주세요."
STYLE_QUESTION = "{style} 에서 무엇을 바꿀까요? 고치고 싶은 점, 더하고 싶은 모델, 레퍼런스 이야기 모두 괜찮아요."
GUIDE_QUESTION = "어떤 가이드를 만들까요? 가이드는 혼자 그리지 않고, 이어받는 스타일에 색이나 형태 같은 일부 규칙을 더해요. 브랜드 색, 디자인 시스템처럼 지킬 것을 적어 주세요. 견본 이미지가 있으면 함께 올려 주세요."
NEW_PROJECT_QUESTION = "이 프로젝트는 무엇을 위한 건가요? 그림이 어디에 쓰이는지, 누가 보는지, 지켜야 할 브랜드 색이나 톤이 있는지 편하게 적어 주세요. 대화를 바탕으로 프로젝트 브리프를 정리해 둘게요. 모든 스타일과 생성이 이 브리프를 읽어요."
PROJECT_QUESTION = "브리프에서 무엇을 바꿀까요? 목적, 쓰는 곳, 보는 사람, 브랜드 색과 톤, 프로젝트 차원의 결정 모두 괜찮아요."
IDEATION_QUESTION = "어떤 이미지가 필요하세요? 어디에 쓸지, 누가 보는지, 떠오르는 것을 편하게 적어 주세요. 참고할 이미지가 있으면 함께 올려 주세요."


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
            raise RecordError("a project thread has no style; the others have one")
        if kind == "ideation":
            reason = style.blocked()
            if reason:
                raise RecordError(reason)
        directory = workspace.claim_number(project.path / "threads", "t")
        write_json(directory / "thread.json", {"kind": kind, "style": style.name if style else None, "started": timestamp()})
        thread = cls(project, directory)
        round_directory = thread.next_round()
        thread.publish(round_directory, question)
        return thread

    @property
    def style(self):
        return self.project.style(self.record["style"]) if self.record["style"] else None

    @property
    def brief_file(self):
        """The document the thread writes: the project's brief, or an ideation's brief of one image."""
        return {"project": self.project.brief_file, "ideation": self.directory / "brief.md"}.get(self.kind)

    def brief(self):
        return read_text(self.brief_file) if self.brief_file else None

    def rounds(self):
        return sorted(path for path in self.directory.iterdir() if path.is_dir() and path.name.isdigit())

    def published(self):
        return [Round(self, path) for path in self.rounds() if (path / "round.json").exists()]

    def latest(self):
        published = self.published()
        return published[-1] if published else None

    def next_round(self):
        """An unpublished last directory is reused, since its images were never shown."""
        directories = self.rounds()
        if directories and not (directories[-1] / "round.json").exists():
            return directories[-1]
        number = int(directories[-1].name) + 1 if directories else 1
        directory = self.directory / f"{number:03d}"
        # Generate calls run side by side; one that finds the directory just made shares that round.
        directory.mkdir(exist_ok=True)
        return directory

    def waiting(self):
        """The user's turn: the last round waits for an answer. Otherwise it is the agent's."""
        latest = self.latest()
        return bool(latest and latest.feedback() is None)

    def title(self):
        """What the user calls the thread: the name they gave it, the image its brief names, or the first thing they wrote."""
        if self.record.get("name"):
            return self.record["name"]
        heading = next((line for line in (self.brief() or "").splitlines() if line.strip()), "").lstrip("# ").strip()
        if heading and self.kind == "ideation":
            return heading
        for directory in self.rounds():
            feedback = read_json(directory / "feedback.json")
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
        return {**self.summary(), "brief": self.brief(), "rounds": [item.view() for item in self.published()]}

    def publish(self, directory, note, files=None, descriptions=(), proposals=(), nodes=()):
        directory = Path(directory)
        if directory.parent != self.directory or not directory.name.isdigit():
            raise RecordError(f"{directory} is not a round of thread {self.id}")
        images = [Path(file).resolve() for file in files] if files is not None else drawn(directory)
        candidates = [self.project.relative(image) for image in images]
        if len(descriptions) not in (0, len(candidates)):
            raise RecordError(f"{len(descriptions)} descriptions for {len(candidates)} images")
        style = self.style
        if proposals and not style:
            raise RecordError(f"thread {self.id} has no style to propose changes to")
        for identifier in proposals:
            from proposal import Proposal
            Proposal(style, identifier)
        known = {node.id for node in self.project.nodes()}
        for identifier in nodes:
            if identifier not in known:
                raise RecordError(f"{self.project.name} has no node {identifier}")
        record = {"note": note, "candidates": candidates, "descriptions": dict(zip(candidates, descriptions)), "proposals": list(proposals), "nodes": list(nodes), "time": timestamp()}
        # What the user saw is copied in, since style.md and the briefs change while they are written.
        if style:
            record["spec"] = style.spec()
        if self.brief_file:
            record["brief"] = self.brief()
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

    def attachments(self):
        """The images the user sent with the answer, or, while the round is open, the ones waiting to be sent."""
        feedback = self.feedback()
        if feedback:
            return feedback.get("attachments", [])
        return [self.project.relative(path) for path in images_in(self.directory / "attachments")]

    def view(self):
        feedback = self.feedback()
        made = {output: call for call in read_lines(self.directory / "calls.jsonl") for output in call.get("outputs", [])}
        chosen = set((feedback or {}).get("picked", []))
        notes = (feedback or {}).get("notes", {})
        here = self.project.relative(self.directory)
        return {
            "round": self.number,
            "note": self.record.get("note", ""),
            "time": self.record.get("time"),
            "spec": self.record.get("spec"),
            "brief": self.record.get("brief"),
            "proposals": self.record.get("proposals", []),
            "nodes": self.record.get("nodes", []),
            "candidates": [{
                "number": number,
                "path": path,
                "description": self.record.get("descriptions", {}).get(path),
                "model": made.get(Path(path).relative_to(here).as_posix(), {}).get("model") if path.startswith(here + "/") else None,
                "picked": path in chosen,
                "note": notes.get(path)
            } for number, path in enumerate(self.record["candidates"], 1)],
            "attachments": self.attachments(),
            "feedback": feedback
        }

    def submit(self, picked, notes, comment, decision, surface):
        if self.feedback() is not None:
            raise RecordError(f"round {self.number} is already answered")
        if decision not in DECISIONS[self.thread.kind]:
            raise RecordError(f"a {self.thread.kind} thread cannot be answered with {decision}")
        if decision == "generate" and not self.thread.brief():
            raise RecordError("there is no written brief to draw from yet")
        candidates = self.record["candidates"]

        def path_of(number):
            if not 1 <= number <= len(candidates):
                raise RecordError(f"round {self.number} has no candidate {number}")
            return candidates[number - 1]

        feedback = {
            "round": self.number,
            "decision": decision,
            "picked": [path_of(number) for number in sorted(set(picked))],
            "notes": {path_of(number): text.strip() for number, text in sorted(notes.items()) if text.strip()},
            "comment": comment.strip(),
            "attachments": self.attachments(),
            "surface": surface,
            "time": timestamp()
        }
        # The answer is claimed first, so a second answer to the same round fails before it can make a node.
        write_once(self.directory / "feedback.json", feedback)
        if decision == "generate":
            # The brief comes down to the canvas as a generation node; the thread keeps going beside it.
            brief = self.thread.brief()
            heading = next((line for line in brief.splitlines() if line.strip()), "").lstrip("# ").strip()
            node = Node.create(self.project, "generation", f"{heading}\n\n{brief}".strip() if heading else brief, self.thread.record["style"], thread=self.thread.id, surface=surface)
            feedback["node"] = node.id
            write_json(self.directory / "feedback.json", feedback)
        return feedback

    def attach(self, name, content):
        folder = self.open_attachments()
        folder.mkdir(exist_ok=True)
        target = folder / workspace.upload_name(name)
        target.write_bytes(content)
        return self.project.relative(target)

    def detach(self, path):
        target = self.project.resolve(path)
        if target.parent != self.open_attachments().resolve() or not target.is_file():
            raise RecordError("no such attachment")
        target.unlink()

    def open_attachments(self):
        """Attachments go with the answer being written, so only an open round takes them."""
        if self.feedback() is not None:
            raise RecordError("there is no answer being written to attach to")
        return self.directory / "attachments"


def open_project_thread(project, message="", attachments=(), surface="chat"):
    """A conversation about the project's brief: writing it when there is none, changing it otherwise."""
    thread = Thread.open(project, "project", PROJECT_QUESTION if project.brief().strip() else NEW_PROJECT_QUESTION)
    if message.strip() or attachments:
        answer_first(thread, message, attachments, surface)
    return thread


def open_style_thread(style, first=False, message="", attachments=(), surface="chat"):
    """A conversation about a style: making it when it is new, improving it otherwise. A message is the user's
    first words, and answers the opening round at once so the agent sees it."""
    question = (GUIDE_QUESTION if style.guide() else NEW_STYLE_QUESTION) if first else STYLE_QUESTION.format(style=style.name)
    thread = Thread.open(style.project, "style", question, style)
    if message.strip() or attachments:
        answer_first(thread, message, attachments, surface)
    return thread


def open_ideation(style, message="", attachments=(), surface="chat"):
    thread = Thread.open(style.project, "ideation", IDEATION_QUESTION, style)
    if message.strip() or attachments:
        answer_first(thread, message, attachments, surface)
    return thread


def answer_first(thread, message, attachments, surface):
    opening = thread.latest()
    for name, content in attachments:
        opening.attach(name, content)
    opening.submit([], {}, message, None, surface)


def main():
    arguments = parse_arguments()
    workspace.enter()
    try:
        if arguments.command == "open":
            from style import Style
            if arguments.kind == "project":
                thread = open_project_thread(Project.at(arguments.target), arguments.message)
            else:
                style = Style.at(arguments.target)
                thread = open_style_thread(style, message=arguments.message) if arguments.kind == "style" else open_ideation(style, arguments.message)
            print(workspace.relative(thread.directory))
            return
        if arguments.command == "publish":
            directory = workspace.resolve(arguments.directory)
            thread = Thread.at(workspace.relative(directory.parent))
            thread.publish(directory, arguments.note, arguments.files or None, arguments.describe, arguments.proposal, arguments.node)
            # The agent's publish, unlike the opening question a surface writes, says an agent is at work.
            workspace.heartbeat()
            return
        thread = Thread.at(arguments.thread)
        if arguments.command == "next":
            print(workspace.relative(thread.next_round()))
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
                decision=arguments.decision,
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
    opening.add_argument("target", help="projects/<project> for a project thread, projects/<project>/styles/<style> otherwise")
    opening.add_argument("kind", choices=sorted(KINDS))
    opening.add_argument("--message", default="", help="the user's first words")
    for command in ("next", "show", "delete"):
        commands.add_parser(command).add_argument("thread", help="projects/<project>/threads/<id>")
    renaming = commands.add_parser("rename")
    renaming.add_argument("thread")
    renaming.add_argument("name")
    publishing = commands.add_parser("publish")
    publishing.add_argument("directory", help="the round directory printed by next")
    publishing.add_argument("--note", default="", help="the agent's message, in the user's language")
    publishing.add_argument("--describe", action="append", default=[], help="one plain line per image, in order: the reading a candidate tests")
    publishing.add_argument("--proposal", action="append", default=[], help="a proposal the message points to, repeatable")
    publishing.add_argument("--node", action="append", default=[], help="a node the message points to, repeatable")
    publishing.add_argument("files", nargs="*", help="candidates in display order; defaults to every image drawn into the round")
    answering = commands.add_parser("answer")
    answering.add_argument("thread")
    answering.add_argument("--picked", default="", help="candidate numbers, comma separated")
    answering.add_argument("--note", action="append", default=[], help="number=text, a note on a candidate, picked or not, repeatable")
    answering.add_argument("--comment", default="", help="the user's reply")
    answering.add_argument("--decision", choices=["generate"], help="ideation: draw the brief as a generation node")
    return parser.parse_args()


def parse_note(text):
    number, separator, note = text.partition("=")
    if not separator or not number.strip().isdigit():
        raise RecordError(f"a note is number=text, got {text}")
    return int(number), note


if __name__ == "__main__":
    main()
