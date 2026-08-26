from __future__ import annotations

import os
import re
import subprocess
import sys
import venv
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
REQUIREMENTS = ROOT / "requirements-screenshots.txt"
VENV = ROOT / ".venv-screenshots"


def fail(message: str) -> None:
    raise SystemExit(f"Store screenshot tool refused: {message}")


def expected_pillow_version() -> str:
    try:
        lines = [
            line.strip()
            for line in REQUIREMENTS.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        ]
    except OSError as error:
        fail(f"cannot read {REQUIREMENTS.name} ({error})")
    if len(lines) != 1:
        fail(f"{REQUIREMENTS.name} must contain exactly one pinned dependency")
    match = re.fullmatch(r"Pillow==([0-9]+(?:\.[0-9]+){2})", lines[0])
    if not match:
        fail(f"{REQUIREMENTS.name} must pin Pillow with an exact x.y.z version")
    return match.group(1)


def venv_python() -> Path:
    if os.name == "nt":
        return VENV / "Scripts" / "python.exe"
    return VENV / "bin" / "python"


def installed_pillow(python: Path) -> str | None:
    result = subprocess.run(
        [str(python), "-c", "import PIL; print(PIL.__version__)"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        return None
    return result.stdout.strip()


def ensure_environment(expected: str) -> Path:
    if sys.version_info < (3, 10):
        fail(f"Python 3.10 or newer is required; found {sys.version.split()[0]}")

    python = venv_python()
    if not python.is_file():
        print(f"Creating isolated screenshot environment at {VENV}")
        venv.EnvBuilder(with_pip=True).create(VENV)
    if not python.is_file():
        fail("virtual-environment Python was not created")

    if installed_pillow(python) != expected:
        print(f"Installing pinned screenshot dependency Pillow=={expected}")
        subprocess.check_call(
            [
                str(python),
                "-m",
                "pip",
                "install",
                "--disable-pip-version-check",
                "--no-input",
                "--only-binary=:all:",
                "--no-deps",
                "-r",
                str(REQUIREMENTS),
            ],
            cwd=ROOT,
        )
    actual = installed_pillow(python)
    if actual != expected:
        fail(f"isolated environment has Pillow {actual!r}, expected {expected}")
    return python


def run_script(python: Path, name: str) -> None:
    subprocess.check_call([str(python), str(SCRIPTS / name)], cwd=ROOT)


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in {"prepare", "refresh"}:
        fail("usage: run-store-screenshot-tool.py prepare|refresh")
    expected = expected_pillow_version()
    python = ensure_environment(expected)
    if sys.argv[1] == "refresh":
        run_script(python, "promote-browser-screenshots.py")
    run_script(python, "prepare-store-screenshots.py")


if __name__ == "__main__":
    main()
