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

Limits: the floor solver is a conservative shallow-flow approximation, not a full 3D fluid solve. The current room boundary does not model escape through the unfinished rear opening. Water Pro stock underwater post-processing remains disabled because its submersion plane is Y=0. The finite-room integration now supplies the actual local submersion state to the Water Pro surface and applies bounded, distance-dependent absorption along the submerged part of the sight ray. Swimming and full underwater post-processing are not implemented. This work does not claim physical iPhone/Safari verification.

## Validation

`test:room-water-field` exercises 7.2 L continuous supply and 1500 L additional flooding: all 29.0848 m² becomes wet, depth remains nonnegative, and measured conservation error is approximately 1.4e-12 L.

`test:room-water` runs headless Chrome at 1366×768 on native WebGPU and forced WebGL2. Normal held KeyE hose input first emits over 0.10 L and droplets actually reach the floor. Separately labeled volume fixtures create 22 L and 44 L puddles, merge them, then add 1500 L for long-duration flood visualization. Final geometry rises to approximately 54 mm and conservation remains within 1e-5 L. The fixtures accelerate the long-duration visual scenario; they are not presented as ordinary hose-time gameplay. Screenshots and reports are in `output/room-water`.

`test:room-water-performance` uses 60 controlled gameplay fracture calls, followed by 44 L merged-puddle and 1544 L room-flood fixtures. After a 1.5-second warmup, each scenario samples five seconds of completed render intervals. It awaits the renderer's asynchronous water pass and the backend completion fence (`GPUQueue.onSubmittedWorkDone` or `WebGL2.finish`). Automatic rendering is temporarily replaced by one explicit render per animation frame while the normal simulation continues. These headless, synchronized measurements include CPU work, browser scheduling and fence overhead; they are not isolated GPU timing, hardware capability claims, or directly comparable to the earlier synchronous-submit benchmark. Results are written to `output/room-water/performance.json`.

The retained 2026-09-13 run completed at approximately 60 FPS on WebGPU and 30 FPS on forced WebGL2 in both water stages. Worst completion intervals were 21.9 ms and 34.9 ms respectively. All 60 fracture calls succeeded on each backend. These are this run's measurements at 1366×768; the WebGL completion fence intentionally serializes GPU work. A subsequent visual-only change caps drop motion trails at 4 cm and lowers their opacity; the benchmark predates that change, with the same simulation, render passes and geometry counts.


## Water gun revision (2026-09-13)

The garden nozzle now has a perforated shower rose, selector collar, pistol grip and a single trigger hand. The primary design reference is the user's supplied shower-gun photo. The manufacturer describes adjustable hard/fine spray and single-hand volume control: https://www.gardena.com/uk/products/watering/nozzles-sprayers/classic-cleaning-nozzle/967306301.html . This supports the control design, not the authored numerical flow rates.

Four game modes use explicit litres/second, velocity and angular spread: MIST 0.12 L/s at 5 m/s; SHOWER 1 L/s at 8 m/s (default); JET 4 L/s at 16 m/s; FLOOD 40 L/s at 12 m/s. FLOOD is deliberately accelerated game flow, not a physical garden-hose capacity claim. The mobile context button cycles modes; Settings exposes the same choice on desktop/mobile. Existing hold/release input controls the trigger. Flow, accumulated litres and average floor depth stay in the compact water HUD.

Thirteen ballistic physical samples divide the delivered volume exactly and stop at the first masonry, box or water/floor collision. Exposed masonry absorbs a bounded quantity and the remainder runs down; water still washes fresh mortar. Missed streams carry their litres into gravity-driven batches. The old straight blue line is removed. Bounded smooth streams, beads and impact splashes render the airborne water without duplicating its physical volume.

The floor simulation now carries face momentum with hydrostatic pressure, floor friction and donor-limited conservative flux. This allows a broad moving puddle to spread and merge quickly, then rise throughout the closed room. The existing no-drain/no-depth-cap gameplay boundary remains.

Actual Water Pro now uses physical clear fresh-water optics, scene reflections without an outdoor ocean sky, depth-dependent shoreline blending and displacement. A real vendor WakeSystem generator disturbs the water at the gun's measured surface impact in both WebGPU and WebGL. Water depth capture and visible finite geometry share the same displacement node. Vendor SpraySystem was inspected and is a WebGPU-only waterline-crossing effect, so it is not misused as a nozzle emitter.

`node tests/water-gun-ui.mjs` covers real held/released input, mode selection, desktop/mobile settings, bounded water resources, zero browser errors and both renderer backends. A declared camera fixture and accelerated Game.step time exercise 120 seconds of held FLOOD: 4800 litres are emitted by gameplay, without addFloorWater injection, covering the 29.0848 square metre room and raising mean depth by approximately 16.5 cm. Field tests separately validate 1 metre-plus fill, positive depths and conservation. Earlier benchmark figures above describe the previous implementation and are not measurements of this revision.

The nozzle is posed around its single-hand grip before emission is sampled. The same world outlet and axis drive visible and physical water; moving aim immediately invalidates the visual update throttle. Full finite surface triangles and optical-only Gaussian depth reconstruction remove the square wet-cell contour without modifying physical volume.


## Default visible flooding revision

FLOOD is now the default water-gun mode at an explicitly boosted 160 L/s. In this 29.0848 m² closed room it supplies approximately 33 cm average depth per minute while held, allowing a visible body of water instead of only a thin wet floor. MIST, SHOWER and JET remain available for gentler work. The HUD prioritizes the actual mean water level, total floor litres and selected flow.

Water supply follows active elapsed wall time even below 20 FPS; the liquid collision solver advances in at most 50 ms steps. A 250 ms bound prevents background-tab catch-up bursts. Other player/tool integration keeps its existing limits. Native real-time flooding tests must validate the default path without changing modes, injecting litres or advancing simulation time.

The Water Pro integration supplies a 128px room cubemap through the vendor SkyProvider seam, replacing the bright-sky fallback previously used when SSR missed. Live FFT amplitude grows with depth, with soft displacement limits up to6.5cm; the measured vendor sampler produces centimetre-scale moving heights and non-flat normals. Optical depth follows the actual finite room level. Shallow puddles remain nearly calm. These are authored room-scale waves, not an ocean-height simulation.
