#!/usr/bin/env python3
"""A style's sessions: the rounds shown to the user and the user's answers.

A session is one conversation with the user about a style. A round is one thing shown to the user
and the user's answer to it. Every surface reads and writes through this file, so an answer given on
the web page and one given in conversation leave the same records, in the session's folder
(sessions/<style>/<session id>/):

  session.json          kind, when it started, and for a model session the model being added
  prompting.md          a model session's prompting file until the model is added
  brief.md              a generate session's brief: the image the agent and the user settled on in ideation
  NNN/round.json        written once by the agent: kind, candidates in display order, note
  NNN/feedback.json     written once by a surface: the user's answer
  NNN/attachments/      images the user attaches to the answer while the round is open

Three kinds of session:
  make      the one session that makes a style; it ends when the user confirms. Until then style.md
            is rewritten freely; after that it never changes, and a different look is a new style.
  generate  making images with a confirmed style. A style keeps as many as the user opens, each a
            thread the user can come back to, until the user deletes it. It opens on the board, or in
            ideation when the user does not yet know what to make: discover rounds where the agent, as
            the designer, works out the image with the user and writes brief.md, the way a make
            session's discover rounds find the style and write style.md. Either way the session can
            move between the two.
  model     adding a model to a confirmed style: the agent writes the model's prompting file and the
            user tries it, one image per request, with the references attached. On "done" the
            agent runs `add-model`, the file joins prompting/, and the session ends.

Kinds of round, by session:
  discover  (make, generate) the conversation. The agent describes the style back, or in a generate
            session (ideation) proposes and develops the image, and may show candidate images; the user replies, attaches images,
            picks, and notes. "sample" moves on once style.md exists; in a generate session "generate"
            moves on once brief.md exists, and candidates drawn with one of the style's models are archived.
  sample    (make) style.md tried on the user's requests, one image per request, with no references.
            "request" asks for another, "discover" goes back, "confirm" moves on.
  confirm   (make) the sample images, and any the agent adds, offered as references. The user picks
            and answers "done", or "sample" to go back. The agent then runs `confirm`.
  generate  (generate) "refine" builds on the picked attempt, "new" starts a new image, "discover"
            goes to ideation. Every image shown is archived.
  model     (model) "request" asks for another image, "done" adds the model. Every image shown is archived.
Publishing a round of a carrying kind carries over the images of the last round of the same kind in
that session. Boards read in the order images were drawn, the newest last; a confirm round shows the
images the agent adds first, also carries every sample image, and starts with the user's earlier
picks still picked.

Commands:
  new <name> [--from <style>]           create a style, from a confirmed one if given, with its make session
  open <style> generate|model [--model M] [--ideation]
                                         open a session on a confirmed style and print its folder
  next <session>                         print the directory for the session's next round, creating it
  publish <round dir> --kind K [files]   write round.json; candidates default to the images in the directory
  show <session>                         print the session's latest round as the surfaces see it
  answer <session> ...                   record an answer given in conversation
  confirm <session>                      turn the user's picks into references/ and end the make session
  add-model <session>                    add the model a finished model session tried, and end it
  delete <session>                       delete a session
"""

import argparse
import json
import random
import secrets
import shutil
import sys
import time
from pathlib import Path

import workspace
from capability import reference_limit
from style import Style, StyleError, cost_of, images_in, read_text, timestamp, write_json

# The kinds of round each kind of session holds.
ROUNDS = {
    "make": {"discover", "sample", "confirm"},
    "generate": {"discover", "generate"},
    "model": {"model"}
}

# The decisions each kind of round accepts. None is a reply that keeps the stage going; a stage
# name moves forward to it or back to it, among the stages of that session.
DECISIONS = {
    "discover": {None, "sample", "generate"},
    "sample": {"request", "discover", "confirm"},
    "confirm": {None, "done", "sample"},
    "generate": {"refine", "new", "discover"},
    "model": {"request", "done"}
}

# Kinds whose images stay on screen from one round to the next.
CARRYING = {"sample", "confirm", "generate", "model"}

