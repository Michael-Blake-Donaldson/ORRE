# Memora Productization Roadmap

This roadmap is ordered for turning the current prototype into a reliable Windows app.

## Milestone A: Reliability And Session Health

Goal: make record -> process -> replay -> ask reliable enough that failures are visible and diagnosable.

Tasks:
- Add session health diagnostics to session detail.
- Show audio capture presence, OCR chunk count, transcript chunk count, job durations, and latest failure reason.
- Detect and label sessions with partial processing outcomes.
- Improve processing state transitions so queued, running, failed, and completed states are always accurate.
- Add a rerun flow that clearly resets and reprocesses a session.
- Verify replay availability before showing replay actions.

Exit criteria:
- A failed or partial session is obvious in the UI.
- A healthy session can be distinguished from a degraded session without opening logs.
- Reprocessing a session produces predictable job states.

## Milestone B: Core UX Polish

Goal: make the app feel deliberate on Windows instead of developer-only.

Tasks:
- Replace phase-oriented copy with product copy across dashboard surfaces.
- Improve empty states, loading states, and error states on dashboard, search, ask, and session detail.
- Tighten the top-level layout, spacing, and typography for desktop use.
- Add keyboard shortcuts for start, stop, search focus, and quick navigation.
- Improve recording-state visibility so active capture is unmistakable.
- Add a first-run onboarding panel explaining capture, processing, and privacy defaults.

Exit criteria:
- A first-time user can understand how to record and inspect a session without guidance.
- The main dashboard no longer reads like a phased prototype.

## Milestone C: Settings And Control Surface

Goal: expose user-controllable behavior instead of hard-coded defaults.

Tasks:
- Add persistent settings storage.
- Add capture preferences for source selection behavior and recording mode defaults.
- Add processing preferences for transcript quality mode and OCR sampling density.
- Add storage preferences for save location, retention, and cleanup behavior.
- Add privacy controls for microphone usage and optional deletion of raw recordings.

Exit criteria:
- Core capture and processing behavior can be changed from the UI.
- Settings persist across restarts.

## Milestone D: Multimodal Quality Benchmarking

Goal: improve answer quality with measurement, not guesswork.

Tasks:
- Create a benchmark set of real sessions and real user questions.
- Add session-level modality coverage indicators for audio, OCR, and visual transcript strength.
- Improve visual entity extraction when OCR text is sparse.
- Reprocess benchmark sessions after pipeline changes and compare answer quality.
- Tune retrieval balancing between audio transcript, visual transcript, and OCR evidence.

Exit criteria:
- Quality changes are evaluated against a fixed benchmark set.
- Ask responses visibly indicate when evidence coverage is weak.

## Milestone E: Packaging And Distribution

Goal: make installation and versioning work like a real Windows app.

Tasks:
- Add production build and installer generation.
- Add Windows app metadata, icon assets, and versioning.
- Define update strategy.
- Add startup checks for missing native dependencies or broken model assets.
- Add crash logging or failure capture for field debugging.

Exit criteria:
- The app can be installed on a clean Windows machine.
- Versioned builds are reproducible.

## Milestone F: Release Readiness

Goal: reduce operational surprises before broader usage.

Tasks:
- Add export and recovery paths for sessions and metadata.
- Add a manual smoke-test checklist for every build.
- Test longer recordings and large libraries for performance issues.
- Validate uninstall and reinstall behavior.
- Document known limitations and privacy guarantees.

Exit criteria:
- There is a repeatable pre-release test pass.
- Recovery and basic data portability exist.

## Immediate Next Slice

Start with Milestone A by implementing session health diagnostics in session detail.

First implementation items:
- Compute session-level health summary from jobs and extracted chunks.
- Surface the summary in the dashboard session detail panel.
- Show whether the session appears to have audio evidence, visual evidence, both, or degraded coverage.
- Show latest job error without requiring log inspection.

This work should happen before broader UI polish because it becomes the foundation for debugging every later quality issue.