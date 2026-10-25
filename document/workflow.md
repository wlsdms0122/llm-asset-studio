# Workflow

How the agent runs a project: making its styles, improving them, and making images with them, on the web studio or in conversation. What a style is and how `style.md` is written is in `writing-styles.md`; working out an image in ideation in `ideation.md`; prompting in `prompting.md`; models in `models.md`; reviewing images in `review.md`.

## The idea

The point is consistent images that fit a purpose. A project holds the purpose (`project.md`) and the styles made for it. A style is never finished: every image shows something to improve, so a style is a source that keeps changing, and every change is a revision. Changes are tried on the style's probes, a fixed set of test requests, before and after, the way a UI change is checked against its snapshot tests. Every image records the style revision it was drawn with, so what made an old image is always known.

The web page and the conversation are two surfaces over the same records. Whatever the user does on one is a record the other reads.

## Projects

A project is one purpose: an app, a blog, a product line (`project.py new <name>`). Its `project.md`, the brief, says what the images are for, where they are seen and at what size, who sees them, the brand's colors and tone, and the decisions that hold for every image in it. The agent reads it before writing any prompt for the project.

The agent writes the brief, the way it writes a style's words; the user tells. A project thread is that conversation ("Write in conversation" or "Change in conversation" beside the brief, or `thread.py open projects/<p> project`): the agent asks what the project is for, writes `project.md` in English, and publishes a round that says what it wrote and what is still open. It keeps the brief current: a decision the user makes for the whole project (the colors of an app), wherever it was said, goes into `project.md` or into a guide (see Extends and guides), never only into one prompt.

A style lives in one project. To use a style in another project, copy it (`style.py new <project> <name> --from <style>`); the copy starts as its own first revision and says where it came from. Styles that should improve together live in one project and extend the same base.

## A style is a source

A style is its files: `style.md` (the style in words), `style.json` (the model in use, the styles it extends, whether it is a guide), `probes.md`, `prompting/<model>.md`, and `references/` with an annotation beside each image. Every change to them is a revision:

- The user's own changes (an edit on the style page, a reference added or removed, the model switched, extends changed, a revision restored, a proposal accepted) record a revision at once.
- The agent's edits are recorded with `style.py revise <style> --summary "<what changed>"` when a step is done. Anything left unrecorded is recorded the moment the style draws, so every image names a real revision.
- Each revision keeps the hash of every file, and the contents stay in the workspace's `objects/`, so any revision can be shown (`style.py effective --revision N`) or restored (`style.py restore`).

The user never manages versions. Revisions pile up on their own, like commits.

## Making a style

A new style opens a style thread with the first question (`style.py new <project> <name>`, or "New style" on the web). The thread is the conversation that finds the style; see Discovering a style.

