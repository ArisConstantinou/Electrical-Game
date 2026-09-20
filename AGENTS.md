# Electrical-Game preview

User instruction: every Electrical-Game task must use only port **5365**. This rule applies only to Electrical-Game, not other projects.

- Shared URL: http://127.0.0.1:5365/Electrical-Game/
- This is the current integration checkout (`codex/wheelbarrow-physics`). Verify live source provenance before work.
- Reuse the listener; verify with `node scripts/start-worker-preview.mjs`. Use strict-port. Never start an alternate Electrical-Game port.
- Coordinate active project tasks before replacing the listener and integrate their approved changes first.
- Identify process and served checkout before stopping anything. If another project owns 5365, report the conflict rather than killing it or switching ports.
- Preserve unrelated dirty files and protected worktrees.
