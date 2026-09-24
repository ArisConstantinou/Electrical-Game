# Courtyard tree source and editable model

- Visual source: [Poly Haven Island Tree 02](https://polyhaven.com/a/island_tree_02),
  a scanned **coastal tree** by Rico Cilliers (cleanup and processing) and
  Rob Tuytel (scanning and processing). Poly Haven lists it as CC0. It is used
  as an olive-like visual study; its source species is not identified as
  `Olea europaea` and this is not botanical identification.
- Original 1K glTF: `https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/island_tree_02/island_tree_02_1k.gltf`,
  MD5 `825057164e987894cbfc6c462977fa71`; accompanying `island_tree_02.bin`
  MD5 `7fa9d6ee752b670cabb65053a5c6395b`. The nine linked 1K JPEG maps
  came from the URLs and MD5 checksums in the [official files API](https://api.polyhaven.com/files/island_tree_02).
- Editable, texture-packed derivative: `artifacts/courtyard-tree/source/courtyard-tree-optimized.blend`.
  Runtime export: `courtyard-tree-optimized.glb`. Regenerate with Blender 5.1
  and `scripts/prepare-courtyard-tree.py` after placing the verified original
  glTF and its includes under `output/tree-source/`.
- The source's ~1.07 million polygons are split by material and reduced to
  131,515 triangles for this close, single courtyard tree. Trunk, branches
  and leaves stay separate and editable. Draco compression only changes the
  transfer representation; the decoded model is the same geometry.
- This is a visual candidate for the approved courtyard direction, not a
  final botanically accurate olive or a blanket replacement for the outer grove.
