# Asset Studio

Makes consistent images for a purpose with an AI agent: an app's icons, the illustrations of a blog, images for a product. A project holds the purpose and the styles made for it. A style is its words, which the agent writes with you in a conversation, and its references, the material you choose for it: images, and texts such as a palette or design tokens. The style keeps improving: every change is a revision, you draw with whichever revision you choose (the latest unless you pick another), and every image records the revision it was drawn with.

Material is made on the project's canvas: each request is a node with what came out of it, images or a text the agent wrote, and refining one is a new node built on it, so the lineage stays visible. Anything on the canvas can go into a style's references.

The agent does all the drawing, through OpenRouter. You work with it either in the conversation or in the web studio, and both work on the same records. The web studio is in English or Korean, chosen in its app bar. The questions the engine asks are in Korean.

This directory is an [open-package](https://github.com/wlsdms0122/open-package).

## With an agent

Have the agent read `document/workflow.md` first. It has how projects, styles, revisions, references, nodes, and threads work, and every command in order. The rest of `document/` is read along the way.

The web studio is the default. The agent starts `open-package studio`, and everything it has to show or ask you goes onto the page: a thread round, a node's note, a revision's reason. The studio only writes down what you do. The agent waits for work with `open-package watch` running in the background, then draws and publishes. If it can't keep a command running in the background, or you ask for it, stay in the conversation: the agent sends a numbered sheet and you reply there.

Store the OpenRouter key once with `open-package key`. `open-package verify` runs the engine and the studio end to end in a throwaway workspace and spends nothing, so run it first.

Python 3.11 or later. `sheet` needs Pillow. The background removal tool needs macOS 14 or later and Swift (the Xcode Command Line Tools).

## Commands

```
open-package studio                       # the web studio on http://127.0.0.1:8770
open-package watch                        # wait until the agent has work, and print where
open-package project <command> ...        # new, rename, delete
open-package style <command> ...          # new, revise, show, materialize, annotate, set-check, restore, rename, delete, reference-add, reference-remove, use, model-remove
open-package node <command> ...           # add (a generation drawn or written, a tool, an upload), publish, show, delete
open-package thread <command> ...         # open, next, publish, show, answer, rename, delete
open-package generate <target> ...        # draw into a node or a thread's next round through OpenRouter
open-package sheet <target>               # a thread round or a node as one numbered image, for the conversation
open-package models [--free]              # every image model on OpenRouter with its price, or only the free ones
open-package key                          # store the OpenRouter API key, typed or piped in
open-package verify                       # the engine and the studio end to end in a throwaway workspace, at no cost
```

## The workspace

Everything it makes and needs lives outside this directory, in `~/.config/asset-studio`. Set `ASSET_STUDIO_HOME` to keep it somewhere else. Every command runs inside it, so paths are relative to it.

```
projects/<project>/
  project.md                 the brief: what the images are for, where they are seen, the brand, the decisions for every image
  styles/<style>/
    style.md                 the style in words, independent of any model
    style.json               the model in use
    prompting/<model>.md     how this style is written as a prompt for one model
    references/              what you chose: images, each with its annotation (role, what it shows, what to take and
                             leave), and texts (.md)
    revisions.jsonl          every revision: the hash of every file above, what changed, and why
  nodes/<id>/                one request and what came out: node.json, result.json, the images or text.md, calls.jsonl
  threads/<id>/              conversations about the project's brief, a style, or an image, in rounds
  canvas.json                where the nodes sit on the canvas and the groups they are in
objects/                     every version of every style file and reference, by hash
cache/                       what OpenRouter says about models, kept for a day
agent.json                   when an agent last looked for work
key                          the OpenRouter API key, readable only by you
```

## What is inside

```
document/              what the agent knows and follows
  workflow.md          projects, styles and revisions, references, nodes, threads, the surfaces, every command
  writing-styles.md    what a style is and how style.md is written
  ideation.md          how the agent, as the designer, works out an image with you and writes its brief
  prompting.md         how to write prompts for image models, for every style
  models.md            what each model can do, costs, and how it reads a prompt
  review.md            how every image is reviewed before you see it
source/
  engine/              Python, run as scripts
    workspace.py       where the workspace is, the objects store, the record conventions, and the key
    project.py         a project: its brief and canvas
    style.py           a style: its files, revisions, references and annotations
    node.py            nodes: generations drawn or written, tools, uploads
    thread.py          threads: rounds and answers
    watch.py           the agent's wait for work
    generate.py        image generation through OpenRouter
    capability.py      what a model accepts (references, sizes, images per call), read from OpenRouter
    catalog.py         every image model on OpenRouter with its price, and what each has cost here
    cutout.swift       background removal (macOS Vision)
    server.py          the web studio's server
    sheet.py           a round or a node as one numbered image
  web/                 the web studio; its README.md is the design system and the pages
  verify.py            the end-to-end check behind `verify`
```

## License

[MIT](LICENSE)
