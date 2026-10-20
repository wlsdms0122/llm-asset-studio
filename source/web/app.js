"use strict";

// The studio's pages, built from the components in ui.js.

// ---------- vocabulary ----------

const STAGES = [["discover", "스타일"], ["sample", "샘플"], ["confirm", "확정"]];
const KIND_NAMES = { discover: "스타일", sample: "샘플", confirm: "확정", generate: "생성", model: "모델 추가" };
const SESSION_NAMES = { make: "스타일 만들기", generate: "이미지", model: "모델 추가" };
// A generate session is named by how it goes: making an image from a request, or ideation.
const sessionName = session => session.ideation ? "아이데이션" : SESSION_NAMES[session.kind];
// What the agent is doing after each answer, shown until the next round arrives.
const WAITING = { sample: "샘플 준비 중", discover: "대화를 준비하는 중", confirm: "레퍼런스 후보 준비 중", generate: "그리는 중", request: "그리는 중", done: "마무리하는 중", refine: "그리는 중", new: "그리는 중" };
const CONTINUING = { discover: "답을 읽고 있어요", confirm: "후보를 더 만드는 중" };
const DRAWING = ["request", "refine", "new"];

// ---------- small helpers ----------

const money = value => value == null ? "-" : `$${value < 0.01 && value > 0 ? value.toFixed(4) : value.toFixed(3)}`;
const pad = (number, width = 2) => String(number).padStart(width, "0");
const shortModel = model => (model || "").split("/").pop();
const fileName = path => path.split("/").pop();

