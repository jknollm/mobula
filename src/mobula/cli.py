from __future__ import annotations

import argparse
import os
import sys
import threading
import webbrowser
from pathlib import Path

import uvicorn

from mobula.install import (
    build_native_install_command,
    build_native_install_plan,
    native_extra_selector,
    resolve_install_target,
)
from mobula.paths import default_data_dir


def _build_serve_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Launch the mobula local cube viewer.")
    parser.add_argument("--host", default="127.0.0.1", help="bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="bind port (default: 8000)")
    parser.add_argument("--reload", action="store_true", help="enable auto-reload for local development")
    parser.add_argument(
        "--data-dir",
        default=str(default_data_dir()),
        help="base data directory for seeded local datasets (default: ~/.mobula/data)",
    )
    return parser


def _build_install_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mobula install-acceleration",
        description="Install host-native acceleration dependencies into the current Python environment.",
    )
    parser.add_argument("--apply", action="store_true", help="execute the pip install command")
    parser.add_argument("--editable", action="store_true", help="use editable install when a local repo checkout is detected")
    parser.add_argument("--include-dev", action="store_true", help="include the dev extra alongside native acceleration")
    parser.add_argument("--no-upgrade", action="store_true", help="do not pass --upgrade to pip")
    return parser


def _run_serve(argv: list[str]) -> None:
    parser = _build_serve_parser()
    args = parser.parse_args(argv)

    os.environ["MOBULA_DATA_DIR"] = str(Path(args.data_dir).expanduser().resolve())
    url_host = "127.0.0.1" if args.host in ("0.0.0.0", "::") else args.host
    url = f"http://{url_host}:{args.port}"
    threading.Timer(0.8, lambda: webbrowser.open_new_tab(url)).start()
    uvicorn.run("mobula.main:app", host=args.host, port=args.port, reload=args.reload)


def _run_install_acceleration(argv: list[str]) -> int:
    parser = _build_install_parser()
    args = parser.parse_args(argv)

    plan = build_native_install_plan()
    if not plan.has_acceleration:
        print(plan.reasons[0])
        return 0

    for reason in plan.reasons:
        print(reason)

    target = resolve_install_target()
    cmd = build_native_install_command(
        package_target=target,
        include_dev=args.include_dev,
        editable=args.editable,
        upgrade=not args.no_upgrade,
    )
    print("Recommended extra:", native_extra_selector())
    print("Command:")
    print(" ".join(cmd))

    if not args.apply:
        return 0

    import subprocess

    proc = subprocess.run(cmd, check=False)
    return int(proc.returncode)


def main(argv: list[str] | None = None) -> None:
    raw_argv = list(sys.argv[1:] if argv is None else argv)
    if raw_argv and raw_argv[0] == "install-acceleration":
        raise SystemExit(_run_install_acceleration(raw_argv[1:]))
    _run_serve(raw_argv)


if __name__ == "__main__":
    main()
