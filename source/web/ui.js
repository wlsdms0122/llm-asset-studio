"use strict";

// Asset Studio design system: the components every page builds from. Each returns a DOM node styled by ui.css.
// app.js decides what goes where; it does not style or assemble these parts by hand. web/README.md says when to use which.

// Icons are Lucide (lucide.dev, ISC license, lucide-static 0.460.0), drawn on its 24 by 24 grid.
const ICONS = {
  zoom: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  memo: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  reference: '<path d="M16 5h6"/><path d="M19 2v6"/><path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/><circle cx="9" cy="9" r="2"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  previous: '<path d="m15 18-6-6 6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
  send: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  languages: '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
  text: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  open: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  restore: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'
};

const $ = id => document.getElementById(id);
const icon = name => `<svg class="icon" viewBox="0 0 24 24">${ICONS[name]}</svg>`;
const fileUrl = path => `/file/${path.split("/").map(encodeURIComponent).join("/")}`;

// Replaces a node's children, skipping the empty slots that conditional children leave.
function fill(node, ...children) {
  node.replaceChildren(...children.flat().filter(child => child != null && child !== false));
}

function h(tag, properties = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(properties)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "html") node.innerHTML = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key in node && key !== "list") node[key] = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  node.append(...[].concat(children).filter(child => child != null && child !== false));
  return node;
}

// ---------- actions ----------

// variant: "" (secondary), primary, success, danger, ghost. A panel has one primary.
function button(label, { variant = "", small = false, grow = false, onClick, title, disabled, hidden, iconName, class: extra = null } = {}) {
  const node = h("button", { class: ["button", variant, small && "small", grow && "grow", extra].filter(Boolean).join(" "), type: "button", title, disabled, hidden, onclick: onClick });
  if (iconName) node.innerHTML = icon(iconName);
  node.append(h("span", { text: label }));
  return node;
}

function iconButton(iconName, title, onClick, { variant = "", small = false, disabled, hidden } = {}) {
  return h("button", { class: ["button", "icon-only", variant, small && "small"].filter(Boolean).join(" "), type: "button", title, "aria-label": title, disabled, hidden, onclick: onClick, html: icon(iconName) });
}

// A link that looks like a button: going to another page, such as a style or a node on the canvas.
function linkButton(label, href, { variant = "", small = true, iconName = null, title = null } = {}) {
  const node = h("a", { class: ["button", variant, small && "small"].filter(Boolean).join(" "), href, title });
  if (iconName) node.innerHTML = icon(iconName);
  node.append(h("span", { text: label }));
  return node;
}

// An icon button that opens a menu of choices under itself, such as the theme or the language.
// options: [{ value, label }]; value is the current one.
function menuButton(iconName, title, { value, options, onChange }) {
  const node = iconButton(iconName, title, event => {
    event.stopPropagation();
    const box = node.getBoundingClientRect();
    openMenu({ x: box.left, y: box.bottom + 4 }, options.map(option => ({ label: option.label, checked: option.value === value, onClick: () => { if (option.value !== value) onChange(option.value); } })));
  }, { variant: "ghost" });
  node.setAttribute("aria-haspopup", "menu");
  return node;
}

const IMAGE_FILES = "image/png,image/jpeg,image/webp";
// What can go on the canvas or into a style's references: images, and texts.
const MATERIAL_FILES = `${IMAGE_FILES},.md,.txt,text/markdown,text/plain`;

// A button that opens the file picker, for images unless accept says otherwise.
function uploadButton(title, onFiles, { iconName = "clip", label = null, variant = "", accept = IMAGE_FILES } = {}) {
  const input = h("input", { type: "file", accept, multiple: true });
  input.addEventListener("change", async () => { await onFiles([...input.files]); input.value = ""; });
  return h("label", { class: ["button", variant, label ? "" : "icon-only"].filter(Boolean).join(" "), title, "aria-label": title, html: icon(iconName) + (label ? `<span>${label}</span>` : "") }, [input]);
}

// An action over an image (zoom, download, add to references): an icon that shows on hover. danger: turns red on hover.
function tool(iconName, title, onClick, { href = null, download = null, on = false, quiet = false, danger = false } = {}) {
  const properties = { class: ["tool", on && "on", quiet && "quiet", danger && "danger"].filter(Boolean).join(" "), title, "aria-label": title, html: icon(iconName) };
  if (href) return h("a", { ...properties, href, download, onclick: event => event.stopPropagation() });
  return h("button", { ...properties, type: "button", onclick: event => { event.stopPropagation(); onClick(event); } });
}

