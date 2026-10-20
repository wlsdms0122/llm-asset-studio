#!/usr/bin/env python3
"""Serve the studio (web/) over every style in the workspace.

The page lists the styles, opens one, and shows its sessions. The server writes only records, through
session.py and style.py: the user's answers, new styles (empty or from a confirmed one) with their
make session, new generate and model sessions, images attached to or taken off the answer being
written, and the user's own changes to a style (its name, its references, the model it uses, deleting
it or a session). It never generates. The agent watches sessions/*/*/*/feedback.json and
sessions/*/*/session.json, does the work, and publishes the next round; the open page follows on its own.
"""

import argparse
import base64
import binascii
import io
import json
import mimetypes
import re
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import workspace
from capability import reference_limit
from catalog import catalog
from session import Session, create_style, open_session
from style import IMAGE_SUFFIXES, Style, StyleError

ENGINE = Path(__file__).resolve().parent
WEB = ENGINE.parent / "web"


def main():
    arguments = parse_arguments()
    workspace.enter()
    workspace.STYLES.mkdir(exist_ok=True)

    handler = type("BoundHandler", (Handler,), {"styles": workspace.STYLES, "workspace": workspace.HOME})
    server = Server((arguments.host, arguments.port), handler)
    print(f"http://{arguments.host}:{arguments.port}", flush=True)
    server.serve_forever()


class Server(ThreadingHTTPServer):
    # A page asks for a whole grid of images at once; the default backlog of 5 resets the rest.
    request_queue_size = 128
    daemon_threads = True


def parse_arguments():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8770)
    return parser.parse_args()


def summary(style):
    """What the home screen shows for one style: while it is being made, where its make session is."""
    making = Session.making(style)
    current = making.latest() if making else None
    shown = style.references() or (current.record["candidates"] if current else [])
    return {
        "name": style.name,
        "purpose": style.purpose(),
        "confirmed": style.confirmed(),
        "based_on": style.based_on(),
        "kind": current.kind if current else None,
        "waiting": bool(current and current.feedback() is None),
        # The agent has something to do in a session: an answer to act on, or a model session to prepare.
        "working": any(not session.summary()["waiting"] for session in Session.all(style)),
        "cover": shown[0] if shown else None,
        "archived": len(style.archived())
    }


def overview(style):
    """A style's words, references, and models, shown when no session is open."""
    return {
        "spec": style.spec(),
        "references": style.references(),
        "model": style.model(),
        "models": style.models(),
        "prompting": style.prompting(),
        "confirmed": style.confirmed(),
        "based_on": style.based_on()
    }


def archive_of(style):
    """The archive, newest last."""
    return [{**item, "file": style.relative(style.path / item["file"])} for item in style.archived()]


def check_references(style, count, model=None):
    """A style's references are attached to every generation, so they never outnumber what any of its models takes,
    nor what a model being added takes."""
    models = [model] if model else style.models() + [session.record["model"] for session in Session.all(style) if session.kind == "model"]
    for each in models:
        limit = reference_limit(each)
        if limit is not None and count > limit:
            raise StyleError(f"{each} takes at most {limit} references; this would make {count}")


