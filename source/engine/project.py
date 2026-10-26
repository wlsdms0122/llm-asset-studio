#!/usr/bin/env python3
"""A project: one purpose (an app, a blog) and everything made for it.

  projects/<project>/
    project.md              the brief: what the images are for, where they are seen, who sees them, brand colors and
                            tone, and the decisions that hold for every style in the project. The agent writes it
                            from the project's thread (see thread.py).
    styles/<style>/         the project's styles (see style.py)
    nodes/<id>/             what was made: one request and its result each (see node.py)
    threads/<id>/           conversations about the project, a style, or an image (see thread.py)
    canvas.json             where the user placed the nodes and the frames that group them; page state, rewritten freely

Paths inside a project's records are relative to the project ("nodes/n3/a.png", "styles/app-icon/references/01.png"),
so renaming the project moves its folder and nothing else.

Commands:
  new <project>                         create a project
  rename <project> <name>               rename a project
  delete <project>                      delete a project and everything in it
"""

import argparse
import shutil
import sys
from pathlib import Path

import workspace
from workspace import RecordError, read_json, read_text, write_json


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

    def thread(self, identifier):
        """A thread of this project, named by its id (t3) or its folder."""
        from thread import Thread
        thread = next((thread for thread in self.threads() if thread.id == Path(str(identifier)).name), None)
        if thread is None:
            raise RecordError(f"{self.name} has no thread {identifier}")
        return thread

    # Canvas

    @property
    def canvas_file(self):
        return self.path / "canvas.json"

    def canvas(self):
        canvas = read_json(self.canvas_file, {})
        return self.laid_out(canvas.get("positions", {}), canvas.get("frames", []))

    def save_canvas(self, positions=None, frames=None):
        saved = read_json(self.canvas_file, {})
        canvas = self.laid_out(saved.get("positions", {}) if positions is None else positions, saved.get("frames", []) if frames is None else frames)
        write_json(self.canvas_file, canvas)
        return canvas

    def laid_out(self, positions, frames):
        """The canvas over the nodes that exist: a node is in one frame at most, and a frame left with no node is gone."""
        known = {node.id for node in self.nodes()}
        taken = set()
        kept = []
        for frame in frames:
            members = [key for key in frame.get("nodes", []) if key in known and key not in taken]
            taken.update(members)
            if members:
                kept.append({"title": " ".join(str(frame.get("title", "")).split()), "nodes": members})
        return {"positions": {key: [float(value[0]), float(value[1])] for key, value in positions.items() if key in known}, "frames": kept}

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
    return parser.parse_args()


if __name__ == "__main__":
    main()