// ---------- rows ----------

// [label, value] pairs shown as a line of labeled values, such as a model's price and the references it takes.
function specList(specs) {
  return h("dl", { class: "specs" }, specs.filter(Boolean).map(([label, value]) => h("div", {}, [h("dt", { text: label }), h("dd", { text: value })])));
}

// One thing in a list to open or choose (a model, a session). aside: a pill or a quiet tool at the end; specs: specList pairs.
function listRow({ title, detail = null, aside = null, onClick = null, current = false, hint = null, specs = null }) {
  const act = () => { if (onClick && !current) onClick(); };
  return h("div", { class: `row-item${current ? " current" : ""}`, role: "button", tabindex: 0, title: hint, onclick: act, onkeydown: event => { if (event.key === "Enter") act(); } }, [
    h("div", { class: "row-text" }, [h("strong", { text: title }), detail ? h("small", { text: detail }) : null, specs ? specList(specs) : null]),
    aside
  ]);
}

function rowList(rows) {
  return h("div", { class: "rows" }, rows);
}

// ---------- composer ----------

const COMPOSER_MAX = 240;

// The message box under a conversation: images above the text, attach at the left of the bar under it, send at the right.
// The box grows and shrinks smoothly with the text and the images, and Cmd or Ctrl+Enter sends.
// node.send is the send button, for the page to enable; node.setImages([{ key, node }]) shows the images that go with
// the message, bringing new ones in and taking removed ones out with a motion, and keeping the rest in place.
// tools: controls that shape the message, placed after attach (a style picker, a short note on what send does).
function composer({ value = "", placeholder = "", sendTitle, onInput = null, onSend, attach = null, tools = [] }) {
  const input = h("textarea", { rows: 1, placeholder, value });
  const send = h("button", { class: "button primary icon-only composer-send", type: "button", title: sendTitle, "aria-label": sendTitle, html: icon("send"), onclick: onSend });
  // The height a text box needs is measured on a hidden copy, so the box itself goes from one height to the next.
  const fit = () => {
    const copy = h("textarea", { rows: 1, value: input.value, style: `position: absolute; visibility: hidden; height: auto; transition: none; width: ${input.clientWidth}px` });
    copy.className = input.className;
    input.parentNode.append(copy);
    const needed = copy.scrollHeight;
    copy.remove();
    input.style.height = `${Math.min(needed, COMPOSER_MAX)}px`;
    input.style.overflowY = needed > COMPOSER_MAX ? "auto" : "hidden";
  };
  input.addEventListener("input", () => { fit(); if (onInput) onInput(input.value); });
  input.addEventListener("keydown", event => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    if (!send.disabled) send.click();
  });
  const thumbs = h("div", { class: "thumbs" });
  const images = h("div", { class: "composer-images" }, [thumbs]);
  const node = h("div", { class: "composer" }, [images, input, h("div", { class: "composer-bar" }, [attach, ...tools, h("span", { class: "grow" }), send])]);
  node.send = send;
  node.input = input;
  node.setImages = items => {
    const keys = new Set(items.map(item => item.key));
    for (const child of [...thumbs.children]) {
      if (keys.has(child.dataset.key) || child.classList.contains("leaving")) continue;
      child.classList.add("leaving");
      child.addEventListener("animationend", () => child.remove(), { once: true });
    }
    let before = null;
    for (const item of [...items].reverse()) {
      let child = [...thumbs.children].find(each => each.dataset.key === item.key && !each.classList.contains("leaving"));
      if (!child) {
        child = item.node;
        child.dataset.key = item.key;
        if (node.isConnected) child.classList.add("enter");
      }
      thumbs.insertBefore(child, before);
      before = child;
    }
    images.classList.toggle("shown", items.length > 0);
  };
  requestAnimationFrame(() => {
    input.style.transition = "none";
    fit();
    requestAnimationFrame(() => { input.style.transition = ""; });
  });
  return node;
}

// ---------- labels ----------

// tone: "" (neutral), accent, success, warning (behind or in conflict), danger. dot: null, "static", "live".
function pill(text, { tone = "", dot = null, small = false, title = null } = {}) {
  return h("span", { class: ["pill", tone, small && "small"].filter(Boolean).join(" "), title }, [dot ? h("span", { class: `dot${dot === "live" ? " live" : ""}` }) : null, text]);
}