1. Discover, in the thread: the agent writes `style.md` from the conversation, shows draft candidates when a picture settles a question faster than words, and asks what changes the image most.
2. When the words hold, the agent picks the model (`models.md`), writes `style.json`'s model and `prompting/<model>.md`, and writes `probes.md`: six to eight requests that cover the style's range, at least half of them subjects the conversation never showed (see Probes). It records the revision and says in the thread that the style is ready to try, with what a probe run costs.
3. The user runs the probes (the style page's "Run probes", or asks in the thread; `probe.py request <style>`). With no references yet, the run draws from the words alone, the way sample images did. The user may add requests of their own to a run. Reactions go back into the thread, and the agent keeps fixing `style.md` and the prompting file and asks for another run when it helps.
4. The user picks references from the probe images (any image can be added to the references wherever it is shown). From the first style reference on, the style can draw (`Style.blocked` says what is missing until then). The agent annotates each reference and checks the set (see References).

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
  - Every candidate is labeled with the style difference it shows (`thread.py publish --describe`), and the note says what to compare, what stays the same across them, and what to ignore (the subject, small defects of the draft model). "1 and 2 differ only in the outline: none, or a thin dark line" lets the user answer about the style, and a pick turns straight into a value in `style.md`; unlabeled pictures invite a pick by subject.
  - All candidates show one plain subject from outside the style's domain (a mug, a chair, a potted plant), or from inside it when the style is scoped to that domain. The subject stays the same while a question is open, so a difference between candidates is a difference in style.
- A style made for a kind of asset (app icons, logos, thumbnails) is judged in use. One plain subject on a plain background settles the rendering, but the user cannot tell from it how the style will feel on real assets. Once the rendering is roughly settled, show it applied: a few made-up uses with different subjects and colors, and a composite of how they sit together where they are seen (icons masked and laid out at home screen sizes). The composite is put together locally and costs nothing.
- Candidate images come from the draft model (`models.md`: free when a free model can show it, otherwise a cheap paid one after the user says yes). Their job is to show which way the style goes, not quality, and the message says what to look at and what to ignore.
- Signs the style is pinned down: the important values have stopped changing; the agent can predict the user's pick before showing it; the image from the written style alone was chosen; every section is filled, with what is undecided marked open. Then the agent writes the probes and proposes a run. Signs of fatigue (shorter replies, "anything is fine", picks that flip back and forth) mean stopping to summarize or changing the question, not more images. A conversation that goes on without settling is missing a question: ask a broader one or ask for another reference.

## Improving a style

Reactions come from anywhere: a note in a thread, a request on the canvas that keeps asking for the same change, a review that keeps finding the same drift, or the user editing a rule on the style page. The agent sorts every reaction before acting on it:

- About this image only (a wrong count, one odd leaf): it goes into the next prompt, as a new node. The style does not change.
- Something `style.md` already asks for and the model missed: a change to the prompting file.
- Something that should hold for every subject (softer shadows, fewer colors): a change to `style.md`.
- Something the references carry (every reference has a navy background, so every image does): a change to the references or their annotations. Words alone will not move it.

When unsure, it asks once: "should every image look like this, or just this one?"

Once a style has references, a change to it goes to the user as a proposal, not as an edit (`proposal.py propose`). A proposal is a diff against the current revision, rule by rule: the summary and the reason in the user's language, where the reaction came from (`--source n12` or a thread round), and the files it changes (`--set style.md=<file>`, `--set references/07.png=<image>`, `--remove references/03.jpg`). When the change fights something, it says so (`--conflict`): above all a property every reference shares that the words now contradict, since the references will win. The agent points to the proposal from the thread round that answers the reaction (`thread.py publish --proposal p3`).

The user tries it: "Run probes" on the proposal draws the probes with the proposed style (`probe.py request <style> --proposal p3`), shown next to the current revision's run, request by request. The run's cost is shown before it starts. Accepting makes the proposal the next revision; rejecting keeps it on record. A proposal is accepted only while the files it changes are as they were when it was written; otherwise the agent writes it again on the current revision.

While a style has no references yet (it is being made), the agent edits its files directly in the thread and records revisions; there is nothing to protect yet.

## Probes

`probes.md` holds the style's probe requests, one `- ` line each. They are the style's snapshot tests, chosen once and changed rarely, so runs stay comparable:

- Six to eight requests across the style's range: its main use (an app icon of a plain object), a subject from each kind the Subjects section covers (a person, an animal, a place), and at least half that no reference shows, since those test the words rather than the references.
- One request that breaks the style easily (a subject with its own strong look: metal, glass, a building) and one at the edge of the domain the style is scoped to.
- Plain requests in the user's language or English, each a real request a user would make.

A run draws one image per request with the run's revision or proposal, the references chosen per request as in generating, and is published in request order (`probe.py publish <run> <files...>`) with a note on what changed against the run it is compared with and a review per image. Probes are stale when the style changed after its last run (a new revision, or a base it extends changed); the style page says so.

## References

A reference is an image, its role, and what a generation takes from it. The role decides what the model is told to take and to ignore:

| role | takes | ignores | lives in |
|---|---|---|---|
| style reference | how it is drawn: medium, light, texture, line, detail | its subject, its color layout, its composition | the style's `references/`, curated by the user |
| subject reference | the shape of one subject: a mascot, a logo's form, a product silhouette | how it is drawn | an image the request builds on or attaches |
| composition reference | layout, pose, viewpoint, crop | its subject and how it is drawn | attached to a request |
| guide reference | only what its guide covers (a palette swatch gives colors) | everything else | a guide's `references/` |

- **Annotations.** Every reference gets an annotation when it comes in (`style.py annotate <image> --role ... --shows ... --take ... --ignore ...`): what it shows (subject and colors included), what to take, what to ignore. Each generation names the attached references from their annotations. A prompting file never lists references by name; the set changes, the annotations travel with the images. `watch` hands over a style whose references lack annotations.
- **The set.** Style models are usually trained on many images that share a style; the prompt-level equivalent is the reference set. With one or two references a model copies them; with several it keeps what they share. Four to eight is the aim when the model takes them at no extra cost. What the references share is what the model learns, so everything that should not be learned (subject, color scheme, layout, background, angle) varies across them; two cream references made every result cream. Only clean examples: a reference with a defect teaches the defect. After every change to the set the agent checks what the style references share besides the style and records it (`style.py set-check <style> --shared "<what they share>"`, nothing when the set is varied); the style page shows it, and a shared property is a reason to suggest varying the set. `watch` hands over a set changed since its check.
- **Only the user puts images in.** The agent may suggest a reference (a new subject that came out right) and may propose removing one, but adding one is the user's act, so what the model learns stays what the user recognized as the style.
- **Choosing per generation.** Not every style reference goes with every generation. The agent leaves out a reference that shows nearly the same subject as the request (its pose and size come through however the prompt measures them) and attaches the rest, at least three when the style has them, style references first, then subject and composition references with the property each is for named. What was left out and why is recorded on the node (`node.py publish --drop 03.jpg="same subject as the request"`). How a model is told the roles is in the style's prompting file (see Prompting per model).
- **Leakage.** Review has a fourth check: what came over from a reference that the request did not ask for (its subject, its color layout, its composition). A leak is recorded as the image's verdict (`review.md`), the style page shows each style's leak count, and repeated leaks from one reference are a reason to propose removing it or rewriting its annotation.

## Extends and guides

A style can build on other styles of the same project (`style.json` `extends`, set with `style.py extends` or on the style page). It is drawn as its effective style: the sections of every style it extends, in order, then its own; a later section replaces an earlier one of the same name, except Never and Checks, which add up. It draws with its own style references when it has any, else with the last base's that has them, and always with the guide references of every guide in its chain. Its model and its prompting files are its own, since prompting translates the effective style.

A **guide** is a style that only lends sections: a palette (Color and value, colors by hex and name), a design system (Color, Shape, Line, a part of Composition), a brand's tone (Mood, Subjects). It never draws and has no probes; the styles that extend it are drawn and probed instead. Example: in a `deckit` project, `deckit-icon` extends `app-icon` (how icons are drawn) and `deckit-palette` (the app's three colors). Improving `app-icon` improves every icon style built on it; the app's colors change in one place.

