#!/usr/bin/env python3
"""Run the engine and the studio server end to end in a throwaway workspace, generating nothing and spending nothing.

Checks that every text on screen has its Korean, then makes a project and a style through its whole life (the style
thread, revisions with their reasons, drawing from the words alone, image and text references picked from the canvas
and annotated, a written node, a refine at a chosen revision, a revision restored), runs a tool node, turns an
ideation brief into a node, writes a project's brief in its thread, renames, copies, and deletes, asks the server for
every page's state and writes through it, and stores a key. Image generation is stood in for by writing images and their call records
where generate.py would. Exits 0 when everything holds, 1 with the failed checks otherwise.
"""

import base64
import json
import os
import re
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zlib
from pathlib import Path
from urllib.parse import quote

ENGINE = Path(__file__).resolve().parent / "engine"
failures = []


def check(name, ok):
    print(f"{'ok  ' if ok else 'FAIL'} {name}")
    if not ok:
        failures.append(name)


def png(path, color, size=8):
    """A small solid PNG, so the run needs no image library."""
    raw = b"".join(b"\x00" + bytes(color) * size for _ in range(size))
    path.write_bytes(encode(raw, size))


def disc(path):
    """A red disc on a light background: a subject Vision can lift."""
    size = 128
    rows = b"".join(b"\x00" + b"".join(bytes((220, 60, 60) if (x - 64) ** 2 + (y - 64) ** 2 < 35 ** 2 else (245, 245, 245)) for x in range(size)) for y in range(size))
    path.write_bytes(encode(rows, size))


def encode(rows, size):
    chunk = lambda kind, data: struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")


def inside(workspace):
    return {**os.environ, "ASSET_STUDIO_HOME": str(workspace)}


def engine(workspace, *arguments, ok=True):
    result = subprocess.run([sys.executable, str(ENGINE / arguments[0]), *arguments[1:]], env=inside(workspace), capture_output=True, text=True)
    if ok and result.returncode != 0:
        raise SystemExit(f"{' '.join(arguments)} failed: {result.stderr.strip()}")
    return result


def out(workspace, *arguments):
    return engine(workspace, *arguments).stdout.strip()


def draw(workspace, folder, colors, request="a request", model="test/model", into=""):
    """What generate.py leaves: images in the folder and a call record beside them."""
    folder = workspace / folder
    target = folder / into
    target.mkdir(parents=True, exist_ok=True)
    outputs = []
    for color in colors:
        path = target / f"{len(list(target.glob('*.png')))}-{'-'.join(map(str, color))}.png"
        png(path, color)
        outputs.append(path.relative_to(folder).as_posix())
    call = {"time": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "model": model, "revision": None, "request": request, "prompt": f"prompt for {request}", "references": [], "status": "ok", "outputs": outputs, "cost": 0.01 * len(outputs)}
    with (folder / "calls.jsonl").open("a") as file:
        file.write(json.dumps(call) + "\n")
    return [str(folder / output) for output in outputs]


