# Writing styles

What a style is and how `style.md` is written. The workflow that produces it is in `workflow.md`.

## What a style is

A style is two things: `style.md`, the style in words, which the agent writes, and `references/`, the material the user chose for it: images, each with its annotation, and texts that hold what the style keeps to (a palette, design tokens). Neither is ever final. Every image shows something to improve, so the style keeps changing, and every change is a revision (`workflow.md`, A style is a source); the user draws with whichever revision they choose. The agent rewrites `style.md` as often as the reactions need. The references are the user's to curate: they add images and texts from the canvas that are the style and take out ones that teach the wrong thing.

Everything else is either material or translation:

- Material: the images the user attaches, candidate images, what is made on the canvas, and the conversation. They are what the agent reads to write `style.md`. A made image or text becomes a reference only when the user chooses it as one.
- Translation: `prompting/<model>.md`, one per model the style can draw with, and the model in use (`style.json`). Models differ in how they read prompts and references, so each model gets its own way of writing this style, and the model can change without the style changing.

A style is only a style. It is how images look: medium, shape, camera, line, light, color, materials, texture, detail, composition. It is not what they show. A style made for app icons, illustrations, or cute characters in general draws any subject, so nothing of the domain it was first wanted for goes into it: not into `style.md`, the candidates, the samples, or the references. A reference image is read for how it looks, never for what it shows; a sheet of weather icons says "soft inflated plastic, top-left light", not "clouds". Only a style the user scopes to a domain carries that domain, and the Use section of `style.md` says which kind a style is.

## Writing style.md

`style.md` is written so that someone who has never seen the references could draw any subject in the style, and so that a reviewer can check an image against it line by line. Professional style guides (art bibles, brand illustration systems, icon guidelines) are written in counts, ratios, directions, and recipes, not adjectives; `style.md` is written the same way, and a finished one runs to a few hundred lines.

Sections, in this order:

| section | pins down |
|---|---|
| Use | one sentence on what the style is; whether it draws any subject or is scoped to a domain; the asset types and aspect ratios it covers |
| Pillars | three to five priorities, each with the tradeoff it implies; they decide the cases no rule covers ("calm over clever: when unsure, remove an element") |
| Medium and finish | what the image is made of and its finish, and the hallmarks that prove it |
| Shape and proportion | the base shapes, corner rounding as a share of shape size, allowed angles, the shape budget (one main mass, a few medium shapes, few accents), how stubby or chunky things are, relative scale between kinds of subject |
| Camera and depth | projection, camera height and angle, how depth shows, and the stated exceptions |
| Line and edge | outlines or none, weight relative to the canvas, line color, hard and soft edges, how silhouettes separate |
| Light and shadow | key light direction and count, the shading model and number of tones, the color shadows shift to, highlight shape, the cast shadow's shape and color |
| Color and value | colors by role (ground, main, accent, shadow, line, skin), colors per image, rough area ratios, saturation and lightness limits, banned colors, gradient rules, how colors are chosen for a request; where the highest contrast goes and how the image reads in grayscale |
| Materials | how each material is drawn in this style: metal, glass and water, fabric, wood, paper, plants, skin, fur, screens; without these, each subject brings its own photographic look |
| Texture | grain or marks, their strength, their scale relative to the object, where they are forbidden |
| Detail | the smallest feature relative to the canvas, how many elements per image, how repetition is shortened (three leaves stand for a tree), what disappears at small sizes |
| Composition | how much of the canvas the subject fills, margins, placement, background, ground, cropping, one focal point |
| Subjects | for people, animals, objects, plants, places, tech, abstract ideas, and text: how each is built and simplified in this style, and what is never done; each kind of subject pulls the model toward its own default (people toward generic corporate flat, buildings toward isometric, metal toward photoreal) unless the style says otherwise |
| Mood | the emotional register, the expression range, what situations may be shown, each backed by the values above |
| Never | the few things the user ruled out or the model was seen to draw wrongly, each with why |
| Checks | the tests every image must pass, written so `review.md` can apply them: light direction, color count, outline policy, smallest feature, framing, exclusions |
| Decisions | what decided each part: the user's words, the pick and the reason given, the reference it was read from, the revision it came in with |

Rules for the text:

- Write what is wanted. A "never" is written only for something the user ruled out or a failure seen on the model, and it lives under Never with its reason. A direction the user moved away from is not mentioned at all: naming a look in order to forbid it puts that look in front of the model and back in front of the user. "Soft satin sheen" says enough; "not mirror gloss and not chalky matte" adds two looks to avoid that nobody asked about.
- Every rule is checkable by looking at an image: a count, a ratio, a direction, a named recipe, or yes and no. "Soft shading" is not a rule; "three tones per color, shadows shifted toward blue violet, never gray" is.
- Sizes are relative to the canvas or the subject. Models do not obey pixels; a reviewer can check "about a fortieth of the canvas width".
- Every rule carries where it came from: `user` (said by the user), `picked` (read from a pick and its reason), `reference` (read from an image the user attached), `agent` (the agent's choice for something the user left to it), or `open` (set per request, and saying so is part of the style). Fine differences the user does not care about are the agent's call and are still written down, so the model does not fill them differently each time.
- Write values, not names. "Claymorphism" or "3D" is a bundle of values that models read inconsistently; write the shape, surface, light, and depth it stands for. A name may go next to them.
- Material and texture words are literal: "sand" gives grainy sand, "paper" gives paper fiber, "glass" makes the object glass. Name a surface by its color and finish ("matte warm beige") unless the material itself is wanted, and give texture an intensity ("faint grain").
- Words a model takes as a format bring their conventions: "icon" adds a rounded tile, "sticker" a die-cut border. Rules of use (an app icon is one object on a plain background) go under Composition in plain terms.
- Mood words alone move little. Each one is backed by values elsewhere ("playful" is rounded forms, saturated color, soft light).
- `style.md` names no model. What a particular model needs goes into its prompting file.
- `style.md` names no reference. What each image shows and lends is in its annotation, which travels with the image. A text reference's values are not copied in; `style.md` says how values like them are used ("one color per main part"), so a new palette changes the colors without changing the words.
- A rule changed after the style first drew says the revision it came in with in its source tag ("(owner, revision 7)"), so the Decisions section and the tags stay the history of the words.
