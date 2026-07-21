#!/usr/bin/env python3
"""AI model price crawler command-line entry point."""

import argparse
import sys

from orchestrator import crawl


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build verified frontend JSON from Oken's public API"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="fetch and normalize the snapshot without writing files",
    )
    return crawl(dry_run=parser.parse_args().dry_run)


if __name__ == "__main__":
    sys.exit(main())
