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
// Collisions.
for (const [key, P] of Object.entries(T.PRESETS)) {
  const c = T.allCollisions(P.model());
  ok(!c.length, `${key} has no collisions ${c.map(x => T.label(x.a) + ' / ' + T.label(x.b) + ': ' + x.why).join('; ')}`);
}
{
  const m = T.PRESETS['gear-train'].model();
  const beam = m.parts.find(p => p.type === 'beam' && p.dir === 'x');
  const g = T.addPart(m, { type: 'gear', x: 4, y: 7, z: 2, axis: 'z', teeth: 24 });
  ok(T.collisionsWith(m, g).some(c => c.part === beam), 'a gear placed inside the top beam collides with it');
  T.removePart(m, g.id);
  const ax = T.addPart(m, { type: 'axle', x: 4, y: 6, z: 2, len: 1, axis: 'z' });
  ok(!T.collisionsWith(m, ax).length, 'an axle below the top beam is clear');
  ax.y = 7;
  ok(!T.collisionsWith(m, ax).some(c => c.part === beam), 'an axle through the beam’s hole is allowed');
  ax.axis = 'x';
  ok(T.collisionsWith(m, ax).some(c => c.part === beam), 'an axle across the beam, where it has no hole, collides');
  T.removePart(m, ax.id);
  const ax2 = T.addPart(m, { type: 'axle', x: 7, y: 7, z: 2, len: 3, axis: 'z' });
  ok(T.collisionsWith(m, ax2).some(c => c.part.type === 'gear' && c.part.teeth === 40) || T.collisionsWith(m, ax2).some(c => c.part.type === 'axle'), 'an axle reaching through the 40 collides');
}
// Weights stop against what is above them; racks stop at parts in their path.
{
  const w = T.compile(T.PRESETS.winch.model());
  run(w, 14);
  const load = w.dofs.find(d => d.kind === 'load'), lp = w.analysis.loads[0];
  ok(Math.abs(load.q - lp.up * T.U) < 0.0005 && Math.abs(load.v) < 1e-3, `winch weight stops under the drum (${(load.q / T.U).toFixed(3)} of ${lp.up.toFixed(3)} holes)`);
  const m = T.PRESETS.rack.model();
  T.addPart(m, { type: 'brick', x: 0, y: 5, z: 3, w: 1, h: 1, d: 1, holes: null });
  const mc = T.compile(m), r = mc.dofs.find(d => d.kind === 'slider');
  ok(Math.abs(r.qmin / T.U + 1) < 0.05, `a brick in the rack's path limits its travel (qmin ${(r.qmin / T.U).toFixed(3)} holes)`);
}
// Studs are solid: a worm sitting on the plate rubs on them; a brick stacked on them does not.
{
  const m = T.emptyModel();
  const plate = T.addPart(m, { type: 'brick', x: 0, y: 0, z: 0, w: 9, h: 1, d: 5, holes: 'y' });
  const w = T.addPart(m, { type: 'worm', x: 2, y: 1, z: 3, axis: 'z' });
  ok(T.collisionsWith(m, w).some(c => c.part === plate && /stud/.test(c.why)), 'a worm one level above the plate rubs on its studs');
  const b = T.addPart(m, { type: 'brick', x: 0, y: 1, z: 0, w: 4, h: 1, d: 1, holes: 'z' });
  ok(!T.collisionsWith(m, b).length, 'a brick on the plate sits over its studs');
}
// Bevel and worm (v5).
{
  const m = T.PRESETS.bevel.model(), c = T.compile(m);
  ok(c.joints.some(j => j.kind === 'bevel'), 'bevels on crossing axles mesh at a right angle');
  run(c, 1.5);
  const a = c.dofs.find(d => d.motor), b = c.dofs.find(d => d !== a && d.kind === 'rotor');
  ok(Math.abs(Math.abs(b.v / a.v) - 12 / 20) < 1e-3, `bevel ratio 12:20 (${(b.v / a.v).toFixed(4)})`);
  const par = T.emptyModel();
  const x = T.addPart(par, { type: 'bevel', x: 0, y: 3, z: 1, axis: 'z', teeth: 12 }), y = T.addPart(par, { type: 'bevel', x: 2, y: 3, z: 1, axis: 'z', teeth: 20 });
  ok(!T.clash(x, y), 'a 12 and a 20 bevel mesh as spur gears on parallel axles two holes apart');
  y.x = 1.5 + 2; ok(!!T.clash(x, y) === false, 'apart: no clash');
}
{
  const m = T.PRESETS.worm.model(), c = T.compile(m);
  run(c, 1.5);
  const pr = T.predict(m, c), comp = pr.components[0], motor = c.dofs.find(d => d.motor);
  ok(!comp.lock && Math.abs(comp.torqueNeeded - Math.abs(motor.lastImpulse.motor)) < 0.02 * comp.torqueNeeded, `worm drive: motor torque ${Math.abs(motor.lastImpulse.motor).toFixed(5)} ≈ hand ${comp.torqueNeeded.toFixed(5)} (with η = ${T.WORM_EFF.toFixed(3)})`);
  // Drive it backwards: a motor on the gear's axle cannot turn the worm.
  const m2 = T.emptyModel();
  const add = q => { const p = T.addPart(m2, q); for (const pin of T.autoPins(m2, p)) T.addPart(m2, pin); return p; };
  add({ type: 'brick', x: 0, y: 0, z: 0, w: 9, h: 1, d: 5, holes: 'y' });
  add({ type: 'brick', x: 0, y: 1, z: 0, w: 9, h: 1, d: 1, holes: 'z' });
  add({ type: 'brick', x: 0, y: 2, z: 0, w: 9, h: 1, d: 1, holes: 'z' });
  add({ type: 'axle', x: 4, y: 0, z: 3, len: 3, axis: 'y' });
  add({ type: 'motor', x: 4, y: 1, z: 3, axis: 'y', rpm: 30, torque: 0.1 });
  add({ type: 'gear', x: 4, y: 2, z: 3, axis: 'y', teeth: 24 });
  add({ type: 'axle', x: 2, y: 2, z: 0, len: 4, axis: 'z' });
  add({ type: 'worm', x: 2, y: 2, z: 3, axis: 'z' });
  ok(!T.allCollisions(m2).length, 'back-drive rig has no collisions');
  const c2 = T.compile(m2);
  ok(c2.dofs.some(d => d.motor), 'the gear-side motor is fixed and drives');
  run(c2, 1);
  const p2 = T.predict(m2, c2);
  ok(p2.components[0].lock && c2.dofs.every(d => Math.abs(d.v) < 1e-3), `worm self-locks: the gear cannot turn it (speeds ${c2.dofs.map(d => d.v.toFixed(4)).join(', ')})`);
}
console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