When a base or a guide changes, every style that extends it is marked: its probes are stale, and its prompting files may need their fixed style paragraph drawn again from the new effective style. The agent reads the effective style with `style.py effective <style>`, and `style.py materialize <style> <dir>` writes the effective style, its prompting files, and the references it draws with into a folder for reading (also `--proposal` and `--revision`).

## Prompting per model

`prompting/<model>.md` (the model id with `/` written as `--`) holds what one model needs to draw this style:

- The call: aspect ratio, resolution, quality, how many images a call, and which options the model ignores.
- How references are attached and named for this model, by role: a model with a separate style channel gets style references there; a model that reads images by number gets "Image 1 is a style reference: take its rendering, not its subject"; a model that reads images by what they show gets the annotation's words.
- A fixed style paragraph drawn from the effective `style.md`, used word for word in every prompt, since synonyms drift. It is drawn again whenever the effective style changes.
- The prompt order and length for this model, and how the Subject line is written from a request.
- Wording that held the style on this model and wording that broke it.

What is true of a model in general goes into `models.md`, and what is true of prompting in general into `prompting.md`; a style's prompting file holds only what is particular to that style on that model.

A style has one prompting file per model it can draw with, and `style.json` names the one in use; the user switches between them on the style page. Adding a model is a proposal: when the user asks for one (in a thread, or from the style page, which opens a thread with the request), the agent reads what the model accepts and how it reads prompts, writes its prompting file from the effective style and the current model's file, and proposes adding the file and making it the model in use. The probe run on that proposal is the comparison between the two models. Only models that take as many references as the style draws with are offered.

## Generating

