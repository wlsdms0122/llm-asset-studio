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
  text: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>'
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
function button(label, { variant = "", small = false, grow = false, onClick, title, disabled, hidden, iconName } = {}) {
  const node = h("button", { class: ["button", variant, small && "small", grow && "grow"].filter(Boolean).join(" "), type: "button", title, disabled, hidden, onclick: onClick });
  if (iconName) node.innerHTML = icon(iconName);
  node.append(h("span", { text: label }));
  return node;
}

function iconButton(iconName, title, onClick, { variant = "", small = false, disabled, hidden } = {}) {
  return h("button", { class: ["button", "icon-only", variant, small && "small"].filter(Boolean).join(" "), type: "button", title, "aria-label": title, disabled, hidden, onclick: onClick, html: icon(iconName) });
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

// A button that opens the file picker for images.
function uploadButton(title, onFiles, { iconName = "clip", label = null, variant = "" } = {}) {
  const input = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", multiple: true });
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

// One thing in a list to open or choose (a model, a session). aside: a pill or a quiet tool at the end.
function listRow({ title, detail = null, aside = null, onClick = null, current = false, hint = null }) {
  const act = () => { if (onClick && !current) onClick(); };
  return h("div", { class: `row-item${current ? " current" : ""}`, role: "button", tabindex: 0, title: hint, onclick: act, onkeydown: event => { if (event.key === "Enter") act(); } }, [
    h("div", { class: "row-text" }, [h("strong", { text: title }), detail ? h("small", { text: detail }) : null]),
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
function composer({ value = "", placeholder = "", sendTitle, onInput = null, onSend, attach = null }) {
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
  const node = h("div", { class: "composer" }, [images, input, h("div", { class: "composer-bar" }, [attach, h("span", { class: "grow" }), send])]);
  node.send = send;
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

// tone: "" (neutral), accent, success. dot: null, "static", "live".
function pill(text, { tone = "", dot = null, small = false } = {}) {
  return h("span", { class: ["pill", tone, small && "small"].filter(Boolean).join(" ") }, [dot ? h("span", { class: `dot${dot === "live" ? " live" : ""}` }) : null, text]);
}

function chip(text, { on = false, onClick } = {}) {
  return h("button", { class: `chip${on ? " on" : ""}`, type: "button", text, onclick: onClick });
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

// ---------- images ----------

// fit: "natural" shows the image at its own ratio; "fill" crops it to a square cell so grids line up.
function imageFrame(path, { fit = "natural", onClick = null, number = null, check = false, tools = [], lazy = true } = {}) {
  return h("div", { class: ["frame", fit === "fill" && "fill", onClick && "clickable"].filter(Boolean).join(" "), onclick: onClick }, [
    h("img", { src: fileUrl(path), alt: "", loading: lazy ? "lazy" : null }),
    number != null ? h("span", { class: "number", text: String(number).padStart(2, "0") }) : null,
    check ? h("span", { class: "check", html: icon("check") }) : null,
    tools.filter(Boolean).length ? h("div", { class: "tools" }, tools) : null
  ]);
}

// badge: a short label over the image's lower left corner, such as the number of a picked attempt.
function thumb(path, { onClick = null, picked = false, small = false, title = null, remove = null, badge = null } = {}) {
  return h(remove ? "div" : "button", { class: ["thumb", picked && "picked", small && "small"].filter(Boolean).join(" "), type: remove ? null : "button", title, onclick: onClick }, [
    h("img", { src: fileUrl(path), alt: "", loading: "lazy" }),
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
    openMenu({ x: box.left, y: box.bottom + 4, width: box.width }, options.map(option => ({
      label: option.label, detail: option.detail, checked: option.value === value,
      onClick: () => { if (option.value !== value) onChange(option.value); }
    })));
  });
  return node;
}

// items: [{ label, detail?, onClick, danger?, checked? }] (null entries skipped). at: { x, y, width? } in viewport pixels.
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
  menu.style.top = `${Math.min(at.y, innerHeight - box.height - 8)}px`;
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

// input: "text" (one line), "long" (a paragraph), or null for a plain confirmation.
// choices: [{ value, title, detail?, aside? }] shows a list to pick one from. Resolves to the answer, or null when cancelled.
// text: a long text to read, such as a prompt, shown wide with only the confirm button.
function ask({ title, description = "", value = "", placeholder = "", confirm, input = "long", choices = null, danger = false, error = "", text = null }) {
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
  $("modal-choices").hidden = !choices;
  fill($("modal-choices"), ...(choices || []).map((choice, index) => h("label", { class: "choice" }, [
    h("input", { type: "radio", name: "modal-choice", value: choice.value, checked: index === 0 }),
    h("span", {}, [h("strong", { text: choice.title }), choice.detail ? h("small", { text: choice.detail }) : null]),
    choice.aside ? h("span", { class: "price", text: choice.aside }) : null
  ])));
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
