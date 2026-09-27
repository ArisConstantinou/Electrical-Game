# Editor main-menu return

The top-right X/MENU button remains visible outside the editor's hidden header. X, Escape and Scene → Exit use the same unsaved-work guard. Its native modal follows the existing main menu's cream panels, green text and yellow primary action, with Save and return, Return without saving, and Cancel choices.

Persistent document and level-name snapshots distinguish saved work from actual changes, including edits undone back to the saved state. A new blank site also prompts before its first save. Browser-storage failure leaves the modal and live edits intact. Successful browser persistence remains sufficient on Pages; optional local project persistence retains its existing fallback and has a five-second timeout.

Returning navigates to the main menu without `editor` or `template` startup parameters. A saved slot remains selected. Discard reloads its previous persisted version, or Basic for an unsaved site, protecting the next Play action from discarded live geometry. This intentionally uses the normal menu loading process rather than keeping discarded geometry alive.

The modal confines keyboard focus, blocks editor shortcuts and duplicate save actions, and restores the camera/gizmo controls on cancellation. Its DOM is reused, and persistent state comparison only runs when opening or saving, not in the animation loop. No scene geometry, rendering quality or assets are added.

## Verification

- `npm run build`: TypeScript and Vite production build pass; existing asset-resolution and chunk-size warnings remain.
- `node tests/editor-menu-return.mjs --baseline`: original `bf4e7fb` reproduces the hidden X and exit without warning. This option expects the original build.
- `node tests/editor-menu-return.mjs`: desktop save/discard/cancel, storage failure/retry, saved-slot reload, name-only changes, Undo, Escape, modal keyboard guards, resumed camera drag, in-flight save, repeated-modal cost and geometry retention, and portrait/landscape touch layout.
- Actual develop-web-game client: native prompt screenshot inspected; text state exposes `levelEditor.active`, `exitPromptOpen` and `saving`.
- `node tests/game-frame-deadline.mjs`: the previously published FPS scheduling correction remains intact.
- Existing `editor-shortcuts-camera.mjs`: desktop/mobile orbit, copy/paste, delete, history and Undo pass against the candidate.

Twenty repeated requests in the same desktop scene had P95 4.9 ms/max 6.4 ms synchronous work, one reused dialog and unchanged 1,833 geometries. This isolates prompt handling; it excludes GPU/compositor timing and does not establish physical-phone FPS.

QA report/screenshots live under `output/editor-menu-return/`; the actual skill client uses `output/editor-menu-skill-client/`. Candidate tests serve the production build through the existing 5365 origin and intercept save endpoints, so QA does not write levels into the shared project. Set `QA_LIVE=1` for the real listener or additionally `QA_EDITOR_URL=https://arisconstantinou.github.io/Electrical-Game/` for Pages. `QA_EDITOR_OUTPUT` separates release evidence from candidate files. Touch viewport emulation is not a physical iPhone test. This change does not claim to resolve the game's remaining FPS drops.
