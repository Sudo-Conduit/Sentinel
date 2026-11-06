# Mechanism Lab

Versions are archived side by side. A new version never overwrites an old one.

| Version | Folder | Artifact | What it is |
|---|---|---|---|
| v1 | `v1/` | https://claude.ai/artifact/WhVKzk9ju5bE8YZWuEWCuQ | Fixed reference scene: a pendulum strikes a block that compresses a spring. Proved the method: physics as ExtendX mixins, checked against a hand calculation. `MechanismLab_v1.bundle.html` is the published page exactly as it stood; `Mechanism.js` is its engine, extracted unchanged (sha256 matches the bundle header). |
| v2 | `v2/` | https://claude.ai/artifact/2Mn1J4CxQJaVcdAWHdWfQP | Builder. Beams, bricks, weights, axles, motors, gears (8/16/24/40), racks, pulleys, belts and ropes on a 3D Technic hole grid. Side and isometric are two cameras on one model. |
| v3 | `v3/` | https://claude.ai/artifact/VN75FjtxyZJ8RQhcSLyqu2 | Parts point along any axis; Side, Front, Top, Iso and a free orbit camera; a work plane that faces the camera. Parts join the Technic way (pins through lined-up holes, axles through holes, studs between stacked bricks and into the baseplate) and only fixed parts can hold a bearing or a motor. |
| v4 | `v4/` | https://claude.ai/artifact/L9kLLUMGoz4RgoaJj3YbXe | WebGL depth-buffer renderer (no libraries): what is in front never depends on the camera. Collision shapes for every part; placing, dragging and editing are refused when parts would collide; weights and racks stop against parts in their way. ExtendX 1.6.3 adds `ExtendX.unwrap()` (a WeakMap from layer frame to instance), replacing the `self` workaround. |
| v5 | `v5/` | https://claude.ai/artifact/35qTyLbHsJYeVmQG9niVSu | Bevel gears (12 and 20 double-bevels: right-angle meshes where axles cross, spur meshes on parallel axles) and worm gears (1 tooth per turn, friction at the thread: about 1/3 efficient and self-locking). The hand calculation accounts for worm losses and reports a worm driven from its gear side as locked. |
| v6 | `v6/` | https://claude.ai/artifact/56yL4BBnrPpngaSLFqFk94 | Planetary gear sets (sun / planet: 8/16, 12/12, 16/8, 20/8, 24/8; ring = sun + 2·planet, same tooth size as every gear). Sun on the centre axle, carrier on the next axle along the line, ring held in a pinned housing or free with 48 outside teeth. Willis relation z_s·ω_s + z_r·ω_r = (z_s + z_r)·ω_c in both solver and hand calculation. |

## v2 layout

- `Technic.js` — model helpers, analysis (what meshes, what holds what), compile to an ExtendX-composed machine, solver, hand calculation, examples.
- `MechanismLab_v2.html` — the builder page; loads `ExtendX.js` and `Technic.js`.
- `ExtendX.js` — the ExtendX 1.6.2 build the page was developed against, copied from the v1 bundle (the repo's `pooledimpact/mountainshift/v2/ExtendX.js` is still 1.1.0).
- `build.js` — `node build.js` inlines the scripts into `dist/MechanismLab_v2.bundle.html`, the file published as the artifact.
- `test/technic.test.js` — `node test/technic.test.js` runs every example and checks the simulation against the hand calculation.

## v3 layout

Same shape as v2 (`Technic.js`, `MechanismLab_v3.html`, `ExtendX.js`, `build.js`, `test/technic.test.js`). New in `Technic.js`: `connections()` (rigid clusters, fixed / hinged / loose), `autoPins()`, axis-aware geometry (`cells`, `holes`, `extent`), and `migrate()` for v2 models.

## v4 layout

As v3. `Technic.js` adds `solids()`, `clash()`, `collisionsWith()`, `allCollisions()` and `freeTravel()`. `ExtendX.js` here is 1.6.3: layer frames are recorded in a WeakMap and `ExtendX.unwrap(frame)` returns the real instance, so code that compares by identity can be handed a layer's `this`.

## v5 layout

As v4. `Technic.js` adds `bevel` and `worm` parts, `bevelMesh()` / `wormMesh()` geometry rules, the `WormMesh` mixin (rigid link plus Coulomb friction bounded by the thread force), and two examples. The page adds an Angles row to the parts drawer.

## v6 layout

As v5. `Technic.js` adds the `planetary` part, its analysis (sun, carrier and ring shafts; housing pinning), the three-term Willis joint, outside-ring meshing, and hand-calculation propagation through three-shaft joints. The page draws each set as moving pieces (ring, sun, carrier, three orbiting planets).