# Kinds shown as a board of images in the order they were drawn, the newest last.
BOARDS = {"sample", "generate", "model"}

# What the user reads first. The rounds keep it, since a round records what was shown.
NEW_STYLE_QUESTION = "어떤 스타일을 만들까요? 어디에 쓸 그림인지, 떠오르는 느낌을 편하게 적어 주세요. 비슷한 느낌의 이미지가 있으면 함께 올려 주세요."
BASE_QUESTION = "{base} 를 바탕으로 새 스타일을 만듭니다. 바꾸고 싶은 점을 적어 주세요. 작은 수정도, 방향을 바꾸는 것도 괜찮아요."
GENERATE_QUESTION = "무엇을 만들까요?"
IDEATION_QUESTION = "어떤 이미지가 필요하세요? 어디에 쓸지, 누가 보는지, 떠오르는 것을 편하게 적어 주세요. 참고할 이미지가 있으면 함께 올려 주세요."


class Session:
    def __init__(self, style, directory):
        self.style = style
        self.directory = Path(directory)
        self.id = self.directory.name
        self.record = json.loads((self.directory / "session.json").read_text(encoding="utf-8"))
        self.kind = self.record["kind"]

    @classmethod
    def open(cls, style, kind, model=None):
        if kind not in ROUNDS:
            raise StyleError(f"unknown kind of session {kind}")
        if kind == "make" and (style.confirmed() or cls.making(style)):
            raise StyleError(f"{style.name} already has its make session or is confirmed")
        if kind != "make" and not style.confirmed():
            raise StyleError(f"{style.name} is not confirmed yet")
        if kind == "model" and not model:
            raise StyleError("a model session needs a model")
        if kind == "model" and model in style.models():
            raise StyleError(f"{style.name} already has {model}")
        if kind == "model" and any(session.kind == "model" and session.record.get("model") == model for session in cls.all(style)):
            raise StyleError(f"{model} is already being added to {style.name}")
        if kind == "model":
            check_references(model, len(style.references()))
        # The random tail keeps a deleted session's id from coming back, so ledger entries by id stay one session's.
        while True:
            directory = style.sessions / f"{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(2)}"
            try:
                directory.mkdir(parents=True)
                break
            except FileExistsError:
                continue
        record = {"kind": kind, "started": timestamp()}
        if kind == "model":
            record["model"] = model
        write_json(directory / "session.json", record)
        return cls(style, directory)

    @classmethod
    def at(cls, path):
        """The session in a folder sessions/<style>/<id>, next to styles/<style>."""
        directory = Path(path).resolve()
        style = Style(directory.parent.parent.parent / "styles" / directory.parent.name)
        if directory.parent.parent.name != "sessions" or not (directory / "session.json").exists() or not style.exists():
            raise StyleError(f"{path} is not a session of a style")
        return cls(style, directory)

    @classmethod
    def all(cls, style):
        if not style.sessions.exists():
            return []
        return [cls(style, path) for path in sorted(style.sessions.iterdir()) if (path / "session.json").exists()]

    @classmethod
    def making(cls, style):
        return next((session for session in cls.all(style) if session.kind == "make"), None)

    @property
    def started(self):
        return self.record["started"]

    @property
    def model(self):
        """The model this session draws with: the one being added, or the style's."""
        return self.record.get("model") or self.style.model()

    @property
    def brief_file(self):
        return self.directory / "brief.md"

    def brief(self):
        return read_text(self.brief_file) if self.kind == "generate" else None

    @property
    def prompting_file(self):
        if self.kind == "model":
            return self.directory / "prompting.md"
        return self.style.prompting_file(self.model) if self.model else None

    def prompting(self):
        return read_text(self.prompting_file) if self.prompting_file else None

    def rounds(self):
        return sorted(path for path in self.directory.iterdir() if path.is_dir() and path.name.isdigit())

    def latest(self):
        published = [path for path in self.rounds() if (path / "round.json").exists()]
        return Round(self, published[-1]) if published else None

    def last_of(self, kind):
        for directory in reversed(self.rounds()):
            if (directory / "round.json").exists() and (earlier := Round(self, directory)).kind == kind:
                return earlier
        return None

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

    def title(self):
        """What the user calls the session: the model it adds, the image its brief names, or the first thing asked of it."""
        if self.kind == "model":
            return self.record["model"]
        heading = next((line for line in (self.brief() or "").splitlines() if line.strip()), "").lstrip("# ").strip()
        if heading:
            return heading
        for directory in self.rounds():
            feedback = read_text(directory / "feedback.json")
            if feedback and (request := json.loads(feedback).get("request")):
                return request
        return None

    def summary(self):
        latest = self.latest()
        answer = latest.feedback() if latest else None
        return {
            "id": self.id,
            "kind": self.kind,
            "title": self.title(),
            "model": self.record.get("model"),
            # A generate session that has talked is in ideation; one that has only drawn is making an image.
            "ideation": self.kind == "generate" and any(Round(self, path).kind == "discover" for path in self.rounds() if (path / "round.json").exists()),
            "started": self.started,
            "updated": (answer or {}).get("time") or (latest.record.get("time") if latest else self.started),
            # The user's turn when a round waits for an answer; the agent's when none is shown yet or the last is answered.
            "waiting": bool(latest and answer is None)
        }

    def answered_reviews(self):
        """The agent's verdict on every image whose round the user has answered; earlier ones stay hidden."""
        reviews = {}
        for directory in self.rounds():
            if (directory / "feedback.json").exists() and (directory / "round.json").exists():
                reviews.update(json.loads((directory / "round.json").read_text(encoding="utf-8")).get("reviews", {}))
        return reviews

    def delete(self):
        shutil.rmtree(self.directory)
        # A style with no session left keeps no empty sessions/<style> folder behind.
        try:
            self.directory.parent.rmdir()
        except OSError:
            pass


