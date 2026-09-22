The optimized 512 px albedo maps in this directory come from Poly Haven
and are licensed CC0: https://polyhaven.com/license

- `concrete_floor-albedo-512.webp`: https://polyhaven.com/a/concrete_floor
- `concrete_screed-albedo-512.webp`: tonal adaptation of https://polyhaven.com/a/concrete_floor for the unfinished screed; CC0 source retained in `concrete_floor-albedo-512.webp`.
- `concrete-albedo-512.webp`: https://polyhaven.com/a/concrete
- `concrete-normal-512.webp`: matching CC0 normal map from https://polyhaven.com/a/concrete, reduced to 512 px for the board-formed slab soffit.
- `plastered_wall_03-albedo-512.webp`: https://polyhaven.com/a/plastered_wall_03
- `rusty_metal_03-diff-1k.jpg`: https://polyhaven.com/a/rusty_metal_03
- `gravelly_sand-albedo-512.webp`: https://polyhaven.com/a/gravelly_sand — 2.5 m-wide CC0 ground scan, also used on the modeled outdoor courtyard and planted verge at that physical scale.
- `bark-willow-512.webp`: https://polyhaven.com/a/bark_willow_02 — CC0 willow-bark diffuse scan by Charlotte Baglioni, reduced from the official 1K JPG (MD5 `384e25dd87b6b606458c9aa5f84735aa`) to an 82 KB WebP. Adapted as weathered grey olive bark; it is not a species-specific olive scan.
- `../masonry/red-brick-polyhaven-1k.jpg`: https://polyhaven.com/a/red_brick — 1K diffuse map by Rob Tuytel, CC0. Interior and courtyard clay units sample deterministic, mortar-free portions of the photographed brick faces; physical game geometry supplies the joints.
- `site-pro-screed-v1.webp`: generated for this game with the built-in imagegen tool, then encoded as WebP quality 88. Prompt and validation are in `artifacts/site-pro-04/screed-texture-prompt.md`. This is generated artwork, not a Poly Haven scan.

They are reduced-resolution copies for the in-game construction surfaces.
The older floor scan repeats at roughly 2.1 m; Site Pro screed repeats at roughly
3.8 m. Plaster and concrete are scaled to roughly 4 m, following each source
page's recorded real-world width.
The painted-metal scan is mixed lightly into the existing wheelbarrow tray and
concrete-mixer drum paint. It is not used as the shape of either object.
