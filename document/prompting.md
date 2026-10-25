# Prompting

How the agent turns `style.md` and a request into a prompt for an image model. What holds for every model is here; what one model needs is in `models.md` and, for one style on one model, in that style's `prompting/<model>.md`.

## Every call stands alone

- Write the whole style into every prompt and attach the references on every call. Models drift across a long multi-turn session, and "same style as before" carries nothing; restating the rendering is what holds it.
- Use a multi-turn edit session only to change one asset locally.

## Shape of a prompt

- Labeled lines in a fixed order: what the image is for, the input images and their roles, the subject, the style paragraph, composition, background. The fixed lines come from the prompting file; only the subject line changes per request. JSON prompts have no proven quality edge; pick the form that is easy to read and edit.
- Plain sentences. Every model reads them, and models that rewrite or expand prompts keep sentences better than tag lists.
- The style paragraph is used word for word. Synonyms drift: "satin" in one prompt and "semi-gloss" in the next are two different looks to the model.
- Quality words ("masterpiece", "8k", "award winning") do nothing.

## What to say

- Say what is wanted. A look named in order to forbid it is put in front of the model: "not puffy" brings puffiness closer. Write a negative only for something the user ruled out or a failure seen on that model, once, plainly. Most models have no negative prompt parameter on OpenRouter.
- Visual properties, not adjectives: line weight, palette, light direction, surface finish, margins. "Modern" or "beautiful" moves nothing.
- Name the subject's parts, counts, and relative sizes: "a monstera with five large leaves, each with several oval holes", "one seed, fingernail sized next to the pot". Unstated counts come out random.
- Describe a symbol or a small object as a construction, not a story: how many shapes, each one's proportion, where each sits relative to the others (aligned, offset by how much, which edge meets which), and which face the camera sees. A prompt that names an action ("a tab about to click into a notch") leaves the geometry open and the model fills it differently every time.
- The form must be plausible as an object. A part that only makes sense as an explanation (a floating piece, a tab meeting a printed circle) reads as broken even when drawn as written; when an idea needs a mechanism to read, change the idea.
- Materials are literal. "Glass" makes glass, "sand" makes sand grains, "paper" makes paper fiber. Name a surface by its color and finish ("matte warm beige", "pale tinted crayon with no line around it") unless the material itself is wanted, and give texture a strength ("faint grain").
- Format words bring their conventions. "App icon" adds a rounded tile, "sticker" a die-cut border, "comic" speech balloons. Say what the image is for ("app icon artwork") and then describe the frame directly.
- A shape the image will be cropped to is drawn into the image when named. Ask for an even margin instead.
- Style names are bundles ("claymorphism", "low poly", "isometric", "soft 3D"); each model unpacks them differently. Write the values they stand for.
- Mood words alone move little; back each one with values elsewhere in the prompt.
- Text inside the image goes in double quotes, exactly as it should read, with the type described rather than a font named.

## Reference images

- References carry what words carry badly: palette, finish, the feel of a medium. They also carry subject, composition, and objects along with it (content leakage). So every reference goes out with its role, and the prompt says what to take from it and what to leave, from its annotation (`workflow.md`, References).
- Roles: a style reference lends how it is drawn; a subject reference lends the shape of one subject; a composition reference lends layout, pose, viewpoint, and crop; a guide reference lends only what its guide covers. Name each attached image with its role and its take and ignore in the form the model reads (by position, by what it shows, or through a separate style channel; see `models.md` and the style's prompting file): "Images 1 to 4 are style references: take their rendering, light, and texture; do not take their subjects, colors, or layout. Image 5 is a composition reference: take the subject's pose and the crop; do not take how it is drawn."
- Style references go first, then subject references, then composition references.
- State the subject's colors, counts, and layout in every prompt, so nothing is left for a reference to fill.
- With one or two references a model copies them; with several that share only the rendering, it takes the rendering.
- A reference that shows nearly the same subject as the request wins over the words: its pose, angle, and size come through however the prompt measures them. Leave it out of that generation and record why on the node.
- A reference with a defect teaches the defect.
- Exact geometry (equal sizes, set ratios, a precise rotation) is not something an image model guarantees. A mark made of a few geometric shapes is constructed in code instead, with the style's colors, and offered next to the generated image.

## Reading results

- Vision models rank images well against references and judge fine differences poorly; use them for pairwise comparison and pass or fail, never for an absolute score. `review.md` is the procedure.
- Small or compressed images make vision models invent texture and medium (a low-resolution layered radar read as paper cut). Ask before writing an inferred material into a style.
- Checking an image costs nothing; generating one costs money. Check generously, regenerate only by decision.
