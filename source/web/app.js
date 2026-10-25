"use strict";

// The studio's shell and the pages it owns: the app bar, the router and polling, the lightbox, home, the thread page,
// and the archive. The project canvas is in canvas.js and the style page in style.js; each registers itself with page().
// Everything is built from the components in ui.js.

// ---------- small helpers ----------

const money = value => value == null ? "-" : `$${value < 0.01 && value > 0 ? value.toFixed(4) : value.toFixed(3)}`;
const pad = (number, width = 2) => String(number).padStart(width, "0");
const shortModel = model => (model || "").split("/").pop();
const fileName = path => path.split("/").pop();
const encode = encodeURIComponent;
// Paths in a project's records are relative to the project; the server serves files by their workspace path.
const inProject = (project, path) => `projects/${project}/${path}`;
const objectUrl = name => `/object/${name}`;
const TOOL_NAMES = { cutout: t("Background removal") };
const KIND_NAMES = { generation: t("Generation"), tool: t("Tool"), upload: t("Upload") };
const THREAD_NAMES = { style: t("Style thread"), ideation: t("Ideation") };

function when(time) {
  if (!time) return "";
  const date = new Date(time.replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
  const minutes = Math.round((Date.now() - date) / 60000);
  if (minutes < 1) return t("just now");
  if (minutes < 60) return t("{n} min ago", { n: minutes });
  if (minutes < 60 * 24) return t("{n} h ago", { n: Math.round(minutes / 60) });
  return date.toLocaleDateString(language, { month: "short", day: "numeric" });
}

const stamp = time => time ? time.replace("T", " ").slice(0, 16) : "";

// Every call to the server. A response that says when the agent last looked updates the app bar.
async function api(path, body) {
  let response;
  try {
    response = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw Object.assign(new Error(t("Server unreachable. Reconnecting…")), { offline: true });
  }
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(value.error || t("The request failed ({status})", { status: response.status })), { status: response.status });
  if (value && value.agent) showAgent(value.agent);
  return value;
}

function readFile(file) {
  return new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(",")[1]); reader.readAsDataURL(file); });
}

// What a page compares between polls: its data without the agent's age, which changes on every call.
const signatureOf = (value, ...more) => JSON.stringify([{ ...value, agent: undefined }, agentAttached(), ...more]);

// The rule of workspace.py stored_name, checked here first so a wrong name is answered in the viewer's language.
const NAME = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}-]{1,40}$/u;

async function askName({ title, description = "", value = "", confirm, taken, submit }) {
  let error = "";
  for (;;) {
    const name = await ask({ title, description, value, error, placeholder: t("Name, e.g. blog-cover"), confirm, input: "text" });
    if (name == null) return;
    value = name;
    const normalized = name.normalize("NFKC");
    if (!NAME.test(normalized) || normalized !== normalized.toLowerCase()) { error = t("Use two or more letters (lowercase for Latin), digits, and hyphens."); continue; }
    try { return await submit(normalized); }
    catch (failure) { error = failure.message.includes("already exists") ? taken : failure.message; }
  }
}

async function confirmDelete(title, description) {
  return ask({ title, description, confirm: t("Delete"), input: null, danger: true });
}

// ---------- pages and routing ----------

// A page module: { enter(route), load(route), leave() }. web/README.md has the contract.
const pages = {};
function page(name, module) { pages[name] = module; }

const hashes = {
  home: () => "#/",
  archive: () => "#/archive",
  project: (project, node = null) => `#/p/${encode(project)}${node ? `?node=${encode(node)}` : ""}`,
  style: (project, style, proposal = null) => `#/p/${encode(project)}/s/${encode(style)}${proposal ? `?proposal=${encode(proposal)}` : ""}`,
  thread: (project, thread) => `#/p/${encode(project)}/t/${encode(thread)}`
};

