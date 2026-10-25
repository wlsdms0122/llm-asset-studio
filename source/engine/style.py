#!/usr/bin/env python3
"""A style: how every image made with it looks, kept as a source that keeps improving.

  projects/<project>/styles/<style>/
    style.md                the style in words, independent of any model, in sections (document/writing-styles.md)
    style.json              model: the model images are drawn with; extends: styles of the same project this one
                            builds on, in order; guide: true for a style that only lends its sections to others
    probes.md               the fixed test requests, one "- " line each, drawn to compare one revision with another
    prompting/<model>.md    how the style is written as a prompt for one model
    references/<n>.<ext>    the images the user chose, each with <n>.json: its role, what it shows, what a
                            generation takes from it and what it leaves
    references/set.json     the agent's check of the whole set: what the references share besides the style
    revisions.jsonl         one line per revision: the hash of every file above, and the revisions of the styles
                            it extends
    proposals/<id>/         changes waiting for the user (see proposal.py)
    runs/<n>/               probe runs (see probe.py)

Every change to the files above makes a revision: the user's own changes and an accepted proposal at once, the
agent's edits when it records them (`revise`), and anything left unrecorded the moment the style draws. The
contents of every revision are kept in the workspace's objects/, so any revision can be shown or restored.

A style that extends others is drawn as its effective style: the sections of every style it extends, in order,
then its own, a later section replacing an earlier one of the same name, except Never and Checks, which add up.
It draws with its own style references when it has any, else with the last of its bases that has them, and
always with the guide references of every guide in its chain. Its model and prompting files are its own.

Commands, for the agent and for changes the user asks for in conversation (a style is projects/<p>/styles/<s>):
  new <project> <name> [--guide] [--from <style>]   create a style, empty or as a copy of another project's style
  revise <style> --summary S                        record the agent's edits as a revision
  effective <style> [--revision N | --proposal ID]  print the effective style.md and the references it draws with
  materialize <style> <dir> [--revision N | --proposal ID]
                                                    write the effective style, its prompting files, and its references
  annotate <reference> --role R --shows S --take T --ignore I
                                                    write a style reference's annotation
  set-check <style> [--shared TEXT ...]             record what the style references share besides the style
  restore <style> <revision>                        make an earlier revision current again, as a new revision
  extends <style> [<base> ...]                      set the styles this one builds on
  rename <style> <name> | delete <style>
  reference-add <style> <image> | reference-remove <style> <file>
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
from workspace import RecordError, digest, images_in, put_object, read_json, read_lines, read_object, read_text, timestamp, write_json

ADDITIVE = {"never", "checks"}
ROLES = {"style", "subject", "composition", "guide"}
UNTRACKED = {"revisions.jsonl", "references/set.json"}
UNTRACKED_FOLDERS = {"proposals", "runs"}


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
    def create(cls, project, name, guide=False, source=None):
        """A new style in a project: empty, or a copy of a style in another project with where it came from."""
        style = cls.named(project, name)
        if style.exists():
            raise RecordError(f"{project.name} already has a style {style.name}")
        if source is not None and source.project.path == project.path:
            raise RecordError("a style in the same project is extended, not copied")
        style.path.mkdir(parents=True)
        if source is None:
            (style.path / "style.md").write_text(f"# {style.name}\n", encoding="utf-8")
            write_json(style.config_file, {"model": None, "extends": [], "guide": guide})
            return style
        number = source.revision()
        for path, name_of_object in source.revisions()[number - 1]["files"].items():
            target = style.path / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(read_object(name_of_object))
        config = style.config()
        write_json(style.config_file, {**config, "extends": [], "guide": guide or config["guide"]})
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
        config = read_json(self.config_file, {})
        return {"model": config.get("model"), "extends": config.get("extends", []), "guide": bool(config.get("guide"))}

    def write_config(self, **changes):
        write_json(self.config_file, {**self.config(), **changes})

    def spec(self):
        return read_text(self.spec_file) or ""

    def model(self):
        return self.config()["model"]

    def guide(self):
        return self.config()["guide"]

    def extends(self):
        return self.config()["extends"]

    def models(self):
        folder = self.path / "prompting"
        return sorted(path.stem.replace("--", "/") for path in folder.glob("*.md")) if folder.is_dir() else []

    def prompting(self, model=None):
        model = model or self.model()
        return read_text(self.prompting_file(model)) if model else None

    def probes(self):
        return parse_probes(read_text(self.path / "probes.md") or "")

    def references(self):
        """The style's own references with their annotations, in file order."""
        return [{"path": self.relative(path), "annotation": annotation(path)} for path in images_in(self.reference_folder)]

    def set_check(self):
        return read_json(self.reference_folder / "set.json")

    def purpose(self):
        """The first sentence of style.md under its title, which says what the style is for."""
        return next((line for line in self.spec().splitlines() if line.strip() and not line.startswith(("#", "|", "-"))), "")

    def bases(self):
        return [self.project.style(name) for name in self.extends()]

    def dependents(self):
        return [style for style in Style.all(self.project) if self.name in style.extends()]

    # Revisions

    def tree(self):
        """Every tracked file and its content hash."""
        files = {}
        for path in sorted(self.path.rglob("*")):
            relative = path.relative_to(self.path).as_posix()
            if path.is_file() and not any(part.startswith(".") for part in path.relative_to(self.path).parts) and relative not in UNTRACKED and path.relative_to(self.path).parts[0] not in UNTRACKED_FOLDERS:
                files[relative] = digest(path)
        return files

    def revisions(self):
        return read_lines(self.path / "revisions.jsonl")

    def revision(self, summary=None, source="auto"):
        """The current revision's number, recorded first when the style or a style it extends changed since the last."""
        parents = {base.name: base.revision() for base in self.bases()}
        log = self.path / "revisions.jsonl"
        with log.open("a+", encoding="utf-8") as file:
            fcntl.flock(file, fcntl.LOCK_EX)
            # Each file is read once and stored under the hash of what was read, so the record names stored objects.
            files = {path: put_object((self.path / path).read_bytes()) for path in self.tree()}
            file.seek(0)
            entries = [json.loads(line) for line in file.read().splitlines() if line.strip()]
            last = entries[-1] if entries else None
            if last and last["files"] == files and last["parents"] == parents:
                return last["number"]
            entry = {
                "number": len(entries) + 1,
                "time": timestamp(),
                "summary": summary or describe_change(last, files, parents),
                "source": source,
                "files": files,
                "parents": parents
            }
            file.write(json.dumps(entry, ensure_ascii=False) + "\n")
            return entry["number"]

    def snapshot(self, revision=None, changes=None):
        """The style as it is on disk, at a revision, or at a revision with a proposal's changes applied."""
        if revision is None and changes is None:
            return Snapshot(self)
        entries = self.revisions()
        if revision is not None and not 1 <= revision <= len(entries):
            raise RecordError(f"{self.name} has no revision {revision}")
        entry = entries[(revision or len(entries)) - 1]
        files = dict(entry["files"])
        for path, content in (changes or {}).items():
            if content is None:
                files.pop(path, None)
            else:
                files[path] = content
        # A proposal is tried against the bases as they are now; a revision keeps the bases it was made with.
        parents = None if changes is not None else entry["parents"]
        return Snapshot(self, files, parents)

    def restore(self, number):
        entries = self.revisions()
        if not 1 <= number <= len(entries):
            raise RecordError(f"{self.name} has no revision {number}")
        files = entries[number - 1]["files"]
        if "style.json" in files:
            self.check_extends(json.loads(read_object(files["style.json"])).get("extends", []))
        for path in self.tree():
            if path not in files:
                (self.path / path).unlink()
        for path, name in files.items():
            target = self.path / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(read_object(name))
        return self.revision(f"restored revision {number}", "owner")

    def missing(self):
        """What the style lacks to draw: guide (it never draws), model, prompting, or references; None when it can."""
        if self.guide():
            return "guide"
        if not self.model():
            return "model"
        if not self.prompting_file(self.model()).exists():
            return "prompting"
        if not any(item["role"] == "style" for item in self.snapshot().references()):
            return "references"
        return None

    def blocked(self):
        """Why the style cannot draw yet, in words, or None when it can."""
        return {
            None: None,
            "guide": f"{self.name} is a guide; it lends its sections to the styles that extend it and draws nothing itself",
            "model": f"{self.name} has no model yet",
            "prompting": f"{self.name} has no prompting file for {self.model()}",
            "references": f"{self.name} has no style references yet; pick some from its probe images"
        }[self.missing()]

    def recorded(self):
        """The last revision's number when the style and its bases are as it recorded them, else None."""
        entries = self.revisions()
        if not entries or entries[-1]["files"] != self.tree():
            return None
        if any(entries[-1]["parents"].get(base.name) != base.recorded() for base in self.bases()):
            return None
        return entries[-1]["number"]

    def stale_bases(self):
        """The bases that changed since this style's own files last changed, so its prompting files are behind them.
        A revision recorded only because a base changed does not clear it; the agent's next edit of the style does."""
        entries = self.revisions()
        own = None
        for earlier, entry in zip([None, *entries], entries):
            if earlier is None or earlier["files"] != entry["files"]:
                own = entry
        parents = own["parents"] if own else {}
        return [base.name for base in self.bases() if parents.get(base.name) is None or parents[base.name] != base.recorded()]

    # Changes the user makes

    def use(self, model):
        if model not in self.models():
            raise RecordError(f"{self.name} has no prompting file for {model}; add the model first")
        self.write_config(model=model)
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
        path = add_image(self.reference_folder, source)
        self.revision(f"added reference {path.name}", "owner")
        return self.relative(path)

    def remove_reference(self, name):
        remove_image(self.reference_folder, name)
        return self.revision(f"removed reference {name}", "owner")

    def check_extends(self, names):
        """Bases are styles of the project, and none of them extends this style, directly or through others."""
        for name in names:
            base = self.project.style(name)
            if base.name == self.name or self.name in [style.name for style in base.chain()]:
                raise RecordError(f"{self.name} cannot extend {name}: it would extend itself")

    def set_extends(self, names):
        names = list(dict.fromkeys(names))
        self.check_extends(names)
        self.write_config(extends=names)
        return self.revision(f"extends {', '.join(names) or 'nothing'}", "owner")

    def rename(self, name):
        """Rename the style, and rewrite every record of the project that names it."""
        target = Style.named(self.project, name)
        if target.exists():
            raise RecordError(f"{self.project.name} already has a style {target.name}")
        self.path.rename(target.path)
        retitle(target.path, self.name, target.name)
        for style in Style.all(self.project):
            if self.name in style.extends():
                style.write_config(extends=[target.name if base == self.name else base for base in style.extends()])
        for record in [*self.project.path.glob("nodes/*/*.json"), *self.project.path.glob("threads/*/thread.json"), *self.project.path.glob("threads/*/*/*.json")]:
            value = json.loads(record.read_text(encoding="utf-8"))
            if value.get("style") == self.name:
                value["style"] = target.name
            text = json.dumps(value, ensure_ascii=False, indent=2).replace(f'"styles/{self.name}/', f'"styles/{target.name}/')
            record.write_text(text, encoding="utf-8")
        target.revision(f"renamed from {self.name}", "owner")
        for style in Style.all(self.project):
            if target.name in style.extends():
                style.revision(f"{self.name} renamed to {target.name}", "owner")
        return target

    def delete(self):
        if any(node.style == self.name and node.kind == "generation" and node.result() is None for node in self.project.nodes()):
            raise RecordError(f"the agent has generations of {self.name} waiting; delete them or wait until they are drawn")
        if self.dependents():
            raise RecordError(f"{', '.join(style.name for style in self.dependents())} extend {self.name}; change them first")
        for thread in self.project.threads():
            if thread.record.get("style") == self.name:
                thread.delete()
        shutil.rmtree(self.path)

    def chain(self, seen=None):
        """This style after every style it extends, each once, bases first."""
        seen = seen if seen is not None else []
        for base in self.bases():
            if base.name not in [style.name for style in seen]:
                base.chain(seen)
        if self.name not in [style.name for style in seen]:
            seen.append(self)
        return seen


