"use strict";

// The project page: an infinite canvas of everything made in the project, the panel beside it (the brief, styles,
// threads, subjects), and the composer under it. Each node is a card; an edge runs from every parent image to the
// node built on it, and frames from canvas.json group nodes under a title. Nodes the user has not placed are laid out
// by lineage: roots by frame and time, each child to the right of its parent.

const CARD_WIDTH = 304;
const GAP_X = 72;
const GAP_Y = 32;
const FRAME_PAD = 24;
const FRAME_HEAD = 32;
const FRAME_GAP = 64;
const GRID_COLUMNS = 4;
const ZOOM_RANGE = [0.15, 2];

const board = {};

function resetBoard(project) {
  Object.assign(board, {
    project, data: null, canvasSignature: null, panelSignature: null, stylesSignature: null,
    view: null, cards: new Map(), sizes: new Map(), geometry: new Map(), positions: {}, saved: {},
    saveTimer: null, saving: false, viewTimer: null,
    selected: new Set(), draft: { text: "", attachments: [], style: null }, composer: null,
    focus: null, spaceHeld: false, frame: null, dragging: null
  });
}

page("project", {
  enter(at) {
    resetBoard(at.project);
    board.focus = at.params.node || null;
    window.addEventListener("keydown", boardKeys);
    window.addEventListener("keyup", boardKeys);
  },
  async load(at) {
    const next = await api(`/api/project?project=${encode(at.project)}`);
    if (!$("board")) buildBoard(at);
    board.data = next;
    document.title = `${next.name} · Asset Studio`;
    renderPanel();
    renderComposerStyles();
    // While the user's placement is being saved, the page's own positions are ahead of the server's.
    if (!board.saveTimer && !board.saving) board.saved = next.canvas.positions;
    const signature = signatureOf({ nodes: next.nodes, canvas: { ...next.canvas, positions: board.saved } });
    if (signature !== board.canvasSignature) {
      board.canvasSignature = signature;
      renderCanvas();
    }
  },
  leave() {
    window.removeEventListener("keydown", boardKeys);
    window.removeEventListener("keyup", boardKeys);
    if (board.saveTimer) { clearTimeout(board.saveTimer); savePositions(); }
    board.draft.attachments.forEach(item => URL.revokeObjectURL(item.url));
  }
});

// ---------- the page ----------

function buildBoard(at) {
  const viewport = h("div", { class: "canvas", id: "canvas-viewport" }, [
    h("div", { class: "canvas-world", id: "canvas-world" }, [
      h("div", { class: "canvas-frames", id: "canvas-frames" }),
      svgNode("svg", { class: "canvas-edges", id: "canvas-edges", width: 1, height: 1 }),
      h("div", { class: "canvas-nodes", id: "canvas-nodes" })
    ]),
    h("div", { class: "canvas-empty", id: "canvas-empty", hidden: true }, [emptyState({ title: t("Nothing on the canvas yet"), text: t("Write what to draw below, or upload images.") })]),
    h("div", { class: "canvas-tools top-left" }, [
      uploadButton(t("Upload images"), uploadNodes, { iconName: "upload", label: t("Upload"), variant: "ghost" })
    ]),
    h("div", { class: "canvas-tools top-right" }, [
      iconButton("minus", t("Zoom out"), () => zoomBy(1 / 1.25), { variant: "ghost", small: true }),
      h("button", { class: "button ghost small canvas-zoom", id: "canvas-zoom", type: "button", title: t("Zoom to 100%"), onclick: () => zoomBy(1 / board.view.zoom) }),
      iconButton("plus", t("Zoom in"), () => zoomBy(1.25), { variant: "ghost", small: true }),
      iconButton("fit", t("Fit to screen"), fitView, { variant: "ghost", small: true })
    ])
  ]);
  fill($("view"), h("div", { class: "workspace", id: "board" }, [
    h("aside", { class: "panel" }, [
      h("div", { class: "panel-head", id: "board-head" }),
      h("div", { class: "panel-body", id: "board-panel" }),
      panelResizer()
    ]),
    h("div", { class: "stage-column board-stage" }, [viewport, h("div", { class: "dock", id: "board-dock" })])
  ]));
  bindViewport(viewport);
  buildComposer();
  // Text that wraps differently once the font arrives changes a card's height; the layout follows.
  board.resizes = new ResizeObserver(() => scheduleLayout());
}

