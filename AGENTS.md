# Development guidance

This repository produces a BetterGI JS trial package for one TCG invitation opponent and one difficulty, with sequential strategy fallback. Work in the existing checkout; do not create a Git worktree unless explicitly requested.

- Read `README.md` and `src/InvitationFallback/README.md` before changes.
- Keep both routes: the existing BetterGI txt executor and the four upstream recognition players. Do not rewrite their decisions or recognition thresholds.
- `vendor/` is an immutable pinned input; hashes are in `vendor/lock.json`. Build invocation adapters in `tools/build.py`, rather than editing generated or vendored modules.
- BetterGI runs ClearScript V8, not Node. Use only verified host APIs and bundled local resources in runtime JS. Do not add runtime network requests.
- Preserve opponent/difficulty identity across retries. Only a confirmed loss can select a fallback. Errors, cancellation, unknown results and resource failures are separate outcomes.
- Do not repeat invitation purchases or consuming invitations from a retry loop. Record and stop on an unverified purchase.
- Keep default automatic purchasing disabled for this trial; the user may explicitly enable its existing setting.
- No running game session has been tested in this cloud environment. Do not describe simulated UI tests as game validation.
- Run `npm run build`, `npm test`, and `npm run check` after changes. Node 22+ and Python 3.10+ are sufficient; there are no npm package dependencies.
- The user-facing deliverable is `dist/InvitationFallback-0.1.0.zip` and the installation instructions inside it. Do not push or publish without user instruction.
