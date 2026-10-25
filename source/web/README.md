# Studio design system

The web studio is built from one set of tokens and components so every screen behaves the same. `ui.css` holds the tokens and the component styles, `ui.js` builds the components, and `app.css` / `app.js` only place them on pages. A page never styles a control by hand: if a screen needs something the components do not cover, the component is added here first.

## Principles

- Icons come from Lucide (lucide.dev, ISC license); copy a new one's paths into `ICONS` in `ui.js`, on its 24 by 24 grid.
- The chrome is neutral (grays, one blue accent) so the images' own colors read true.
- On the canvas and in a thread, what the user writes is sent from the composer docked under the stage, as in a chat app; its send button is the one primary action. A panel's buttons are secondary, except a step forward such as Draw it (`success`).
- Actions on an image are icons over the image, shown on hover (`tool`). Actions on a page are labeled buttons.
- Labels are short nouns or verbs. A title line says what to do; help text appears only where something can go wrong.
- Motion says that something arrived or left: a new message, image, or attachment comes in with `.enter`, the composer grows and shrinks smoothly, dialogs and menus pop in. Nothing moves on a redraw that changed nothing, and reduced motion turns it all off.
- The viewer picks the theme (system, light, dark) in the app bar; the choice stays in that browser.
- Every text on screen is written in English through `t()` (or `tn()` when it counts something), and `i18n.js` gives its Korean. The shell's fixed words carry `data-t` or `data-t-title`. The viewer picks the language in the app bar and the choice stays in that browser. `verify` fails on a text without its Korean.
- An image is shown either at its own ratio (`imageFrame` natural: candidates, the lightbox) or cropped to a square cell (`imageFrame` fill: grids, cards, canvas nodes). Grids and nodes use square cells so rows line up and a node's height does not wait for its images.
- The agent's state is shown, never guessed: the app bar says whether an agent is attached (it looked for work in the last ten minutes), and anything waiting for it says plainly when no agent is there to pick it up.
- A review stays hidden until the user has acted on the node, and shows its verdict in the viewer's language.
- Adding an image to a style's references is a one-way action available wherever the image is shown; whether an image is a reference is not a property of the image. References are removed only from the reference list.

## Tokens (`ui.css` `:root`)

| group | tokens |
|---|---|
| color | `--bg`, `--surface`, `--surface-sunken`, `--canvas` (behind images), `--fg`, `--fg-muted`, `--fg-faint`, `--line`, `--line-strong`, `--accent` (+ `-hover`, `-ink`, `-soft`), `--success` (+ `-soft`), `--danger` (+ `-soft`), `--overlay` and `--overlay-ink` (controls over images) |
| space | `--space-1` 4px, `-2` 8, `-3` 12, `-4` 16, `-5` 20, `-6` 24, `-8` 32 |
| text | `--text-xs` 12px, `-sm` 13, `-md` 14, `-base` 15, `-lg` 17, `-xl` 20, `-2xl` 26 |
| shape | `--radius-sm` 8px, `-md` 12, `-lg` 16; `--control` 40px and `--control-sm` 32px heights |
| depth | `--shadow-sm`, `-md`, `-lg` |

Each color token is `light-dark(light, dark)`, so one definition serves both themes; picking a theme sets `data-theme` on the root, which fixes the color scheme.

## Components (`ui.js`)

| component | use for |
|---|---|
| `button(label, { variant, small, grow, iconName })` | page and panel actions; variant `primary` (one per screen), `success` (a step forward: Draw it), `danger` (deleting), `ghost`, or none |
| `iconButton(icon, title, onClick)` | a panel action with a well-known icon (attach, new, zoom) |
| `linkButton(label, href, { variant, small, iconName })` | going to another page from inside content: a proposal on its style page, a node on the canvas |
| `composer({ value, placeholder, sendTitle, onInput, onSend, attach, tools })` | the message box docked under a conversation or the canvas, kept for as long as what it answers: images on top, the text, and a bar with attach on the left, `tools` after it (a style `dropdown`, a `.composer-note` saying what send does), and send on the right; grows smoothly with the text, Cmd+Enter sends, `node.send` is the send button, `node.input` the text box, `node.setImages([{ key, node }])` shows what goes with the message (picked images, then attachments) |
| `uploadButton(title, onFiles)` | picking image files |
| `tool(icon, title, onClick, { href, download, on, quiet })` | actions over an image or a list row |
| `pill(text, { tone, dot, small })` | status: `accent` for in progress or my turn, `success` for done or attached, `danger` for failed; a `live` dot while something runs |
| `chip(text, { on })` | filters |
| `dropdown({ value, options, onChange })` | choosing one of a few values in place, inside a line of other content |
| `rowList(rows)`, `listRow({ title, detail, specs, aside, onClick, current })` | a list of things to open, choose, or delete (a project's styles and threads, a style's models); the action on a row is a quiet `tool` shown on hover |
| `openMenu(at, items)` | a context menu or a dropdown's list |
| `specList([[label, value]])` | a line of labeled values, such as a model's price, billing, and references; also `specs` on a list row or a choice |
| `ask({ title, input, choices, danger, text })` | every dialog: a name, a note, a confirmation, picking one of a list, or reading a long text such as a prompt |
| `toast(message, kind)` | the result of an action |
| `field(label, value, { strong, mono, grows })` | a labeled piece of information (request, memo, prompt) |
| `sectionTitle(title, aside)` | the heading of a block on the stage or in a panel |
| `emptyState({ title, text, action })` | a list with nothing in it yet |
| `workingNote(text)` | the agent is working |
| `imageFrame(path, { fit, number, check, tools, onClick })` | every image larger than a thumbnail |
| `notice(text, { tone, items, action })` | a message that stays while something holds (probes behind, a base changed); tone `warning` for what is behind or fights |
| `tabBar({ items, value, onChange })` | switching what a page shows in place, such as the style page's sections |
| `markdownView(text, { isOpen, onToggle })`, `diffView(text)` | a markdown document with collapsible `##` sections; a unified diff with added and removed lines colored |
| `orderPicker({ items, chosen })` | choosing several in an order that matters, inside `ask({ content, result })` |
| `thumb(path, { picked, small, remove, badge, src })` | small images in a row (attachments, picks in a reply or in the composer, the images a node builds on, with their number or node as the badge); `src` for a file not uploaded yet |

