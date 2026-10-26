#!/usr/bin/env python3
"""Draw images as one numbered contact sheet, for showing them in conversation.

  a thread      the images of the nodes its latest round shows, numbered as `thread answer --picked` reads them
  a node        its images, in display order

Needs Pillow.
"""

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

import workspace
from node import Node
from project import Project
from thread import Thread
from workspace import RecordError

CHECKER = 16
LABEL = 40


def main():
    arguments = parse_arguments()
    workspace.enter()
    try:
        project, paths, labels, default = shown(arguments.target)
    except RecordError as error:
        raise SystemExit(str(error))
    if not paths:
        raise SystemExit("no images to draw")
    columns = min(arguments.columns, len(paths))
    rows = -(-len(paths) // columns)
    size = arguments.size
    sheet = Image.new("RGB", (columns * size, rows * (size + LABEL)), "white")
    font = label_font(LABEL - 12)
    draw = ImageDraw.Draw(sheet)

    for index, (path, text) in enumerate(zip(paths, labels)):
        left, top = (index % columns) * size, (index // columns) * (size + LABEL)
        label = text.rstrip()
        while len(label) > 2 and draw.textlength(label, font=font) > size - 16:
            label = label[:-2] + "…"
        draw.text((left + 8, top + 6), label, fill="black", font=font)
        sheet.paste(tile(project.resolve(path), size), (left, top + LABEL))

    output = Path(arguments.out or default / "sheet.png")
    sheet.save(output)
    print(output)


def shown(path):
    """The project, the images in order labeled with their numbers, and where the sheet goes by default."""
    parts = workspace.relative(workspace.resolve(path)).split("/")
    if len(parts) == 4 and parts[2] == "threads":
        thread = Thread.at(path)
        current = thread.latest()
        if current is None:
            raise RecordError("no round to draw")
        shown = [item for item in current.candidates(current.shown({node.id: node for node in thread.project.nodes()})) if item["image"]]
        return thread.project, [item["path"] for item in shown], [f"{item['number']}  {item['image']['description'] or ''}" for item in shown], current.directory
    if len(parts) == 4 and parts[2] == "nodes":
        view = Node.at(path).view()
        return Project.at(path), [image["path"] for image in view["images"]], [f"{number}  {image['description'] or ''}" for number, image in enumerate(view["images"], 1)], workspace.resolve(path)
    raise RecordError(f"{path} is not a thread or a node")


def label_font(size):
    """A font that covers Korean descriptions where the system has one, else Pillow's default."""
    for path in ("/System/Library/Fonts/AppleSDGothicNeo.ttc", "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"):
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size=size)


def parse_arguments():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("target", help="a thread or a node folder")
    parser.add_argument("--out", help="PNG to write; defaults to sheet.png in the round or node folder")
    parser.add_argument("--columns", type=int, default=3)
    parser.add_argument("--size", type=int, default=512, help="tile width in pixels")
    return parser.parse_args()


def tile(path, size):
    """The image fitted into a square over a checkerboard, so transparency stays visible."""
    image = Image.open(path).convert("RGBA")
    image.thumbnail((size, size))
    background = Image.new("RGBA", (size, size), "white")
    shade = ImageDraw.Draw(background)
    for y in range(0, size, CHECKER):
        for x in range((y // CHECKER % 2) * CHECKER, size, CHECKER * 2):
            shade.rectangle((x, y, x + CHECKER - 1, y + CHECKER - 1), fill=(232, 232, 232, 255))
    background.alpha_composite(image, ((size - image.width) // 2, (size - image.height) // 2))
    return background.convert("RGB")


if __name__ == "__main__":
    main()
