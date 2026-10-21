#!/usr/bin/env python3
"""Run the engine and the studio server end to end in a throwaway workspace, generating nothing and spending nothing.

Checks that every text on screen has its Korean, then makes a style through its whole life (make session, discover, sample, confirm), opens generate and model
sessions, removes a background, talks a generate session into a brief, curates references, switches and removes models, renames and deletes, asks the server for
every page's state, and stores a key. Exits 0 when everything holds, 1 with the failed checks otherwise.
"""

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
from urllib.parse import quote
from pathlib import Path

ENGINE = Path(__file__).resolve().parent / "engine"
failures = []


def check(name, ok):
    print(f"{'ok  ' if ok else 'FAIL'} {name}")
    if not ok:
        failures.append(name)


def png(path, color):
    """A small solid PNG, so the run needs no image library."""
    width = height = 8
    raw = b"".join(b"\x00" + bytes(color) * width for _ in range(height))
    chunk = lambda kind, data: struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def disc(path):
    """A red disc on a light background: a subject Vision can lift."""
    size = 128
    rows = b"".join(b"\x00" + b"".join(bytes((220, 60, 60) if (x - 64) ** 2 + (y - 64) ** 2 < 35 ** 2 else (245, 245, 245)) for x in range(size)) for y in range(size))
    chunk = lambda kind, data: struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


def inside(workspace):
    return {**os.environ, "ASSET_STUDIO_HOME": str(workspace)}


def engine(workspace, *arguments, ok=True):
    result = subprocess.run([sys.executable, str(ENGINE / arguments[0]), *arguments[1:]], env=inside(workspace), capture_output=True, text=True)
    if ok and result.returncode != 0:
        raise SystemExit(f"{' '.join(arguments)} failed: {result.stderr.strip()}")
    return result


def ledger_entry(workspace, style, session, tag, outputs, model="test/model"):
    """What generate.py records after a call, written directly since the run makes no network calls."""
    entry = {"time": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "tag": tag, "session": session, "model": model, "request": f"{tag} request", "prompt": f"{tag} prompt", "status": "ok", "outputs": outputs, "cost": 0.0}
    with (workspace / "styles" / style / "ledger.jsonl").open("a") as file:
        file.write(json.dumps(entry) + "\n")


def draw(workspace, style, session, tag, colors, model="test/model"):
    round_directory = Path(engine(workspace, "session.py", "next", f"sessions/{style}/{session}").stdout.strip())
    paths = []
    for index, color in enumerate(colors):
        path = round_directory / f"{tag}-{index}-{len(list(round_directory.iterdir()))}.png"
        png(path, color)
        paths.append(path.relative_to(workspace).as_posix())
    ledger_entry(workspace, style, session, tag, paths, model)
    return round_directory


