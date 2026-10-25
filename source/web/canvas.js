"use strict";

// The project page: an infinite canvas of everything made in the project, the panel beside it (the brief, styles,
// threads), the composer under it, and the inspector over its right side with everything about the selected nodes.
// A card shows what was asked and what came out; an edge runs from a parent's card to the node built on it, and the
// child names the image it builds on. Frames from canvas.json group nodes under a title and move them together.
// Nodes the user has not placed are laid out by lineage: roots by frame and time, each child to the right of its parent.

const CARD_WIDTH = 304;
const GAP_X = 72;
const GAP_Y = 32;
const FRAME_PAD = 24;
const FRAME_HEAD = 32;
const FRAME_GAP = 64;
const GRID_COLUMNS = 4;
const ZOOM_RANGE = [0.15, 2];
// The least zoom a canvas opens at, and the room left around fitted content (the top clears the canvas tools).
const FIRST_ZOOM = 0.5;
const FIT_MARGIN = { side: 48, top: 72, bottom: 24 };

const board = {};

// picked: image paths the next request builds on. selected: node ids the inspector shows and a drag moves together.
function resetBoard(project) {
  Object.assign(board, {
    project, data: null, canvasSignature: null, panelSignature: null, stylesSignature: null, inspectorSignature: null,
    view: null, cards: new Map(), sizes: new Map(), geometry: new Map(), chips: new Map(), positions: {}, saved: {},
    saveTimer: null, saving: false, viewTimer: null,
    picked: new Set(), selected: new Set(), reviews: new Set(),
    draft: { text: "", attachments: [], style: null }, composer: null, sending: false,
    focus: null, spaceHeld: false, frame: null, dragging: null
  });
}

page("project", {
  enter(at) {
    resetBoard(at.project);
    board.focus = at.params.node || null;
    window.addEventListener("keydown", boardKeys);
    window.addEventListener("keyup", boardKeys);
    window.addEventListener("blur", boardKeys);
  },
  async load(at) {
    const next = await api(`/api/project?project=${encode(at.project)}`);
    if (at !== route) return;
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
    renderInspector();
  },
  leave() {
    window.removeEventListener("keydown", boardKeys);
    window.removeEventListener("keyup", boardKeys);
    window.removeEventListener("blur", boardKeys);
    if (board.saveTimer) { clearTimeout(board.saveTimer); savePositions(); }
    board.draft.attachments.forEach(item => URL.revokeObjectURL(item.url));
  }
});

// ---------- the page ----------

// What was drawn into an earlier #view is gone, so everything compared against it starts over.
function buildBoard(at) {
  if (board.resizes) board.resizes.disconnect();
  Object.assign(board, { canvasSignature: null, panelSignature: null, stylesSignature: null, inspectorSignature: null, cards: new Map(), view: null });
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
  const dock = h("div", { class: "dock", id: "board-dock" });
  const stage = h("div", { class: "stage-column board-stage" }, [viewport, h("aside", { class: "inspector", id: "board-inspector", hidden: true }), dock]);
  fill($("view"), h("div", { class: "workspace", id: "board" }, [
    h("aside", { class: "panel" }, [
      h("div", { class: "panel-head", id: "board-head" }),
      h("div", { class: "panel-body", id: "board-panel" }),
      panelResizer()
    ]),
    stage
  ]));
  bindViewport(viewport);
  buildComposer();
  // Text that wraps differently once the font arrives changes a card's height; the layout follows.
  board.resizes = new ResizeObserver(() => scheduleLayout());
  new ResizeObserver(() => stage.style.setProperty("--dock", `${dock.offsetHeight}px`)).observe(dock);
}

