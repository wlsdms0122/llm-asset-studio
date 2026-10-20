"use strict";

// The studio's pages, built from the components in ui.js.

// ---------- vocabulary ----------

const STAGES = [["discover", t("Style")], ["sample", t("Sample")], ["confirm", t("Confirm")]];
const KIND_NAMES = { discover: t("Style"), sample: t("Sample"), confirm: t("Confirm"), generate: t("Generate"), model: t("Add model") };
const SESSION_NAMES = { make: t("Making the style"), generate: t("Image"), model: t("Add model") };
// A generate session is named by how it goes: making an image from a request, or ideation.
const sessionName = session => session.ideation ? t("Ideation") : SESSION_NAMES[session.kind];
// What the agent is doing after each answer, shown until the next round arrives.
const WAITING = { sample: t("Preparing the sample"), discover: t("Preparing the conversation"), confirm: t("Preparing reference candidates"), generate: t("Drawing"), request: t("Drawing"), done: t("Wrapping up"), refine: t("Drawing"), new: t("Drawing") };
const CONTINUING = { discover: t("Reading your answer"), confirm: t("Making more candidates") };
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
  if (minutes < 1) return t("just now");
  if (minutes < 60) return t("{n} min ago", { n: minutes });
  if (minutes < 60 * 24) return t("{n} h ago", { n: Math.round(minutes / 60) });
  return date.toLocaleDateString(language, { month: "short", day: "numeric" });
}

async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(value.error || t("The request failed ({status})", { status: response.status })), { status: response.status });
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

const STYLE_NAME = /^[\p{L}\p{N}][\p{L}\p{N}-]{1,40}$/u;
const NAME_RULE = t("Use two or more letters (lowercase for Latin), digits, and hyphens.");

async function askName({ title, description = "", value = "", confirm, submit }) {
  let error = "";
  for (;;) {
    const name = await ask({ title, description, value, error, placeholder: t("Name, e.g. blog-cover"), confirm, input: "text" });
    if (name == null) return;
    value = name;
    const normalized = name.normalize("NFC");
    if (!STYLE_NAME.test(normalized) || normalized !== normalized.toLowerCase()) { error = NAME_RULE; continue; }
    try { return await submit(normalized); }
    catch (failure) { error = failure.message.includes("already exists") ? t("A style with this name already exists.") : failure.message; }
  }
}

function newStyle(base = null) {
  return askName({
    title: base ? t("New style based on {base}", { base }) : t("New style"),
    description: base ? t("The conversation starts from the base style's words and references.") : t("Find the style you want together, in conversation."),
    confirm: t("Create"),
    submit: async name => { const result = await api("/api/styles", { name, base }); location.hash = styleHash(result.style); }
  });
}
$("new-style").addEventListener("click", () => newStyle());
fill($("language"), dropdown({ value: language, title: t("Language"), options: LANGUAGES.map(([value, label]) => ({ value, label })), onChange: setLanguage }));

function renameStyle(style) {
  return askName({
    title: t("Rename"), value: style, confirm: t("Change"),
    submit: async name => {
      if (name === style) return;
      await api("/api/styles/rename", { style, name });
      if (route.name === "style") location.hash = styleHash(name);
      else load();
    }
  });
}

async function deleteStyle(style) {
  const yes = await ask({ title: t("Delete {name}", { name: style }), description: t("The style, its references, archived images, and sessions are all deleted. This cannot be undone."), confirm: t("Delete"), input: null, danger: true });
  if (!yes) return;
  try { await api("/api/styles/delete", { style }); if (route.name === "style") location.hash = "#/"; else load(); }
  catch (error) { toast(error.message, "error"); }
}