class Snapshot:
    """A style's files, live on disk or as recorded, and the effective style they make with their bases."""

    def __init__(self, style, files=None, parents=None):
        self.style = style
        self.recorded = files
        self.parents = parents

    def files(self):
        return self.recorded if self.recorded is not None else self.style.tree()

    def read(self, path):
        if self.recorded is None:
            return (self.style.path / path).read_bytes()
        return read_object(self.recorded[path])

    def text(self, path):
        return self.read(path).decode("utf-8") if path in self.files() else None

    def config(self):
        config = json.loads(self.text("style.json") or "{}")
        return {"model": config.get("model"), "extends": config.get("extends", []), "guide": bool(config.get("guide"))}

    def bases(self):
        bases = []
        for name in self.config()["extends"]:
            base = Style.named(self.style.project, name)
            if not base.exists():
                # A revision recorded before its base was renamed or deleted.
                continue
            bases.append(base.snapshot(self.parents[name]) if self.parents and name in self.parents else base.snapshot())
        return bases

    def chain(self, seen=None):
        seen = seen if seen is not None else []
        for base in self.bases():
            if base.style.name not in [snapshot.style.name for snapshot in seen]:
                base.chain(seen)
        if self.style.name not in [snapshot.style.name for snapshot in seen]:
            seen.append(self)
        return seen

    def spec(self):
        """The effective style.md."""
        chain = self.chain()
        if len(chain) == 1:
            return self.text("style.md") or ""
        preamble, sections = "", {}
        for snapshot in chain:
            head, parts = split_sections(snapshot.text("style.md") or "")
            preamble = head or preamble
            for heading, body in parts:
                if heading.lower() in ADDITIVE and heading in sections:
                    sections[heading] = sections[heading].rstrip("\n") + "\n" + body.lstrip("\n")
                else:
                    sections[heading] = body
        return f"# {self.style.name}\n\n" + (preamble.strip() + "\n\n" if preamble.strip() else "") + "".join(f"## {heading}\n{body.rstrip()}\n\n" for heading, body in sections.items()).rstrip() + "\n"

    def own_references(self):
        default = "guide" if self.config()["guide"] else "style"
        references = []
        for path in sorted(self.files()):
            if path.startswith("references/") and Path(path).suffix.lower() in workspace.IMAGE_SUFFIXES:
                note = json.loads(self.text(path[: -len(Path(path).suffix)] + ".json") or "{}")
                references.append({
                    "style": self.style.name,
                    "name": Path(path).name,
                    # On disk a reference is its file; at a revision it is its object, which outlives the file.
                    "path": self.style.relative(self.style.path / path) if self.recorded is None else None,
                    "object": self.files()[path],
                    "role": note.get("role") or default,
                    "annotation": note or None
                })
        return references

    def references(self):
        """What the effective style draws with: its own style references, else the last base's that has them, and
        the guide references of every guide in the chain."""
        chain = self.chain()
        style_references = next((references for references in ([item for item in snapshot.own_references() if item["role"] == "style"] for snapshot in reversed(chain)) if references), [])
        guide_references = [item for snapshot in chain for item in snapshot.own_references() if item["role"] == "guide"]
        return style_references + guide_references

    def materialize(self, directory):
        """Write the effective style for the agent to read: style.md, style.json, probes.md, the prompting files, and
        the references it draws with with their annotations."""
        directory = Path(directory)
        if directory.exists() and any(directory.iterdir()):
            raise RecordError(f"{directory} is not empty")
        (directory / "references").mkdir(parents=True, exist_ok=True)
        (directory / "style.md").write_text(self.spec(), encoding="utf-8")
        for path in self.files():
            if path in ("style.json", "probes.md") or path.startswith("prompting/"):
                (directory / path).parent.mkdir(parents=True, exist_ok=True)
                (directory / path).write_bytes(self.read(path))
        for item in self.references():
            stem = f"{item['style']}-{Path(item['name']).stem}"
            (directory / "references" / (stem + Path(item["name"]).suffix)).write_bytes(read_object(item["object"]))
            if item["annotation"]:
                write_json(directory / "references" / (stem + ".json"), item["annotation"])
        return directory