function when(time) {
  if (!time) return "";
  const date = new Date(time.replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
  const minutes = Math.round((Date.now() - date) / 60000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}시간 전`;
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(value.error || `요청이 실패했어요 (${response.status})`), { status: response.status });
  return value;
}

function readFile(file) {
  return new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(",")[1]); reader.readAsDataURL(file); });
}

// ---------- state ----------

let route = { name: "home" };
let data = null;
let draft = freshDraft();
let panelTab = "work";
let rendered = null;
// Whether the session view is pinned to its newest content; images that finish loading keep it there.
let following = false;
let archiveData = null;
let selecting = null;
// The model list with prices, read once per page load; the server keeps it for a day.
let catalogModels = null;

function freshDraft(key = null, picked = []) {
  return { key, picked: new Set(picked), notes: {}, comment: "", request: "" };
}

// A draft belongs to one round of one session.
const draftKey = current => `${data.style}|${current.session}|${current.round}|${current.opened}`;

const view = () => data && data.view;
const kind = () => view() && view().kind;
const answering = () => Boolean(view() && !view().feedback);
const selectable = () => answering() && ["discover", "confirm", "generate"].includes(kind());

// ---------- routing ----------

function readRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  if (parts[0] === "s" && parts[1]) return { name: "style", style: decodeURIComponent(parts[1]), session: parts[2] ? decodeURIComponent(parts[2]) : null };
  if (parts[0] === "archive") return { name: "archive", filter: parts[1] ? decodeURIComponent(parts[1]) : null };
  return { name: "home" };
}

const styleHash = (style, session = null) => `#/s/${encodeURIComponent(style)}${session ? `/${encodeURIComponent(session)}` : ""}`;

function go() {
  route = readRoute();
  data = null;
  rendered = null;
  following = false;
  draft = freshDraft();
  panelTab = "work";
  selecting = null;
  closeMenu();
  document.querySelectorAll("[data-nav]").forEach(link => link.classList.toggle("on", link.dataset.nav === route.name));
  fill($("view"), );
  load();
}
window.addEventListener("hashchange", go);

async function load() {
  try {
    if (route.name === "home") await loadHome();
    else if (route.name === "archive") await loadArchive();
    else await loadStyle();
    $("lost").hidden = true;
  } catch (error) {
    if (error instanceof TypeError) $("lost").hidden = false;
    // A session that ended (a model added, a session deleted elsewhere) sends the page back to its style.
    else if (route.name === "style" && error.status === 404 && route.session) location.hash = styleHash(route.style);
    else if (route.name === "style" && (!data || error.status === 404)) renderMissing(error.message);
  }
}

// A style page re-renders only when something the user can see has changed, so typing is never lost.
async function loadStyle() {
  const query = `style=${encodeURIComponent(route.style)}${route.session ? `&session=${encodeURIComponent(route.session)}` : ""}`;
  const next = await api(`/api/state?${query}`);
  // Inside a session only that session counts; the overview also follows the session list and the archive.
  const signature = state => state && JSON.stringify(state.session
    ? [state.session.id, state.view && [state.view.round, Boolean(state.view.feedback), state.view.attachments.length, state.view.candidates.length]]
    : [state.sessions.map(session => [session.id, session.title, session.waiting]), state.archive.length, state.overview.references, state.overview.model, state.overview.models, state.overview.confirmed]);
  const changed = signature(data) !== signature(next);
  data = next;
  if (changed) renderStyle();
}

// ---------- user actions on styles and references ----------

const STYLE_NAME = /^[a-z0-9][a-z0-9-]{1,40}$/;
const NAME_RULE = "영문 소문자, 숫자, 하이픈으로 두 글자 이상 적어 주세요.";

async function askName({ title, description = "", value = "", confirm, submit }) {
  let error = "";
  for (;;) {
    const name = await ask({ title, description, value, error, placeholder: "이름, 예: blog-cover", confirm, input: "text" });
    if (name == null) return;
    value = name;
    if (!STYLE_NAME.test(name)) { error = NAME_RULE; continue; }
    try { return await submit(name); }
    catch (failure) { error = failure.message.includes("already exists") ? "같은 이름의 스타일이 있어요." : failure.message; }
  }
}

function newStyle(base = null) {
  return askName({
    title: base ? `${base} 바탕의 새 스타일` : "새 스타일",
    description: base ? "바탕 스타일의 설명과 레퍼런스를 가지고 대화를 시작해요." : "대화로 원하는 스타일을 함께 찾아요.",
    confirm: "만들기",
    submit: async name => { const result = await api("/api/styles", { name, base }); location.hash = styleHash(result.style); }
  });
}
$("new-style").addEventListener("click", () => newStyle());

function renameStyle(style) {
  return askName({
    title: "이름 변경", value: style, confirm: "바꾸기",
    submit: async name => {
      if (name === style) return;
      await api("/api/styles/rename", { style, name });
      if (route.name === "style") location.hash = styleHash(name);
      else load();
    }
  });
}

async function deleteStyle(style) {
  const yes = await ask({ title: `${style} 삭제`, description: "스타일과 레퍼런스, 보관함 이미지, 세션이 모두 지워져요. 되돌릴 수 없어요.", confirm: "삭제", input: null, danger: true });
  if (!yes) return;
  try { await api("/api/styles/delete", { style }); if (route.name === "style") location.hash = "#/"; else load(); }
  catch (error) { toast(error.message, "error"); }
}

// Adding an image to a style's references is one action; the references themselves are managed where they are listed.
async function addToReferences(style, path) {
  try {
    const result = await api("/api/references/add", { style, path });
    toast(result.added ? "레퍼런스에 추가했어요" : "이미 레퍼런스에 있어요");
    load();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function removeReference(path) {
  try { await api("/api/references/remove", { style: data.style, file: fileName(path) }); toast("레퍼런스에서 뺐어요"); load(); }
  catch (error) { toast(error.message, "error"); }
}

// ---------- lightbox ----------

let gallery = { items: [], index: 0 };

// items: [{ path, name, info: [[title, text, mono?]], add: { style, path } | null }]
function openLightbox(items, index) {
  gallery = { items, index };
  showLightboxItem();
  $("lightbox").hidden = false;
}

function showLightboxItem() {
  const item = gallery.items[gallery.index];
  $("lightbox-image").src = fileUrl(item.path);
  $("lightbox-download").href = fileUrl(item.path);
  $("lightbox-download").download = item.name || fileName(item.path);
  $("lightbox-count").textContent = gallery.items.length > 1 ? `${gallery.index + 1} / ${gallery.items.length}` : "";
  $("lightbox-previous").hidden = $("lightbox-next").hidden = gallery.items.length < 2;
  $("lightbox-add").hidden = !item.add;
  const info = (item.info || []).filter(([, text]) => text);
  $("lightbox").classList.toggle("bare", !info.length);
  fill($("lightbox-info"), ...info.flatMap(([title, text, mono]) => [h("h3", { text: title }), mono ? h("pre", { class: "document", text }) : h("p", { text })]));
}

function stepLightbox(by) {
  gallery.index = (gallery.index + by + gallery.items.length) % gallery.items.length;
  showLightboxItem();
}

$("lightbox-download").innerHTML = icon("download");
$("lightbox-close").innerHTML = icon("close");
$("lightbox-add").innerHTML = icon("reference");
$("lightbox-previous").innerHTML = icon("previous");
$("lightbox-next").innerHTML = icon("next");
$("lightbox-previous").addEventListener("click", () => stepLightbox(-1));
$("lightbox-next").addEventListener("click", () => stepLightbox(1));
$("lightbox-close").addEventListener("click", () => { $("lightbox").hidden = true; });
$("lightbox-add").addEventListener("click", () => { const { add } = gallery.items[gallery.index]; addToReferences(add.style, add.path); });
$("lightbox").addEventListener("click", event => { if (event.target.classList.contains("lightbox-stage")) $("lightbox").hidden = true; });

document.addEventListener("keydown", event => {
  if (!$("lightbox").hidden) {
    if (event.key === "Escape") $("lightbox").hidden = true;
    if (event.key === "ArrowLeft") stepLightbox(-1);
    if (event.key === "ArrowRight") stepLightbox(1);
    return;
  }
  if (event.key === "Escape" && !$("menu").hidden) closeMenu();
  if (event.key === "Escape" && !$("modal").hidden) closeModal(null);
});

// ---------- home ----------

function statusPill(summary) {
  if (summary.kind && summary.waiting) return pill(`${KIND_NAMES[summary.kind]} · 내 차례`, { tone: "accent", dot: "static" });
  if (summary.working) return pill(summary.kind ? `${KIND_NAMES[summary.kind]} · 작업 중` : "작업 중", { tone: "accent", dot: "live" });
  if (summary.confirmed) return pill("확정", { tone: "success" });
  return pill("시작 전");
}

// Every page redraws only when what it shows has changed; a redraw on every poll makes the images flicker.
let homeData = null;

async function loadHome() {
  const next = await api("/api/styles");
  const changed = JSON.stringify(next) !== JSON.stringify(homeData);
  homeData = next;
  if (changed || !$("home")) renderHome(next);
}

function renderHome(home) {
  document.title = "스타일 · Asset Studio";
  const cards = home.styles.map(summary => h("a", {
    class: "card", href: styleHash(summary.name),
    oncontextmenu: event => {
      event.preventDefault();
      openMenu({ x: event.clientX, y: event.clientY }, [
        { label: "이름 변경", onClick: () => renameStyle(summary.name) },
        summary.confirmed ? { label: "이 스타일에서 새 스타일", onClick: () => newStyle(summary.name) } : null,
        { label: "삭제", onClick: () => deleteStyle(summary.name), danger: true }
      ]);
    }
  }, [
    summary.cover ? imageFrame(summary.cover, { fit: "fill" }) : h("div", { class: "placeholder", text: "아직 이미지가 없어요" }),
    h("div", { class: "card-body" }, [
      h("div", { class: "card-title" }, [h("strong", { text: summary.name }), statusPill(summary)]),
      h("p", { class: "card-purpose", text: summary.purpose || "대화로 스타일을 찾는 중이에요." }),
      h("div", { class: "card-meta" }, [
        summary.based_on ? h("span", { text: `${summary.based_on} 바탕` }) : null,
        summary.archived ? h("span", { text: `보관 ${summary.archived}` }) : null
      ])
    ])
  ]));

  fill($("view"), h("div", { class: "page", id: "home" }, [
    h("div", { class: "page-head" }, [h("div", {}, [h("h1", { text: "스타일" }), h("p", { text: `${home.styles.length}개의 스타일` })])]),
    cards.length ? h("div", { class: "cards" }, cards) : emptyState({ title: "첫 스타일을 만들어 보세요", text: "원하는 그림을 대화로 설명하면 스타일을 함께 정리해 드려요.", action: button("새 스타일", { variant: "primary", onClick: () => newStyle() }) })
  ]));
}

// ---------- archive ----------

async function loadArchive() {
  const next = await api("/api/archive");
  const changed = JSON.stringify(next) !== JSON.stringify(archiveData);
  archiveData = next;
  if (changed || !$("archive-grid")) renderArchive();
}

function archiveItems() {
  const all = archiveData.styles.flatMap(shelf => [...shelf.items].reverse().map(item => ({ ...item, style: shelf.style })));
  return { all, shown: route.filter ? all.filter(item => item.style === route.filter) : all };
}

function lightboxFromArchive(item) {
  return {
    path: item.file,
    name: `${item.style}-${fileName(item.file)}`,
    add: { style: item.style, path: item.file },
    info: [["스타일", item.style], ["요청", item.request], ["모델", item.model && `${shortModel(item.model)}${item.cost != null ? ` · ${money(item.cost)}` : ""}`], ["프롬프트", item.prompt, true], ["만든 시각", item.time && item.time.replace("T", " ").slice(0, 16)]]
  };
}

// Choosing images only toggles classes and the bar, so the grid's images are never rebuilt (rebuilding them flickers).
function renderArchive() {
  document.title = "보관함 · Asset Studio";
  const { all, shown } = archiveItems();
  const items = shown.map(lightboxFromArchive);
  const chips = [chip(`전체 ${all.length}`, { on: !route.filter, onClick: () => { location.hash = "#/archive"; } }),
    ...archiveData.styles.map(shelf => chip(`${shelf.style} ${shelf.items.length}`, { on: route.filter === shelf.style, onClick: () => { location.hash = `#/archive/${encodeURIComponent(shelf.style)}`; } }))];

  const tiles = shown.map((item, index) => {
    const key = `${item.style}/${item.file}`;
    return h("figure", { class: `tile${selecting && selecting.has(key) ? " picked" : ""}`, "data-key": key }, [
      imageFrame(item.file, {
        fit: "fill", check: true,
        onClick: () => selecting ? toggleArchivePick(key) : openLightbox(items, index),
        tools: [
          tool("reference", "레퍼런스에 추가", () => addToReferences(item.style, item.file)),
          tool("download", "다운로드", null, { href: fileUrl(item.file), download: `${item.style}-${fileName(item.file)}` })
        ]
      }),
      h("figcaption", {}, [h("span", { text: item.request || "" }), h("span", { text: item.style })])
    ]);
  });

  fill($("view"), h("div", { class: "page" }, [
    h("div", { class: "page-head" }, [
      h("div", {}, [h("h1", { text: "보관함" }), h("p", { text: "스타일로 만든 이미지와 레퍼런스가 모두 여기에 모여요." })]),
      shown.length ? button(selecting ? "선택 취소" : "선택", { onClick: event => setSelecting(!selecting, event.currentTarget) }) : null
    ]),
    all.length ? h("div", { class: "chips" }, chips) : null,
    shown.length ? h("div", { class: `grid${selecting ? " selecting" : ""}`, id: "archive-grid" }, tiles) : h("div", { id: "archive-grid" }, [emptyState({ title: "아직 보관된 이미지가 없어요", text: "확정한 스타일로 이미지를 만들면 여기에 자동으로 모여요." })]),
    h("div", { id: "selection-bar" })
  ]));
  syncArchiveSelection();
}

function setSelecting(on, trigger) {
  selecting = on ? new Set() : null;
  trigger.querySelector("span").textContent = on ? "선택 취소" : "선택";
  $("archive-grid").classList.toggle("selecting", on);
  syncArchiveSelection();
}

function toggleArchivePick(key) {
  if (selecting.has(key)) selecting.delete(key);
  else selecting.add(key);
  syncArchiveSelection();
}

function syncArchiveSelection() {
  document.querySelectorAll("#archive-grid .tile").forEach(tile => tile.classList.toggle("picked", Boolean(selecting && selecting.has(tile.dataset.key))));
  const bar = $("selection-bar");
  if (!selecting) return fill(bar, );
  fill(bar, h("div", { class: "selection-bar" }, [
    h("span", { text: `${selecting.size}장 선택` }),
    h("div", { class: "row" }, [
      button("전체 선택", { onClick: () => { archiveItems().shown.forEach(item => selecting.add(`${item.style}/${item.file}`)); syncArchiveSelection(); } }),
      button("다운로드", { variant: "primary", iconName: "download", disabled: !selecting.size, onClick: downloadSelected })
    ])
  ]));
}

async function downloadSelected() {
  const { all } = archiveItems();
  const files = all.filter(item => selecting.has(`${item.style}/${item.file}`)).map(item => ({ path: item.file, name: `${item.style}-${fileName(item.file)}` }));
  try {
    const response = await fetch("/api/download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files }) });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "다운로드하지 못했어요");
    const link = h("a", { href: URL.createObjectURL(await response.blob()), download: `asset-studio-${files.length}.zip` });
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  } catch (error) {
    toast(error.message, "error");
  }
}

// ---------- style page ----------

function renderMissing(message) {
  fill($("view"), h("div", { class: "page" }, [emptyState({ title: "스타일을 열 수 없어요", text: message, action: h("a", { class: "button", href: "#/", text: "스타일 목록으로" }) })]));
}

function renderStyle() {
  const current = view();
  if (current && draft.key !== draftKey(current)) {
    // A confirm round may open with the user's earlier picks already picked.
    draft = freshDraft(draftKey(current), current.candidates.filter(candidate => candidate.picked).map(candidate => candidate.number));
  }
  // A re-render rebuilds the text box; whoever was typing keeps the caret.
  const typing = document.activeElement && document.activeElement.matches(".composer textarea") ? document.activeElement.selectionStart : null;
  document.title = `${data.style} · Asset Studio`;

  if (!$("workspace")) {
    fill($("view"), h("div", { class: "workspace", id: "workspace" }, [
      h("aside", { class: "panel" }, [
        h("div", { class: "panel-head", id: "panel-head" }),
        h("div", { class: "tabs", id: "tabs" }),
        h("div", { class: "panel-body", id: "panel-body" }),
        h("div", { class: "panel-doc", id: "panel-doc", hidden: true }, [h("pre", { class: "document" })]),
        h("div", { class: "panel-actions", id: "panel-actions" }),
        h("div", { class: "panel-resize", id: "panel-resize", title: "드래그해서 너비 조절" })
      ]),
      h("section", { class: "stage", id: "stage", onscroll: syncLatestButton }, [
        h("div", { class: "stage-inner", id: "stage-inner" }),
        h("button", { class: "latest", id: "latest", type: "button", hidden: true, html: `${icon("down")}<span>새 메시지</span>`, onclick: () => scrollToLatest(true) })
      ])
    ]));
    bindResize();
    // Load events do not bubble, so the stage listens in the capture phase.
    $("stage").addEventListener("load", event => { if (following && event.target.tagName === "IMG") $("stage").scrollTop = $("stage").scrollHeight; }, true);
  }

  renderPanelHead();
  renderPanelBody();
  renderTabs();
  const stage = $("stage");
  const atBottom = stage.scrollHeight - stage.scrollTop - stage.clientHeight < 80;
  renderStage();
  followLatest(atBottom);
  const input = document.querySelector(".composer textarea");
  if (typing != null && input) { input.focus(); input.setSelectionRange(typing, typing); }
}

// A session reads top to bottom, the newest at the end: the page follows new content unless the user has scrolled up to read.
function followLatest(wasAtBottom) {
  const place = data.session ? `${data.style}|${data.session.id}` : null;
  if (!place) { $("latest").hidden = true; rendered = null; following = false; return; }
  if (rendered !== place || wasAtBottom) scrollToLatest(rendered === place);
  else $("latest").hidden = false;
  rendered = place;
}

function scrollToLatest(smooth) {
  const stage = $("stage");
  following = true;
  stage.scrollTo({ top: stage.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  $("latest").hidden = true;
}

function syncLatestButton() {
  const stage = $("stage");
  following = Boolean(data && data.session) && stage.scrollHeight - stage.scrollTop - stage.clientHeight < 80;
  if (following) $("latest").hidden = true;
}

function renderPanelHead() {
  const current = view();
  const overview = data.overview;
  const session = data.session;
  const stage = current && session.kind === "make" ? STAGES.findIndex(([name]) => name === current.kind) : -1;
  const pills = [];
  if (overview.confirmed && !session) pills.push(pill("확정", { tone: "success" }));
  const model = session ? (current ? (current.blind ? "" : current.model) : session.model) : overview.model;
  if (model) pills.push(pill(shortModel(model)));
  if (overview.based_on && !session) pills.push(pill(`${overview.based_on} 바탕`));
  if (current && current.session_cost > 0) pills.push(pill(`비용 ${money(current.session_cost)}`));
  const inSession = session && session.kind !== "make";

  fill($("panel-head"),
    h("a", { class: "back", href: inSession ? styleHash(data.style) : "#/", text: inSession ? `← ${data.style}` : "← 스타일" }),
    h("h1", { text: inSession ? session.title || sessionName(session) : data.style }),
    inSession ? h("p", { class: "subtitle", text: `${sessionName(session)} 세션 · ${when(session.started)} 시작` }) : null,
    session && session.kind === "make" ? h("div", { class: "stepper" }, STAGES.map(([, name], index) => h("div", { class: `step${index < stage ? " done" : index === stage ? " now" : ""}`, text: name }))) : null,
    pills.length ? h("div", { class: "facts" }, pills) : null
  );
}

// The documents shown with this view: the round's copies while it is open, the style's own otherwise.
function documents() {
  const source = view() || data.overview;
  return [["brief", "브리프", source.brief], ["spec", "스타일", source.spec], ["prompting", "프롬프트", source.prompting]].filter(([, , text]) => text);
}

function renderTabs() {
  const docs = documents();
  if (!docs.some(([key]) => key === panelTab)) panelTab = "work";
  $("tabs").hidden = !docs.length;
  fill($("tabs"), ...[["work", data.session ? "작업" : "개요"], ...docs].map(([key, label]) => h("button", {
    class: `tab${key === panelTab ? " on" : ""}`, type: "button", text: label,
    onclick: () => { panelTab = key; renderTabs(); }
  })));
  const doc = docs.find(([key]) => key === panelTab);
  $("panel-doc").hidden = !doc;
  $("panel-doc").firstElementChild.textContent = doc ? doc[2] : "";
  $("panel-body").hidden = Boolean(doc);
  $("panel-actions").hidden = Boolean(doc);
}

// ---------- panel: what to do now ----------

function renderPanelBody() {
  const current = view();
  const body = $("panel-body");
  const actions = $("panel-actions");
  if (!data.session) return renderIdlePanel(body, actions);
  if (!current) {
    fill(body, workingNote(data.session.kind === "model" ? "이 모델에 맞춘 프롬프트 가이드를 만드는 중" : "준비하고 있어요"));
    fill(actions, );
    return;
  }
  if (!answering()) {
    const decision = current.feedback.decision;
    fill(body, workingNote(WAITING[decision] || CONTINUING[current.kind] || "다음 화면을 준비하고 있어요"));
    fill(actions, );
    return;
  }
  const panels = { discover: discoverPanel, sample: samplePanel, confirm: confirmPanel, generate: generatePanel, model: modelPanel };
  panels[current.kind](current, body, actions);
}

function renderIdlePanel(body, actions) {
  const overview = data.overview;
  if (!overview.confirmed) {
    fill(body, h("h2", { text: "열린 세션이 없어요" }));
    fill(actions, );
    return;
  }
  const sessions = data.sessions.filter(session => session.kind !== "make").sort((a, b) => b.updated.localeCompare(a.updated));
  fill(body,
    h("h2", { text: "이 스타일로 이미지를 만들어요" }),
    h("p", { class: "lead", text: "새 이미지는 적은 대로 바로 그리고, 새 아이데이션은 무엇을 그릴지 대화로 함께 정해요. 만든 이미지는 보관함에 모여요." }),
    h("dl", { class: "facts-list" }, [
      h("div", {}, [h("dt", { text: "레퍼런스" }), h("dd", { text: `${overview.references.length}장` })]),
      h("div", {}, [h("dt", { text: "보관한 이미지" }), h("dd", { text: `${data.archive.length}장` })]),
      overview.based_on ? h("div", {}, [h("dt", { text: "바탕 스타일" }), h("dd", { text: overview.based_on })]) : null
    ]),
    sectionTitle("모델", button("모델 추가", { small: true, onClick: addModel })),
    h("div", { id: "model-rows" }, [rowList(overview.models.map(modelRow))]),
    sectionTitle("세션", sessions.length ? `${sessions.length}개` : ""),
    sessions.length ? rowList(sessions.map(sessionRow)) : h("p", { class: "muted", text: "아직 세션이 없어요." })
  );
  const image = button("새 이미지", { variant: "primary", grow: true });
  image.addEventListener("click", () => openSession("generate", null, image));
  const ideation = button("새 아이데이션", { grow: true });
  ideation.addEventListener("click", () => openSession("generate", null, ideation, true));
  fill(actions, ideation, image);
  if (!catalogModels) loadCatalog().then(() => { if ($("model-rows")) fill($("model-rows"), rowList(data.overview.models.map(modelRow))); }).catch(() => {});
}

// A row per model: choosing one makes it the model in use; any other can be removed.
function modelRow(model) {
  const inUse = model === data.overview.model;
  const listed = catalogModels && catalogModels.find(each => each.id === model);
  return listRow({
    title: shortModel(model), detail: listed ? priceLabel(listed) : model, current: inUse, hint: inUse ? null : "이 모델로 그리기", onClick: () => useModel(model),
    aside: inUse ? pill("사용 중", { tone: "success" }) : tool("trash", "모델 삭제", () => removeModel(model), { quiet: true })
  });
}

async function removeModel(model) {
  const yes = await ask({ title: "모델 삭제", description: `${shortModel(model)}와 이 스타일용 프롬프트 가이드를 지워요. 이 모델로 만든 이미지는 보관함에 그대로 있어요.`, confirm: "삭제", input: null, danger: true });
  if (!yes) return;
  try { await api("/api/models/delete", { style: data.style, model }); toast("모델을 지웠어요"); load(); }
  catch (error) { toast(error.message, "error"); }
}

function sessionRow(session) {
  return listRow({
    title: session.title || (session.kind === "generate" ? `새 ${sessionName(session)}` : SESSION_NAMES[session.kind]),
    detail: `${sessionName(session)} · ${when(session.updated)}`,
    onClick: () => { location.hash = styleHash(data.style, session.id); },
    aside: h("div", { class: "row" }, [session.waiting ? null : pill("작업 중", { tone: "accent", dot: "live" }), tool("trash", "세션 삭제", () => deleteSession(session), { quiet: true })])
  });
}

async function openSession(sessionKind, model, trigger, ideation = false) {
  if (trigger) trigger.disabled = true;
  try {
    const opened = await api("/api/sessions", { style: data.style, kind: sessionKind, model, ideation });
    location.hash = styleHash(data.style, opened.session);
  } catch (error) {
    toast(error.message, "error");
    if (trigger) trigger.disabled = false;
  }
}

async function deleteSession(session) {
  const yes = await ask({ title: "세션 삭제", description: session.kind === "model" ? "이 모델 추가를 그만두고 기록을 지워요." : "세션 기록을 지워요. 만든 이미지는 보관함에 그대로 있어요.", confirm: "삭제", input: null, danger: true });
  if (!yes) return;
  try {
    await api("/api/sessions/delete", { style: data.style, session: session.id });
    if (route.session === session.id) location.hash = styleHash(data.style);
    else load();
  } catch (error) { toast(error.message, "error"); }
}

async function useModel(model) {
  try { await api("/api/model", { style: data.style, model }); toast(`${shortModel(model)}로 그려요`); load(); }
  catch (error) { toast(error.message, "error"); }
}

// What one image costs: measured here when it has been used, else the listed price by its billing unit.
function priceLabel(model) {
  if (model.measured != null) return `${money(model.measured)} / 장`;
  const price = model.price;
  if (!price || price.cost == null) return "가격 정보 없음";
  if (price.cost === 0) return "무료";
  const from = price.varies ? "부터" : "";
  if (price.unit === "image") return `${money(price.cost)} / 장${from}`;
  if (price.unit === "megapixel") return `1K 약 ${money(price.cost * 1.05)} / 장${from}`;
  return `토큰 과금 ($${(price.cost * 1e6).toFixed(0)}/100만)`;
}

async function loadCatalog() {
  if (!catalogModels) catalogModels = (await api("/api/catalog")).models;
  return catalogModels;
}

async function addModel() {
  let catalog;
  try { catalog = await loadCatalog(); }
  catch (error) { return toast(error.message, "error"); }
  // A style draws with all its references attached, so only models that take that many are offered; one already being added is not offered twice.
  const adding = data.sessions.filter(session => session.kind === "model").map(session => session.model);
  const needed = Math.max(1, data.overview.references.length);
  const choices = catalog.filter(model => model.references >= needed && !data.overview.models.includes(model.id) && !adding.includes(model.id))
    .sort((a, b) => (b.created || 0) - (a.created || 0))
    .map(model => ({
      value: model.id, title: model.name, aside: priceLabel(model),
      detail: [model.id, `레퍼런스 ${model.references}장까지`, model.measured != null ? "실측" : null, model.price && model.price.reference ? `레퍼런스 장당 ${money(model.price.reference)}` : null].filter(Boolean).join(" · ")
    }));
  const model = await ask({ title: "모델 추가", description: "고르면 이 모델에 맞는 프롬프트 가이드를 만들고, 몇 장 그려 보면서 다듬어요. 가격은 1K 한 장 기준이에요.", confirm: "추가 시작", input: null, choices });
  if (model) openSession("model", model);
}

// The bottom of the panel: the text box, then the images attached to this answer under it.
function composer(key, placeholder, { attaching = true, hint = "보내기", onInput = null } = {}) {
  const input = h("textarea", { class: "text-input", placeholder, value: draft[key] });
  input.addEventListener("input", () => { draft[key] = input.value; if (onInput) onInput(); });
  input.addEventListener("keydown", event => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    const primary = $("panel-actions").querySelector(".button.primary");
    if (primary && !primary.disabled) primary.click();
  });
  const current = view();
  const attached = attaching && current.attachments.length ? h("div", { class: "thumbs" }, current.attachments.map(path => thumb(path, { remove: () => detach(path) }))) : null;
  return h("div", { class: "composer" }, [input, attached, h("div", { class: "hint" }, [h("span", { text: attaching ? "이미지를 첨부하면 이 답과 함께 보내져요" : "" }), h("span", { text: `⌘↵ ${hint}` })])]);
}

function attachButton() {
  return uploadButton("이미지 첨부", async files => {
    for (const file of files) {
      try { await api("/api/attach", { style: data.style, session: data.session.id, name: file.name, data: await readFile(file) }); }
      catch (error) { toast(error.message, "error"); }
    }
    await load();
  });
}

async function detach(path) {
  try { await api("/api/detach", { style: data.style, session: data.session.id, path }); await load(); }
  catch { toast("이미지를 빼지 못했어요. 새로고침 후 다시 해 주세요.", "error"); }
}

// The talk of a make session writes the style; ideation in a generate session writes the image's brief.
function discoverPanel(current, body, actions) {
  const imageTalk = data.session.kind === "generate";
  const written = imageTalk ? current.brief : current.spec;
  const lead = current.candidates.length ? "마음에 드는 이미지를 고르고, 이미지마다 메모를 남길 수 있어요." : written ? `제가 정리한 ${imageTalk ? "브리프와" : "설명과"} 다르면 편하게 고쳐 주세요.` : null;
  const send = button("보내기", { variant: "primary", grow: true, onClick: () => submit(null) });
  const next = imageTalk ? ["생성", "generate"] : ["샘플", "sample"];
  fill(body,
    h("h2", { text: imageTalk ? (written ? "브리프가 맞는지 봐 주세요" : "어떤 이미지가 필요한지 알려 주세요") : written ? "설명이 맞는지 봐 주세요" : "원하는 스타일을 알려 주세요" }),
    lead ? h("p", { class: "lead", text: lead }) : null,
    composer("comment", imageTalk ? "예: 앱 아이콘인데 무엇을 그릴지 아직 모르겠어요" : "예: 조금 더 부드럽고 단순했으면 좋겠어요", { onInput: syncSend })
  );
  fill(actions, attachButton(), send, written ? button(next[0], { variant: "success", onClick: () => submit(next[1]) }) : null);
  syncSend();
}

// A discover answer can be words, picks, notes, or attachments; any one of them is enough to send.
function syncSend() {
  const send = kind() === "discover" ? $("panel-actions").querySelector(".button.primary") : null;
  if (send) send.disabled = !draft.comment.trim() && !draft.picked.size && !Object.keys(draft.notes).length && !view().attachments.length;
}

function samplePanel(current, body, actions) {
  const generate = button("그리기", { variant: "primary", grow: true, onClick: () => submit("request") });
  const update = () => { generate.disabled = !draft.request.trim(); };
  fill(body,
    h("h2", { text: "이 스타일로 그려 보세요" }),
    h("p", { class: "lead", text: current.unit_cost != null ? `한 장에 ${money(current.unit_cost)}` : "적은 것을 한 장씩 그려 드려요." }),
    composer("request", "예: 비 오는 날 창가에 놓인 머그잔", { onInput: update, hint: "그리기" })
  );
  update();
  fill(actions, button("스타일", { onClick: () => submit("discover", draft.request) }), attachButton(), generate, button("확정", { variant: "success", hidden: !current.candidates.length, onClick: () => submit("confirm") }));
}

function confirmPanel(current, body, actions) {
  const send = button("보내기", { variant: "primary", onClick: () => submit(null) });
  const update = () => { send.disabled = !draft.comment.trim(); };
  fill(body,
    h("h2", { text: "레퍼런스로 쓸 이미지를 골라 주세요" }),
    h("p", { class: "lead", id: "selection-count" }),
    composer("comment", "더 보고 싶은 게 있으면 적어 주세요. 예: 다른 대상도 한두 장 더", { attaching: false, onInput: update })
  );
  fill(actions, button("샘플", { onClick: () => submit("sample", draft.comment) }), send, button("확정", { variant: "success", grow: true, onClick: () => submit("done") }));
  update();
  syncSelection();
}

function generatePanel(current, body, actions) {
  const started = current.candidates.length > 0;
  const generate = button("생성", { variant: "primary", grow: true, onClick: () => submit(draft.picked.size ? "refine" : "new") });
  const fresh = iconButton("plus", "새로 그리기", () => submit("new"), { hidden: !started });
  const update = () => { generate.disabled = fresh.disabled = !draft.request.trim(); };
  fill(body,
    h("h2", { text: started ? "고르고, 어떻게 바꿀지 적어 주세요" : "무엇을 만들까요?" }),
    h("p", { class: "lead", id: "selection-count", text: started ? "" : "만든 이미지는 보관함에 자동으로 모여요." }),
    composer("request", started ? "예: 손잡이를 더 크게" : "예: 노트북 앞의 커피잔", { onInput: update, hint: "생성" })
  );
  update();
  fill(actions, button("아이데이션", { onClick: () => submit("discover", draft.request) }), attachButton(), fresh, generate);
  syncSelection();
}

function modelPanel(current, body, actions) {
  const generate = button("그리기", { variant: "primary", grow: true, onClick: () => submit("request") });
  const update = () => { generate.disabled = !draft.request.trim(); };
  fill(body,
    h("h2", { text: `${shortModel(current.model)}로 그려 보세요` }),
    h("p", { class: "lead", text: "레퍼런스를 붙여 한 장씩 그려요. 이 스타일답게 나오면 추가를 눌러 주세요." }),
    composer("request", "예: 창가의 몬스테라", { onInput: update, hint: "그리기" })
  );
  update();
  fill(actions, attachButton(), generate, button("추가", { variant: "success", hidden: !current.candidates.length, onClick: () => submit("done") }));
}

// What the picks mean for the next step, kept in step with the cards.
function syncSelection() {
  const count = $("selection-count");
  if (kind() === "confirm") {
    if (count) count.textContent = draft.picked.size ? `${draft.picked.size}장 골랐어요. 대상과 색이 다양할수록 좋아요.` : "";
    const done = [...$("panel-actions").querySelectorAll(".button.success")].pop();
    if (done) done.disabled = !draft.picked.size;
  }
  if (kind() === "generate" && view().candidates.length && count) {
    const [picked] = [...draft.picked];
    count.textContent = picked ? `${pad(picked)}번을 바탕으로 고쳐요` : "고르지 않으면 새로 그려요";
  }
}

async function submit(decision, reason = "") {
  const buttons = [...$("panel-actions").querySelectorAll("button")];
  buttons.forEach(node => { node.disabled = true; });
  const talking = ["discover", "confirm"].includes(kind());
  try {
    await api("/api/feedback", {
      style: data.style,
      session: data.session.id,
      round: view().round,
      decision,
      picked: selectable() && decision !== "new" ? [...draft.picked] : [],
      notes: talking ? draft.notes : {},
      comment: reason || (talking ? draft.comment : ""),
      request: talking ? "" : draft.request
    });
    await load();
  } catch (error) {
    toast(error.message, "error");
    buttons.forEach(node => { node.disabled = false; });
  }
}

// ---------- stage: what the user looks at ----------

function renderStage() {
  const current = view();
  const stage = $("stage-inner");
  if (!data.session) return fill(stage, ...overviewStage());
  if (!current) return fill(stage, workingNote("준비하고 있어요"));
  const stages = { discover: discoverStage, sample: boardStage, confirm: confirmStage, generate: boardStage, model: boardStage };
  fill(stage, ...stages[current.kind](current));
}

function overviewStage() {
  const overview = data.overview;
  const references = overview.references.map(path => ({ path, name: `${data.style}-${fileName(path)}`, info: [] }));
  const made = [...data.archive].reverse();
  const madeItems = made.map(item => lightboxFromArchive({ ...item, style: data.style }));
  const addTile = h("label", { class: "add-tile", title: "이미지를 올려 레퍼런스에 추가" }, [h("span", { html: icon("plus") }), h("small", { text: "레퍼런스 추가" })]);
  const upload = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", multiple: true });
  upload.addEventListener("change", async () => {
    for (const file of upload.files) {
      try { await api("/api/references/add", { style: data.style, name: file.name, data: await readFile(file) }); }
      catch (error) { toast(error.message, "error"); }
    }
    upload.value = "";
    load();
  });
  addTile.append(upload);
  return [
    sectionTitle("레퍼런스", `${references.length}장`),
    h("div", { class: "grid compact" }, [
      ...references.map((item, index) => imageFrame(item.path, {
        fit: "fill", lazy: false, onClick: () => openLightbox(references, index),
        tools: [tool("close", "레퍼런스에서 빼기", () => removeReference(item.path))]
      })),
      addTile
    ]),
    sectionTitle("최근 만든 이미지", made.length ? h("a", { href: `#/archive/${encodeURIComponent(data.style)}`, text: "보관함에서 보기" }) : null),
    made.length ? h("div", { class: "grid compact" }, made.slice(0, 18).map((item, index) => imageFrame(item.file, {
      fit: "fill", onClick: () => openLightbox(madeItems, index),
      tools: [
        tool("reference", "레퍼런스에 추가", () => addToReferences(data.style, item.file)),
        tool("download", "다운로드", null, { href: fileUrl(item.file), download: `${data.style}-${fileName(item.file)}` })
      ]
    }))) : emptyState({ text: "아직 만든 이미지가 없어요. 왼쪽에서 새 이미지나 새 아이데이션으로 시작하세요." })
  ];
}

// Any image of a confirmed style can be added to its references wherever it is shown.
function lightboxItems(candidates) {
  const adds = data.overview.confirmed;
  return candidates.map(candidate => ({
    path: candidate.path,
    name: `${data.style}-${fileName(candidate.path)}`,
    add: adds ? { style: data.style, path: candidate.path } : null,
    info: [["요청", candidate.request], ["에이전트 메모", candidate.description], ["내 메모", candidate.note], ["검수", candidate.review], ["모델", candidate.model && `${shortModel(candidate.model)}${candidate.cost != null ? ` · ${money(candidate.cost)}` : ""}`], ["프롬프트", candidate.prompt, true]]
  }));
}

function messageNode(who, children) {
  return h("div", { class: `message ${who}` }, [h("div", { class: "avatar", text: who === "user" ? "나" : "AS" }), h("div", { class: "message-body" }, children)]);
}

function thumbRow(candidates) {
  const items = lightboxItems(candidates);
  return h("div", { class: "thumbs" }, candidates.map((candidate, index) => thumb(candidate.path, { picked: candidate.picked, title: candidate.description || "크게 보기", onClick: () => openLightbox(items, index) })));
}

// What the user said about the images of a turn: each picked or noted image with its number, the pick, and the note.
function answerMarks(candidates) {
  const marked = candidates.filter(candidate => candidate.picked || candidate.note);
  if (!marked.length) return null;
  const items = lightboxItems(marked);
  return h("div", { class: "marks" }, marked.map((candidate, index) => h("div", { class: "mark" }, [
    thumb(candidate.path, { small: true, picked: candidate.picked, onClick: () => openLightbox(items, index) }),
    h("div", {}, [
      h("span", { class: "mark-head" }, [`${pad(candidate.number)}번`, candidate.picked ? pill("고름", { tone: "accent", small: true }) : null]),
      candidate.note ? h("span", { class: "mark-note", text: candidate.note }) : null
    ])
  ])));
}

function discoverStage(current) {
  const seen = new Set();
  const nodes = [];
  for (const turn of current.thread) {
    const isCurrent = turn.round === current.round;
    const fresh = turn.candidates.filter(candidate => !seen.has(candidate.path));
    turn.candidates.forEach(candidate => seen.add(candidate.path));
    // Every image sits under the message it belongs to; a visit to another stage gets a message of its own.
    // A visit to a board names what it drew since the last visit; one that drew nothing new shows the board's own question.
    const requests = [...new Set(fresh.map(candidate => candidate.request).filter(Boolean))];
    const visit = turn.kind !== "discover" && fresh.length > 0;
    const text = visit ? [`${KIND_NAMES[turn.kind]}에서 그린 것`, ...requests.map(request => `· ${request}`)].join("\n") : turn.message;
    const agentChildren = [text ? h("div", { class: `bubble${visit ? " stage-visit" : ""}`, text }) : null];
    if (!isCurrent && fresh.length) agentChildren.push(thumbRow(fresh));
    if (agentChildren.some(Boolean)) nodes.push(messageNode("agent", agentChildren));
    if (isCurrent && current.candidates.length) nodes.push(candidateGrid(current.candidates));
    const answered = turn.reply != null || turn.decision != null;
    const marks = answered ? answerMarks(turn.candidates) : null;
    if (turn.reply || turn.attachments.length || marks) {
      const attachments = turn.attachments.map(path => ({ path, info: [] }));
      nodes.push(messageNode("user", [turn.reply ? h("div", { class: "bubble", text: turn.reply }) : null, marks, turn.attachments.length ? h("div", { class: "thumbs" }, turn.attachments.map((path, index) => thumb(path, { onClick: () => openLightbox(attachments, index) }))) : null]));
    }
  }
  const waiting = waitingText(current);
  if (waiting) nodes.push(messageNode("agent", [h("div", { class: "bubble working" }, [h("span", { class: "spinner" }), waiting])]));
  return [h("div", { class: "thread" }, nodes)];
}

function waitingText(current) {
  if (!current.feedback) return "";
  const decision = current.feedback.decision;
  if (DRAWING.includes(decision)) return "";
  return WAITING[decision] || CONTINUING[current.kind] || "다음 화면을 준비하고 있어요";
}

function candidateGrid(candidates, { flush = false } = {}) {
  const items = lightboxItems(candidates);
  return h("div", { class: `candidates${flush ? " flush" : ""}` }, candidates.map((candidate, index) => candidateCard(candidate, index, items)));
}

function candidateCard(candidate, index, items) {
  const isPicked = answering() ? draft.picked.has(candidate.number) : candidate.picked;
  const note = answering() ? draft.notes[candidate.number] || "" : candidate.note || "";
  const memo = selectable() && kind() !== "confirm" ? tool("memo", note || "메모", () => editNote(candidate), { on: Boolean(note) }) : null;
  return h("div", { class: `candidate${selectable() ? " selectable" : ""}${isPicked ? " picked" : ""}`, "data-number": candidate.number }, [
    imageFrame(candidate.path, {
      number: candidate.number, check: selectable(),
      onClick: () => selectable() ? togglePick(candidate.number) : openLightbox(items, index),
      tools: [memo, tool("zoom", "크게 보기", () => openLightbox(items, index))]
    }),
    candidate.description ? h("div", { class: "label", text: candidate.description }) : null,
    note ? field("내 메모", note) : null
  ]);
}

// A note travels with the answer whether or not the image is picked: a reason to pick, or what falls short.
async function editNote(candidate) {
  const text = await ask({ title: `${pad(candidate.number)}번 메모`, description: "좋은 점이나 아쉬운 점을 적어 주세요. 고르지 않은 이미지에도 남길 수 있어요.", value: draft.notes[candidate.number] || "", placeholder: "예: 그림자가 부드러워서 좋아요", confirm: "저장" });
  if (text == null) return;
  if (text) draft.notes[candidate.number] = text;
  else delete draft.notes[candidate.number];
  renderStage();
  syncSend();
  syncSelection();
}

function togglePick(number) {
  const on = !draft.picked.has(number);
  // A generate round builds on one attempt; discover and confirm take any number.
  if (on && kind() === "generate") draft.picked.clear();
  if (on) draft.picked.add(number);
  else draft.picked.delete(number);
  document.querySelectorAll("[data-number]").forEach(node => node.classList.toggle("picked", draft.picked.has(Number(node.dataset.number))));
  syncSelection();
  syncSend();
}

function confirmStage(current) {
  const waiting = waitingText(current);
  return [
    current.note ? messageNode("agent", [h("div", { class: "bubble", text: current.note })]) : null,
    h("div", { style: "height: 20px" }),
    sectionTitle("레퍼런스 후보", `${current.candidates.length}장`),
    candidateGrid(current.candidates, { flush: true }),
    waiting ? h("div", { style: "margin-top: 20px" }, [workingNote(waiting)]) : null
  ];
}

// Boards list images in the order they were drawn, the one being drawn last.
function boardStage(current) {
  const ordered = current.candidates;
  const items = lightboxItems(ordered);
  const isGenerate = current.kind === "generate";
  const adds = data.overview.confirmed;
  const entries = ordered.map((candidate, index) => {
    const isPicked = answering() ? draft.picked.has(candidate.number) : candidate.picked;
    const facts = [candidate.model ? shortModel(candidate.model) : null, candidate.cost != null ? money(candidate.cost) : null].filter(Boolean).join(" · ");
    return h("article", { class: `entry${isGenerate && selectable() ? " selectable" : ""}${isPicked ? " picked" : ""}`, "data-number": candidate.number }, [
      imageFrame(candidate.path, {
        number: candidate.number, check: isGenerate && selectable(),
        onClick: () => isGenerate && selectable() ? togglePick(candidate.number) : openLightbox(items, index),
        tools: [
          tool("zoom", "크게 보기", () => openLightbox(items, index)),
          adds ? tool("reference", "레퍼런스에 추가", () => addToReferences(data.style, candidate.path)) : null,
          tool("download", "다운로드", null, { href: fileUrl(candidate.path), download: `${data.style}-${fileName(candidate.path)}` })
        ]
      }),
      h("div", { class: "entry-info" }, [
        field("요청", candidate.request || "-", { strong: true }),
        candidate.description ? field("에이전트 메모", candidate.description) : null,
        candidate.review ? field("검수", candidate.review) : null,
        candidate.prompt ? field("프롬프트", candidate.prompt, { mono: true, grows: true }) : null,
        facts ? h("span", { class: "meta", text: facts }) : null
      ])
    ]);
  });

  const decision = current.feedback && current.feedback.decision;
  if (DRAWING.includes(decision)) {
    entries.push(h("article", { class: "entry" }, [
      h("div", { class: "pending-frame" }, [h("span", { class: "spinner" }), "그리는 중"]),
      h("div", { class: "entry-info" }, [field("요청", current.feedback.request, { strong: true })])
    ]));
  }

  const references = current.references.length ? [
    sectionTitle("레퍼런스", `${current.references.length}장`),
    h("div", { class: "thumbs" }, current.references.map((path, index, all) => thumb(path, { onClick: () => openLightbox(all.map(reference => ({ path: reference, info: [] })), index) }))),
    h("div", { style: "height: 24px" })
  ] : [];
  const waiting = waitingText(current);
  const title = { generate: "만든 이미지", sample: "샘플", model: `${shortModel(current.model)}로 그린 것` }[current.kind];

  return [
    ...references,
    sectionTitle(title, ordered.length ? `${ordered.length}장` : ""),
    entries.length ? h("div", { class: "entries" }, entries) : emptyState({ text: isGenerate ? "왼쪽에 만들고 싶은 것을 적어 주세요." : "왼쪽에 그려 볼 것을 적어 주세요." }),
    waiting ? h("div", { style: "margin-top: 20px" }, [workingNote(waiting)]) : null
  ];
}

// ---------- panel width ----------

function bindResize() {
  const range = [300, 560];
  const set = width => document.documentElement.style.setProperty("--panel", `${Math.min(range[1], Math.max(range[0], width))}px`);
  $("panel-resize").addEventListener("pointerdown", event => {
    event.preventDefault();
    document.body.classList.add("resizing");
    const move = moved => set(moved.clientX);
    const up = () => {
      document.body.classList.remove("resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      try { localStorage.setItem("panel-width", parseInt(getComputedStyle(document.documentElement).getPropertyValue("--panel"))); } catch {}
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}
try { const saved = Number(localStorage.getItem("panel-width")); if (saved) document.documentElement.style.setProperty("--panel", `${saved}px`); } catch {}

go();
setInterval(() => { if ($("modal").hidden && $("menu").hidden) load(); }, 3000);
