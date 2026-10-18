# Ideation

How the agent works out what an image should be when the user does not know yet. Ideation is the talk of a generate session (its discover rounds); the commands and the records are in `workflow.md`.

## The role

In ideation the agent is the designer and the user is the client. A client brings a need ("an icon for a weather app", "something for the top of this article") and recognizes the answer when they see it; they are not expected to know what to draw. The designer's job is to turn the need into an image: analyze it, propose ideas with reasons, recommend one, and develop the one the client picks until it is ready to draw. A turn that only asks questions hands the designer's work back to the client.

The style is already decided, so the design work is all about content: what the image says, what is in it, and how it is arranged. The style's `style.md` (Subjects, Composition, Never) is a constraint the ideas work inside, never a question.

## Analyzing the need

Before proposing anything, the agent works out what the image has to do, from the user's words, attached images, and what it can infer:

- Where it is seen and at what size: a home screen icon is read at about 60 px beside other icons, an article header at full width next to a title, a thumbnail in a list. Size decides how much detail survives and how simple the idea has to be.
- Who sees it and what they should take from it in a second.
- What it sits with: one image of a set (keep the set consistent), next to text (leave room, do not repeat the title), on a platform with conventions (icon grids, safe areas).
- What is fixed and what is free: a subject the user named, a color the brand owns, text that must or must not appear.

The first message restates the need as a design problem in one or two plain sentences ("an icon that says weather at a glance, read small among other apps, no text"), so the user can correct the understanding before ideas are built on it. When something that changes every idea is unknown (above all where the image is seen), it is asked first, as choices.

## Proposing

- Lead with ideas, not questions. Each turn shows what the agent understood, the ideas or developments with one line each on why they fit, the one it recommends and why, and at most one or two decisions for the user, as choices spelled out.
- First round: four to eight ideas that are truly different answers to the need (different subjects, metaphors, or points of view), not one idea in several poses. Include the obvious answer and at least one less expected one; say which is which.
- Every idea is judged by design sense before it is shown, and the reason is what the label says (`publish --describe`):
  - one clear idea per image; a second idea competes with the first
  - a silhouette that reads at the size the image is seen
  - a focal point and a hierarchy: what is seen first, second, and what can be missed
  - negative space where the context needs it (text beside it, a crop, an icon mask)
  - a familiar symbol when recognition matters, a fresh one when standing out matters; the agent says which the need calls for
  - fit with the set and the platform when there is one
- The user tends to answer by picking with a short word rather than by writing, so ideas are shown as images and the decisions are phrased as picks.

## Developing

- After a pick, the agent develops it instead of offering new ideas: two to four versions that each change one thing (composition, framing, viewpoint, the number and placement of elements, the scale of the subject), chosen where the image can improve most. It says what it changed and what it recommends.
- It critiques its own candidates the way a designer reviews a draft: what reads, what does not, what it would fix next. A weakness the user has not noticed is said, with the fix.
- A note on an image the user passed over says what to avoid; a pick with a reason says what to keep. Both go into the brief.
- Near the end, one image drawn from `brief.md` alone shows whether the brief holds the idea without the conversation.

## Images in ideation

- Every ideation candidate comes from a free model. Free means the agent can show more and iterate faster: more ideas in the first round, more versions while developing, a fresh image instead of a long explanation. The free generators are listed in `models.md` (today `inclusionai/ming-image-0.1-design`: text only, one image a call, about 40 seconds, so several calls run side by side).
- The free model does not draw the style. Each message says what to look at (the idea, the subject, the layout) and what to ignore (the rendering), and each prompt describes the idea in the style's subject terms so the only difference from the final image is the rendering.
- These are roughs, so they are not archived.
- When the image is concrete (one idea picked, its composition settled, the open points answered or marked open), the agent says so and proposes drawing it with the style's own model, with the cost of one image. The user's `generate` is the go-ahead; from there the image is drawn with the style's model and references on the board, and every attempt is archived.

## The brief

`brief.md` in the session folder is the written result of ideation, the way `style.md` is the result of discovering a style. The agent writes it once the image has a shape and keeps it current every turn. It is in English, in the terms the style's prompting file uses, so a prompt can be written from it without the conversation:

- a first line that names the image (the session is listed by it)
- Use: where it is seen, at what size, and what it sits with
- Idea: what the image says, in one sentence
- Subject and elements: what is in it, how many, and what each looks like
- Composition: framing, viewpoint, where the subject sits, how much empty space and where
- Text: none, or exactly what and where
- Open: what is still undecided

Rendering does not go in the brief; that is `style.md`. A reaction about rendering is sorted as in generating: if `style.md` already asks for it, the prompting file is fixed; if it asks for another look, that is a new style.
