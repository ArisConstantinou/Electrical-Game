Original prompt: Create a clean Vite/TypeScript/Three.js 3D first-person web game named WIRE THE HOUSE, based on real Cyprus residential first-fix practices, editable in Web Game Studio, playable on desktop/mobile, deployed to arisconstantinou/Electrical-Game via GitHub Pages, and ending at FIRST FIX COMPLETE without cable pulling.

## Completed

- GitHub repository created and remote connected.
- All 18 supplied reference photographs reviewed, including the annotated continuous-mortar requirement.
- Clean foundation, strict port 5362, Pages workflow/base, core docs and Studio manifest added.
- Complete Mark → Chase → Fit → Mortar → Level → 20 mm rigid PVC → inspection loop for Points A/B/C.
- Desktop build, Studio contract and automated desktop/mobile gameplay smoke pass locally.
- Actual Web Game Studio importer reports `manifest: valid`, `canOpenLinked: true` and every capability category ready; live handshake/snapshot/patch/save/reload passed.

## Current

- All game-shell elements now disable standard and WebKit text selection/callouts, while `selectstart` and `dragstart` are cancelled at the game boundary to prevent iOS Safari highlight handles.
- Selection regression validates standard/WebKit user-select on nested button text and event cancellation; Chromium explicitly reports touch-callout as unsupported while Safari consumes the authored `none` rule.
- Mobile right-side look now supports double-tap-and-hold: the held second tap continuously uses any selected tool while drag-look remains active.
- The ACTION button remains available and visibly teaches `2× TAP + HOLD LOOK`; gameplay regression covers simultaneous right-look rotation and held spray use.
- Verified at 390×844 that double-tap-and-hold produced five held spray marks while changing yaw, released cleanly, retained zero horizontal overflow, and completed the full mobile/desktop gameplay smoke.
- Mobile joystick movement now remains active while ACTION, spray/hammer use, or tool cycling is pressed; look, movement and action use independent pointers.
- Mobile game buttons explicitly disable iOS tap highlight, text selection/callout, and touch-only sticky hover styling.
- The mobile regression now asserts that a second-finger TOOL press preserves joystick movement and that movement resets only when the joystick finger ends.
- Automated mobile style coverage now rejects browser tap highlight, text selection, or non-manipulation button touch behavior.
- Freeform controls revision implemented after physical iPhone feedback: transient toast, global tool cycling, visible selected tools, held free spray, reticle-based brick removal and stuck-joystick recovery.
- Desktop left mouse now uses the selected tool; holding it continuously operates spray and hammer. E remains as an accessible alternate input.
- The live desktop HUD explicitly shows `LEFT CLICK TO USE` beside the selected tool.
- Desktop left-click/held-tool coverage, the full desktop mission, mobile interaction smoke, typecheck, production build, Studio contract, and final screenshot inspection are green locally.
- Spray retains the original DOTS method and adds a LIVE aerosol method with connected coverage and fine overspray. Blue, red, yellow and white are selectable from desktop/mobile controls; V/C are desktop shortcuts.
- LIVE spray includes a color-matched animated nozzle plume and a bounded 1,400-mark wall budget. Desktop/mobile visual QA, full mission regression, Studio 10/10, typecheck and build passed.
- LIVE rendering was corrected from overlapping large circles to connected ribbon strokes with rounded caps; DOTS remains the only deliberately dotted method.
- LIVE is now the default spray method; DOTS is retained as the opt-in alternative via METHOD or V.
- Added an always-visible desktop key guide for movement, looking, use/interact, tool switching, spray method/color, fullscreen and pointer-lock release; it is hidden on touch/mobile where equivalent buttons are already visible.
- Demo hammer can continue removing any aimed intact wall brick beyond the four required mission hits. Leveling now exits pointer lock, provides a live bubble/depth graphic, supports clickable controls, and can be cancelled with right mouse or `EXIT LEVEL · RMB`.
- Verified a fifth post-objective demolition hit, real desktop LEFT/RIGHT clicks, right-mouse exit/resume, full mission completion, and a mobile leveling layout with full-width CONFIRM/EXIT and no clipping.
- Desktop game height now fills 100svh instead of stopping at 920px. Demolition ray range is 4.5m for ceiling/floor-edge bricks. LIVE spray uses one 2048x1024 canvas texture with round feathered strokes and fine mist instead of overlapping rectangular meshes.
- Verified at 1600x1200 that the game fills the viewport and the footer begins below it; verified separate demolition hits at wall heights 2.93m and 0.07m; full desktop/mobile mission smoke remains green with the canvas-based spray.
- Full 472-position wall scan exposed phantom re-hits on already shrunken InstancedMesh bricks. Destroyed instance IDs are now permanently filtered from raycasts so every hammer hit advances to an actually visible brick.
- Hammer targeting now uses a dense 5x5 chisel sampling grid around the reticle, and gameplay regression permanently asserts that all 472 wall bricks can be uniquely destroyed.

## Keep in mind

- Masonry removal must be geometry removal, not a dark overlay.
- Mortar must be one continuous shape with holes for box interiors and a front plane flush with box rims.
- Mobile touch-look must prevent page scrolling only inside the game interaction surface.
