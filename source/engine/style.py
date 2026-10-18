#!/usr/bin/env python3
"""A style folder and the records it keeps.

The workspace (see workspace.py) holds styles/ and sessions/:

  styles/<name>/        the style and its records
    style.md            the style in words, independent of any model; fixed once the style is confirmed
    references/         the images attached to every generation, curated by the user
    prompting/<model>.md how the style is written as a prompt for one model; one file per model the style has
    model               the model images are made with now, one of those
    based-on            the confirmed style this one was made from
    archive/            every image made with the style and every image that became a reference, with index.jsonl
    ledger.jsonl        every generation, answer, confirm, and change to references or models
  sessions/<name>/      the style's sessions, one folder each (see session.py)

Paths written into records are relative to the workspace ("sessions/app-icon/20261011-230012/003/x.jpg"),
except inside archive/index.jsonl, whose files belong to the style ("archive/001.jpg").

Commands, for changes the user asks for in conversation:
  rename <style> <name>                 rename a style and rewrite the records that name it
  delete <style>                        delete a style and its sessions
  reference-add <style> <image>         add an image to the references
  reference-remove <style> <file>       take a reference out, by its file name in references/
  use <style> <model>                   make one of the style's models the one images are made with
  model-remove <style> <model>          take a model and its prompting file off the style
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path

import workspace

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
STYLE_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{1,40}$")


class StyleError(Exception):
    pass


class Style:
    def __init__(self, path):
        self.path = Path(path).resolve()
        self.name = self.path.name
        self.workspace = self.path.parent.parent

    @classmethod
    def named(cls, styles, name):
        if not STYLE_NAME.match(name or ""):
            raise StyleError("a style name is lowercase letters, digits, and hyphens")
        return cls(Path(styles) / name)

    # Locations

    @property
    def spec_file(self):
        return self.path / "style.md"

    @property
    def sessions(self):
        return self.workspace / "sessions" / self.name

    @property
    def reference_folder(self):
        return self.path / "references"

    def prompting_file(self, model):
        return self.path / "prompting" / (model.replace("/", "--") + ".md")

    def relative(self, path):
        return Path(os.path.relpath(Path(path).resolve(), self.workspace)).as_posix()

    def resolve(self, relative):
        return (self.workspace / relative).resolve()

    # What the style is

    def exists(self):
        return self.path.is_dir()

    def confirmed(self):
        return self.reference_folder.is_dir()

    def spec(self):
        return read_text(self.spec_file)

    def model(self):
        text = read_text(self.path / "model")
        return text.strip() if text else None

    def models(self):
        """Every model the style has a prompting file for."""
        folder = self.path / "prompting"
        return sorted(path.stem.replace("--", "/") for path in folder.glob("*.md")) if folder.is_dir() else []

    def prompting(self, model=None):
        model = model or self.model()
        return read_text(self.prompting_file(model)) if model else None

    def references(self):
        return [self.relative(path) for path in images_in(self.reference_folder)]

    def reference_digests(self):
        """What each reference is by content, so an archived or session copy is known as the same image."""
        return {digest(path): self.relative(path) for path in images_in(self.reference_folder)}

    def reference_records(self):
        """The current references as their archived copies, which never move or change, so a round can keep them."""
        archived = {digest(self.path / item["file"]): self.relative(self.path / item["file"]) for item in self.archived() if (self.path / item["file"]).is_file()}
        return [archived.get(digest(path), self.relative(path)) for path in images_in(self.reference_folder)]

    def based_on(self):
        text = read_text(self.path / "based-on")
        return text.strip() if text else None

    def purpose(self):
        """The first sentence of style.md under its title, which says what the style is for."""
        return next((line for line in (self.spec() or "").splitlines() if line.strip() and not line.startswith(("#", "|", "-"))), "")

    # Changes the user makes to a confirmed style

    def use(self, model):
        if model not in self.models():
            raise StyleError(f"{self.name} has no prompting file for {model}; add the model first")
        (self.path / "model").write_text(model + "\n", encoding="utf-8")
        self.ledger().append({"time": timestamp(), "tag": "use", "model": model})

    def remove_model(self, model):
        """Take a model off the style. The model in use stays until another is chosen, so the style can always draw."""
        if model not in self.models():
            raise StyleError(f"{self.name} has no {model}")
        if model == self.model():
            raise StyleError(f"{model} is the model in use; choose another before removing it")
        self.prompting_file(model).unlink()
        self.ledger().append({"time": timestamp(), "tag": "model", "removed": model})

    def add_reference(self, path, made=None):
        """Copy an image into references/. An image that is already a reference is left as it is."""
        if not self.confirmed():
            raise StyleError(f"{self.name} is being made; its references come from the confirm round")
        source = Path(path).resolve()
        if source.suffix.lower() not in IMAGE_SUFFIXES or not source.is_file():
            raise StyleError("a reference is a png, jpg, or webp image")
        if digest(source) in self.reference_digests():
            return self.reference_digests()[digest(source)]
        # A removed reference's number is not given to another image, so a name always means one image.
        used = [int(file.stem) for file in images_in(self.reference_folder) if file.stem.isdigit()]
        used += [int(Path(entry["removed"]).stem) for entry in self.ledger().entries() if entry.get("tag") == "reference" and Path(entry.get("removed", "x")).stem.isdigit()]
        target = self.reference_folder / f"{max(used, default=0) + 1:02d}{source.suffix.lower()}"
        shutil.copy2(source, target)
        if not self.is_archived(source):
            made = made if made is not None else self.ledger().made(self.relative(source))
            self.archive(self.relative(source), made.get("tag") or "upload", made)
        self.ledger().append({"time": timestamp(), "tag": "reference", "added": self.relative(target), "from": self.relative(source)})
        return self.relative(target)

    def remove_reference(self, name):
        target = (self.reference_folder / name).resolve()
        if target.parent != self.reference_folder or not target.is_file():
            raise StyleError(f"{self.name} has no reference {name}")
        target.unlink()
        self.ledger().append({"time": timestamp(), "tag": "reference", "removed": name})

    def rename(self, name):
        """Rename the style and its sessions, and rewrite every record that names them."""
        target = Style.named(self.path.parent, name)
        if target.exists():
            raise StyleError(f"style {name} already exists")
        old = [f"styles/{self.name}/", f"sessions/{self.name}/"]
        new = [f"styles/{name}/", f"sessions/{name}/"]
        self.path.rename(target.path)
        if self.sessions.exists():
            self.sessions.rename(target.sessions)
        records = [target.path / "ledger.jsonl", *target.sessions.glob("**/*.json")] if target.sessions.exists() else [target.path / "ledger.jsonl"]
        for record in records:
            if record.exists():
                text = record.read_text(encoding="utf-8")
                for before, after in zip(old, new):
                    text = text.replace(before, after)
                record.write_text(text, encoding="utf-8")
        # The documents are titled with the style's name ("# app-icon", "# app-icon on Seedream 5.0 Flash").
        for document in [target.spec_file, *(target.path / "prompting").glob("*.md")]:
            if document.exists():
                lines = document.read_text(encoding="utf-8").split("\n")
                if lines and (lines[0] == f"# {self.name}" or lines[0].startswith(f"# {self.name} ")):
                    lines[0] = f"# {name}" + lines[0][len(f"# {self.name}"):]
                    document.write_text("\n".join(lines), encoding="utf-8")
        for other in target.path.parent.iterdir():
            if (other / "based-on").exists() and (other / "based-on").read_text().strip() == self.name:
                (other / "based-on").write_text(name + "\n", encoding="utf-8")
        return target

    def delete(self):
        shutil.rmtree(self.sessions, ignore_errors=True)
        shutil.rmtree(self.path)

    # Records

    def ledger(self):
        return Ledger(self)

    def archive(self, path, kind, made=None):
        """Copy an image into archive/ with what made it, so it outlives the session.
        kind is where the image came from: the kind of round it was drawn for, or upload."""
        folder = self.path / "archive"
        folder.mkdir(exist_ok=True)
        made = made if made is not None else self.ledger().made(path)
        # The agent publishing and the user pinning can archive at the same moment; each claims a number by creating its file.
        number = len(self.archived()) + 1
        while True:
            target = folder / f"{number:03d}{Path(path).suffix.lower()}"
            try:
                with open(target, "xb") as claimed:
                    claimed.write(self.resolve(path).read_bytes())
                break
            except FileExistsError:
                number += 1
        append_json(folder / "index.jsonl", {
            "file": Path(os.path.relpath(target, self.path)).as_posix(),
            "kind": kind,
            "request": made.get("request"),
            "prompt": made.get("prompt"),
            "model": made.get("model"),
            "cost": cost_of(made),
            "time": timestamp()
        })

    def archived(self):
        return read_lines(self.path / "archive" / "index.jsonl")

    def is_archived(self, path):
        found = digest(path)
        return any(digest(self.path / item["file"]) == found for item in self.archived() if (self.path / item["file"]).exists())


class Ledger:
    """Every generation, answer, confirm, and change of one style, oldest first."""

    def __init__(self, style):
        self.style = style
        self.path = style.path / "ledger.jsonl"

    def entries(self):
        return read_lines(self.path)

    def generations(self):
        return [entry for entry in self.entries() if entry.get("status") == "ok" and entry.get("outputs")]

    def made(self, path):
        return next((entry for entry in self.generations() if path in entry["outputs"]), {})

    def since(self, start):
        return [entry for entry in self.entries() if entry.get("time", "") >= start] if start else []

    def unit_cost(self, model):
        costs = [cost_of(entry) for entry in self.generations() if entry["model"] == model and entry.get("cost") is not None]
        return sum(costs) / len(costs) if costs else None

    def append(self, entry):
        if not self.style.path.is_dir():
            raise StyleError(f"{self.style.name} was renamed or deleted")
        append_json(self.path, entry)


def cost_of(made):
    """What one image of a generation cost: a call that returned several images splits its cost."""
    if made.get("cost") is None or not made.get("outputs"):
        return None
    return made["cost"] / len(made["outputs"])


_digests = {}


def digest(path):
    """An image's content hash, cached by path, size, and modification time, since pages ask for it on every poll."""
    path = Path(path)
    status = path.stat()
    key = (str(path.resolve()), status.st_size, status.st_mtime_ns)
    if key not in _digests:
        _digests[key] = hashlib.sha1(path.read_bytes()).hexdigest()
    return _digests[key]