function field(label, value, { strong = false, mono = false, grows = false } = {}) {
  const content = value instanceof Node ? value : mono ? h("pre", { class: "document", text: value }) : h("p", { class: `field-value${strong ? " strong" : ""}`, text: value });
  return h("div", { class: `field${grows ? " grows" : ""}` }, [h("span", { class: "field-label", text: label }), content]);
}

function sectionTitle(title, aside = null) {
  return h("h3", { class: "section-title" }, [title, typeof aside === "string" ? h("span", { text: aside }) : aside]);
}

function emptyState({ title = null, text = null, action = null } = {}) {
  return h("div", { class: "empty" }, [title ? h("h2", { text: title }) : null, text ? h("p", { text }) : null, action]);
}

function workingNote(text) {
  return h("div", { class: "working-note" }, [h("span", { class: "spinner" }), text]);
}

// A message that stays on the page while something holds, such as a style that cannot draw yet.
// tone: "" (information) or warning (something is behind or fights). text: a line or a node; items: lines under it.
function notice(text, { tone = "", items = null, action = null } = {}) {
  return h("div", { class: ["notice", tone].filter(Boolean).join(" ") }, [
    h("div", { class: "notice-text" }, [
      text == null ? null : text instanceof Node ? text : h("p", { text }),
      items && items.length ? h("ul", {}, items.map(item => h("li", { text: item }))) : null
    ]),
    action
  ]);
}

// ---------- tabs ----------

// items: [{ value, label, count? }]. Switches what a page shows in place; scrolls sideways when it does not fit.
function tabBar({ items, value, onChange }) {
  return h("div", { class: "tabs", role: "tablist" }, items.map(item => h("button", {
    class: `tab${item.value === value ? " on" : ""}`, type: "button", role: "tab", "aria-selected": item.value === value ? "true" : "false",
    onclick: () => { if (item.value !== value) onChange(item.value); }
  }, [h("span", { text: item.label }), item.count ? h("span", { class: "tab-count", text: String(item.count) }) : null])));
}

// ---------- text ----------

const escapeHtml = text => text.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const inlineMarkdown = text => escapeHtml(text).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

// The blocks of a markdown text: ### headings, - and 1. lists (two spaces indent a level), tables, and paragraphs.
function markdownBlocks(lines) {
  const blocks = [];
  let list = null;
  let paragraph = null;
  let table = null;
  const close = () => { list = paragraph = table = null; };
  for (const line of lines) {
    const bullet = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (!line.trim()) { close(); continue; }
    if (/^#{3,6}\s/.test(line)) { close(); blocks.push(h("h4", { html: inlineMarkdown(line.replace(/^#+\s*/, "")) })); continue; }
    if (line.trim().startsWith("|")) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;
      if (!table) { close(); table = h("table"); blocks.push(h("div", { class: "markdown-table" }, [table])); }
      table.append(h("tr", {}, line.trim().replace(/^\||\|$/g, "").split("|").map(cell => h(table.rows.length ? "td" : "th", { html: inlineMarkdown(cell.trim()) }))));
      continue;
    }
    if (bullet) {
      const ordered = /\d/.test(bullet[2]);
      if (!list || list.ordered !== ordered) { close(); list = { ordered, node: h(ordered ? "ol" : "ul") }; blocks.push(list.node); }
      list.node.append(h("li", { class: bullet[1].length >= 2 ? "nested" : null, html: inlineMarkdown(bullet[3]) }));
      continue;
    }
    if (list && /^\s/.test(line)) { list.node.lastChild.insertAdjacentHTML("beforeend", " " + inlineMarkdown(line.trim())); continue; }
    if (!paragraph) { close(); paragraph = h("p"); blocks.push(paragraph); }
    paragraph.insertAdjacentHTML("beforeend", (paragraph.childNodes.length ? " " : "") + inlineMarkdown(line.trim()));
  }
  return blocks;
}

