#!/usr/bin/env python3
"""Serve the studio (web/) over every project in the workspace.

The server writes only records, through the engine's modules: projects and their briefs, styles and the user's own
changes to them (edits, references, models, extends, restoring a revision, accepting or rejecting a proposal),
probe runs asked for, nodes (a generation asked for, a tool run here, an upload), the canvas layout, threads and
the user's answers. It never generates: the agent waits with `open-package watch`, does the work, and publishes;
the open page follows on its own. A tool node runs here, since it draws nothing and costs nothing.
"""

import argparse
import base64
import binascii
import io
import json
import mimetypes
import tempfile
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import workspace
from catalog import catalog
from node import Node, leaks, run_in_background, views
from probe import ProbeRun
from project import Project
from proposal import Proposal
from style import Style
from thread import Thread, open_ideation, open_style_thread
from workspace import RecordError

ENGINE = Path(__file__).resolve().parent
WEB = ENGINE.parent / "web"
PAGES = ("/i18n.js", "/ui.css", "/ui.js", "/app.css", "/app.js", "/canvas.js", "/style.js")


def main():
    arguments = parse_arguments()
    workspace.enter()
    workspace.PROJECTS.mkdir(exist_ok=True)
    server = Server((arguments.host, arguments.port), Handler)
    print(f"http://{arguments.host}:{arguments.port}", flush=True)
    server.serve_forever()


class Server(ThreadingHTTPServer):
    # A page asks for a whole canvas of images at once; the default backlog of 5 resets the rest.
    request_queue_size = 128
    daemon_threads = True


def parse_arguments():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8770)
    return parser.parse_args()


def agent():
    seen = workspace.agent_seen()
    return {"seen": None if seen is None else round(seen)}


def project_summary(project):
    nodes = project.nodes()
    cover = next((image for node in reversed(nodes) for image in node.view()["images"]), None)
    return {
        "name": project.name,
        "purpose": project.purpose(),
        "styles": [style.name for style in project.styles()],
        "nodes": len(nodes),
        "cover": cover["path"] if cover else None,
        "working": sum(1 for node in nodes if node.kind == "generation" and node.result() is None) + sum(1 for thread in project.threads() if not thread.waiting())
    }


def style_summary(style):
    snapshot = style.snapshot()
    references = snapshot.references()
    return {
        "name": style.name,
        "purpose": style.purpose(),
        "guide": style.guide(),
        "extends": style.extends(),
        "model": style.model(),
        "blocked": style.blocked(),
        "cover": next((item["path"] or f"objects/{item['object']}" for item in references if item["role"] == "style"), None),
        "revision": len(style.revisions()),
        "proposals": sum(1 for proposal in Proposal.all(style) if proposal.record["status"] == "open")
    }


def style_detail(style):
    runs = [run.view() for run in ProbeRun.all(style)]
    current = style.recorded()
    return {
        **style_summary(style),
        "spec": style.spec(),
        "effective": style.snapshot().spec() if style.extends() else None,
        "probes": style.probes(),
        "probes_text": workspace.read_text(style.path / "probes.md") or "",
        "models": style.models(),
        "prompting": {model: style.prompting(model) for model in style.models()},
        "references": style.references(),
        "drawn_with": style.snapshot().references(),
        "set_check": style.set_check(),
        "revisions": [{key: entry[key] for key in ("number", "time", "summary", "source", "parents")} for entry in style.revisions()],
        "current": current,
        "stale_bases": style.stale_bases(),
        "dependents": [dependent.name for dependent in style.dependents()],
        "proposals": [proposal.view() for proposal in Proposal.all(style)],
        "runs": runs,
        # Probes are stale when the newest finished run of a revision shows one other than the current; a run of a
        # proposal not accepted shows no revision.
        "probes_stale": next((run["revision"] for run in reversed(runs) if run["status"] == "done" and run["revision"] is not None), current) != current,
        "leaks": leaks(style.project, style.name),
        "threads": [thread.summary() for thread in style.project.threads() if thread.record["style"] == style.name]
    }


