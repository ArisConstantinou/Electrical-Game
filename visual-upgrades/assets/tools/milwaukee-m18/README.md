# Milwaukee M18 FID3 / FPD3

Reference reconstruction of the two requested tools, modelled in Blender 5.1.2.

## Research and dimensions

Primary references, accessed 2026-09-28:

- [Milwaukee M18 FID3](https://www.milwaukeetool.eu/en-eu/m18-fuel-1-4-hex-impact-driver/m18-fid3/): 113 mm head length; quarter-inch hex holder; three front LEDs; four DRIVE CONTROL modes; 226 Nm.
- [Milwaukee M18 FPD3](https://www.milwaukeetool.eu/en-eu/m18-fuel-percussion-drill/m18-fpd3/): 175 mm head length; 13 mm all-metal chuck; two-speed selector; torque collar; auxiliary handle; 158 Nm.

Side, front quarter and application photographs from those pages informed the motor casing, swept grip, nose, battery and handle. Head lengths and holder/chuck sizes use published specifications. Other exterior dimensions and moulding contours are estimates from the photographs. Internal mechanisms, motor torque and AUTOSTOP are not simulated by these visual assets. The B5 pack lettering follows the photographed 5.0 Ah pack.

`reference-research.json` records the original reference image URLs and hashes. Research photographs remain in ignored local output; they are not shell textures or shipped game assets. Branding is included for this requested reference reconstruction; Milwaukee retains its trademarks. No third-party tool mesh was used.

## Editable source

- `milwaukee-m18-fid3-fpd3.blend`: metre-scale source, named separate manufactured parts, bevel modifiers, packed printing and rubber normal textures, packed font, rigid chuck pivots.
- Collections: `M18_FID3`, `M18_FPD3`, `masonry_6mm`, `masonry_12mm`, `impact_ph2`. Hide the other collections to inspect an individual tool; each is authored at its own contact origin.
- The two PNG files are the reusable UV print mask and authored rubber normal map.
- Regenerate source, GLBs and six actual mesh renders with:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.1/blender.exe' --background --python scripts/build-m18-tools.py -- $PWD
node scripts/build-m18-review.mjs
```

The generator reuses the supplied white-ink mask if the original research logo is absent. It needs no download to regenerate the delivered assets.

## Runtime contract

Exports are under `public/assets/tools/milwaukee-m18/`. Game coordinates are metres, +Y up, -Z working direction, +Z towards the worker. Blender coordinates are `(game.x, -game.z, game.y)`; glTF exports with Y-up. Preserve metre scale during import.

| Tool | Grip | Chuck face Z | Chuck pivot | Tip with supplied bit |
|---|---|---|---|---|
| FPD3 | `[0, -.005, .011]` | `-.120` | `[0, .064, -.075]` | `[0, .064, -.265]` |
| FID3 | `[0, -.005, .011]` | `-.055` | `[0, .064, -.045]` | `[0, .064, -.125]` |

FPD3 support grip: `[-.122, .083, -.035]`. Each accessory has its exposed shank start at Z=0 and its tip at negative Z. The 6/12 mm masonry inserts have actual transverse dimensions of 6/12 mm; the PH2 shank is 6.35 mm across flats with chamfered corners.

The stable `reference-motor` group rotates only the chuck and bit. Housing, torque collar, LEDs, battery and auxiliary handle remain fixed. `M18ToolModels.ts` caches immutable source geometry/materials and creates independent transforms for FPS, PVC and inspector tools. All startup instances are ready before the game announces READY. The retired Poly Haven shell loader cannot overwrite the M18 model.

Static export copies are batched by material and rigid parent; the Blender source retains separate editable parts. FID3: 21,012 triangles / 12 primitives / 568,220 bytes. FPD3: 32,324 triangles / 13 primitives / 870,032 bytes. The 6/12 mm bits add 2,116 triangles and 4 primitives each; PH2 adds 208 triangles and 2 primitives. Normal and print maps are embedded in GLB. The Blender source retains fine procedural surface stipple; exported rubber detail uses the embedded normal map.

## Verification and delivery state

Candidate branch: `codex/milwaukee-m18-tools`, initially based on integrated `0d9f432`, then refreshed to verified `ea4216c` hammer-flow integration before final QA. Shared preview remains on port 5365. Candidate browser tests route the exact compiled candidate files through that same origin; they do not replace the running integration checkout.

- `npm.cmd run build`
- `node tests/m18-assets.mjs`: file integrity, embedded textures, unit normals, measured head dimensions, actual 6/12 mm diameter and tip datums, quarter-inch hex dimensions.
- `node tests/m18-tools-ui.mjs`: real desktop/mobile tool selection, loaded canonical assets, trigger/rotor presence, mesh count, no overflow, frame-step samples.
- `node tests/m18-work-ui.mjs`: native measurement, drilling, laser mounting and fastening, rotating chuck, static housing, bit/target contact, mouse and right-stick centre inputs.
- `node tests/pvc-left-click-drill-ui.mjs`: first action drills, four real masonry holes, no preliminary circles/E/button, wire insertion, native aiming during work, desktop and touch. The mid-drilling regression also requires both anatomical hands within 15 mm of their physical handles; measured final errors are below .001 mm. Reducing the dedicated drill body's rearward clearance from .42 to .17 m corrected the visible gap.
- `node tests/m18-frame-profile.mjs`: sequential 45 completed rendered frames per stationary FPS tool/view size. Desktop P95 drill 7.9 -> 8.8 ms, driver 7.8 -> 8.2 ms; portrait viewport 8.6 -> 8.4 and 8.7 -> 7.7 ms. No sampled >50 ms frame or graphics fault. This measures render submission through GPU completion-fence wall time on one PC, not isolated GPU timestamps or physical-mobile FPS.

Game screenshots, reports, matched baseline and candidate captures, studio views and the portable interactive viewer are in `output/m18-tools/`. Mobile results are desktop touch emulation. Actual phone performance has not been measured. The legacy laser test's fixed camera fixture failed before this change; the new work test freezes the camera at an actual reachable concrete surface while preserving native inputs and actual gameplay progress.

The user approved the candidate visual review on 2026-09-28. Commit, push and live promotion follow only after the final integration and served-runtime checks.
