#!/usr/bin/env python3
"""A project: one purpose (an app, a blog) and everything made for it.

  projects/<project>/
    project.md              the brief: what the images are for, where they are seen, who sees them, brand colors and
                            tone, and the decisions that hold for every style in the project
    styles/<style>/         the project's styles (see style.py)
    subjects/               subject references the project reuses (a mascot, a logo's shape), each with its annotation
    nodes/<id>/             what was made: one request and its result each (see node.py)
    threads/<id>/           conversations about a style or an image (see thread.py)
    canvas.json             where the user placed the nodes, the frames around them, and the nodes whose reviews
                            the user has opened; page state, rewritten freely

Paths inside a project's records are relative to the project ("nodes/n3/a.png", "styles/app-icon/references/01.png"),
so renaming the project moves its folder and nothing else.

Commands:
  new <project>                         create a project
  rename <project> <name>               rename a project
  delete <project>                      delete a project and everything in it
  subject-add <project> <image>         add a subject reference
  subject-remove <project> <file>       take a subject reference out, by its file name in subjects/
"""

import argparse
import shutil
import sys
from pathlib import Path

import workspace
from workspace import RecordError, images_in, read_json, read_text, write_json

BRIEF = """# {name}

What the images are for, where they are seen, and who sees them.

## Brand

Colors and tone every style in this project keeps.

## Decisions

Decisions that hold for every image in this project.
"""


class Project:
    def __init__(self, path):
        self.path = Path(path).resolve()
        self.name = self.path.name

    @classmethod
    def named(cls, name):
        return cls(workspace.PROJECTS / workspace.require_name(name, "project"))

    @classmethod
    def at(cls, path):
        """The project a workspace path is in: projects/<project> or anything inside it."""
        path = workspace.resolve(path)
        root = workspace.PROJECTS.resolve()
        if root not in path.parents:
            raise RecordError(f"{workspace.relative(path)} is not inside a project")
        project = cls(root / path.relative_to(root).parts[0])
        if not project.exists():
            raise RecordError(f"no project {project.name}")
        return project

    @classmethod
    def all(cls):
        if not workspace.PROJECTS.is_dir():
            return []
        return [cls(path) for path in sorted(workspace.PROJECTS.iterdir()) if path.is_dir() and not path.name.startswith(".")]

    @classmethod
    def create(cls, name):
        project = cls.named(name)
        if project.exists():
            raise RecordError(f"project {project.name} already exists")
        project.path.mkdir(parents=True)
        (project.path / "project.md").write_text(BRIEF.format(name=project.name), encoding="utf-8")
        return project

    def exists(self):
        return self.path.is_dir()

    def relative(self, path):
        return Path(path).resolve().relative_to(self.path).as_posix()

    def resolve(self, relative):
        path = (self.path / relative).resolve()
        if not workspace.inside(path, self.path):
            raise RecordError(f"{relative} is outside the project")
        return path

    # What the project holds

    @property
    def brief_file(self):
        return self.path / "project.md"

    def brief(self):
        return read_text(self.brief_file) or ""

    def write_brief(self, text):
        self.brief_file.write_text(text if text.endswith("\n") else text + "\n", encoding="utf-8")

    def purpose(self):
        """The first line of project.md under its title, which says what the project is for."""
        return next((line for line in self.brief().splitlines() if line.strip() and not line.startswith(("#", "|", "-"))), "")

    def styles(self):
        from style import Style
        return Style.all(self)

    def style(self, name):
        from style import Style
        style = Style.named(self, name)
        if not style.exists():
            raise RecordError(f"{self.name} has no style {name}")
        return style

    def nodes(self):
        from node import Node
        return Node.all(self)

    def threads(self):
        from thread import Thread
        return Thread.all(self)

    @property
    def subject_folder(self):
        return self.path / "subjects"

    def subjects(self):
        from style import annotation
        return [{"path": self.relative(path), "annotation": annotation(path)} for path in images_in(self.subject_folder)]

    def add_subject(self, source):
        from style import add_image
        return self.relative(add_image(self.subject_folder, source))

    def remove_subject(self, name):
        from style import remove_image
        remove_image(self.subject_folder, name)

    # Canvas

    @property
    def canvas_file(self):
        return self.path / "canvas.json"

    def canvas(self):
        canvas = read_json(self.canvas_file, {})
        return {"positions": canvas.get("positions", {}), "frames": canvas.get("frames", []), "revealed": canvas.get("revealed", [])}

    def save_canvas(self, positions=None, frames=None, revealed=None):
        canvas = self.canvas()
        known = {node.id for node in self.nodes()}
        if positions is not None:
            canvas["positions"] = {key: [float(value[0]), float(value[1])] for key, value in positions.items() if key in known}
        if frames is not None:
            canvas["frames"] = [{"title": str(frame.get("title", "")), "nodes": [key for key in frame.get("nodes", []) if key in known]} for frame in frames]
        if revealed is not None:
            canvas["revealed"] = sorted({key for key in revealed if key in known})
        write_json(self.canvas_file, canvas)
        return canvas

    # Changes

    def rename(self, name):
        target = Project.named(name)
        if target.exists():
            raise RecordError(f"project {target.name} already exists")
        self.path.rename(target.path)
        lines = (read_text(target.brief_file) or "").split("\n")
        if lines and lines[0] == f"# {self.name}":
            lines[0] = f"# {target.name}"
            target.brief_file.write_text("\n".join(lines), encoding="utf-8")
        return target

    def delete(self):
        shutil.rmtree(self.path)


def main():
    arguments = parse_arguments()
    workspace.enter()
    try:
        if arguments.command == "new":
            print(workspace.relative(Project.create(arguments.project).path))
            return
        project = Project.at(arguments.project if "/" in arguments.project else f"projects/{arguments.project}")
        if arguments.command == "rename":
            print(workspace.relative(project.rename(arguments.name).path))
        elif arguments.command == "delete":
            project.delete()
        elif arguments.command == "subject-add":
            print(project.add_subject(Path(arguments.image)))
        elif arguments.command == "subject-remove":
            project.remove_subject(arguments.file)
    except RecordError as error:
        sys.exit(str(error))


def parse_arguments():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("new", "delete"):
        commands.add_parser(command).add_argument("project", help="the project name, or its folder projects/<project>")
    renaming = commands.add_parser("rename")
    renaming.add_argument("project")
    renaming.add_argument("name")
    adding = commands.add_parser("subject-add")
    adding.add_argument("project")
    adding.add_argument("image")
    removing = commands.add_parser("subject-remove")
    removing.add_argument("project")
    removing.add_argument("file", help="the file name in subjects/, such as 01.png")
    return parser.parse_args()


if __name__ == "__main__":
    main()