// A markdown document as the page reads it, such as style.md: its # title left out, the text before the first ##
// section, then each ## section collapsible. isOpen(heading) says whether a section starts open; onToggle(heading,
// open) keeps the choice so a redraw does not undo it.
function markdownView(text, { isOpen = () => true, onToggle = null } = {}) {
  const preamble = [];
  const sections = [];
  for (const line of (text || "").split("\n")) {
    if (/^##\s/.test(line)) sections.push({ heading: line.replace(/^##\s*/, "").trim(), lines: [] });
    else if (sections.length) sections[sections.length - 1].lines.push(line);
    else if (!/^#\s/.test(line)) preamble.push(line);
  }
  return h("div", { class: "markdown" }, [
    ...markdownBlocks(preamble),
    ...sections.map(section => {
      const node = h("details", { class: "markdown-section", open: isOpen(section.heading) }, [
        h("summary", {}, [h("span", { html: icon("chevron") }), h("span", { text: section.heading })]),
        h("div", { class: "markdown-body" }, markdownBlocks(section.lines))
      ]);
      if (onToggle) node.addEventListener("toggle", () => onToggle(section.heading, node.open));
      return node;
    })
  ]);
}

// A unified diff from the first hunk on: added and removed lines colored, each hunk's header quiet.
function diffView(text) {
  const lines = (text || "").replace(/\n$/, "").split("\n");
  const start = lines.findIndex(line => line.startsWith("@@"));
  return h("div", { class: "diff" }, (start < 0 ? [] : lines.slice(start)).map(line => {
    const kind = line.startsWith("@@") ? "hunk" : line[0] === "+" ? "added" : line[0] === "-" ? "removed" : "same";
    return h("div", { class: `diff-line ${kind}` }, [
      h("span", { class: "diff-sign", text: kind === "added" ? "+" : kind === "removed" ? "−" : "" }),
      h("span", { text: kind === "hunk" ? line : line.slice(1) || " " })
    ]);
  }));
}

// ---------- images ----------

// fit: "natural" shows the image at its own ratio; "fill" crops it to a square cell so grids line up.
// src: an address other than the workspace file, such as a stored object.
function imageFrame(path, { fit = "natural", onClick = null, number = null, check = false, tools = [], lazy = true, src = null } = {}) {
  return h("div", { class: ["frame", fit === "fill" && "fill", onClick && "clickable"].filter(Boolean).join(" "), onclick: onClick }, [
    h("img", { src: src || fileUrl(path), alt: "", loading: lazy ? "lazy" : null, decoding: "async" }),
    number != null ? h("span", { class: "number", text: String(number).padStart(2, "0") }) : null,
    check ? h("span", { class: "check", html: icon("check") }) : null,
    tools.filter(Boolean).length ? h("div", { class: "tools" }, tools) : null
  ]);
}

// badge: a short label over the image's lower left corner, such as the number of a picked attempt.
// src: an address other than the workspace file, such as a picked file not uploaded yet.
function thumb(path, { onClick = null, picked = false, small = false, title = null, remove = null, badge = null, src = null } = {}) {
  return h(remove ? "div" : "button", { class: ["thumb", picked && "picked", small && "small"].filter(Boolean).join(" "), type: remove ? null : "button", title, onclick: onClick }, [
    h("img", { src: src || fileUrl(path), alt: "", loading: "lazy", decoding: "async" }),
    badge ? h("span", { class: "badge", text: badge }) : null,
    remove ? h("button", { class: "remove", type: "button", title: t("Remove"), html: icon("close"), onclick: event => { event.stopPropagation(); remove(); } }) : null
  ]);
}

// ---------- dropdown and menu ----------

// options: [{ value, label, detail? }]. Opens a menu under itself and reports the chosen value.
function dropdown({ value, options, onChange, title = null }) {
  const current = options.find(option => option.value === value) || options[0] || { label: "-" };
  const node = h("button", { class: "dropdown", type: "button", title, "aria-haspopup": "menu" }, [h("span", { text: current.label }), h("span", { html: icon("chevron") })]);
  node.addEventListener("click", event => {
    event.stopPropagation();
    const box = node.getBoundingClientRect();
    openMenu({ x: box.left, y: box.bottom + 4, above: box.top - 4, width: box.width }, options.map(option => ({
      label: option.label, detail: option.detail, checked: option.value === value,
      onClick: () => { if (option.value !== value) onChange(option.value); }
    })));
  });
  return node;
}

// items: [{ label, detail?, onClick, danger?, checked? }] (null entries skipped). at: { x, y, width?, above? } in viewport
// pixels; above is the trigger's top, for opening upward.
function openMenu(at, items) {
  const menu = $("menu");
  const checking = items.some(item => item && item.checked != null);
  fill(menu, ...items.filter(Boolean).map(item => h("button", { class: `menu-item${item.danger ? " danger" : ""}`, type: "button", onclick: () => { closeMenu(); item.onClick(); } }, [
    checking ? h("span", { class: "check-mark", html: item.checked ? icon("check") : "" }) : null,
    h("span", {}, [item.label, item.detail ? h("small", { text: item.detail }) : null])
  ])));
  menu.style.minWidth = at.width ? `${Math.max(200, at.width)}px` : "";
  menu.hidden = false;
  const box = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(at.x, innerWidth - box.width - 8)}px`;
  // A menu that does not fit under its trigger opens above it when the trigger says where its top is.
  const below = at.y + box.height <= innerHeight - 8;
  menu.style.top = `${below || at.above == null ? Math.min(at.y, innerHeight - box.height - 8) : Math.max(8, at.above - box.height)}px`;
}

function closeMenu() { $("menu").hidden = true; }
document.addEventListener("click", event => { if (!$("menu").contains(event.target)) closeMenu(); });
window.addEventListener("blur", closeMenu);
window.addEventListener("resize", closeMenu);

// ---------- toast ----------

function toast(message, kind = "") {
  const node = h("div", { class: `toast ${kind}`, text: message });
  $("toasts").append(node);
  setTimeout(() => node.remove(), 4200);
}

// ---------- modal ----------

let settleModal = null;
// What a dialog built from content answers with; null reads the input or the chosen choice.
let modalRead = null;

// input: "text" (one line), "long" (a paragraph), or null for a plain confirmation.
// choices: [{ value, title, detail?, aside?, specs? }] shows a list to pick one from; specs are [label, value] pairs. Resolves to the answer, or null when cancelled.
// content: a node of the page's own in place of choices; result() gives the answer.
// text: a long text to read, such as a prompt, shown wide with only the confirm button.
function ask({ title, description = "", value = "", placeholder = "", confirm, input = "long", choices = null, danger = false, error = "", text = null, content = null, result = null }) {
  if (text != null) input = null;
  $("modal-title").textContent = title;
  $("modal-description").textContent = description;
  $("modal-document").hidden = text == null;
  $("modal-document").textContent = text || "";
  $("modal-form").classList.toggle("wide", text != null);
  $("modal-cancel").hidden = text != null;
  $("modal-input").hidden = !input;
  $("modal-input").value = value;
  $("modal-input").placeholder = placeholder;
  $("modal-input").classList.toggle("single", input === "text");
  $("modal-choices").hidden = !choices && !content;
  modalRead = result;
  fill($("modal-choices"), ...(content ? [content] : (choices || []).map((choice, index) => h("label", { class: "choice" }, [
    h("input", { type: "radio", name: "modal-choice", value: choice.value, checked: index === 0 }),
    h("span", {}, [
      h("strong", { text: choice.title }),
      choice.detail ? h("small", { text: choice.detail }) : null,
      choice.specs ? specList(choice.specs) : null
    ]),
    choice.aside ? h("span", { class: "price", text: choice.aside }) : null
  ]))));
  $("modal-error").textContent = error;
  $("modal-error").hidden = !error;
  $("modal-confirm").textContent = confirm;
  $("modal-confirm").className = `button ${danger ? "danger" : "primary"}`;
  $("modal").hidden = false;
  fitModalInput();
  setTimeout(() => (input ? $("modal-input") : $("modal-confirm")).focus(), 0);
  return new Promise(resolve => { settleModal = resolve; });
}

function closeModal(result) {
  $("modal").hidden = true;
  if (settleModal) settleModal(result);
  settleModal = null;
}

function modalResult() {
  if (modalRead) return modalRead();
  if (!$("modal-choices").hidden) {
    const chosen = $("modal-choices").querySelector("input:checked");
    return chosen ? chosen.value : null;
  }
  return $("modal-input").hidden ? true : $("modal-input").value.trim();
}

$("modal-form").addEventListener("submit", event => { event.preventDefault(); closeModal(modalResult()); });
$("modal-cancel").addEventListener("click", () => closeModal(null));
$("modal").addEventListener("click", event => { if (event.target === $("modal")) closeModal(null); });
// A one-line answer still shows all of a long name: the box grows with what is in it.
function fitModalInput() {
  const input = $("modal-input");
  if (!input.classList.contains("single")) return void (input.style.height = "");
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight + 2}px`;
}
$("modal-input").addEventListener("input", fitModalInput);

$("modal-input").addEventListener("keydown", event => {
  if (event.key === "Enter" && ($("modal-input").classList.contains("single") || event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    $("modal-form").requestSubmit();
  }
});