def split_sections(text):
    """The text before the first "## " heading, without the title, and every section as (heading, body)."""
    head, sections, current = [], [], None
    for line in text.splitlines(keepends=True):
        if line.startswith("## "):
            current = [line[3:].strip(), ""]
            sections.append(current)
        elif current is not None:
            current[1] += line
        elif not line.startswith("# "):
            head.append(line)
    return "".join(head), [tuple(section) for section in sections]


def parse_probes(text):
    return [line[2:].strip() for line in text.splitlines() if line.startswith("- ") and line[2:].strip()]


def describe_change(last, files, parents):
    if last is None:
        return "first revision"
    before = last["files"]
    parts = [f"{path} added" for path in files if path not in before]
    parts += [f"{path} changed" for path in files if path in before and before[path] != files[path]]
    parts += [f"{path} removed" for path in before if path not in files]
    parts += [f"{name} revision {number}" for name, number in parents.items() if last["parents"].get(name) != number]
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


# Reference images

def annotation(path):
    return read_json(Path(path).with_suffix(".json"))


def annotate(path, role, shows, take, ignore):
    path = workspace.resolve(path)
    if not path.is_file() or path.suffix.lower() not in workspace.IMAGE_SUFFIXES or path.parent.name != "references":
        raise RecordError(f"{workspace.relative(path)} is not a reference")
    if role not in ROLES:
        raise RecordError(f"a reference's role is one of {', '.join(sorted(ROLES))}")
    write_json(path.with_suffix(".json"), {"role": role, "shows": shows.strip(), "take": take.strip(), "ignore": ignore.strip()})
    return path


