# Finite room water and Water Pro

Water Pro 3.5.1 was verified in the local `trials-underwater-fix` checkout. The main `trials` checkout uses the separate MIT Open Ocean FFT renderer. This game uses the actual Water Pro component from the former checkout, not a relabeled copy of Open Ocean.

## Integration and source handling

`src/generated/room-water-runtime.js` is a minified, game-specific compiled End Product component. It exports only this game's room initialization function. Raw Water Pro vendor files remain outside this repository. The optional `node tools/build-room-water-runtime.mjs <licensed-vendor-directory>` command regenerates the component; normal CI/build does not need or download vendor source. Neither the compiled component nor the production Vite build emits source maps. The accompanying proprietary notice and license are preserved under `public/licenses`.

The inspected vendor agreement is version 2.2, dated August 14, 2026. Sections 2.1 and 3.3 permit compiled code within a finished End Product; section 3.2 forbids publishing vendor Source Files; section 3.4 excludes making Water Pro a component that third parties incorporate into their own products. This integration is for this finished game. It does not expose the vendor library as a Studio authoring/plugin/export API.

## Rendering

Three.js and its types match the verified Trials integration: 0.185.1 and 0.185.4. `Renderer.ready` waits for WebGPURenderer initialization. `attachRoomWater` initializes actual Water Pro, using either native WebGPU or the vendor-supported WebGL2 backend (`?renderer=webgl`). There is one canvas and one shared scene/camera coordinate system. `?waterPro=0` is an explicitly disabled diagnostic mode, not the default fallback.

The vendor simulation and current optical color graph supply water refraction, absorption, Fresnel response and screen-space room reflections. The stock infinite ocean mesh is replaced by the finite room geometry. A game material references those live vendor optical nodes while its position/opacity nodes follow the floor field. The source controller's position node is also kept aligned for water depth/reflection captures. Indoor sparkle and ocean foam are disabled. Normal alpha blending fades shallow puddle edges without the vendor ocean's premultiplied compositing fringe.

The existing clay and mortar onBeforeCompile grain shaders have explicit TSL equivalents in the renderer; textures, vertex colors and geometry remain unchanged. Render updates and final draws are serialized. Automated screenshots can await `renderer.waitForFrame()`. The established `renderer.webgl.info.render.calls` diagnostics path reports current draw calls, not WebGPU's cumulative render-pass counter.

## Physical accounting and bounds

`RoomWaterSystem` receives disjoint runoff and missed-spray callbacks in litres. `RoomWaterField` tracks cubic metres across a 64 × 54 finite grid. Pair transfers conserve volume and stay nonnegative. Millimetre-scale bed roughness creates local puddles; they spread, merge and raise the actual mesh vertex elevations. Continuous supply is retained at the room boundary. The floor area is 29.0848 m²; there is no hidden evaporation, drain, or capped flood depth.

Up to 128 moving water batches carry real litres and gravity. When the visual pool is full, batches merge conservatively instead of deleting their water. Moving drops collide with actual masonry occupancy and accumulate on the floor. `received = airborne + floor` is exposed as telemetry. Runoff `mortarKg` is informational turbidity metadata; the mortar system remains the sole owner of mortar mass.

Limits: the floor solver is a conservative shallow-flow approximation, not a full 3D fluid solve. The current room boundary does not model escape through the unfinished rear opening. Water Pro underwater post-processing is disabled because its stock submersion plane is Y=0; above-water puddles/flood surfaces rise correctly, but swimming/submerged-camera optics are not implemented. This work does not claim physical iPhone/Safari verification.

## Validation

`test:room-water-field` exercises 7.2 L continuous supply and 1500 L additional flooding: all 29.0848 m² becomes wet, depth remains nonnegative, and measured conservation error is approximately 1.4e-12 L.

`test:room-water` runs headless Chrome at 1366×768 on native WebGPU and forced WebGL2. Normal held KeyE hose input first emits over 0.10 L and droplets actually reach the floor. Separately labeled volume fixtures create 22 L and 44 L puddles, merge them, then add 1500 L for long-duration flood visualization. Final geometry rises to approximately 54 mm and conservation remains within 1e-5 L. The fixtures accelerate the long-duration visual scenario; they are not presented as ordinary hose-time gameplay. Screenshots and reports are in `output/room-water`.

`test:room-water-performance` uses 60 controlled gameplay fracture calls, followed by 44 L merged-puddle and 1544 L room-flood fixtures. After a 1.5-second warmup, each scenario samples five seconds of completed render intervals. It awaits the renderer's asynchronous water pass and the backend completion fence (`GPUQueue.onSubmittedWorkDone` or `WebGL2.finish`). Automatic rendering is temporarily replaced by one explicit render per animation frame while the normal simulation continues. These headless, synchronized measurements include CPU work, browser scheduling and fence overhead; they are not isolated GPU timing, hardware capability claims, or directly comparable to the earlier synchronous-submit benchmark. Results are written to `output/room-water/performance.json`.

The retained 2026-09-13 run completed at approximately 60 FPS on WebGPU and 30 FPS on forced WebGL2 in both water stages. Worst completion intervals were 21.9 ms and 34.9 ms respectively. All 60 fracture calls succeeded on each backend. These are this run's measurements at 1366×768; the WebGL completion fence intentionally serializes GPU work. A subsequent visual-only change caps drop motion trails at 4 cm and lowers their opacity; the benchmark predates that change, with the same simulation, render passes and geometry counts.
