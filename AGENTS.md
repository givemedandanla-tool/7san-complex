# Development guidance

This repository extends the pinned original BetterGI invitation script with four players, named decks and ordered fallback. The user explicitly requires the original navigation, purchasing schedule, two legs per round and outer-loop continuation. Work in the existing checkout; do not create a Git worktree unless explicitly requested.

- Read `README.md` and `src/InvitationFallback/README.md` before changes.
- Keep both routes: the existing BetterGI txt executor and the four upstream recognition players. Do not rewrite their decisions or recognition thresholds.
- `vendor/` is an immutable pinned input; hashes are in `vendor/lock.json`. Build invocation adapters in `tools/build.py`, rather than editing generated or vendored modules.
- BetterGI runs ClearScript V8, not Node. Use only verified host APIs and bundled local resources in runtime JS. Do not add runtime network requests.
- Use `tools/build.py` to generate the navigation adapter from the pinned original script. Preserve its input/timing trace, including result exit and dialogue. Do not require a typed opponent, difficulty or manual preparation-page entry.
- Preserve the selected invitation panel across retries. Only a confirmed loss can select a fallback. Errors, cancellation, unknown results and resource failures are separate outcomes. Each leg starts from the first configured strategy again.
- After all requested strategies lose, record the leg as lost and continue the original outer loop; do not declare it won. No available decks or a technical error stops execution.
- Do not repeat invitation purchases or consuming invitations from a retry loop. Record and stop on an unverified purchase.
- The user requested restoring the original purchase schedule: buy one when the local letter count is insufficient for that round. Preserve purchase verification and the pending journal. Do not add purchasing inside retries.
- No running game session has been tested in this cloud environment. Do not describe simulated UI tests as game validation.
- Run `npm run build`, `npm test`, and `npm run check` after changes. Node 22+ and Python 3.10+ are sufficient; there are no npm package dependencies.
- The user-facing deliverable uses the version in `src/InvitationFallback/manifest.json`: `dist/InvitationFallback-<version>.zip`, with an identical copy in `downloads/`. Keep the ZIP checksum current. The user has authorized uploading this implementation to the existing GitHub repository.
