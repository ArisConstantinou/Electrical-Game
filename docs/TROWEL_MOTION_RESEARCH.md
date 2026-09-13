# Mortar casting reference and implementation

Research checked 13 September 2026. The user's final swing reference requires a short forward flick with the forearm, wrist and hand on one straight axis. The blade starts loaded and open, turns over through axial forearm rotation, releases airborne mortar and returns. Their overloaded-trowel photo specifies an irregular heap extending beyond the blade, hanging skirts and residue on the neck.

## Primary sources

- [Marshalltown London Brick Trowels](https://www.marshalltown.com/pro-1893-london-brick-trowels?variantItemId=10186): forged high-carbon steel, a tapered blade, and wood or ergonomic handles. These construction features inform the thin satin steel blade, continuous forged neck, ferrule and contoured wooden handle. The model's dimensions and wear are authored for this game, not a scanned product.
- [NIST: Rheology](https://www.nist.gov/itl/math/rheology): mortar belongs to dense suspensions whose viscosity and yield stress affect when and how they flow. The visual approximation therefore holds a cohesive shape at rest and shears its upper mass during acceleration, with a damped return rather than continuous jelly-like oscillation.
- [Sika: Repairing Concrete Using Ready-to-Use Mortars](https://gbr.sika.com/dam/dms/gb01/3/Repairing%20Concrete%20Using%20Sika%20Ready%20To%20Use%20Mortars.pdf), section 9.4.1: hand application can include throwing mortar into a repair. This is a concrete repair method statement, not evidence for a particular wrist angle in a hollow-brick chase. The game uses throwing because the user explicitly selected that technique.

## Authored motion

1. Hold the loaded blade open, with its working face upward.
2. Prepare with a small movement while keeping the wrist neutral.
3. On button release, perform a short forward flick. The elbow moves on the upper-arm sphere; both arm segment lengths remain fixed.
4. Rotate the whole forearm and hand around their shared axis and detach the finite scoop at 0.16 seconds, using the visible blade's current release edge.
5. Continue with the blade turned over and empty, then return to the loaded rest pose by 0.82 seconds.

The 150-degree axial roll, timings, refill and deformation parameters are game animation choices, not measured universal trade technique. The existing charge timing, adhesion, gravity, cavity filling, washout and mass accounting remain active. Press/pack inputs no longer add material. Cancelling before release does not spawn mortar.

The loaded mesh deforms in place from immutable rest vertices. The contact layer stays on the blade while the upper mass lags, elongates and compresses. This is a bounded visual approximation of cohesive fresh mortar, not a calibrated continuum simulation.

## Verification boundaries

Native browser checks block Pointer Lock before navigation. Sequence checks cover desktop, portrait and landscape emulation at three wall distances, including real release timing, attached grip, fixed arm segment lengths, deformed load, camera stability, finite mass and visible framing. Emulation does not establish physical iPhone performance or operating-system mouse behavior.
