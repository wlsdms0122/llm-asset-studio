#!/usr/bin/env python3
"""A style: how every image made with it looks, kept as a source that keeps improving.

  projects/<project>/styles/<style>/
    style.md                the style in words, independent of any model, in sections (document/writing-styles.md)
    style.json              model: the model images are drawn with
    prompting/<model>.md    how the style is written as a prompt for one model
    references/<n>.<ext>    the material the user chose for the style: an image, with <n>.json beside it (its role, what
                            it shows, what a generation takes from it and what it leaves), or a text, <n>.md (a palette,
                            design tokens, a brand guide)
    references/set.json     the agent's check of the image references together: what they share besides the style
    revisions.jsonl         one line per revision: the hash of every file above, what changed, and why

The agent writes the words and the prompting; the user chooses the references and the model. Every change to the files
above makes a revision: the user's own changes at once, the agent's edits when it records them (`revise`), and anything
left unrecorded the moment a generation asks for the style. The contents of every revision are kept in the workspace's
objects/, so any revision can be drawn with, shown, or restored. A generation draws with a style at one revision.

Commands, for the agent and for changes the user asks for in conversation (a style is projects/<p>/styles/<s>):
  new <project> <name> [--from <style>]             create a style, empty or as a copy of another project's style
  revise <style> --summary S [--reason R] [--origin O]
                                                    record the agent's edits as a revision
  show <style> [--revision N]                       print style.md and the references
  materialize <style> <dir> [--revision N]          write every file of the style, references included, for reading
                                                    and attaching
  annotate <reference> --role R --shows S --take T --ignore I
                                                    write an image reference's annotation
  set-check <style> [--shared TEXT ...]             record what the image references share besides the style
  restore <style> <revision>                        make an earlier revision current again, as a new revision
  rename <style> <name> | delete <style>
  reference-add <style> <file> | reference-remove <style> <file>
  use <style> <model> | model-remove <style> <model>
"""

import argparse
import difflib
import fcntl
import json
import shutil
import sys
from pathlib import Path

import workspace
from project import Project
from workspace import IMAGE_SUFFIXES, TEXT_SUFFIXES, RecordError, digest, put_object, read_json, read_lines, read_object, read_text, timestamp, write_json

ROLES = {"style", "subject", "composition"}
UNTRACKED = {"revisions.jsonl", "references/set.json"}


