---
name: develop-mobula
description: Develop or review Mobula multidomain data exploration, ingestion, scientific views, linked state, uncertainty presentation, and browser interactions without adding radio-specific or Resolve-owned semantics.
---

# Develop Mobula

Deliver one inspectable multidomain exploration capability while preserving
Mobula's user-facing behavior contract and scientific axis semantics.

## Orient And Bound

Read `AGENTS.md`, `README.md`, `docs/EXPECTED_BEHAVIOR.md`, and the affected
tests. State one concrete user-visible acceptance boundary before editing.
Identify the dataset, quantity, uncertainty, coordinate, and varying-axis
semantics involved. Mobula's internal axis order is
`sample, pol, t, nu, x, y, z`; keep display mappings distinct from data
rewrites.

When Mobula is checked out under `resolve_refactor`, use parent skills only for
cross-repository orchestration or shared interaction and visual conventions.
Keep Mobula implementation and tests in this repository.

## Preserve Product Boundaries

- Mobula owns general multidomain ingestion, exploration state, views,
  presentation, and its local service contracts.
- Do not add EHT-, radio-interferometry-, or Resolve-specific scientific
  meaning to Mobula. Consume external registries and contracts explicitly and
  record their versions and provenance.
- Backend code owns scientific transformations, coordinate interpretation,
  normalization inputs, and uncertainty calculations. Browser code presents
  returned meaning and must not invent it independently.
- Preserve compatible dataset, sample, ROI, axis, normalization, projection,
  and playback state across view and mode changes. Clear state deliberately
  when its scientific context becomes incompatible.
- Treat uncertainty, missing data, loading, fallback, and failure as explicit
  states. Never make an unavailable result look evaluated.
- Keep workflows local-first, reproducible, and inspectable. Prefer explicit,
  reversible state transitions over hidden inference.

When a durable user-visible behavior changes, update
`docs/EXPECTED_BEHAVIOR.md` in the same change.

## Implement And Verify

Use focused unit, service, contract, and browser tests during implementation.
Exercise the real browser path for interaction, layout, rendering, or
accessibility changes and retain evidence proportional to the risk. Measure
the affected path before optimizing it; acceleration must preserve the CPU
contract and report fallback clearly.

Run the repository's documented lint, format, type, Python-test, and browser
commands that cover the change. Review separately whether the result preserves
scientific intent and whether it follows repository contracts. A handoff
records the base, exact HEAD, owned paths, tests and results, visual or
scientific evidence, limitations, and one next action.