function svgNode(tag, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

// ---------- panel ----------

function renderPanel() {
  const data = board.data;
  const signature = signatureOf({ brief: data.brief, styles: data.styles, threads: data.threads, subjects: data.subjects });
  if (signature === board.panelSignature) return;
  board.panelSignature = signature;
  const project = data.name;
  fill($("board-head"), ...panelHead({
    back: [t("Projects"), hashes.home()],
    title: project,
    menu: [
      { label: t("Edit brief"), onClick: editBrief },
      { label: t("Rename"), onClick: () => renameProject(project) },
      { label: t("Delete"), danger: true, onClick: () => deleteProject(project) }
    ]
  }));

  const threads = [...data.threads].sort((a, b) => b.updated.localeCompare(a.updated));
  const subjectUpload = uploadButton(t("Add subjects"), addSubjects, { iconName: "plus", variant: "ghost" });
  subjectUpload.classList.add("small");
  fill($("board-panel"),
    sectionTitle(t("Brief"), tool("pencil", t("Edit brief"), editBrief, { quiet: true })),
    h("pre", { class: "document panel-brief", text: data.brief.trim() || t("No brief yet.") }),

    sectionTitle(t("Styles"), data.styles.length ? String(data.styles.length) : null),
    data.styles.length ? rowList(data.styles.map(style => listRow({
      title: style.name,
      detail: style.blocked && !style.guide ? blockedReason(style.blocked) : style.purpose || null,
      onClick: () => { location.hash = hashes.style(project, style.name); },
      aside: h("div", { class: "row" }, [
        style.guide ? pill(t("Guide"), { small: true }) : style.blocked ? pill(t("Cannot draw yet"), { small: true }) : null,
        style.proposals ? pill(tn("{count} proposal", "{count} proposals", style.proposals), { tone: "accent", small: true }) : null
      ])
    }))) : h("p", { class: "muted panel-hint", text: t("A style is how every image in it looks. Make one to start drawing.") }),
    h("div", { class: "row" }, [
      button(t("New style"), { small: true, iconName: "plus", onClick: () => newStyle(false) }),
      button(t("New guide"), { small: true, iconName: "plus", onClick: () => newStyle(true) })
    ]),

    sectionTitle(t("Threads"), drawableStyles().length ? button(t("New ideation"), { small: true, variant: "ghost", iconName: "plus", onClick: newIdeation }) : null),
    threads.length ? rowList(threads.map(thread => listRow({
      title: thread.title || THREAD_NAMES[thread.kind],
      detail: `${THREAD_NAMES[thread.kind]} · ${thread.style} · ${when(thread.updated)}`,
      onClick: () => { location.hash = hashes.thread(project, thread.id); },
      aside: thread.waiting ? pill(t("Your turn"), { tone: "accent", dot: "static", small: true })
        : agentAttached() ? pill(t("Working"), { tone: "accent", dot: "live", small: true }) : pill(t("Waiting for the agent"), { small: true })
    }))) : h("p", { class: "muted panel-hint", text: t("Conversations about a style or an image show up here.") }),

    sectionTitle(t("Subjects"), subjectUpload),
    data.subjects.length ? h("div", { class: "thumbs" }, data.subjects.map((subject, index, all) => thumb(inProject(project, subject.path), {
      title: (subject.annotation && subject.annotation.shows) || fileName(subject.path),
      onClick: () => openLightbox(all.map(each => ({ path: inProject(project, each.path), info: [[t("Shows"), each.annotation && each.annotation.shows]] })), index),
      remove: () => removeSubject(subject.path)
    }))) : h("p", { class: "muted panel-hint", text: t("Things the project draws again and again, such as a mascot or a logo's shape.") })
  );
}

const drawableStyles = () => board.data.styles.filter(style => !style.blocked);

async function editBrief() {
  const text = await ask({ title: t("Brief"), description: t("What the images are for, where they are seen, who sees them, and the decisions every style here keeps."), value: board.data.brief, confirm: t("Save"), wide: true });
  if (text == null) return;
  try { await api("/api/projects/brief", { project: board.project, text }); toast(t("Brief saved")); load(); }
  catch (error) { toast(error.message, "error"); }
}

function newStyle(guide) {
  return askName({
    title: guide ? t("New guide") : t("New style"),
    description: guide ? t("A guide lends rules such as brand colors to the styles that build on it, and draws nothing itself.") : t("Find the style together, in conversation."),
    confirm: t("Create"),
    taken: t("A style with this name already exists."),
    submit: async name => {
      const made = await api("/api/styles", { project: board.project, name, guide });
      location.hash = hashes.thread(board.project, made.thread);
    }
  });
}

async function newIdeation() {
  const styles = drawableStyles();
  const style = styles.length === 1 ? styles[0].name : await ask({
    title: t("New ideation"), description: t("Work out what to draw in conversation. Choose the style it will be drawn in."), confirm: t("Start"), input: null,
    choices: styles.map(each => ({ value: each.name, title: each.name, detail: each.purpose }))
  });
  if (!style) return;
  try {
    const made = await api("/api/threads", { project: board.project, style, kind: "ideation" });
    location.hash = hashes.thread(board.project, made.thread);
  } catch (error) { toast(error.message, "error"); }
}

async function addSubjects(files) {
  for (const file of files) {
    try { await api("/api/subjects/add", { project: board.project, name: file.name, data: await readFile(file) }); }
    catch (error) { toast(error.message, "error"); }
  }
  load();
}

async function removeSubject(path) {
  try { await api("/api/subjects/remove", { project: board.project, file: fileName(path) }); load(); }
  catch (error) { toast(error.message, "error"); }
}

// ---------- node cards ----------

const reviewsHidden = node => node.reviewed && node.images.every(image => image.review == null);
const nodeOfPath = path => path.split("/")[1];

function statusPill(node) {
  if (node.status === "queued") return agentAttached() ? pill(t("Queued"), { tone: "accent", dot: "static", small: true }) : pill(t("Queued · no agent"), { dot: "static", small: true });
  if (node.status === "drawing") return pill(t("Drawing"), { tone: "accent", dot: "live", small: true });
  if (node.status === "running") return pill(t("Running"), { tone: "accent", dot: "live", small: true });
  if (node.status === "failed") return pill(t("Failed"), { tone: "danger", small: true });
  return pill(t("Done"), { tone: "success", small: true });
}

function pendingFrame(node) {
  const idle = node.status === "queued" && !agentAttached();
  const text = node.status === "running" ? t("Removing the background")
    : node.status === "drawing" ? t("Drawing")
    : idle ? t("No agent is attached, so this waits. Start one with open-package watch.") : t("Waiting for the agent to start");
  return h("div", { class: `pending-frame${idle ? " idle" : ""}` }, [idle ? null : h("span", { class: "spinner" }), h("span", { text })]);
}

function nodeCard(node) {
  const project = board.project;
  const items = node.images.map(image => nodeImageItem(project, node, image, board.data.styles));
  const note = node.note || (node.images.length === 1 && node.images[0].description) || "";
  const attachments = node.kind === "upload" ? [] : node.attachments;
  const facts = [
    node.tool ? TOOL_NAMES[node.tool] : node.model ? shortModel(node.model) : null,
    node.revision ? t("Revision {revision}", { revision: node.revision }) : null,
    node.cost ? money(node.cost) : null
  ].filter(Boolean).join(" · ");
  const card = h("article", { class: "canvas-node", "data-id": node.id }, [
    h("header", { class: "node-head" }, [
      h("span", { class: "node-id", text: node.id }),
      h("span", { class: "node-kind", text: node.tool ? TOOL_NAMES[node.tool] : KIND_NAMES[node.kind] }),
      node.style ? h("a", { class: "node-style", href: hashes.style(project, node.style), text: node.style }) : null,
      h("span", { class: "grow" }),
      statusPill(node),
      tool("more", t("More"), event => openNodeMenu(node, event), { quiet: true })
    ]),
    node.request ? h("p", { class: "node-request", text: node.request, title: node.request }) : null,
    attachments.length ? h("div", { class: "thumbs" }, attachments.map((path, index, all) => thumb(inProject(project, path), {
      small: true, title: t("Attachment"), onClick: () => openLightbox(all.map(each => ({ path: inProject(project, each), info: [] })), index)
    }))) : null,
    node.images.length ? h("div", { class: `node-images${node.images.length > 1 ? " several" : ""}` }, node.images.map((image, index) => h("div", { class: "node-image", "data-path": image.path }, [
      imageFrame(inProject(project, image.path), {
        fit: "fill",
        tools: [tool("zoom", t("Enlarge"), () => openLightbox(items, index)), tool("more", t("More"), event => openImageMenu(node, image, event))]
      }),
      image.review ? reviewLine(image.review) : null
    ]))) : ["queued", "drawing", "running"].includes(node.status) ? pendingFrame(node) : null,
    node.status === "failed" ? h("p", { class: "node-error", text: node.error || t("Nothing came out of this request.") }) : null,
    note ? h("p", { class: "node-note", text: note, title: t("Click to read all"), onclick: event => { event.currentTarget.classList.toggle("open"); } }) : null,
    reviewsHidden(node) ? button(t("Show review"), { small: true, variant: "ghost", iconName: "eye", class: "node-reveal", onClick: () => revealReviews(node) }) : null,
    h("footer", { class: "node-foot" }, [
      h("span", { text: facts }),
      node.thread ? h("a", { href: hashes.thread(project, node.thread), text: t("From a thread") }) : null,
      h("span", { text: when(node.time) })
    ])
  ]);
  card.addEventListener("contextmenu", event => {
    event.preventDefault();
    const frame = event.target.closest(".node-image");
    if (frame) openImageMenu(node, node.images.find(image => image.path === frame.dataset.path), event);
    else openNodeMenu(node, event);
  });
  return card;
}

function openNodeMenu(node, event) {
  openMenu({ x: event.clientX, y: event.clientY }, [
    reviewsHidden(node) ? { label: t("Show review"), onClick: () => revealReviews(node) } : null,
    node.thread ? { label: t("Open the thread"), onClick: () => { location.hash = hashes.thread(board.project, node.thread); } } : null,
    { label: t("Delete"), danger: true, onClick: () => deleteNode(node) }
  ]);
}

function openImageMenu(node, image, event) {
  const item = nodeImageItem(board.project, node, image, board.data.styles);
  openMenu({ x: event.clientX, y: event.clientY }, [
    { label: t("Enlarge"), onClick: () => openLightbox([item], 0) },
    { label: t("Remove background"), detail: t("Runs on this Mac, free"), onClick: () => cutout(image.path) },
    { label: t("Add to references"), onClick: item.add },
    { label: t("Download"), onClick: () => h("a", { href: fileUrl(item.path), download: item.name }).click() }
  ]);
}

async function revealReviews(node) {
  try { await api("/api/canvas", { project: board.project, revealed: [...board.data.canvas.revealed, node.id] }); load(); }
  catch (error) { toast(error.message, "error"); }
}

async function deleteNode(node) {
  if (!await confirmDelete(t("Delete {name}", { name: node.id }), t("The request and its images are deleted. Nodes built on it stay."))) return;
  try {
    await api("/api/nodes/delete", { project: board.project, node: node.id });
    node.images.forEach(image => board.selected.delete(image.path));
    syncSelection();
    load();
  } catch (error) { toast(error.message, "error"); }
}

async function cutout(path) {
  try {
    const made = await api("/api/nodes", { project: board.project, kind: "tool", tool: "cutout", parents: [path] });
    board.focus = made.node;
    load();
  } catch (error) { toast(error.message, "error"); }
}

async function uploadNodes(files) {
  let last = null;
  for (const file of files) {
    try { last = (await api("/api/nodes", { project: board.project, kind: "upload", attachments: [{ name: file.name, data: await readFile(file) }] })).node; }
    catch (error) { toast(error.message, "error"); }
  }
  if (last) board.focus = last;
  load();
}

// ---------- canvas ----------

// Cards are rebuilt only when what they show changed, so images stay put across polls.
function renderCanvas() {
  const nodes = board.data.nodes;
  const layer = $("canvas-nodes");
  const known = new Set(nodes.map(node => node.id));
  for (const [id, card] of board.cards) {
    if (known.has(id)) continue;
    board.resizes.unobserve(card.element);
    card.element.remove();
    board.cards.delete(id);
  }
  for (const node of nodes) {
    const key = JSON.stringify([node, agentAttached()]);
    const card = board.cards.get(node.id);
    if (card && card.key === key) continue;
    const element = nodeCard(node);
    if (card) {
      element.style.left = card.element.style.left;
      element.style.top = card.element.style.top;
      board.resizes.unobserve(card.element);
      card.element.replaceWith(element);
      if (card.element.classList.contains("dragging")) element.classList.add("dragging");
    } else {
      if (board.view) element.classList.add("enter");
      layer.append(element);
    }
    board.resizes.observe(element);
    board.cards.set(node.id, { element, key });
  }
  $("canvas-empty").hidden = nodes.length > 0;
  [...board.selected].forEach(path => { if (!known.has(nodeOfPath(path)) || !nodes.some(node => node.images.some(image => image.path === path))) board.selected.delete(path); });
  layoutCanvas();
  syncSelection();
}

function scheduleLayout() {
  if (board.frame) return;
  board.frame = requestAnimationFrame(() => { board.frame = null; if ($("board")) layoutCanvas(); });
}

// Measures the cards, places them, and draws the frames and edges.
function layoutCanvas() {
  for (const [id, card] of board.cards) board.sizes.set(id, { width: card.element.offsetWidth || CARD_WIDTH, height: card.element.offsetHeight });
  const held = board.dragging && board.positions[board.dragging];
  board.positions = placeNodes(board.data.nodes, board.data.canvas.frames, board.saved);
  if (held && board.positions[board.dragging]) board.positions[board.dragging] = held;
  for (const [id, card] of board.cards) {
    const [x, y] = board.positions[id];
    card.element.style.left = `${x}px`;
    card.element.style.top = `${y}px`;
  }
  measureImages();
  drawFrames();
  drawEdges();
  if (!board.view) startView();
  if (board.focus && board.cards.has(board.focus)) { focusNode(board.focus); board.focus = null; }
}

const sizeOf = id => board.sizes.get(id) || { width: CARD_WIDTH, height: 240 };

// The node a node is drawn beside: its first parent still on the canvas.
function lineageParent(node, known) {
  return node.parents.map(nodeOfPath).find(id => known.has(id) && id !== node.id) || null;
}

function placeNodes(nodes, frames, saved) {
  const known = new Set(nodes.map(node => node.id));
  if (!nodes.some(node => saved[node.id])) return lineageLayout(nodes, frames, known);
  // Placed nodes stay; a new one goes beside its parent, or under everything, then down past any card it would cover.
  const positions = {};
  for (const node of nodes) if (saved[node.id]) positions[node.id] = [...saved[node.id]];
  const rects = () => Object.entries(positions).map(([id, [x, y]]) => ({ x, y, right: x + sizeOf(id).width, bottom: y + sizeOf(id).height }));
  for (const node of nodes) {
    if (positions[node.id]) continue;
    const parent = lineageParent(node, known);
    const placed = rects();
    let x, y;
    if (parent && positions[parent]) [x, y] = [positions[parent][0] + sizeOf(parent).width + GAP_X, positions[parent][1]];
    else [x, y] = [Math.min(0, ...placed.map(rect => rect.x)), Math.max(0, ...placed.map(rect => rect.bottom + FRAME_GAP))];
    const { width, height } = sizeOf(node.id);
    for (let blocking; (blocking = placed.find(rect => x < rect.right + GAP_Y / 2 && x + width > rect.x - GAP_Y / 2 && y < rect.bottom + GAP_Y / 2 && y + height > rect.y - GAP_Y / 2));) y = blocking.bottom + GAP_Y;
    positions[node.id] = [x, y];
  }
  return positions;
}

// Frames one under another, in canvas.json order, then the nodes in no frame. In each, the roots that have
// descendants come first, each tree growing to the right; roots with none fill rows under them.
function lineageLayout(nodes, frames, known) {
  const positions = {};
  const byTime = (a, b) => a.time.localeCompare(b.time) || Number(a.id.slice(1)) - Number(b.id.slice(1));
  const children = new Map();
  const roots = [];
  for (const node of [...nodes].sort(byTime)) {
    const parent = lineageParent(node, known);
    if (parent) children.set(parent, [...(children.get(parent) || []), node]);
    else roots.push(node);
  }
  const frameOf = id => frames.findIndex(frame => frame.nodes.includes(id));
  const groups = [...frames.map((frame, index) => ({ framed: true, roots: roots.filter(node => frameOf(node.id) === index) })), { framed: false, roots: roots.filter(node => frameOf(node.id) < 0) }];
  const place = (node, depth, y) => {
    positions[node.id] = [depth * (CARD_WIDTH + GAP_X), y];
    let bottom = y + sizeOf(node.id).height + GAP_Y;
    let next = y;
    for (const child of children.get(node.id) || []) next = place(child, depth + 1, next);
    return Math.max(bottom, next);
  };
  let y = 0;
  for (const group of groups) {
    if (!group.roots.length) continue;
    if (group.framed) y += FRAME_HEAD + FRAME_PAD;
    for (const root of group.roots.filter(node => children.has(node.id))) y = place(root, 0, y);
    const singles = group.roots.filter(node => !children.has(node.id));
    for (let start = 0; start < singles.length; start += GRID_COLUMNS) {
      const row = singles.slice(start, start + GRID_COLUMNS);
      row.forEach((node, column) => { positions[node.id] = [column * (CARD_WIDTH + GAP_Y), y]; });
      y += Math.max(...row.map(node => sizeOf(node.id).height)) + GAP_Y;
    }
    y += FRAME_GAP + (group.framed ? FRAME_PAD : 0);
  }
  return positions;
}

// Where each image sits inside its card, for the edges that leave from it.
function measureImages() {
  board.geometry = new Map();
  const zoom = board.view ? board.view.zoom : 1;
  for (const [id, card] of board.cards) {
    const box = card.element.getBoundingClientRect();
    card.element.querySelectorAll(".node-image").forEach(image => {
      const frame = image.querySelector(".frame").getBoundingClientRect();
      board.geometry.set(image.dataset.path, { id, x: (frame.left - box.left) / zoom, y: (frame.top - box.top) / zoom, width: frame.width / zoom, height: frame.height / zoom });
    });
  }
}

function rectOf(id) {
  const [x, y] = board.positions[id];
  const { width, height } = sizeOf(id);
  return { x, y, right: x + width, bottom: y + height };
}

function drawFrames() {
  const frames = board.data.canvas.frames.map(frame => {
    const members = frame.nodes.filter(id => board.positions[id]).map(rectOf);
    if (!members.length) return null;
    const x = Math.min(...members.map(rect => rect.x)) - FRAME_PAD;
    const y = Math.min(...members.map(rect => rect.y)) - FRAME_PAD - FRAME_HEAD;
    const width = Math.max(...members.map(rect => rect.right)) + FRAME_PAD - x;
    const height = Math.max(...members.map(rect => rect.bottom)) + FRAME_PAD - y;
    return h("div", { class: "canvas-frame", style: `left: ${x}px; top: ${y}px; width: ${width}px; height: ${height}px` }, [h("span", { class: "canvas-frame-title", text: frame.title, title: frame.title })]);
  });
  fill($("canvas-frames"), frames);
}

// An edge leaves the right side of the parent image and enters the child card beside its head.
function drawEdges() {
  const paths = [];
  for (const node of board.data.nodes) {
    if (!board.positions[node.id]) continue;
    const target = rectOf(node.id);
    for (const parent of node.parents) {
      const id = nodeOfPath(parent);
      if (!board.positions[id] || id === node.id) continue;
      const source = rectOf(id);
      const image = board.geometry.get(parent);
      const [sx, sy] = image ? [source.x + image.x + image.width, source.y + image.y + image.height / 2] : [source.right, source.y + 24];
      const [tx, ty] = [target.x, target.y + 24];
      const bend = Math.max(48, Math.abs(tx - sx) / 2);
      const selected = board.selected.has(parent);
      paths.push(svgNode("path", { class: `edge${selected ? " on" : ""}`, d: `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}` }));
      paths.push(svgNode("circle", { class: `edge-end${selected ? " on" : ""}`, cx: sx, cy: sy, r: 4 }));
    }
  }
  $("canvas-edges").replaceChildren(...paths);
}

// ---------- viewport: pan and zoom ----------

const viewKey = () => `canvas-view:${board.project}`;

function startView() {
  try { const saved = JSON.parse(localStorage.getItem(viewKey())); if (saved && saved.zoom) { board.view = saved; return applyView(); } } catch {}
  board.view = { x: 0, y: 0, zoom: 1 };
  fitView();
  // A first look stays readable: a canvas too tall to fit opens at its top instead of shrinking to a thumbnail.
  if (board.view.zoom < 0.5) {
    const rects = Object.keys(board.positions).map(rectOf);
    const left = Math.min(...rects.map(rect => rect.x)) - FRAME_PAD;
    const top = Math.min(...rects.map(rect => rect.y)) - FRAME_PAD - FRAME_HEAD;
    board.view = { x: 48 - left * 0.5, y: 24 - top * 0.5, zoom: 0.5 };
    applyView();
  }
}

function applyView() {
  const { x, y, zoom } = board.view;
  $("canvas-world").style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
  $("canvas-viewport").style.setProperty("--zoom", zoom);
  $("canvas-viewport").style.setProperty("--pan", `${x}px ${y}px`);
  $("canvas-zoom").textContent = `${Math.round(zoom * 100)}%`;
  clearTimeout(board.viewTimer);
  board.viewTimer = setTimeout(() => { try { localStorage.setItem(viewKey(), JSON.stringify(board.view)); } catch {} }, 300);
}

const clampZoom = zoom => Math.min(ZOOM_RANGE[1], Math.max(ZOOM_RANGE[0], zoom));

// Zooms about a point of the viewport, the center when none is given.
function zoomBy(factor, at = null) {
  const viewport = $("canvas-viewport");
  const [cx, cy] = at || [viewport.clientWidth / 2, visibleHeight() / 2];
  const zoom = clampZoom(board.view.zoom * factor);
  const scale = zoom / board.view.zoom;
  board.view = { x: cx - (cx - board.view.x) * scale, y: cy - (cy - board.view.y) * scale, zoom };
  applyView();
}

// The part of the viewport the composer does not cover.
const visibleHeight = () => $("canvas-viewport").clientHeight - $("board-dock").offsetHeight;

function fitView() {
  const ids = Object.keys(board.positions);
  if (!ids.length) { board.view = { x: 48, y: 48, zoom: 1 }; return applyView(); }
  const rects = [...ids.map(rectOf), ...[...$("canvas-frames").children].map(frame => ({ x: frame.offsetLeft, y: frame.offsetTop, right: frame.offsetLeft + frame.offsetWidth, bottom: frame.offsetTop + frame.offsetHeight }))];
  const left = Math.min(...rects.map(rect => rect.x));
  const top = Math.min(...rects.map(rect => rect.y));
  const width = Math.max(...rects.map(rect => rect.right)) - left;
  const height = Math.max(...rects.map(rect => rect.bottom)) - top;
  const margin = 48;
  const availableWidth = $("canvas-viewport").clientWidth - margin * 2;
  const availableHeight = visibleHeight() - margin * 2;
  const zoom = clampZoom(Math.min(1, availableWidth / width, availableHeight / height));
  board.view = { x: margin + (availableWidth - width * zoom) / 2 - left * zoom, y: margin + Math.max(0, (availableHeight - height * zoom) / 2) - top * zoom, zoom };
  applyView();
}

// Brings a node into view and marks it for a moment.
function focusNode(id) {
  const rect = rectOf(id);
  const zoom = Math.max(board.view.zoom, 0.6);
  const width = $("canvas-viewport").clientWidth;
  const height = visibleHeight();
  const top = (rect.bottom - rect.y) * zoom < height - 96 ? (height - (rect.bottom - rect.y) * zoom) / 2 : 48;
  board.view = { x: (width - (rect.right - rect.x) * zoom) / 2 - rect.x * zoom, y: top - rect.y * zoom, zoom };
  applyView();
  const card = board.cards.get(id).element;
  card.classList.remove("flash");
  void card.offsetWidth;
  card.classList.add("flash");
}

function boardKeys(event) {
  const typing = event.target.matches("input, textarea");
  if (event.code === "Space" && !typing) {
    board.spaceHeld = event.type === "keydown";
    $("canvas-viewport").classList.toggle("panning", board.spaceHeld);
    if (board.spaceHeld) event.preventDefault();
  }
  if (event.type === "keydown" && event.key === "Escape" && !typing && board.selected.size && $("modal").hidden && $("lightbox").hidden && $("menu").hidden) {
    board.selected.clear();
    syncSelection();
  }
}

// One pointer gesture: dragging a card moves it, dragging the background (or anything with Space held) pans,
// and a press that does not move picks an image (Shift adds to the picks) or, on the background, clears them.
function bindViewport(viewport) {
  viewport.addEventListener("wheel", event => {
    if (event.target.closest(".canvas-tools")) return;
    event.preventDefault();
    const box = viewport.getBoundingClientRect();
    const step = event.deltaMode === 1 ? 16 : 1;
    if (event.ctrlKey || event.metaKey) return zoomBy(Math.exp(-Math.max(-60, Math.min(60, event.deltaY * step)) * 0.008), [event.clientX - box.left, event.clientY - box.top]);
    board.view.x -= event.deltaX * step;
    board.view.y -= event.deltaY * step;
    applyView();
  }, { passive: false });

  viewport.addEventListener("pointerdown", event => {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.target.closest("button, a, label, input, textarea, .canvas-tools, .node-note")) return;
    const card = event.target.closest(".canvas-node");
    const dragging = card && event.button === 0 && !board.spaceHeld ? card.dataset.id : null;
    const start = { x: event.clientX, y: event.clientY, view: { ...board.view }, at: dragging ? [...board.positions[dragging]] : null };
    let moved = false;
    viewport.setPointerCapture(event.pointerId);
    const move = moving => {
      const dx = moving.clientX - start.x;
      const dy = moving.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!moved) { moved = true; board.dragging = dragging; (dragging ? card : viewport).classList.add("dragging"); }
      if (dragging) {
        board.positions[dragging] = [start.at[0] + dx / board.view.zoom, start.at[1] + dy / board.view.zoom];
        // A poll may rebuild the card while it is held; the one on the canvas now is moved.
        const held = board.cards.get(dragging);
        if (!held) return;
        const element = held.element;
        element.style.left = `${board.positions[dragging][0]}px`;
        element.style.top = `${board.positions[dragging][1]}px`;
        drawFrames();
        drawEdges();
      } else {
        board.view = { ...start.view, x: start.view.x + dx, y: start.view.y + dy };
        applyView();
      }
    };
    const up = ended => {
      viewport.removeEventListener("pointermove", move);
      viewport.removeEventListener("pointerup", up);
      viewport.removeEventListener("pointercancel", up);
      const released = dragging ? board.cards.get(dragging) : { element: viewport };
      if (released) released.element.classList.remove("dragging");
      board.dragging = null;
      if (moved && dragging) return placeByHand();
      if (moved || ended.type === "pointercancel") return;
      const image = event.target.closest(".node-image");
      if (image) pickImage(image.dataset.path, event.shiftKey);
      else if (!card) { board.selected.clear(); syncSelection(); }
    };
    viewport.addEventListener("pointermove", move);
    viewport.addEventListener("pointerup", up);
    viewport.addEventListener("pointercancel", up);
  });

  viewport.addEventListener("dblclick", event => {
    const image = event.target.closest(".node-image");
    if (!image) return;
    const node = board.data.nodes.find(each => each.id === image.closest(".canvas-node").dataset.id);
    const index = node.images.findIndex(each => each.path === image.dataset.path);
    openLightbox(node.images.map(each => nodeImageItem(board.project, node, each, board.data.styles)), index);
  });

  // Images dropped on the composer go with the next request; dropped anywhere else they become upload nodes.
  const column = viewport.parentNode;
  column.addEventListener("dragover", event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); column.classList.add("dropping"); } });
  column.addEventListener("dragleave", event => { if (!column.contains(event.relatedTarget)) column.classList.remove("dropping"); });
  column.addEventListener("drop", event => {
    event.preventDefault();
    column.classList.remove("dropping");
    const files = [...event.dataTransfer.files].filter(file => /^image\/(png|jpeg|webp)$/.test(file.type));
    if (!files.length) return;
    if (event.target.closest(".dock")) addAttachments(files);
    else uploadNodes(files);
  });
}

