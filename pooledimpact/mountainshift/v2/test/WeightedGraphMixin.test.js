// Individual-class (white-box) test: WeightedGraphMixin.js -- weighted/
// directed graph edges and bounded decision-driven walk() for any class
// composed via ExtendX.extend(), a sibling to StructureMixin's relational
// mode. Full life-cycle proof: linkTo (directed and undirected, numeric
// and function weight) -> getOutgoing/edgeTo/weightTo -> direction-
// respecting getReachable() BFS -> walk() (seeded-random reproducibility,
// decide()-driven fan-out, onVisit, avoidRevisit, sequential vs. parallel
// concurrency) -> dispose() -> the next()-injection hazard audit on
// linkTo()/walk()'s optional trailing `options` parameter.
//
// Run with: node test/WeightedGraphMixin.test.js
'use strict';
const path = require('path');
const V2 = path.join(__dirname, '..');
const ExtendX = require(path.join(V2, 'ExtendX.js'));
const { createWeightedGraphMixin, DIRECTIONS, CONCURRENCY } = require(path.join(V2, 'WeightedGraphMixin.js'));
const { check, report } = require('./helpers.js');

class Node {
    constructor(name) { this.name = name; }
}
const GraphNode = ExtendX.extend(Node, createWeightedGraphMixin(Node));

