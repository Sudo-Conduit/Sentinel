// Headless check: every preset runs, and the simulated speeds match the hand calculation.
const T = require('../Technic.js');
let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log('  FAIL', msg); } else console.log('  ok  ', msg); };

for (const [key, P] of Object.entries(T.PRESETS)) {
  const model = P.model();
  const m = T.compile(model);
  const an = m.analysis;
  console.log(`${key}: ${m.dofs.length} dofs, ${m.joints.length} joints, issues: ${an.issues.map(i => i.text).join('; ') || 'none'}`);
  for (let i = 0; i < 90; i++) { m.step(1 / 60); T.record(m); }
  const pred = T.predict(model, m), sim = T.measure(m);
  m.dofs.forEach((d, i) => {
    const p = pred.byDof.get(d);
    const unit = d.kind === 'rotor' ? 'rpm' : 'mm/s', f = d.kind === 'rotor' ? 60 / (2 * Math.PI) : 1000;
    console.log(`    ${d.name.padEnd(12)} hand ${(p.v * f).toFixed(3).padStart(9)} sim ${(sim[i] * f).toFixed(3).padStart(9)} ${unit}  q=${d.q.toFixed(4)}`);
  });
  for (const c of pred.components) console.log(`    motor ${c.motor.name}: needs ${c.torqueNeeded.toFixed(4)} N·m of ${c.torqueMax} → ${c.jam ? 'JAM' : c.stall ? 'STALL' : 'runs'}; sim torque ${(m.dofs.find(d => d === c.motor).lastImpulse.motor || 0).toFixed(4)}`);
  if (key !== 'rack' && key !== 'winch') m.dofs.forEach((d, i) => {
    const p = pred.byDof.get(d);
    ok(Math.abs(sim[i] - p.v) <= 0.01 * Math.abs(p.v) + 1e-4, `${key} ${d.name} matches hand calc`);
  });
}
// Winch: measure during the lift, before the load reaches the drum.
{
  const model = T.PRESETS.winch.model(), m = T.compile(model);
  for (let i = 0; i < 60; i++) { m.step(1 / 60); T.record(m); }
  const pred = T.predict(model, m), sim = T.measure(m, 0.4);
  m.dofs.forEach((d, i) => ok(Math.abs(sim[i] - pred.byDof.get(d).v) <= 0.01 * Math.abs(pred.byDof.get(d).v) + 1e-4, `winch ${d.name} during lift`));
  const motor = m.dofs.find(d => d.motor), c = pred.components[0];
  ok(Math.abs(Math.abs(motor.lastImpulse.motor) - c.torqueNeeded) < 0.03 * c.torqueNeeded, `winch motor torque ${motor.lastImpulse.motor.toFixed(5)} ≈ ${c.torqueNeeded.toFixed(5)}`);
  for (let i = 0; i < 600; i++) m.step(1 / 60);
  const load = m.dofs.find(d => d.kind === 'load'), rope = m.joints.find(j => j.kind === 'rope');
  ok(rope.length() >= rope.minLength - 1e-4 && Math.abs(load.v) < 1e-3, `winch jams at the drum (rope ${(rope.length() / T.U).toFixed(2)} holes, v ${load.v.toFixed(5)})`);
}
// Rack: moves at r·ω, then stops at its end.
{
  const model = T.PRESETS.rack.model(), m = T.compile(model);
  for (let i = 0; i < 30; i++) { m.step(1 / 60); T.record(m); }
  const pred = T.predict(model, m), sim = T.measure(m, 0.3), rack = m.dofs.find(d => d.kind === 'slider');
  ok(Math.abs(sim[rack.index] - pred.byDof.get(rack).v) < 0.01 * Math.abs(pred.byDof.get(rack).v), `rack speed ${(sim[rack.index]*1000).toFixed(2)} mm/s`);
  for (let i = 0; i < 1200; i++) m.step(1 / 60);
  ok(rack.q <= rack.qmax + 1e-4 && rack.q >= rack.qmin - 1e-4 && Math.abs(rack.v) < 1e-4, `rack stops at end (q ${(rack.q / T.U).toFixed(3)} holes in [${(rack.qmin/T.U)}, ${rack.qmax/T.U}])`);
}
// Layer toggles reach the physics: switch Weight off and the stalled winch lifts.
{
  const model = T.PRESETS['stalled-winch'].model(), m = T.compile(model);
  const load = m.dofs.find(d => d.kind === 'load');
  load.disableLayer(T.MIXINS.Weight);
  for (let i = 0; i < 30; i++) m.step(1 / 60);
  ok(load.q > 0.001, `weightless load rises (${(load.q * 1000).toFixed(1)} mm); chain: ${load.explain('forces')}`);
}
console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