// Once the user places a card by hand, every card keeps the place it has now, so the layout no longer moves under them.
function placeByHand() {
  board.saved = Object.fromEntries(Object.entries(board.positions).map(([id, [x, y]]) => [id, [Math.round(x), Math.round(y)]]));
  clearTimeout(board.saveTimer);
  board.saveTimer = setTimeout(savePositions, 500);
}

async function savePositions() {
  board.saveTimer = null;
  board.saving = true;
  try { await api("/api/canvas", { project: board.project, positions: board.saved }); }
  catch (error) { toast(error.message, "error"); }
  finally { board.saving = false; }
}

// ---------- picking images ----------

function pickImage(path, adding) {
  if (adding) {
    if (board.selected.has(path)) board.selected.delete(path);
    else board.selected.add(path);
  } else {
    const only = board.selected.size === 1 && board.selected.has(path);
    board.selected.clear();
    if (!only) board.selected.add(path);
  }
  syncSelection();
}

function syncSelection() {
  document.querySelectorAll("#canvas-nodes .node-image").forEach(image => image.classList.toggle("picked", board.selected.has(image.dataset.path)));
  if (board.data) drawEdges();
  syncComposer();
}

// ---------- composer ----------

const styleKey = () => `canvas-style:${board.project}`;

function buildComposer() {
  board.styleSlot = h("span", { class: "composer-style" });
  board.noteSlot = h("span", { class: "composer-note" });
  try { board.draft.style = localStorage.getItem(styleKey()); } catch {}
  board.composer = composer({
    placeholder: t("Describe an image to draw"),
    sendTitle: `${t("Draw")} (⌘↵)`,
    onInput: value => { board.draft.text = value; syncComposer(); },
    onSend: sendRequest,
    attach: uploadButton(t("Attach images"), addAttachments, { variant: "ghost" }),
    tools: [board.styleSlot, board.noteSlot]
  });
  fill($("board-dock"), board.composer);
}

