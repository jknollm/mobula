#!/usr/bin/env python3
"""Validate repository collaboration files and pull-request declarations."""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / ".github" / "pull_request_template.md"
CODEOWNERS = ROOT / ".github" / "CODEOWNERS"
CONTRIBUTING = ROOT / "CONTRIBUTING.md"
WORKFLOW = ROOT / ".github" / "workflows" / "collaboration-policy.yml"
RISK_OPTIONS = ("Routine", "Review-sensitive", "Ambiguous")
ACCEPTANCE_OPTIONS = (
    "Human acceptance required",
    "No human acceptance required",
)


def checked(body: str, label: str) -> bool:
    return (
        re.search(
            rf"(?im)^-\s*\[[xX]\]\s*{re.escape(label)}\s*$",
            body,
        )
        is not None
    )


def field(body: str, label: str) -> str | None:
    match = re.search(
        rf"(?im)^-\s*{re.escape(label)}:\s*(?P<value>.*?)\s*$",
        body,
    )
    if match is None:
        return None
    value = match.group("value").strip()
    if not value or value.startswith("<!--"):
        return None
    return value


def validate_files(failures: list[str]) -> None:
    for path in (TEMPLATE, CODEOWNERS, CONTRIBUTING, WORKFLOW):
        if not path.is_file():
            failures.append(f"missing collaboration file: {path.relative_to(ROOT)}")
    if failures:
        return

    template = TEMPLATE.read_text(encoding="utf-8")
    for heading in (
        "## Issue and ownership",
        "## Risk classification",
        "## Human acceptance",
        "## Verification and evidence",
        "## Review record",
    ):
        if heading not in template:
            failures.append(f"pull request template lacks {heading}")
    for option in (*RISK_OPTIONS, *ACCEPTANCE_OPTIONS):
        if f"- [ ] {option}" not in template:
            failures.append(f"pull request template lacks option {option!r}")

    owners = CODEOWNERS.read_text(encoding="utf-8")
    if re.search(r"(?m)^\*\s+@\S+", owners) is None:
        failures.append("CODEOWNERS lacks a repository-wide owner")

    contributing = CONTRIBUTING.read_text(encoding="utf-8")
    for term in ("Routine", "Review-sensitive", "Ambiguous"):
        if term.casefold() not in contributing.casefold():
            failures.append(f"CONTRIBUTING.md lacks {term!r} guidance")


def validate_pull_request(failures: list[str]) -> None:
    event_path = os.environ.get("GITHUB_EVENT_PATH")
    if not event_path:
        return
    event = json.loads(Path(event_path).read_text(encoding="utf-8"))
    pull_request = event.get("pull_request")
    if pull_request is None:
        return
    body = pull_request.get("body") or ""

    selected_risks = [option for option in RISK_OPTIONS if checked(body, option)]
    if len(selected_risks) != 1:
        failures.append("pull request must select exactly one risk classification")

    selected_acceptance = [
        option for option in ACCEPTANCE_OPTIONS if checked(body, option)
    ]
    if len(selected_acceptance) != 1:
        failures.append("pull request must select exactly one acceptance option")

    if field(body, "Issue") is None:
        failures.append("pull request must identify its durable issue")
    if field(body, "Owning repository") is None:
        failures.append("pull request must identify its owning repository")
    if field(body, "Reason") is None:
        failures.append("pull request must explain the acceptance classification")

    if selected_risks and selected_risks[0] != "Routine":
        if selected_acceptance != ["Human acceptance required"]:
            failures.append(
                "review-sensitive and ambiguous changes require human acceptance"
            )
    if selected_acceptance == ["Human acceptance required"]:
        owner = field(body, "Acceptance owner")
        if owner is None:
            failures.append("human acceptance requires a named acceptance owner")


def main() -> int:
    failures: list[str] = []
    validate_files(failures)
    validate_pull_request(failures)
    if failures:
        print("Collaboration policy validation failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print("Collaboration policy validation passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