class Round:
    def __init__(self, session, directory):
        self.session = session
        self.style = session.style
        self.directory = Path(directory)
        self.number = int(self.directory.name)
        self.record = json.loads((self.directory / "round.json").read_text(encoding="utf-8"))
        self.kind = self.record["kind"]

    def feedback(self):
        path = self.directory / "feedback.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None

    def candidates(self):
        """Workspace-relative paths, in the order the user sees and numbers them."""
        paths = list(self.record["candidates"])
        if self.record.get("blind"):
            random.Random(self.number).shuffle(paths)
        return paths

    def attachments(self):
        """The images the user sent with the answer, or, while the round is open, the ones waiting to be sent."""
        feedback = self.feedback()
        if feedback:
            return feedback.get("attachments", [])
        return [self.style.relative(path) for path in images_in(self.directory / "attachments")]

    def view(self):
        ledger = self.style.ledger()
        made = {output: entry for entry in ledger.generations() for output in entry["outputs"]}
        return {
            "style": self.style.name,
            "session": self.session.id,
            "session_kind": self.session.kind,
            "round": self.number,
            "opened": self.record.get("time"),
            "kind": self.kind,
            "note": self.record.get("note", ""),
            "blind": self.record.get("blind", False),
            "candidates": self.shown(made),
            "model": None if self.record.get("blind") else self.record.get("model"),
            "spec": self.record.get("spec"),
            "brief": self.record.get("brief"),
            "prompting": self.record.get("prompting"),
            "references": self.record.get("references", []),
            "unit_cost": ledger.unit_cost(self.record.get("model") or self.session.model),
            "session_cost": sum(entry.get("cost") or 0 for entry in ledger.generations() if entry.get("session") == self.session.id),
            "thread": self.thread(made) if self.kind == "discover" else [],
            "attachments": self.attachments(),
            "feedback": self.feedback()
        }

    def shown(self, made):
        blind = self.record.get("blind", False)
        reviews = self.session.answered_reviews()
        here = self.style.relative(self.directory)
        feedback = self.feedback()
        chosen = set(feedback["picked"] if feedback else self.record.get("picked", []))
        notes = (feedback or {}).get("notes", {})
        return [
            {
                "number": number,
                "path": path,
                "name": None if blind else Path(path).name,
                "request": made.get(path, {}).get("request"),
                "prompt": made.get(path, {}).get("prompt"),
                "model": None if blind else made.get(path, {}).get("model"),
                "tool": None if blind else made.get(path, {}).get("tool"),
                "cost": None if blind else cost_of(made.get(path, {})),
                "description": self.record.get("descriptions", {}).get(path),
                "new": path.startswith(here + "/"),
                "picked": path in chosen,
                "note": notes.get(path),
                "review": reviews.get(path)
            }
            for number, path in enumerate(self.candidates(), 1)
        ]

    def thread(self, made):
        """The conversation so far: every discover round up to this one with the images it showed and the
        user's reply, and each visit to a later stage with what it drew."""
        talk = []
        for directory in self.session.rounds():
            if not (directory / "round.json").exists() or int(directory.name) > self.number:
                continue
            earlier = Round(self.session, directory)
            answer = earlier.feedback() or {}
            if earlier.kind != "discover" and answer.get("decision") == "discover":
                talk.append({
                    "round": earlier.number,
                    "kind": earlier.kind,
                    "message": earlier.record.get("note", ""),
                    "candidates": earlier.shown(made),
                    "reply": answer.get("comment"),
                    "attachments": earlier.attachments(),
                    "decision": "discover"
                })
            elif earlier.kind == "discover":
                talk.append({
                    "round": earlier.number,
                    "kind": "discover",
                    "message": earlier.record.get("note", ""),
                    "candidates": earlier.shown(made),
                    "reply": answer.get("comment"),
                    "attachments": earlier.attachments() if answer else [],
                    "decision": answer.get("decision")
                })
        return talk

    def submit(self, picked, notes, comment, request, decision, surface):
        if self.feedback() is not None:
            raise StyleError(f"round {self.number} is already answered")
        if decision not in DECISIONS[self.kind] or (decision in DECISIONS and decision not in ROUNDS[self.session.kind]):
            raise StyleError(f"{self.kind} round in a {self.session.kind} session cannot be answered with {decision}")
        request = request.strip()
        picked = sorted(set(picked))
        if decision in ("request", "refine", "new") and not request:
            raise StyleError(f"{decision} needs a request")
        if decision == "sample" and self.kind == "discover" and not self.record.get("spec"):
            raise StyleError("there is no written style to sample yet")
        if decision == "generate" and not self.record.get("brief"):
            raise StyleError("there is no written brief to draw from yet")
        if decision == "confirm" and not self.record["candidates"]:
            raise StyleError("nothing has been sampled yet")
        if decision == "done" and self.kind == "confirm" and not picked:
            raise StyleError("pick the images that become references")
        if decision == "done" and self.kind == "model" and not self.record["candidates"]:
            raise StyleError("nothing has been drawn with this model yet")
        if self.kind == "generate" and len(picked) > 1:
            raise StyleError("pick one attempt")
        if decision == "refine" and len(picked) != 1:
            raise StyleError("refining needs the attempt to build on")

        candidates = self.candidates()

        def path_of(number):
            if not 1 <= number <= len(candidates):
                raise StyleError(f"round {self.number} has no candidate {number}")
            return candidates[number - 1]

        feedback = {
            "round": self.number,
            "kind": self.kind,
            "decision": decision,
            "picked": [path_of(number) for number in picked],
            "notes": {path_of(number): text.strip() for number, text in sorted(notes.items()) if text.strip()},
            "comment": comment.strip(),
            "request": request,
            "attachments": self.attachments(),
            "surface": surface,
            "time": timestamp()
        }
        write_json(self.directory / "feedback.json", feedback)
        self.style.ledger().append({
            "time": feedback["time"],
            "tag": "feedback",
            "session": self.session.id,
            "round": self.number,
            "kind": self.kind,
            "decision": decision,
            "picked": feedback["picked"],
            "attachments": len(feedback["attachments"]),
            "shown": len(candidates),
            "surface": surface
        })

        return feedback


