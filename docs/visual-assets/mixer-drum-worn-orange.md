# Worn concrete mixer drum material

`public/assets/site-materials/mixer-drum-worn-orange.webp` is a 553,546-byte
WebP albedo texture made with the built-in image generation tool. It is used
on the existing rotating mixer drum; geometry, pivots and interaction targets
are unchanged. The generated PNG was converted to WebP at quality 86.

## Generation prompt

> Use case: photorealistic-natural. Asset type: seamless game PBR albedo texture for the exterior of a used portable concrete mixer steel drum. Produce ONE square, straight-on, evenly lit, flat color texture tile; no perspective, no visible object, no shadows, no highlights, no background. Surface: faded burnt-orange industrial powder coat with scattered genuine irregular pale gray cured-cement splashes, thin run-down drips, small rubbed edges revealing dark oxidized steel, very fine grit and mottled grime. Most area remains orange and readable. The cement has chipped, granular edges and varied opacity, not soft airbrush blobs. Seamless repetition on all four edges. Physically plausible construction-site wear; photoreal material scan quality. No logo, labels, writing, silhouettes, borders, gradients, tile seams or directional studio lighting.

## Visual acceptance

The same `mixer-close` camera in `tests/site-pro-room-tour.mjs` is captured
before and after on desktop and mobile viewports. The material also rendered
on the WebGPU path. The WebGL candidate kept 569 desktop and 513 mobile draw
calls at this view and used one more GPU texture than the baseline.
