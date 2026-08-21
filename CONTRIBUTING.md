# Contributing

Thanks for contributing to mobula.

## Before You Start

- Read [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)
- Confirm local app start and test run

## Agentic Development

mobula is an agentically coded project. Contributions can be human-authored, agent-assisted, or a mix of both, but every change merged here should still be easy to inspect, explain, and verify.

- Keep diffs focused and readable
- Update docs when behavior or project messaging changes
- Run the relevant checks before opening a PR
- Do not treat generated output as self-justifying; review it like any other change

## Licensing Notes

mobula is released under the MIT License.

- Existing files do not need to be backfilled with per-file license headers
- New source files should include a single-line SPDX identifier when practical: `SPDX-License-Identifier: MIT`
- Keep SPDX headers concise; do not paste the full license text into each file unless there is a specific reason

## Development Workflow

1. Create a branch for your change.
2. Link a durable issue and open a pull request before changing `main`.
3. Classify the pull request as routine, review-sensitive, or ambiguous.
4. Keep scope tight (one feature/fix per PR when possible).
5. Add or update tests for behavior changes.
6. Update docs when API/UI behavior changes.
7. Run the local checks before opening a PR.

Routine changes may merge after required checks when the pull request explains
why human acceptance is unnecessary. Scientific meaning, public interfaces,
architecture, access and security policy, substantial UI behavior, and
ambiguous scope require explicit human acceptance. CI validates the declared
classification but cannot prove that a checkbox was set by a human.

Direct pushes to `main` are exceptional maintainer actions and require a
recorded reason. Run `python scripts/validate_collaboration.py` after changing
collaboration policy files.

## Coding Expectations

- Preserve canonical axis model: `sample,pol,t,nu,x,y,z`
- Keep API errors explicit and actionable
- Avoid changing user-visible behavior without updating `docs/EXPECTED_BEHAVIOR.md`
- Prefer small, focused functions over broad monoliths

## Required Checks

- `pytest`
- `pytest tests/browser -q`
- `ruff check src/mobula/main.py src/mobula/service/view_service.py src/mobula/service/views src/mobula/service/ingest src/mobula/service/ingest_service.py tests/browser/test_smoke.py tests/conftest.py tests/test_api_endpoints.py scripts/generate_brand_banners.py`
- `ruff format --check src/mobula/main.py src/mobula/service/view_service.py src/mobula/service/views src/mobula/service/ingest src/mobula/service/ingest_service.py tests/browser/test_smoke.py tests/conftest.py tests/test_api_endpoints.py scripts/generate_brand_banners.py`
- `mypy src/mobula/data/schema.py src/mobula/service/api_models.py src/mobula/service/api_utils.py`

## Pull Request Checklist

- [ ] Feature/fix is covered by tests
- [ ] Required checks pass locally
- [ ] Docs updated (`README` + `docs/*` as needed)
- [ ] Change is backward compatible or clearly called out

## Reporting Issues

Please include:

- Operating system
- Python version
- Exact command used
- Full error message and traceback
- If data-related, minimal reproducible file metadata (dims/shape/format)
