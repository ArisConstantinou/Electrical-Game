# Electrical-Game preview

User instruction: every Electrical-Game task must use only port **5365**. This rule applies only to Electrical-Game, not other projects.

- Shared URL: http://127.0.0.1:5365/Electrical-Game/
- This is the isolated Apprentice sample checkout (`codex/apprentice-demo`). Protected integration remains `C:/Users/arz0r/.codex/worktrees/wheelbarrow-physics/Electrical-Game`, branch `codex/wheelbarrow-physics`. Verify live source provenance before work; do not promote this sample without approval.
- At sample delivery the listener is the validated compiled Vite preview from this checkout's `dist`, bundle `index-C77IduEL.js`. Automatic approval review rejected stopping it to restore dev mode. Preserve this listener; a compiled preview cannot pass start-worker-preview's source-module check. After an authorized dev restart use `node scripts/start-worker-preview.mjs`, always strict-port and never an alternate Electrical-Game port.
- Coordinate active project tasks before replacing the listener and integrate their approved changes first.
- Identify process and served checkout before stopping anything. If another project owns 5365, report the conflict rather than killing it or switching ports.
- Preserve unrelated dirty files and protected worktrees.
