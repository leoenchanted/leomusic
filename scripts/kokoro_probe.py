from __future__ import annotations

import importlib.util
import sys


def main() -> int:
    missing = []

    for package in ("kokoro", "soundfile"):
        if importlib.util.find_spec(package) is None:
            missing.append(package)

    if missing:
        print("Missing Python packages:")
        for package in missing:
            print(f"  - {package}")
        print()
        print("Install with:")
        print(r".\.venv\Scripts\python.exe -m pip install kokoro soundfile")
        return 1

    print("Kokoro Python packages are importable.")
    print("The real synthesis provider will be wired in a later step.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