class Handler(BaseHTTPRequestHandler):
    styles = None
    workspace = None

    def trusted(self):
        """Only this studio's own page may talk to it: the Host must be the address the server listens on, and
        writes must be JSON, which a page on another site cannot send without a preflight the server never grants."""
        host, port = self.server.server_address[:2]
        if self.headers.get("Host") not in (f"127.0.0.1:{port}", f"localhost:{port}", f"{host}:{port}"):
            self.send_json(403, {"error": "unknown host"})
            return False
        if self.command == "POST" and (self.headers.get("Content-Type") or "").split(";")[0].strip() != "application/json":
            self.send_json(415, {"error": "send JSON"})
            return False
        return True

    def do_GET(self):
        if not self.trusted():
            return
        url = urlparse(self.path)
        path = unquote(url.path)
        query = parse_qs(url.query)

        try:
            if path == "/":
                return self.send_file(WEB / "index.html")
            if path in ("/i18n.js", "/ui.css", "/ui.js", "/app.css", "/app.js"):
                return self.send_file(WEB / path.lstrip("/"))
            if path == "/api/styles":
                return self.send_json(200, {"styles": [summary(style) for style in self.all_styles()]})
            if path == "/api/archive":
                return self.send_json(200, {"styles": [{"style": style.name, "items": archive_of(style)} for style in self.all_styles() if style.archived()]})
            if path == "/api/state":
                return self.send_state(self.style(query.get("style", [""])[0]), query.get("session", [None])[0])
            if path == "/api/catalog":
                return self.send_json(200, {"models": catalog(self.all_styles())})
            if path.startswith("/file/"):
                return self.send_workspace_file(path[len("/file/"):])
        except OSError as error:
            return self.send_json(502, {"error": f"could not read the model list: {error}"})
        self.not_found()

    def do_POST(self):
        if not self.trusted():
            return
        path = urlparse(self.path).path
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        except ValueError:
            return self.send_json(400, {"error": "the request body is not JSON"})

        try:
            if path == "/api/styles":
                style = create_style(self.styles, body.get("name", "").strip(), body.get("base") or None)
                return self.send_json(200, {"style": style.name})
            if path == "/api/download":
                return self.download(body.get("files", []))

            style = self.style(body.get("style", ""))
            if style is None:
                return self.send_json(404, {"error": "no such style"})
            if path in ("/api/styles/rename", "/api/styles/delete") and any(not session.summary()["waiting"] for session in Session.all(style)):
                raise StyleError("the agent is working in one of this style's sessions; try again when it is done")
            if path == "/api/styles/rename":
                return self.send_json(200, {"style": style.rename(body.get("name", "").strip()).name})
            if path == "/api/styles/delete":
                style.delete()
                return self.send_json(200, {"ok": True})
            if path == "/api/sessions":
                session = open_session(style, body.get("kind"), body.get("model") or None, bool(body.get("ideation")))
                return self.send_json(200, {"session": session.id})
            if path == "/api/model":
                check_references(style, len(style.references()), body.get("model", ""))
                style.use(body.get("model", ""))
                return self.send_json(200, {"ok": True})
            if path == "/api/models/delete":
                style.remove_model(body.get("model", ""))
                return self.send_json(200, {"ok": True})
            if path == "/api/references/add":
                return self.add_reference(style, body)
            if path == "/api/references/remove":
                style.remove_reference(Path(body.get("file", "")).name)
                return self.send_json(200, {"ok": True})

            session = self.session(style, body.get("session"))
            if path == "/api/sessions/delete":
                session.delete()
                return self.send_json(200, {"ok": True})
            if path == "/api/feedback":
                return self.answer(session, body)
            if path == "/api/attach":
                return self.attach(session, body)
            if path == "/api/detach":
                return self.detach(session, body)
        except (StyleError, ValueError, TypeError, AttributeError, KeyError) as error:
            return self.send_json(400, {"error": str(error)})
        except OSError as error:
            return self.send_json(500, {"error": str(error)})
        self.not_found()

    def answer(self, session, body):
        current = session.latest()
        if current is None or current.number != body.get("round"):
            return self.send_json(409, {"error": "this round is no longer the latest; reload the page"})
        feedback = current.submit(
            picked=[int(number) for number in body.get("picked", [])],
            notes={int(number): text for number, text in body.get("notes", {}).items()},
            comment=body.get("comment", ""),
            request=body.get("request", ""),
            decision=body.get("decision"),
            surface="web"
        )
        self.send_json(200, feedback)

    def attach(self, session, body):
        name, content = self.upload(body)
        folder = self.open_attachments(session)
        folder.mkdir(exist_ok=True)
        (folder / name).write_bytes(content)
        self.send_json(200, {"path": session.style.relative(folder / name)})

    def detach(self, session, body):
        path = session.style.resolve(body.get("path", ""))
        if path.parent != self.open_attachments(session).resolve() or not path.is_file():
            raise StyleError("no such attachment")
        path.unlink()
        self.send_json(200, {"ok": True})

    def add_reference(self, style, body):
        """A reference comes from an image in the workspace (the archive, a session) or from an upload."""
        check_references(style, len(style.references()) + 1)
        before = set(style.references())
        if body.get("path"):
            source = style.resolve(body["path"])
            if not self.inside_workspace_images(source):
                raise StyleError("no such image")
            path = style.add_reference(source)
            return self.send_json(200, {"path": path, "added": path not in before})
        name, content = self.upload(body)
        folder = self.workspace / "sessions" / ".uploads"
        folder.mkdir(parents=True, exist_ok=True)
        upload = folder / f"{time.strftime('%Y%m%d-%H%M%S')}-{name}"
        upload.write_bytes(content)
        try:
            path = style.add_reference(upload)
            return self.send_json(200, {"path": path, "added": path not in before})
        finally:
            upload.unlink(missing_ok=True)

    def upload(self, body):
        name = re.sub(r"[^A-Za-z0-9._-]", "-", Path(body.get("name", "")).name).strip("-.")
        if not name or Path(name).suffix.lower() not in IMAGE_SUFFIXES:
            raise StyleError("attach a png, jpg, or webp image")
        try:
            content = base64.b64decode(body.get("data", ""), validate=True)
        except binascii.Error:
            raise StyleError("the image data is not base64")
        if not content:
            raise StyleError("the image is empty")
        return name, content

    def download(self, files):
        """Several workspace images as one zip, named by where they came from."""
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_STORED) as bundle:
            for item in files:
                source = (self.workspace / item.get("path", "")).resolve()
                if not self.inside_workspace_images(source):
                    raise StyleError(f"no such image {item.get('path')}")
                bundle.write(source, Path(item.get("name") or source.name).name)
        self.send(200, archive.getvalue(), "application/zip")

    def open_attachments(self, session):
        """Attachments go with the answer being written, so only an open round takes them."""
        current = session.latest()
        if current is None or current.feedback() is not None:
            raise StyleError("there is no answer being written to attach to")
        return current.directory / "attachments"

    def all_styles(self):
        return Style.all(self.styles)

    def style(self, name):
        path = (self.styles / name).resolve()
        return Style(path) if name and path.parent == self.styles and path.is_dir() else None

    def session(self, style, identifier):
        if not identifier or "/" in identifier or identifier.startswith("."):
            raise StyleError("no such session")
        directory = style.sessions / identifier
        if not (directory / "session.json").exists():
            raise StyleError("no such session")
        return Session(style, directory)

    def send_state(self, style, identifier):
        if style is None:
            return self.send_json(404, {"error": "no such style"})
        sessions = Session.all(style)
        # Without a session asked for, a style being made opens on its make session.
        if identifier:
            chosen = next((session for session in sessions if session.id == identifier), None)
            if chosen is None:
                return self.send_json(404, {"error": "no such session"})
        else:
            chosen = Session.making(style)
        current = chosen.latest() if chosen else None
        self.send_json(200, {
            "style": style.name,
            "sessions": [session.summary() for session in sessions],
            "session": chosen.summary() if chosen else None,
            "view": current.view() if current else None,
            "overview": overview(style),
            "archive": archive_of(style)
        })

    def inside_workspace_images(self, path):
        allowed = (self.styles, self.workspace / "sessions")
        return path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES and any(root.resolve() in path.parents for root in allowed)

    def send_workspace_file(self, relative):
        """Only images inside styles/ and sessions/ are served."""
        try:
            path = (self.workspace / relative).resolve()
        except (ValueError, OSError):
            return self.not_found()
        if not self.inside_workspace_images(path):
            return self.not_found()
        # Images are revalidated, not refetched: an unchanged file answers 304, so a re-rendered page keeps its layout.
        status = path.stat()
        tag = f'"{status.st_mtime_ns:x}-{status.st_size:x}"'
        if self.headers.get("If-None-Match") == tag:
            self.send_response(304)
            self.send_header("ETag", tag)
            self.end_headers()
            return
        self.send_file(path, tag)

    def send_file(self, path, tag=None):
        if not path.is_file():
            return self.not_found()
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type == "application/javascript":
            content_type += "; charset=utf-8"
        self.send(200, path.read_bytes(), content_type, tag)

    def send_json(self, status, value):
        self.send(status, json.dumps(value, ensure_ascii=False).encode(), "application/json")

    def not_found(self):
        self.send(404, b"not found", "text/plain")

    def send(self, status, body, content_type, tag=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        if tag:
            # Workspace images never change under their path (references are never renumbered, archive and
            # session files are written once), so the browser keeps them and a redrawn page shows them at once.
            self.send_header("ETag", tag)
            self.send_header("Cache-Control", "private, max-age=86400")
        else:
            self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *arguments):
        pass


if __name__ == "__main__":
    main()
