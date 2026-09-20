# Worker source and attribution

- Anatomical mesh: Blender Human Base Meshes bundle v1.4.1, Body Male - Realistic, CC0, https://www.blender.org/download/demo-files/ . The downloaded original is retained unchanged in the local ignored research directory; an uncut source copy is also retained inside worker.blend.
- Garments, boots, accessories, skeleton and runtime posing: project-authored adaptations. The product references guide appearance; these are not manufacturer-supplied CAD models.
- Milwaukee wordmark: extracted from the official Milwaukee EU page header for the user-requested brand depiction. This brand artwork and trademark are not covered by the anatomy mesh's CC0 dedication. No affiliation or endorsement is asserted.
- Private outfit reference photograph remains outside the repository and was not uploaded to a generation service.
- Build: Blender 5.1.2, scripts/build-worker.py and scripts/worker-outfit.py. Source keeps separate editable garment and accessory objects. Runtime GLB consolidates material groups around one 52-bone skeleton.
- Experimental review sample. worker.blend and the current runtime GLB include 24 directional locomotion Actions/clips (walk, jog, crouch in eight directions). The current game WorkerBody still uses procedural directional/contact IK; embedded clips alone do not establish runtime playback. No claim of production/mobile readiness.