def check_references(model, count):
    """References go with every generation, so a model draws a style only if it takes that many; unknown limits pass."""
    limit = reference_limit(model)
    if limit is not None and count > limit:
        raise StyleError(f"{model} takes at most {limit} references; the style has {count}")


def publish(session, directory, kind, note, files=None, blind=False, fresh=False, descriptions=(), reviews=()):
    style = session.style
    if kind not in ROUNDS[session.kind]:
        raise StyleError(f"a {session.kind} session holds {', '.join(sorted(ROUNDS[session.kind]))} rounds, not {kind}")
    directory = Path(directory)
    if (directory / "round.json").exists():
        raise StyleError(f"{directory} is already published; a shown round is not rewritten")
    if session.kind == "make" and style.confirmed():
        raise StyleError(f"{style.name} is confirmed; make a new style from it to change it")

    # Without a list, the round shows what was generated into it, including --into subfolders.
    images = [Path(file) for file in files] if files is not None else round_images(directory)
    candidates = [style.relative(image) for image in images]
    if len(descriptions) not in (0, len(candidates)):
        raise StyleError(f"{len(descriptions)} descriptions for {len(candidates)} images")
    if len(reviews) not in (0, len(candidates)):
        raise StyleError(f"{len(reviews)} reviews for {len(candidates)} images")
    described = dict(zip(candidates, descriptions))
    new = list(candidates)

    # Going to another stage and back keeps the stage's images, so the last round of this kind counts,
    # not only the round right before. A confirm round also offers every sample image.
    sources = ([session.last_of("sample")] if kind == "confirm" else []) + [session.last_of(kind)]
    if kind in CARRYING and not fresh:
        for previous in filter(None, sources):
            carried = [path for path in previous.record["candidates"] if path not in candidates]
            # Boards read in the order images were drawn; a confirm round shows the images the agent adds first.
            candidates = carried + candidates if kind in BOARDS else candidates + carried
            described.update({path: text for path, text in previous.record.get("descriptions", {}).items() if path in carried})
    if kind == "confirm" and not candidates:
        raise StyleError("a confirm round needs sample images to offer")

    record = {"kind": kind, "note": note, "candidates": candidates, "blind": blind, "time": timestamp()}
    if described:
        record["descriptions"] = described
    # The agent's verdicts per image (document/review.md), kept from the user until they have answered.
    if reviews:
        record["reviews"] = dict(zip(new, reviews))
    # Picks made in an earlier confirm round stay picked, so asking for more never drops them.
    earlier = session.last_of("confirm") if kind == "confirm" else None
    kept = [path for path in ((earlier.feedback() or {}).get("picked", []) if earlier else []) if path in candidates]
    if kept:
        record["picked"] = kept

    # What the user saw is copied in, since style.md and prompting files change while they are written.
    spec = style.spec()
    if spec is None and kind != "discover":
        raise StyleError(f"{style.spec_file} is missing")
    if spec is not None:
        record["spec"] = spec
    if (brief := session.brief()) is not None:
        record["brief"] = brief
    if kind in BOARDS:
        # The model the new images were drawn with, from the ledger, even if the user switched models meanwhile.
        drawn = {style.ledger().made(path).get("model") for path in new} - {None}
        model = drawn.pop() if len(drawn) == 1 else session.model
        prompting = session.prompting() if session.kind == "model" else style.prompting(model)
        if prompting is None:
            raise StyleError(f"{session.prompting_file or 'a model and its prompting file'} is missing; write it before drawing")
        record["model"] = model
        record["prompting"] = prompting
    if kind in ("generate", "model"):
        record["references"] = style.reference_records()
    write_json(directory / "round.json", record)

    # Every image drawn with a confirmed style is kept. In a generate session's talk that is a candidate drawn
    # with one of the style's models; a rough from another model is a question, not the style.
    for path in new:
        if kind in ("generate", "model") or (session.kind == "generate" and style.ledger().made(path).get("model") in style.models()):
            style.archive(path, kind)