The canvas is where images are made. A generation node is one request with a style: the user writes it in the composer with no image picked (a new image), or with images picked on the canvas (they become the node's parents; one picked image is a refine of it). In conversation the agent adds the node for the user (`node.py add <project> --style S --request "<the user's words>" [--parent <image>]`).

For each generation node `watch` hands over, the agent:

1. Reads the request, the parents and attachments, `project.md`, the effective style, and the prompting file, and the nodes it builds on for what came before; nothing depends on remembering another conversation.
2. Chooses the references (see References) and writes the prompt from `style.md` and the prompting file, with `prompting.md` underneath. A request is never pasted into a template.
3. Draws (`generate.py <node> --ref <image> ... --request "<the request>" --prompt-file <file>`), reviews every image with `review.md`, and publishes the node with a note in the user's language, a line per image, a review per image, and the references it left out (`node.py publish <node> --note ... --describe ... --review ... --drop ...`).

Refining rewrites the parent's prompt with the user's change. Whether to also attach the parent is the agent's call: the references carry the style, so the parent goes along only when its composition has to survive, as a composition reference. Images the user attaches to a request describe that request (a pose, an object); the agent decides each one's role and names it.

Work on a finished image that needs no drawing goes through a tool instead of the model, on this computer and at no cost. Removing the background (cutout, macOS Vision) is a tool node: the user asks for it on an image, the server runs it at once and the node holds the transparent PNG; in conversation `node.py add <project> --tool cutout --parent <image>`. Prefer it to asking a model for a transparent background when the image already exists.

Requests that keep asking for the same change are not about one image; the agent sorts them as in Improving a style and proposes the change. Every node keeps its images, the style revision and model it was drawn with, the references used and left out, every call with its prompt and cost, so redrawing a node's request with a later revision is a new node with the same request.

## Ideation

For a user who does not know yet what the image should be, an ideation thread works it out in conversation ("New ideation" on a style, or `thread.py open <style> ideation`). The agent works as the designer with the user as the client: it analyzes the need, proposes ideas with reasons, recommends one, and develops the pick, writing the thread's `brief.md` as the image takes shape. Ideas are drawn with the draft model. When the image is concrete the agent proposes drawing it; the user's `generate` turns the brief into a generation node on the canvas, which the agent then draws like any other. The conversation goes on beside it: a fix about the idea updates the brief, a fix about the drawn image is a refine on the canvas. How the designer works and what the brief holds are in `ideation.md`.

## Surfaces

- Web: `open-package studio` serves the studio (`source/web/`) on `127.0.0.1:8770`. The home lists the projects. A project opens on its canvas: a card per node with its request and images, an edge from each parent's card to the node built on it, groups (frames) that move their nodes together, and the composer; beside it the brief, the styles, and the threads. Selecting a node opens its inspector: the full request, the agent's notes, the reviews folded until the user opens them (so they do not steer the pick), what it was made with, and the references used and left out. A style's page has its rules, the proposals with their diffs and probe comparisons, the probe runs, the references with their annotations and set check, the models, the revisions, and what it extends. A thread's page is the conversation. Pages poll, so an open tab follows the records. The app bar shows whether an agent is attached (an agent looked for work in the last ten minutes).
- Conversation: the agent sends a numbered sheet (`sheet.py <thread | node | run>`), records the user's reply with `thread.py answer`, adds nodes with `node.py add`, and asks for runs with `probe.py request`.

The server writes only records: projects, styles and the user's own changes to them (references, models, extends, restoring a revision), proposals accepted or rejected, probe runs asked for, nodes asked for (a tool node it runs itself), the canvas layout, threads and answers. What is written in words (the brief, a style's rules, its probes and prompting) the agent writes, from a thread. Generation always goes through the agent.

## Working on the web

The web studio is the default surface. When the user starts, the agent starts `open-package studio`, gives its address, and works there until the user ends. The conversation surface is used when the user asks for it, or when the agent cannot keep a command running in the background; the agent says which surface it is using and why.

On the web, what the agent publishes is its message. Everything the user is meant to read or answer goes into it: a thread round's note and its candidates' lines, a node's note and image lines, a run's note, a proposal's summary and reason. A user looking at the studio does not read the conversation, so the conversation gets one line saying what is up and where, and nothing the user has to answer:

- Asking for the yes to a paid draft model, or a question before any image can be drawn, is a thread round with the question as its note and no images.
- Proposing the next step (a probe run, drawing from the brief, a change to the style) goes in the round, node, or run that shows why.
- When the user writes in the conversation while the studio is in use, the agent records it where it belongs (`thread.py answer`, `node.py add`) and answers there, so the page keeps the whole record. Questions that belong to no thread or node (which projects there are, what a model costs) are answered in the conversation.

The agent waits with `open-package watch`, run in the background. It returns as soon as there is work and prints the folder of each place that has some:

- `projects/<p>/threads/<id>`: the user answered the thread's last round. Read it (`thread.py show`), do the work, publish the next round.
- `projects/<p>/nodes/<id>`: a generation waits. Draw it and publish the node.
- `projects/<p>/styles/<s>/runs/<n>`: a probe run waits. Draw one image per request and publish the run.
- `projects/<p>/styles/<s>`: a reference has no annotation, or the reference set changed since its check. Annotate, check the set, and say what the check found in the style's thread if it found something.

