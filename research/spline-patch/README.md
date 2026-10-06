# Spline Patch — Hash-style 3/4/5-point patches + CP dynamics

Research prototype: an Animation:Master-style spline-patch modeler running in the
browser on three.js, where every control point is also a mass on springs. The aim is to
use one structure for two jobs: modeling a shape, and modeling how a connected system
moves and propagates disturbances. It also bridges 2D and 3D: you draw a cage flat, like
a vector drawing, then lift it into a surface.

## Files

| File | What it is |
|---|---|
| `SplinePatch.js` | Core math (UMD, no three.js dependency): spline network, patch detection, Gregory surfacing, tessellation, spring dynamics, presets |
| `SplineDraw.js` | 2D authoring (UMD, depends on `SplinePatch.js`): drawing planes, add/insert/delete CPs, inflate / extrude / lathe, SVG import and export |
| `SplinePatchModeler.html` | The modeler: 2D drawing pane + three.js r128 view, CP editing, bias sliders, 5-point patch flagging, dynamics controls, undo, JSON/SVG/OBJ in and out |
| `SplinePatch.test.js` | Checks: patch detection, surface interpolation and continuity, orientation, dynamics stability (`node research/spline-patch/SplinePatch.test.js`) |
| `SplineDraw.test.js` | Checks: drawing, CP insert/delete, inflate/extrude/lathe results and smoothness, SVG parsing and round trip (`node research/spline-patch/SplineDraw.test.js`) |

Open `SplinePatchModeler.html` in a browser. It loads three.js from cdnjs/jsdelivr, like
the other viewers in `research/`.

## Drawing in 2D, lifting to 3D

The left pane is an orthographic drawing view of one plane: **Front** (x/y, depth z),
**Top** (x/z, height y) or **Side** (z/y, depth x). The 3D view stays live beside it.

- **Draw (`D`).** Click to place CPs (snapped to a 0.25 grid unless Snap is off). Click
  an existing CP to run the spline through it; that is how splines cross. Click on a
  spline to insert a CP into it there and continue from it. Clicking the stroke's first
  CP closes the loop; `Enter` or a double-click ends an open stroke. Patches appear as
  soon as loops of 3 or 4 close, and the 4-CP loop then splits into two patches when a
  spline crosses it, the A:M way.
- **Select (`V`).** Click a CP to select it and drag it within the plane (its depth is
  kept), or set its depth with the slider. Click a spline to select it for extrude or
  lathe. `K` toggles a peaked (sharp) CP, `Del` deletes one (its splines rejoin around
  it), and `Ctrl+Z` / `Ctrl+Shift+Z` undo and redo every edit.
- **Lift to 3D:**
  - *Inflate:* the open outline stays in the plane and everything inside rises along a
    quarter-circle of its distance to the outline. Draw a grid, get a pillow.
  - *Extrude:* copies the selected spline out of the plane and joins each CP to its copy
    with a wall of quads. Extruding again continues from the copy.
  - *Lathe:* revolves the selected spline about the view's vertical axis. CPs on the
    axis become shared poles closed by 3-point patches; with an even segment count,
    opposite profiles join into one spline through the pole so it stays smooth. A closed
    profile off the axis gives a torus.
- **SVG.** Import reads `path`, `polyline`, `polygon`, `rect`, `circle`, `ellipse` and
  `line` into the current plane: anchors become CPs (plus one extra CP along each curve),
  and touching paths share CPs. Transforms are ignored. Export writes the cage as seen in
  the 2D view, with exact cubic Béziers (an orthographic projection of a Bézier is a
  Bézier), patches filled and splines stroked.

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
   5-loops. A 3- or 4-loop whose every edge already borders two other patches is a
   membrane across the inside of a tube (an extruded ring, a torus profile), so it is
   dropped. Patches are then oriented consistently (shared edges run in opposite
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
| Sheet | 4 ↔ 4 | 0.02° |
| Drum | 3 ↔ 3 | 0.02° |
| Inflated grid | 4 ↔ 4 | 0.00° |
| Lathed sphere | quads + pole triangles | 0.39° |
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
- **Two-sided inflate** (a closed "pillow" body) needs a way to keep the front and back
  halves from forming loops through each other; an explicit hole/exclude list would do it.
- **SVG fidelity:** carry each curve's handles into CP bias instead of adding midpoints,
  and apply transforms.
- **Touch:** pinch-zoom in the 2D pane.
- **A:M `.mdl` import:** the format is text-based, so a parser is feasible given sample files.
- **System modeling:** map domain quantities onto CPs (loads, flows, exposures), so the
  strain and speed fields show how a shock spreads through a connected structure.