class Style:
    def __init__(self, project, path):
        self.project = project
        self.path = Path(path).resolve()
        self.name = self.path.name

    @classmethod
    def named(cls, project, name):
        return cls(project, project.path / "styles" / workspace.require_name(name, "style"))

    @classmethod
    def at(cls, path):
        """The style a workspace path names: projects/<project>/styles/<style>, or anything inside it."""
        project = Project.at(path)
        parts = Path(project.relative(workspace.resolve(path))).parts
        if len(parts) < 2 or parts[0] != "styles":
            raise RecordError(f"{path} is not a style")
        style = cls(project, project.path / "styles" / parts[1])
        if not style.exists():
            raise RecordError(f"{project.name} has no style {parts[1]}")
        return style

    @classmethod
    def all(cls, project):
        folder = project.path / "styles"
        if not folder.is_dir():
            return []
        return [cls(project, path) for path in sorted(folder.iterdir()) if path.is_dir() and not path.name.startswith(".")]

    @classmethod
    def create(cls, project, name, source=None):
        """A new style in a project: empty, or a copy of a style in another project with where it came from."""
        style = cls.named(project, name)
        if style.exists():
            raise RecordError(f"{project.name} already has a style {style.name}")
        if source is not None and source.project.path == project.path:
            raise RecordError("a style is copied from another project")
        style.path.mkdir(parents=True)
        if source is None:
            (style.path / "style.md").write_text(f"# {style.name}\n", encoding="utf-8")
            write_json(style.config_file, {"model": None})
            return style
        number = source.revision()
        for path, name_of_object in source.revisions()[number - 1]["files"].items():
            target = style.path / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(read_object(name_of_object))
        retitle(style.path, source.name, style.name)
        style.revision(f"copied from {source.project.name}/{source.name} revision {number}", "copy")
        return style

    def exists(self):
        return self.path.is_dir()

    def relative(self, path):
        """A path inside the project, as the project's records write it."""
        return self.project.relative(path)

    # Files

    @property
    def spec_file(self):
        return self.path / "style.md"

    @property
    def config_file(self):
        return self.path / "style.json"

    @property
    def reference_folder(self):
        return self.path / "references"

    def prompting_file(self, model):
        return self.path / "prompting" / (model.replace("/", "--") + ".md")

    def config(self):
        return {"model": read_json(self.config_file, {}).get("model")}

    def spec(self):
        return read_text(self.spec_file) or ""

    def model(self):
        return self.config()["model"]

    def models(self):
        folder = self.path / "prompting"
        return sorted(path.stem.replace("--", "/") for path in folder.glob("*.md")) if folder.is_dir() else []

    def prompting(self, model=None):
        model = model or self.model()
        return read_text(self.prompting_file(model)) if model else None

    def references(self):
        """The references on disk, images and texts, in file order."""
        return self.snapshot().references()

    def set_check(self):
        return read_json(self.reference_folder / "set.json")

    def purpose(self):
        """The first sentence of style.md under its title, which says what the style is for."""
        return next((line for line in self.spec().splitlines() if line.strip() and not line.startswith(("#", "|", "-"))), "")

    def missing(self):
        return self.snapshot().missing()

    def blocked(self):
        return self.snapshot().blocked()

    # Revisions

    def tree(self):
        """Every tracked file and its content hash."""
        files = {}
        for path in sorted(self.path.rglob("*")):
            relative = path.relative_to(self.path).as_posix()
            if path.is_file() and not any(part.startswith(".") for part in path.relative_to(self.path).parts) and relative not in UNTRACKED:
                files[relative] = digest(path)
        return files

    def revisions(self):
        return read_lines(self.path / "revisions.jsonl")

    def revision(self, summary=None, source="auto", reason=None, origin=None):
        """The current revision's number, recorded first when the style changed since the last.
        reason: why, in the user's language; origin: where the reaction it answers was, a node ("n12") or a thread
        round ("t3/004")."""
        log = self.path / "revisions.jsonl"
        with log.open("a+", encoding="utf-8") as file:
            fcntl.flock(file, fcntl.LOCK_EX)
            # Each file is read once and stored under the hash of what was read, so the record names stored objects.
            files = {path: put_object((self.path / path).read_bytes()) for path in self.tree()}
            file.seek(0)
            entries = [json.loads(line) for line in file.read().splitlines() if line.strip()]
            last = entries[-1] if entries else None
            if last and last["files"] == files:
                return last["number"]
            entry = {"number": len(entries) + 1, "time": timestamp(), "summary": summary or describe_change(last, files), "source": source}
            if reason:
                entry["reason"] = reason
            if origin:
                entry["origin"] = origin
            entry["files"] = files
            file.write(json.dumps(entry, ensure_ascii=False) + "\n")
            return entry["number"]

    def snapshot(self, revision=None):
        """The style as it is on disk, or as it was at a revision."""
        if revision is None:
            return Snapshot(self)
        entries = self.revisions()
        if not 1 <= revision <= len(entries):
            raise RecordError(f"{self.name} has no revision {revision}")
        return Snapshot(self, entries[revision - 1]["files"], revision)

    def restore(self, number):
        entries = self.revisions()
        if not 1 <= number <= len(entries):
            raise RecordError(f"{self.name} has no revision {number}")
        files = entries[number - 1]["files"]
        for path in self.tree():
            if path not in files:
                (self.path / path).unlink()
        for path, name in files.items():
            target = self.path / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(read_object(name))
        return self.revision(f"restored revision {number}", "owner")

    def recorded(self):
        """The last revision's number when the style is as it recorded it, else None."""
        entries = self.revisions()
        if not entries or entries[-1]["files"] != self.tree():
            return None
        return entries[-1]["number"]

    # Changes the user makes

    def use(self, model):
        if model not in self.models():
            raise RecordError(f"{self.name} has no prompting file for {model}; add the model first")
        write_json(self.config_file, {**read_json(self.config_file, {}), "model": model})
        return self.revision(f"draws with {model}", "owner")

    def remove_model(self, model):
        """Take a model off the style. The model in use stays until another is chosen, so the style can always draw."""
        if model not in self.models():
            raise RecordError(f"{self.name} has no {model}")
        if model == self.model():
            raise RecordError(f"{model} is the model in use; choose another before removing it")
        self.prompting_file(model).unlink()
        return self.revision(f"removed {model}", "owner")

    def add_reference(self, source):
        path = add_reference_file(self.reference_folder, source)
        self.revision(f"added reference {path.name}", "owner")
        return self.relative(path)

    def remove_reference(self, name):
        remove_reference_file(self.reference_folder, name)
        return self.revision(f"removed reference {name}", "owner")

    def rename(self, name):
        """Rename the style, and rewrite every record of the project that names it."""
        target = Style.named(self.project, name)
        if target.exists():
            raise RecordError(f"{self.project.name} already has a style {target.name}")
        self.path.rename(target.path)
        retitle(target.path, self.name, target.name)
        for record in [*self.project.path.glob("nodes/*/*.json"), *self.project.path.glob("threads/*/thread.json"), *self.project.path.glob("threads/*/*/*.json")]:
            value = json.loads(record.read_text(encoding="utf-8"))
            if value.get("style") == self.name:
                value["style"] = target.name
            text = json.dumps(value, ensure_ascii=False, indent=2).replace(f'"styles/{self.name}/', f'"styles/{target.name}/')
            record.write_text(text, encoding="utf-8")
        target.revision(f"renamed from {self.name}", "owner")
        return target

    def delete(self):
        if any(node.style == self.name and node.result() is None for node in self.project.nodes()):
            raise RecordError(f"the agent has generations of {self.name} waiting; delete them or wait until they are drawn")
        for thread in self.project.threads():
            if thread.record.get("style") == self.name:
                thread.delete()
        shutil.rmtree(self.path)