def start(session, kind, note, files=(), descriptions=()):
    """Open a round the agent has nothing to draw for yet: a new style's first question, or a generate board."""
    directory = session.next_round()
    publish(session, directory, kind, note, list(files), fresh=True, descriptions=descriptions)
    return Round(session, directory)


def round_images(directory):
    return images_in(directory) + [path for folder in sorted(Path(directory).iterdir()) if folder.is_dir() and folder.name != "attachments" for path in images_in(folder)]


def create_style(styles, name, base=None):
    """A new style, empty or starting from a confirmed one. A base gives its words, and its references
    open the conversation as images to react to. Its prompting files are not copied: they translate
    the base's words, and this style's words are about to change."""
    style = Style.named(styles, name)
    if style.exists():
        raise StyleError(f"style {name} already exists")
    source = Style.named(styles, base) if base is not None else None
    if source is not None and not (source.exists() and source.confirmed()):
        raise StyleError(f"{base} is not a confirmed style")

    style.path.mkdir(parents=True)
    session = Session.open(style, "make")
    if source is None:
        start(session, "discover", NEW_STYLE_QUESTION)
        return style

    shutil.copy2(source.spec_file, style.spec_file)
    (style.path / "based-on").write_text(base + "\n", encoding="utf-8")
    directory = session.next_round()
    shown = images_in(source.reference_folder)
    for path in shown:
        shutil.copy2(path, directory / f"{base}-{path.name}")
    copies = [directory / f"{base}-{path.name}" for path in shown]
    publish(session, directory, "discover", BASE_QUESTION.format(base=base), copies, fresh=True, descriptions=[f"{base} 레퍼런스"] * len(shown))
    return style