class Handler(BaseHTTPRequestHandler):
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
        query = {key: values[0] for key, values in parse_qs(url.query).items()}
        try:
            if path == "/":
                return self.send_file(WEB / "index.html")
            if path in PAGES:
                return self.send_file(WEB / path.lstrip("/"))
            if path == "/api/projects":
                return self.send_json(200, {"projects": [project_summary(project) for project in Project.all()], "agent": agent()})
            if path == "/api/project":
                project = self.project(query)
                return self.send_json(200, {
                    "name": project.name,
                    "brief": project.brief(),
                    "styles": [style_summary(style) for style in project.styles()],
                    "nodes": views(project),
                    "canvas": project.canvas(),
                    "threads": [thread.summary() for thread in project.threads()],
                    "subjects": project.subjects(),
                    "agent": agent()
                })
            if path == "/api/style":
                return self.send_json(200, {**style_detail(self.style(query)), "agent": agent()})
            if path == "/api/revision":
                style = self.style(query)
                snapshot = style.snapshot(int(query.get("revision", "0")))
                return self.send_json(200, {"spec": snapshot.spec(), "files": snapshot.files(), "references": snapshot.references()})
            if path == "/api/thread":
                project = self.project(query)
                return self.send_json(200, {**self.thread(project, query.get("thread")).view(), "agent": agent()})
            if path == "/api/archive":
                return self.send_json(200, {"projects": [{"project": project.name, "nodes": [node for node in views(project) if node["images"]]} for project in Project.all()]})
            if path == "/api/catalog":
                return self.send_json(200, {"models": catalog()})
            if path.startswith("/file/"):
                return self.send_workspace_file(path[len("/file/"):])
            if path.startswith("/object/"):
                return self.send_object(path[len("/object/"):])
        except RecordError as error:
            return self.send_json(404, {"error": str(error)})
        except OSError as error:
            return self.send_json(502, {"error": f"could not read the model list: {error}"})
        except ValueError as error:
            return self.send_json(400, {"error": str(error)})
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
            result = self.route(path, body)
        except (RecordError, ValueError, TypeError, AttributeError, KeyError) as error:
            return self.send_json(400, {"error": str(error)})
        except OSError as error:
            return self.send_json(500, {"error": str(error)})
        if result is None:
            return self.not_found()
        if result is not True:
            self.send_json(200, result)

    def route(self, path, body):
        if path == "/api/download":
            self.download(body.get("files", []))
            return True
        if path == "/api/projects":
            return {"project": Project.create(body.get("name", "").strip()).name}

        project = self.project(body)
        if path == "/api/projects/rename":
            return {"project": project.rename(body.get("name", "").strip()).name}
        if path == "/api/projects/delete":
            project.delete()
            return {"ok": True}
        if path == "/api/projects/brief":
            project.write_brief(body.get("text", ""))
            return {"ok": True}
        if path == "/api/subjects/add":
            return {"path": self.add_image(body, project.add_subject)}
        if path == "/api/subjects/remove":
            project.remove_subject(Path(body.get("file", "")).name)
            return {"ok": True}
        if path == "/api/canvas":
            return project.save_canvas(body.get("positions"), body.get("frames"), body.get("revealed"))
        if path == "/api/styles":
            source = self.style({"project": body["from_project"], "style": body["from_style"]}) if body.get("from_project") else None
            style = Style.create(project, body.get("name", "").strip(), bool(body.get("guide")), source)
            thread = open_style_thread(style, first=source is None, surface="web")
            return {"style": style.name, "thread": thread.id}
        if path == "/api/nodes":
            return self.add_node(project, body)
        if path == "/api/nodes/delete":
            self.node(project, body.get("node")).delete()
            return {"ok": True}
        if path == "/api/threads":
            style = project.style(body.get("style", ""))
            attachments = [self.upload(item) for item in body.get("attachments", [])]
            opener = open_ideation if body.get("kind") == "ideation" else open_style_thread
            return {"thread": opener(style, message=body.get("message", ""), attachments=attachments, surface="web").id}
        if path.startswith("/api/threads/"):
            return self.thread_change(path, project, body)
        if path.startswith("/api/styles/") or path.startswith("/api/proposals/") or path == "/api/runs":
            return self.style_change(path, project.style(body.get("style", "")), body)
        return None

    def style_change(self, path, style, body):
        if path == "/api/styles/rename":
            return {"style": style.rename(body.get("name", "").strip()).name}
        if path == "/api/styles/delete":
            style.delete()
            return {"ok": True}
        if path == "/api/styles/edit":
            return {"revision": style.edit(body.get("file", ""), body.get("text", ""))}
        if path == "/api/styles/use":
            return {"revision": style.use(body.get("model", ""))}
        if path == "/api/styles/models/delete":
            return {"revision": style.remove_model(body.get("model", ""))}
        if path == "/api/styles/extends":
            return {"revision": style.set_extends(body.get("extends", []))}
        if path == "/api/styles/restore":
            return {"revision": style.restore(int(body.get("revision", 0)))}
        if path == "/api/styles/references/add":
            return {"path": self.add_image(body, style.add_reference, style.project)}
        if path == "/api/styles/references/remove":
            return {"revision": style.remove_reference(Path(body.get("file", "")).name)}
        if path == "/api/proposals/accept":
            return {"revision": Proposal(style, body.get("proposal", "")).accept()}
        if path == "/api/proposals/reject":
            Proposal(style, body.get("proposal", "")).reject()
            return {"ok": True}
        if path == "/api/runs":
            run = ProbeRun.request(style, body.get("proposal") or None, body.get("requests", []), surface="web")
            return {"run": run.number}
        return None

    def thread_change(self, path, project, body):
        thread = self.thread(project, body.get("thread"))
        if path == "/api/threads/rename":
            thread.rename(body.get("name", ""))
            return {"ok": True}
        if path == "/api/threads/delete":
            thread.delete()
            return {"ok": True}
        current = thread.latest()
        if path == "/api/threads/answer":
            if current is None or current.number != body.get("round"):
                raise RecordError("this round is no longer the latest; reload the page")
            return current.submit(
                picked=[int(number) for number in body.get("picked", [])],
                notes={int(number): text for number, text in body.get("notes", {}).items()},
                comment=body.get("comment", ""),
                decision=body.get("decision"),
                surface="web"
            )
        if path == "/api/threads/attach":
            name, content = self.upload(body)
            return {"path": current.attach(name, content)}
        if path == "/api/threads/detach":
            current.detach(body.get("path", ""))
            return {"ok": True}
        return None

    def add_node(self, project, body):
        kind = body.get("kind", "generation")
        attachments = [self.upload(item) for item in body.get("attachments", [])]
        node = Node.create(project, kind, body.get("request", ""), body.get("style"), body.get("parents", []), attachments, body.get("tool"), surface="web")
        if kind == "tool":
            run_in_background(node)
        return {"node": node.id}

    def add_image(self, body, add, project=None):
        """A reference comes from an image in the project or from an upload."""
        if body.get("path"):
            source = (project or self.project(body)).resolve(body["path"])
            if not source.is_file() or source.suffix.lower() not in workspace.IMAGE_SUFFIXES:
                raise RecordError("no such image")
            return add(source)
        name, content = self.upload(body)
        folder = workspace.HOME / ".uploads"
        folder.mkdir(exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=folder, suffix=Path(name).suffix, delete=False) as file:
            file.write(content)
        upload = Path(file.name)
        try:
            return add(upload)
        finally:
            upload.unlink(missing_ok=True)

    def upload(self, body):
        name = workspace.upload_name(body.get("name", ""))
        try:
            content = base64.b64decode(body.get("data", ""), validate=True)
        except binascii.Error:
            raise RecordError("the image data is not base64")
        if not content:
            raise RecordError("the image is empty")
        return name, content

    def download(self, files):
        """Several workspace images as one zip, named by where they came from."""
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_STORED) as bundle:
            for item in files:
                source = workspace.resolve(item.get("path", ""))
                if not self.servable(source):
                    raise RecordError(f"no such image {item.get('path')}")
                bundle.write(source, Path(item.get("name") or source.name).name)
        self.send(200, archive.getvalue(), "application/zip")

    def project(self, values):
        name = values.get("project") or ""
        project = Project(workspace.PROJECTS / name)
        if not name or "/" in name or name.startswith(".") or not project.exists():
            raise RecordError("no such project")
        return project

    def style(self, values):
        project = self.project(values)
        name = values.get("style") or ""
        if "/" in name or name.startswith("."):
            raise RecordError("no such style")
        return project.style(name)

    def node(self, project, identifier):
        if not identifier or "/" in identifier or identifier.startswith("."):
            raise RecordError("no such node")
        return Node.at(workspace.relative(project.path / "nodes" / identifier))

    def thread(self, project, identifier):
        if not identifier or "/" in identifier or identifier.startswith("."):
            raise RecordError("no such thread")
        return Thread.at(workspace.relative(project.path / "threads" / identifier))

    def servable(self, path):
        return path.is_file() and path.suffix.lower() in workspace.IMAGE_SUFFIXES and workspace.inside(path, workspace.PROJECTS)

    def send_workspace_file(self, relative):
        """Only images inside projects/ are served."""
        try:
            path = workspace.resolve(relative)
        except (ValueError, OSError):
            return self.not_found()
        if not self.servable(path):
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

    def send_object(self, name):
        """An image kept under its hash, such as a reference at an earlier revision."""
        if len(name) != 40 or any(character not in "0123456789abcdef" for character in name) or not workspace.object_path(name).is_file():
            return self.not_found()
        content = workspace.read_object(name)
        media = workspace.image_type(content)
        if media is None:
            return self.not_found()
        self.send(200, content, media, f'"{name}"')

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
            # Images never change under their path (node, round, and reference files are written once and
            # references are never renumbered) and objects never change at all, so the browser keeps them.
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