// Adding an image to a style's references is one action; the references themselves are managed where they are listed.
async function addToReferences(style, path) {
  try {
    const result = await api("/api/references/add", { style, path });
    toast(result.added ? t("Added to references") : t("Already in references"));
    load();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function removeReference(path) {
  try { await api("/api/references/remove", { style: data.style, file: fileName(path) }); toast(t("Removed from references")); load(); }
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
  if (summary.kind && summary.waiting) return pill(t("{kind} · your turn", { kind: KIND_NAMES[summary.kind] }), { tone: "accent", dot: "static" });
  if (summary.working) return pill(summary.kind ? t("{kind} · working", { kind: KIND_NAMES[summary.kind] }) : t("Working"), { tone: "accent", dot: "live" });
  if (summary.confirmed) return pill(t("Confirmed"), { tone: "success" });
  return pill(t("Not started"));
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
  document.title = `${t("Styles")} · Asset Studio`;
  const cards = home.styles.map(summary => h("a", {
    class: "card", href: styleHash(summary.name),
    oncontextmenu: event => {
      event.preventDefault();
      openMenu({ x: event.clientX, y: event.clientY }, [
        { label: t("Rename"), onClick: () => renameStyle(summary.name) },
        summary.confirmed ? { label: t("New style from this one"), onClick: () => newStyle(summary.name) } : null,
        { label: t("Delete"), onClick: () => deleteStyle(summary.name), danger: true }
      ]);
    }
  }, [
    summary.cover ? imageFrame(summary.cover, { fit: "fill" }) : h("div", { class: "placeholder", text: t("No images yet") }),
    h("div", { class: "card-body" }, [
      h("div", { class: "card-title" }, [h("strong", { text: summary.name }), statusPill(summary)]),
      h("p", { class: "card-purpose", text: summary.purpose || t("Finding the style in conversation.") }),
      h("div", { class: "card-meta" }, [
        summary.based_on ? h("span", { text: t("Based on {base}", { base: summary.based_on }) }) : null,
        summary.archived ? h("span", { text: t("{count} archived", { count: summary.archived }) }) : null
      ])
    ])
  ]));

  fill($("view"), h("div", { class: "page", id: "home" }, [
    h("div", { class: "page-head" }, [h("div", {}, [h("h1", { text: t("Styles") }), h("p", { text: tn("{count} style", "{count} styles", home.styles.length) })])]),
    cards.length ? h("div", { class: "cards" }, cards) : emptyState({ title: t("Make your first style"), text: t("Describe the pictures you want in conversation, and the style is written down together."), action: button(t("New style"), { variant: "primary", onClick: () => newStyle() }) })
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
    info: [[t("Style"), item.style], [t("Request"), item.request], [t("Model"), item.model && `${shortModel(item.model)}${item.cost != null ? ` · ${money(item.cost)}` : ""}`], [t("Prompt"), item.prompt, true], [t("Made at"), item.time && item.time.replace("T", " ").slice(0, 16)]]
  };
}

// Choosing images only toggles classes and the bar, so the grid's images are never rebuilt (rebuilding them flickers).
function renderArchive() {
  document.title = `${t("Archive")} · Asset Studio`;
  const { all, shown } = archiveItems();
  const items = shown.map(lightboxFromArchive);
  const chips = [chip(t("All {count}", { count: all.length }), { on: !route.filter, onClick: () => { location.hash = "#/archive"; } }),
    ...archiveData.styles.map(shelf => chip(`${shelf.style} ${shelf.items.length}`, { on: route.filter === shelf.style, onClick: () => { location.hash = `#/archive/${encodeURIComponent(shelf.style)}`; } }))];

  const tiles = shown.map((item, index) => {
    const key = `${item.style}/${item.file}`;
    return h("figure", { class: `tile${selecting && selecting.has(key) ? " picked" : ""}`, "data-key": key }, [
      imageFrame(item.file, {
        fit: "fill", check: true,
        onClick: () => selecting ? toggleArchivePick(key) : openLightbox(items, index),
        tools: [
          tool("reference", t("Add to references"), () => addToReferences(item.style, item.file)),
          tool("download", t("Download"), null, { href: fileUrl(item.file), download: `${item.style}-${fileName(item.file)}` })
        ]
      }),
      h("figcaption", {}, [h("span", { text: item.request || "" }), h("span", { text: item.style })])
    ]);
  });

  fill($("view"), h("div", { class: "page" }, [
    h("div", { class: "page-head" }, [
      h("div", {}, [h("h1", { text: t("Archive") }), h("p", { text: t("Every image made with a style, and every reference, is kept here.") })]),
      shown.length ? button(selecting ? t("Cancel selection") : t("Select"), { onClick: event => setSelecting(!selecting, event.currentTarget) }) : null
    ]),
    all.length ? h("div", { class: "chips" }, chips) : null,
    shown.length ? h("div", { class: `grid${selecting ? " selecting" : ""}`, id: "archive-grid" }, tiles) : h("div", { id: "archive-grid" }, [emptyState({ title: t("Nothing archived yet"), text: t("Images made with a confirmed style are kept here automatically.") })]),
    h("div", { id: "selection-bar" })
  ]));
  syncArchiveSelection();
}

function setSelecting(on, trigger) {
  selecting = on ? new Set() : null;
  trigger.querySelector("span").textContent = on ? t("Cancel selection") : t("Select");
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
    h("span", { text: tn("{count} selected", "{count} selected", selecting.size) }),
    h("div", { class: "row" }, [
      button(t("Select all"), { onClick: () => { archiveItems().shown.forEach(item => selecting.add(`${item.style}/${item.file}`)); syncArchiveSelection(); } }),
      button(t("Download"), { variant: "primary", iconName: "download", disabled: !selecting.size, onClick: downloadSelected })
    ])
  ]));
}

async function downloadSelected() {
  const { all } = archiveItems();
  const files = all.filter(item => selecting.has(`${item.style}/${item.file}`)).map(item => ({ path: item.file, name: `${item.style}-${fileName(item.file)}` }));
  try {
    const response = await fetch("/api/download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files }) });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || t("Could not download"));
    const link = h("a", { href: URL.createObjectURL(await response.blob()), download: `asset-studio-${files.length}.zip` });
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  } catch (error) {
    toast(error.message, "error");
  }
}

// ---------- style page ----------

function renderMissing(message) {
  fill($("view"), h("div", { class: "page" }, [emptyState({ title: t("Cannot open the style"), text: message, action: h("a", { class: "button", href: "#/", text: t("Back to styles") }) })]));
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
        h("div", { class: "panel-resize", id: "panel-resize", title: t("Drag to resize") })
      ]),
      h("div", { class: "stage-column" }, [
        h("section", { class: "stage", id: "stage", onscroll: syncLatestButton }, [
          h("div", { class: "stage-inner", id: "stage-inner" }),
          h("button", { class: "latest", id: "latest", type: "button", hidden: true, html: `${icon("down")}<span>${t("New messages")}</span>`, onclick: () => scrollToLatest(true) })
        ]),
        h("div", { class: "dock", id: "dock" })
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
  if (overview.confirmed && !session) pills.push(pill(t("Confirmed"), { tone: "success" }));
  const model = session ? (current ? (current.blind ? "" : current.model) : session.model) : overview.model;
  if (model) pills.push(pill(shortModel(model)));
  if (overview.based_on && !session) pills.push(pill(t("Based on {base}", { base: overview.based_on })));
  if (current && current.session_cost > 0) pills.push(pill(t("Cost {cost}", { cost: money(current.session_cost) })));
  const inSession = session && session.kind !== "make";

  fill($("panel-head"),
    h("a", { class: "back", href: inSession ? styleHash(data.style) : "#/", text: `← ${inSession ? data.style : t("Styles")}` }),
    h("h1", { text: inSession ? session.title || sessionName(session) : data.style }),
    inSession ? h("p", { class: "subtitle", text: t("{kind} session · started {when}", { kind: sessionName(session), when: when(session.started) }) }) : null,
    session && session.kind === "make" ? h("div", { class: "stepper" }, STAGES.map(([, name], index) => h("div", { class: `step${index < stage ? " done" : index === stage ? " now" : ""}`, text: name }))) : null,
    pills.length ? h("div", { class: "facts" }, pills) : null
  );
}

// The documents shown with this view: the round's copies while it is open, the style's own otherwise.
function documents() {
  const source = view() || data.overview;
  return [["brief", t("Brief"), source.brief], ["spec", t("Style"), source.spec], ["prompting", t("Prompt"), source.prompting]].filter(([, , text]) => text);
}

function renderTabs() {
  const docs = documents();
  if (!docs.some(([key]) => key === panelTab)) panelTab = "work";
  $("tabs").hidden = !docs.length;
  fill($("tabs"), ...[["work", data.session ? t("Work") : t("Overview")], ...docs].map(([key, label]) => h("button", {
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
  fill($("dock"), );
  if (!data.session) return renderIdlePanel(body, actions);
  if (!current) {
    fill(body, workingNote(data.session.kind === "model" ? t("Writing the prompt guide for this model") : t("Getting ready")));
    fill(actions, );
    return;
  }
  if (!answering()) {
    const decision = current.feedback.decision;
    fill(body, workingNote(WAITING[decision] || CONTINUING[current.kind] || t("Preparing the next step")));
    fill(actions, );
    return;
  }
  const panels = { discover: discoverPanel, sample: samplePanel, confirm: confirmPanel, generate: generatePanel, model: modelPanel };
  panels[current.kind](current, body, actions);
}

function renderIdlePanel(body, actions) {
  const overview = data.overview;
  if (!overview.confirmed) {
    fill(body, h("h2", { text: t("No open session") }));
    fill(actions, );
    return;
  }
  const sessions = data.sessions.filter(session => session.kind !== "make").sort((a, b) => b.updated.localeCompare(a.updated));
  fill(body,
    h("h2", { text: t("Make images in this style") }),
    h("p", { class: "lead", text: t("A new image is drawn straight from what you write; a new ideation works out what to draw in conversation. Images you make are kept in the archive.") }),
    h("dl", { class: "facts-list" }, [
      h("div", {}, [h("dt", { text: t("References") }), h("dd", { text: tn("{count} image", "{count} images", overview.references.length) })]),
      h("div", {}, [h("dt", { text: t("Archived images") }), h("dd", { text: tn("{count} image", "{count} images", data.archive.length) })]),
      overview.based_on ? h("div", {}, [h("dt", { text: t("Base style") }), h("dd", { text: overview.based_on })]) : null
    ]),
    sectionTitle(t("Models"), button(t("Add model"), { small: true, onClick: addModel })),
    h("div", { id: "model-rows" }, [rowList(overview.models.map(modelRow))]),
    sectionTitle(t("Sessions"), sessions.length ? String(sessions.length) : ""),
    sessions.length ? rowList(sessions.map(sessionRow)) : h("p", { class: "muted", text: t("No sessions yet.") })
  );
  const image = button(t("New image"), { variant: "primary", grow: true });
  image.addEventListener("click", () => openSession("generate", null, image));
  const ideation = button(t("New ideation"), { grow: true });
  ideation.addEventListener("click", () => openSession("generate", null, ideation, true));
  fill(actions, ideation, image);
  if (!catalogModels) loadCatalog().then(() => { if ($("model-rows")) fill($("model-rows"), rowList(data.overview.models.map(modelRow))); }).catch(() => {});
}

// A row per model: choosing one makes it the model in use; any other can be removed.
function modelRow(model) {
  const inUse = model === data.overview.model;
  const listed = catalogModels && catalogModels.find(each => each.id === model);
  return listRow({
    title: shortModel(model), detail: listed ? priceLabel(listed) : model, current: inUse, hint: inUse ? null : t("Draw with this model"), onClick: () => useModel(model),
    aside: inUse ? pill(t("In use"), { tone: "success" }) : tool("trash", t("Delete model"), () => removeModel(model), { quiet: true })
  });
}

async function removeModel(model) {
  const yes = await ask({ title: t("Delete model"), description: t("Deletes {model} and its prompt guide for this style. Images made with it stay in the archive.", { model: shortModel(model) }), confirm: t("Delete"), input: null, danger: true });
  if (!yes) return;
  try { await api("/api/models/delete", { style: data.style, model }); toast(t("Model deleted")); load(); }
  catch (error) { toast(error.message, "error"); }
}

function sessionRow(session) {
  return listRow({
    title: session.title || (session.kind === "generate" ? t("New {kind}", { kind: sessionName(session) }) : SESSION_NAMES[session.kind]),
    detail: `${sessionName(session)} · ${when(session.updated)}`,
    onClick: () => { location.hash = styleHash(data.style, session.id); },
    aside: h("div", { class: "row" }, [session.waiting ? null : pill(t("Working"), { tone: "accent", dot: "live" }), tool("trash", t("Delete session"), () => deleteSession(session), { quiet: true })])
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
  const yes = await ask({ title: t("Delete session"), description: session.kind === "model" ? t("Stops adding this model and deletes its records.") : t("Deletes the session's records. Images made in it stay in the archive."), confirm: t("Delete"), input: null, danger: true });
  if (!yes) return;
  try {
    await api("/api/sessions/delete", { style: data.style, session: session.id });
    if (route.session === session.id) location.hash = styleHash(data.style);
    else load();
  } catch (error) { toast(error.message, "error"); }
}

async function useModel(model) {
  try { await api("/api/model", { style: data.style, model }); toast(t("Drawing with {model}", { model: shortModel(model) })); load(); }
  catch (error) { toast(error.message, "error"); }
}

// What one image costs: measured here when it has been used, else the listed price by its billing unit.
function priceLabel(model) {
  if (model.measured != null) return t("{cost} / image", { cost: money(model.measured) });
  const price = model.price;
  if (!price || price.cost == null) return t("No price listed");
  if (price.cost === 0) return t("Free");
  const from = price.varies ? t(" and up") : "";
  if (price.unit === "image") return t("{cost} / image", { cost: money(price.cost) }) + from;
  if (price.unit === "megapixel") return t("About {cost} / 1K image", { cost: money(price.cost * 1.05) }) + from;
  return t("Token priced (${per} per million)", { per: (price.cost * 1e6).toFixed(0) });
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
      detail: [model.id, t("Up to {count} references", { count: model.references }), model.measured != null ? t("measured") : null, model.price && model.price.reference ? t("{cost} per reference", { cost: money(model.price.reference) }) : null].filter(Boolean).join(" · ")
    }));
  const model = await ask({ title: t("Add model"), description: t("Choosing one writes a prompt guide for it, refined over a few drawings. Prices are for one 1K image."), confirm: t("Start adding"), input: null, choices });
  if (model) openSession("model", model);
}

// The message box under the stage: the images attached to this answer, the text, and the button that sends it.
function answerBox(key, placeholder, { attaching = true, sendTitle, onSend, onInput = null }) {
  const current = view();
  return composer({
    value: draft[key], placeholder, sendTitle: `${sendTitle} (⌘↵)`, onSend,
    onInput: value => { draft[key] = value; if (onInput) onInput(); },
    attach: attaching ? attachButton() : null,
    attachments: attaching ? current.attachments.map(path => thumb(path, { remove: () => detach(path) })) : []
  });
}

const sendButton = () => document.querySelector("#dock .composer-send");

function attachButton() {
  return uploadButton(t("Attach images"), async files => {
    for (const file of files) {
      try { await api("/api/attach", { style: data.style, session: data.session.id, name: file.name, data: await readFile(file) }); }
      catch (error) { toast(error.message, "error"); }
    }
    await load();
  }, { variant: "ghost" });
}

async function detach(path) {
  try { await api("/api/detach", { style: data.style, session: data.session.id, path }); await load(); }
  catch { toast(t("Could not remove the image. Reload and try again."), "error"); }
}

// The talk of a make session writes the style; ideation in a generate session writes the image's brief.
function discoverPanel(current, body, actions) {
  const imageTalk = data.session.kind === "generate";
  const written = imageTalk ? current.brief : current.spec;
  const lead = current.candidates.length ? t("Pick the images you like; each can carry a note.") : written ? (imageTalk ? t("If the brief I wrote is off, just correct it.") : t("If the description I wrote is off, just correct it.")) : null;
  const next = imageTalk ? [t("Generate"), "generate"] : [t("Sample"), "sample"];
  fill(body,
    h("h2", { text: imageTalk ? (written ? t("Check the brief") : t("Tell me what image you need")) : written ? t("Check the description") : t("Tell me the style you want") }),
    lead ? h("p", { class: "lead", text: lead }) : null
  );
  fill(actions, written ? button(next[0], { variant: "success", grow: true, onClick: () => submit(next[1]) }) : null);
  fill($("dock"), answerBox("comment", imageTalk ? t("e.g. An app icon, but I don't know what to draw yet") : t("e.g. A little softer and simpler"), { sendTitle: t("Send"), onSend: () => submit(null), onInput: syncSend }));
  syncSend();
}

// A discover answer can be words, picks, notes, or attachments; any one of them is enough to send.
function syncSend() {
  const send = kind() === "discover" ? sendButton() : null;
  if (send) send.disabled = !draft.comment.trim() && !draft.picked.size && !Object.keys(draft.notes).length && !view().attachments.length;
}

function samplePanel(current, body, actions) {
  const box = answerBox("request", t("e.g. A mug by the window on a rainy day"), { sendTitle: t("Draw"), onSend: () => submit("request"), onInput: () => update() });
  const update = () => { box.send.disabled = !draft.request.trim(); };
  fill(body,
    h("h2", { text: t("Try drawing in this style") }),
    h("p", { class: "lead", text: current.unit_cost != null ? t("{cost} an image", { cost: money(current.unit_cost) }) : t("What you write is drawn one image at a time.") })
  );
  fill(actions, button(t("Style"), { grow: true, onClick: () => submit("discover", draft.request) }), button(t("Confirm"), { variant: "success", grow: true, hidden: !current.candidates.length, onClick: () => submit("confirm") }));
  fill($("dock"), box);
  update();
}

function confirmPanel(current, body, actions) {
  const box = answerBox("comment", t("Anything more you want to see? e.g. One or two more subjects"), { attaching: false, sendTitle: t("Send"), onSend: () => submit(null), onInput: () => update() });
  const update = () => { box.send.disabled = !draft.comment.trim(); };
  fill(body,
    h("h2", { text: t("Pick the images to use as references") }),
    h("p", { class: "lead", id: "selection-count" })
  );
  fill(actions, button(t("Sample"), { onClick: () => submit("sample", draft.comment) }), button(t("Confirm"), { variant: "success", grow: true, onClick: () => submit("done") }));
  fill($("dock"), box);
  update();
  syncSelection();
}

function generatePanel(current, body, actions) {
  const started = current.candidates.length > 0;
  const box = answerBox("request", started ? t("e.g. A bigger handle") : t("e.g. A coffee cup in front of a laptop"), { sendTitle: t("Generate"), onSend: () => submit(draft.picked.size ? "refine" : "new"), onInput: () => update() });
  const fresh = button(t("Draw new"), { iconName: "plus", grow: true, hidden: !started, onClick: () => submit("new") });
  const update = () => { box.send.disabled = fresh.disabled = !draft.request.trim(); };
  fill(body,
    h("h2", { text: started ? t("Pick one and write what to change") : t("What shall we make?") }),
    h("p", { class: "lead", id: "selection-count", text: started ? "" : t("Images you make are kept in the archive automatically.") })
  );
  fill(actions, button(t("Ideation"), { grow: true, onClick: () => submit("discover", draft.request) }), fresh);
  fill($("dock"), box);
  update();
  syncSelection();
}

function modelPanel(current, body, actions) {
  const box = answerBox("request", t("e.g. A monstera by the window"), { sendTitle: t("Draw"), onSend: () => submit("request"), onInput: () => update() });
  const update = () => { box.send.disabled = !draft.request.trim(); };
  fill(body,
    h("h2", { text: t("Try drawing with {model}", { model: shortModel(current.model) }) }),
    h("p", { class: "lead", text: t("Each image is drawn with the references attached. When it looks like this style, press Add.") })
  );
  fill(actions, button(t("Add"), { variant: "success", grow: true, hidden: !current.candidates.length, onClick: () => submit("done") }));
  fill($("dock"), box);
  update();
}

// What the picks mean for the next step, kept in step with the cards.
function syncSelection() {
  const count = $("selection-count");
  if (kind() === "confirm") {
    if (count) count.textContent = draft.picked.size ? tn("{count} picked. The more varied the subjects and colors, the better.", "{count} picked. The more varied the subjects and colors, the better.", draft.picked.size) : "";
    const done = [...$("panel-actions").querySelectorAll(".button.success")].pop();
    if (done) done.disabled = !draft.picked.size;
  }
  if (kind() === "generate" && view().candidates.length && count) {
    const [picked] = [...draft.picked];
    count.textContent = picked ? t("Changing number {number}", { number: pad(picked) }) : t("Nothing picked draws a new one");
  }
}

async function submit(decision, reason = "") {
  const buttons = [...$("panel-actions").querySelectorAll("button"), ...$("dock").querySelectorAll("button")];
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
  if (!current) return fill(stage, workingNote(t("Getting ready")));
  const stages = { discover: discoverStage, sample: boardStage, confirm: confirmStage, generate: boardStage, model: boardStage };
  fill(stage, ...stages[current.kind](current));
}

function overviewStage() {
  const overview = data.overview;
  const references = overview.references.map(path => ({ path, name: `${data.style}-${fileName(path)}`, info: [] }));
  const made = [...data.archive].reverse();
  const madeItems = made.map(item => lightboxFromArchive({ ...item, style: data.style }));
  const addTile = h("label", { class: "add-tile", title: t("Upload images to add to references") }, [h("span", { html: icon("plus") }), h("small", { text: t("Add reference") })]);
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
    sectionTitle(t("References"), tn("{count} image", "{count} images", references.length)),
    h("div", { class: "grid compact" }, [
      ...references.map((item, index) => imageFrame(item.path, {
        fit: "fill", lazy: false, onClick: () => openLightbox(references, index),
        tools: [tool("close", t("Remove from references"), () => removeReference(item.path))]
      })),
      addTile
    ]),
    sectionTitle(t("Recent images"), made.length ? h("a", { href: `#/archive/${encodeURIComponent(data.style)}`, text: t("See in the archive") }) : null),
    made.length ? h("div", { class: "grid compact" }, made.slice(0, 18).map((item, index) => imageFrame(item.file, {
      fit: "fill", onClick: () => openLightbox(madeItems, index),
      tools: [
        tool("reference", t("Add to references"), () => addToReferences(data.style, item.file)),
        tool("download", t("Download"), null, { href: fileUrl(item.file), download: `${data.style}-${fileName(item.file)}` })
      ]
    }))) : emptyState({ text: t("No images yet. Start with New image or New ideation on the left.") })
  ];
}

// Any image of a confirmed style can be added to its references wherever it is shown.
function lightboxItems(candidates) {
  const adds = data.overview.confirmed;
  return candidates.map(candidate => ({
    path: candidate.path,
    name: `${data.style}-${fileName(candidate.path)}`,
    add: adds ? { style: data.style, path: candidate.path } : null,
    info: [[t("Request"), candidate.request], [t("Agent's note"), candidate.description], [t("My note"), candidate.note], [t("Review"), candidate.review], [t("Model"), candidate.model && `${shortModel(candidate.model)}${candidate.cost != null ? ` · ${money(candidate.cost)}` : ""}`], [t("Prompt"), candidate.prompt, true]]
  }));
}

function messageNode(who, children) {
  return h("div", { class: `message ${who}` }, [h("div", { class: "avatar", text: who === "user" ? t("Me") : "AS" }), h("div", { class: "message-body" }, children)]);
}

function thumbRow(candidates) {
  const items = lightboxItems(candidates);
  return h("div", { class: "thumbs" }, candidates.map((candidate, index) => thumb(candidate.path, { picked: candidate.picked, title: candidate.description || t("Enlarge"), onClick: () => openLightbox(items, index) })));
}

// What the user said about the images of a turn: each picked or noted image with its number, the pick, and the note.
function answerMarks(candidates) {
  const marked = candidates.filter(candidate => candidate.picked || candidate.note);
  if (!marked.length) return null;
  const items = lightboxItems(marked);
  return h("div", { class: "marks" }, marked.map((candidate, index) => h("div", { class: "mark" }, [
    thumb(candidate.path, { small: true, picked: candidate.picked, onClick: () => openLightbox(items, index) }),
    h("div", {}, [
      h("span", { class: "mark-head" }, [t("No. {number}", { number: pad(candidate.number) }), candidate.picked ? pill(t("Picked"), { tone: "accent", small: true }) : null]),
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
    const text = visit ? [t("Drawn in {kind}", { kind: KIND_NAMES[turn.kind] }), ...requests.map(request => `· ${request}`)].join("\n") : turn.message;
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
  return WAITING[decision] || CONTINUING[current.kind] || t("Preparing the next step");
}

function candidateGrid(candidates, { flush = false } = {}) {
  const items = lightboxItems(candidates);
  return h("div", { class: `candidates${flush ? " flush" : ""}` }, candidates.map((candidate, index) => candidateCard(candidate, index, items)));
}

function candidateCard(candidate, index, items) {
  const isPicked = answering() ? draft.picked.has(candidate.number) : candidate.picked;
  const note = answering() ? draft.notes[candidate.number] || "" : candidate.note || "";
  const memo = selectable() && kind() !== "confirm" ? tool("memo", note || t("Note"), () => editNote(candidate), { on: Boolean(note) }) : null;
  return h("div", { class: `candidate${selectable() ? " selectable" : ""}${isPicked ? " picked" : ""}`, "data-number": candidate.number }, [
    imageFrame(candidate.path, {
      number: candidate.number, check: selectable(),
      onClick: () => selectable() ? togglePick(candidate.number) : openLightbox(items, index),
      tools: [memo, tool("zoom", t("Enlarge"), () => openLightbox(items, index))]
    }),
    candidate.description ? h("div", { class: "label", text: candidate.description }) : null,
    note ? field(t("My note"), note) : null
  ]);
}

// A note travels with the answer whether or not the image is picked: a reason to pick, or what falls short.
async function editNote(candidate) {
  const text = await ask({ title: t("Note on No. {number}", { number: pad(candidate.number) }), description: t("Write what works or what falls short. Images you do not pick can have notes too."), value: draft.notes[candidate.number] || "", placeholder: t("e.g. I like the soft shadow"), confirm: t("Save") });
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
    sectionTitle(t("Reference candidates"), tn("{count} image", "{count} images", current.candidates.length)),
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
          tool("zoom", t("Enlarge"), () => openLightbox(items, index)),
          adds ? tool("reference", t("Add to references"), () => addToReferences(data.style, candidate.path)) : null,
          tool("download", t("Download"), null, { href: fileUrl(candidate.path), download: `${data.style}-${fileName(candidate.path)}` })
        ]
      }),
      h("div", { class: "entry-info" }, [
        field(t("Request"), candidate.request || "-", { strong: true }),
        candidate.description ? field(t("Agent's note"), candidate.description) : null,
        candidate.review ? field(t("Review"), candidate.review) : null,
        candidate.prompt ? field(t("Prompt"), candidate.prompt, { mono: true, grows: true }) : null,
        facts ? h("span", { class: "meta", text: facts }) : null
      ])
    ]);
  });

  const decision = current.feedback && current.feedback.decision;
  if (DRAWING.includes(decision)) {
    entries.push(h("article", { class: "entry" }, [
      h("div", { class: "pending-frame" }, [h("span", { class: "spinner" }), t("Drawing")]),
      h("div", { class: "entry-info" }, [field(t("Request"), current.feedback.request, { strong: true })])
    ]));
  }

  const references = current.references.length ? [
    sectionTitle(t("References"), tn("{count} image", "{count} images", current.references.length)),
    h("div", { class: "thumbs" }, current.references.map((path, index, all) => thumb(path, { onClick: () => openLightbox(all.map(reference => ({ path: reference, info: [] })), index) }))),
    h("div", { style: "height: 24px" })
  ] : [];
  const waiting = waitingText(current);
  const title = { generate: t("Images made"), sample: t("Sample"), model: t("Drawn with {model}", { model: shortModel(current.model) }) }[current.kind];

  return [
    ...references,
    sectionTitle(title, ordered.length ? tn("{count} image", "{count} images", ordered.length) : ""),
    entries.length ? h("div", { class: "entries" }, entries) : emptyState({ text: isGenerate ? t("Write what you want to make below.") : t("Write what to draw below.") }),
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