async function run() {
    // --- linkTo(): directed, numeric weight ---
    const a = new GraphNode('a');
    const b = new GraphNode('b');
    const c = new GraphNode('c');
    a.linkTo(b, { weight: 5, direction: DIRECTIONS.DIRECTED, label: 'a-to-b' });

    check('linkTo(): a directed edge is recorded on the SOURCE\'s outgoing set', () => {
        const out = a.getOutgoing();
        if (out.length !== 1 || out[0].target !== b._extId) throw new Error('expected one outgoing edge to b, got ' + JSON.stringify(out));
    });
    check('linkTo(): a DIRECTED edge is NOT mirrored into the target\'s own outgoing set', () => {
        if (b.getOutgoing().length !== 0) throw new Error('directed edge leaked into the target\'s outgoing set');
    });
    check('weightTo(): resolves a numeric weight as-is', () => {
        if (a.weightTo(b) !== 5) throw new Error('expected 5, got ' + a.weightTo(b));
    });
    check('edgeTo(): finds the edge by target instance and reports its label', () => {
        const edge = a.edgeTo(b);
        if (!edge || edge.label !== 'a-to-b') throw new Error('expected label "a-to-b", got ' + JSON.stringify(edge));
    });

    // --- linkTo(): undirected, function weight ---
    b.linkTo(c, { weight: (src, tgt) => src.name.length + tgt.name.length, direction: DIRECTIONS.UNDIRECTED });
    check('linkTo(): an UNDIRECTED edge IS mirrored into the target\'s own outgoing set', () => {
        const cOut = c.getOutgoing();
        if (cOut.length !== 1 || cOut[0].target !== b._extId) throw new Error('undirected edge was not mirrored into c\'s outgoing set');
    });
    check('resolveWeight()/weightTo(): a function weight is called with (source, target) real instances', () => {
        if (b.weightTo(c) !== 'b'.length + 'c'.length) throw new Error('expected 2, got ' + b.weightTo(c));
    });
    check('weightTo(): undefined when no edge exists', () => {
        if (a.weightTo(c) !== undefined) throw new Error('expected undefined, got ' + a.weightTo(c));
    });

    // --- direction-respecting getReachable() BFS ---
    check('getReachable(): follows a directed edge forward (a -> b, b -> c via undirected mirror)', () => {
        const reach = a.getReachable();
        if (!reach.includes(b._extId) || !reach.includes(c._extId)) throw new Error('expected a to reach both b and c, got ' + JSON.stringify(reach));
    });
    check('getReachable(): a directed edge does NOT let the target reach back to the source', () => {
        const reachFromB = b.getReachable();
        if (reachFromB.includes(a._extId)) throw new Error('b should not be able to reach back to a through a directed a->b edge');
        if (!reachFromB.includes(c._extId)) throw new Error('b should still reach c via the undirected edge');
    });
    check('getReachable(): an undirected edge is traversable from either endpoint, but does not cross back through a directed edge', () => {
        const reachFromC = c.getReachable();
        if (!reachFromC.includes(b._extId)) throw new Error('c should reach b via the undirected mirror');
        if (reachFromC.includes(a._extId)) throw new Error('c should NOT reach a -- that would require walking a directed edge backward');
    });

    // --- walk(): seeded-random reproducibility ---
    const d1 = new GraphNode('d1'), d2 = new GraphNode('d2'), d3 = new GraphNode('d3'), d4 = new GraphNode('d4');
    d1.linkTo(d2, { weight: 1 });
    d1.linkTo(d3, { weight: 1 });
    d2.linkTo(d4, { weight: 1 });
    d3.linkTo(d4, { weight: 1 });

    const walkA = await d1.walk({ hops: 3, seed: 42 });
    const walkB = await d1.walk({ hops: 3, seed: 42 });
    check('walk(): the same seed produces an identical walk every time', () => {
        if (JSON.stringify(walkA.map(v => v.extId)) !== JSON.stringify(walkB.map(v => v.extId))) {
            throw new Error('seeded walk was not reproducible');
        }
    });
    check('walk(): the default random pick stays within options.hops', () => {
        walkA.forEach((v) => { if (v.hops > 3) throw new Error('walk exceeded the hops bound: ' + v.hops); });
    });

    // --- walk(): decide()-driven fan-out visits every reachable node ---
    const fanOut = await d1.walk({ hops: 5, decide: (inst, candidates) => candidates });
    check('walk(): decide() returning an array fans out and visits every reachable node', () => {
        const names = fanOut.map((v) => v.instance.name).sort();
        if (JSON.stringify(names) !== JSON.stringify(['d1', 'd2', 'd3', 'd4', 'd4'].sort())) {
            throw new Error('expected d1,d2,d3,d4(x2) via both diamond paths, got ' + JSON.stringify(names));
        }
    });
    const stoppedEarly = await d1.walk({ hops: 5, decide: () => null });
    check('walk(): decide() returning a falsy value stops that branch early', () => {
        if (stoppedEarly.length !== 1) throw new Error('expected only the starting node, got ' + JSON.stringify(stoppedEarly.map((v) => v.instance.name)));
    });

    // --- walk(): onVisit fires for every node, including the start ---
    const visitOrder = [];
    await d1.walk({ hops: 5, decide: (inst, candidates) => candidates, onVisit: (inst) => visitOrder.push(inst.name), concurrency: CONCURRENCY.SEQUENTIAL });
    check('walk(): onVisit fires once per node visited, including the starting instance at hop 0', () => {
        if (visitOrder[0] !== 'd1') throw new Error('expected the first onVisit to be the starting node, got ' + visitOrder[0]);
        if (visitOrder.length !== 5) throw new Error('expected 5 onVisit calls (d1,d2,d4,d3,d4), got ' + visitOrder.length + ': ' + JSON.stringify(visitOrder));
    });

    // --- walk(): avoidRevisit forbids revisiting a node already in THIS branch's path ---
    const avoided = await d1.walk({ hops: 10, decide: (inst, candidates) => candidates, avoidRevisit: true });
    check('walk(): avoidRevisit still terminates cleanly on a bounded diamond graph', () => {
        if (avoided.length === 0) throw new Error('expected at least the starting node to be visited');
    });

    // --- walk(): hops validation ---
    let negativeHopsError = null;
    try {
        await d1.walk({ hops: -1 });
    } catch (e) {
        negativeHopsError = e;
    }
    check('walk(): a negative hops value throws RangeError', () => {
        if (!(negativeHopsError instanceof RangeError)) throw new Error('expected a RangeError for hops: -1, got ' + negativeHopsError);
    });

    // --- dispose(): removes this instance from the extId->instance registry ---
    const e1 = new GraphNode('e1'), e2 = new GraphNode('e2');
    e1.linkTo(e2, { weight: 1 });
    e1.dispose();
    const afterDispose = await e2.walk({ hops: 3, decide: (inst, candidates) => candidates });
    check('dispose(): a disposed instance can no longer be hopped TO by walk() (INSTANCES entry removed)', () => {
        if (afterDispose.length !== 1) throw new Error('expected only e2 itself (e1 unreachable after dispose), got ' + JSON.stringify(afterDispose.map((v) => v.instance.name)));
    });

    // --- next()-injection audit: linkTo()/walk() both take an OPTIONAL
    // trailing `options` object -- exactly the hazard shape found
    // repeatedly elsewhere in this codebase (StructureMixin/Kernel/BIOS/
    // Memory/Registry). Confirmed here as ACCIDENTALLY SAFE, the same way
    // Registry.save()'s omitted options was: every downstream field read
    // is guarded by a typeof/===/`in` check, so even when `opts` ends up
    // being ExtendX's injected next() callback (a function) instead of a
    // real options object, every field access on it (a function has none
    // of these properties) still resolves to the SAME safe default a
    // genuinely omitted options object would produce. ---
    const f1 = new GraphNode('f1'), f2 = new GraphNode('f2');
    f1.linkTo(f2); // options omitted entirely -- next() lands here under composition
    check('next()-injection audit: linkTo() with omitted options still gets real, safe defaults (not the injected next function)', () => {
        const edge = f1.edgeTo(f2);
        if (!edge) throw new Error('expected an edge to have been created');
        if (typeof edge.weight !== 'number' || edge.weight !== 1) throw new Error('expected default weight 1, got ' + JSON.stringify(edge.weight));
        if (edge.direction !== DIRECTIONS.DIRECTED) throw new Error('expected default direction "directed", got ' + edge.direction);
        if (edge.label !== null) throw new Error('expected default label null, got ' + edge.label);
    });
    const walkedWithNoOptions = await f1.walk();
    check('next()-injection audit: walk() with omitted options still runs safely with real defaults', () => {
        if (!Array.isArray(walkedWithNoOptions) || walkedWithNoOptions.length === 0) throw new Error('expected walk() to return a real result array');
    });

    report();
}

run().catch((err) => {
    console.error('WeightedGraphMixin.test.js failed:', err);
    process.exitCode = 1;
});
