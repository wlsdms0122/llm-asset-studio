# Models

What the agent knows about image models: what each can do, what it costs, and how it reads a prompt. Models and prices change every few months, so the facts below carry the date they were checked; before relying on one, read the live values. `generate.py` already reads each model's accepted options and caches them in the workspace's `cache/` for a day.

```
# every image model on OpenRouter with the price of one image and the references it takes, cached for a day
open-package models
open-package models --free
# what one model accepts: endpoints[].supported_parameters (input_references max, n, seed, background, ...)
curl -s https://openrouter.ai/api/v1/images/models/<id>/endpoints
```

The real cost of every call comes back in `usage.cost` and is written to the style's ledger.

## Access

- OpenRouter `POST /api/v1/images`: one key, one schema (`input_references`, `n`, `aspect_ratio`, `resolution`, `quality`, `background`, `seed`, `provider.options`). Failed calls are not billed.
- No LoRA or fine-tuning through OpenRouter; styles are held by words and references only.
- No model takes a `negative_prompt` parameter there (checked 2026-10-11).

## Choosing a model

- Discovery and ideation candidates: the draft model, below.
- Sample and generate: one model per style, chosen for how well it renders that kind of look, whether it takes references, and price. Seedream 5.0 Flash is the current default.
- Comparing expensive models (GPT Image 2.5, Recraft V4 Styles, Nano Banana 2.1) is worth it only when a style's first-try acceptance is low.
- New models are unstable for their first days (one had about 43% availability on launch day). Prefer a model that has been out a few weeks.

## The draft model

Discovery and ideation candidates are drafts. They show which way a style or an image goes, not its quality, so they come from the cheapest model that can show it, not from the style's model. Free models come and go, so the draft model is chosen when a session's first drafts are due:

1. `open-package models --free` lists the image models that are free today. If one can show what the drafts need, it is the draft model.
2. Otherwise (the command exits 1 when nothing is free), the draft model is the first of these that `open-package models` still lists and that can show it:
   - `openai/gpt-image-1-mini` with `--quality low`: about $0.002 an image, up to 16 references, up to 10 images a call, transparent backgrounds
   - `openai/gpt-image-2` with `--quality low`: about $0.006, up to 16 references, up to 10 a call
   - `recraft/recraft-v4.1-flash`: $0.007, text only, up to 6 a call

A draft built from the user's images needs a model that takes references. A paid draft model is used only after the user agrees: the agent names the model and the price of one image, and the user's yes covers that session's drafts. When a candidate leaves the list, or a cheaper one that takes references and reads a style's rendering appears, this list is updated.

## Facts (checked 2026-10-09 to 10-11)

| model | references | n per call | seed | transparent | per image (1K) |
|---|---|---|---|---|---|
| `bytedance-seed/seedream-5-0-flash` | 14, free | 1 | yes | | $0.018 |
| `openai/gpt-image-1-mini` (low) | 16 | 10 | | yes | about $0.002 |
| `openai/gpt-image-2` (low) | 16 | 10 | | | about $0.006 |
| `openai/gpt-image-2.5-flare` / `sunburst` | 16 | 10 | | yes | token priced, about $0.006 low to $0.05 high |
| `recraft/recraft-v4.1-flash` | 0 | 6 | | | $0.007 |
| `recraft/recraft-v4-styles` | 1 to 10 style images | | provider option | | $0.035, vector $0.05 |
| Nano Banana 2.1 (Gemini) | 14 | | | | about $0.034 |
| `tencent/hy-image-v3.5-preview` | 20 | | yes | | between $0.007 and $0.024, check `usage.cost` |
| Krea 2 Medium Turbo | style references, moodboards | | yes | | about $0.015 |
| FLUX.2 klein | 4 | | yes | | $0.014 per megapixel |

- Billed per image: resolution does not change the cost, so use the default. Billed per megapixel or token: lower the resolution to save.
- Many models rewrite prompts on their own (FLUX 3, Qwen, Hy, Seedream, Krea, Ideogram, Gemini's thinking step). Where the style wording must arrive as written, turn it off: Qwen `prompt_extend=false`, Krea `creativity=raw`.
- Open weights usable commercially, if the tool ever runs models itself: FLUX.2 Klein 4B, Z-Image Turbo, Qwen-Image 2512, ERNIE-Image (Apache 2.0), HiDream-O1, LongCat (MIT). Tencent models exclude Korea from their license; Qwen-Image 2.1, FLUX.2 dev, and Ideogram 4.0 weights are non-commercial.

## How each model reads a prompt

- Seedream 5.0: each clause is a directive and anything unmentioned stays loose, so restate the rendering every time. Subject first, natural sentences, under about 600 words. References are best named by what they show. A plain studio shot on a plain background is the strongest reference. It draws a crop shape it is told about, and a named material brings its photographic look (a glass vase grew a thin outline, leathery leaves a sheen).
- GPT Image: references as "Image 1: role", in order. Starts from the scene. Accepts short "no X" lines but positive wording still works better. Repeat what must be kept on every edit.
- Nano Banana (Gemini): references by role ("the attached sketch"); subject first; officially renders Korean text.
- FLUX.2: starts from the medium; ties each hex color to one object; pro and max accept a JSON prompt.
- Recraft: three to six words go interpretive, long prompts are followed closely. Styles take the style images in their own channel and the text describes only the subject.
- Hy: references as `@Image1`. Krea: style references in their own channel.

## Adding a model to a confirmed style

A model session (`workflow.md`, Prompting per model) writes the model's prompting file and tries it with the user. To write it:

1. Read the model's endpoint (`supported_parameters`: references, aspect ratios, n, seed, background) and its own prompting guide, and add what is general about it to the table and the section above.
2. Start from `style.md` and the current model's prompting file; keep the style paragraph's meaning and rewrite its form for how this model reads (order, length, how references are named).
3. Draw with the references attached and review side by side with the references and with the current model's results for the same request. Drift on a property `style.md` pins is fixed in the new file before the next image.

Style-similarity embeddings help rank but are not calibrated: CSD is the best style-only embedding and still needs comparing against the current model and a no-style baseline rather than a fixed threshold. CLIP, DINO, and DreamSim mix content with style.
