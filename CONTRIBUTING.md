# Contributing

Thanks for contributing to mobula.

## Before You Start

- Read [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)
- Confirm local app start and test run

## Development Workflow

1. Create a branch for your change.
2. Keep scope tight (one feature/fix per PR when possible).
3. Add or update tests for behavior changes.
4. Update docs when API/UI behavior changes.
5. Run the local checks before opening a PR.

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
