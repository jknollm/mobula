from __future__ import annotations

from pathlib import Path

from mobula.install import (
    build_native_install_command,
    build_native_install_plan,
    find_repo_root,
    recommended_native_extras,
)


def test_recommended_native_extras_for_apple_silicon() -> None:
    assert recommended_native_extras(system="Darwin", machine="arm64") == ("metal",)


def test_recommended_native_extras_for_non_apple_host() -> None:
    assert recommended_native_extras(system="Linux", machine="x86_64") == ()


def test_build_native_install_plan_reports_reason() -> None:
    plan = build_native_install_plan(system="Darwin", machine="arm64")
    assert plan.extras == ("metal",)
    assert plan.has_acceleration is True
    assert "Apple Silicon" in plan.reasons[0]


def test_build_native_install_command_for_local_editable_repo(tmp_path) -> None:
    cmd = build_native_install_command(package_target=str(tmp_path), include_dev=True, editable=True, upgrade=True)
    assert cmd[1:6] == ["-m", "pip", "install", "--upgrade", "-e"]
    assert cmd[-1] == f"{tmp_path}[dev,native]"


def test_find_repo_root_from_source_tree() -> None:
    root = find_repo_root(Path(__file__).resolve())
    assert root is not None
    assert (root / "pyproject.toml").is_file()