def lifecycle(workspace):
    out(workspace, "project.py", "new", "demo")
    style_path, thread_path = out(workspace, "style.py", "new", "demo", "icon").splitlines()
    check("a new style opens its thread", style_path == "projects/demo/styles/icon" and thread_path == "projects/demo/threads/t1")
    check("a new thread waits for the user", out(workspace, "watch.py", "--once") == "")
    engine(workspace, "thread.py", "answer", thread_path, "--comment", "flat, warm")
    check("watch hands over a thread the user answered", out(workspace, "watch.py", "--once").split() == [thread_path])
    check("watch records that an agent looked", json.loads((workspace / "agent.json").read_text())["seen"] > 0)

    blocked = engine(workspace, "node.py", "add", "demo", "--style", "icon", "--request", "a cup", ok=False)
    check("a style without a model cannot draw", blocked.returncode != 0 and "no model" in blocked.stderr)
    style = workspace / style_path
    (style / "style.md").write_text("# icon\n\nA test style.\n\n## Color\n\n- warm colors\n\n## Never\n\n- gradients\n")
    (style / "style.json").write_text(json.dumps({"model": "test/model"}))
    (style / "prompting").mkdir()
    (style / "prompting/test--model.md").write_text("# icon on test\n")
    check("the agent's edits become a revision", out(workspace, "style.py", "revise", style_path, "--summary", "first words", "--reason", "from the thread", "--origin", "t1/001") == "1")
    first = json.loads((style / "revisions.jsonl").read_text().splitlines()[0])
    check("a revision keeps why it was made and where", first["reason"] == "from the thread" and first["origin"] == "t1/001" and first["source"] == "agent")
    candidates = draw(workspace, f"{thread_path}/002", [(200, 40, 40), (40, 40, 200)], model="draft/model")
    engine(workspace, "thread.py", "publish", f"{thread_path}/002", "--note", "which?", "--describe", "red", "--describe", "blue")
    shown = json.loads(out(workspace, "thread.py", "show", thread_path))
    check("a round shows its candidates with the model that drew them", [item["model"] for item in shown["rounds"][-1]["candidates"]] == ["draft/model", "draft/model"])

    node = out(workspace, "node.py", "add", "demo", "--style", "icon", "--request", "a cup")
    check("a style draws from its words alone, at its latest revision", json.loads((workspace / node / "node.json").read_text())["revision"] == 1)
    check("watch hands over a generation node", node in out(workspace, "watch.py", "--once").split())
    drawn = draw(workspace, node, [(220, 220, 40), (210, 210, 50)], "a cup")
    engine(workspace, "node.py", "publish", node, "--note", "two cups", "--review", "pass: holds", "--review", "leak: copied the mug handle", "--drop", "02.png=same subject")
    view = json.loads(out(workspace, "node.py", "show", node))
    check("a node keeps its images, revision, and dropped references", len(view["images"]) == 2 and view["revision"] == 1 and view["output"] == "image" and view["dropped"] == [{"reference": "02.png", "reason": "same subject"}])
    check("a drawn node is not published as a text", engine(workspace, "node.py", "publish", node, "--text", str(workspace / "agent.json"), ok=False).returncode != 0)

    engine(workspace, "style.py", "reference-add", style_path, drawn[0])
    engine(workspace, "style.py", "reference-add", style_path, drawn[0])
    engine(workspace, "style.py", "reference-add", style_path, drawn[1])
    check("a reference is added once and the user's change is a revision", len(list((style / "references").glob("*.png"))) == 2 and len((style / "revisions.jsonl").read_text().splitlines()) == 3)
    check("watch hands over references without annotations", style_path in out(workspace, "watch.py", "--once").split())
    for name in ("01.png", "02.png"):
        engine(workspace, "style.py", "annotate", f"{style_path}/references/{name}", "--role", "style", "--shows", "a cup", "--take", "the rendering", "--ignore", "the subject")
    engine(workspace, "style.py", "set-check", style_path)
    check("annotated and checked references need nothing", style_path not in out(workspace, "watch.py", "--once").split())

    written = out(workspace, "node.py", "add", "demo", "--request", "the app's palette")
    check("a request with no style is written as a text, and watch hands it over", json.loads(out(workspace, "node.py", "show", written))["output"] == "text" and written in out(workspace, "watch.py", "--once").split())
    check("a text request takes no attached images", engine(workspace, "node.py", "add", "demo", "--request", "x", "--attach", drawn[0], ok=False).returncode != 0)
    (workspace / "palette.md").write_text("# Palette\n\n- coral #FF7B75\n- yellow #FEE382\n")
    engine(workspace, "node.py", "publish", written, "--text", str(workspace / "palette.md"), "--note", "three colors")
    view = json.loads(out(workspace, "node.py", "show", written))
    check("a published text is not written again", engine(workspace, "node.py", "publish", written, "--text", str(workspace / "agent.json"), ok=False).returncode != 0 and "coral" in (workspace / written / "text.md").read_text())
    check("a written node shows its text", view["status"] == "done" and "coral #FF7B75" in view["text"] and view["text_path"] == f"nodes/{Path(written).name}/text.md")
    engine(workspace, "style.py", "reference-add", style_path, f"{workspace / written}/text.md")
    check("a text from the canvas becomes a text reference", (style / "references/03.md").read_text().startswith("# Palette"))
    check("a text reference needs no annotation", style_path not in out(workspace, "watch.py", "--once").split())
    (workspace / "tokens.txt").write_text("radius: 12\n")
    uploaded = out(workspace, "node.py", "add", "demo", "--upload", str(workspace / "tokens.txt"))
    check("an uploaded text is a node with its text", json.loads(out(workspace, "node.py", "show", uploaded))["text"] == "radius: 12\n")
    built = out(workspace, "node.py", "add", "demo", "--style", "icon", "--request", "a cup in these colors", "--parent", f"{workspace / written}/text.md")
    check("a request builds on a text", json.loads(out(workspace, "node.py", "show", built))["parents"] == [f"nodes/{Path(written).name}/text.md"])
    check("a tool works on images only", engine(workspace, "node.py", "add", "demo", "--tool", "cutout", "--parent", f"{workspace / written}/text.md", ok=False).returncode != 0)
    engine(workspace, "node.py", "delete", built)

    refine = out(workspace, "node.py", "add", "demo", "--style", "icon", "--revision", "1", "--request", "a bigger cup", "--parent", drawn[0])
    made = json.loads(out(workspace, "node.py", "show", refine))
    check("a generation draws with the revision the user chose", made["revision"] == 1 and made["parents"] == [f"nodes/n1/{Path(drawn[0]).name}"])
    check("a parent is an image or a text of the project", engine(workspace, "node.py", "add", "demo", "--style", "icon", "--request", "x", "--parent", f"{style_path}/references/01.png", ok=False).returncode != 0)
    check("a revision that does not exist is refused", engine(workspace, "node.py", "add", "demo", "--style", "icon", "--revision", "99", "--request", "x", ok=False).returncode != 0)
    (style / "style.json").write_text(json.dumps({"model": "other/model"}))
    (style / "prompting/other--model.md").write_text("# icon on other\n")
    engine(workspace, "style.py", "revise", style_path, "--summary", "other model")
    sys.path.insert(0, str(ENGINE))
    import workspace as home
    home.HOME, home.PROJECTS, home.OBJECTS = workspace, workspace / "projects", workspace / "objects"
    from generate import Target
    from workspace import RecordError
    check("a node draws with the model of its revision", Target(refine).model == "test/model")
    try:
        Target(written)
        check("a written node is not drawn", False)
    except RecordError:
        check("a written node is not drawn", True)
    materialized = workspace / "materialized"
    engine(workspace, "style.py", "materialize", style_path, str(materialized), "--revision", "1")
    check("materialize writes a revision as it was", "warm colors" in (materialized / "style.md").read_text() and not (materialized / "references").exists() and json.loads((materialized / "style.json").read_text())["model"] == "test/model")
    shown = out(workspace, "style.py", "show", style_path)
    check("show lists image and text references", "image  styles/icon/references/01.png  a cup" in shown and "text  styles/icon/references/03.md  # Palette" in shown)

    latest = len((style / "revisions.jsonl").read_text().splitlines())
    restored = out(workspace, "style.py", "restore", style_path, "1")
    check("restoring a revision brings its files back as a new revision", int(restored) == latest + 1 and not list((style / "references").glob("0*")))
    engine(workspace, "style.py", "restore", style_path, str(latest))
    check("restoring the later one brings the references back", len(list((style / "references").glob("0*.png"))) == 2 and (style / "references/03.md").exists())
    engine(workspace, "style.py", "reference-remove", style_path, "03.md")
    check("a text reference is removed by its name", not (style / "references/03.md").exists())

    if sys.platform == "darwin" and shutil.which("swift"):
        subject = workspace / "projects/demo/nodes/n1/subject.png"
        disc(subject)
        tool = out(workspace, "node.py", "add", "demo", "--tool", "cutout", "--parent", str(subject))
        result = json.loads((workspace / tool / "result.json").read_text())
        # PNG color type 6 is RGBA.
        check("a cutout node writes the subject with transparency", len(result["images"]) == 1 and (workspace / tool / result["images"][0]).read_bytes()[25] == 6)
    else:
        print("skip cutout, which needs macOS and Swift")

    talk = out(workspace, "thread.py", "open", style_path, "ideation", "--message", "an icon, no idea")
    check("ideation starts with the user's words", talk in out(workspace, "watch.py", "--once").split())
    engine(workspace, "thread.py", "publish", out(workspace, "thread.py", "next", talk), "--note", "a sun?")
    check("drawing waits for a brief", engine(workspace, "thread.py", "answer", talk, "--decision", "generate", ok=False).returncode != 0)
    engine(workspace, "thread.py", "answer", talk, "--comment", "the sun")
    (workspace / talk / "brief.md").write_text("# A sun icon\n\nCentered.\n")
    engine(workspace, "thread.py", "publish", out(workspace, "thread.py", "next", talk), "--note", "brief written")
    answer = json.loads(out(workspace, "thread.py", "answer", talk, "--decision", "generate"))
    made = json.loads(out(workspace, "node.py", "show", f"projects/demo/nodes/{answer['node']}"))
    check("an ideation brief becomes a generation node at the latest revision", made["request"].startswith("A sun icon") and made["thread"] == Path(talk).name and made["revision"] == len((style / "revisions.jsonl").read_text().splitlines()))

    renamed = out(workspace, "style.py", "rename", style_path, "glyph")
    check("renaming a style rewrites the records that name it", renamed == "projects/demo/styles/glyph" and json.loads((workspace / node / "node.json").read_text())["style"] == "glyph" and json.loads((workspace / thread_path / "thread.json").read_text())["style"] == "glyph")
    out(workspace, "project.py", "new", "other")
    copied = out(workspace, "style.py", "new", "other", "glyph", "--from", renamed).splitlines()[0]
    first = json.loads((workspace / copied / "revisions.jsonl").read_text().splitlines()[0])
    check("a copied style says where it came from", first["summary"].startswith("copied from demo/glyph"))
    check("a style is copied only from another project", engine(workspace, "style.py", "new", "demo", "twin", "--from", renamed, ok=False).returncode != 0)

    brief = out(workspace, "thread.py", "open", "projects/demo", "project", "--message", "icons for a demo app")
    check("a project thread starts with the user's words", brief in out(workspace, "watch.py", "--once").split())
    (workspace / "projects/demo/project.md").write_text("# demo\n\nIcons for a demo app.\n")
    engine(workspace, "thread.py", "publish", out(workspace, "thread.py", "next", brief), "--note", "brief written")
    shown = json.loads(out(workspace, "thread.py", "show", brief))
    check("a project thread shows the brief the agent wrote", shown["style"] is None and shown["rounds"][-1]["brief"].startswith("# demo") and shown["rounds"][-1]["spec"] is None)
    return node


