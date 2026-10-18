#!/usr/bin/env python3
"""The workspace: what asset-studio keeps outside the package.

  ~/.config/asset-studio/   or the directory named by ASSET_STUDIO_HOME
    styles/                 the user's styles and their records
    sessions/               the sessions' working files
    cache/                  what OpenRouter says about models, kept for a day
    key                     the OpenRouter API key, readable by the user only

Every command runs inside the workspace, so the paths it takes and the paths records hold are relative to it.

Commands:
  key                       store the OpenRouter API key, read from stdin
"""

import argparse
import getpass
import os
import sys
from pathlib import Path

HOME = Path(os.environ.get("ASSET_STUDIO_HOME") or "~/.config/asset-studio").expanduser().resolve()
STYLES = HOME / "styles"
CACHE = HOME / "cache"
KEY = HOME / "key"


def enter():
    HOME.mkdir(parents=True, exist_ok=True)
    os.chdir(HOME)


def read_key():
    """The key is never printed."""
    if not KEY.is_file():
        sys.exit(f"no OpenRouter key at {KEY}; store one with `open-package key`")
    return KEY.read_text().strip()


def store_key(key):
    HOME.mkdir(parents=True, exist_ok=True)
    draft = KEY.with_name(".key")
    draft.unlink(missing_ok=True)
    with os.fdopen(os.open(draft, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as file:
        file.write(key + "\n")
    draft.replace(KEY)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_subparsers(dest="command", required=True).add_parser("key")
    parser.parse_args()

    key = (getpass.getpass("OpenRouter API key: ") if sys.stdin.isatty() else sys.stdin.readline()).strip()
    if not key:
        sys.exit("no key given")
    store_key(key)
    print(KEY)


if __name__ == "__main__":
    main()
