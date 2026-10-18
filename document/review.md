# Review

How the agent reviews generated images before the user sees them. Reviewing looks; it never triggers a generation by itself.

## Inputs

- The style: `style.md` (its Checks section first), `references/*` once it is confirmed, and `prompting/<model>.md` for how the prompt was written.
- The request each image was made for, and the prompt written from it.
- Each candidate opened at full resolution, plus close crops of the main subject. A contact sheet or thumbnail hides malformed leaves, fingers, and edges; it is for comparing images, not for judging one. File names and ledger entries are not evidence of what an image shows.

## Three checks, in order

1. Request: does it show what was asked? The subject, how many of each thing, relative size (a seed is fingernail sized next to a pot), and nothing extra that changes the meaning.
2. Form: does every part read as what it is, with clear boundaries? Look at each leaf, stem, hand, and edge in the crop: no merged, split, or doubled shapes, no lumps, part outlines that make sense. When the pillars in `style.md` name form as the main concern, this check decides.
3. Style: go through the Checks in `style.md` one by one against the image, then put it side by side with the references: do light, color, medium, shape, line, and detail hold? Before the style is confirmed there are no references, so the written checks alone decide.

## Verdict per image

- `pass`: all three checks hold. Say in one line what was checked.
- `instance`: style holds, but the request or the form fails in this image. Name the defect and where it is ("top left leaf has a split tip", "four leaves, five or six asked").
- `drift`: the style does not hold. Name which property and how.

Rank a batch from closest to the style to farthest. Ranking is the reliable signal; a verdict is a claim to be checked against the user's picks.

## What follows from a verdict

- `pass`: shown to the user first.
- `instance`: may be fixed by one edit call or one regeneration of that subject, at most once. If the cause is the prompt's wording, fix the wording first.
- `drift`: not regenerated. Repeated drift on a property `style.md` already pins means the prompting for this model does not hold it, so `prompting/<model>.md` is fixed. Drift on a property `style.md` leaves loose is a gap in the style: while it is being made, the words are fixed; once confirmed, it is reported as a reason to make a new style from it.

## AI tells to flag as drift

Oversaturated color, plastic or waxy surfaces, flat even lighting with no shadow direction, generic gradients, excessive bokeh, everything centered and symmetric, no grain where the style has texture.

## Record

Record every verdict and its reason with the image it is about (`session.py publish --review`, one per new image); the round keeps them and shows them only after the user has answered, so they do not steer the pick. In a conversation report, give them after the user's answer. A report that says "all passed" without a line per image has not been judged. Agreement between these verdicts and the user's picks decides how much of the user review can be skipped later.
