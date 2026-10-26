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
- Reviews are the agent's record and are not shown. A document the agent writes (the brief, a style) is read on its page, and what to change is written in the box under it.
- Adding an image or a text to a style's references is a one-way action available wherever it is shown; whether it is a reference is not a property of the image or the text. References are removed only from the reference list.

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
| `linkButton(label, href, { variant, small, iconName })` | going to another page from inside content: a node on the canvas |
| `composer({ value, placeholder, sendTitle, onInput, onSend, attach, tools })` | the message box docked under a conversation or the canvas, kept for as long as what it answers: images on top, the text, and a bar with attach on the left, `tools` after it (the style and revision `dropdown`s, a `.composer-note` saying what send does), and send on the right; grows smoothly with the text, Cmd+Enter sends, `node.send` is the send button, `node.input` the text box, `node.setImages([{ key, node }])` shows what goes with the message (picked images and texts, then attachments) |
| `uploadButton(title, onFiles, { accept })` | picking files: images, or `MATERIAL_FILES` for images and texts |
| `tool(icon, title, onClick, { href, download, on, quiet })` | actions over an image or a list row |
| `pill(text, { tone, dot, small, title })` | status or a mark (Draft): `accent` for in progress or my turn, `success` for done or attached, `danger` for failed; a `live` dot while something runs |
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
| `notice(text, { tone, items, action })` | a message that stays while something holds (a style that cannot draw, what the image references share); tone `warning` for what is behind or fights |
| `tabBar({ items, value, onChange })` | switching what a page shows in place, such as the style page's sections |
| `markdownView(text, { isOpen, onToggle })`, `diffView(text)` | a markdown document with collapsible `##` sections; a unified diff with added and removed lines colored |
| `thumb(path, { picked, small, remove, badge, src })` | small images in a row (attachments, picks in a reply or in the composer with their number or node as the badge, the references a node used with their role); `src` for a file not uploaded yet |

## Screens

| route | file | what it shows |
|---|---|---|
| `#/` | `app.js` | the projects as cards: cover, name, purpose, styles, how many items wait for the agent; right-click to rename or delete |
| `#/p/<project>` | `canvas.js` | the project canvas (below), the panel (what the project is for, linking to the brief; styles with why one cannot draw and their latest revision; New style; threads and New thread, which opens a project thread), the inspector, and the composer. `?node=<id>` brings a node into view |
| `#/p/<project>/brief` | `app.js` | the brief, its threads, and the box under it that opens a project thread with what the user writes |
| `#/p/<project>/s/<style>` | `style.js` | the style page: header (the model it draws with and Add model, the latest revision), why it cannot draw, then tabs for rules, references (images with annotations and the set check, texts, Upload and Write a text), and history (each revision with what changed, why, where the reaction was, the images drawn with it, and Restore); the box under it opens a style thread. `?tab=<name>` opens a tab, `?revision=<n>` the history with that revision open |
| `#/p/<project>/t/<thread>` | `app.js` | a thread: rounds of the agent's note with the images and texts of the nodes it shows, each linked on the canvas, and the user's replies with the nodes they sent; the composer answers the open round (picks, notes, reply, images, each made an upload node of the thread when attached). The panel shows style.md as the latest round showed it, or the project's brief |
| `#/archive` | `app.js` | every node image grouped by project; select several to download as a zip |

The canvas pans by dragging the background, scrolling, or holding Space; Cmd or Ctrl with the wheel (or a pinch) zooms about the pointer. A pan or a zoom changes only the world's transform, the dot grid (its spacing doubles as the canvas zooms out, so the dots stay at least 12px apart), and the frame titles; while the view moves the world is one layer, drawn again at the new scale once it rests. Each node is a card with what it was asked and what came out: kind, style at its revision (a link to that revision in the style's history), Draft on a draft, the thread it was made in (a link), a status pill (queued, drawing, done, failed; queued says when no agent is attached), a chip for each image or text it builds on (`n1 · 01`, the node and the image's number there), the request, and its images or the start of its text, faded out. An edge runs from the parent's card, level with the image or text built on, to that chip. A selected card shows its whole request. How a node was made is in the inspector over the canvas's right side: what it builds on and its attachments, the agent's notes, a text whole with Add to references and Download, the model and the style at its revision with the references used and left out, and the prompt, folded. A frame from `canvas.json` is a group: dragging it moves its nodes, its menu selects, renames, or ungroups them, and selected nodes are grouped from the inspector or with Cmd or Ctrl+G; a node is in one group at most. A dragged card snaps to the left edges, centers, and right edges (and tops, middles, and bottoms) of the cards around it, with a line where it lines up; holding Cmd while dragging places it freely. Nodes nobody placed are laid out by lineage: frames one under another, in each the trees first (children to the right of their parent), then single nodes in rows. Dragging a card saves every card's place, so nothing moves under the user afterwards; later nodes go beside their parent, or beside the last node of their thread, so a round's drafts sit in a row, or under everything. A click on a card selects its node, a click on an image or a text also picks it, and Shift adds to both; dragging a selected card moves every selected card; Escape or a click on the background clears. The picked images and texts become the parents of what the composer sends (one picked image is a refine). The composer's style dropdown ends with Text, which asks the agent for a text instead of an image; next to a style with more than one revision, a second dropdown chooses the revision to draw with, the latest unless one is chosen. The page's own images are never dragged out as files. Images and texts dropped on the canvas become upload nodes; images dropped on the composer, attachments. An image's menu removes its background (a tool node), adds it to a style's references, or downloads it; a double click opens it large with everything it was made from. A text node's menu adds it to a style's references or downloads it.

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

`route` is `{ name, project, style | thread, params }` (the brief's route has neither style nor thread), `params` the hash's query. A load answered after the viewer moved on draws nothing: after each await it returns when the route it was given is no longer `route`. A first `load` that throws a 404 or 400 shows "Cannot open this page"; once the page has drawn, such an error keeps the page and shows the error once as a toast. A lost server shows the reconnecting banner. Shared helpers in `app.js`: `api(path, body)` (JSON only; a response with `agent` updates the app bar), `hashes.*` for links, `inProject(project, path)` for a project path's file, `agentAttached()`, `panelHead`, `panelResizer`, `openLightbox`, `nodeImageItem`, `talkComposer` (the box under a document the agent writes), `blockedReason`, `addToReferences`, `askName`, `confirmDelete`, `when`, `money`.
