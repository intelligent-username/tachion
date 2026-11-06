"""
Progress Writer
"""

import sys


def ProgressWriter(done: int, total) -> None:
    """Render a single-line green progress bar."""
    bar_width = 30
    filled = int(bar_width * done / total)
    green = "\033[92m"
    reset = "\033[0m"
    bar = f"{green}{'=' * filled}{reset}{' ' * (bar_width - filled)}"
    sys.stdout.write(f"\rProcessed [{bar}] {done}/{total}")
    sys.stdout.flush()
    if done == total:
        sys.stdout.write("\n")