def images_in(folder):
    folder = Path(folder)
    if not folder.is_dir():
        return []
    return sorted(path for path in folder.iterdir() if path.suffix.lower() in IMAGE_SUFFIXES)


def read_text(path):
    return path.read_text(encoding="utf-8") if path.exists() else None


def read_lines(path):
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def append_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(value, ensure_ascii=False) + "\n")


def write_json(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def timestamp():
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def main():
    arguments = parse_arguments()
    workspace.enter()
    style = Style(arguments.style)
    try:
        if not style.exists():
            raise StyleError(f"no style at {arguments.style}")
        if arguments.command == "rename":
            print(style.rename(arguments.name).path)
        elif arguments.command == "delete":
            style.delete()
        elif arguments.command == "reference-add":
            print(style.add_reference(arguments.image))
        elif arguments.command == "reference-remove":
            style.remove_reference(arguments.file)
        elif arguments.command == "use":
            style.use(arguments.model)
        elif arguments.command == "model-remove":
            style.remove_model(arguments.model)
    except StyleError as error:
        sys.exit(str(error))


def parse_arguments():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    renaming = commands.add_parser("rename")
    renaming.add_argument("style")
    renaming.add_argument("name")
    commands.add_parser("delete").add_argument("style")
    adding = commands.add_parser("reference-add")
    adding.add_argument("style")
    adding.add_argument("image")
    removing = commands.add_parser("reference-remove")
    removing.add_argument("style")
    removing.add_argument("file", help="the file name in references/, such as 03.jpg")
    for command in ("use", "model-remove"):
        using = commands.add_parser(command)
        using.add_argument("style")
        using.add_argument("model")
    return parser.parse_args()


if __name__ == "__main__":
    main()
