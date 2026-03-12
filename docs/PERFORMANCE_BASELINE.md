# Performance Baseline

This document records the current baseline used to judge performance regressions during refactoring.

Unless otherwise stated, the figures below are from a local development run on March 6, 2026.

## Baseline Summary

- Demo benchmark on `movie-2d-pol-hd`:
  - JSON slice transport: `p50 66.55 ms`, `p95 98.57 ms`, `mean 72.47 ms`
  - binary slice transport: `p50 4.26 ms`, `p95 4.71 ms`, `mean 4.35 ms`
  - ROI stats: `p50 2.16 ms`, `p95 13.31 ms`, `mean 4.91 ms`
- Representative response payload sizes with gzip enabled:
  - demo 2D slice (`movie-2d-pol-hd`)
    - JSON: `421,870 B` raw, `189,501 B` on wire
    - binary: `88,916 B` raw, `78,321 B` on wire
  - large 2D slice (`xy-nu-pol-radio-galaxy`)
    - JSON: `41,045,325 B` raw, `18,716,355 B` on wire
    - binary: `8,447,596 B` raw, `7,852,257 B` on wire
  - medium 3D volume (`time-5d-volume-samples-hd`)
    - JSON: `7,369,700 B` raw, `3,254,885 B` on wire
    - binary: `1,438,196 B` raw, `1,326,395 B` on wire

## Interpretation

- Demo-path numeric compute is not the limiting factor.
- JSON serialization and transfer were the main hot-path cost for slice and volume payloads.
- Binary scalar transport removes most of that overhead for slice and volume endpoints, but large payload movement and browser render cost still matter on bigger datasets.
- Multispectral and other JSON-only endpoints should still be treated as transport-sensitive.

## Measurement Workflow

### Development instrumentation

Backend JSON-heavy endpoints now expose:

- `X-Mobula-Request-Ms`
- `X-Mobula-Compute-Ms`
- `X-Mobula-Serialize-Ms`
- `X-Mobula-Response-Bytes`
- `X-Mobula-Dataset-Cache`
- `X-Mobula-Dataset-Load-Ms`
- `Server-Timing`

Multispectral responses also expose backend diagnostics in the JSON payload:

- requested and effective compute backend
- fallback reason when CPU fallback occurs
- preview-active flag
- stage timings for extraction, preview downsampling, normalization, deslope, chroma preparation, spectral conversion, brightness scaling, and serialization

Frontend development instrumentation is available with `?perf=1`:

- fetch duration
- JSON or binary parse duration
- render duration
- time to first visible update
- playback/interaction frame pacing
- dropped-frame estimates

The same snapshot is exposed to devtools as `window.__mobulaPerf`.
Viewer state needed for browser behavior checks is also exposed as `window.__mobulaDebug.getStateSnapshot()`.

### Backend latency

Start the app, then run:

```bash
python scripts/benchmark.py --dataset movie-2d-pol-hd --n 40 --warmup 10 --response-format json
python scripts/benchmark.py --dataset movie-2d-pol-hd --n 40 --warmup 10 --response-format binary
```

The benchmark reports slice and ROI stats latency percentiles using the live HTTP API. The `response_format` flag only changes the slice transport; ROI stats remain JSON.

### Payload size spot checks

Measure representative endpoints by recording raw response body sizes from:

- `GET /api/datasets/{data_id}/slice`
- `GET /api/datasets/{data_id}/volume`
- `GET /api/datasets/{data_id}/multispectral`

Record both raw size (`X-Mobula-Response-Bytes`) and compressed wire size (`Content-Length`) when `Content-Encoding: gzip` is present.

## Current Risk Areas To Track

- large JSON-only endpoints, especially multispectral payloads
- browser parse and rasterization cost after payload receipt
- browser-side rasterization and main-thread work after payload receipt
- playback frame pacing under heavy slice or volume workloads
- multispectral and volume mode behavior on large datasets

## Current Mitigations

- JSON responses are serialized with explicit compute/serialization timing.
- Large JSON responses are gzip-compressed in transit.
- Slice and volume endpoints support `response_format=binary` for float-array payloads.
- Slice and volume GPU renderers now handle `sqrt` flux scaling directly instead of forcing those views onto CPU fallback.
- Slice and volume GPU upload paths now reuse backend-native scalar packing instead of repacking every frame on the main thread.
- Slice and volume coord metadata serialization is cached per dataset/dimension set to reduce repeated response metadata work.
- Multispectral preview mode downsamples before normalization and spectral-to-RGB conversion, so lower preview budgets reduce compute work as well as payload size.
- Browser smoke tests cover app load, ROI/profile interaction, volume mode, and sphere mode.
- Browser contract tests now cover dataset resets, plane-change resets, and playback refinement.

## Update Rule

- If a performance-sensitive change lands, update this document with new measurements or a note explaining why the existing baseline still applies.
- If a benchmark changes enough that the old numbers stop being useful, replace them instead of letting the document drift into a history dump.
