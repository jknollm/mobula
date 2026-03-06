# Comparative Evaluation Protocol

This protocol is designed to test the core claim of the paper:
`mobula` improves high-dimensional exploration by keeping signal interpretation and uncertainty visualization in one interaction state.

## 1. Scope

- Compare `mobula` against a baseline multi-tool workflow used in your lab.
- Use one real observational dataset plus one built-in dataset for sanity checks.
- Focus on repeatable task metrics, not subjective impressions.

## 2. Required Inputs

- Dataset path and provenance.
- Axis mapping used at load time (`sample, pol, t, nu, x, y, z`).
- Baseline toolchain definition (for example: viewer + notebook script + export format).
- Two operators (or one operator repeating each task three times).

## 3. Tasks

Run all tasks in both workflows.

1. `T1` Region-to-trend task:
   Identify an ROI and produce linked temporal and spectral trend summaries.
2. `T2` Uncertainty stress test:
   Evaluate whether the trend remains under polarization and uncertainty pivots (`single/mean/std/rel_uncert`).
3. `T3` Reproducible export task:
   Export a cutout and produce enough metadata to replay the state.

## 4. Metrics

Record each metric per task and per run.

- Task completion time (seconds).
- Tool/environment handoffs (count).
- Manual state transfers (count): ROI redraws, axis re-entry, normalization re-entry.
- Reproducibility completeness (binary): can another operator replay the result from recorded steps.
- Interpretation stability (binary): same conclusion across repeated runs.

## 5. Data Capture Template

| Workflow | Task | Run | Time (s) | Handoffs | Manual transfers | Replayable | Stable conclusion | Notes |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| mobula | T1 | 1 |  |  |  |  |  |  |
| baseline | T1 | 1 |  |  |  |  |  |  |

Extend rows for `T2`, `T3`, and additional runs.

## 6. Real-Dataset Case Narrative Template

Fill this in for the manuscript case-study subsection.

1. Scientific question:
   One sentence claim being tested.
2. Signal-space finding:
   What appears true before uncertainty pivot.
3. Uncertainty-domain finding:
   What changes (or remains) under `std`/`rel_uncert`.
4. Final interpretation:
   Accepted, revised, or rejected claim.
5. Reproducibility artifact:
   Endpoint calls, parameters, and exported files needed to replay.

## 7. Minimal Command Log

```bash
# Start service
PYTHONPATH=src uvicorn mobula.main:app --host 127.0.0.1 --port 8000 --reload

# Load real dataset
curl -X POST http://127.0.0.1:8000/api/load-local \
  -H "Content-Type: application/json" \
  -d '{"path":"/abs/path/to/cube.fits","data_id":"real-case-1"}'

# Verify dataset registration
curl -s http://127.0.0.1:8000/api/datasets
curl -s http://127.0.0.1:8000/api/datasets/real-case-1/meta
```

## 8. Reporting Guidance

- Report medians and dispersion for timing metrics.
- Avoid claiming significance without statistical testing.
- Keep claims aligned with measured outcomes:
  - If time wins are inconsistent, claim reduced handoffs instead of speedup.
  - If conclusions change under uncertainty pivots, highlight uncertainty-domain value.
