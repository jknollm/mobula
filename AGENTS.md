# AGENTS

This repository exists to build a local, trustworthy tool for exploring complex data. Agents should optimize for behavior that is clear, stable, and useful in practice, not for cleverness or novelty in the implementation.

## Core Vision

- Build for coordinated multi-domain exploration. Spatial, temporal, spectral, polarization, and uncertainty views should feel like one workflow, not a chain of disconnected tools.
- Treat uncertainty as a first-class domain. It should be available during exploration, not deferred to a post-hoc check after the main interpretation is already formed.
- Preserve analytical context across pivots. Changing view, mode, or domain should not force users to rebuild their ROI, axis state, or normalization choices.
- Keep the tool local-first, reproducible, and inspectable. Important behavior should be understandable and possible to verify.

## Experience

- Aim for a tactile, low-friction interaction feel. Navigation, dragging, playback, and mode changes should feel immediate enough that users stay in analytical flow.
- UX should reduce handoff cost. Common actions should be easy to find, fast to repeat, and clear in their effect.
- UI design should support interpretation first. Favor strong hierarchy, calm defaults, and progressive disclosure over dense control surfaces that compete for attention.
- Visual feedback and motion should clarify state changes, not decorate them.

## Mindset

- Prefer directness over magic. The app should feel understandable to the person using it.
- Protect trust. When behavior is ambiguous, choose the path that is more predictable, inspectable, and reversible.
- Keep the product practical. Avoid introducing assumptions that make the tool feel heavier than it needs to be.
- Favor small, composable changes that improve the user experience over broad rewrites that mainly improve internal elegance.
- Use explicit guardrails when a combination of modes would be invalid, misleading, or hard to interpret.
- Treat documentation as part of the product contract, not as an afterthought.

## Performance

- Efficient code is part of the user experience. Smooth interaction matters because lag breaks reasoning and makes comparisons harder.
- Use acceleration, including GPU paths, when it materially improves responsiveness without hiding behavior or compromising correctness.
- Prefer predictable performance and graceful degradation over impressive features that stutter, block, or fail opaquely.

## Testing Philosophy

- Test user-facing behavior and product contracts, not only internal implementation details.
- Prioritize coverage around state coherence across domain pivots, uncertainty semantics, rendering-mode changes, and other places where interpretation can drift.
- When a bug or user feedback reveals an important expectation, add or update a test when practical.

## Behavior Contract

- `docs/EXPECTED_BEHAVIOR.md` is the running record of intended behavior.
- When feedback is received about how the app should work, capture the expected behavior there in user-facing terms.
- Use that document as a periodic check against the actual product so drift becomes visible and discussable.
- If code, UI, and `docs/EXPECTED_BEHAVIOR.md` disagree, make the mismatch explicit and resolve it deliberately.

## Repository Skill

- Use `.agents/skills/develop-mobula/SKILL.md` for Mobula feature development,
  ingestion, scientific views, state coherence, uncertainty presentation, and
  browser interaction work.
- The skill is part of this repository's versioned development contract. Keep
  it portable: it may refer conditionally to a parent workspace, but it must
  remain usable from a standalone clone.
- Run `python scripts/validate_skills.py` whenever repository-owned skills or
  their routing change.

## Pull Request Review

- Every tracked change uses a topic branch and pull request linked to a durable
  issue. Classify it through `.github/pull_request_template.md`.
- Routine changes may merge after required checks. Review-sensitive or
  ambiguous changes stop for explicit human acceptance.
- Direct pushes to `main` are exceptional maintainer actions and require a
  recorded reason.
- Run `python scripts/validate_collaboration.py` after changing collaboration
  policy files.
