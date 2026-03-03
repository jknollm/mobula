from __future__ import annotations

import argparse
import os
import threading
import webbrowser
from pathlib import Path

import uvicorn

from mobula.paths import default_data_dir


def _build_parser() -> argparse.ArgumentParser:
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


def main(argv: list[str] | None = None) -> None:
    parser = _build_parser()
    args = parser.parse_args(argv)

    os.environ["MOBULA_DATA_DIR"] = str(Path(args.data_dir).expanduser().resolve())
    url_host = "127.0.0.1" if args.host in ("0.0.0.0", "::") else args.host
    url = f"http://{url_host}:{args.port}"
    threading.Timer(0.8, lambda: webbrowser.open_new_tab(url)).start()
    uvicorn.run("mobula.main:app", host=args.host, port=args.port, reload=args.reload)


if __name__ == "__main__":
    main()