def add_image(folder, source):
    """Copy an image into a reference folder under the next number. An image already there is left as it is, and a
    number once given is never given to another image, so a name always means one image."""
    source = Path(source).resolve()
    if source.suffix.lower() not in workspace.IMAGE_SUFFIXES or not source.is_file():
        raise RecordError("a reference is a png, jpg, or webp image")
    folder.mkdir(parents=True, exist_ok=True)
    found = digest(source)
    for path in images_in(folder):
        if digest(path) == found:
            return path
    last = folder / ".last"
    used = [int(path.stem) for path in images_in(folder) if path.stem.isdigit()]
    number = max([int(read_text(last) or 0), *used]) + 1
    content = source.read_bytes()
    while True:
        target = folder / f"{number:02d}{source.suffix.lower()}"
        try:
            with open(target, "xb") as file:
                file.write(content)
            break
        except FileExistsError:
            number += 1
    last.write_text(str(max(number, int(read_text(last) or 0))))
    return target


def remove_image(folder, name):
    target = (folder / name).resolve()
    if target.parent != folder.resolve() or not target.is_file() or target.suffix.lower() not in workspace.IMAGE_SUFFIXES:
        raise RecordError(f"no reference {name}")
    target.unlink()
    target.with_suffix(".json").unlink(missing_ok=True)


