# Outfit correction — 2026-09-19

The broad, low and jagged shirt opening came from an anatomical body cut rather than a tailored neckline. Contrasting boundary-face materials exaggerated the irregular cut; the dark cotton and twill hid cloth details in the actual front gameplay view.

The retained source was tailored in Blender 5.1.2. WorkShirt now has a connected upper yoke and raised round rib collar following the neck surface. The source boundary is smoothed and mapped by its actual polar angles, avoiding radial fan folds and overlapping collar strips. Warm gray cotton, subtle waist gathering, a close-fitting rounded patch pocket and badge, softened holster corners/mouths, knee/ankle cloth folds, and a bridged front trouser fly bring the existing outfit closer to the supplied photograph. The existing sleeve deformation weights were preserved.

Editable source: `assets/source/worker.blend`. Runtime: `public/assets/worker/worker.glb`. Original backups: `output/outfit-correction/before/worker.blend` and `worker.glb`. Rebuild the candidate with:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.1/blender.exe' --background --python scripts/tailor-worker-outfit.py -- --source output/outfit-correction/before/worker.blend
```

The script writes candidates under `output/outfit-correction/candidate`, never directly overwrites the delivered source, and rejects applying the tailoring twice. Review candidates before copying to source/runtime. The editable source retains separate garment objects, 52 bones and all eight existing movement Actions. GLB uses the existing runtime IK and intentionally does not include these source clips. Skeleton transforms and inverse bind matrices match the retained GLB exactly. Hands, boots, tool grips, movement logic, and character face were not modified.

Geometry: 308,086 → 300,850 triangles; 170,785 → 167,229 exported vertices; 18 → 19 materials; GLB 12,034,272 → 11,779,076 bytes. Blender source was reopened and checked for all eight Actions, 52 bones, connected garment vertices and non-degenerate collar faces. Reports: `source-validation.json` and `glb-validation.json` under the evidence directory. Existing exporter modifier-order/image-sampler warnings were reviewed through the exported runtime; export succeeded.

Visual evidence: `output/outfit-correction/review.html`, with original and final same-camera front, spray, side, crouch and neckline captures. `tests/worker-outfit.mjs --before` serves the retained original GLB; `--candidate` serves the candidate; no flag checks the actual delivered asset. These are runtime scene captures, not generated retouching. The head and eyes remain the previous artwork and are outside this clothes correction. This is a game garment adaptation, not a scan or a claim of identical fabric fidelity to the photograph.

The isolated `codex/full-body-worker` checkout and fixed localhost port 5365 are retained. The protected main checkout is untouched. No package changes, downloads, paid assets, agents, commit/push or main promotion were used for this correction.

Validation completed: `npm run build`, `git diff --check`, 18 tool/body-persistence states (`worker-tools`), four spray skin/actuator checks (`worker-shadow-grip`), five arm postures (`worker-arm-posture`), five actual served outfit views and the bundled develop-web-game action client all passed. Runtime screenshots and client state were inspected. The delivered source/GLB hashes match the candidates; the HTTP-served GLB hash matches the delivered asset. The review's five buttons and ten images were checked.

Sequential performance samples on RTX 5080 / Chrome 153 / headless WebGL / 1440x810, moving sideways and changing yaw/crouch: CPU submit p95 6.8 → 3.8 ms, RAF p95 7.2 → 4.3 ms, max 9.1 → 5.1 ms, zero sampled frames >50 ms. These short runs show no observed regression; they do not establish a causal speedup or physical-mobile performance. Draw calls 252 → 254 from the separate collar material; rendered triangles 734,385 → 719,929. GPU duration, VRAM and long-session leakage were not measured. Build retains the preexisting >500 kB chunk advisory.
