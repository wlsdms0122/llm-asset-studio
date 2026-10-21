# Workflow

How the agent runs a style from the first conversation to making images, on the web studio or in conversation. What a style is and how `style.md` is written is in `writing-styles.md`; working out an image in ideation in `ideation.md`; prompting in `prompting.md`; models in `models.md`; reviewing images in `review.md`.

## Lifecycle of a style

A style is made in one make session (discover, sample, confirm) and then used in as many generate sessions as the user opens. Each session is a folder of rounds (see Rounds and surfaces).

1. discover: one conversation that makes the style. The user describes what they want and attaches images; the agent describes the style back in plain words and writes it into `style.md` in full detail, shows candidate images when a picture settles a question faster than words, and asks the questions that change the image most. The user replies, attaches more, and picks candidates with a reason. When the agent believes the style is pinned down it says so, with the description, and proposes sampling; moving on (`sample`) is the user's call. See Discovering a style.
2. sample: the agent picks the model, writes `prompting/<model>.md` and `model`, and the user tries the style on their own requests, one free-form request and one image at a time. Each image is shown with the request and the prompt written from it. No reference images are attached, so a sample tests whether the words alone hold the style. The user asks for another (`request`), goes back to the conversation (`discover`), which continues where it left off, or moves on (`confirm`).
3. confirm: every sample image is offered as a reference, and the user picks the ones that are the style. When the picks are too few or too alike to teach the style (see References), or the user asks for more, the agent adds a few images, labeled as added, in a new confirm round that opens with the earlier picks still picked. On `done` the agent runs `session.py confirm`: the picks become `references/`, they are archived, and the make session is removed.
4. generate: making images with the confirmed style, in generate sessions. The user opens one, describes an image, then refines it by picking the attempt to build on and saying what to change, or starts a new one. When the user does not know yet what the image should be, the session starts in ideation instead, where the agent works the image out with the user as a designer would (see Ideation). Every image made with the style is archived the moment it is shown. A session stays as a thread the user comes back to, until the user deletes it; deleting removes its rounds, never the archived images.
5. curating: the user adds images to the references and takes them out at any time, from the archive, from a session, or by upload (see References). `style.md` stays as confirmed. Adding a model runs a model session (see Prompting per model), and the user picks which of the style's models images are made with, or removes one that is not in use (`style.py model-remove`).
6. new from a style: changing how a confirmed style looks makes a new style from it (`session.py new <styles> <name> --from <style>`). It starts with the base's `style.md`, and the base's references as the images of its first discover round, then runs the same discover, sample, and confirm. The user may fix a detail or turn the style somewhere else. The base's prompting files are not copied, since they translate words that are about to change; at sample the agent writes this style's prompting file, starting from the base's when it keeps the same model.

Each stage goes forward on the user's word and back one stage when the user wants; a reason is welcome but not asked for, since going back picks up where that stage left off. Going back loses nothing: `style.md` carries over, every round keeps a copy of the words it showed, and returning to a stage brings back its images.

## Discovering a style

The user cannot be asked to name a style; few people outside design can. They can describe what they want, show images they like, and recognize the result. So the agent writes the style from that material, and every image shown during discovery exists to settle a question about the words.

- Each turn the agent's message (on the web, the round's note) describes the style in the user's language and plain words, says what changed since the last turn, and asks at most two or three questions, the ones that change the image most first. `style.md` holds the same description in full detail.
- Never ask the user for vocabulary. Ask with the options spelled out, as "this, not that": "soft matte like clay, or shiny like toy plastic?" After a pick, ask why with two or three plain reasons to choose from; a pick with a reason says far more than a pick alone.
- A note can sit on any candidate, picked or not: a reason for a pick, or what falls short in one the user passed over. Picks and notes are read separately.
- Read every attached image at full resolution and describe what most of them share; what only one has is that image, not the style. Name conflicts as a question. Mark what was inferred, especially material and texture, and ask before relying on it: small or compressed images invent texture.
- Images go out when a question is easier to answer by looking than by reading (how much gloss, which of three renderings of "3D"), on any turn, or when the user asks to see. A choice the user can make from a sentence (light or dark background) is asked as a sentence: images shown without need anchor the user on them.
- Candidates, when they help:
  - When the direction is wide open even after the user's words and images: four to six images far apart from each other on the main open questions, all on one plain subject.
  - Then: two to four images that differ in one property, or two, with everything else the same, chosen where the agent is least sure and the answer matters most.
  - Near the end: one image from the written style alone, next to one or two near misses that each break one rule on purpose. The user choosing the faithful one, for the reason the rule gives, confirms the words.
  - Every candidate is labeled with the reading it tests (`publish --describe`), so a pick turns straight into a value in `style.md`.
  - All candidates show one plain subject from outside the style's domain (a mug, a chair, a potted plant), or from inside it when the style is scoped to that domain. The subject stays the same while a question is open, so a difference between candidates is a difference in style.