def main():
    arguments = parse_arguments()
    workspace.enter()
    try:
        if arguments.command == "new":
            project = Project.at(arguments.project if "/" in arguments.project else f"projects/{arguments.project}")
            source = Style.at(getattr(arguments, "from")) if getattr(arguments, "from") else None
            from thread import open_style_thread
            style = Style.create(project, arguments.name, arguments.guide, source)
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
            print(style.revision(arguments.summary, "agent"))
        elif arguments.command in ("effective", "materialize"):
            snapshot = snapshot_of(style, arguments.revision, arguments.proposal)
            if arguments.command == "materialize":
                print(snapshot.materialize(Path(arguments.directory)))
            else:
                print(snapshot.spec())
                for item in snapshot.references():
                    print(f"{item['role']}  {item['path'] or 'objects/' + item['object']}  {(item['annotation'] or {}).get('shows', '(no annotation)')}")
        elif arguments.command == "set-check":
            write_json(style.reference_folder / "set.json", {"references": {item["path"]: digest(style.project.resolve(item["path"])) for item in style.references()}, "shared": arguments.shared, "time": timestamp()})
        elif arguments.command == "restore":
            print(style.restore(arguments.revision))
        elif arguments.command == "extends":
            print(style.set_extends(arguments.bases))
        elif arguments.command == "rename":
            print(workspace.relative(style.rename(arguments.name).path))
        elif arguments.command == "delete":
            style.delete()
        elif arguments.command == "reference-add":
            print(style.add_reference(Path(arguments.image)))
        elif arguments.command == "reference-remove":
            style.remove_reference(arguments.file)
        elif arguments.command == "use":
            style.use(arguments.model)
        elif arguments.command == "model-remove":
            style.remove_model(arguments.model)
    except RecordError as error:
        sys.exit(str(error))


def snapshot_of(style, revision, proposal):
    if proposal:
        from proposal import Proposal
        return Proposal(style, proposal).snapshot()
    return style.snapshot(revision)


def parse_arguments():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    creating = commands.add_parser("new")
    creating.add_argument("project")
    creating.add_argument("name")
    creating.add_argument("--guide", action="store_true", help="a style that only lends its sections to the styles that extend it")
    creating.add_argument("--from", help="a style of another project to copy, projects/<p>/styles/<s>")
    revising = commands.add_parser("revise")
    revising.add_argument("style")
    revising.add_argument("--summary", required=True, help="what changed, in a line")
    for command in ("effective", "materialize"):
        showing = commands.add_parser(command)
        showing.add_argument("style")
        if command == "materialize":
            showing.add_argument("directory")
        showing.add_argument("--revision", type=int)
        showing.add_argument("--proposal")
    annotating = commands.add_parser("annotate")
    annotating.add_argument("reference", help="the reference image, such as projects/deckit/styles/app-icon/references/01.png")
    annotating.add_argument("--role", required=True, choices=sorted(ROLES))
    annotating.add_argument("--shows", required=True, help="what the image shows, subject and colors included")
    annotating.add_argument("--take", required=True, help="what a generation takes from it")
    annotating.add_argument("--ignore", required=True, help="what a generation leaves: its subject, colors, layout")
    checking = commands.add_parser("set-check")
    checking.add_argument("style")
    checking.add_argument("--shared", action="append", default=[], help="one thing every style reference shares besides the style, repeatable; none when the set is varied")
    restoring = commands.add_parser("restore")
    restoring.add_argument("style")
    restoring.add_argument("revision", type=int)
    extending = commands.add_parser("extends")
    extending.add_argument("style")
    extending.add_argument("bases", nargs="*")
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
