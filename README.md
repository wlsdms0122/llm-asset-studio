# Asset Studio

Makes images in one consistent style with an AI agent: app icons, spot illustrations, images for a post. You find the style with the agent in a conversation, try it on a few subjects, and confirm it with reference images you pick. From then on every image is drawn in that style, and every one is kept in the archive.

The agent does all the drawing, through OpenRouter. You answer it either in the conversation or in the web studio, and both work on the same records.

The web studio is in English or Korean, chosen in its app bar. The questions the engine asks are in Korean.

This directory is an [open-package](https://github.com/wlsdms0122/open-package).

## With an agent

Have the agent read `document/workflow.md` first. It has the stages of a style, how sessions and rounds work, and every command in order. The rest of `document/` is read along the way.

With the web studio, the agent starts `open-package studio` and keeps watching `sessions/*/*/*/feedback.json` and `sessions/*/*/session.json` in the workspace. The studio only writes down your answers. When one arrives, the agent draws and publishes the next round, so it needs to be able to keep a watcher running in the background. If it can't, stay in the conversation: the agent sends a numbered sheet and you reply there.

Store the OpenRouter key once with `open-package key`. `open-package verify` runs the engine and the studio end to end in a throwaway workspace and spends nothing, so run it first.

Python 3.11 or later. `sheet` needs Pillow. `cutout` needs macOS 14 or later and Swift (the Xcode Command Line Tools).

## Commands

```
open-package studio                       # the web studio on http://127.0.0.1:8770
open-package session <command> ...        # sessions and rounds: new, open, next, publish, show, answer, confirm, add-model, delete
open-package generate <session> ...       # draw into a session through OpenRouter
open-package style <command> ...          # changes to a style: rename, delete, reference-add, reference-remove, use, model-remove
open-package sheet <session>              # the latest round as one numbered image, for the conversation
open-package models [--free]              # every image model on OpenRouter with its price, or only the free ones
open-package cutout <session> <image> ... # remove the background of images into a session, on this Mac, at no cost
open-package key                          # store the OpenRouter API key, typed or piped in
open-package verify                       # the engine and the studio end to end in a throwaway workspace, at no cost
```

## The workspace

Everything it makes and needs lives outside this directory, in `~/.config/asset-studio`. Set `ASSET_STUDIO_HOME` to keep it somewhere else. Every command runs inside it, so paths are relative to it.

```
styles/<style>/        a style and its records (kept)
  style.md             the style in words, independent of any model; fixed once confirmed
  references/          the images you picked as the style, sent with every generation
  prompting/<model>.md how this style is written as a prompt for one model, one per model it has
  model                the model images are made with now, one of those
  based-on             the confirmed style this one was made from
  archive/             every image made with the style and every image that became a reference, with index.jsonl
  ledger.jsonl         every generation, answer, confirm, and change to references or models
sessions/<style>/<id>/ one session's working files (not kept): the make session until confirm, generate sessions until you delete them, a model session until the model is added
cache/                 what OpenRouter says about models, kept for a day
key                    the OpenRouter API key, readable only by you
```

## What is inside

```
document/              what the agent knows and follows
  workflow.md          the stages of a style, sessions and rounds, the surfaces, and every command
  writing-styles.md    what a style is and how style.md is written
  ideation.md          how the agent, as the designer, works out an image with you and writes its brief
  prompting.md         how to write prompts for image models, for every style
  models.md            what each model can do, costs, and how it reads a prompt
  review.md            how every image is reviewed before you see it
source/
  engine/              Python, run as scripts
    style.py           a style folder, its records (archive, ledger), and the changes you make to it
    session.py         a style's sessions: rounds, answers, confirm, adding a model
    generate.py        image generation through OpenRouter
    capability.py      what a model accepts (references, sizes, images per call), read from OpenRouter
    catalog.py         every image model on OpenRouter with its price, and what each has cost here
    cutout.py          background removal into a session, through cutout.swift (macOS Vision)
    server.py          the web studio's server
    sheet.py           the latest round as one numbered image
    workspace.py       where the workspace is, and the key in it
  web/                 the web studio; its README.md is the design system
    i18n.js            every text on screen, in English with its Korean
    ui.css, ui.js      tokens and components
    app.css, app.js    the pages, built only from those components
    index.html         the shell
  verify.py            the end-to-end check behind `verify`
```

## License

[MIT](LICENSE)
