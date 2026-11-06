// Headless check for v3: every preset is properly connected, runs, and matches the hand
// calculation; the connection rules (pins, studs, hinges, loose parts) behave.
const T = require('../Technic.js');
let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log('  FAIL', msg); } else console.log('  ok  ', msg); };
const run = (m, s) => { for (let i = 0; i < s * 60; i++) { m.step(1 / 60); T.record(m); } };

for (const [key, P] of Object.entries(T.PRESETS)) {
  const model = P.model(), m = T.compile(model), an = m.analysis;
  const notFixed = [...an.con.status].filter(([, s]) => s !== 'fixed');
  console.log(`${key}: ${model.parts.length} parts (${model.parts.filter(p => p.type === 'pin').length} pins), ${m.dofs.length} dofs, ${m.joints.length} joints`);
  ok(!an.issues.length, `${key} has no issues ${an.issues.map(i => i.text).join('; ')}`);
  ok(!notFixed.length, `${key} frame is fully fixed`);
  run(m, key === 'winch' ? 1 : 1.5);
  const pred = T.predict(model, m), sim = T.measure(m, 0.4);
  m.dofs.forEach((d, i) => {
    const p = pred.byDof.get(d), f = d.kind === 'rotor' ? 60 / (2 * Math.PI) : 1000;
    ok(Math.abs(sim[i] - p.v) <= 0.01 * Math.abs(p.v) + 1e-4, `${key} ${d.name}: hand ${(p.v * f).toFixed(3)} sim ${(sim[i] * f).toFixed(3)}`);
  });
}

// Connection rules.
{
  const model = T.PRESETS['gear-train'].model();
  const upright = model.parts.find(p => p.type === 'beam' && p.dir === 'y' && p.x === 0);
  const pins = model.parts.filter(p => p.type === 'pin' && p.x === 0 && p.y <= 1);
  ok(pins.length === 2, 'upright is held by two pins into the stacked bricks');
  T.removePart(model, pins[0].id);
  let con = T.connections(model);
  ok(con.status.get(upright) === 'hinged', 'one pin: the upright swings (hinged)');
  T.removePart(model, pins[1].id);
  con = T.connections(model);
  // The top beam still holds the upright by one pin, and the top beam is held by the other upright.
  ok(con.status.get(upright) !== 'fixed', `no pins into the bricks: upright is ${con.status.get(upright)}`);
  const model2 = T.PRESETS['gear-train'].model();
  for (const p of model2.parts.filter(p => p.type === 'pin')) T.removePart(model2, p.id);
  const an2 = T.analyze(model2);
  ok(an2.axles.some(a => !a.supported), 'with every pin gone the frame falls apart and axles lose their bearings');
  const m2 = T.compile(model2);
  ok(!m2.dofs.some(d => d.motor), 'a motor that is not pinned to the frame does not drive');
}
// Studs: a brick on a brick on the ground is fixed; a floating brick is loose.
{
  const m = T.emptyModel();
  const a = T.addPart(m, { type: 'brick', x: 0, y: 0, z: 0, w: 4, h: 1, d: 1 });
  const b = T.addPart(m, { type: 'brick', x: 2, y: 1, z: 0, w: 4, h: 1, d: 1 });
  const c = T.addPart(m, { type: 'brick', x: 10, y: 3, z: 0, w: 2, h: 1, d: 1 });
  const con = T.connections(m);
  ok(con.status.get(a) === 'fixed' && con.status.get(b) === 'fixed', 'stacked bricks are fixed through studs');
  ok(con.status.get(c) === 'loose', 'a brick in mid-air is loose');
}
// Auto-pins: a beam laid over a fixed beam's holes on the next layer gets two pins.
{
  const m = T.emptyModel();
  T.addPart(m, { type: 'brick', x: 0, y: 0, z: 0, w: 6, h: 1, d: 1, holes: 'z' });
  const beam = T.addPart(m, { type: 'beam', x: 0, y: 0, z: 1, len: 5, dir: 'x', holes: 'z' });
  const pins = T.autoPins(m, beam);
  ok(pins.length === 2 && Math.abs(pins[0].x - pins[1].x) === 4, `auto-pins: two pins, farthest apart (${pins.map(p => p.x).join(', ')})`);
  pins.forEach(p => T.addPart(m, p));
  ok(T.connections(m).status.get(beam) === 'fixed', 'pinned beam is fixed');
}
// v2 models migrate.
{
  const v2 = { version: 2, nextId: 4, parts: [
    { id: 1, type: 'beam', x: 0, y: 4, z: 1, len: 5, dir: 'x' },
    { id: 2, type: 'brick', x: 0, y: 0, z: 1, w: 3, h: 2, anchored: false, mass: 0.5 },
    { id: 3, type: 'gear', x: 1, y: 4, z: 2, teeth: 8 } ] };
  T.migrate(v2);
  ok(v2.version === 3 && v2.parts[0].holes === 'z' && v2.parts[1].free === true && v2.parts[2].axis === 'z', 'v2 model migrates to v3');
}
// Rack stops; winch jams at the drum.
{
  const model = T.PRESETS.rack.model(), m = T.compile(model);
  run(m, 20);
  const r = m.dofs.find(d => d.kind === 'slider');
  ok(Math.abs(r.v) < 1e-4 && r.q >= r.qmin - 1e-4 && r.q <= r.qmax + 1e-4, 'rack stops at its end');
  const w = T.compile(T.PRESETS.winch.model());
  run(w, 12);
  const rope = w.joints.find(j => j.kind === 'rope');
  ok(rope.length() >= rope.minLength - 1e-4, 'winch jams at the drum');
}
console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