Then it runs `watch` again, for as long as the studio is open. `watch` reads the records rather than changes, so work that came in while the agent was busy is printed by the next run, and work already waiting is printed at once. Every look is recorded in `agent.json`, which is how the page knows an agent is attached. Something the user deleted or renamed needs nothing from the agent.

## Usage

Commands run as `open-package <command>` inside the workspace (`~/.config/asset-studio`, or `ASSET_STUDIO_HOME`). Paths are given relative to the workspace.

```
# studio, left running, and the agent's wait for work, run again after each piece of work
open-package studio
open-package watch

# a project and a style; a new style prints its folder and its thread
open-package project new <project>
open-package style new <project> <style>              # --guide for a guide, --from <style> to copy another project's style
P=projects/<project>; S=$P/styles/<style>; T=$P/threads/<id>

# the draft model for candidates (models.md): a free one, else the first listed candidate, after the user's yes
open-package models --free
D=<draft model id>

# a thread round: after editing $S/style.md, candidates from the draft model
open-package generate $T --model $D --prompt-file /tmp/1.md --into c1
open-package generate $T --model $D --prompt-file /tmp/2.md --into c2
open-package thread publish "$(open-package thread next $T)" --note "<the style in plain words, what changed, the questions>" \
  --describe "<reading 1>" --describe "<reading 2>"
open-package style revise $S --summary "<what changed>"

# probes: after writing style.json's model, prompting/<model>.md, and probes.md
open-package probe request $S                        # what the user's "Run probes" does
R=$S/runs/<n>
open-package generate $R --request "<probe 1>" --prompt-file /tmp/p1.md --into 1 --ref $S/references/01.png
open-package probe publish $R $R/1/<image> $R/2/<image> ... --note "<what changed>" --review "<verdict 1>" ...

# references: annotate each, then check the set
open-package style annotate $S/references/01.png --role style --shows "<what it shows>" --take "<what to take>" --ignore "<what to leave>"
open-package style set-check $S --shared "<what every style reference shares besides the style>"

# a change once the style has references: propose, the user runs probes on it and accepts or rejects
open-package proposal propose $S --summary "<change>" --reason "<why>" --source n12 --set style.md=/tmp/style.md
open-package probe request $S --proposal p3
open-package proposal show $S p3

# a generation node: the user adds it on the canvas; in conversation the agent adds it
N=$(open-package node add <project> --style <style> --request "<the user's words>" --parent $P/nodes/n3/<image>)
open-package generate $N --ref style=$S/references/01.png --ref style=$S/references/04.png --ref composition=$P/nodes/n3/<image> \
  --request "<the user's words>" --prompt-file /tmp/prompt.md
open-package node publish $N --note "<what was drawn>" --describe "..." --review "<verdict>" --drop "03.jpg=<why it was left out>"
open-package node add <project> --tool cutout --parent $P/nodes/n3/<image>

# ideation: $T/brief.md is written once the image has a shape; the user's generate turns it into a node
open-package thread open $S ideation --message "<the user's first words>"

# extends and guides
open-package style extends $S <base> <guide>
open-package style effective $S
open-package style materialize $S /tmp/effective --proposal p3

# the user's own changes, asked in conversation
open-package style reference-add $S <image>
open-package style reference-remove $S 03.jpg
open-package style use $S <model id>
open-package style model-remove $S <model id>
open-package style restore $S <revision>
open-package style rename $S <new name>
open-package proposal accept $S p3
open-package thread rename $T "<the name the user gave>"

# conversation surface
open-package sheet $T                                 # also a node or a run
open-package thread answer $T --comment "layers should look thicker"
open-package thread answer $T --picked 2 --note "2=the shadow is softer" --note "3=too dark" --comment "closest"
open-package thread answer $T --decision generate     # ideation: draw the brief
open-package thread show $T
open-package node show $N
```

`generate.py` writes into the node, the run, or the thread's next round (a subfolder with `--into`) and records each call beside the images in `calls.jsonl`: the model, the revision, the request, the prompt, the references with their roles, the options, the cost. `--dry-run` prints the request body without sending it. Options a model does not accept are dropped and reported; what a model accepts is read from OpenRouter and cached in the workspace's `cache/` for a day.
