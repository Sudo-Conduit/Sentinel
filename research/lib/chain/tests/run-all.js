/**
 * @file research/lib/chain/tests/run-all.js
 * @author Will Fobbs
 * @description Runs every *.unit.js suite against one shared TestRunner and
 *              exits non-zero on any failure. Each unit file is also
 *              independently runnable on its own (node Tensor.unit.js).
 */
const TestRunner = require('./TestRunner.js');

const runner = new TestRunner();

require('./Data.unit.js')(runner);
require('./Complex.unit.js')(runner);
require('./Tensor.unit.js')(runner);
require('./Hilbert.unit.js')(runner);
require('./Hamiltonian.unit.js')(runner);
require('./FlatTensor.unit.js')(runner);
require('./NestedTensor.unit.js')(runner);
require('./ExtendXIntegration.unit.js')(runner);
require('./SecurityMixin.unit.js')(runner);
require('./WeightedGraphMixin.unit.js')(runner);
require('./SystemAdapter.unit.js')(runner);
require('./Geodesic.unit.js')(runner);
require('./GeodesicLink.unit.js')(runner);
require('./Torus.unit.js')(runner);
require('./MathPrecision.unit.js')(runner);
require('./MathExt.unit.js')(runner);
require('./Vector.unit.js')(runner);
require('./Polynomial.unit.js')(runner);

runner.run().then((result) => { process.exitCode = result.failed > 0 ? 1 : 0; });