function readRoute() {
  const [path, query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  let parts;
  try { parts = path.split("/").map(decodeURIComponent); } catch { parts = []; }
  const params = Object.fromEntries(new URLSearchParams(query));
  if (parts[0] === "p" && parts[1]) {
    if (parts[2] === "s" && parts[3]) return { name: "style", project: parts[1], style: parts[3], params };
    if (parts[2] === "t" && parts[3]) return { name: "thread", project: parts[1], thread: parts[3], params };
    return { name: "project", project: parts[1], params };
  }
  if (parts[0] === "archive") return { name: "archive", params };
  return { name: "home", params };
}

let route = null;
let shown = null;
let loading = false;

function go() {
  if (shown && shown.leave) shown.leave();
  route = readRoute();
  shown = pages[route.name];
  closeMenu();
  $("lightbox").hidden = true;
  document.querySelectorAll("[data-nav]").forEach(link => link.classList.toggle("on", link.dataset.nav === (route.name === "archive" ? "archive" : "home")));
  fill($("view"));
  document.title = "Asset Studio";
  if (shown.enter) shown.enter(route);
  load();
}
window.addEventListener("hashchange", go);

async function load() {
  const at = route;
  loading = true;
  try {
    await shown.load(at);
    $("lost").hidden = true;
    // Pages that do not report the agent still keep the app bar current.
    if (Date.now() - agent.checked > 10000) await api("/api/projects");
  } catch (error) {
    if (at !== route) return;
    if (error.offline) $("lost").hidden = false;
    else if (error.status === 404 || error.status === 400) renderMissing(error.message);
    else console.error(error);
  } finally {
    loading = false;
  }
}

function renderMissing(message) {
  fill($("view"), h("div", { class: "page" }, [emptyState({ title: t("Cannot open this page"), text: message, action: linkButton(t("Back to projects"), hashes.home(), { small: false }) })]));
}

// ---------- app bar ----------

// The agent is attached when it looked for work in the last ten minutes; watch looks every two seconds while idle.
const AGENT_WINDOW = 600;
const agent = { attached: null, checked: 0 };
const agentAttached = () => agent.attached === true;

function showAgent(state) {
  agent.checked = Date.now();
  const attached = state.seen != null && state.seen < AGENT_WINDOW;
  if (attached === agent.attached) return;
  agent.attached = attached;
  fill($("presence"), attached
    ? pill(t("Agent attached"), { tone: "success", dot: "static" })
    : pill(t("No agent: run {command}", { command: "open-package watch" }), { dot: "static" }));
  $("presence").title = attached ? t("The agent picks up requests and replies as they come.") : t("Requests and replies wait until an agent runs open-package watch.");
}

$("new-project").addEventListener("click", () => askName({
  title: t("New project"),
  description: t("A project is one purpose, such as an app or a blog, with its brief and styles."),
  confirm: t("Create"),
  taken: t("A project with this name already exists."),
  submit: async name => { const made = await api("/api/projects", { name }); location.hash = hashes.project(made.project); }
}));
fill($("language"), menuButton("languages", t("Language"), { value: language, options: LANGUAGES.map(([value, label]) => ({ value, label })), onChange: setLanguage }));

// The theme follows the system unless the viewer picks one; index.html applies a saved choice before the page draws.
const THEMES = [["system", t("System"), "monitor"], ["light", t("Light"), "sun"], ["dark", t("Dark"), "moon"]];

function renderTheme() {
  const current = document.documentElement.dataset.theme || "system";
  const chosen = THEMES.find(([value]) => value === current);
  fill($("theme"), menuButton(chosen[2], t("Theme"), { value: current, options: THEMES.map(([value, label]) => ({ value, label })), onChange: setTheme }));
}

function setTheme(theme) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("theme", theme); } catch {}
  renderTheme();
}
renderTheme();

// ---------- shared pieces of project pages ----------

// The head of a panel: the way back, the title with a menu of actions, and a line under it.
function panelHead({ back, title, subtitle = null, menu = null, facts = [] }) {
  return [
    button(back[0], { small: true, iconName: "previous", title: t("Back"), class: "back", onClick: () => { location.hash = back[1]; } }),
    h("div", { class: "title-row" }, [
      h("h1", { text: title }),
      menu ? tool("more", t("More"), event => { const box = event.currentTarget.getBoundingClientRect(); openMenu({ x: box.left, y: box.bottom + 4 }, menu); }, { quiet: true }) : null
    ]),
    subtitle ? h("p", { class: "subtitle" }, subtitle) : null,
    facts.filter(Boolean).length ? h("div", { class: "facts" }, facts) : null
  ];
}

