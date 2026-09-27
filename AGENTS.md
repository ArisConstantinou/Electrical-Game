# Electrical-Game preview

User instruction: every Electrical-Game task must use only port **5365**. This rule applies only to Electrical-Game, not other projects.

- Shared URL: http://127.0.0.1:5365/Electrical-Game/
- Current integration checkout: `C:/Users/arz0r/.codex/worktrees/jump-controls-release/Electrical-Game`, branch `codex/jump-controls-release`. Verified gameplay/benchmark base: `f98f703`. Verify live source provenance before using this recorded path or revision.
- Localhost Manager has one saved Electrical Game entry (`electrical-game-2`), pointing to that integration checkout with `npm.cmd run dev` and automatic startup enabled. Settings: `%LOCALAPPDATA%/LocalhostManager/projects.json`.
- The integration checkout has its own lockfile-installed `node_modules`; do not replace it with a junction to a temporary checkout. If dependencies are absent, use `npm.cmd ci --include=dev` from the intended checkout.
- Reuse the listener; verify with `node scripts/start-worker-preview.mjs`. Use strict-port. Never start an alternate Electrical-Game port.
- Coordinate active project tasks before replacing the listener and integrate their approved changes first.
- Identify process and served checkout before stopping anything. If another project owns 5365, report the conflict rather than killing it or switching ports.
- Preserve unrelated dirty files and protected worktrees.
