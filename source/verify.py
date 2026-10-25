#!/usr/bin/env python3
"""Run the engine and the studio server end to end in a throwaway workspace, generating nothing and spending nothing.

Checks that every text on screen has its Korean, then makes a project and a style through its whole life (the style
thread, probes drawn from the words alone, references picked from them and annotated, generation nodes and a refine,
a proposal tried with probes and accepted, a stale proposal refused, a revision restored), extends a guide, runs a
tool node, turns an ideation brief into a node, renames, copies, and deletes, asks the server for every page's state
and writes through it, and stores a key. Image generation is stood in for by writing images and their call records
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

    style = workspace / style_path
    (style / "style.md").write_text("# icon\n\nA test style.\n\n## Color\n\n- warm colors\n\n## Never\n\n- gradients\n")
    (style / "style.json").write_text(json.dumps({"model": "test/model", "extends": [], "guide": False}))
    (style / "prompting").mkdir()
    (style / "prompting/test--model.md").write_text("# icon on test\n")
    (style / "probes.md").write_text("- a mug\n- a chair\n")
    check("the agent's edits become a revision", out(workspace, "style.py", "revise", style_path, "--summary", "first words") == "1")
    candidates = draw(workspace, f"{thread_path}/002", [(200, 40, 40), (40, 40, 200)], model="draft/model")
    engine(workspace, "thread.py", "publish", f"{thread_path}/002", "--note", "which?", "--describe", "red", "--describe", "blue")
    shown = json.loads(out(workspace, "thread.py", "show", thread_path))
    check("a round shows its candidates with the model that drew them", [item["model"] for item in shown["rounds"][-1]["candidates"]] == ["draft/model", "draft/model"])

    blocked = engine(workspace, "node.py", "add", "demo", "--style", "icon", "--request", "a cup", ok=False)
    check("a style without references cannot draw", blocked.returncode != 0 and "references" in blocked.stderr)

    run = out(workspace, "probe.py", "request", style_path)
    check("watch hands over a probe run", run in out(workspace, "watch.py", "--once").split())
    images = draw(workspace, run, [(220, 120, 40)], "a mug") + draw(workspace, run, [(200, 140, 60)], "a chair")
    check("a run takes one image per request", engine(workspace, "probe.py", "publish", run, images[0], ok=False).returncode != 0)
    engine(workspace, "probe.py", "publish", run, *images, "--note", "first probes")
    check("a run shows the revision it drew", json.loads(out(workspace, "probe.py", "show", run))["revision"] == 1)

    engine(workspace, "style.py", "reference-add", style_path, images[0])
    engine(workspace, "style.py", "reference-add", style_path, images[0])
    engine(workspace, "style.py", "reference-add", style_path, images[1])
    check("a reference is added once and the user's change is a revision", len(list((style / "references").glob("*.png"))) == 2 and len((style / "revisions.jsonl").read_text().splitlines()) == 3)
    check("watch hands over references without annotations", style_path in out(workspace, "watch.py", "--once").split())
    for name in ("01.png", "02.png"):
        engine(workspace, "style.py", "annotate", f"{style_path}/references/{name}", "--role", "style", "--shows", "a mug", "--take", "the rendering", "--ignore", "the subject")
    engine(workspace, "style.py", "set-check", style_path)
    check("annotated and checked references need nothing", style_path not in out(workspace, "watch.py", "--once").split())

    node = out(workspace, "node.py", "add", "demo", "--style", "icon", "--request", "a cup")
    check("watch hands over a generation node", node in out(workspace, "watch.py", "--once").split())
    drawn = draw(workspace, node, [(220, 220, 40), (210, 210, 50)], "a cup")
    engine(workspace, "node.py", "publish", node, "--note", "two cups", "--review", "pass: holds", "--review", "leak: copied the mug handle", "--drop", "02.png=same subject")
    view = json.loads(out(workspace, "node.py", "show", node))
    check("a node keeps its images, revision, and dropped references", len(view["images"]) == 2 and view["revision"] == 5 and view["dropped"] == [{"reference": "02.png", "reason": "same subject"}])
    refine = out(workspace, "node.py", "add", "demo", "--style", "icon", "--request", "a bigger cup", "--parent", drawn[0])
    check("a refine names the image it builds on", json.loads(out(workspace, "node.py", "show", refine))["parents"] == [f"nodes/n1/{Path(drawn[0]).name}"])
    check("a parent must be an image of the project", engine(workspace, "node.py", "add", "demo", "--style", "icon", "--request", "x", "--parent", f"{style_path}/references/01.png", ok=False).returncode != 0)

    (workspace / "proposed.md").write_text((style / "style.md").read_text().replace("warm colors", "warm colors, at most three"))
    proposal = out(workspace, "proposal.py", "propose", style_path, "--summary", "three colors", "--reason", "too busy", "--source", "n1", "--set", f"style.md={workspace / 'proposed.md'}")
    check("a proposal shows its diff", "+- warm colors, at most three" in out(workspace, "proposal.py", "show", style_path, proposal))
    proposed_run = out(workspace, "probe.py", "request", style_path, "--proposal", proposal)
    engine(workspace, "probe.py", "publish", proposed_run, *draw(workspace, proposed_run, [(230, 120, 40)], "a mug"), *draw(workspace, proposed_run, [(230, 140, 60)], "a chair"))
    accepted = out(workspace, "proposal.py", "accept", style_path, proposal)
    check("an accepted proposal is the next revision, and its probes show it", "at most three" in (style / "style.md").read_text() and json.loads(out(workspace, "probe.py", "show", proposed_run))["revision"] == int(accepted))

    (workspace / "late.md").write_text("# icon\n\nlate\n")
    late = out(workspace, "proposal.py", "propose", style_path, "--summary", "late", "--reason", "r", "--set", f"style.md={workspace / 'late.md'}")
    (style / "style.md").write_text((style / "style.md").read_text() + "\n## Mood\n\n- calm\n")
    engine(workspace, "style.py", "revise", style_path, "--summary", "mood")
    check("a proposal written before the style changed is refused", engine(workspace, "proposal.py", "accept", style_path, late, ok=False).returncode != 0)
    restored = out(workspace, "style.py", "restore", style_path, "1")
    check("restoring a revision brings its files back as a new revision", "at most three" not in (style / "style.md").read_text() and not list((style / "references").glob("*.png")) and int(restored) > int(accepted))
    engine(workspace, "style.py", "restore", style_path, str(int(restored) - 1))

    out(workspace, "style.py", "new", "demo", "palette", "--guide")
    guide = workspace / "projects/demo/styles/palette"
    (guide / "style.md").write_text("# palette\n\n## Color\n\n- coral, yellow, sky\n\n## Never\n\n- gray\n")
    engine(workspace, "style.py", "revise", "projects/demo/styles/palette", "--summary", "colors")
    out(workspace, "style.py", "new", "demo", "branded")
    branded = workspace / "projects/demo/styles/branded"
    (branded / "style.md").write_text("# branded\n\n## Mood\n\n- calm\n")
    engine(workspace, "style.py", "extends", "projects/demo/styles/branded", "icon", "palette")
    effective = out(workspace, "style.py", "effective", "projects/demo/styles/branded")
    check("an extending style takes later sections over earlier ones and adds up Never", "coral, yellow, sky" in effective and "warm colors" not in effective and "- gray" in effective and "- gradients" in effective and "- calm" in effective)
    check("a guide draws nothing", engine(workspace, "probe.py", "request", "projects/demo/styles/palette", ok=False).returncode != 0)
    check("an extend that loops is refused", engine(workspace, "style.py", "extends", style_path, "branded", ok=False).returncode != 0)
    (guide / "style.md").write_text((guide / "style.md").read_text().replace("sky", "mint"))
    sys.path.insert(0, str(ENGINE))
    os.environ["ASSET_STUDIO_HOME"] = str(workspace)
    import workspace as home
    from project import Project
    home.HOME, home.PROJECTS, home.OBJECTS = workspace, workspace / "projects", workspace / "objects"
    check("a changed base marks the styles that extend it", Project(workspace / "projects/demo").style("branded").stale_bases() == ["palette"])
    materialized = workspace / "materialized"
    engine(workspace, "style.py", "materialize", "projects/demo/styles/branded", str(materialized))
    check("materialize writes the effective style and the references of the base it draws with", "mint" in (materialized / "style.md").read_text() and len(list((materialized / "references").glob("*.png"))) == 2)
    (workspace / "escape.md").write_text("x")
    check("a proposal cannot reach outside the style", engine(workspace, "proposal.py", "propose", style_path, "--summary", "s", "--reason", "r", "--set", f"references/../../../../../escaped.md={workspace / 'escape.md'}", ok=False).returncode != 0 and not (workspace / "escaped.md").exists())
    out(workspace, "style.py", "new", "demo", "scratch")
    engine(workspace, "style.py", "extends", "projects/demo/styles/scratch", "palette")
    engine(workspace, "style.py", "extends", "projects/demo/styles/scratch")
    engine(workspace, "style.py", "extends", "projects/demo/styles/palette", "scratch")
    looping = len((workspace / "projects/demo/styles/scratch/revisions.jsonl").read_text().splitlines()) - 1
    check("restoring a revision that would make extends loop is refused", engine(workspace, "style.py", "restore", "projects/demo/styles/scratch", str(looping), ok=False).returncode != 0)
    engine(workspace, "style.py", "extends", "projects/demo/styles/palette")
    engine(workspace, "style.py", "delete", "projects/demo/styles/scratch")
    check("deleting an extended style is refused", engine(workspace, "style.py", "delete", "projects/demo/styles/palette", ok=False).returncode != 0)

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
    check("an ideation brief becomes a generation node", made["request"].startswith("A sun icon") and made["thread"] == Path(talk).name)

    renamed = out(workspace, "style.py", "rename", style_path, "glyph")
    check("renaming a style rewrites the records that name it", renamed == "projects/demo/styles/glyph" and json.loads((workspace / node / "node.json").read_text())["style"] == "glyph" and json.loads((workspace / thread_path / "thread.json").read_text())["style"] == "glyph")
    out(workspace, "project.py", "new", "other")
    copied = out(workspace, "style.py", "new", "other", "glyph", "--from", renamed).splitlines()[0]
    first = json.loads((workspace / copied / "revisions.jsonl").read_text().splitlines()[0])
    check("a copied style says where it came from", first["summary"].startswith("copied from demo/glyph") and json.loads((workspace / copied / "style.json").read_text())["extends"] == [])
    engine(workspace, "project.py", "subject-add", "demo", drawn[0])
    check("watch hands over a subject without its annotation", "projects/demo/subjects" in out(workspace, "watch.py", "--once").split())
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
        for page in ("/", "/ui.js", "/ui.css", "/app.js", "/app.css", "/canvas.js", "/i18n.js"):
            check(f"serves {page}", get(page)[0] == 200)
        listed = state("/api/projects")
        check("lists projects with whether an agent is attached", [project["name"] for project in listed["projects"]] == ["demo", "other"] and listed["agent"]["seen"] is not None)
        project = state("/api/project?project=demo")
        check("a project's canvas state", {style["name"] for style in project["styles"]} == {"glyph", "palette", "branded"} and any(item["id"] == "n1" for item in project["nodes"]))
        built_on = next(item for item in project["nodes"] if item["id"] == "n1")
        check("a node built on shows its reviews", built_on["images"][0]["review"] == "pass: holds")
        style = state("/api/style?project=demo&style=glyph")
        check("a style's page state", state("/api/style?project=demo&style=branded")["extends"] == ["glyph", "palette"] and style["leaks"] == {"reviewed": 2, "leaked": 1} and style["proposals"][0]["files"][0]["diff"])
        reference = next(item["object"] for item in state("/api/style?project=demo&style=branded")["drawn_with"])
        check("serves a reference by its object", get(f"/object/{reference}")[0] == 200)
        check("an earlier revision", "warm colors" in state("/api/revision?project=demo&style=glyph&revision=1")["spec"])
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
        status, opened = post("/api/threads", {"project": "demo", "style": "glyph", "message": "softer shadows"})
        check("a style thread opened with the user's words is the agent's turn", status == 200 and not state(f"/api/thread?project=demo&thread={opened['thread']}")["waiting"])
        (workspace / "victim.md").write_text("keep")
        check("an edit cannot reach outside the style", post("/api/styles/edit", {"project": "demo", "style": "glyph", "file": "prompting/../../../../../victim.md", "text": "x"})[0] == 400 and (workspace / "victim.md").read_text() == "keep")
        check("edits style.md as a revision", post("/api/styles/edit", {"project": "demo", "style": "glyph", "file": "style.md", "text": "# glyph\n\nedited\n"})[0] == 200 and state("/api/style?project=demo&style=glyph")["revisions"][-1]["source"] == "owner")
        check("asks for a probe run", post("/api/runs", {"project": "demo", "style": "glyph"})[0] == 200)
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
    for name in ("app.js", "ui.js", "canvas.js"):
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
