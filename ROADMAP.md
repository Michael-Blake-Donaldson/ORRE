# Memora Productization Roadmap

Last updated: 2026-03-15

This is now a live execution roadmap, not a speculative outline.

## Milestone Status

- Milestone A - Reliability And Session Health: Completed
- Milestone B - Core UX Polish: Completed
- Milestone C - Settings And Control Surface: Completed
- Milestone D - Multimodal Quality Benchmarking: Completed (foundation)
- Milestone E - Packaging And Distribution: Not started
- Milestone F - Release Readiness: Not started

## Completed Work (A-D)

### A: Reliability And Session Health
- Added session health diagnostics in session detail.
- Added modality and extraction visibility (audio presence, OCR/transcript counts, job timing, latest failure).
- Added clearer partial/degraded session labeling.
- Hardened rerun flow to prevent stale data and duplicate processing requests.

### B: Core UX Polish
- Replaced phase/prototype dashboard copy with product-oriented copy.
- Improved dashboard clarity and flow for record -> process -> ask.
- Added back-to-top interaction and smoother cross-section navigation.

### C: Settings And Control Surface
- Added persistent settings storage.
- Added user controls for capture defaults and Ask retrieval limit.
- Split settings into a dedicated page for cleaner IA and workflow.

### D: Multimodal Quality Benchmarking
- Added benchmark runner scaffolding and benchmark settings persistence.
- Split benchmarks into a dedicated page.
- Added benchmark output summary for confidence and modality coverage trends.

## Remaining Work

### Milestone E: Packaging And Distribution
Goal: make install and versioning behave like a production Windows app.

Tasks:
- Add production build and Windows installer generation.
- Add app metadata, icon assets, and release versioning.
- Define update strategy.
- Add startup checks for missing native dependencies or broken model assets.
- Add crash/failure capture for field debugging.

Exit criteria:
- App installs and launches on a clean Windows machine.
- Versioned builds are reproducible and testable.

### Milestone F: Release Readiness
Goal: reduce surprises before broader distribution.

Tasks:
- Add export and recovery path for sessions/metadata.
- Add manual smoke test checklist per release.
- Validate performance on longer recordings and larger libraries.
- Validate uninstall/reinstall behavior.
- Document privacy guarantees and known limitations.

Exit criteria:
- Repeatable pre-release QA pass exists.
- Recovery and basic data portability are available.

## Current Stop Point

Per current direction, stop before Milestone E implementation so final pre-package changes can be made first.

## Next Two Concrete Actions

1. Final pre-package pass
- Clean UX text and edge-state messaging across dashboard, settings, benchmarks, and library.
- Confirm no stale references to in-dashboard settings/benchmark sections remain.

2. Packaging prep checklist (no installer build yet)
- Decide installer/update approach.
- Finalize app identity assets and versioning scheme.
- Define minimum acceptance test for first packaged build.