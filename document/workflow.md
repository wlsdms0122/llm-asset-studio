# Workflow

How the agent runs a project: making its styles, improving them, and making images with them, on the web studio or in conversation. What a style is and how `style.md` is written is in `writing-styles.md`; working out an image in ideation in `ideation.md`; prompting in `prompting.md`; models in `models.md`; reviewing images in `review.md`.

## The idea

The point is consistent images that fit a purpose. A project holds the purpose (`project.md`) and the styles made for it. A style is two things: its words (`style.md`), which the agent writes, and its references, the material the user chose for it: images, and texts such as a palette or design tokens. A style is never finished: every image shows something to improve, so a style is a source that keeps changing, and every change is a revision, like a commit. Every generation draws with a style at one revision, the latest unless the user chooses another, so a change that came out worse is never forced on anyone, and every image records the revision it was drawn with.

The canvas is where material is made: each request is a node, and what comes out of it, images or a text, can go into a style's references or be what the next request builds on. Everything made in a project is a node, whoever asked for it: the user in the composer, or the agent while talking (a draft, a text). A conversation holds words and points to the nodes it shows, so every image and text is in one place.

The web page and the conversation are two surfaces over the same records. Whatever the user does on one is a record the other reads.

## Projects

A project is one purpose: an app, a blog, a product line (`project.py new <name>`). Its `project.md`, the brief, says what the images are for, where they are seen and at what size, who sees them, the tone, and the decisions that hold for every image in it, in words. The agent reads it before writing any prompt for the project.

The agent writes the brief, the way it writes a style's words; the user tells. A project thread is that conversation (what the user writes under the brief on its page, New thread on the canvas, or `thread.py open projects/<p> project`): the agent asks what the project is for, writes `project.md` in English, and publishes a round that says what it wrote and what is still open. It keeps the brief current: a decision the user makes for the whole project, wherever it was said, goes into `project.md`, never only into one prompt. Values (the colors of an app with their hex codes, design tokens) are material, not the brief: the agent writes them as a text on the canvas (see Generating), says the user can put it into the styles' references, and the brief does not repeat them. A project thread is also where the user works out what to make (see Ideation).

A style lives in one project. To use a style in another project, copy it (`style.py new <project> <name> --from <style>`); the copy starts as its own first revision, says where it came from, and grows on its own from there.

## A style is a source

A style is its files: `style.md` (the style in words), `style.json` (the model in use), `prompting/<model>.md`, and `references/`: images, each with an annotation beside it, and texts (`<n>.md`). The agent writes the words and the prompting; the user chooses the references and the model. Every change to them is a revision:

- The user's own changes (a reference added or removed, the model switched, a revision restored) record a revision at once.
- The agent's edits are recorded with `style.py revise <style> --summary "<what changed>" --reason "<why>" --origin <n12 or t3/004>` when a step is done: the summary and the reason in the user's language, and where the reaction it answers was. Anything left unrecorded is recorded the moment a generation asks for the style, so every image names a real revision.
- Each revision keeps the hash of every file, and the contents stay in the workspace's `objects/`, so any revision can be drawn with, shown (`style.py show --revision N`), or restored (`style.py restore`).

The user does not manage versions: revisions pile up on their own, and choosing one is choosing what to draw with.

## Making a style

A new style opens a style thread with the first question (`style.py new <project> <name>`, or "New style" on the web). The thread is the conversation that finds the style; see Discovering a style.

1. Discover, in the thread: the agent writes `style.md` from the conversation, shows drafts when a picture settles a question faster than words, and asks what changes the image most, recording a revision at each step.
2. When the words hold, the agent picks the model (`models.md`) and writes `style.json`'s model and `prompting/<model>.md`. From then on the style can draw from its words alone (`Style.blocked` says what is missing until then). The agent records the revision and says in the thread that the style is ready to draw on the canvas, with what an image costs.
3. The user draws on the canvas and reacts; the agent improves the style (see Improving a style). Any image the user likes, wherever it is shown, can go into the references, and so can a text (a palette, design tokens) written on the canvas or uploaded. The agent annotates each image and checks the set (see References).

From then on there is no separate stage: the style is used and improved in the same way.

## Discovering a style