function svgNode(tag, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

// ---------- panel ----------

function renderPanel() {
  const data = board.data;
  const signature = signatureOf({ brief: data.brief, styles: data.styles, threads: data.threads });
  if (signature === board.panelSignature) return;
  board.panelSignature = signature;
  const project = data.name;
  fill($("board-head"), ...panelHead({
    back: [t("Projects"), hashes.home()],
    title: project,
    menu: [
      { label: t("Rename"), onClick: () => renameProject(project) },
      { label: t("Delete"), danger: true, onClick: () => deleteProject(project) }
    ]
  }));

  const brief = data.brief.trim();
  const threads = [...data.threads].sort((a, b) => b.updated.localeCompare(a.updated));
  fill($("board-panel"),
    sectionTitle(t("Brief"), brief ? button(t("Change in conversation"), { small: true, variant: "ghost", iconName: "memo", onClick: talkAboutBrief }) : null),
    brief ? h("div", { class: "panel-brief" }, [markdownView(brief)]) : h("div", { class: "panel-empty" }, [
      h("p", { class: "muted panel-hint", text: t("No brief yet. Tell the agent what the project is for, and it writes the brief every style and image here reads.") }),
      button(t("Write in conversation"), { small: true, iconName: "memo", onClick: talkAboutBrief })
    ]),

    sectionTitle(t("Styles"), data.styles.length ? String(data.styles.length) : null),
    data.styles.length ? rowList(data.styles.map(style => listRow({
      title: style.name,
      detail: style.guide ? style.purpose || t("Lends its rules to the styles that build on it.") : style.missing ? blockedReason(style) : style.purpose || null,
      onClick: () => { location.hash = hashes.style(project, style.name); },
      aside: h("div", { class: "row" }, [
        style.guide ? pill(t("Guide"), { small: true }) : style.missing ? pill(t("Cannot draw yet"), { small: true }) : null,
        style.proposals ? pill(tn("{count} proposal", "{count} proposals", style.proposals), { tone: "accent", small: true }) : null
      ])
    }))) : h("p", { class: "muted panel-hint", text: t("A style is how every image in it looks. Make one to start drawing.") }),
    h("div", { class: "row" }, [button(t("New style"), { small: true, iconName: "plus", onClick: newStyle })]),

    sectionTitle(t("Threads"), drawableStyles().length ? button(t("New ideation"), { small: true, variant: "ghost", iconName: "plus", onClick: newIdeation }) : null),
    threads.length ? rowList(threads.map(thread => listRow({
      title: thread.title || THREAD_NAMES[thread.kind],
      detail: [THREAD_NAMES[thread.kind], thread.style, when(thread.updated)].filter(Boolean).join(" · "),
      onClick: () => { location.hash = hashes.thread(project, thread.id); },
      aside: thread.waiting ? pill(t("Your turn"), { tone: "accent", dot: "static", small: true })
        : agentAttached() ? pill(t("Working"), { tone: "accent", dot: "live", small: true }) : pill(t("Waiting for the agent"), { small: true })
    }))) : h("p", { class: "muted panel-hint", text: t("Conversations about the project, a style, or an image show up here.") })
  );
}

const drawableStyles = () => board.data.styles.filter(style => style.missing == null);

async function talkAboutBrief() {
  try {
    const made = await api("/api/threads", { project: board.project, kind: "project" });
    location.hash = hashes.thread(board.project, made.thread);
  } catch (error) { toast(error.message, "error"); }
}

async function newStyle() {
  const kind = await ask({
    title: t("New style"), confirm: t("Next"), input: null,
    choices: [
      { value: "style", title: t("Style"), detail: t("How every image drawn with it looks: the medium, line, color, light, and texture.") },
      { value: "guide", title: t("Guide"), detail: t("Draws nothing itself. Lends rules such as brand colors to the styles that build on it.") }
    ]
  });
  if (!kind) return;
  const guide = kind === "guide";
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

// ---------- node cards ----------

const nodeOfPath = path => path.split("/")[1];
const nodeById = id => board.data.nodes.find(node => node.id === id);

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

// An image on the canvas named by its node and its number there (null when it is the node's only image).
function imageOnCanvas(path) {
  const node = nodeById(nodeOfPath(path));
  if (!node) return null;
  const index = node.images.findIndex(image => image.path === path);
  return { path, node: node.id, number: node.images.length > 1 && index >= 0 ? index + 1 : null };
}

// The images on the canvas a node builds on.
const parentImages = node => node.parents.filter(path => nodeOfPath(path) !== node.id).map(imageOnCanvas).filter(Boolean);

const parentLabel = item => item.number ? `${item.node} · ${pad(item.number)}` : item.node;
const parentTitle = item => item.number ? t("Builds on {node}, image {number}", { node: item.node, number: pad(item.number) }) : t("Builds on {node}", { node: item.node });

function nodeHead(node, extra = []) {
  return [
    h("span", { class: "node-id", text: node.id }),
    h("span", { class: "node-kind", text: node.tool ? TOOL_NAMES[node.tool] : KIND_NAMES[node.kind] }),
    node.style ? h("a", { class: "node-style", href: hashes.style(board.project, node.style), text: node.style }) : null,
    h("span", { class: "grow" }),
    statusPill(node),
    tool("more", t("More"), event => openNodeMenu(node, event), { quiet: true }),
    ...extra
  ];
}

function nodeCard(node) {
  const project = board.project;
  const items = node.images.map(image => nodeImageItem(project, node, image, board.data.styles));
  const from = parentImages(node);
  const several = node.images.length > 1;
  const card = h("article", { class: "canvas-node", "data-id": node.id }, [
    h("header", { class: "node-head" }, nodeHead(node)),
    from.length ? h("div", { class: "node-from" }, from.map(item => h("button", { class: "node-parent", type: "button", "data-path": item.path, title: parentTitle(item), onclick: () => showNode(item.node) }, [
      h("img", { src: fileUrl(inProject(project, item.path)), alt: "", loading: "lazy" }),
      h("span", { text: parentLabel(item) })
    ]))) : null,
    node.request ? h("p", { class: "node-request", text: node.request.replace(/\n\s*\n+/g, "\n") }) : null,
    node.images.length ? h("div", { class: `node-images${several ? " several" : ""}` }, node.images.map((image, index) => h("div", { class: "node-image", "data-path": image.path }, [
      imageFrame(inProject(project, image.path), {
        fit: "fill",
        number: several ? index + 1 : null,
        tools: [tool("zoom", t("Enlarge"), () => openLightbox(items, index)), tool("more", t("More"), event => openImageMenu(node, image, event))]
      })
    ]))) : ["queued", "drawing", "running"].includes(node.status) ? pendingFrame(node) : null,
    node.status === "failed" ? h("p", { class: "node-error", text: node.error || t("Nothing came out of this request.") }) : null
  ]);
  card.addEventListener("contextmenu", event => {
    event.preventDefault();
    const frame = event.target.closest(".node-image");
    if (frame) openImageMenu(node, node.images.find(image => image.path === frame.dataset.path), event);
    else openNodeMenu(node, event);
  });
  return card;
}

const frameIndexOf = id => board.data.canvas.frames.findIndex(frame => frame.nodes.includes(id));

function openNodeMenu(node, event) {
  const grouping = board.selected.has(node.id) ? [...board.selected] : [node.id];
  openMenu({ x: event.clientX, y: event.clientY }, [
    node.thread ? { label: t("Open the thread"), onClick: () => { location.hash = hashes.thread(board.project, node.thread); } } : null,
    { label: t("Group"), onClick: () => groupNodes(grouping) },
    frameIndexOf(node.id) >= 0 ? { label: t("Remove from group"), onClick: () => ungroupNodes([node.id]) } : null,
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

async function deleteNode(node) {
  if (!await confirmDelete(t("Delete {name}", { name: node.id }), t("The request and its images are deleted. Nodes built on it stay."))) return;
  try {
    await api("/api/nodes/delete", { project: board.project, node: node.id });
    node.images.forEach(image => board.picked.delete(image.path));
    board.selected.delete(node.id);
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
  const project = board.project;
  let last = null;
  for (const file of files) {
    try { last = (await api("/api/nodes", { project, kind: "upload", attachments: [{ name: file.name, data: await readFile(file) }] })).node; }
    catch (error) { toast(error.message, "error"); }
  }
  if (last && board.project === project) board.focus = last;
  load();
}

// ---------- inspector ----------

function renderInspector() {
  const panel = $("board-inspector");
  if (!panel) return;
  const nodes = [...board.selected].map(nodeById).filter(Boolean);
  const signature = signatureOf({ nodes, reviews: nodes.map(node => board.reviews.has(node.id)), frames: board.data.canvas.frames });
  if (signature === board.inspectorSignature) return;
  board.inspectorSignature = signature;
  panel.hidden = !nodes.length;
  fill(panel, ...(nodes.length === 1 ? nodeDetail(nodes[0]) : nodes.length ? selectionDetail(nodes) : []));
}

const inspectorSection = (title, ...children) => h("section", { class: "inspector-section" }, [h("h3", { text: title }), ...children]);

function nodeDetail(node) {
  const project = board.project;
  const items = node.images.map(image => nodeImageItem(project, node, image, board.data.styles));
  const from = parentImages(node);
  const several = node.images.length > 1;
  const notes = node.images.map((image, index) => image.description ? [several ? pad(index + 1) : null, image.description] : null).filter(Boolean);
  const reviewed = node.images.some(image => image.review);
  const open = board.reviews.has(node.id);
  const attachments = node.kind === "upload" ? [] : node.attachments;
  return [
    h("header", { class: "node-head inspector-head" }, nodeHead(node, [tool("close", t("Close"), clearSelection, { quiet: true })])),
    node.request ? inspectorSection(t("Request"), h("p", { class: "inspector-text", text: node.request })) : null,
    from.length ? inspectorSection(t("Built from"), h("div", { class: "thumbs" }, from.map(item => thumb(inProject(project, item.path), { small: true, badge: parentLabel(item), title: parentTitle(item), onClick: () => showNode(item.node) })))) : null,
    attachments.length ? inspectorSection(t("Attachments"), h("div", { class: "thumbs" }, attachments.map((path, index, all) => thumb(inProject(project, path), {
      small: true, onClick: () => openLightbox(all.map(each => ({ path: inProject(project, each), info: [] })), index)
    })))) : null,
    node.status === "failed" ? notice(node.error || t("Nothing came out of this request."), { tone: "danger" }) : null,
    node.note || notes.length ? inspectorSection(t("Agent's note"),
      node.note ? h("p", { class: "inspector-text", text: node.note }) : null,
      ...notes.map(([number, text]) => h("p", { class: "inspector-text inspector-numbered" }, [number ? h("span", { class: "inspector-number", text: number }) : null, h("span", { text })]))
    ) : null,
    reviewed ? h("section", { class: "inspector-section" }, [
      button(open ? t("Hide review") : t("Show review"), { small: true, variant: "ghost", iconName: "eye", onClick: () => toggleReviews(node.id) }),
      open ? h("div", { class: "inspector-reviews" }, node.images.map((image, index) => image.review ? h("div", { class: "inspector-numbered" }, [
        several ? h("span", { class: "inspector-number", text: pad(index + 1) }) : null,
        reviewLine(image.review)
      ]) : null)) : null
    ]) : null,
    node.images.length || node.model || node.tool ? inspectorSection(t("Made with"), specList([
      node.tool ? [t("Tool"), TOOL_NAMES[node.tool] || node.tool] : node.model ? [t("Model"), shortModel(node.model)] : null,
      node.style ? [t("Style"), node.revision ? t("{style} at revision {revision}", { style: node.style, revision: node.revision }) : node.style] : null,
      node.cost ? [t("Cost"), money(node.cost)] : null,
      [t("Made at"), stamp(node.time)]
    ]), node.references.length ? h("div", { class: "thumbs" }, node.references.map(item => thumb(item.path || item.object, {
      small: true, src: objectUrl(item.object), badge: ROLE_NAMES[item.role] || item.role, title: item.path || ""
    }))) : null, node.dropped.length ? h("p", { class: "muted inspector-text", text: `${t("References left out")}: ${node.dropped.map(item => `${item.reference} (${item.reason})`).join(", ")}` }) : null) : null,
    node.images.some(image => image.prompt) ? h("div", { class: "row" }, [
      button(t("Prompt"), { small: true, variant: "ghost", iconName: "text", onClick: () => openLightbox(items, 0) })
    ]) : null,
    node.thread ? h("div", { class: "row" }, [linkButton(t("Open the thread"), hashes.thread(project, node.thread), { iconName: "open" })]) : null
  ];
}

function selectionDetail(nodes) {
  return [
    h("header", { class: "inspector-head" }, [
      h("strong", { text: tn("{count} node selected", "{count} nodes selected", nodes.length) }),
      h("span", { class: "grow" }),
      tool("close", t("Close"), clearSelection, { quiet: true })
    ]),
    h("p", { class: "muted inspector-text", text: t("Drag one of them to move them together, or group them.") }),
    h("div", { class: "row" }, [
      button(t("Group"), { small: true, iconName: "plus", onClick: () => groupNodes(nodes.map(node => node.id)) }),
      nodes.some(node => frameIndexOf(node.id) >= 0) ? button(t("Remove from group"), { small: true, variant: "ghost", onClick: () => ungroupNodes(nodes.map(node => node.id)) }) : null
    ])
  ];
}

function toggleReviews(id) {
  if (board.reviews.has(id)) board.reviews.delete(id);
  else board.reviews.add(id);
  renderInspector();
}

// ---------- frames ----------

async function saveFrames(frames) {
  board.data.canvas.frames = frames;
  board.canvasSignature = null;
  renderCanvas();
  renderInspector();
  try { await api("/api/canvas", { project: board.project, frames }); }
  catch (error) { toast(error.message, "error"); }
  load();
}

async function groupNodes(ids) {
  const title = await ask({ title: t("Group"), description: t("Nodes in a group move together."), placeholder: t("Group name"), confirm: t("Group"), input: "text" });
  if (title == null) return;
  const frames = board.data.canvas.frames.map(frame => ({ ...frame, nodes: frame.nodes.filter(id => !ids.includes(id)) })).filter(frame => frame.nodes.length);
  saveFrames([...frames, { title, nodes: [...ids].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))) }]);
}

function ungroupNodes(ids) {
  saveFrames(board.data.canvas.frames.map(frame => ({ ...frame, nodes: frame.nodes.filter(id => !ids.includes(id)) })).filter(frame => frame.nodes.length));
}

async function renameFrame(index) {
  const frame = board.data.canvas.frames[index];
  const title = await ask({ title: t("Rename"), value: frame.title, placeholder: t("Group name"), confirm: t("Change"), input: "text" });
  if (title == null || title === frame.title) return;
  saveFrames(board.data.canvas.frames.map((each, at) => at === index ? { ...each, title } : each));
}

function openFrameMenu(index, event) {
  openMenu({ x: event.clientX, y: event.clientY }, [
    { label: t("Select its nodes"), onClick: () => selectFrame(index) },
    { label: t("Rename"), onClick: () => renameFrame(index) },
    { label: t("Ungroup"), onClick: () => saveFrames(board.data.canvas.frames.filter((frame, at) => at !== index)) }
  ]);
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
    const key = JSON.stringify([node, parentImages(node), agentAttached()]);
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
  const paths = new Set(nodes.flatMap(node => node.images.map(image => image.path)));
  [...board.picked].forEach(path => { if (!paths.has(path)) board.picked.delete(path); });
  [...board.selected].forEach(id => { if (!known.has(id)) board.selected.delete(id); });
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
  const held = board.dragging ? board.dragging.map(id => [id, board.positions[id]]).filter(([, at]) => at) : [];
  board.positions = placeNodes(board.data.nodes, board.data.canvas.frames, board.saved);
  for (const [id, at] of held) if (board.positions[id]) board.positions[id] = at;
  for (const [id, card] of board.cards) {
    const [x, y] = board.positions[id];
    card.element.style.left = `${x}px`;
    card.element.style.top = `${y}px`;
  }
  measureCards();
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

// Where each image and each parent chip sits inside its card, for the edges that end at them. Offsets ignore
// transforms, so a card still moving in with .enter, or a zoom in progress, measures where it comes to rest; the
// offset parent of both is the card.
function measureCards() {
  board.geometry = new Map();
  board.chips = new Map();
  for (const [id, card] of board.cards) {
    const border = card.element.clientTop;
    card.element.querySelectorAll(".node-image").forEach(image => {
      const frame = image.querySelector(".frame");
      board.geometry.set(image.dataset.path, { y: frame.offsetTop + border, height: frame.offsetHeight });
    });
    card.element.querySelectorAll(".node-parent").forEach(chip => board.chips.set(`${id}|${chip.dataset.path}`, chip.offsetTop + border + chip.offsetHeight / 2));
  }
}

function rectOf(id) {
  const [x, y] = board.positions[id];
  const { width, height } = sizeOf(id);
  return { x, y, right: x + width, bottom: y + height };
}

function drawFrames() {
  const frames = board.data.canvas.frames.map((frame, index) => {
    const members = frame.nodes.filter(id => board.positions[id]).map(rectOf);
    if (!members.length) return null;
    const x = Math.min(...members.map(rect => rect.x)) - FRAME_PAD;
    const y = Math.min(...members.map(rect => rect.y)) - FRAME_PAD - FRAME_HEAD;
    const width = Math.max(...members.map(rect => rect.right)) + FRAME_PAD - x;
    const height = Math.max(...members.map(rect => rect.bottom)) + FRAME_PAD - y;
    const selected = frame.nodes.length && frame.nodes.every(id => board.selected.has(id));
    return h("div", {
      class: `canvas-frame${selected ? " selected" : ""}`, "data-index": index, style: `left: ${x}px; top: ${y}px; width: ${width}px; height: ${height}px`,
      oncontextmenu: event => { event.preventDefault(); openFrameMenu(index, event); }
    }, [
      h("div", { class: "canvas-frame-head" }, [
        h("span", { class: "canvas-frame-title", text: frame.title || t("Group"), title: frame.title, ondblclick: () => renameFrame(index) }),
        tool("more", t("More"), event => openFrameMenu(index, event), { quiet: true })
      ])
    ]);
  });
  fill($("canvas-frames"), frames);
}

// An edge leaves the parent's card on its right side, level with the image built on, and enters the child's card at
// the chip that names that image. The edges run under the cards.
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
      const chip = board.chips.get(`${node.id}|${parent}`);
      const [sx, sy] = [source.right, source.y + (image ? image.y + image.height / 2 : 24)];
      const [tx, ty] = [target.x, target.y + (chip ?? 24)];
      const bend = Math.max(48, Math.abs(tx - sx) / 2);
      const on = board.selected.has(node.id) || board.selected.has(id);
      paths.push(svgNode("path", { class: `edge${on ? " on" : ""}`, d: `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}` }));
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
  // A first look stays readable: a canvas too large to fit opens at its top left instead of shrinking to a thumbnail.
  if (board.view.zoom < FIRST_ZOOM) {
    const { left, top } = contentBounds();
    board.view = { x: FIT_MARGIN.side - left * FIRST_ZOOM, y: FIT_MARGIN.top - top * FIRST_ZOOM, zoom: FIRST_ZOOM };
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

// The cards and frames together, in world coordinates.
function contentBounds() {
  const rects = [...Object.keys(board.positions).map(rectOf), ...[...$("canvas-frames").children].map(frame => ({ x: frame.offsetLeft, y: frame.offsetTop, right: frame.offsetLeft + frame.offsetWidth, bottom: frame.offsetTop + frame.offsetHeight }))];
  const left = Math.min(...rects.map(rect => rect.x));
  const top = Math.min(...rects.map(rect => rect.y));
  return { left, top, width: Math.max(...rects.map(rect => rect.right)) - left, height: Math.max(...rects.map(rect => rect.bottom)) - top };
}

function fitView() {
  if (!Object.keys(board.positions).length) { board.view = { x: FIT_MARGIN.side, y: FIT_MARGIN.top, zoom: 1 }; return applyView(); }
  const { left, top, width, height } = contentBounds();
  const availableWidth = $("canvas-viewport").clientWidth - FIT_MARGIN.side * 2;
  const availableHeight = visibleHeight() - FIT_MARGIN.top - FIT_MARGIN.bottom;
  const zoom = clampZoom(Math.min(1, availableWidth / width, availableHeight / height));
  board.view = { x: FIT_MARGIN.side + (availableWidth - width * zoom) / 2 - left * zoom, y: FIT_MARGIN.top + Math.max(0, (availableHeight - height * zoom) / 2) - top * zoom, zoom };
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

// Space held pans. Leaving the window drops it, since the key's release then goes to another app.
function boardKeys(event) {
  if (!$("canvas-viewport")) return;
  if (event.type === "blur") { board.spaceHeld = false; $("canvas-viewport").classList.remove("panning"); return; }
  const typing = event.target.matches("input, textarea");
  if (event.code === "Space" && !typing) {
    board.spaceHeld = event.type === "keydown";
    $("canvas-viewport").classList.toggle("panning", board.spaceHeld);
    if (board.spaceHeld) event.preventDefault();
  }
  if (event.type === "keydown" && event.key === "Escape" && !typing && (board.picked.size || board.selected.size) && $("modal").hidden && $("lightbox").hidden && $("menu").hidden) clearSelection();
}

// One pointer gesture. Dragging a card moves it, with the other selected cards when it is one of them; dragging a
// frame moves its nodes; dragging the background (or anything with Space held) pans. A press that does not move
// selects: an image is picked to build on and its node selected, a card selects its node, a frame its nodes, and the
// background clears both. Shift adds to what is picked and selected.
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

  // The page's own images are not dragged out as files, so only files from outside reach the drop below.
  viewport.addEventListener("dragstart", event => event.preventDefault());

  viewport.addEventListener("pointerdown", event => {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.target.closest("button, a, label, input, textarea, .canvas-tools")) return;
    const card = event.target.closest(".canvas-node");
    const frame = card ? null : event.target.closest(".canvas-frame");
    const grabbing = event.button === 0 && !board.spaceHeld;
    let moving = [];
    if (grabbing && card) moving = board.selected.has(card.dataset.id) ? [...board.selected] : [card.dataset.id];
    else if (grabbing && frame) moving = [...board.data.canvas.frames[Number(frame.dataset.index)].nodes];
    moving = moving.filter(id => board.positions[id] && board.cards.has(id));
    const start = { x: event.clientX, y: event.clientY, view: { ...board.view }, at: Object.fromEntries(moving.map(id => [id, [...board.positions[id]]])) };
    let moved = false;
    viewport.setPointerCapture(event.pointerId);
    const move = pointer => {
      const dx = pointer.clientX - start.x;
      const dy = pointer.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!moved) {
        moved = true;
        board.dragging = moving.length ? moving : null;
        if (moving.length) moving.forEach(id => board.cards.get(id).element.classList.add("dragging"));
        else viewport.classList.add("dragging");
      }
      if (moving.length) {
        for (const id of moving) {
          board.positions[id] = [start.at[id][0] + dx / board.view.zoom, start.at[id][1] + dy / board.view.zoom];
          // A poll may rebuild a card while it is held; the one on the canvas now is moved.
          const held = board.cards.get(id);
          if (!held) continue;
          held.element.style.left = `${board.positions[id][0]}px`;
          held.element.style.top = `${board.positions[id][1]}px`;
        }
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
      moving.forEach(id => { const held = board.cards.get(id); if (held) held.element.classList.remove("dragging"); });
      viewport.classList.remove("dragging");
      board.dragging = null;
      if (moved && moving.length) return placeByHand();
      if (moved || ended.type === "pointercancel" || event.button !== 0) return;
      const image = event.target.closest(".node-image");
      if (image) { pickImage(image.dataset.path, event.shiftKey); selectNodes([card.dataset.id], event.shiftKey); }
      else if (card) selectNodes([card.dataset.id], event.shiftKey);
      else if (frame) selectFrame(Number(frame.dataset.index), event.shiftKey);
      else clearSelection();
    };
    viewport.addEventListener("pointermove", move);
    viewport.addEventListener("pointerup", up);
    viewport.addEventListener("pointercancel", up);
  });

  viewport.addEventListener("dblclick", event => {
    const image = event.target.closest(".node-image");
    if (!image) return;
    const node = nodeById(image.closest(".canvas-node").dataset.id);
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

// ---------- selecting and picking ----------

function pickImage(path, adding) {
  if (adding) {
    if (board.picked.has(path)) board.picked.delete(path);
    else board.picked.add(path);
  } else {
    const only = board.picked.size === 1 && board.picked.has(path);
    board.picked.clear();
    if (!only) board.picked.add(path);
  }
  syncSelection();
}

function selectNodes(ids, adding = false) {
  if (!adding) board.selected.clear();
  ids.forEach(id => board.selected.add(id));
  syncSelection();
}

function selectFrame(index, adding = false) {
  selectNodes(board.data.canvas.frames[index].nodes.filter(id => nodeById(id)), adding);
}

// Selects a node and brings it into view, such as the parent a chip names.
function showNode(id) {
  if (!board.cards.has(id)) return;
  selectNodes([id]);
  focusNode(id);
}

function clearSelection() {
  board.picked.clear();
  board.selected.clear();
  syncSelection();
}

function syncSelection() {
  document.querySelectorAll("#canvas-nodes .node-image").forEach(image => image.classList.toggle("picked", board.picked.has(image.dataset.path)));
  for (const [id, card] of board.cards) card.element.classList.toggle("selected", board.selected.has(id));
  if (board.data) { drawFrames(); drawEdges(); renderInspector(); }
  syncComposer();
}

// ---------- composer ----------

const styleKey = () => `canvas-style:${board.project}`;

function buildComposer() {
  board.styleSlot = h("span", { class: "composer-style" });
  board.noteSlot = h("span", { class: "composer-note" });
  try { board.draft.style = localStorage.getItem(styleKey()); } catch {}
  board.composer = composer({
    value: board.draft.text,
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
  const picked = [...board.picked];
  const label = path => { const item = imageOnCanvas(path); return item ? parentLabel(item) : nodeOfPath(path); };
  board.composer.setImages([
    ...picked.map(path => ({ key: `pick|${path}`, node: thumb(inProject(project, path), { picked: true, badge: label(path), title: t("Builds on this image"), remove: () => { board.picked.delete(path); syncSelection(); } }) })),
    ...board.draft.attachments.map(item => ({ key: `attachment|${item.key}`, node: thumb(item.name, { src: item.url, title: item.name, remove: () => removeAttachment(item) }) }))
  ]);
  // Without a style that can draw, the style slot already says why nothing can be sent.
  board.noteSlot.hidden = !board.draft.style;
  board.noteSlot.textContent = !picked.length ? t("New image") : picked.length === 1 ? t("Refines {node}", { node: label(picked[0]) }) : tn("Builds on {count} image", "Builds on {count} images", picked.length);
  board.composer.send.disabled = board.sending || !board.draft.style || !board.draft.text.trim();
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

// The text box is locked while the request is on its way; images attached or picked meanwhile stay for the next one.
async function sendRequest() {
  const draft = board.draft;
  const box = board.composer;
  if (board.sending || !draft.style || !draft.text.trim()) return;
  const parents = [...board.picked];
  const attachments = [...draft.attachments];
  board.sending = true;
  box.send.disabled = true;
  box.input.disabled = true;
  try {
    const made = await api("/api/nodes", {
      project: board.project, kind: "generation", style: draft.style, request: draft.text,
      parents, attachments: attachments.map(({ name, data }) => ({ name, data }))
    });
    box.input.disabled = false;
    // Another project was opened meanwhile, so its board is not this one's.
    if (board.draft !== draft) return;
    attachments.forEach(item => URL.revokeObjectURL(item.url));
    draft.attachments = draft.attachments.filter(item => !attachments.includes(item));
    box.input.value = "";
    box.input.dispatchEvent(new Event("input"));
    parents.forEach(path => board.picked.delete(path));
    board.focus = made.node;
    board.sending = false;
    syncSelection();
    load();
  } catch (error) {
    box.input.disabled = false;
    if (board.draft !== draft) return;
    toast(error.message, "error");
    board.sending = false;
    syncComposer();
  }
}
