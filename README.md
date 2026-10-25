# Asset Studio

Makes consistent images for a purpose with an AI agent: an app's icons, the illustrations of a blog, images for a product. A project holds the purpose and the styles made for it. You find a style with the agent in a conversation, try it on a fixed set of test requests (probes), and pick reference images from them. From then on the style keeps improving: every change is a revision, a change the agent proposes is tried on the probes before and after, and every image records the revision it was drawn with.

Images are made on the project's canvas: each request is a node with its images, and refining an image is a new node built on it, so the lineage stays visible. Styles can build on each other, and a guide (a palette, a design system) lends its rules to every style that extends it.

The agent does all the drawing, through OpenRouter. You work with it either in the conversation or in the web studio, and both work on the same records. The web studio is in English or Korean, chosen in its app bar. The questions the engine asks are in Korean.

This directory is an [open-package](https://github.com/wlsdms0122/open-package).

## With an agent

Have the agent read `document/workflow.md` first. It has how projects, styles, revisions, proposals, probes, nodes, and threads work, and every command in order. The rest of `document/` is read along the way.

The web studio is the default. The agent starts `open-package studio`, and everything it has to show or ask you goes onto the page: a thread round, a node's note, a probe run, a proposal. The studio only writes down what you do. The agent waits for work with `open-package watch` running in the background, then draws and publishes. If it can't keep a command running in the background, or you ask for it, stay in the conversation: the agent sends a numbered sheet and you reply there.

Store the OpenRouter key once with `open-package key`. `open-package verify` runs the engine and the studio end to end in a throwaway workspace and spends nothing, so run it first.

Python 3.11 or later. `sheet` needs Pillow. The background removal tool needs macOS 14 or later and Swift (the Xcode Command Line Tools).

## Commands

```
open-package studio                       # the web studio on http://127.0.0.1:8770
open-package watch                        # wait until the agent has work, and print where
open-package project <command> ...        # new, rename, delete, subject-add, subject-remove
open-package style <command> ...          # new, revise, effective, materialize, annotate, set-check, restore, extends, rename, delete, reference-add, reference-remove, use, model-remove
open-package proposal <command> ...       # propose, accept, reject, show
open-package probe <command> ...          # request, publish, show
open-package node <command> ...           # add (generation, tool, upload), publish, show, delete
open-package thread <command> ...         # open, next, publish, show, answer, rename, delete
open-package generate <target> ...        # draw into a node, a probe run, or a thread's next round through OpenRouter
open-package sheet <target>               # a thread round, a node, or a run as one numbered image, for the conversation
open-package models [--free]              # every image model on OpenRouter with its price, or only the free ones
open-package key                          # store the OpenRouter API key, typed or piped in
open-package verify                       # the engine and the studio end to end in a throwaway workspace, at no cost
```

## The workspace

Everything it makes and needs lives outside this directory, in `~/.config/asset-studio`. Set `ASSET_STUDIO_HOME` to keep it somewhere else. Every command runs inside it, so paths are relative to it.

```
projects/<project>/
  project.md                 what the images are for, where they are seen, the brand, the decisions for every image
  styles/<style>/
    style.md                 the style in words, independent of any model
    style.json               the model in use, the styles it extends, whether it is a guide
    probes.md                the fixed test requests
    prompting/<model>.md     how this style is written as a prompt for one model
    references/              the images you picked, each with its annotation (role, what it shows, what to take and leave)
    revisions.jsonl          every revision: the hash of every file above
    proposals/<id>/          changes the agent proposed, waiting for you or decided
    runs/<n>/                probe runs: the probes drawn with one revision or proposal
  subjects/                  subject references the project reuses (a mascot, a logo's shape)
  nodes/<id>/                one request and its result: node.json, result.json, the images, calls.jsonl
  threads/<id>/              conversations about a style or an image, in rounds
  canvas.json                where the nodes sit on the canvas
objects/                     every version of every style file and reference, by hash
cache/                       what OpenRouter says about models, kept for a day
agent.json                   when an agent last looked for work
key                          the OpenRouter API key, readable only by you
```

## What is inside

```
document/              what the agent knows and follows
  workflow.md          projects, styles and revisions, proposals and probes, references, nodes, threads, the surfaces, every command
  writing-styles.md    what a style is and how style.md is written
  ideation.md          how the agent, as the designer, works out an image with you and writes its brief
  prompting.md         how to write prompts for image models, for every style
  models.md            what each model can do, costs, and how it reads a prompt
  review.md            how every image is reviewed before you see it
source/
  engine/              Python, run as scripts
    workspace.py       where the workspace is, the objects store, the record conventions, and the key
    project.py         a project: its brief, subjects, and canvas
    style.py           a style: its files, revisions, effective style (extends), references and annotations
    proposal.py        a change to a style waiting for you
    probe.py           probe runs
    node.py            nodes: generations, tools, uploads
    thread.py          threads: rounds and answers
    watch.py           the agent's wait for work
    generate.py        image generation through OpenRouter
    capability.py      what a model accepts (references, sizes, images per call), read from OpenRouter
    catalog.py         every image model on OpenRouter with its price, and what each has cost here
    cutout.swift       background removal (macOS Vision)
    server.py          the web studio's server
    sheet.py           a round, a node, or a run as one numbered image
  web/                 the web studio; its README.md is the design system and the pages
  verify.py            the end-to-end check behind `verify`
```

## License

[MIT](LICENSE)
