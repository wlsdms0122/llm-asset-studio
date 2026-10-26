# Review

How the agent reviews generated images before the user sees them. Reviewing looks; it never triggers a generation by itself.

## Inputs

- The style at the node's revision: `style.md` (its Checks section first), its text references, the image references attached to the generation with their annotations, and `prompting/<model>.md` for how the prompt was written.
- The request each image was made for, the prompt written from it, and the references left out.
- Each candidate opened at full resolution, plus close crops of the main subject. A contact sheet or thumbnail hides malformed leaves, fingers, and edges; it is for comparing images, not for judging one. File names and call records are not evidence of what an image shows.

## Four checks, in order

1. Request: does it show what was asked? The subject, how many of each thing, relative size (a seed is fingernail sized next to a pot), and nothing extra that changes the meaning.
2. Form: does every part read as what it is, with clear boundaries? Look at each leaf, stem, hand, and edge in the crop: no merged, split, or doubled shapes, no lumps, part outlines that make sense. When the pillars in `style.md` name form as the main concern, this check decides.
3. Style: go through the Checks in `style.md` one by one against the image, then put it side by side with the references: do light, color, medium, shape, line, and detail hold? Before the style has references, the written checks alone decide.
4. Leakage: put it side by side with each attached reference and look for what came over that the request did not ask for: the reference's subject or one of its objects, its color layout, its composition or crop, its background. Each reference's annotation says what it was meant to lend; anything else that came through is a leak.

## Verdict per image

- `pass`: all four checks hold. Say in one line what was checked.
- `instance`: style holds, but the request or the form fails in this image. Name the defect and where it is ("top left leaf has a split tip", "four leaves, five or six asked").
- `drift`: the style does not hold. Name which property and how.
- `leak`: something came over from a reference. Name the reference and what came over ("leak: 02.jpg, the navy background and the mug's handle").

A verdict is written as its keyword, a colon, and one line ("drift: the shadows are gray, the style's are blue violet").

Rank a batch from closest to the style to farthest. Ranking is the reliable signal; a verdict is a claim to be checked against the user's picks.

## What follows from a verdict

- `pass`: shown to the user first.
- `instance`: may be fixed by one edit call or one regeneration of that subject, at most once. If the cause is the prompt's wording, fix the wording first.
- `drift`: not regenerated. Repeated drift on a property `style.md` already pins means the prompting for this model does not hold it, so a change to `prompting/<model>.md` is proposed. Drift on a property `style.md` leaves loose is a gap in the style, so a change to `style.md` is proposed (`workflow.md`, Improving a style).
- `leak`: may be redrawn once without the reference that leaked. Repeated leaks from one reference are a reason to propose removing it or rewriting its annotation; leaks shared by many references point at what the set shares.

## AI tells to flag as drift

Oversaturated color, plastic or waxy surfaces, flat even lighting with no shadow direction, generic gradients, excessive bokeh, everything centered and symmetric, no grain where the style has texture.

## Record

Record every verdict with the image it is about (`node.py publish --review`, one per image). Reviews are the agent's record and the studio does not show them; the user sees what follows from them (an image fixed or redrawn, a change to the style). In a conversation report, give them after the user's answer, so they do not steer which image the user takes. A report that says "all passed" without a line per image has not been judged. Agreement between these verdicts and the user's choices decides how much of the user review can be skipped later.