## Screens

| route | file | what it shows |
|---|---|---|
| `#/` | `app.js` | the projects as cards: cover, name, purpose, styles, how many items wait for the agent; right-click to rename or delete |
| `#/p/<project>` | `canvas.js` | the project canvas (below), the panel (the brief, written in its thread; styles with their guide badge, why one cannot draw, open proposals; New style, which asks style or guide; threads and New ideation), the inspector, and the composer. `?node=<id>` brings a node into view |
| `#/p/<project>/s/<style>` | `style.js` | the style page: header (what it builds on, model, revision, why it cannot draw, base or probes behind), then tabs for rules, proposals (diffs, probe comparison, accept or reject), probes and runs, references with annotations and the set check, models, revisions, extends, threads. `?tab=<name>` opens a tab, `?proposal=<id>` a proposal |
| `#/p/<project>/t/<thread>` | `app.js` | a thread: rounds of the agent's note with its candidates, proposals and nodes it points to, and the user's replies; the composer answers the open round (picks, notes, reply, attachments). The panel shows style.md as the latest round showed it, the project's brief, or an ideation's brief with Draw it |
| `#/archive` | `app.js` | every node image grouped by project; select several to download as a zip |

The canvas pans by dragging the background, scrolling, or holding Space; Cmd or Ctrl with the wheel (or a pinch) zooms about the pointer. Each node is a card with what it was asked and what came out: kind, style, a status pill (queued, drawing, done, failed; queued says when no agent is attached), a chip for each image it builds on (`n1 · 01`, the node and the image's number there), the request, and its images. An edge runs from the parent's card, level with the image built on, to that chip. Everything else about a node is in the inspector over the canvas's right side: the full request, the images it builds on and its attachments, the agent's notes, the reviews folded behind Show review, what it was made with, and the references used and left out. A frame from `canvas.json` is a group: dragging it moves its nodes, its menu selects, renames, or ungroups them, and selected nodes are grouped from the inspector or a node's menu; a node is in one group at most. Nodes nobody placed are laid out by lineage: frames one under another, in each the trees first (children to the right of their parent), then single nodes in rows. Dragging a card saves every card's place, so nothing moves under the user afterwards; later nodes go beside their parent or under everything. A click on a card selects its node, a click on an image also picks the image, and Shift adds to both; dragging a selected card moves every selected card; Escape or a click on the background clears. The picked images become the parents of what the composer sends (one picked image is a refine). The page's own images are never dragged out as files. Images dropped on the canvas become upload nodes; dropped on the composer, attachments. An image's menu removes its background (a tool node), adds it to a style's references, or downloads it; a double click opens it large with everything it was made from.

## Page modules

`app.js` owns the shell and routes by hash. A page registers itself with `page(name, module)`; `index.html` loads `app.js` first and the page files after it (`canvas.js`, `style.js`), and the router starts once all are loaded. A module is:

```js
page("style", {
  enter(route) {},        // the route opened this page; #view is empty. Reset the page's own state here.
  async load(route) {},   // right after enter, then every 3 s while no dialog or menu is open. Fetch, compare
                          // with what is shown (signatureOf(value) leaves out the agent's age), and redraw only
                          // what changed, so typing, scrolling, and images are never disturbed.
  leave() {}              // optional: the route is leaving; save what is pending, remove window listeners.
});
```

`route` is `{ name, project, style | thread, params }`, `params` the hash's query. A load answered after the viewer moved on draws nothing: after each await it returns when the route it was given is no longer `route`. A first `load` that throws a 404 or 400 shows "Cannot open this page"; once the page has drawn, such an error keeps the page and shows the error once as a toast. A lost server shows the reconnecting banner. Shared helpers in `app.js`: `api(path, body)` (JSON only; a response with `agent` updates the app bar), `hashes.*` for links, `inProject(project, path)` for a project path's file, `agentAttached()`, `panelHead`, `panelResizer`, `openLightbox`, `nodeImageItem`, `reviewLine`, `blockedReason`, `addToReferences`, `askName`, `confirmDelete`, `when`, `money`.
