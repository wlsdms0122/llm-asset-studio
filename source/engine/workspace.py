#!/usr/bin/env python3
"""The workspace: what asset-studio keeps outside the package, and the file conventions every record follows.

  ~/.config/asset-studio/   or the directory named by ASSET_STUDIO_HOME
    projects/               the user's projects (see project.py)
    objects/                file contents by hash: every version of a style file and every reference, so a
                            revision or a node can always show what it named
    cache/                  what OpenRouter says about models, kept for a day
    agent.json              when an agent last looked for work (`open-package watch`), for the page to show
    key                     the OpenRouter API key, readable by the user only

Every command runs inside the workspace, so the paths it takes and the paths records hold are relative to it.

Commands:
  key                       store the OpenRouter API key, read from stdin
"""

import argparse
import getpass
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
from pathlib import Path

HOME = Path(os.environ.get("ASSET_STUDIO_HOME") or "~/.config/asset-studio").expanduser().resolve()
PROJECTS = HOME / "projects"
OBJECTS = HOME / "objects"
CACHE = HOME / "cache"
AGENT = HOME / "agent.json"
KEY = HOME / "key"

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}


class RecordError(Exception):
    """A change the records refuse, said in words the user can act on."""


def enter():
    HOME.mkdir(parents=True, exist_ok=True)
    os.chdir(HOME)


def relative(path):
    return Path(os.path.relpath(Path(path).resolve(), HOME)).as_posix()


def resolve(path):
    return (HOME / path).resolve()


def inside(path, root):
    path, root = Path(path).resolve(), Path(root).resolve()
    return path == root or root in path.parents


def stored_name(name):
    """A project or style name in its stored form, or None when it is not one: letters of any script with their
    combining marks, digits, and hyphens, starting with a letter or digit. NFKC folds look-alike forms (full-width
    "ｄｅｍｏ" is "demo"), and names are lowercase so no two differ only by case on a case-insensitive disk.
    app.js mirrors this rule."""
    name = unicodedata.normalize("NFKC", name or "")
    kinds = [unicodedata.category(character)[0] if character != "-" else "-" for character in name]
    if not 2 <= len(name) <= 41 or kinds[0] not in "LN" or any(kind not in "LNM-" for kind in kinds) or name != name.lower():
        return None
    return name


def require_name(name, what):
    stored = stored_name(name)
    if stored is None:
        raise RecordError(f"a {what} name is two or more letters of any script (lowercase where the script has case), digits, and hyphens")
    return stored


def upload_name(name):
    """A file name the user sent, kept in any script; only the extension decides whether it is an image."""
    original = Path(Path(name or "").name)
    if original.suffix.lower() not in IMAGE_SUFFIXES:
        raise RecordError("attach a png, jpg, or webp image")
    return (re.sub(r"[^\w.-]", "-", original.stem).strip("-.") or "image") + original.suffix.lower()


# Objects: file contents stored once under their hash, never changed or removed.

def put_object(content):
    name = hashlib.sha1(content).hexdigest()
    path = object_path(name)
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        draft = path.with_name(f".{name}.{os.getpid()}")
        draft.write_bytes(content)
        draft.replace(path)
    return name


def object_path(name):
    return OBJECTS / name[:2] / name[2:]


def read_object(name):
    return object_path(name).read_bytes()


_digests = {}


def digest(path):
    """A file's content hash, the name its object has, cached by path, size, and modification time."""
    path = Path(path)
    status = path.stat()
    key = (str(path.resolve()), status.st_size, status.st_mtime_ns)
    if key not in _digests:
        _digests[key] = hashlib.sha1(path.read_bytes()).hexdigest()
    return _digests[key]


def image_type(content):
    """The media type of an image by its first bytes, since objects keep no extension."""
    if content.startswith(b"\x89PNG"):
        return "image/png"
    if content.startswith(b"\xff\xd8"):
        return "image/jpeg"
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    return None


# Records

def images_in(folder):
    folder = Path(folder)
    if not folder.is_dir():
        return []
    return sorted(path for path in folder.iterdir() if path.suffix.lower() in IMAGE_SUFFIXES and not path.name.startswith("."))


def read_text(path):
    path = Path(path)
    return path.read_text(encoding="utf-8") if path.exists() else None


def read_json(path, default=None):
    path = Path(path)
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def read_lines(path):
    path = Path(path)
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def append_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(value, ensure_ascii=False) + "\n")


def write_json(path, value):
    path = Path(path)
    temporary = path.with_name(f".{path.name}.{os.getpid()}")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def write_once(path, value):
    """A record one side writes once and never rewrites: a node's input or result, a round, an answer."""
    path = Path(path)
    try:
        with open(path, "x", encoding="utf-8") as file:
            file.write(json.dumps(value, ensure_ascii=False, indent=2))
    except FileExistsError:
        raise RecordError(f"{relative(path)} is already written")


def claim_number(folder, prefix="", width=0):
    """The next free number in a folder, claimed by creating its directory, so two writers never share one.
    A number once given is never given again: the last one is kept in .last even after its directory is gone."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    last = folder / ".last"
    taken = [int(path.name[len(prefix):]) for path in folder.iterdir() if path.is_dir() and path.name.startswith(prefix) and path.name[len(prefix):].isdigit()]
    number = max([int(read_text(last) or 0), *taken]) + 1
    while True:
        directory = folder / f"{prefix}{number:0{width}d}"
        try:
            directory.mkdir()
            last.write_text(str(number))
            return directory
        except FileExistsError:
            number += 1


def timestamp():
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


# The agent

def heartbeat():
    write_json(AGENT, {"time": timestamp(), "seen": time.time()})


def agent_seen():
    """Seconds since an agent last looked for work, or None when none ever has."""
    record = read_json(AGENT)
    return time.time() - record["seen"] if record else None


# The key

def read_key():
    """The key is never printed."""
    if not KEY.is_file():
        sys.exit(f"no OpenRouter key at {KEY}; store one with `open-package key`")
    return KEY.read_text().strip()


def store_key(key):
    HOME.mkdir(parents=True, exist_ok=True)
    draft = KEY.with_name(".key")
    draft.unlink(missing_ok=True)
    with os.fdopen(os.open(draft, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as file:
        file.write(key + "\n")
    draft.replace(KEY)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_subparsers(dest="command", required=True).add_parser("key")
    parser.parse_args()

    key = (getpass.getpass("OpenRouter API key: ") if sys.stdin.isatty() else sys.stdin.readline()).strip()
    if not key:
        sys.exit("no key given")
    store_key(key)
    print(KEY)


if __name__ == "__main__":
    main()
