# Rebar nippers and tying wire

## Approved reference

The user supplied four photographs and corrected the chosen tool length to
250 mm. They then requested implementation with “begin”. The selected tool
family is concreters' end-cutting nippers, with long dipped handles, a compact
rounded head, opposed cutting bevels and a single rivet. Red coating is a grip
finish; it is not represented as an electrical insulation certification.

Primary research sources:

- [KNIPEX 99 11 250 product data](https://www.knipex.com/sites/default/files/Product%20data%20sheet%20ES%2099%2011%20250.pdf): 250 × 47 × 23 mm, 429 g, black phosphated body, polished head, plastic-coated handles; twisting and cutting binding wire.
- [KNIPEX tool family](https://www.knipex.com/products/concreters%27-nippers?search_api_fulltex___er_page=40): compact head and long slender handles for turning in the hand.
- [MAR-MAC black annealed wire](https://marmacinc.com/marmac-product/black-annealed-tie-wire/): soft low-carbon steel, supplied in coils.
- [Leeter wire sizes](https://www.leeter.cn/products/wire-tie-products/rebar-tie-wire/): available 1.2, 1.47 and 1.6 mm wire. This game uses 1.6 mm.

The exact supplied photographs and SHA256 receipts are retained privately in
`output/rebar-pliers-wire/references/`. They are not redistributed as game
assets. Manufacturer photographs are reference material, not artwork created
by this project.

## Editable source and exports

- `src/systems/RebarTyingModels.ts` owns the bevelled forged profiles, dipped
  handles, independent half pivots, metre scale, wire centreline and deformation.
- `PvcSecuringModels.ts` keeps the existing workshop factory API and drill.
- `PvcWorkshop.ts` drives complete handle/jaw closure, tool rotation, physical
  hand targets, fixed anchors and the actual selected pipe entry.
- `node scripts/export-rebar-pliers.mjs` exports a 250 mm GLB with an open/close
  clip and the loose 1.6 mm wire, then reimports them with Three.js GLTFLoader.

The GLBs are interchangeable presentation assets, not standalone gameplay.
Runtime wire deformation and hand IK remain in the editable TypeScript source.
The model is a reference-based procedural interpretation; rear surfaces and
internal manufacturing details are inferred. This is not an Unreal import
verification or a structural fastening specification.

## Acceptance

`tests/rebar-pliers-wire-ui.mjs` exercises the fitted pipe, four drilled holes,
two inserted wire pairs, both sequential tightening operations and conserved
inventory. It checks attached moving handles, 250 mm metadata, jaw contact,
anatomical reach, fixed root scale, 1.6 mm wire and stable geometry identities.
Desktop and two phone viewports are Chrome emulation on this Windows PC.

Candidate builds are intercepted only in the owned test browser on the existing
5365 origin using `TASK_BUILD_ROOT`; they do not replace the shared listener.
Screenshot/performance records are retained in `output/rebar-pliers-wire/`.

The left hand feeds the wire, then releases it before one-handed twisting.
The free arm keeps its existing anatomical rest pose; no skin is hidden to
avoid contact. Acceptance checks actual skinned vertices against the moving
polished cutting bevels and the floor, plus finite reach of the working hand.
Wire-first and fitted-pipe-first sequences retain independently recessed holes.
The focused legacy wire-first fixture selects a real entrance inside its
prepared pair, preserving the production clearance rejection for other ports.
