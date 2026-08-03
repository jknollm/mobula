from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import webbrowser
from pathlib import Path
from urllib.parse import quote

from mobula.install import (
    build_native_install_command,
    build_native_install_plan,
    native_extra_selector,
    resolve_install_target,
)
from mobula.paths import default_data_dir


def _scene_viewer_url(base_url: str, scene_id: str) -> str:
    return f"{base_url.rstrip('/')}/?scene_id={quote(scene_id, safe='')}"


def _build_serve_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Launch the mobula local cube viewer.")
    parser.add_argument("--host", default="127.0.0.1", help="bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="bind port (default: 8000)")
    parser.add_argument("--reload", action="store_true", help="enable auto-reload for local development")
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="serve without opening a browser tab (for an owning launcher)",
    )
    parser.add_argument(
        "--data-dir",
        default=str(default_data_dir()),
        help="base data directory for seeded local datasets (default: ~/.mobula/data)",
    )
    parser.add_argument(
        "--scene-snapshot",
        help="register a local mobula.scene-snapshot/v1 JSON manifest and open its Scene",
    )
    parser.add_argument("--scene-source-url", help="authenticated mobula.scene-source/v2 runtime base URL")
    parser.add_argument("--scene-source-token", help="bearer token for --scene-source-url")
    parser.add_argument(
        "--scene-source-token-env",
        help="read the Scene source bearer token from this environment variable",
    )
    parser.add_argument("--initial-scene", help="open this already registered Scene id")
    return parser


def _build_install_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mobula install-acceleration",
        description="Install host-native acceleration dependencies into the current Python environment.",
    )
    parser.add_argument("--apply", action="store_true", help="execute the pip install command")
    parser.add_argument(
        "--editable", action="store_true", help="use editable install when a local repo checkout is detected"
    )
    parser.add_argument(
        "--include-dev", action="store_true", help="include the dev extra alongside native acceleration"
    )
    parser.add_argument("--no-upgrade", action="store_true", help="do not pass --upgrade to pip")
    return parser


def _run_serve(argv: list[str]) -> None:
    import uvicorn

    parser = _build_serve_parser()
    args = parser.parse_args(argv)

    os.environ["MOBULA_DATA_DIR"] = str(Path(args.data_dir).expanduser().resolve())
    url_host = "127.0.0.1" if args.host in ("0.0.0.0", "::") else args.host
    url = f"http://{url_host}:{args.port}"
    snapshot_path: Path | None = None
    snapshot_scene_id = ""
    if args.scene_snapshot:
        snapshot_path = Path(args.scene_snapshot).expanduser().resolve()
        payload = json.loads(snapshot_path.read_text(encoding="utf-8"))
        snapshot_scene_id = str(payload.get("descriptor", {}).get("scene_id", "")).strip()
        if not snapshot_scene_id:
            parser.error("Scene snapshot descriptor has no scene_id")
    if args.scene_snapshot and args.scene_source_url:
        parser.error("--scene-snapshot and --scene-source-url are mutually exclusive")
    if args.scene_source_token and args.scene_source_token_env:
        parser.error("--scene-source-token and --scene-source-token-env are mutually exclusive")
    source_token = str(args.scene_source_token or "")
    if args.scene_source_token_env:
        source_token = str(os.environ.get(args.scene_source_token_env, ""))
        if not source_token:
            parser.error(f"environment variable '{args.scene_source_token_env}' is empty or missing")
    initial_scene_id = str(args.initial_scene or snapshot_scene_id).strip()
    if args.scene_source_url and not initial_scene_id:
        parser.error("--scene-source-url requires --initial-scene")
    if args.scene_source_url and not source_token:
        parser.error("--scene-source-url requires a bearer token")
    if source_token and not args.scene_source_url:
        parser.error("Scene source token options require --scene-source-url")
    if initial_scene_id:
        url = _scene_viewer_url(url, initial_scene_id)
    if (snapshot_path is not None or args.scene_source_url) and args.reload:
        parser.error("--reload cannot be combined with a runtime Scene source")
    if not args.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open_new_tab(url)).start()
    if snapshot_path is None and not args.scene_source_url:
        uvicorn.run("mobula.main:app", host=args.host, port=args.port, reload=args.reload)
        return
    from mobula.main import create_app

    uvicorn.run(
        create_app(
            scene_snapshot=snapshot_path,
            scene_source_url=args.scene_source_url,
            scene_source_token=source_token,
            scene_source_id=initial_scene_id,
        ),
        host=args.host,
        port=args.port,
        reload=False,
    )


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