def lifecycle(workspace):
    engine(workspace, "session.py", "new", "demo")
    make = next((workspace / "sessions" / "demo").iterdir()).name
    session = f"sessions/demo/{make}"
    engine(workspace, "session.py", "answer", session, "--comment", "warm")
    check("watch hands over a session the user answered", engine(workspace, "session.py", "watch").stdout.split() == [session])
    (workspace / "styles/demo/style.md").write_text("# demo\n\nA test style.\n")
    round_directory = draw(workspace, "demo", make, "discover", [(200, 40, 40), (40, 40, 200)])
    engine(workspace, "session.py", "publish", str(round_directory), "--kind", "discover", "--describe", "one", "--describe", "two")
    engine(workspace, "session.py", "answer", session, "--picked", "1", "--note", "2=too dark", "--decision", "sample")
    (workspace / "styles/demo/prompting").mkdir()
    (workspace / "styles/demo/prompting/test--model.md").write_text("# demo on test\n")
    (workspace / "styles/demo/model").write_text("test/model\n")
    engine(workspace, "session.py", "publish", str(draw(workspace, "demo", make, "sample", [(40, 200, 40)])), "--kind", "sample")
    engine(workspace, "session.py", "answer", session, "--decision", "confirm")
    engine(workspace, "session.py", "publish", engine(workspace, "session.py", "next", session).stdout.strip(), "--kind", "confirm")
    engine(workspace, "session.py", "answer", session, "--picked", "1", "--decision", "done")
    engine(workspace, "session.py", "confirm", session)
    check("confirm makes references and ends the make session", len(list((workspace / "styles/demo/references").iterdir())) == 1 and not (workspace / "sessions/demo").exists())

    generate = Path(engine(workspace, "session.py", "open", "styles/demo", "generate").stdout.strip()).name
    engine(workspace, "session.py", "answer", f"sessions/demo/{generate}", "--request", "a cup", "--decision", "new")
    round_directory = draw(workspace, "demo", generate, "generate", [(220, 220, 40)])
    engine(workspace, "session.py", "publish", str(round_directory), "--kind", "generate")
    archive = (workspace / "styles/demo/archive/index.jsonl").read_text().splitlines()
    check("generate images are archived", any(json.loads(line)["kind"] == "generate" for line in archive))
    check("a board does not go to ideation", engine(workspace, "session.py", "answer", f"sessions/demo/{generate}", "--comment", "talk", "--decision", "discover", ok=False).returncode != 0)
    engine(workspace, "session.py", "answer", f"sessions/demo/{generate}", "--picked", "1", "--request", "a bigger cup", "--decision", "refine")
    engine(workspace, "session.py", "publish", str(draw(workspace, "demo", generate, "generate", [(200, 200, 60)])), "--kind", "generate")
    board = json.loads(engine(workspace, "session.py", "show", f"sessions/demo/{generate}").stdout)["candidates"]
    check("a refined image names the attempt it was drawn from", board[0]["refined_from"] is None and board[1]["refined_from"] == board[0]["path"])
    engine(workspace, "session.py", "rename", f"sessions/demo/{generate}", "  the  cup ")
    check("a session keeps the name the user gave it", json.loads((workspace / f"sessions/demo/{generate}/session.json").read_text())["name"] == "the cup")

    if sys.platform == "darwin" and shutil.which("swift"):
        subject = workspace / "subject.png"
        disc(subject)
        result = engine(workspace, "cutout.py", f"sessions/demo/{generate}", str(subject), "--request", "no background", ok=False)
        outputs = json.loads(result.stdout or "{}").get("outputs") or []
        # PNG color type 6 is RGBA.
        check("cutout writes the subject into the next round with transparency", result.returncode == 0 and len(outputs) == 1 and (workspace / outputs[0]).read_bytes()[25] == 6)
        if outputs:
            engine(workspace, "session.py", "publish", str((workspace / outputs[0]).parent), "--kind", "generate")
            check("a cutout is archived with its tool", json.loads((workspace / "styles/demo/archive/index.jsonl").read_text().splitlines()[-1]).get("tool") == "cutout")
    else:
        print("skip cutout, which needs macOS and Swift")

    image = next(round_directory.glob("*.png"))
    engine(workspace, "style.py", "reference-add", "styles/demo", str(image))
    engine(workspace, "style.py", "reference-add", "styles/demo", str(image))
    check("a reference is added once", len(list((workspace / "styles/demo/references").iterdir())) == 2)
    engine(workspace, "style.py", "reference-remove", "styles/demo", "02.png")
    check("a reference is removed", len(list((workspace / "styles/demo/references").iterdir())) == 1)

    model = Path(engine(workspace, "session.py", "open", "styles/demo", "model", "--model", "other/model").stdout.strip())
    check("a second session for the same model is refused", engine(workspace, "session.py", "open", "styles/demo", "model", "--model", "other/model", ok=False).returncode != 0)
    (model / "prompting.md").write_text("# demo on other\n")
    engine(workspace, "session.py", "publish", str(draw(workspace, "demo", model.name, "model", [(90, 90, 90)], "other/model")), "--kind", "model")
    engine(workspace, "session.py", "answer", f"sessions/demo/{model.name}", "--decision", "done")
    engine(workspace, "session.py", "add-model", f"sessions/demo/{model.name}")
    check("add-model adds the prompting file", (workspace / "styles/demo/prompting/other--model.md").exists())
    check("removing the model in use is refused", engine(workspace, "style.py", "model-remove", "styles/demo", "test/model", ok=False).returncode != 0)
    engine(workspace, "style.py", "use", "styles/demo", "other/model")
    engine(workspace, "style.py", "model-remove", "styles/demo", "test/model")
    check("a model not in use is removed", not (workspace / "styles/demo/prompting/test--model.md").exists())
    image_talk(workspace)
    return generate


