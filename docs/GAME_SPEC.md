# WIRE THE HOUSE — Vertical Slice

## Product goal

A believable, mobile-friendly first-person simulator of residential electrical work in Cyprus. The first mission is a compact living room before plastering, with orange hollow-clay masonry, concrete structure and a complete first-fix loop. It is intentionally an indie vertical slice, not a full house or an AAA simulation.

## Mission

Complete three installation points in order: Point A is a socket group `2G + 1G` at 300 mm; Point B is a `2G` socket at 300 mm; Point C is a `1G` light switch at 1200 mm. Heights are measured from finished floor to the bottom edge of each box.

For every point: inspect, mark, chase real removable masonry, fit recessed boxes, apply continuous mortar, level tilt and depth, install visible 20 mm rigid PVC conduit, then pass first-fix inspection. The build ends at `FIRST FIX COMPLETE`.

## Controls

- Desktop: WASD, mouse look after entering, left mouse or E to use/hold the selected tool, V toggles DOTS/LIVE spray, C cycles spray color, X toggles the hammer between CHASE and DEMOLISH, A/D tilt and W/S depth while leveling, wheel or 1–6 to select tools, Shift to walk faster, F fullscreen, Esc releases pointer lock.
- Mobile: left movement joystick, swipe the free game area to look, large ACTION / SPRING / CUTTER controls, a touch hammer-method button for CHASE/DEMOLISH, and LEFT / RIGHT / IN / OUT / CONFIRM while leveling.

CHASE recesses only the blue marked masonry by about 105 mm so boxes and conduit can sit inside the wall while the surrounding brickwork remains intact. DEMOLISH preserves the original unrestricted destructive behavior.

## Architecture and continuation

The runtime is separated into core, player, world, electrical, systems, UI and data modules. Visible procedural assets carry stable Studio IDs and the repository includes `studio.webgame.json` plus a runtime adapter so Web Game Studio can open the scene hierarchy and edit transforms, materials, cameras and lights.