class Snapshot:
    """A style's files, live on disk or as recorded at a revision."""

    def __init__(self, style, files=None, revision=None):
        self.style = style
        self.recorded = files
        self.revision = revision

    def files(self):
        return self.recorded if self.recorded is not None else self.style.tree()

    def read(self, path):
        if self.recorded is None:
            return (self.style.path / path).read_bytes()
        return read_object(self.recorded[path])

    def text(self, path):
        return self.read(path).decode("utf-8") if path in self.files() else None

    def config(self):
        return {"model": json.loads(self.text("style.json") or "{}").get("model")}

    def spec(self):
        return self.text("style.md") or ""

    def references(self):
        """Every reference: an image with its annotation, or a text with its words."""
        references = []
        for path in sorted(self.files()):
            if not is_reference(path):
                continue
            suffix = Path(path).suffix.lower()
            item = {
                "name": Path(path).name,
                # On disk a reference is its file; at a revision it is its object, which outlives the file.
                "path": self.style.relative(self.style.path / path) if self.recorded is None else None,
                "object": self.files()[path],
                "kind": "image" if suffix in IMAGE_SUFFIXES else "text"
            }
            if item["kind"] == "image":
                item["annotation"] = json.loads(self.text(path[: -len(suffix)] + ".json") or "null")
            else:
                item["text"] = self.text(path)
            references.append(item)
        return references

    def changes_since(self, before):
        """What changed in the style's words since an earlier snapshot (None for the first): a diff per text file."""
        earlier = before.files() if before else {}
        changed = sorted(path for path in set(self.files()) | set(earlier) if path.endswith(".md") and earlier.get(path) != self.files().get(path))
        return [{"path": path, "diff": diff(before.text(path) if before else None, self.text(path), path)} for path in changed]

    def missing(self):
        """What the style lacks to draw: model or prompting; None when it can."""
        model = self.config()["model"]
        if not model:
            return "model"
        if "prompting/" + model.replace("/", "--") + ".md" not in self.files():
            return "prompting"
        return None

    def blocked(self):
        """Why the style cannot draw, in words, or None when it can."""
        name = self.style.name if self.revision is None else f"{self.style.name} at revision {self.revision}"
        return {
            None: None,
            "model": f"{name} has no model yet",
            "prompting": f"{name} has no prompting file for {self.config()['model']}"
        }[self.missing()]

    def materialize(self, directory):
        """Write every file of the style as it is here, for the agent to read and to attach references from."""
        directory = Path(directory)
        if directory.exists() and any(directory.iterdir()):
            raise RecordError(f"{directory} is not empty")
        for path in self.files():
            (directory / path).parent.mkdir(parents=True, exist_ok=True)
            (directory / path).write_bytes(self.read(path))
        return directory


