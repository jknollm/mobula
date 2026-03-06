# Paper Manuscripts

This directory contains:

- a venue-neutral full-text LaTeX manuscript, and
- a JOSS-formatted manuscript draft.

## Contents

- `main.tex` - end-to-end manuscript text
- `references.bib` - initial bibliography entries
- `paper.md` - JOSS-style manuscript (`Summary`, `Statement of need`, `State of the field`, `Software design`, `Research impact statement`, `AI usage disclosure`)
- `figures/ui/` - captured UI screenshots used in the paper
- `scripts/capture_ui_screenshots.py` - automation script to regenerate screenshots

## Build LaTeX

If `latexmk` is installed:

```bash
cd publication/paper
latexmk -pdf main.tex
```

Or with `pdflatex` + `bibtex`:

```bash
cd publication/paper
pdflatex main.tex
bibtex main
pdflatex main.tex
pdflatex main.tex
```

## JOSS Preparation Notes

- `paper.md` follows the current JOSS section expectations.
- Replace author and affiliation metadata with submission-ready individual author records.
- Validate against JOSS `paper.md` checks during submission packaging.

## Capture UI Screenshots

Ensure the service is running at `http://127.0.0.1:8000`:

```bash
./run_demo.sh
```

In another terminal:

```bash
source .venv/bin/activate
python publication/paper/scripts/capture_ui_screenshots.py
```

## Next Edits

1. Swap to the target venue template and constraints.
2. Add venue-specific related-work framing and formatting.
3. Expand comparative evaluation against baseline workflows.
