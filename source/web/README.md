# Studio design system

The web studio is built from one set of tokens and components so every screen behaves the same. `ui.css` holds the tokens and the component styles, `ui.js` builds the components, and `app.css` / `app.js` only place them on pages. A page never styles a control by hand: if a screen needs something the components do not cover, the component is added here first.

## Principles

- Icons come from Lucide (lucide.dev, ISC license); copy a new one's paths into `ICONS` in `ui.js`, on its 24 by 24 grid.
- The chrome is neutral (grays, one blue accent) so the images' own colors read true.
- In a session, what the user writes is sent from the composer docked under the stage, as in a chat app; its send button is the one primary action. The panel's buttons move between stages (`success`) or are secondary. Outside a session, a panel has one primary action at its bottom right.
- Actions on an image are icons over the image, shown on hover (`tool`). Actions on a page are labeled buttons.
- Labels are short nouns or verbs. A title line says what to do; help text appears only where something can go wrong.
- Every text on screen is written in English through `t()` (or `tn()` when it counts something), and `i18n.js` gives its Korean. The shell's fixed words carry `data-t` or `data-t-title`. The viewer picks the language in the app bar and the choice stays in that browser. `verify` fails on a text without its Korean.
- An image is shown either at its own ratio (`imageFrame` natural: boards, candidates, the lightbox) or cropped to a square cell (`imageFrame` fill: grids of many images, cards). Grids always use square cells so rows line up.
- Adding an image to a style's references is a one-way action available wherever the image is shown; whether an image is a reference is not a property of the image. References are removed only from the reference list.

## Tokens (`ui.css` `:root`)

| group | tokens |
|---|---|
| color | `--bg`, `--surface`, `--surface-sunken`, `--canvas` (behind images), `--fg`, `--fg-muted`, `--fg-faint`, `--line`, `--line-strong`, `--accent` (+ `-hover`, `-ink`, `-soft`), `--success` (+ `-soft`), `--danger` (+ `-soft`), `--overlay` and `--overlay-ink` (controls over images) |
| space | `--space-1` 4px, `-2` 8, `-3` 12, `-4` 16, `-5` 20, `-6` 24, `-8` 32 |
| text | `--text-xs` 12px, `-sm` 13, `-md` 14, `-base` 15, `-lg` 17, `-xl` 20, `-2xl` 26 |
| shape | `--radius-sm` 8px, `-md` 12, `-lg` 16; `--control` 40px and `--control-sm` 32px heights |
| depth | `--shadow-sm`, `-md`, `-lg` |

Dark mode redefines the color tokens only.

## Components (`ui.js`)

| component | use for |
|---|---|
| `button(label, { variant, small, grow, iconName })` | page and panel actions; variant `primary` (one per screen), `success` (moving a stage forward: 샘플, 확정, 추가), `danger` (deleting), `ghost`, or none |
| `iconButton(icon, title, onClick)` | a panel action with a well-known icon (attach, new) |
| `composer({ value, placeholder, sendTitle, onInput, onSend, attach, attachments })` | the message box docked under a conversation or a board: attachments above the text, attach before it, send after it; grows with the text, Cmd+Enter sends, `node.send` is the send button |
| `uploadButton(title, onFiles)` | picking image files |
| `tool(icon, title, onClick, { href, download, on, quiet })` | actions over an image or a list row |
| `pill(text, { tone, dot, small })` | status: `accent` for in progress or my turn, `success` for confirmed |
| `chip(text, { on })` | filters |
| `dropdown({ value, options, onChange })` | choosing one of a few values in place, inside a line of other content |
| `rowList(rows)`, `listRow({ title, detail, aside, onClick, current })` | a list of things to open, choose, or delete (a style's models, its sessions); the action on a row is a quiet `tool` shown on hover |
| `openMenu(at, items)` | a context menu or a dropdown's list |
| `ask({ title, input, choices, danger })` | every dialog: a name, a note, a confirmation, or picking one of a list |
| `toast(message, kind)` | the result of an action |
| `field(label, value, { strong, mono, grows })` | a labeled piece of information (request, memo, prompt) |
| `sectionTitle(title, aside)` | the heading of a block on the stage or in a panel |
| `emptyState({ title, text, action })` | a list with nothing in it yet |
| `workingNote(text)` | the agent is working |
| `imageFrame(path, { fit, number, check, tools, onClick })` | every image larger than a thumbnail |
| `thumb(path, { picked, small, remove })` | small images in a row (attachments, references in a session, picks in a reply) |