def describe_change(last, files):
    if last is None:
        return "first revision"
    before = last["files"]
    parts = [f"{path} added" for path in files if path not in before]
    parts += [f"{path} changed" for path in files if path in before and before[path] != files[path]]
    parts += [f"{path} removed" for path in before if path not in files]
    return ", ".join(parts)


def diff(before, after, path):
    """A unified diff of one text file, for the page and the conversation."""
    return "".join(difflib.unified_diff((before or "").splitlines(keepends=True), (after or "").splitlines(keepends=True), f"a/{path}", f"b/{path}"))


def retitle(folder, old, new):
    """The documents of a style are titled with its name ("# app-icon", "# app-icon on Seedream 5.0 Flash")."""
    for document in [folder / "style.md", *(folder / "prompting").glob("*.md")]:
        if document.exists():
            lines = document.read_text(encoding="utf-8").split("\n")
            if lines and (lines[0] == f"# {old}" or lines[0].startswith(f"# {old} ")):
                lines[0] = f"# {new}" + lines[0][len(f"# {old}"):]
                document.write_text("\n".join(lines), encoding="utf-8")


# References

def is_reference(path):
    """A reference file of a style, as a path inside it: references/<n> with an image suffix, or .md for a text."""
    path = Path(path)
    return len(path.parts) == 2 and path.parts[0] == "references" and not path.name.startswith(".") and (path.suffix.lower() in IMAGE_SUFFIXES or path.suffix == ".md")


def reference_files(folder):
    folder = Path(folder)
    return sorted(path for path in folder.iterdir() if path.is_file() and is_reference(Path("references") / path.name)) if folder.is_dir() else []


def annotation(path):
    return read_json(Path(path).with_suffix(".json"))


def annotate(path, role, shows, take, ignore):
    path = workspace.resolve(path)
    if not path.is_file() or path.suffix.lower() not in IMAGE_SUFFIXES or path.parent.name != "references":
        raise RecordError(f"{workspace.relative(path)} is not an image reference")
    if role not in ROLES:
        raise RecordError(f"a reference's role is one of {', '.join(sorted(ROLES))}")
    write_json(path.with_suffix(".json"), {"role": role, "shows": shows.strip(), "take": take.strip(), "ignore": ignore.strip()})
    return path


def add_reference_file(folder, source):
    """Copy an image or a text into a reference folder under the next number; a text is kept as .md. A file already
    there is left as it is, and a number once given is never given to another file, so a name always means one file."""
    source = Path(source).resolve()
    suffix = source.suffix.lower()
    if not source.is_file() or suffix not in IMAGE_SUFFIXES | TEXT_SUFFIXES:
        raise RecordError("a reference is a png, jpg, or webp image, or a md or txt text")
    if suffix in TEXT_SUFFIXES:
        try:
            source.read_bytes().decode("utf-8")
        except UnicodeDecodeError:
            raise RecordError("a text reference is UTF-8 text")
        suffix = ".md"
    folder.mkdir(parents=True, exist_ok=True)
    found = digest(source)
    for path in reference_files(folder):
        if digest(path) == found:
            return path
    last = folder / ".last"
    used = [int(path.stem) for path in reference_files(folder) if path.stem.isdigit()]
    number = max([int(read_text(last) or 0), *used]) + 1
    content = source.read_bytes()
    while True:
        target = folder / f"{number:02d}{suffix}"
        try:
            with open(target, "xb") as file:
                file.write(content)
            break
        except FileExistsError:
            number += 1
    last.write_text(str(max(number, int(read_text(last) or 0))))
    return target


def remove_reference_file(folder, name):
    target = (folder / name).resolve()
    if target.parent != folder.resolve() or not target.is_file() or not is_reference(Path("references") / target.name):
        raise RecordError(f"no reference {name}")
    target.unlink()
    if target.suffix.lower() in IMAGE_SUFFIXES:
        target.with_suffix(".json").unlink(missing_ok=True)