- A style made for a kind of asset (app icons, logos, thumbnails) is judged in use. One plain subject on a plain background settles the rendering, but the user cannot tell from it how the style will feel on real assets. Once the rendering is roughly settled, show it applied: a few made-up uses with different subjects and colors, and a composite of how they sit together where they are seen (icons masked and laid out at home screen sizes). The composite is put together locally and costs nothing.
- Candidate images come from the draft model (`models.md`: free when a free model can show it, otherwise a cheap paid one after the user says yes). Their job is to show which way the style goes, not quality, and the message says what to look at and what to ignore.
- Signs the style is pinned down: the important values have not changed for two rounds; the agent predicted the user's pick before showing it; the image from the written style alone was chosen; every section is filled, with what is undecided marked open. Then the agent proposes sampling. Signs of fatigue (shorter replies, "anything is fine", picks that flip every round) mean stopping to summarize or changing the question, not another round of images.
- Coming back from sample, the conversation already shows what the sample drew, in the place it was drawn; the agent's next message refers to those images instead of attaching them again.
- About eight to ten user answers is a normal length. More without settling means a question is missing: ask a broader one or ask for another reference.

## Sampling

- The model is the agent's call, made for this style: how well it reads the kind of look, whether it takes references, what it costs. The current default is Seedream 5.0 Flash (`bytedance-seed/seedream-5-0-flash`: $0.018 an image, 14 references at no extra cost, seed). Before the first sample the agent writes `model` and `prompting/<model>.md`.
- Each request is turned into a prompt by following `style.md` and the prompting file, with `prompting.md` underneath; a request is never pasted into a template. Every image is reviewed with `review.md` before it is shown, against the Checks in `style.md`.
- Every reaction is sorted before it is applied. A fix that would hold for any subject (softer shadows) is a style fix and edits `style.md`. A fix about this image only (a wrong count) goes into the prompt. A fix that `style.md` already asks for and the model missed goes into the prompting file. When unsure, the agent asks once: "should every image look like this, or just this one?"
- The sample board is a list of images in the order they were drawn, each with its request, the prompt, and what the agent has to say about that image (`publish --describe`); it is not a conversation.
- Samples vary their subjects, so a style fix that only suited the discovery subject shows here.

## References

Style models are usually trained on many images that share a style (LoRA, DreamBooth). This system does not train; the prompt-level equivalent is the reference set, sent with every generation. It follows the same rules as a training set:

- With one or two references a model copies them; with several it keeps what they share. Four to eight is the aim when the model takes them at no extra cost.
- Varied subjects and compositions, consistent rendering. What the references share is what the model learns, so everything that should not be learned (subject, color scheme, layout) varies across them. Two cream references made every result cream.
- Only clean examples. A reference with a defect teaches the defect.
- They start as the sample images the user picks at confirm. Images the agent adds at confirm are made with the written style to fill what the picks lack (another subject, another color) and offered for the user to pick like any other.
- After confirm the user curates them: an image that is the style can be added (a generated image, an archived one, an upload), and one that teaches the wrong thing taken out. Only images the user chose go in, so what the model learns stays what the user recognized as the style. The agent may suggest a reference (a new subject that came out right) but never adds one itself. Every change is recorded in the ledger, and an image that becomes a reference is archived. References never outnumber what the style's model takes (the studio refuses an addition or a model switch that would). Rounds and the ledger name references by their archived copies, so an old round still shows what was attached after the set changes.
- The set changes, so a prompting file never lists the references by name; each generation names the attached references by what they show, after looking at them.

## Prompting per model

`prompting/<model>.md` (the model id with `/` written as `--`) holds what one model needs to draw this style:

- The call: aspect ratio, resolution, quality, how many images a call, and which options the model ignores.
- How references are attached and named for this model (Image 1..N, by role, or a separate style channel).
- A fixed style paragraph drawn from `style.md`, used word for word in every prompt, since synonyms drift.
- The prompt order and length for this model, and how the Subject line is written from a request.
- Wording that held the style on this model and wording that broke it.
- Prompts with and without references: sample prompts go out before there are any, so they name none; generate prompts attach and name them.

The style paragraph is drawn again whenever `style.md` changes, so while a style is being made the agent redraws it before the next sample.

What is true of a model in general (it reads clauses as directives, it draws the crop shape it is told about) goes into `models.md`, and what is true of prompting in general into `prompting.md`; a style's prompting file holds only what is particular to that style on that model.

Prompting files keep improving after confirm. When generate keeps missing something `style.md` already says, the prompting file is fixed.

A style has one prompting file per model it can draw with, and `model` names the one in use; the user switches between them. Adding a model is a model session, opened by the user with the model chosen:

1. The agent reads what the model accepts and how it reads prompts (`models.md`, the model's endpoint, its docs), and writes the session's `prompting.md` from `style.md` and the current model's prompting file.
2. It draws one or two first images with the references attached, picked to show the style plainly (a subject like one of the references, and one the references do not show), reviews them side by side with the references, and publishes the first `model` round.
3. The user asks for more, one request and one image at a time; the agent refines `prompting.md` from what drifts, as in sampling.
4. On `done` the agent runs `session.py add-model`: the file joins `prompting/`. Choosing it as the style's model is the user's own step.

The images a model session draws are made with the confirmed style, so they are archived like generated ones. Only models that take reference images are offered, since the style is drawn with its references attached.

## Generating

- Each generate session is its own thread, and the user may keep several. The agent reads the session's rounds (requests, prompts, picks) for what came before; nothing depends on the agent remembering another conversation.
- The user describes an image; the agent writes the prompt from `style.md` and the prompting file, generates with the references, reviews with `review.md`, and publishes. Attempts are listed in the order they were drawn, the one being drawn last.
- Refining rewrites the picked attempt's prompt with the user's change. Whether to also attach the picked attempt is the agent's call: the references carry the style, so the attempt is attached only when its composition has to survive. Images the user attaches to a request describe that request (a pose, an object) and go after the references.
- Work on a finished image that needs no drawing goes through a tool instead of the model, on this computer and at no cost. Removing the background (`cutout`, macOS Vision) writes each image's subjects as a transparent PNG into the next round, so a request like "take the background off 2" is answered on the board like any other attempt. Prefer it to asking a model for a transparent background when the image already exists.
- Every image shown is archived with its request, prompt, and model, or the tool that made it. The ones an app uses are copied into that app's repository.
- Requests that keep asking for the same change are not about one image. If `style.md` already asks for it, the prompting file is fixed; if it asks for something else, the user wants a different style, and the agent suggests making one from this.

## Ideation

A generate session opens one of two ways, chosen on the style's page: "new image" opens on the board for a user who knows what to make, and "new ideation" opens in ideation for one who does not (`session.py open <style> generate --ideation`). It is the same session either way: the board's `discover` goes to ideation, ideation's `generate` goes to the board, and a session that has talked is listed as an ideation.

In ideation the agent works as the designer with the user as the client: it analyzes the need, proposes ideas with reasons, recommends one, and develops the pick, writing the session's `brief.md` as the image takes shape, the way discovering a style writes `style.md`. Every ideation candidate is drawn with the draft model. When the image is concrete the agent proposes drawing it with the style's model; on the user's `generate` it writes a prompt from `brief.md`, `style.md`, and the prompting file, draws one image with the references, and publishes a generate round whose request is the brief's first line. Going back to ideation continues the conversation, with what the board drew shown in it. How the designer works and what the brief holds are in `ideation.md`.

## Rounds and surfaces

A round is one thing shown to the user and the user's answer to it. Its records are the source of truth; the web page and the conversation are two surfaces over the same records.

| kind | shows | the user gives |
|---|---|---|
| discover | the conversation with its candidates and attachments, and what it writes (`style.md`, or in ideation `brief.md`) | a reply with attachments, picks with reasons, or the next stage (`sample`, or in ideation `generate`) |
| sample | `style.md`, the prompting file, and request / prompt / image for each image | `request`, `discover`, or `confirm` |
| confirm | every sample image and any the agent added | picks and `done`, a reply asking for more, or `sample` |
| generate | `style.md`, the references, `brief.md` when the session has one, and every attempt with its request and prompt | `refine` (picked attempt + request), `new`, or `discover` |
| model | the model's draft prompting file, the references, and every image with its request and prompt | `request` or `done` |

Sessions live in `sessions/<style>/<session id>/`, next to the style, so the style folder holds only the style and its records. `session.json` says the kind of session (make, generate, model), when it started, and for a model session which model; a generate session that has talked keeps its `brief.md` beside it. Each round is a folder in the session: `round.json` is written once by the agent and never rewritten, since the user has seen it; it carries a copy of `style.md` (and `brief.md` in a generate session, and for boards the model and its prompting file) as they were shown, which is the history of the words. Publishing a board or confirm round carries over the images of the last round of the same kind in that session. Boards (sample, generate, model) read in the order images were drawn, the newest last; a confirm round shows the images the agent adds first, also carries every sample image, and starts with the user's picks from the last confirm round still picked. `feedback.json` is written once by a surface. Images the user attaches belong to the answer they are sent with, like a file attached to a message: they wait in the round's `attachments/` while it is open, `feedback.json` lists them, and the conversation shows them with that reply. Candidate numbers follow the display order, which a blind round shuffles with the round number as seed, so the page, `sheet.py`, and `session.py answer` agree on what "3" means. Confirming a style, adding a model, or the user deleting a session removes the session folder.

- Web: `open-package studio` serves the studio (`source/web/`) for every style on `127.0.0.1:8770`. The home lists the styles and creates new ones; a right click on a style renames it, makes a new style from it, or deletes it. A style being made opens on its make session; a confirmed style opens on its overview (the model in use, the sessions, the references, recent images) with "new generate session" and "add model", and each session opens at its own address. Any image can be added to the references wherever it is shown; references are taken out only from the reference list. Being a reference is not shown on other images. The model picker shows each model's price for one 1K image (what it has cost here when it has been used) and offers only models that take as many references as the style has. The archive lists every archived image and downloads several at once. Pages poll, so an open tab follows the rounds. Review verdicts are not shown before the user answers.
- Conversation: the agent sends `sheet.py` output and records the user's reply with `session.py answer`.

The server writes only records: answers, new styles with their make session, new generate sessions (with an empty board) and model sessions (with none yet), images attached to or taken off the answer being written, and the user's own changes (renaming or deleting a style, deleting a session, references, the model in use). Generation always goes through the agent.

## Working on the web

The web studio is the default surface. When the user starts, the agent starts `open-package studio`, gives its address, and works there until the user ends. The conversation surface is used when the user asks for it, or when the agent cannot keep a command running in the background; the agent says which surface it is using and why.

On the web, the published round is the agent's message. Everything the user is meant to read or answer goes into it: the style or the image in plain words, what changed, and the questions (`publish --note`), and what each image tests or what the agent has to say about it (`--describe`). A user looking at the studio does not read the conversation, and an answer given in the studio is an answer to the round, not to anything said beside it. So the conversation gets one line saying which round is up and where, and nothing the user has to answer:

- Asking for the yes to a paid draft model, or a question before any image can be drawn, is a discover round with the question as its note and no images.
- Proposing the next stage (sampling, drawing from the brief) goes in the note of the round that shows why.
- When the user writes in the conversation about a session while the studio is in use, the agent records it with `session answer` and replies with the next round, so the page keeps the whole thread. Questions that belong to no session (which styles there are, what a model costs) are answered in the conversation.

The agent waits for answers with `open-package session watch`, run in the background. It returns as soon as any session is the agent's turn (its last round is answered, or it is a model session with no round yet) and prints the folder of each one. For each folder the agent reads the answer (`session show`), does the work, and publishes the next round; then it runs `watch` again. `watch` looks at the records rather than at changes, so an answer that comes in while the agent is working is printed by the next run, and sessions already waiting when the agent starts are printed at once. It is run again for as long as the studio is open, including after a style is confirmed: generate requests and new model sessions (the user asking for that model) arrive the same way. A session the user deleted or renamed needs nothing from the agent.

## Usage

Commands run as `open-package <command>` inside the workspace (`~/.config/asset-studio`, or `ASSET_STUDIO_HOME`), which holds `styles/`, `sessions/`, and the API key stored with `open-package key`. Paths are given relative to the workspace.

```
# studio, left running, and the agent's wait for the next answer, run again after each round it publishes
open-package studio
open-package session watch

# a new style, or one made from a confirmed style, starts with its make session and a discover round
open-package session new <style>
open-package session new <style> --from <confirmed style>
S=sessions/<style>/<session id>       # every command below takes the session folder

# the draft model for candidates (models.md): a free one, else the first listed candidate, after the user's yes
open-package models --free
D=<draft model id>

# discover: after rewriting styles/<style>/style.md, a turn with candidates
open-package generate $S --model $D --prompt-file /tmp/1.md --into c1 --tag discover
open-package generate $S --model $D --prompt-file /tmp/2.md --into c2 --tag discover
R=$(open-package session next $S)          # the round those images went into
open-package session publish $R --kind discover --note "<the style in plain words, what changed, the questions>" \
  --describe "<reading 1>" --describe "<reading 2>" --review "<verdict 1>" --review "<verdict 2>"

# sample: after writing styles/<style>/model and styles/<style>/prompting/<model>.md
open-package generate $S --request "<the user's words>" --prompt-file /tmp/prompt.md --tag sample
open-package session publish "$(open-package session next $S)" --kind sample --describe "<what to say about it>"

# confirm: every sample image is offered; images the agent adds come first, labeled
open-package generate $S --request "another subject: a clock" --prompt-file /tmp/clock.md --into clock --tag confirm
open-package session publish "$(open-package session next $S)" --kind confirm --note "..." --describe "added: a clock"
open-package session confirm $S            # after the user's done

# generate: the user opens sessions on the web; in conversation the agent opens one
G=$(open-package session open styles/<style> generate)
open-package generate $G --references --request "<the user's words>" --prompt-file /tmp/prompt.md --tag generate
open-package session publish "$(open-package session next $G)" --kind generate --describe "..."
# a tool on an image already made: the background removed, into the next round
open-package cutout $G "$G/<round>/<image>" --request "<the user's words>"
open-package session publish "$(open-package session next $G)" --kind generate --describe "..."

# ideation: the user opens it on the web or reaches it from the board; in conversation the agent opens one
# $G/brief.md is written once the image has a shape, and from then on the user can move to generate
G=$(open-package session open styles/<style> generate --ideation)
open-package generate $G --model $D --prompt-file /tmp/1.md --into c1 --tag discover
open-package session publish "$(open-package session next $G)" --kind discover --note "<the need as understood, the ideas and why, the recommendation, the decisions>" --describe "<idea 1 and why it fits>"
# after the user's generate: draw from brief.md, with its heading as the request
open-package generate $G --references --request "<brief.md heading>" --prompt-file /tmp/prompt.md --tag generate
open-package session publish "$(open-package session next $G)" --kind generate --describe "..."

# model: write $M/prompting.md, then draw with the references
M=$(open-package session open styles/<style> model --model <model id>)
open-package generate $M --references --request "<a first subject>" --prompt-file /tmp/prompt.md --tag model
open-package session publish "$(open-package session next $M)" --kind model --describe "..."
open-package session add-model $M          # after the user's done

# the user's own changes, asked in conversation
open-package style reference-add styles/<style> <image>
open-package style reference-remove styles/<style> 03.jpg
open-package style use styles/<style> <model id>
open-package style model-remove styles/<style> <model id>
open-package style rename styles/<style> <new name>
open-package session delete $G

# conversation surface
open-package sheet $S
open-package session answer $S --comment "layers should look thicker"
open-package session answer $S --picked 2 --note "2=the shadow is softer" --note "3=too dark" --comment "closest"
open-package session answer $S --decision sample
open-package session answer $S --decision request --request "a warm feel, a teddy bear and a pot"
open-package session answer $S --picked 1,3,4 --decision done
open-package session answer $G --comment "an icon for a weather app, no idea what to draw"
open-package session answer $G --picked 2 --decision generate

# what a surface sees
open-package session show $S
```

`generate.py` writes into the session's next round (into a subfolder with `--into`) and records the call, with the session, in the style's ledger; `session.py next` prints that same round, and publishing it without a file list shows everything generated into it, subfolders included. `publish --review` keeps the agent's verdict on each new image (`review.md`); the user sees it after answering that round. `--dry-run` prints the request body without sending it. Options a model does not accept are dropped and reported; what a model accepts is read from OpenRouter and cached in the workspace's `cache/` for a day.
