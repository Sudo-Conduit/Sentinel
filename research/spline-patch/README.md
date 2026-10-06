# Spline Patch — Hash-style 3/4/5-point patches + CP dynamics

Research prototype: an Animation:Master-style spline-patch modeler running in the
browser on three.js, where every control point is also a mass on springs. The aim is to
use one structure for two jobs: modeling a shape, and modeling how a connected system
moves and propagates disturbances.

## Files

| File | What it is |
|---|---|
| `SplinePatch.js` | Core math (UMD, no three.js dependency): spline network, patch detection, Gregory surfacing, tessellation, spring dynamics, presets |
| `SplinePatchModeler.html` | The modeler: three.js r128 viewer, CP editing, bias sliders, 5-point patch flagging, dynamics controls, JSON/OBJ export |
| `SplinePatch.test.js` | Checks: patch detection, surface interpolation and continuity, orientation, dynamics stability (`node research/spline-patch/SplinePatch.test.js`) |

Open `SplinePatchModeler.html` in a browser. It loads three.js from cdnjs/jsdelivr, like
the other viewers in `research/`.

## Model format

```json
{
  "cps":     [{ "pos": [x, y, z], "bias": { "mag": 1, "alpha": 0, "gamma": 0 }, "pinned": false }],
  "splines": [{ "cps": [0, 1, 2], "closed": false }],
  "fivePatches": [[0, 1, 2, 3, 4]],
  "sim": { "stiffness": 80, "damping": 0.8, "gravity": 0, "floor": null, "driveAmp": 0, "driveFreq": 0.5 }
}
```

- **Splines pass through their CPs.** A CP listed in two splines is where they cross,
  like an attached CP in A:M.
- **Patches are never declared.** Any chordless loop of 3 or 4 spline segments becomes a
  patch. 5-point patches are listed in `fivePatches`, because 5-loops turn up all over a
  cage (the pebble's waist ring, for one) and most of them aren't meant to be surfaces.
  The modeler lists every candidate so you can toggle it.
- **Bias** applies per CP: `mag` scales the tangent, `gamma` swings it within the plane of
  its neighbours, `alpha` tilts it out of that plane.

## How the surface is built

1. **Splines → Béziers.** Each segment is a cubic Bézier with Catmull-Rom tangents
   (one-sided at open ends), shaped by the CP bias.
2. **Patch detection.** Chordless 3- and 4-cycles of the CP graph, plus the flagged
   5-loops. Patches are then oriented consistently (shared edges run in opposite
   directions), and each closed body is flipped so its normals face outward.
3. **4-point patches → Gregory quads.** A plain bicubic shares one interior point per
   corner between two edges, so it can't match both neighbours. A Gregory quad keeps
   one per edge and blends them rationally. Each edge's cross-derivative is
   `α(t)·e'(t) + w(t)`, built from the corner handles, so two patches meet with matching
   normals along the whole edge even when it curves.
4. **3- and 5-point patches** are split into n Gregory quads around a centre point. The
   centre is lifted along the surface normal according to how steeply the boundary turns
   inward. Where the boundary is a single smooth spline (a 5-point cap on a closed ring),
   the cross direction at the rim CPs comes from the spline running through them from
   outside the patch, so the cap blends into its neighbours.

Measured seam continuity (max angle between the normals of neighbouring patches,
before shading welds them):

| Preset | Seams | Max angle |
|---|---|---|
| Sheet | 4 ↔ 4 | 0.07° |
| Drum | 3 ↔ 3 | 0.10° |
| Pebble | inside a 5-point cap | 0.02° |
| Pebble | 5-point cap ↔ quad band | 2.8° (only at the rim CPs, where the cap's corners are 180°) |

## Dynamics

Each CP is a unit mass. The springs are:
- every spline segment,
- skip-one "bend" links along each spline (stiffness along the curve),
- every corner pair in each patch (shear: keeps triangles, quads and pentagons from
  collapsing).

Rest lengths are taken from the pose when you press Play. Integration is semi-implicit
Euler with substeps, and the forces are relative stiffness + axial damping, gravity, drag
and an optional floor. Pinned CPs follow a sinusoidal drive (`driveAmp`, `driveFreq`,
`driveAxis`), so you can push a disturbance into the network and watch it travel. The
surface can be coloured by per-CP **strain** (mean relative spring stretch) or **speed**,
interpolated across each patch.

Presets:
- **Sheet:** a 6×6 cage of 4-point patches hanging from its pinned top row.
- **Pebble:** a closed body with two 5-point caps and two bands of quads; drop it on the floor.
- **Drum:** six 3-point patches around a hub; the rim is pinned and driven.

## Next steps

- **Hooks** (a spline ending partway along another, giving T-junctions): split the host
  segment at the hook parameter and treat the hook as a 180° corner, which the X-direction
  path already handles.
- **Per-spline bias.** A:M stores bias per CP per spline. Here it is per CP, applied to
  every spline through it.
- **CP authoring in the viewer:** add or extrude CPs, connect and break splines. Today,
  editing means moving CPs and changing bias, or importing JSON.
- **A:M `.mdl` import:** the format is text-based, so a parser is feasible given sample files.
- **System modeling:** map domain quantities onto CPs (loads, flows, exposures), so the
  strain and speed fields show how a shock spreads through a connected structure.