def open_session(style, kind, model=None, ideation=False):
    """A generate session opens on an empty board, or in ideation; a model session waits for the agent to write the prompting file."""
    if ideation and kind != "generate":
        raise StyleError("only a generate session opens in ideation")
    session = Session.open(style, kind, model)
    if kind == "generate":
        start(session, "discover" if ideation else "generate", IDEATION_QUESTION if ideation else GENERATE_QUESTION)
    return session


def confirm(session):
    """Make the user's picks from the answered confirm round the style's references, and end the make session."""
    style = session.style
    current = session.latest()
    answer = current.feedback() if current else None
    if session.kind != "make" or current is None or current.kind != "confirm" or not answer or answer["decision"] != "done":
        raise StyleError("the user has not finished a confirm round")
    model = style.model()
    if model is None or not style.prompting_file(model).exists():
        raise StyleError(f"{style.name} needs a model and its prompting file before it is confirmed")

    check_references(model, len(answer["picked"]))
    style.reference_folder.mkdir()
    ledger = style.ledger()
    for number, path in enumerate(answer["picked"], 1):
        shutil.copy2(style.resolve(path), style.reference_folder / f"{number:02d}{Path(path).suffix.lower()}")
        made = ledger.made(path)
        style.archive(path, made.get("tag") or "upload", made)
    session.delete()
    ledger.append({"time": timestamp(), "tag": "confirm", "references": len(answer["picked"]), "model": model})
    return style.reference_folder


def add_model(session):
    """Add the model a model session tried, once the user has answered done, and end the session."""
    style = session.style
    current = session.latest()
    answer = current.feedback() if current else None
    if session.kind != "model" or current is None or not answer or answer["decision"] != "done":
        raise StyleError("the user has not finished this model session")
    target = style.prompting_file(session.model)
    target.parent.mkdir(exist_ok=True)
    shutil.copy2(session.prompting_file, target)
    session.delete()
    style.ledger().append({"time": timestamp(), "tag": "model", "model": session.model})
    return target