def main():
    arguments = parse_arguments()
    workspace.enter()
    try:
        if arguments.command == "new":
            project = Project.at(arguments.project if "/" in arguments.project else f"projects/{arguments.project}")
            source = Style.at(getattr(arguments, "from")) if getattr(arguments, "from") else None
            from thread import open_style_thread
            style = Style.create(project, arguments.name, source)
            thread = open_style_thread(style, first=source is None)
            print(workspace.relative(style.path))
            print(workspace.relative(thread.directory))
            return
        if arguments.command == "annotate":
            path = annotate(arguments.reference, arguments.role, arguments.shows, arguments.take, arguments.ignore)
            Style.at(arguments.reference).revision(f"annotated {path.name}", "agent")
            print(workspace.relative(path))
            return
        style = Style.at(arguments.style)
        if arguments.command == "revise":
            print(style.revision(arguments.summary, "agent", arguments.reason, arguments.origin))
        elif arguments.command == "show":
            snapshot = style.snapshot(arguments.revision)
            print(snapshot.spec())
            for item in snapshot.references():
                about = (item["annotation"] or {}).get("shows", "(no annotation)") if item["kind"] == "image" else next((line for line in item["text"].splitlines() if line.strip()), "")
                print(f"{item['kind']}  {item['path'] or 'objects/' + item['object']}  {about}")
        elif arguments.command == "materialize":
            print(style.snapshot(arguments.revision).materialize(Path(arguments.directory)))
        elif arguments.command == "set-check":
            images = [item for item in style.references() if item["kind"] == "image"]
            write_json(style.reference_folder / "set.json", {"references": {item["path"]: item["object"] for item in images}, "shared": arguments.shared, "time": timestamp()})
        elif arguments.command == "restore":
            print(style.restore(arguments.revision))
        elif arguments.command == "rename":
            print(workspace.relative(style.rename(arguments.name).path))
        elif arguments.command == "delete":
            style.delete()
        elif arguments.command == "reference-add":
            print(style.add_reference(Path(arguments.file)))
        elif arguments.command == "reference-remove":
            style.remove_reference(arguments.file)
        elif arguments.command == "use":
            style.use(arguments.model)
        elif arguments.command == "model-remove":
            style.remove_model(arguments.model)
    except RecordError as error:
        sys.exit(str(error))


def parse_arguments():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    creating = commands.add_parser("new")
    creating.add_argument("project")
    creating.add_argument("name")
    creating.add_argument("--from", help="a style of another project to copy, projects/<p>/styles/<s>")
    revising = commands.add_parser("revise")
    revising.add_argument("style")
    revising.add_argument("--summary", required=True, help="what changed, in a line, in the user's language")
    revising.add_argument("--reason", help="why, in the user's language: the reaction it answers and why it belongs in the style")
    revising.add_argument("--origin", help="where that reaction was: a node (n12) or a thread round (t3/004)")
    for command in ("show", "materialize"):
        showing = commands.add_parser(command)
        showing.add_argument("style")
        if command == "materialize":
            showing.add_argument("directory")
        showing.add_argument("--revision", type=int, help="a revision instead of the files on disk")
    annotating = commands.add_parser("annotate")
    annotating.add_argument("reference", help="the reference image, such as projects/deckit/styles/app-icon/references/01.png")
    annotating.add_argument("--role", required=True, choices=sorted(ROLES))
    annotating.add_argument("--shows", required=True, help="what the image shows, subject and colors included")
    annotating.add_argument("--take", required=True, help="what a generation takes from it")
    annotating.add_argument("--ignore", required=True, help="what a generation leaves: its subject, colors, layout")
    checking = commands.add_parser("set-check")
    checking.add_argument("style")
    checking.add_argument("--shared", action="append", default=[], help="one thing every image reference shares besides the style, repeatable; none when the set is varied")
    restoring = commands.add_parser("restore")
    restoring.add_argument("style")
    restoring.add_argument("revision", type=int)
    renaming = commands.add_parser("rename")
    renaming.add_argument("style")
    renaming.add_argument("name")
    commands.add_parser("delete").add_argument("style")
    adding = commands.add_parser("reference-add")
    adding.add_argument("style")
    adding.add_argument("file", help="an image, or a text file (.md, .txt)")
    removing = commands.add_parser("reference-remove")
    removing.add_argument("style")
    removing.add_argument("file", help="the file name in references/, such as 03.jpg or 04.md")
    for command in ("use", "model-remove"):
        using = commands.add_parser(command)
        using.add_argument("style")
        using.add_argument("model")
    return parser.parse_args()


if __name__ == "__main__":
    main()
