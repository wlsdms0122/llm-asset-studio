// Measures the canvas while it pans and zooms, from a Chrome trace, with a studio already serving:
//   node source/perf.mjs <port> <project> [zoom]      zoom is where the gesture starts, 0.15 by default
// Prints the time spent per kind of work (style, layout, paint, raster, image decode) over one fixed gesture of 60
// frames of panning and 60 of zooming, so two versions of the page can be compared on the same project.
// Needs Node 22 or later and Google Chrome.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [port, project, zoomArg] = process.argv.slice(2);
const startZoom = Number(zoomArg || 0.15);
const profile = mkdtempSync(join(tmpdir(), "asset-studio-perf-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--remote-debugging-port=9334", `--user-data-dir=${profile}`, "--window-size=1600,1000", "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch("http://127.0.0.1:9334/json")).json()).find(t => t.type === "page"); } catch {} }
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => socket.addEventListener("open", r));
let id = 0; const waiting = new Map(); const events = [];
let traceDone;
socket.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } if (m.method === "Tracing.dataCollected") events.push(...m.params.value); if (m.method === "Tracing.tracingComplete") traceDone(); });
const send = (method, params = {}) => new Promise(r => { const n = ++id; waiting.set(n, r); socket.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async expression => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false });
await send("Page.navigate", { url: `http://127.0.0.1:${port}/#/p/${project}` });
await sleep(4000);
await evaluate(`(async () => { fitView(); board.view.zoom = ${startZoom}; applyView(); await new Promise(r => setTimeout(r, 2500)); })()`);
await send("Tracing.start", { categories: "devtools.timeline,disabled-by-default-devtools.timeline,cc,blink", transferMode: "ReportEvents" });
const frames = await evaluate(`(async () => {
  const times = []; let last = performance.now();
  for (let i = 0; i < 120; i++) {
    if (i < 60) { board.view.x += (i % 30 < 15 ? 8 : -8); applyView(); } else zoomBy(i % 30 < 15 ? 1.04 : 1 / 1.04, [800, 450]);
    await new Promise(r => requestAnimationFrame(r)); const now = performance.now(); times.push(now - last); last = now;
  }
  return times.reduce((a, b) => a + b) / times.length;
})()`);
await sleep(500);
const done = new Promise(r => { traceDone = r; });
await send("Tracing.end");
await done;
const wanted = { UpdateLayoutTree: "style", RecalcStyles: "style", Layout: "layout", Paint: "paint", PaintImage: "paint image", RasterTask: "raster", "ImageDecodeTask": "decode", "Decode Image": "decode", UpdateLayerTree: "layer tree", "PrePaint": "prepaint", "Commit": "commit" };
const totals = {};
for (const e of events) { const k = wanted[e.name]; if (k && e.dur) totals[k] = (totals[k] || 0) + e.dur / 1000; }
const count = await evaluate("board.data.nodes.length");
console.log(JSON.stringify({ project, nodes: count, zoom: startZoom, frameAvg: +frames.toFixed(1), ms: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.round(v)])) }));
chrome.kill();
await sleep(300);
rmSync(profile, { recursive: true, force: true });
process.exit(0);
