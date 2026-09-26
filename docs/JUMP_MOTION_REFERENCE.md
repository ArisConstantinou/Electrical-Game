# Construction worker jump

Approved 26 September 2026: Space plus a matching mobile/tablet button; open balancing arms carrying their objects, with the heavy SDS Max supported by both hands in front. Keep every floor connected and sufficient stair headroom.

Research sources read:
- Ubisoft, [AC Shadows parkour overview](https://www.ubisoft.com/en-us/game/assassins-creed/news/4TA6gKaTvtOC1mOjZIxCZd): movement capabilities and landing behaviour differ by character. Reference for connected movement phases, not a requirement for acrobatics.
- Insomniac, [Spider-Man technical interview](https://blog.playstation.com/?p=204132): character animation works together with traversal physics and camera presentation. Text interview reviewed; the linked GDC talk was identified but not watched.
- Bordelon et al., [weighted vertical jump study](https://pubmed.ncbi.nlm.nih.gov/32282626/): external-load placement and constrained arm swing change jump mechanics. This is not a motion-capture dataset for construction tools.

Implementation interpretation: 75 ms knee/hip preparation, approximately 0.52 m ballistic jump, bent and slightly asymmetric knees in flight, a lateral balancing arm sweep, then 280 ms planted-foot absorption. Loaded arm and object use the same rigid shoulder rotation after the hand contact solve. Heavy hammer keeps two contact frames and moves slightly toward the chest before both arm solves. These are authored procedural poses, not copied game animations or a claim of measured human reconstruction. No camera shake or increased jump height is used to hide body motion.

Acceptance: actual rendered takeoff/apex/landing frames from the same scene, all 12 tools, both hammer hands attached, side sweep for spray/drill, knees bending, no double jump, no ceiling penetration, keyboard and touch controls, and normal tool operation after landing.