The user cannot be asked to name a style; few people outside design can. They can describe what they want, show images they like, and recognize the result. So the agent writes the style from that material, and every image shown during discovery exists to settle a question about the words.

Most people also do not separate a style from a picture. Asked for a style, they describe the image they need ("an icon for my budget app", "a cozy cafe scene"). Part of the agent's work is to keep the difference plain, in the user's words, without lecturing. A style is how every picture made with it is drawn, whatever it shows: the medium (flat vector, watercolor, clay 3D, pixel art), shapes and line, light and shadow, color, surface and texture, detail, and framing. What a picture shows is decided later, for each image. When the user talks about content, the agent says so in a sentence and turns it into style questions ("for a budget app icon, should it look flat and graphic like a road sign, soft and round like a toy, or drawn by hand?").

Talk comes before pictures. While the direction is unclear, at any point in the conversation, the agent keeps talking until there is one: it names a few plain directions the user's words could mean, each with an everyday example and what it would change in the picture, asks which is closer, or asks for an image the user likes. Images are drawn only to test a direction both sides already understand; a picture drawn to find out what the user meant anchors them on whatever came out.

- Each message (on the web, the round's note) describes the style in the user's language and plain words, says what changed, and asks at most two or three questions, the ones that change the image most first. `style.md` holds the same description in full detail.
- Every question about the look names the direction it is on and spells out the options as plain contrasts, each with what it changes in the picture: "hard edges and flat color (clean, reads small) or soft shading with a light source (friendly, more depth)?" Never ask the user for vocabulary or offer a bare style name. After a pick, ask why with two or three plain reasons to choose from; a pick with a reason says far more than a pick alone.
- A note can sit on any candidate, picked or not: a reason for a pick, or what falls short in one the user passed over. Picks and notes are read separately.
- Read every attached image at full resolution and describe what most of them share; what only one has is that image, not the style. Name conflicts as a question. Mark what was inferred, especially material and texture, and ask before relying on it: small or compressed images invent texture.
- Images go out when a question is easier to answer by looking than by reading (how much gloss, which of three renderings of "3D"), or when the user asks to see. A choice the user can make from a sentence (light or dark background) is asked as a sentence.
- Candidates are chosen by the question they answer:
  - A wide question (which of a few directions): images far apart from each other on that question.
  - A narrow question (how much of one property): images that differ in that one property, with everything else the same, where the agent is least sure and the answer matters most.
  - Whether the words hold: one image from the written style alone, next to near misses that each break one rule on purpose. The user choosing the faithful one, for the reason the rule gives, confirms the words.
  - Every candidate is labeled with the style difference it shows (`node.py publish --describe` on its draft), and the note says what to compare, what stays the same across them, and what to ignore (the subject, small defects of the draft model). "1 and 2 differ only in the outline: none, or a thin dark line" lets the user answer about the style, and a pick turns straight into a value in `style.md`; unlabeled pictures invite a pick by subject.
  - All candidates show one plain subject from outside the style's domain (a mug, a chair, a potted plant), or from inside it when the style is scoped to that domain. The subject stays the same while a question is open, so a difference between candidates is a difference in style.
- A style made for a kind of asset (app icons, logos, thumbnails) is judged in use. One plain subject on a plain background settles the rendering, but the user cannot tell from it how the style will feel on real assets. Once the rendering is roughly settled, show it applied: a few made-up uses with different subjects and colors, and a composite of how they sit together where they are seen (icons masked and laid out at home screen sizes). The composite is put together locally and costs nothing.
- Candidates are drafts: generation nodes the agent adds from the thread and draws with the draft model (`node.py add <project> --draft <model> --style <style> --request "<what it tests>" --thread <t>`; `models.md`: free when a free model can show it, otherwise a cheap paid one after the user says yes). A draft draws from the style's words at its revision before the style has a model of its own. Their job is to show which way the style goes, not quality, and the message says what to look at and what to ignore. The round points to the drafts it shows (`thread.py publish <t> --note ... --node n7`), and its candidates are their images in that order, numbered from 1 for picks and notes. The drafts sit on the canvas in a row and are marked as drafts, so any of them can go into the references like any other image.
- Signs the style is pinned down: the important values have stopped changing; the agent can predict the user's pick before showing it; the image from the written style alone was chosen; every section is filled, with what is undecided marked open. Then the agent writes the model's prompting file and says the style is ready to draw. Signs of fatigue (shorter replies, "anything is fine", picks that flip back and forth) mean stopping to summarize or changing the question, not more images. A conversation that goes on without settling is missing a question: ask a broader one or ask for another reference.

## Improving a style

Reactions come from anywhere: a note in a thread, a request on the canvas that keeps asking for the same change, a review that keeps finding the same drift, or what the user writes under the style on its page. The agent sorts every reaction before acting on it:

- About this image only (a wrong count, one odd leaf): it goes into the next prompt, as a new node. The style does not change.
- Something `style.md` already asks for and the model missed: a change to the prompting file.
- Something that should hold for every subject (softer shadows, fewer colors): a change to `style.md`.
- Something the references carry (every reference has a navy background, so every image does): a change to the references or their annotations. Words alone will not move it, and the references are the user's to change, so the agent says which image teaches it and asks.

When unsure, it asks once: "should every image look like this, or just this one?"

The agent makes the change and records it as a revision (`style.py revise <style> --summary ... --reason ... --origin n12`), then says so where the reaction was: the thread round that answers it, or the next node's note. When the change fights something, the reason says so: above all a property every image reference shares that the words now contradict, since the references will win. Nothing waits to be accepted. The user keeps drawing with whichever revision they choose; a change that came out worse costs nothing, since the earlier revision is still there to draw with, and restoring it (`style.py restore`) makes the next changes build on it. To see a change on real requests, the user redraws a node's request with the new revision, a new node next to the old one.

## References

The references are the material the user chose for the style: images, which show how it is drawn, and texts, which hold what it keeps to in words and values.

An image reference has a role, which decides what the model is told to take and to ignore:

| role | takes | ignores | lives in |
|---|---|---|---|
| style reference | how it is drawn: medium, light, texture, line, detail | its subject, its color layout, its composition | the style's `references/`, chosen by the user |
| subject reference | the shape of one subject: a mascot, a logo's form, a product silhouette | how it is drawn | an image the request builds on or attaches |
| composition reference | layout, pose, viewpoint, crop | its subject and how it is drawn | attached to a request |

A text reference (`references/<n>.md`) is what the style keeps to that is written rather than drawn: a palette with hex values, design tokens, the rules of a brand. The agent reads every text reference before writing a prompt and follows its values as given; where `style.md` and a text disagree, the text wins, as the images do. `style.md` does not copy a text's values; it says how values like them are used ("one color per main part, the background light or dark").

- **Annotations.** Every image reference gets an annotation when it comes in (`style.py annotate <image> --role ... --shows ... --take ... --ignore ...`): what it shows (subject and colors included), what to take, what to ignore. Each generation names the attached references from their annotations. A prompting file never lists references by name; the set changes, the annotations travel with the images. `watch` hands over a style whose image references lack annotations.
- **The set.** Style models are usually trained on many images that share a style; the prompt-level equivalent is the set of image references. With one or two references a model copies them; with several it keeps what they share. Four to eight is the aim when the model takes them at no extra cost. What the references share is what the model learns, so everything that should not be learned (subject, color scheme, layout, background, angle) varies across them; two cream references made every result cream. Only clean examples: a reference with a defect teaches the defect. After every change to the set the agent checks what the image references share besides the style and records it (`style.py set-check <style> --shared "<what they share>"`, nothing when the set is varied); the style page shows it, and a shared property is a reason to suggest varying the set. `watch` hands over a set changed since its check.
- **A reference is the style's own.** Putting an image or a text into the references copies it into the style, and that is a change to the style, recorded as a revision; uploading one on the style page is the same act. From then on the reference and the node it came from are separate: deleting the node from the canvas leaves the style as it is, and only removing the reference changes it. What is connected to one request (the images and texts it builds on, the images attached to it) belongs to that request, not to the style.
- **Only the user puts material in.** The agent may suggest a reference (a new subject that came out right, a text it wrote on the canvas) and may suggest removing one, but adding one is the user's act, so what the model learns stays what the user recognized as the style.
- **Choosing per generation.** Every text reference is read. Not every image reference goes with every generation: the agent leaves out an image that shows nearly the same subject as the request (its pose and size come through however the prompt measures them) and attaches the rest, at least three when the style has them, style references first, then subject and composition references with the property each is for named. What was left out and why is recorded on the node (`node.py publish --drop 03.jpg="same subject as the request"`). How a model is told the roles is in the style's prompting file (see Prompting per model).
- **Leakage.** Review has a fourth check: what came over from an image reference that the request did not ask for (its subject, its color layout, its composition). A leak is recorded as the image's verdict (`review.md`), and repeated leaks from one reference are a reason to suggest removing it or to rewrite its annotation.

## Prompting per model

`prompting/<model>.md` (the model id with `/` written as `--`) holds what one model needs to draw this style:

- The call: aspect ratio, resolution, quality, how many images a call, and which options the model ignores.
- How references are attached and named for this model, by role: a model with a separate style channel gets style references there; a model that reads images by number gets "Image 1 is a style reference: take its rendering, not its subject"; a model that reads images by what they show gets the annotation's words.
- A fixed style paragraph drawn from `style.md`, used word for word in every prompt, since synonyms drift. It is drawn again whenever `style.md` changes.
- The prompt order and length for this model, and how the Subject line is written from a request.
- Wording that held the style on this model and wording that broke it.

What is true of a model in general goes into `models.md`, and what is true of prompting in general into `prompting.md`; a style's prompting file holds only what is particular to that style on that model.

A style has one prompting file per model it can draw with, and `style.json` names the one in use; the user switches between them on the style page. When the user asks for a model (in a thread, or from the style page, which opens a thread with the request), the agent reads what the model accepts and how it reads prompts, writes its prompting file from `style.md` and the current model's file, and records the revision; switching to it is the user's choice, or the agent's when the user asks for that. The same request drawn once with each model, side by side on the canvas, is the comparison. Only models that take as many references as the style has images are offered.

## Generating

The canvas is where material is made. A generation node is one request: drawn with a style at a revision, or written as a text. The user writes it in the composer with no image or text picked (something new), or with some picked on the canvas (they become the node's parents; one picked image is a refine of it). Next to the composer's style is its revision, the latest unless the user chooses an earlier one; choosing Text instead of a style asks the agent for a text. In conversation the agent adds the node for the user (`node.py add <project> --style S [--revision N] --request "<the user's words>" [--parent <image or text>]`, or without `--style` for a text).

For each generation node `watch` hands over that is drawn with a style, the agent:

1. Reads the request, the parents and attachments, `project.md`, and the style at the node's revision (`style.py materialize <style> <dir> --revision N` writes it into a folder: `style.md`, the prompting files, and the references, texts included), and the nodes it builds on for what came before; nothing depends on remembering another conversation.
2. Chooses the references (see References) and writes the prompt from `style.md`, the text references, and the prompting file, with `prompting.md` underneath. A request is never pasted into a template.
3. Draws (`generate.py <node> --ref <dir>/references/01.png ... --request "<the request>" --prompt-file <file>`), reviews every image with `review.md`, and publishes the node with a note in the user's language, a line per image, a review per image, and the references it left out (`node.py publish <node> --note ... --describe ... --review ... --drop ...`).

A node with no style is a text the agent writes: a palette, design tokens, the rules a set of images keeps to. It reads the request, the parents, and `project.md`, writes the text in markdown, and publishes it (`node.py publish <node> --text <file> --note "<what it wrote>"`). A text is material, written to be used as it is: exact values (hex colors, sizes, counts), in the user's language unless it is for a model, with nothing about how it was made. The user puts it into a style's references, or picks it for the next request to build on.

Refining rewrites the parent's prompt with the user's change. Whether to also attach the parent is the agent's call: the references carry the style, so the parent goes along only when its composition has to survive, as a composition reference. A text the request builds on is read like a text reference, for that request only. Images the user attaches to a request describe that request (a pose, an object); the agent decides each one's role and names it.

Work on a finished image that needs no drawing goes through a tool instead of the model, on this computer and at no cost. Removing the background (cutout, macOS Vision) is a tool node: the user asks for it on an image, the server runs it at once and the node holds the transparent PNG; in conversation `node.py add <project> --tool cutout --parent <image>`. Prefer it to asking a model for a transparent background when the image already exists.

Requests that keep asking for the same change are not about one image; the agent sorts them as in Improving a style and changes the style. Every node keeps its images or its text, the style revision and model it was drawn with, the references used and left out, every call with its prompt and cost, so redrawing a node's request with another revision is a new node with the same request.

## Ideation

For a user who does not know yet what the image should be, a project thread works it out in conversation. The agent works as the designer with the user as the client: it analyzes the need, proposes ideas with reasons, recommends one, and develops the pick. Ideas are drafts on the canvas, drawn with the draft model, and the image's brief is a text node the agent writes and rewrites as the image takes shape (`node.py add <project> --request "<the brief of the image>" --thread <t>`, a new node whose parent is the last one each time it changes). When the image is concrete the agent proposes drawing it with a style; on the user's go (picking the brief and asking in the composer, or saying so in the thread) a generation node with the brief as its parent draws it like any other. The conversation goes on beside it: a fix about the idea is a new brief, a fix about the drawn image is a refine on the canvas. How the designer works and what the brief holds are in `ideation.md`.

## Surfaces

- Web: `open-package studio` serves the studio (`source/web/`) on `127.0.0.1:8770`. The home lists the projects. A project opens on its canvas: a card per node with its request and images, an edge from each parent's card to the node built on it, groups (frames) that move their nodes together, and the composer; beside it the brief, the styles, and the threads. A card shows what was asked and what came out, images or a text; selecting a node opens its inspector with how it was made: the images and texts it builds on, the agent's notes, the model and the style at its revision, the references used and left out, and the prompt. Reviews are the agent's own check and are not shown; what follows from them reaches the user as a redraw or a change to the style. The brief and each style have a page with the document and a box under it, where what the user writes opens a thread. A style's page shows the model it draws with and its latest revision, and tabs for its rules, its references (images with their annotations and the set check, and texts), and its history: every revision with what changed, why, where the reaction was, and the images drawn with it. A thread's page is the conversation: the agent's messages with the images and texts of the nodes they show, and the user's replies; an image the user attaches is an upload node of the thread. On the canvas a draft is marked as one, and a node made in a thread names it. Pages poll, so an open tab follows the records. The app bar shows whether an agent is attached (an agent looked for work in the last ten minutes).
- Conversation: the agent sends a numbered sheet (`sheet.py <thread | node>`), records the user's reply with `thread.py answer` (an image the user sends is added first with `node.py add --upload --thread`, and the answer names it with `--node`), and adds nodes with `node.py add`.

The server writes only records: projects, styles and the user's own changes to them (references, models, restoring a revision), nodes asked for (a tool node it runs itself), the canvas layout, threads and answers. What is written in words (the brief, a style's rules and prompting, a text a node asks for) the agent writes. Generation always goes through the agent.

## Working on the web

The web studio is the default surface. When the user starts, the agent starts `open-package studio`, gives its address, and works there until the user ends. The conversation surface is used when the user asks for it, or when the agent cannot keep a command running in the background; the agent says which surface it is using and why.

On the web, what the agent publishes is its message. Everything the user is meant to read or answer goes into it: a thread round's note and the lines of the nodes it shows, a node's note and image lines, a revision's summary and reason. A user looking at the studio does not read the conversation, so the conversation gets one line saying what is up and where, and nothing the user has to answer:

- Asking for the yes to a paid draft model, or a question before any image can be drawn, is a thread round with the question as its note and no nodes.
- Proposing the next step (drawing from the brief, trying a new revision on the canvas, a reference to add) goes in the round or node that shows why.
- When the user writes in the conversation while the studio is in use, the agent records it where it belongs (`thread.py answer`, `node.py add`) and answers there, so the page keeps the whole record. Questions that belong to no thread or node (which projects there are, what a model costs) are answered in the conversation.

The agent waits with `open-package watch`, run in the background. It returns as soon as there is work and prints the folder of each place that has some:

- `projects/<p>/threads/<id>`: the user answered the thread's last round. Read it (`thread.py show`), do the work, publish the next round.
- `projects/<p>/nodes/<id>`: a generation waits. Draw it, or write its text, and publish the node.
- `projects/<p>/styles/<s>`: an image reference has no annotation, or the set of image references changed since its check. Annotate, check the set, and say what the check found in the style's thread if it found something.

Then it runs `watch` again, for as long as the studio is open. `watch` reads the records rather than changes, so work that came in while the agent was busy is printed by the next run, and work already waiting is printed at once. Every look is recorded in `agent.json`, which is how the page knows an agent is attached. Something the user deleted or renamed needs nothing from the agent.

## Usage

Commands run as `open-package <command>` inside the workspace (`~/.config/asset-studio`, or `ASSET_STUDIO_HOME`). Paths are given relative to the workspace.

```
# studio, left running, and the agent's wait for work, run again after each piece of work
open-package studio
open-package watch

# a project and a style; a new style prints its folder and its thread
open-package project new <project>
open-package style new <project> <style>              # --from <style> to copy another project's style
P=projects/<project>; S=$P/styles/<style>; T=$P/threads/<id>

# the draft model (models.md): a free one, else the first listed candidate, after the user's yes
open-package models --free
D=<draft model id>

# a thread round: after editing $S/style.md, a draft on the canvas, then the round that shows it
N=$(open-package node add <project> --draft $D --style <style> --request "<what the draft tests>" --thread <id>)
open-package generate $N --prompt-file /tmp/1.md
open-package generate $N --prompt-file /tmp/2.md
open-package node publish $N --note "<what to compare>" --describe "<reading 1>" --describe "<reading 2>"
open-package thread publish $T --note "<the style in plain words, what changed, the questions>" --node "$(basename $N)"
open-package style revise $S --summary "<what changed>" --reason "<why, in the user's words>" --origin t3/002

# references: annotate each image, then check the set
open-package style annotate $S/references/01.png --role style --shows "<what it shows>" --take "<what to take>" --ignore "<what to leave>"
open-package style set-check $S --shared "<what every image reference shares besides the style>"

# a generation node: the user adds it on the canvas; in conversation the agent adds it
N=$(open-package node add <project> --style <style> --request "<the user's words>" --parent $P/nodes/n3/<image>)
open-package style materialize $S /tmp/n4 --revision "<the node's revision>"
open-package generate $N --ref style=/tmp/n4/references/01.png --ref style=/tmp/n4/references/04.png --ref composition=$P/nodes/n3/<image> \
  --request "<the user's words>" --prompt-file /tmp/prompt.md
open-package node publish $N --note "<what was drawn>" --describe "..." --review "<verdict>" --drop "03.jpg=<why it was left out>"
open-package node add <project> --tool cutout --parent $P/nodes/n3/<image>

# a text node: a request with no style; the agent writes it
N=$(open-package node add <project> --request "<the user's words>")
open-package node publish $N --text /tmp/palette.md --note "<what it wrote>"

# a project thread: the brief, or working out what to make, with drafts and texts made as nodes of the thread
open-package thread open $P project --message "<the user's first words>"

# the user's own changes, asked in conversation
open-package style reference-add $S <image or text>
open-package style reference-remove $S 03.jpg
open-package style use $S <model id>
open-package style model-remove $S <model id>
open-package style restore $S <revision>
open-package style rename $S <new name>
open-package thread rename $T "<the name the user gave>"

# reading a style, as it is or at a revision
open-package style show $S --revision 3

# conversation surface
open-package sheet $T                                 # also a node
open-package thread answer $T --comment "layers should look thicker"
open-package thread answer $T --picked 2 --note "2=the shadow is softer" --note "3=too dark" --comment "closest"
U=$(open-package node add <project> --upload liked.png --thread <id>)   # an image the user sent
open-package thread answer $T --comment "like this one" --node "$(basename $U)"
open-package thread show $T
open-package node show $N
```

`generate.py` writes into the node, with the draft model for a draft and the model of the node's style at its revision otherwise, and records each call beside the images in `calls.jsonl`: the model, the revision, the request, the prompt, the references with their roles, the options, the cost. `--dry-run` prints the request body without sending it. Options a model does not accept are dropped and reported; what a model accepts is read from OpenRouter and cached in the workspace's `cache/` for a day.
