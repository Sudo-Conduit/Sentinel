# Mechanism Lab

Versions are archived side by side. A new version never overwrites an old one.

| Version | Folder | Artifact | What it is |
|---|---|---|---|
| v1 | `v1/` | https://claude.ai/artifact/WhVKzk9ju5bE8YZWuEWCuQ | Fixed reference scene: a pendulum strikes a block that compresses a spring. Proved the method: physics as ExtendX mixins, checked against a hand calculation. `MechanismLab_v1.bundle.html` is the published page exactly as it stood; `Mechanism.js` is its engine, extracted unchanged (sha256 matches the bundle header). |
| v2 | `v2/` | https://claude.ai/artifact/2Mn1J4CxQJaVcdAWHdWfQP | Builder. Beams, bricks, weights, axles, motors, gears (8/16/24/40), racks, pulleys, belts and ropes on a 3D Technic hole grid. Side and isometric are two cameras on one model. |
| v3 | `v3/` | https://claude.ai/artifact/VN75FjtxyZJ8RQhcSLyqu2 | Parts point along any axis; Side, Front, Top, Iso and a free orbit camera; a work plane that faces the camera. Parts join the Technic way (pins through lined-up holes, axles through holes, studs between stacked bricks and into the baseplate) and only fixed parts can hold a bearing or a motor. |

## v2 layout

- `Technic.js` — model helpers, analysis (what meshes, what holds what), compile to an ExtendX-composed machine, solver, hand calculation, examples.
- `MechanismLab_v2.html` — the builder page; loads `ExtendX.js` and `Technic.js`.
- `ExtendX.js` — the ExtendX 1.6.2 build the page was developed against, copied from the v1 bundle (the repo's `pooledimpact/mountainshift/v2/ExtendX.js` is still 1.1.0).
- `build.js` — `node build.js` inlines the scripts into `dist/MechanismLab_v2.bundle.html`, the file published as the artifact.
- `test/technic.test.js` — `node test/technic.test.js` runs every example and checks the simulation against the hand calculation.

## v3 layout

Same shape as v2 (`Technic.js`, `MechanismLab_v3.html`, `ExtendX.js`, `build.js`, `test/technic.test.js`). New in `Technic.js`: `connections()` (rigid clusters, fixed / hinged / loose), `autoPins()`, axis-aware geometry (`cells`, `holes`, `extent`), and `migrate()` for v2 models.
