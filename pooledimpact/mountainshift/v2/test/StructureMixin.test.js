// Individual-class (white-box) test: StructureMixin's graph/relational modes,
// composed via ExtendX.extend() onto a plain (non-BaseClassX) class -- proves
// explicit addChild(), synchronous inference via nested construction,
// spawnChildren()'s Promise.all-based concurrent sibling inference, the
// documented post-await inference limitation, relational linkTo/getConnected,
// mode 'none' as a true no-op, and detach()-on-dispose orphaning children.
// Run with: node test/StructureMixin.test.js
'use strict';
const path = require('path');
const V2 = path.join(__dirname, '..');
const ExtendX = require(path.join(V2, 'ExtendX.js'));
const { createStructureMixin, spawnChildren } = require(path.join(V2, 'StructureMixin.js'));
const { check, report } = require('./helpers.js');

function delay(ms, value) {
    return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

// A plain class, deliberately NOT a BaseClassX subclass -- StructureMixin
// must work independent of BaseClassX per its own header comment.
class Node {
    constructor(opts) {
        this.name = (opts && opts.name) || 'node';
    }
    greet() { return 'hi ' + this.name; }
    spawnOne(factory) { return factory(); }
}

// ─── graph mode ──────────────────────────────────────────────────────
const Structured = ExtendX.extend(Node, createStructureMixin(Node, { mode: 'graph' }));

const root = new Structured({ name: 'root' });
check('root: no inferred parent (empty stack at construction)', () => {
    if (root.getParent() !== null) throw new Error('expected null, got ' + root.getParent());
});

// --- explicit addChild() ---
const orphan = new Structured({ name: 'orphan' });
check('explicit addChild(): parent/child link established', () => {
    root.addChild(orphan._extId);
    if (root.getParent()) { /* n/a */ }
    if (!root.getChildren().includes(orphan._extId)) throw new Error('child missing from getChildren()');
    if (orphan.getParent() !== root._extId) throw new Error('getParent() did not report root');
});
check('explicit removeChild(): link removed', () => {
    root.removeChild(orphan._extId);
    if (root.getChildren().includes(orphan._extId)) throw new Error('child still present after removeChild()');
    if (orphan.getParent() !== null) throw new Error('orphan should be parentless after removeChild()');
});

// --- synchronous inference via nested construction ---
let nestedChild;
check('sync inference: constructing inside a dispatched method infers the caller as parent', () => {
    nestedChild = root.spawnOne(() => new Structured({ name: 'nested' }));
    if (nestedChild.getParent() !== root._extId) {
        throw new Error('expected inferred parent ' + root._extId + ', got ' + nestedChild.getParent());
    }
    if (!root.getChildren().includes(nestedChild._extId)) throw new Error('root.getChildren() missing nested child');
});

// --- spawnChildren() + Promise.all: concurrent sibling inference ---
async function siblingTest() {
    const parent = new Structured({ name: 'parent' });
    const kids = await spawnChildren(parent, [
        () => { const c = new Structured({ name: 'a' }); return delay(30, c); },
        () => { const c = new Structured({ name: 'b' }); return delay(5, c); },
        () => { const c = new Structured({ name: 'c' }); return delay(15, c); }
    ]);

    check('spawnChildren: all three children inferred parent = the spawning instance', () => {
        kids.forEach((k) => {
            if (k.getParent() !== parent._extId) {
                throw new Error(k.name + ': expected parent ' + parent._extId + ', got ' + k.getParent());
            }
        });
    });
    check('spawnChildren: parent.getChildren() lists all three, regardless of resolution order', () => {
        const childIds = parent.getChildren();
        kids.forEach((k) => {
            if (!childIds.includes(k._extId)) throw new Error(k.name + ' missing from getChildren()');
        });
    });
    check('spawnChildren: each child sees the OTHER two as siblings, not itself', () => {
        kids.forEach((k) => {
            const sibs = k.getSiblings();
            if (sibs.includes(k._extId)) throw new Error(k.name + ': getSiblings() incorrectly includes self');
            const others = kids.filter((x) => x !== k).map((x) => x._extId);
            others.forEach((id) => {
                if (!sibs.includes(id)) throw new Error(k.name + ': getSiblings() missing ' + id);
            });
        });
    });

    // --- documented limitation: construction AFTER an internal await is NOT
    // reliably inferred, because spawnChildren's finally pops parentId off
    // CONTEXT_STACK synchronously right after the factories' synchronous
    // prologues run -- long before any factory's own await resolves.
    const [late] = await spawnChildren(parent, [
        () => (async () => { await delay(1); return new Structured({ name: 'late' }); })()
    ]);
    check('documented limitation: a child constructed after its own factory awaits is NOT attributed to the spawning parent', () => {
        if (late.getParent() === parent._extId) {
            throw new Error('inference unexpectedly succeeded across an await -- limitation no longer holds, update the docs/test');
        }
    });
}

// --- mode 'none': true no-op, transparent passthrough ---
const NoOp = ExtendX.extend(Node, createStructureMixin(Node, { mode: 'none' }));
const noop = new NoOp({ name: 'noop' });
check('mode none: real method still works (transparent passthrough)', () => {
    if (noop.greet() !== 'hi noop') throw new Error('greet() broken under mode none');
});
check('mode none: no graph API is exposed', () => {
    if (typeof noop.getParent === 'function') throw new Error('mode none should not expose getParent()');
});

// --- detach on dispose: children orphaned, not re-parented ---
check('dispose(): detaches from parent and orphans its own children', () => {
    const p = new Structured({ name: 'p' });
    const c = p.spawnOne(() => new Structured({ name: 'c' }));
    const gc = c.spawnOne(() => new Structured({ name: 'gc' }));
    c.dispose();
    if (p.getChildren().includes(c._extId)) throw new Error('parent still lists disposed child');
    if (gc.getParent() !== null) throw new Error('grandchild should be orphaned (null parent), not re-parented');
});

// ─── relational mode ─────────────────────────────────────────────────
const Linked = ExtendX.extend(Node, createStructureMixin(Node, { mode: 'relational' }));
const linkA = new Linked({ name: 'linkA' });
const linkB = new Linked({ name: 'linkB' });
const linkC = new Linked({ name: 'linkC' });

check('relational: no graph API exposed (pure edges, no hierarchy)', () => {
    if (typeof linkA.getParent === 'function') throw new Error('relational mode should not expose getParent()');
});
check('linkTo()/getConnected(): arbitrary edges, independent of any hierarchy', () => {
    linkA.linkTo(linkB._extId, 'depends-on');
    linkA.linkTo(linkC._extId);
    const connected = linkA.getConnected();
    if (!connected.includes(linkB._extId) || !connected.includes(linkC._extId)) {
        throw new Error('getConnected() missing an outgoing edge target');
    }
    // Edges are bidirectional in the index (EDGES_IN mirrors EDGES_OUT), so
    // the target's own getConnected() should see the source too.
    if (!linkB.getConnected().includes(linkA._extId)) {
        throw new Error('getConnected() on the edge target should see the source back');
    }
});
check('unlinkFrom(): removes exactly the targeted edge', () => {
    linkA.unlinkFrom(linkB._extId, 'depends-on');
    if (linkA.getConnected().includes(linkB._extId)) throw new Error('edge to linkB should be gone');
    if (!linkA.getConnected().includes(linkC._extId)) throw new Error('unrelated edge to linkC should survive');
});

// ─── mode 'both': tree AND arbitrary edges coexist ────────────────────
const Both = ExtendX.extend(Node, createStructureMixin(Node, { mode: 'both' }));
const bothParent = new Both({ name: 'bp' });
const bothChild = bothParent.spawnOne(() => new Both({ name: 'bc' }));
check('mode both: graph inference works', () => {
    if (bothChild.getParent() !== bothParent._extId) throw new Error('graph half of "both" mode is broken');
});
check('mode both: relational edges also work, independent of the tree', () => {
    bothParent.linkTo(bothChild._extId, 'sees');
    if (!bothParent.getConnected().includes(bothChild._extId)) throw new Error('relational half of "both" mode is broken');
});

siblingTest().then(report).catch((err) => {
    console.error('siblingTest() failed:', err);
    process.exitCode = 1;
});
