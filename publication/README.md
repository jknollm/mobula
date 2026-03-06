# nCube Software Publication Package

This folder is a working package for turning `mobula`/`nCube` into a small software publication.

## Contents

- [Manuscript Draft](./manuscript-draft.md)
  - Problem framing, technical approach, UI/visualization design, and contribution claims.
- [Figure Plan](./figure-plan.md)
  - Suggested figures that demonstrate multi-domain analysis and interface choices.
- [Usage Appendix](./usage-appendix.md)
  - Reproducible run instructions, workflows, and API calls to document tool usage.
- [Submission Roadmap](./submission-roadmap.md)
  - A short milestone plan from draft package to submission-ready artifact.
- [Comparative Evaluation Protocol](./comparative-evaluation-protocol.md)
  - Task/metric template for baseline comparison and real-dataset case reporting.
- [LaTeX Paper Draft](./paper/README.md)
  - Buildable venue-neutral manuscript draft (`main.tex` + `references.bib`).
  - Includes captured UI figures under `paper/figures/ui/` and a capture script.

## Suggested Workflow

1. Start with [Manuscript Draft](./manuscript-draft.md) and refine project-specific evidence sections (runtime measurements, venue fit, and abstract wording).
2. Produce the figures in [Figure Plan](./figure-plan.md) from one or two representative datasets.
3. Keep commands and endpoints in [Usage Appendix](./usage-appendix.md) synchronized with the codebase.

## Scope

This package is intentionally lightweight: it is designed for a short software paper, workshop submission, or technical note.
