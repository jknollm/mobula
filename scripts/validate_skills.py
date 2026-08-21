#!/usr/bin/env python3
"""Validate repository-owned Mobula skills."""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILLS_ROOT = ROOT / ".agents" / "skills"
EXPECTED = {"develop-mobula"}
FRONTMATTER = re.compile(r"\A---\n(?P<header>.*?)\n---\n", re.DOTALL)
NAME = re.compile(r"^name:\s*(?P<value>[a-z0-9]+(?:-[a-z0-9]+)*)\s*$", re.MULTILINE)
DESCRIPTION = re.compile(r"^description:\s*(?P<value>\S.*)\s*$", re.MULTILINE)


def main() -> int:
    failures: list[str] = []
    observed = (
        {path.name for path in SKILLS_ROOT.iterdir() if path.is_dir()}
        if SKILLS_ROOT.is_dir()
        else set()
    )
    if observed != EXPECTED:
        failures.append(
            f"skill set mismatch: missing={sorted(EXPECTED - observed)!r}, "
            f"unexpected={sorted(observed - EXPECTED)!r}"
        )
    for skill_name in sorted(observed):
        skill_file = SKILLS_ROOT / skill_name / "SKILL.md"
        if not skill_file.is_file():
            failures.append(f"{skill_name}: missing SKILL.md")
            continue
        text = skill_file.read_text(encoding="utf-8")
        frontmatter = FRONTMATTER.match(text)
        if frontmatter is None:
            failures.append(f"{skill_name}: invalid frontmatter boundary")
            continue
        name = NAME.search(frontmatter.group("header"))
        description = DESCRIPTION.search(frontmatter.group("header"))
        if name is None or name.group("value") != skill_name:
            failures.append(f"{skill_name}: name must match directory")
        if description is None or description.group("value").startswith("[TODO:"):
            failures.append(f"{skill_name}: missing or unfinished description")
        if "[TODO:" in text:
            failures.append(f"{skill_name}: unfinished TODO placeholder")
        if re.search(r"/(?:afs|home|Users)/[^\s)`]+", text):
            failures.append(f"{skill_name}: private absolute path")
    if failures:
        print("Skill validation failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print(f"Validated {len(observed)} repository-owned Mobula skill.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