def image_talk(workspace):
    """An ideation session: the agent works out the image in conversation, writes brief.md, and draws it there with the style."""
    talk = Path(engine(workspace, "session.py", "open", "styles/demo", "ideation").stdout.strip())
    session = f"sessions/demo/{talk.name}"
    archived = len((workspace / "styles/demo/archive/index.jsonl").read_text().splitlines())
    engine(workspace, "session.py", "answer", session, "--comment", "an icon, no idea what to draw")
    round_directory = draw(workspace, "demo", talk.name, "discover", [(250, 200, 0), (0, 120, 250)])
    engine(workspace, "session.py", "publish", str(round_directory), "--kind", "discover", "--note", "which idea?", "--describe", "a sun", "--describe", "a drop")
    check("talk candidates are not archived", len((workspace / "styles/demo/archive/index.jsonl").read_text().splitlines()) == archived)
    check("ideation does not go to sample", engine(workspace, "session.py", "answer", session, "--decision", "sample", ok=False).returncode != 0)
    check("drawing waits for a brief", engine(workspace, "session.py", "answer", session, "--picked", "1", "--decision", "generate", ok=False).returncode != 0)
    engine(workspace, "session.py", "answer", session, "--picked", "1", "--comment", "the sun")
    (talk / "brief.md").write_text("# A sun icon\n\nUse: an app icon.\n")
    engine(workspace, "session.py", "publish", engine(workspace, "session.py", "next", session).stdout.strip(), "--kind", "discover", "--note", "a sun, centered")
    check("ideation holds no board", engine(workspace, "session.py", "publish", engine(workspace, "session.py", "next", session).stdout.strip(), "--kind", "generate", ok=False).returncode != 0)
    engine(workspace, "session.py", "answer", session, "--decision", "generate")
    archived = len((workspace / "styles/demo/archive/index.jsonl").read_text().splitlines())
    engine(workspace, "session.py", "publish", str(draw(workspace, "demo", talk.name, "discover", [(250, 220, 0)], "other/model")), "--kind", "discover", "--note", "drawn from the brief")
    drawn = json.loads(engine(workspace, "session.py", "show", session).stdout)
    check("ideation draws from the brief in the conversation", drawn["kind"] == "discover" and drawn["brief"].startswith("# A sun icon") and len(drawn["candidates"]) == 1)
    check("a talk candidate drawn with the style is archived", len((workspace / "styles/demo/archive/index.jsonl").read_text().splitlines()) == archived + 1)
    check("the talk keeps every turn", [turn["kind"] for turn in drawn["thread"]] == ["discover"] * 4 and drawn["thread"][0]["message"])


def key(workspace):
    stored = subprocess.run([sys.executable, str(ENGINE / "workspace.py"), "key"], env=inside(workspace), input="sk-test\n", capture_output=True, text=True)
    path = workspace / "key"
    check("the key is stored for the user only", stored.returncode == 0 and path.read_text() == "sk-test\n" and path.stat().st_mode & 0o777 == 0o600)
    check("the key is not printed", "sk-test" not in stored.stdout + stored.stderr)


def server(workspace, generate):
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

        for page in ("/", "/ui.js", "/ui.css", "/app.js", "/app.css"):
            check(f"serves {page}", get(page)[0] == 200)
        status, body = get("/api/styles")
        check("lists styles", status == 200 and [style["name"] for style in json.loads(body)["styles"]] == ["demo"])
        status, body = get(f"/api/state?style=demo&session={generate}")
        check("a session's state", status == 200 and json.loads(body)["view"]["kind"] == "generate")
        check("the archive", get("/api/archive")[0] == 200)
        check("a foreign host is refused", get("/api/styles", {"Host": "example.com"})[0] == 403)
        check("a plain text post is refused", post("/api/styles/delete", {"style": "demo"}, "text/plain")[0] == 415)
        status, body = post("/api/sessions", {"style": "demo", "kind": "generate"})
        check("opens a generate session", status == 200 and (workspace / "sessions/demo" / body["session"]).is_dir())
        status, opened = post("/api/sessions", {"style": "demo", "kind": "ideation"})
        state = json.loads(get(f"/api/state?style=demo&session={opened.get('session')}")[1])
        check("opens an ideation session", status == 200 and state["view"]["kind"] == "discover" and state["session"]["kind"] == "ideation")
        check("renames a session", post("/api/sessions/rename", {"style": "demo", "session": body["session"], "name": "mugs"})[0] == 200 and next(session for session in json.loads(get("/api/state?style=demo")[1])["sessions"] if session["id"] == body["session"])["title"] == "mugs")
        check("an empty session name is refused", post("/api/sessions/rename", {"style": "demo", "session": body["session"], "name": " "})[0] == 400)
        check("deletes a session", post("/api/sessions/delete", {"style": "demo", "session": body["session"]})[0] == 200)
        check("a name with capitals is refused", post("/api/styles/rename", {"style": "demo", "name": "Demo"})[0] == 400)
        check("renames a style, to a Korean name", post("/api/styles/rename", {"style": "demo", "name": "데모-둘"})[0] == 200 and (workspace / "styles/데모-둘/style.md").read_text().startswith("# 데모-둘"))
        check("a Korean-named style's state", get(f"/api/state?style={quote('데모-둘')}")[0] == 200)
        check("deletes a style", post("/api/styles/delete", {"style": "데모-둘"})[0] == 200 and not (workspace / "styles/데모-둘").exists() and not (workspace / "sessions/데모-둘").exists())
    finally:
        process.terminate()
        process.wait()


def words():
    """Every text the studio shows is looked up in i18n.js, so each must have its Korean there."""
    web = ENGINE.parent / "web"
    korean = set(re.findall(r'^  ("(?:[^"\\]|\\.)*"): ', (web / "i18n.js").read_text(), re.M))
    shown = set()
    for name in ("app.js", "ui.js"):
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
        (workspace / "styles").mkdir()
        server(workspace, lifecycle(workspace))
        key(workspace)
    finally:
        shutil.rmtree(workspace, ignore_errors=True)
    if failures:
        print(f"{len(failures)} failed", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