function renderComposerStyles() {
  const styles = drawableStyles();
  const signature = JSON.stringify(styles.map(style => style.name));
  if (signature === board.stylesSignature) return;
  board.stylesSignature = signature;
  if (!styles.some(style => style.name === board.draft.style)) board.draft.style = styles.length ? styles[0].name : null;
  fill(board.styleSlot, styles.length ? dropdown({
    value: board.draft.style, title: t("Style to draw with"),
    options: styles.map(style => ({ value: style.name, label: style.name, detail: style.purpose })),
    onChange: value => {
      board.draft.style = value;
      try { localStorage.setItem(styleKey(), value); } catch {}
      board.stylesSignature = null;
      renderComposerStyles();
    }
  }) : h("span", { class: "composer-note", text: t("No style can draw yet") }));
  syncComposer();
}

// The picked images go with the request as its parents; the attachments go as images the request shows.
function syncComposer() {
  if (!board.composer || !board.data) return;
  const project = board.project;
  const picked = [...board.selected];
  board.composer.setImages([
    ...picked.map(path => ({ key: `pick|${path}`, node: thumb(inProject(project, path), { picked: true, badge: nodeOfPath(path), title: t("Builds on this image"), remove: () => { board.selected.delete(path); syncSelection(); } }) })),
    ...board.draft.attachments.map(item => ({ key: `attachment|${item.key}`, node: thumb(item.name, { src: item.url, title: item.name, remove: () => removeAttachment(item) }) }))
  ]);
  board.noteSlot.textContent = !picked.length ? t("New image") : picked.length === 1 ? t("Refines {node}", { node: nodeOfPath(picked[0]) }) : tn("Builds on {count} image", "Builds on {count} images", picked.length);
  board.composer.send.disabled = !board.draft.style || !board.draft.text.trim();
}

let attachmentCount = 0;

async function addAttachments(files) {
  for (const file of files) board.draft.attachments.push({ key: String(++attachmentCount), name: file.name, data: await readFile(file), url: URL.createObjectURL(file) });
  syncComposer();
}

function removeAttachment(item) {
  URL.revokeObjectURL(item.url);
  board.draft.attachments = board.draft.attachments.filter(each => each !== item);
  syncComposer();
}

async function sendRequest() {
  const draft = board.draft;
  if (!draft.style || !draft.text.trim()) return;
  board.composer.send.disabled = true;
  try {
    const made = await api("/api/nodes", {
      project: board.project, kind: "generation", style: draft.style, request: draft.text,
      parents: [...board.selected], attachments: draft.attachments.map(({ name, data }) => ({ name, data }))
    });
    draft.attachments.forEach(item => URL.revokeObjectURL(item.url));
    draft.attachments = [];
    board.composer.input.value = "";
    board.composer.input.dispatchEvent(new Event("input"));
    board.selected.clear();
    board.focus = made.node;
    syncSelection();
    load();
  } catch (error) {
    toast(error.message, "error");
    syncComposer();
  }
}