def main():
    arguments = parse_arguments()
    workspace.enter()

    try:
        if arguments.command == "new":
            print(create_style(workspace.STYLES, arguments.name, getattr(arguments, "from")).path)
        elif arguments.command == "open":
            style = Style(arguments.style)
            if not style.exists():
                raise StyleError(f"no style at {arguments.style}")
            print(open_session(style, arguments.kind, arguments.model, arguments.ideation).directory)
        elif arguments.command == "publish":
            directory = Path(arguments.directory).resolve()
            if not directory.is_dir():
                raise StyleError(f"{arguments.directory} is not a round directory; use the one session.py next prints")
            publish(Session.at(directory.parent), directory, arguments.kind, arguments.note, arguments.files or None, arguments.blind, arguments.fresh, arguments.describe, arguments.review)
        else:
            session = Session.at(arguments.session)
            if arguments.command == "next":
                print(session.next_round())
            elif arguments.command == "show":
                current = session.latest()
                print(json.dumps(current.view() if current else None, ensure_ascii=False, indent=2))
            elif arguments.command == "answer":
                current = session.latest()
                if current is None:
                    raise StyleError("no round to answer")
                feedback = current.submit(
                    picked=[int(number) for number in arguments.picked.split(",") if number.strip()],
                    notes=dict(parse_note(note) for note in arguments.note),
                    comment=arguments.comment,
                    request=arguments.request,
                    decision=arguments.decision,
                    surface="chat"
                )
                print(json.dumps(feedback, ensure_ascii=False, indent=2))
            elif arguments.command == "confirm":
                print(confirm(session))
            elif arguments.command == "add-model":
                print(add_model(session))
            elif arguments.command == "delete":
                session.delete()
    except StyleError as error:
        sys.exit(str(error))


def parse_arguments():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)

    creating = commands.add_parser("new")
    creating.add_argument("name")
    creating.add_argument("--from", help="a confirmed style to start from")

    opening = commands.add_parser("open")
    opening.add_argument("style", help="the style directory, such as styles/app-icon")
    opening.add_argument("kind", choices=["generate", "model"])
    opening.add_argument("--model", help="model session: the OpenRouter model id to add")
    opening.add_argument("--ideation", action="store_true", help="generate session: open in ideation instead of on the board")

    for command in ("next", "show", "confirm", "add-model", "delete"):
        commands.add_parser(command).add_argument("session", help="the session folder, such as sessions/app-icon/20261011-230012")

    publishing = commands.add_parser("publish")
    publishing.add_argument("directory", help="the round directory printed by next")
    publishing.add_argument("--kind", required=True, choices=sorted(DECISIONS))
    publishing.add_argument("--note", default="", help="the agent's message: in discover, the style (in a generate session, the image) in plain words, what changed, and the questions")
    publishing.add_argument("--blind", action="store_true", help="shuffle and hide file and model names")
    publishing.add_argument("--describe", action="append", default=[], help="one plain line per image, in file order: the reading a candidate tests, or what the agent has to say about it")
    publishing.add_argument("--review", action="append", default=[], help="one verdict per new image, in file order, as document/review.md writes it; shown only after the user answers")
    publishing.add_argument("--fresh", action="store_true", help="start the board over instead of carrying earlier images")
    publishing.add_argument("files", nargs="*", help="candidates in display order")

    answering = commands.add_parser("answer")
    answering.add_argument("session")
    answering.add_argument("--picked", default="", help="numbers, comma separated: discover and confirm take any, generate one attempt")
    answering.add_argument("--note", action="append", default=[], help="number=text, a note on an image, picked or not, repeatable")
    answering.add_argument("--comment", default="", help="the user's reply")
    answering.add_argument("--request", default="", help="sample, generate, model: the user's words for the next image, as written")
    answering.add_argument("--decision", choices=sorted({d for kind in DECISIONS.values() for d in kind if d}), help="a stage to move to (sample, confirm, discover, generate), done, or what to do next on a board")

    return parser.parse_args()


def parse_note(text):
    number, separator, note = text.partition("=")
    if not separator or not number.strip().isdigit():
        raise StyleError(f"a note is number=text, got {text}")
    return int(number), note


if __name__ == "__main__":
    main()
