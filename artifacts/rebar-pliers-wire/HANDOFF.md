# 250 mm rebar nippers and 1.6 mm wire — candidate handoff

## Authorized scope

The user supplied four references, selected 250 mm for the rebar tool, and
said “begin”. Implemented in the managed isolated worktree on
`codex/rebar-pliers-wire`, based on combined approved source `0d9f432`.
Candidate: `C:/Users/arz0r/.codex/worktrees/rebar-pliers-wire/Electrical-Game`.

## Reviewable result

- Editable geometry and wire deformation: `src/systems/RebarTyingModels.ts`.
- Runtime factory exports: `src/systems/PvcSecuringModels.ts`.
- Tool contact, complete half closure, axial rotation and hand targets:
  `src/systems/PvcWorkshop.ts`.
- Dimensions: 47 × 250 × 23 mm. The GLB has 8 meshes, 3552 triangles and an
  open/close clip. Held wire GLB has 1 mesh and 576 triangles. Metres and
  Three.js 0.185.1 export/reimport were verified.
- Black 1.6 mm wire retains both independently recessed holes and a constant
  diameter. Two connected strands form the progressive twist. Buffers are
  reused; the root scale stays 1 during tightening.
- Left hand feeds, then releases the wire. Right hand grips the paired handles
  and twists at the real tails. No glove geometry is hidden to pass clearance.
- Camera focus applies on feeding/tightening readiness, including prepared
  wire-first installation. Direct drilling retains the approved free aim.

## Evidence

`acceptance.json` records final source/build/export hashes, baseline failure,
three-layout native regression, three-layout wire-first workflow, full manual
workflow, owned skill-browser cleanup, measurements and limitations.

Both 70-frame unequal-depth and model/radius/retarget regressions pass.
Native direct-drilling acceptance also passed before the final tying-only
free-hand correction; the final native tie test drills four actual holes in
all three layouts again. Legacy wire-first QA now chooses the actual entrance
within its prepared pair; production clearance rejection remains intact.

Comparative runtime screenshots: `before-desktop.png`, `after-desktop.png`,
`after-portrait.png`. The first two use the same viewport, test camera and
0.377 tightening progress. The original is the actual shared Vite source;
the candidate is the exact compiled build in an owned test browser on the
existing 5365 origin. The changed tool and hand placement are the comparison.
All phone captures are PC Chrome emulation, not a physical iPhone/Safari test.

Build/typecheck and diff check pass. Existing sparse cinematic-image and large
chunk warnings remain. No dependency, port, listener, paid asset or agent was
added. Account meter at 2026-09-27 21:36:04 UTC: 16% weekly used, credit balance
0. Concurrent chats prevent assigning weekly usage or credit cost to this task.

## References and limits

Manufacturer sources and inferred rear/internal detail limits:
`docs/references/rebar-pliers-wire/README.md`. Exact user images and SHA256
receipts are retained only in ignored private
`output/rebar-pliers-wire/references/`; original attachments were preserved.
Runtime hand IK/wire deformation are TypeScript, not baked GLB gameplay or
Unreal import verification. The tool is a procedural reference interpretation.

## Protected base and next action

Shared runtime remains `C:/Users/arz0r/.codex/worktrees/jump-controls-release/Electrical-Game`,
commit `0d9f432`, PID 42244, `http://127.0.0.1:5365/Electrical-Game/`.
The final start-worker-preview verification confirmed the same checkout;
it was clean. The primary dirty checkout was not edited.

No candidate commit, push or live promotion occurred. AGENTS.md section 12
requires approval for promotion, and the visual review preference requires
approval before a major visual commit/push. Present the retained captures and
ask whether to integrate and publish this concrete candidate. After approval:
verify latest shared source, preserve newer approved changes and any dirty
files, make the focused commit, integrate into the same listener, rerun actual
served acceptance, then push/deploy only the agreed release and verify it.
Never start a second Electrical-Game listener or change port 5365.

Recovery copies of the two source files before each approved base update are
under ignored `output/rebar-pliers-wire/integration/` and
`output/rebar-pliers-wire/integration-direct/`. Final uncommitted candidate
source is in this managed worktree. Do not archive it while approval is pending.