// The handle on a panel's right edge; the width stays in this browser.
function panelResizer() {
  const range = [280, 560];
  const set = width => document.documentElement.style.setProperty("--panel", `${Math.min(range[1], Math.max(range[0], width))}px`);
  return h("div", {
    class: "panel-resize", title: t("Drag to resize"),
    onpointerdown: event => {
      event.preventDefault();
      document.body.classList.add("resizing");
      const left = event.currentTarget.parentNode.getBoundingClientRect().left;
      const move = moved => set(moved.clientX - left);
      const up = () => {
        document.body.classList.remove("resizing");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        try { localStorage.setItem("panel-width", parseInt(getComputedStyle(document.documentElement).getPropertyValue("--panel"))); } catch {}
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    }
  });
}
try { const saved = Number(localStorage.getItem("panel-width")); if (saved) document.documentElement.style.setProperty("--panel", `${saved}px`); } catch {}

// A review is "verdict: text" (document/review.md); the verdict is shown in the viewer's language.
const VERDICTS = { pass: [t("Pass"), "success"], instance: [t("Flaw in this image"), ""], drift: [t("Style drift"), "danger"], leak: [t("Reference leak"), "danger"] };

function readReview(text) {
  const match = /^\s*(pass|instance|drift|leak)\b\s*[:：—-]?\s*([\s\S]*)$/i.exec(text || "");
  return match ? { verdict: match[1].toLowerCase(), text: match[2].trim() } : { verdict: null, text: text || "" };
}

function reviewLine(text) {
  const review = readReview(text);
  const [label, tone] = VERDICTS[review.verdict] || [t("Review"), ""];
  return h("div", { class: "review", title: review.text }, [pill(label, { tone, small: true }), review.text ? h("span", { text: review.text }) : null]);
}

// Why a style cannot draw, in the viewer's language when the engine's reason is a known one.
function blockedReason(reason) {
  if (!reason) return "";
  if (/ is a guide/.test(reason)) return t("A guide lends its sections and draws nothing.");
  if (/has no model/.test(reason)) return t("No model yet.");
  if (/has no prompting file/.test(reason)) return t("No prompt guide for its model yet.");
  if (/has no style references/.test(reason)) return t("No style references yet.");
  return reason;
}

// Adding an image to a style's references is one action wherever the image is shown; references are managed on the style page.
async function addToReferences(project, path, styles = null) {
  try {
    if (!styles) styles = (await api(`/api/project?project=${encode(project)}`)).styles;
    if (!styles.length) return toast(t("This project has no styles yet."), "error");
    const style = styles.length === 1 ? styles[0].name : await ask({
      title: t("Add to references"), description: t("Choose the style that takes this image."), confirm: t("Add"), input: null,
      choices: styles.map(each => ({ value: each.name, title: each.name, detail: each.guide ? t("Guide") : each.purpose }))
    });
    if (!style) return;
    await api("/api/styles/references/add", { project, style, path });
    toast(t("Added to the references of {style}", { style }));
  } catch (error) {
    toast(error.message, "error");
  }
}

// ---------- lightbox ----------

let gallery = { items: [], index: 0 };

// items: [{ path (in the workspace), name, info: [[title, text or node, mono?]], add: () => void | null }]
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
  const info = (item.info || []).filter(([, value]) => value);
  $("lightbox").classList.toggle("bare", !info.length);
  fill($("lightbox-info"), ...info.flatMap(([title, value, mono]) => [
    h("h3", { text: title }),
    value instanceof Node ? h("div", { class: "lightbox-block" }, [value]) : mono ? h("pre", { class: "document", text: value }) : h("p", { text: value })
  ]));
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
$("lightbox-add").addEventListener("click", () => gallery.items[gallery.index].add());
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

// Everything a node image was made from: the request, the agent's words, the style at its revision, the model, the
// references attached and the ones left out with why, the prompt, and what the node cost.
function nodeImageItem(project, node, image, styles = null) {
  const used = node.references.length ? h("div", { class: "thumbs" }, node.references.map(item => thumb(item.path || item.object, {
    small: true, src: objectUrl(item.object), badge: ROLE_NAMES[item.role] || item.role, title: item.path || ""
  }))) : null;
  const dropped = node.dropped.length ? node.dropped.map(item => `${item.reference}: ${item.reason}`).join("\n") : null;
  const made = node.tool ? [t("Tool"), TOOL_NAMES[node.tool] || node.tool] : [t("Model"), shortModel(image.model || node.model)];
  return {
    path: inProject(project, image.path),
    name: `${project}-${node.id}-${fileName(image.path)}`,
    add: () => addToReferences(project, image.path, styles),
    info: [
      [t("Request"), node.request],
      [t("Agent's note"), image.description || node.note],
      [t("Review"), image.review ? reviewLine(image.review) : null],
      [t("Style"), node.style && (node.revision ? t("{style} at revision {revision}", { style: node.style, revision: node.revision }) : node.style)],
      made,
      [t("References used"), used],
      [t("References left out"), dropped],
      [t("Cost"), node.cost ? tn("{cost} for {count} image", "{cost} for {count} images", node.images.length, { cost: money(node.cost) }) : null],
      [t("Prompt"), image.prompt, true],
      [t("Made at"), stamp(node.time)]
    ]
  };
}
const ROLE_NAMES = { style: t("Style"), subject: t("Subject"), composition: t("Composition"), guide: t("Guide"), attachment: t("Attachment") };

// ---------- home ----------

const home = { signature: null };

page("home", {
  enter() { home.signature = null; document.title = `${t("Projects")} · Asset Studio`; },
  async load() {
    const next = await api("/api/projects");
    const signature = signatureOf(next);
    if (signature === home.signature && $("home")) return;
    home.signature = signature;
    renderHome(next.projects);
  }
});

function workingPill(count) {
  if (!count) return null;
  return agentAttached()
    ? pill(tn("Working on {count}", "Working on {count}", count), { tone: "accent", dot: "live" })
    : pill(tn("{count} waiting for the agent", "{count} waiting for the agent", count), { dot: "static" });
}

function renderHome(projects) {
  const cards = projects.map(project => h("a", {
    class: "card", href: hashes.project(project.name),
    oncontextmenu: event => {
      event.preventDefault();
      openMenu({ x: event.clientX, y: event.clientY }, [
        { label: t("Rename"), onClick: () => renameProject(project.name) },
        { label: t("Delete"), onClick: () => deleteProject(project.name), danger: true }
      ]);
    }
  }, [
    project.cover ? imageFrame(inProject(project.name, project.cover), { fit: "fill" }) : h("div", { class: "placeholder", text: t("No images yet") }),
    h("div", { class: "card-body" }, [
      h("div", { class: "card-title" }, [h("strong", { text: project.name }), workingPill(project.working)]),
      h("p", { class: "card-purpose", text: project.purpose || t("Write what the project is for in its brief.") }),
      h("div", { class: "card-meta" }, [
        h("span", { class: "card-styles", text: project.styles.length ? project.styles.join(" · ") : t("No styles yet") }),
        h("span", { text: tn("{count} item", "{count} items", project.nodes) })
      ])
    ])
  ]));
  fill($("view"), h("div", { class: "page", id: "home" }, [
    h("div", { class: "page-head" }, [h("div", {}, [h("h1", { text: t("Projects") }), h("p", { text: tn("{count} project", "{count} projects", projects.length) })])]),
    cards.length ? h("div", { class: "cards" }, cards) : emptyState({
      title: t("Make your first project"),
      text: t("A project holds one purpose, such as an app or a blog: its brief, its styles, and everything made for it."),
      action: button(t("New project"), { variant: "primary", onClick: () => $("new-project").click() })
    })
  ]));
}

function renameProject(project) {
  return askName({
    title: t("Rename"), value: project, confirm: t("Change"), taken: t("A project with this name already exists."),
    submit: async name => {
      if (name === project) return;
      await api("/api/projects/rename", { project, name });
      if (route.name === "home") load();
      else location.hash = hashes.project(name);
    }
  });
}

async function deleteProject(project) {
  if (!await confirmDelete(t("Delete {name}", { name: project }), t("Its brief, styles, images, and threads are all deleted. This cannot be undone."))) return;
  try { await api("/api/projects/delete", { project }); if (route.name === "home") load(); else location.hash = hashes.home(); }
  catch (error) { toast(error.message, "error"); }
}

// ---------- thread page ----------

// The conversation lives as long as the page; the composer and its draft live as long as the round they answer.
const conversation = { signature: null, data: null, draft: null, composer: null, place: null, following: false, seen: new Set(), primed: false };

page("thread", {
  enter() { Object.assign(conversation, { signature: null, data: null, draft: null, composer: null, place: null, following: false, seen: new Set(), primed: false }); },
  async load(at) {
    const next = await api(`/api/thread?project=${encode(at.project)}&thread=${encode(at.thread)}`);
    const signature = signatureOf(next);
    if (signature === conversation.signature) return;
    conversation.signature = signature;
    conversation.data = next;
    renderThread(at);
  }
});

const latestRound = () => conversation.data.rounds[conversation.data.rounds.length - 1] || null;
const openRound = () => { const latest = latestRound(); return latest && !latest.feedback ? latest : null; };
const threadTitle = data => data.title || THREAD_NAMES[data.kind];

function renderThread(at) {
  const data = conversation.data;
  const open = openRound();
  const key = open ? `${at.project}|${at.thread}|${open.round}` : null;
  if (!conversation.draft || conversation.draft.key !== key) conversation.draft = { key, picked: new Set(), notes: {}, comment: "" };
  document.title = `${threadTitle(data)} · Asset Studio`;

  if (!$("thread-page")) {
    fill($("view"), h("div", { class: "workspace", id: "thread-page" }, [
      h("aside", { class: "panel" }, [
        h("div", { class: "panel-head", id: "thread-head" }),
        h("div", { class: "panel-doc", id: "thread-doc" }),
        h("div", { class: "panel-actions", id: "thread-actions" }),
        panelResizer()
      ]),
      h("div", { class: "stage-column" }, [
        h("section", { class: "stage", id: "thread-stage", onscroll: () => { conversation.following = nearBottom(); } }, [h("div", { class: "stage-inner", id: "thread-inner" })]),
        h("div", { class: "dock", id: "thread-dock" })
      ])
    ]));
    // Load events do not bubble, so the stage listens in the capture phase.
    $("thread-stage").addEventListener("load", event => { if (conversation.following && event.target.tagName === "IMG") toBottom(); }, true);
    new ResizeObserver(() => {
      $("thread-stage").style.setProperty("--dock", `${$("thread-dock").offsetHeight}px`);
      if (conversation.following) toBottom();
    }).observe($("thread-dock"));
  }

  renderThreadPanel(at, data);
  const wasAtBottom = nearBottom();
  renderConversation(at, data);
  renderThreadDock(at);
  const place = `${at.project}|${at.thread}`;
  if (conversation.place !== place || wasAtBottom) { conversation.following = true; toBottom(); }
  conversation.place = place;
}

const nearBottom = () => { const stage = $("thread-stage"); return stage.scrollHeight - stage.scrollTop - stage.clientHeight < 80; };
const toBottom = () => { const stage = $("thread-stage"); stage.scrollTop = stage.scrollHeight; };

function renderThreadPanel(at, data) {
  const latest = latestRound();
  const ideation = data.kind === "ideation";
  fill($("thread-head"), ...panelHead({
    back: [at.project, hashes.project(at.project)],
    title: threadTitle(data),
    subtitle: [THREAD_NAMES[data.kind], " · ", h("a", { href: hashes.style(at.project, data.style), text: data.style }), ` · ${t("started {when}", { when: when(data.started) })}`],
    menu: [
      { label: t("Rename"), onClick: () => renameThread(at, data) },
      { label: t("Delete"), danger: true, onClick: () => deleteThread(at) }
    ]
  }));
  // A style thread shows style.md as the agent showed it in the latest round; an ideation shows the brief as it is now.
  const text = ideation ? data.brief : latest && latest.spec;
  fill($("thread-doc"),
    sectionTitle(ideation ? t("Brief") : t("Style"), !ideation && latest ? t("As shown in round {round}", { round: latest.round }) : null),
    text ? h("pre", { class: "document", text }) : h("p", { class: "muted", text: ideation ? t("The agent writes the brief here as the image takes shape.") : t("The agent writes the style here as you talk.") })
  );
  const open = openRound();
  fill($("thread-actions"), ideation ? button(t("Draw it"), {
    variant: "success", grow: true, iconName: "check", disabled: !data.brief || !open,
    title: !data.brief ? t("Waits for the brief") : !open ? t("Waits for the agent's reply") : t("Turns the brief into a generation on the canvas"),
    onClick: event => answer(at, "generate", event.currentTarget)
  }) : null);
}

async function renameThread(at, data) {
  let error = "";
  for (;;) {
    const name = await ask({ title: t("Rename"), value: data.title || "", error, placeholder: t("Name"), confirm: t("Change"), input: "text" });
    if (name == null || name === (data.title || "")) return;
    try { await api("/api/threads/rename", { project: at.project, thread: at.thread, name }); return load(); }
    catch (failure) { error = failure.message; }
  }
}

async function deleteThread(at) {
  if (!await confirmDelete(t("Delete this thread"), t("The conversation and its images are deleted. Images it put on the canvas stay."))) return;
  try { await api("/api/threads/delete", { project: at.project, thread: at.thread }); location.hash = hashes.project(at.project); }
  catch (error) { toast(error.message, "error"); }
}

// " enter" for what the conversation shows for the first time since the page opened, so it comes in with a motion.
function entering(key) {
  const fresh = !conversation.seen.has(key);
  conversation.seen.add(key);
  return fresh && conversation.primed ? " enter" : "";
}

function messageNode(who, children, key) {
  return h("div", { class: `message ${who}${entering(key)}` }, [h("div", { class: "avatar", text: who === "user" ? t("Me") : "AS" }), h("div", { class: "message-body" }, children)]);
}

function candidateItems(at, candidates) {
  return candidates.map(candidate => ({
    path: inProject(at.project, candidate.path),
    name: `${at.project}-${fileName(candidate.path)}`,
    add: () => addToReferences(at.project, candidate.path),
    info: [[t("Agent's note"), candidate.description], [t("My note"), candidate.note], [t("Model"), shortModel(candidate.model)]]
  }));
}

function renderConversation(at, data) {
  const nodes = [];
  const open = openRound();
  for (const round of data.rounds) {
    const items = candidateItems(at, round.candidates);
    const links = [
      ...round.proposals.map(id => linkButton(t("Proposal {id}", { id }), hashes.style(at.project, data.style, id), { iconName: "open" })),
      ...round.nodes.map(id => linkButton(t("{node} on the canvas", { node: id }), hashes.project(at.project, id), { iconName: "open" }))
    ];
    const agentSays = [
      round.note ? h("div", { class: "bubble", text: round.note }) : null,
      round !== open && round.candidates.length ? h("div", { class: "thumbs" }, round.candidates.map((candidate, index) => thumb(inProject(at.project, candidate.path), { picked: candidate.picked, badge: pad(candidate.number), title: candidate.description || t("Enlarge"), onClick: () => openLightbox(items, index) }))) : null,
      links.length ? h("div", { class: "message-links" }, links) : null
    ];
    if (agentSays.some(Boolean)) nodes.push(messageNode("agent", agentSays, `agent|${round.round}`));
    if (round === open && round.candidates.length) nodes.push(candidateGrid(at, round, items));
    if (round.feedback) nodes.push(userMessage(at, round, items));
  }
  const latest = latestRound();
  if (!latest) nodes.push(messageNode("agent", [h("div", { class: "bubble working" }, [h("span", { class: "spinner" }), t("Getting ready")])], "waiting|0"));
  else if (latest.feedback) nodes.push(messageNode("agent", [agentAttached()
    ? h("div", { class: "bubble working" }, [h("span", { class: "spinner" }), latest.feedback.decision === "generate" ? t("Drawing it on the canvas") : t("Reading your answer")])
    : h("div", { class: "bubble working" }, [t("No agent is attached, so this waits. Start one with open-package watch.")])], `waiting|${latest.round}`));
  fill($("thread-inner"), h("div", { class: "thread" }, nodes));
  conversation.primed = true;
}

// What the user answered: the reply, each picked or noted image with its number, the attachments, and a brief sent to the canvas.
function userMessage(at, round, items) {
  const feedback = round.feedback;
  const marked = round.candidates.map((candidate, index) => ({ candidate, index })).filter(({ candidate }) => candidate.picked || candidate.note);
  const attachments = feedback.attachments.map(path => ({ path: inProject(at.project, path), info: [] }));
  return messageNode("user", [
    feedback.decision === "generate" ? h("div", { class: "bubble" }, [t("Draw it")]) : null,
    feedback.comment ? h("div", { class: "bubble", text: feedback.comment }) : null,
    marked.length ? h("div", { class: "marks" }, marked.map(({ candidate, index }) => h("div", { class: "mark" }, [
      thumb(inProject(at.project, candidate.path), { small: true, picked: candidate.picked, onClick: () => openLightbox(items, index) }),
      h("div", {}, [
        h("span", { class: "mark-head" }, [t("No. {number}", { number: pad(candidate.number) }), candidate.picked ? pill(t("Picked"), { tone: "accent", small: true }) : null]),
        candidate.note ? h("span", { class: "mark-note", text: candidate.note }) : null
      ])
    ]))) : null,
    attachments.length ? h("div", { class: "thumbs" }, attachments.map((item, index) => thumb(item.path, { onClick: () => openLightbox(attachments, index) }))) : null,
    feedback.node ? linkButton(t("{node} on the canvas", { node: feedback.node }), hashes.project(at.project, feedback.node), { iconName: "open" }) : null
  ], `user|${round.round}`);
}

// The open round's candidates: a click picks, the note tool writes a note that goes with the answer, picked or not.
function candidateGrid(at, round, items) {
  const draft = conversation.draft;
  return h("div", { class: `candidates${entering(`grid|${round.round}`)}` }, round.candidates.map((candidate, index) => {
    const note = draft.notes[candidate.number] || "";
    return h("div", { class: `candidate selectable${draft.picked.has(candidate.number) ? " picked" : ""}`, "data-number": candidate.number }, [
      imageFrame(inProject(at.project, candidate.path), {
        number: candidate.number, check: true,
        onClick: () => togglePick(at, candidate.number),
        tools: [tool("memo", note || t("Note"), () => editNote(at, candidate), { on: Boolean(note) }), tool("zoom", t("Enlarge"), () => openLightbox(items, index))]
      }),
      candidate.description ? h("div", { class: "label", text: candidate.description }) : null,
      note ? field(t("My note"), note) : null
    ]);
  }));
}

async function editNote(at, candidate) {
  const draft = conversation.draft;
  const text = await ask({ title: t("Note on No. {number}", { number: pad(candidate.number) }), description: t("Write what works or what falls short. Images you do not pick can have notes too."), value: draft.notes[candidate.number] || "", placeholder: t("e.g. I like the soft shadow"), confirm: t("Save") });
  if (text == null) return;
  if (text) draft.notes[candidate.number] = text;
  else delete draft.notes[candidate.number];
  renderConversation(at, conversation.data);
  syncAnswer(at);
}

function togglePick(at, number) {
  const picked = conversation.draft.picked;
  if (picked.has(number)) picked.delete(number);
  else picked.add(number);
  document.querySelectorAll("#thread-inner [data-number]").forEach(node => node.classList.toggle("picked", picked.has(Number(node.dataset.number))));
  syncAnswer(at);
}

// The composer for the open round: the reply, the picked candidates with their numbers, and the attachments.
function renderThreadDock(at) {
  const open = openRound();
  if (!open) { conversation.composer = null; return fill($("thread-dock")); }
  const draft = conversation.draft;
  if (!conversation.composer || conversation.composer.key !== draft.key) {
    conversation.composer = composer({
      value: draft.comment,
      placeholder: conversation.data.kind === "ideation" ? t("e.g. An app icon, but I don't know what to draw yet") : t("e.g. A little softer and simpler"),
      sendTitle: `${t("Send")} (⌘↵)`,
      onInput: value => { draft.comment = value; syncAnswer(at); },
      onSend: event => answer(at, null, event.currentTarget),
      attach: uploadButton(t("Attach images"), files => attach(at, files), { variant: "ghost" })
    });
    conversation.composer.key = draft.key;
  }
  if ($("thread-dock").firstElementChild !== conversation.composer) fill($("thread-dock"), conversation.composer);
  syncAnswer(at);
}

function syncAnswer(at) {
  const open = openRound();
  const box = conversation.composer;
  if (!open || !box) return;
  const draft = conversation.draft;
  const items = candidateItems(at, open.candidates);
  box.setImages([
    ...open.candidates.filter(candidate => draft.picked.has(candidate.number)).map(candidate => ({
      key: `pick|${candidate.path}`,
      node: thumb(inProject(at.project, candidate.path), { picked: true, badge: pad(candidate.number), title: t("No. {number}", { number: pad(candidate.number) }), remove: () => togglePick(at, candidate.number), onClick: () => openLightbox(items, candidate.number - 1) })
    })),
    ...open.attachments.map(path => ({ key: `attachment|${path}`, node: thumb(inProject(at.project, path), { remove: () => detach(at, path) }) }))
  ]);
  box.send.disabled = !draft.comment.trim() && !draft.picked.size && !Object.keys(draft.notes).length && !open.attachments.length;
}

async function attach(at, files) {
  for (const file of files) {
    try { await api("/api/threads/attach", { project: at.project, thread: at.thread, name: file.name, data: await readFile(file) }); }
    catch (error) { toast(error.message, "error"); }
  }
  await load();
}

async function detach(at, path) {
  try { await api("/api/threads/detach", { project: at.project, thread: at.thread, path }); await load(); }
  catch { toast(t("Could not remove the image. Reload and try again."), "error"); }
}

async function answer(at, decision, trigger) {
  const open = openRound();
  if (!open) return;
  const draft = conversation.draft;
  if (trigger) trigger.disabled = true;
  try {
    const feedback = await api("/api/threads/answer", {
      project: at.project, thread: at.thread, round: open.round, decision,
      picked: [...draft.picked], notes: draft.notes, comment: draft.comment
    });
    if (feedback.node) toast(t("Added {node} to the canvas", { node: feedback.node }));
    await load();
  } catch (error) {
    toast(error.message, "error");
    if (trigger) trigger.disabled = false;
  }
}

// ---------- archive ----------

const archive = { signature: null, data: null, selecting: null };

page("archive", {
  enter() { Object.assign(archive, { signature: null, data: null, selecting: null }); document.title = `${t("Archive")} · Asset Studio`; },
  async load() {
    const next = await api("/api/archive");
    const signature = JSON.stringify(next);
    if (signature === archive.signature && $("archive-page")) return;
    archive.signature = signature;
    archive.data = next;
    renderArchive();
  }
});

// Every image of every node, newest node first, grouped by project.
function archiveShelves() {
  return archive.data.projects.map(shelf => {
    const nodes = [...shelf.nodes].reverse();
    return {
      project: shelf.project,
      tiles: nodes.flatMap(node => node.images.map(image => ({
        key: `${shelf.project}/${image.path}`, project: shelf.project, node, image,
        item: nodeImageItem(shelf.project, node, image)
      })))
    };
  }).filter(shelf => shelf.tiles.length);
}

// Choosing images only toggles classes and the bar, so the grid's images are never rebuilt (rebuilding them flickers).
function renderArchive() {
  const shelves = archiveShelves();
  const all = shelves.flatMap(shelf => shelf.tiles);
  const items = all.map(tile => tile.item);
  let index = 0;
  const sections = shelves.flatMap(shelf => [
    sectionTitle(h("a", { href: hashes.project(shelf.project), text: shelf.project }), tn("{count} image", "{count} images", shelf.tiles.length)),
    h("div", { class: "grid" }, shelf.tiles.map(tile => {
      const at = index++;
      return h("figure", { class: "tile", "data-key": tile.key }, [
        imageFrame(tile.item.path, {
          fit: "fill", check: true,
          onClick: () => archive.selecting ? toggleArchivePick(tile.key) : openLightbox(items, at),
          tools: [
            tool("reference", t("Add to references"), tile.item.add),
            tool("download", t("Download"), null, { href: fileUrl(tile.item.path), download: tile.item.name })
          ]
        }),
        h("figcaption", {}, [h("span", { text: tile.node.request || TOOL_NAMES[tile.node.tool] || KIND_NAMES[tile.node.kind] }), h("span", { text: tile.node.id })])
      ]);
    }))
  ]);
  fill($("view"), h("div", { class: "page", id: "archive-page" }, [
    h("div", { class: "page-head" }, [
      h("div", {}, [h("h1", { text: t("Archive") }), h("p", { text: t("Every image made in a project, kept with what it was made from.") })]),
      all.length ? button(archive.selecting ? t("Cancel selection") : t("Select"), { onClick: event => setSelecting(!archive.selecting, event.currentTarget) }) : null
    ]),
    all.length ? h("div", { id: "archive-grid", class: archive.selecting ? "selecting" : "" }, sections) : emptyState({ title: t("Nothing here yet"), text: t("Images made on a project's canvas show up here.") }),
    h("div", { id: "selection-bar" })
  ]));
  syncArchiveSelection();
}

function setSelecting(on, trigger) {
  archive.selecting = on ? new Set() : null;
  trigger.querySelector("span").textContent = on ? t("Cancel selection") : t("Select");
  $("archive-grid").classList.toggle("selecting", on);
  syncArchiveSelection();
}

function toggleArchivePick(key) {
  if (archive.selecting.has(key)) archive.selecting.delete(key);
  else archive.selecting.add(key);
  syncArchiveSelection();
}

function syncArchiveSelection() {
  const selecting = archive.selecting;
  document.querySelectorAll("#archive-grid .tile").forEach(tile => tile.classList.toggle("picked", Boolean(selecting && selecting.has(tile.dataset.key))));
  const bar = $("selection-bar");
  if (!selecting) return fill(bar);
  fill(bar, h("div", { class: "selection-bar" }, [
    h("span", { text: tn("{count} selected", "{count} selected", selecting.size) }),
    h("div", { class: "row" }, [
      button(t("Select all"), { onClick: () => { archiveShelves().forEach(shelf => shelf.tiles.forEach(tile => selecting.add(tile.key))); syncArchiveSelection(); } }),
      button(t("Download"), { variant: "primary", iconName: "download", disabled: !selecting.size, onClick: downloadSelected })
    ])
  ]));
}

async function downloadSelected() {
  const files = archiveShelves().flatMap(shelf => shelf.tiles).filter(tile => archive.selecting.has(tile.key)).map(tile => ({ path: tile.item.path, name: tile.item.name }));
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

// ---------- start ----------

// Page modules in later scripts register before the page starts.
document.addEventListener("DOMContentLoaded", () => {
  go();
  setInterval(() => { if (!loading && $("modal").hidden && $("menu").hidden && document.visibilityState === "visible") load(); }, 3000);
});