def key(workspace):
    stored = subprocess.run([sys.executable, str(ENGINE / "workspace.py"), "key"], env=inside(workspace), input="sk-test\n", capture_output=True, text=True)
    path = workspace / "key"
    check("the key is stored for the user only", stored.returncode == 0 and path.read_text() == "sk-test\n" and path.stat().st_mode & 0o777 == 0o600)
    check("the key is not printed", "sk-test" not in stored.stdout + stored.stderr)


def server(workspace, node):
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    process = subprocess.Popen([sys.executable, str(ENGINE / "server.py"), "--port", str(port)], env=inside(workspace), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    base = f"http://127.0.0.1:{port}"
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(base + "/", timeout=1)
                break
            except OSError:
                time.sleep(0.1)

        def get(path, headers=None):
            try:
                with urllib.request.urlopen(urllib.request.Request(base + path, headers=headers or {}), timeout=5) as response:
                    return response.status, response.read()
            except urllib.error.HTTPError as error:
                return error.code, error.read()

        def post(path, body, content_type="application/json"):
            request = urllib.request.Request(base + path, data=json.dumps(body).encode(), headers={"Content-Type": content_type}, method="POST")
            try:
                with urllib.request.urlopen(request, timeout=5) as response:
                    return response.status, json.loads(response.read() or b"{}")
            except urllib.error.HTTPError as error:
                return error.code, json.loads(error.read() or b"{}")

        state = lambda path: json.loads(get(path)[1])
        for page in ("/", "/ui.js", "/ui.css", "/app.js", "/app.css", "/canvas.js", "/style.js", "/i18n.js"):
            check(f"serves {page}", get(page)[0] == 200)
        listed = state("/api/projects")
        check("lists projects with whether an agent is attached", [project["name"] for project in listed["projects"]] == ["demo", "other"] and listed["agent"]["seen"] is not None)
        project = state("/api/project?project=demo")
        check("a project's canvas state", [style["name"] for style in project["styles"]] == ["glyph"] and project["styles"][0]["revisions"][0] == {"number": 1, "summary": "first words", "blocked": None} and any(item["id"] == "n1" for item in project["nodes"]))
        reviewed = next(item for item in project["nodes"] if item["id"] == "n1")
        check("a node carries its reviews", reviewed["images"][0]["review"] == "pass: holds")
        style = state("/api/style?project=demo&style=glyph")
        check("a style's page shows the images drawn with each revision", [item["node"] for item in style["revisions"][0]["drawn"]] == ["n1", "n1"] and style["revisions"][0]["reason"] == "from the thread")
        reference = next(item["object"] for item in style["references"] if item["kind"] == "image")
        check("serves a reference by its object", get(f"/object/{reference}")[0] == 200)
        earlier = state("/api/revision?project=demo&style=glyph&revision=1")
        check("an earlier revision with what changed in its words", "warm colors" in earlier["spec"] and any(change["path"] == "style.md" and "+- warm colors" in change["diff"] for change in earlier["changes"]))
        check("a thread's state", state("/api/thread?project=demo&thread=t1")["rounds"][0]["note"])
        check("the archive", get("/api/archive")[0] == 200)
        check("a foreign host is refused", get("/api/projects", {"Host": "example.com"})[0] == 403)
        check("a plain text post is refused", post("/api/projects/delete", {"project": "demo"}, "text/plain")[0] == 415)
        png(workspace / "upload.png", (10, 200, 10))
        image = base64.b64encode((workspace / "upload.png").read_bytes()).decode()
        status, made = post("/api/nodes", {"project": "demo", "style": "glyph", "request": "a lamp", "attachments": [{"name": "스크린샷 2026-10-22 오전 1.02.03.png", "data": image}]})
        check("asks for a generation with an attachment named in Korean", status == 200 and next((workspace / "projects/demo/nodes" / made["node"] / "attachments").iterdir()).suffix == ".png")
        status, uploaded = post("/api/nodes", {"project": "demo", "kind": "upload", "attachments": [{"name": "a.png", "data": image}]})
        check("an upload is a node with its image", status == 200 and state("/api/project?project=demo")["nodes"][-1]["status"] == "done")
        check("saves the canvas", post("/api/canvas", {"project": "demo", "positions": {"n1": [10, 20], "zz": [0, 0]}})[1]["positions"] == {"n1": [10.0, 20.0]})
        frames = post("/api/canvas", {"project": "demo", "frames": [{"title": " icons ", "nodes": ["n1", "n2", "zz"]}, {"title": "again", "nodes": ["n1"]}]})[1]["frames"]
        check("a node is in one frame at most and an empty frame is gone", frames == [{"title": "icons", "nodes": ["n1", "n2"]}])
        canvas = json.loads((workspace / "projects/demo/canvas.json").read_text())
        (workspace / "projects/demo/canvas.json").write_text(json.dumps({**canvas, "frames": [{"title": "icons", "nodes": ["n1", "gone"]}]}))
        check("a canvas read leaves out nodes that are gone", state("/api/project?project=demo")["canvas"]["frames"] == [{"title": "icons", "nodes": ["n1"]}])
        status, opened = post("/api/threads", {"project": "demo", "style": "glyph", "message": "softer shadows"})
        check("a style thread opened with the user's words is the agent's turn", status == 200 and not state(f"/api/thread?project=demo&thread={opened['thread']}")["waiting"])
        status, opened = post("/api/threads", {"project": "demo", "kind": "project", "message": "they sit on a dark home screen"})
        brief_thread = state(f"/api/thread?project=demo&thread={opened['thread']}")
        check("what is written under the brief opens a project thread on the agent's turn", status == 200 and brief_thread["kind"] == "project" and not brief_thread["waiting"])
        check("a project's state says what it is for", state("/api/project?project=demo")["purpose"] == "Icons for a demo app.")
        status, made = post("/api/nodes", {"project": "demo", "style": "glyph", "revision": 1, "request": "an old cup"})
        check("asks for a generation at a chosen revision", status == 200 and json.loads((workspace / "projects/demo/nodes" / made["node"] / "node.json").read_text())["revision"] == 1)
        status, made = post("/api/nodes", {"project": "demo", "request": "brand colors"})
        check("asks for a written node", status == 200 and state("/api/project?project=demo")["nodes"][-1]["output"] == "text")
        text = base64.b64encode("# Tokens\n\nradius 12\n".encode()).decode()
        status, uploaded = post("/api/nodes", {"project": "demo", "kind": "upload", "attachments": [{"name": "tokens.md", "data": text}]})
        uploaded_text = next(item for item in state("/api/project?project=demo")["nodes"] if item["id"] == uploaded.get("node"))
        check("an uploaded text is a node with its text", status == 200 and uploaded_text["text"].startswith("# Tokens"))
        status, added = post("/api/styles/references/add", {"project": "demo", "style": "glyph", "path": uploaded_text["text_path"]})
        check("a text on the canvas goes into the references", status == 200 and added["path"].endswith(".md") and any(item["kind"] == "text" and item["text"].startswith("# Tokens") for item in state("/api/style?project=demo&style=glyph")["references"]))
        status, added = post("/api/styles/references/add", {"project": "demo", "style": "glyph", "name": "palette.txt", "data": base64.b64encode(b"coral\n").decode()})
        check("an uploaded text becomes a .md reference", status == 200 and added["path"].endswith(".md"))
        check("an attachment to a request is an image", post("/api/nodes", {"project": "demo", "style": "glyph", "request": "x", "attachments": [{"name": "a.md", "data": text}]})[0] == 400)
        status, created = post("/api/styles", {"project": "demo", "name": "새-스타일"})
        check("creates a style named in Korean with its thread", status == 200 and created["thread"])
        check("a name with capitals is refused", post("/api/projects/rename", {"project": "demo", "name": "Demo"})[0] == 400)
        check("renames a project", post("/api/projects/rename", {"project": "other", "name": "다른"})[0] == 200 and get(f"/api/project?project={quote('다른')}")[0] == 200)
        check("deletes a project", post("/api/projects/delete", {"project": "다른"})[0] == 200 and not (workspace / "projects/다른").exists())
    finally:
        process.terminate()
        process.wait()


def words():
    """Every text the studio shows is looked up in i18n.js, so each must have its Korean there."""
    web = ENGINE.parent / "web"
    korean = set(re.findall(r'^  ("(?:[^"\\]|\\.)*"): ', (web / "i18n.js").read_text(), re.M))
    shown = set()
    for name in ("app.js", "ui.js", "canvas.js", "style.js"):
        source = (web / name).read_text()
        shown.update(re.findall(r'\bt\(("(?:[^"\\]|\\.)*")', source))
        for singular, plural in re.findall(r'\btn\(("(?:[^"\\]|\\.)*"), ("(?:[^"\\]|\\.)*")', source):
            shown.update((singular, plural))
    page = (web / "index.html").read_text()
    shown.update(json.dumps(text, ensure_ascii=False) for text in re.findall(r"data-t>([^<]+)<", page) + re.findall(r'title="([^"]+)"[^>]*data-t-title', page))
    missing = sorted(shown - korean)
    check("every text on screen has its Korean" + (f" (missing {', '.join(missing)})" if missing else ""), not missing)


def main():
    words()
    workspace = Path(tempfile.mkdtemp(prefix="asset-studio-verify-")).resolve()
    try:
        server(workspace, lifecycle(workspace))
        key(workspace)
    finally:
        shutil.rmtree(workspace, ignore_errors=True)
    if failures:
        print(f"{len(failures)} failed", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
