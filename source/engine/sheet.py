#!/usr/bin/env python3
"""Draw the latest round of a session as one numbered contact sheet, for reviewing it in conversation.

Numbers and order match the web page, so an answer like "2 is closest" can go straight into
`session.py answer`. Needs Pillow.
"""

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

import workspace
from session import Session
from style import StyleError

CHECKER = 16
LABEL = 40


def main():
    arguments = parse_arguments()
    workspace.enter()
    try:
        session = Session.at(arguments.session)
    except StyleError as error:
        raise SystemExit(str(error))
    style = session.style
    current = session.latest()
    if current is None:
        raise SystemExit("no round to draw")

    candidates = current.candidates()
    if not candidates:
        raise SystemExit(f"round {current.number} has no images")
    columns = min(arguments.columns, len(candidates))
    rows = -(-len(candidates) // columns)
    size = arguments.size
    sheet = Image.new("RGB", (columns * size, rows * (size + LABEL)), "white")
    font = label_font(LABEL - 12)
    draw = ImageDraw.Draw(sheet)

    for index, path in enumerate(candidates):
        left, top = (index % columns) * size, (index // columns) * (size + LABEL)
        label = f"{index + 1}  {current.record.get('descriptions', {}).get(path, '')}".rstrip()
        while len(label) > 2 and draw.textlength(label, font=font) > size - 16:
            label = label[:-2] + "…"
        draw.text((left + 8, top + 6), label, fill="black", font=font)
        sheet.paste(tile(style.resolve(path), size), (left, top + LABEL))

    output = Path(arguments.out or current.directory / "sheet.png")
    sheet.save(output)
    print(output)


def label_font(size):
    """A font that covers Korean descriptions where the system has one, else Pillow's default."""
    for path in ("/System/Library/Fonts/AppleSDGothicNeo.ttc", "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"):
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size=size)


def parse_arguments():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("session", help="the session folder, such as sessions/app-icon/20261011-230012")
    parser.add_argument("--out", help="PNG to write; defaults to sheet.png in the round directory")
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
