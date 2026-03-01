# Contributing

Thanks for contributing to nCube.

## Before You Start

- Read [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)
- Confirm local app start and test run

## Development Workflow

1. Create a branch for your change.
2. Keep scope tight (one feature/fix per PR when possible).
3. Add or update tests for behavior changes.
4. Update docs when API/UI behavior changes.
5. Run `pytest` before opening a PR.

## Coding Expectations

- Preserve canonical axis model: `sample,pol,t,nu,x,y,z`
- Keep API errors explicit and actionable
- Avoid breaking existing endpoint contracts unless intentionally versioned
- Prefer small, focused functions over broad monoliths

## Pull Request Checklist

- [ ] Feature/fix is covered by tests
- [ ] `pytest` passes locally
- [ ] Docs updated (`README` + `docs/*` as needed)
- [ ] Change is backward compatible or clearly called out

## Reporting Issues

Please include:

- Operating system
- Python version
- Exact command used
- Full error message and traceback
- If data-related, minimal reproducible file metadata (dims/shape/format)
