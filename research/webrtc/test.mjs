import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';
import { startSignalingServer } from './signaling-server.mjs';

const POPCNT = readFileSync(new URL('../popcnt/PopcntUnicode.js', import.meta.url).pathname, 'utf8');
const TRANSPORT = readFileSync(new URL('./webrtc-transport.js', import.meta.url).pathname, 'utf8');
const ICEADAPTERS = readFileSync(new URL('./ice-adapters.js', import.meta.url).pathname, 'utf8');

const sig = await startSignalingServer(0);
const WS = 'ws://127.0.0.1:' + sig.port;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: true, args: ['--no-sandbox']
});

// Two INDEPENDENT browser contexts = two separate peers (not same-page loopback).
async function peer(name, initiator) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(name, 'pageerror', String(e)));
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ content: POPCNT });
  await page.addScriptTag({ content: ICEADAPTERS });
  await page.addScriptTag({ content: TRANSPORT });
  return { ctx, page };
}
const A = await peer('A', true);
const B = await peer('B', false);

const SEED = 20260925, MSG = "federated payload: registry delta {k:'v', secret:'never-on-wire'}";
const N = MSG.length * 8;

// Peer B: connect (answerer), decode whatever arrives.
const bDone = B.page.evaluate(async ({ WS, POPCNT_SEED, N }) => {
  const pu = window.PopcntUnicode(); pu.run('keygen --seed '+POPCNT_SEED+' --N '+N+' --M 16 --id k');
  const t = new window.WebRTCTransport({ url: WS, room: 'r1', peer: 'B', initiator: false, iceAdapter: 'public' });
  const recv = new Promise(res => t.onMessage(d => {
    const dec = pu.run('decode --key k --packer base64 --text ' + JSON.stringify(d));
    res({ wireBytes: d.length, plaintext: String.fromCharCode.apply(null, dec.value), wireHadSecret: d.indexOf('never-on-wire') !== -1 });
  }));
  const info = await t.connect();
  return { info, result: await recv };
}, { WS, POPCNT_SEED: SEED, N });

// small delay so B has joined the room before A offers
await new Promise(r => setTimeout(r, 300));

// Peer A: connect (initiator), encrypt, send ciphertext only.
const aInfo = await A.page.evaluate(async ({ WS, POPCNT_SEED, N, MSG }) => {
  const pu = window.PopcntUnicode(); pu.run('keygen --seed '+POPCNT_SEED+' --N '+N+' --M 16 --id k');
  const enc = pu.run('encode --key k --packer base64 --payload ' + JSON.stringify(MSG));
  const t = new window.WebRTCTransport({ url: WS, room: 'r1', peer: 'A', initiator: true, iceAdapter: 'public' });
  const info = await t.connect();
  t.send(enc.value);
  return { info, wireSample: enc.value.slice(0, 40) + '...' };
}, { WS, POPCNT_SEED: SEED, N, MSG });

const b = await bDone;
console.log(JSON.stringify({
  signaling_relay: sig.stats(),          // proves the ws server actually carried offer/answer/ice
  A_ice_candidates: aInfo.info.candidateTypes,
  B_ice_candidates: b.info.candidateTypes,
  wire_sample: aInfo.wireSample,
  wire_had_plaintext_secret: b.result.wireHadSecret,
  recovered: b.result.plaintext,
  plaintext: MSG,
  round_trip: b.result.plaintext === MSG
}, null, 2));

await browser.close(); sig.close();
process.exit(b.result.plaintext === MSG && !b.result.wireHadSecret ? 0 : 1);
