from __future__ import annotations

import platform
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AccelerationInstallPlan:
    extras: tuple[str, ...]
    reasons: tuple[str, ...]

    @property
    def has_acceleration(self) -> bool:
        return bool(self.extras)


def recommended_native_extras(*, system: str | None = None, machine: str | None = None) -> tuple[str, ...]:
    resolved_system = str(system or platform.system()).strip().lower()
    resolved_machine = str(machine or platform.machine()).strip().lower()
    if resolved_system == "darwin" and resolved_machine in {"arm64", "aarch64"}:
        return ("metal",)
    return ()


def build_native_install_plan(*, system: str | None = None, machine: str | None = None) -> AccelerationInstallPlan:
    extras = recommended_native_extras(system=system, machine=machine)
    if not extras:
        return AccelerationInstallPlan(extras=(), reasons=("No host-specific acceleration package is configured for this platform.",))
    if extras == ("metal",):
        return AccelerationInstallPlan(
            extras=extras,
            reasons=("Apple Silicon host detected. Installing the Metal/MPS compute dependency set.",),
        )
    return AccelerationInstallPlan(extras=extras, reasons=("Installing host-native acceleration dependencies.",))


def native_extra_selector() -> str:
    return "native"


def resolve_install_target(start: Path | None = None) -> str:
    cwd_root = find_repo_root(Path.cwd())
    if cwd_root is not None:
        return str(cwd_root)
    root = find_repo_root(start or Path(__file__).resolve())
    if root is not None:
        return str(root)
    return "mobula"


def find_repo_root(start: Path) -> Path | None:
    current = start.resolve()
    for candidate in (current, *current.parents):
        if (candidate / "pyproject.toml").is_file() and (candidate / "src" / "mobula").is_dir():
            return candidate
    return None


def build_native_install_command(
    *,
    package_target: str,
    include_dev: bool = False,
    editable: bool = False,
    upgrade: bool = True,
) -> list[str]:
    extras = ["native"]
    if include_dev:
        extras.insert(0, "dev")
    target = f"{package_target}[{','.join(extras)}]"
    cmd = [sys.executable, "-m", "pip", "install"]
    if upgrade:
        cmd.append("--upgrade")
    if editable and Path(package_target).exists():
        cmd.extend(["-e", target])
    else:
        cmd.append(target)
    return cmd


def install_native_acceleration(
    *,
    include_dev: bool = False,
    editable: bool = False,
    upgrade: bool = True,
    package_target: str | None = None,
) -> subprocess.CompletedProcess[str]:
    target = package_target or resolve_install_target()
    cmd = build_native_install_command(
        package_target=target,
        include_dev=include_dev,
        editable=editable,
        upgrade=upgrade,
    )
    return subprocess.run(cmd, text=True, check=False)
