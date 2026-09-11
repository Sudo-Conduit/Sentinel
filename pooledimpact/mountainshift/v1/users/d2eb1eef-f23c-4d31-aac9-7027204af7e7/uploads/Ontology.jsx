import { useState, useEffect, useRef, useCallback } from "react";

const DB = {
  entities: [
    { id: "e1", type: "company",  name: "Stripe",      sector: "fintech",      arr: 4200 },
    { id: "e2", type: "investor", name: "Sequoia",      aum: 85000,             founded: 1972 },
    { id: "e3", type: "investor", name: "a16z",         aum: 35000,             founded: 2009 },
    { id: "e4", type: "company",  name: "OpenAI",       sector: "ai",           arr: 3400 },
    { id: "e5", type: "company",  name: "Figma",        sector: "design",       arr: 600  },
    { id: "e6", type: "investor", name: "Thrive Cap",   aum: 12000,             founded: 2009 },
    { id: "e7", type: "company",  name: "Anthropic",    sector: "ai",           arr: 1800 },
    { id: "e8", type: "fund",     name: "Conduit",      vintage: 2024,          size: 50  },
    { id: "e9", type: "company",  name: "Notion",       sector: "productivity", arr: 320  },
  ],
  stakes: [
    { id: "s1", holder_id: "e2", target_id: "e1", percentage: 10, trust_score: 0.90 },
    { id: "s2", holder_id: "e3", target_id: "e4", percentage: 8,  trust_score: 0.85 },
    { id: "s3", holder_id: "e2", target_id: "e4", percentage: 5,  trust_score: 0.78 },
    { id: "s4", holder_id: "e6", target_id: "e5", percentage: 22, trust_score: 0.92 },
    { id: "s5", holder_id: "e3", target_id: "e7", percentage: 15, trust_score: 0.88 },
    { id: "s6", holder_id: "e8", target_id: "e7", percentage: 3,  trust_score: 0.95 },
    { id: "s7", holder_id: "e3", target_id: "e9", percentage: 12, trust_score: 0.80 },
    { id: "s8", holder_id: "e6", target_id: "e4", percentage: 6,  trust_score: 0.72 },
  ],
};

// ── GQL Parser ────────────────────────────────────────────────────────────────
function parseGQL(query) {
  const tokens = query.trim().split(/\s+/);
  const ast = { type: tokens[0]?.toUpperCase(), entity: tokens[1]?.toLowerCase(), filters: [], traverse: null, path: null };
  if (tokens.includes("WHERE")) {
    const i = tokens.indexOf("WHERE");
    ast.filters.push({ field: tokens[i+1], op: "=", value: (tokens[i+3] || "").replace(/"/g, "") });
  }
  if (tokens.includes("TRAVERSE")) {
    const i = tokens.indexOf("TRAVERSE");
    ast.traverse = { edge: tokens[i+1], direction: (tokens[i+2] || "OUT").toUpperCase() };
  }
  if (ast.type === "PATH") {
    const fi = tokens.indexOf("FROM");
    const ti = tokens.indexOf("TO");
    if (fi !== -1 && ti !== -1) {
      ast.path = { from: tokens[fi+1]?.replace(/[()]/g,""), to: tokens[ti+1]?.replace(/[()]/g,"") };
    }
  }
  return ast;
}

// ── Query Engine ──────────────────────────────────────────────────────────────
function traverseGraph(entityId, direction = "OUT") {
  if (direction === "OUT") return DB.stakes.filter(s => s.holder_id === entityId).map(s => s.target_id);
  return DB.stakes.filter(s => s.target_id === entityId).map(s => s.holder_id);
}

// FIX: BFS traverses both directions so PATH FROM (e2) TO (e7) works even across hops
function findPath(start, end) {
  const queue = [[start]];
  const visited = new Set();
  while (queue.length) {
    const path = queue.shift();
    const node = path[path.length - 1];
    if (node === end) return path;
    if (!visited.has(node)) {
      visited.add(node);
      // Traverse OUT only — investors hold stakes in companies
      traverseGraph(node, "OUT").forEach(n => queue.push([...path, n]));
      // Also traverse IN so we can find indirect paths
      traverseGraph(node, "IN").forEach(n => {
        if (!visited.has(n)) queue.push([...path, n]);
      });
    }
  }
  return null;
}

function execute(ast) {
  if (ast.type === "PATH" && ast.path) {
    const path = findPath(ast.path.from, ast.path.to);
    if (!path) return { nodes: [], edges: [], pathIds: [] };
    const nodes = path.map(id => DB.entities.find(e => e.id === id)).filter(Boolean);
    // FIX: build edges along the actual path
    const edges = [];
    for (let i = 0; i < path.length - 1; i++) {
      const e = DB.stakes.find(s =>
        (s.holder_id === path[i] && s.target_id === path[i+1]) ||
        (s.holder_id === path[i+1] && s.target_id === path[i])
      );
      if (e) edges.push(e);
    }
    return { nodes, edges, pathIds: path };
  }

  // FIX: FIND stakes returns stake records, not entity records
  if (ast.entity === "stakes") {
    let data = [...DB.stakes];
    if (ast.filters.length) {
      data = data.filter(r => String(r[ast.filters[0].field])?.toLowerCase() === ast.filters[0].value?.toLowerCase());
    }
    return { nodes: [], edges: data, stakeMode: true };
  }

  let data = [...DB.entities];
  if (ast.filters.length) {
    data = data.filter(r => String(r[ast.filters[0].field])?.toLowerCase() === ast.filters[0].value?.toLowerCase());
  }
  if (ast.traverse) {
    const ids = new Set();
    data.forEach(d => traverseGraph(d.id, ast.traverse.direction).forEach(id => ids.add(id)));
    const traversed = [...ids].map(id => DB.entities.find(e => e.id === id)).filter(Boolean);
    // FIX: include edges between seed nodes and traversed nodes
    const allIds = new Set([...data.map(d => d.id), ...ids]);
    const edges = DB.stakes.filter(s => allIds.has(s.holder_id) && allIds.has(s.target_id));
    return { nodes: [...new Set([...data, ...traversed])], edges };
  }

  // FIX: always compute edges between returned nodes
  const nodeIds = new Set(data.map(d => d.id));
  const edges = DB.stakes.filter(s => nodeIds.has(s.holder_id) && nodeIds.has(s.target_id));
  return { nodes: data, edges };
}

function estimateCost(ast) {
  let c = 1;
  if (ast.filters.length) c += 2;
  if (ast.traverse) c += 5;
  if (ast.type === "PATH") c += 10;
  return c;
}

function plan(ast) {
  const cost = estimateCost(ast);
  if (cost < 5)  return { engine: "indexeddb", badge: "idb",  label: "IndexedDB" };
  if (cost < 10) return { engine: "pglite",    badge: "pg",   label: "PGLite"    };
  return            { engine: "server",     badge: "srv",  label: "Server"    };
}

function toSQL(ast) {
  if (ast.type === "FIND") {
    let sql = `SELECT * FROM ${ast.entity}`;
    if (ast.filters.length) sql += `\nWHERE ${ast.filters[0].field} = '${ast.filters[0].value}'`;
    if (ast.traverse) sql += `\n-- JOIN stakes ON traverse(${ast.traverse.direction})`;
    return sql;
  }
  if (ast.type === "PATH") return `-- BFS MATCH path\n--   (${ast.path?.from})-[*]->(${ast.path?.to})`;
  return "-- unsupported";
}

// ── Suggestions ───────────────────────────────────────────────────────────────
const SUGGESTIONS = [
  { label: "All entities",   q: 'FIND entities' },
  { label: "Companies",      q: 'FIND entities WHERE type = "company"' },
  { label: "Investors",      q: 'FIND entities WHERE type = "investor"' },
  { label: "AI sector",      q: 'FIND entities WHERE sector = "ai"' },
  { label: "All stakes",     q: 'FIND stakes' },
  { label: "Traverse out",   q: 'FIND entities WHERE type = "investor" TRAVERSE stakes OUT' },
  { label: "Path e2 → e7",   q: 'PATH FROM (e2) TO (e7)' },
  { label: "Path e3 → e1",   q: 'PATH FROM (e3) TO (e1)' },
];

const SCHEMA = [
  { name: "entities", icon: "E", cls: "#6c5ce7", fields: [
    { name: "id", type: "string", pk: true },
    { name: "type", type: "string" },
    { name: "name", type: "string" },
    { name: "sector", type: "string?" },
    { name: "arr", type: "float?" },
    { name: "aum", type: "float?" },
  ]},
  { name: "stakes", icon: "S", cls: "#00cec9", fields: [
    { name: "id", type: "string", pk: true },
    { name: "holder_id", type: "string" },
    { name: "target_id", type: "string" },
    { name: "percentage", type: "float" },
    { name: "trust_score", type: "float" },
  ]},
];

// ── Graph Layout ──────────────────────────────────────────────────────────────
function layoutNodes(entities, W, H) {
  const positions = {};
  const n = entities.length;
  if (!n) return positions;
  const cx = W / 2, cy = (H - 36) / 2;
  const r = Math.min(W, H - 36) * 0.32;
  entities.forEach((e, i) => {
    const angle = (2 * Math.PI * i / n) - Math.PI / 2;
    positions[e.id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
  if (n === 1) positions[entities[0].id] = { x: cx, y: cy };
  return positions;
}

function initials(name) {
  return (name || "?").split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

function nodeColor(type) {
  if (type === "investor") return { bg: "rgba(0,206,201,0.12)", border: "rgba(0,206,201,0.5)", text: "#00cec9" };
  if (type === "fund")     return { bg: "rgba(253,203,110,0.12)", border: "rgba(253,203,110,0.5)", text: "#fdcb6e" };
  return                          { bg: "rgba(108,92,231,0.15)", border: "rgba(108,92,231,0.5)", text: "#a29bfe" };
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Ontology() {
  const [query, setQuery] = useState("FIND entities");
  const [result, setResult] = useState({ nodes: [], edges: [], stakeMode: false });
  const [ast, setAst] = useState(null);
  const [activeTab, setActiveTab] = useState("results");
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);
  const [openSchema, setOpenSchema] = useState({});
  const [elapsed, setElapsed] = useState(null);
  const canvasRef = useRef(null);
  const [dims, setDims] = useState({ w: 600, h: 400 });

  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      for (const e of entries) {
        setDims({ w: e.contentRect.width, h: e.contentRect.height });
      }
    });
    if (canvasRef.current) obs.observe(canvasRef.current);
    return () => obs.disconnect();
  }, []);

  const run = useCallback((q) => {
    const qs = (q || query).trim();
    if (!qs) return;
    setQuery(qs);
    const t0 = performance.now();
    const parsed = parseGQL(qs);
    const res = execute(parsed);
    const t1 = performance.now();
    setAst(parsed);
    setResult(res);
    setSelected(null);
    setElapsed((t1 - t0).toFixed(1));
    setHistory(h => [qs, ...h.filter(x => x !== qs)].slice(0, 8));
  }, [query]);

  useEffect(() => { run("FIND entities"); }, []);

  const positions = layoutNodes(result.nodes, dims.w, dims.h);
  const p = ast ? plan(ast) : null;

  const badgeColor = p?.badge === "idb" ? "#a29bfe" : p?.badge === "pg" ? "#00cec9" : "#fdcb6e";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "240px 1fr 280px", gridTemplateRows: "48px 1fr", height: "100vh", background: "#0a0a0f", color: "#e8e6f0", fontFamily: "'DM Sans', sans-serif", fontSize: 13, overflow: "hidden" }}>

      {/* Topbar */}
      <div style={{ gridColumn: "1/-1", display: "flex", alignItems: "center", gap: 12, padding: "0 16px", background: "#14141e", borderBottom: "1px solid rgba(255,255,255,0.07)", zIndex: 10 }}>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 14, color: "#a29bfe", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#6c5ce7" }} />
          ONTOLOGY
        </div>
        <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.13)" }} />
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, background: "#181824", border: "1px solid rgba(255,255,255,0.13)", borderRadius: 8, padding: "0 12px", height: 32 }}>
          <span style={{ fontFamily: "monospace", fontSize: 11, color: "#a29bfe", whiteSpace: "nowrap" }}>GQL &gt;</span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && run()}
            placeholder='FIND entities WHERE type = "company"'
            style={{ flex: 1, background: "none", border: "none", outline: "none", fontFamily: "monospace", fontSize: 12, color: "#e8e6f0" }}
          />
        </div>
        <button onClick={() => run()} style={{ padding: "5px 14px", borderRadius: 6, background: "#6c5ce7", color: "#fff", border: "none", fontWeight: 500, cursor: "pointer", fontSize: 12 }}>Run</button>
        <button onClick={() => { setQuery(""); setResult({ nodes: [], edges: [] }); setAst(null); setElapsed(null); }} style={{ padding: "5px 14px", borderRadius: 6, background: "transparent", color: "#7a7890", border: "1px solid rgba(255,255,255,0.13)", cursor: "pointer", fontSize: 12 }}>Clear</button>
        {p && <span style={{ fontFamily: "monospace", fontSize: 10, padding: "3px 8px", borderRadius: 20, background: badgeColor + "22", color: badgeColor, border: `1px solid ${badgeColor}44` }}>{p.label}</span>}
        <span style={{ fontSize: 11, color: "#7a7890", whiteSpace: "nowrap" }}>v2.1 · GQL</span>
      </div>

      {/* Left sidebar */}
      <div style={{ background: "#14141e", borderRight: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)", fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", color: "#7a7890", textTransform: "uppercase" }}>Schema</div>
        <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
          {SCHEMA.map(ent => (
            <div key={ent.name} style={{ borderRadius: 6, overflow: "hidden", marginBottom: 4, border: "1px solid rgba(255,255,255,0.07)" }}>
              <div onClick={() => setOpenSchema(s => ({ ...s, [ent.name]: !s[ent.name] }))}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", cursor: "pointer", background: "#181824", fontSize: 12, fontWeight: 500 }}>
                <div style={{ width: 18, height: 18, borderRadius: 4, background: ent.cls + "33", color: ent.cls, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, fontFamily: "monospace" }}>{ent.icon}</div>
                <span>{ent.name}</span>
                <span style={{ marginLeft: "auto", fontSize: 10, color: "#7a7890" }}>{DB[ent.name]?.length}</span>
                <span style={{ fontSize: 10, color: "#7a7890", transition: "transform 0.15s", display: "inline-block", transform: openSchema[ent.name] ? "rotate(90deg)" : "none" }}>›</span>
              </div>
              {openSchema[ent.name] && ent.fields.map(f => (
                <div key={f.name} onClick={() => setQuery(q => q + (q ? " " : "") + f.name)}
                  style={{ display: "flex", justifyContent: "space-between", padding: "4px 10px 4px 36px", fontSize: 11, color: "#7a7890", borderTop: "1px solid rgba(255,255,255,0.07)", cursor: "pointer" }}>
                  <span>{f.name}{f.pk && <span style={{ fontSize: 9, color: "#fdcb6e", marginLeft: 4 }}>PK</span>}</span>
                  <span style={{ fontFamily: "monospace", fontSize: 10, color: "#a29bfe", opacity: 0.7 }}>{f.type}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid rgba(255,255,255,0.07)", borderBottom: "1px solid rgba(255,255,255,0.07)", fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", color: "#7a7890", textTransform: "uppercase" }}>Quick Queries</div>
        <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 4, overflowY: "auto", maxHeight: 200 }}>
          {SUGGESTIONS.map(s => (
            <div key={s.q} onClick={() => run(s.q)} style={{ fontFamily: "monospace", fontSize: 10, color: "#7a7890", padding: "5px 8px", borderRadius: 4, cursor: "pointer", border: "1px solid rgba(255,255,255,0.07)", background: "#181824" }}>
              <div style={{ fontSize: 9, color: "#6c5ce7", marginBottom: 2, fontFamily: "sans-serif", textTransform: "uppercase", letterSpacing: "0.08em" }}>{s.label}</div>
              <div style={{ opacity: 0.7 }}>{s.q}</div>
            </div>
          ))}
        </div>
        {history.length > 0 && <>
          <div style={{ padding: "10px 14px", borderTop: "1px solid rgba(255,255,255,0.07)", borderBottom: "1px solid rgba(255,255,255,0.07)", fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", color: "#7a7890", textTransform: "uppercase" }}>History</div>
          <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 4, overflowY: "auto", maxHeight: 120 }}>
            {history.map(h => (
              <div key={h} onClick={() => run(h)} style={{ fontFamily: "monospace", fontSize: 10, color: "#7a7890", padding: "5px 8px", borderRadius: 4, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>$ {h}</div>
            ))}
          </div>
        </>}
      </div>

      {/* Canvas */}
      <div ref={canvasRef} style={{ position: "relative", background: "#0a0a0f", overflow: "hidden" }}>
        {/* Grid */}
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)", backgroundSize: "40px 40px", pointerEvents: "none" }} />

        {/* Empty state */}
        {!result.nodes?.length && !result.stakeMode && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, pointerEvents: "none" }}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" style={{ opacity: 0.2 }}>
              <circle cx="8" cy="16" r="5" stroke="currentColor" strokeWidth="1.5"/>
              <circle cx="24" cy="8" r="5" stroke="currentColor" strokeWidth="1.5"/>
              <circle cx="24" cy="24" r="5" stroke="currentColor" strokeWidth="1.5"/>
              <line x1="13" y1="13" x2="19" y2="11" stroke="currentColor" strokeWidth="1.5"/>
              <line x1="13" y1="19" x2="19" y2="21" stroke="currentColor" strokeWidth="1.5"/>
            </svg>
            <span style={{ fontFamily: "monospace", fontSize: 13, color: "#7a7890" }}>Run a query to populate the graph</span>
          </div>
        )}

        {/* Edges SVG */}
        <svg style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }} width={dims.w} height={dims.h}>
          <defs>
            <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M2 1L8 5L2 9" fill="none" stroke="rgba(108,92,231,0.5)" strokeWidth="1.5" strokeLinecap="round"/>
            </marker>
          </defs>
          {result.edges?.map(edge => {
            const from = positions[edge.holder_id];
            const to   = positions[edge.target_id];
            if (!from || !to) return null;
            const mx = (from.x + to.x) / 2;
            const my = (from.y + to.y) / 2 - 5;
            return (
              <g key={edge.id}>
                <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="rgba(108,92,231,0.35)" strokeWidth="1.5" markerEnd="url(#arr)" />
                <text x={mx} y={my} textAnchor="middle" fontSize="9" fill="rgba(162,155,254,0.7)" fontFamily="monospace">{edge.percentage}%</text>
              </g>
            );
          })}
        </svg>

        {/* Nodes */}
        {result.nodes?.map(e => {
          const pos = positions[e.id];
          if (!pos) return null;
          const c = nodeColor(e.type);
          const isSelected = selected?.id === e.id;
          return (
            <div key={e.id} onClick={() => setSelected(isSelected ? null : e)}
              style={{ position: "absolute", left: pos.x, top: pos.y, transform: "translate(-50%, -50%)", cursor: "pointer", userSelect: "none", textAlign: "center" }}>
              <div style={{ width: 52, height: 52, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace", fontSize: 11, fontWeight: 600, background: c.bg, border: `2px solid ${isSelected ? c.text : c.border}`, color: c.text, boxShadow: isSelected ? `0 0 0 3px ${c.text}44` : "none", transform: isSelected ? "scale(1.1)" : "scale(1)", transition: "all 0.15s", margin: "0 auto" }}>
                {initials(e.name)}
              </div>
              <div style={{ fontSize: 10, color: "#7a7890", marginTop: 5, whiteSpace: "nowrap" }}>{e.name}</div>
            </div>
          );
        })}

        {/* Stats bar */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, display: "flex", gap: 16, padding: "8px 12px", background: "#14141e", borderTop: "1px solid rgba(255,255,255,0.07)", fontFamily: "monospace", fontSize: 10, color: "#7a7890" }}>
          <span>◆ {result.nodes?.length ?? 0} nodes</span>
          <span>◆ {result.edges?.length ?? 0} edges</span>
          <span>◆ {elapsed ? `${elapsed}ms` : "—"}</span>
          {p && <span style={{ marginLeft: "auto", color: badgeColor }}>engine: {p.label}</span>}
        </div>
      </div>

      {/* Right panel */}
      <div style={{ background: "#14141e", borderLeft: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          {["results","ast","plan"].map(t => (
            <div key={t} onClick={() => setActiveTab(t)} style={{ flex: 1, padding: 10, textAlign: "center", fontSize: 11, fontWeight: 500, cursor: "pointer", color: activeTab === t ? "#a29bfe" : "#7a7890", borderBottom: `2px solid ${activeTab === t ? "#6c5ce7" : "transparent"}`, marginBottom: -1, transition: "all 0.1s", textTransform: "capitalize" }}>{t}</div>
          ))}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>

          {/* Results tab */}
          {activeTab === "results" && (() => {
            const items = selected ? [selected] : (result.stakeMode ? [] : result.nodes);
            const stakes = selected ? DB.stakes.filter(s => s.holder_id === selected.id || s.target_id === selected.id) : [];
            if (result.stakeMode) return (
              <div>
                {result.edges?.map(s => (
                  <div key={s.id} style={{ background: "#181824", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, marginBottom: 8, overflow: "hidden" }}>
                    <div style={{ padding: "8px 12px", background: "#111118", borderBottom: "1px solid rgba(255,255,255,0.07)", fontSize: 11, display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontWeight: 600 }}>{s.id}</span>
                      <span style={{ fontFamily: "monospace", fontSize: 10, color: "#7a7890" }}>stake</span>
                    </div>
                    <div style={{ padding: "8px 12px" }}>
                      {Object.entries(s).filter(([k]) => k !== "id").map(([k, v]) => (
                        <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                          <span style={{ fontSize: 11, color: "#7a7890", fontFamily: "monospace" }}>{k}</span>
                          <span style={{ fontSize: 11, fontFamily: "monospace", color: typeof v === "number" ? "#fdcb6e" : "#55efc4" }}>{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
            if (!items.length) return <div style={{ color: "#7a7890", fontSize: 12, padding: 16, fontFamily: "monospace" }}>— no results —</div>;
            return items.map(item => (
              <div key={item.id} style={{ background: "#181824", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, marginBottom: 8, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#111118", borderBottom: "1px solid rgba(255,255,255,0.07)", fontSize: 11 }}>
                  <span style={{ fontWeight: 600, fontSize: 12 }}>{item.name}</span>
                  {item.type && <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 10, background: "rgba(108,92,231,0.2)", color: "#a29bfe", border: "1px solid rgba(108,92,231,0.3)" }}>{item.type}</span>}
                  <span style={{ marginLeft: "auto", fontFamily: "monospace", fontSize: 10, color: "#7a7890" }}>{item.id}</span>
                </div>
                <div style={{ padding: "8px 12px" }}>
                  {Object.entries(item).filter(([k]) => !["id","name","type"].includes(k)).map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                      <span style={{ fontSize: 11, color: "#7a7890", fontFamily: "monospace" }}>{k}</span>
                      <span style={{ fontSize: 11, fontFamily: "monospace", color: typeof v === "number" ? "#fdcb6e" : "#55efc4" }}>{v}</span>
                    </div>
                  ))}
                  {stakes.length > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", marginTop: 6, borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 6 }}>
                    <span style={{ fontSize: 11, color: "#7a7890", fontFamily: "monospace" }}>stakes</span>
                    <span style={{ fontSize: 11, fontFamily: "monospace", color: "#fdcb6e" }}>{stakes.length}</span>
                  </div>}
                </div>
              </div>
            ));
          })()}

          {/* AST tab */}
          {activeTab === "ast" && ast && (
            <div style={{ fontFamily: "monospace", fontSize: 11, color: "#7a7890", lineHeight: 1.8 }}>
              {[["type", ast.type], ["entity", ast.entity], ["filters", JSON.stringify(ast.filters)], ["traverse", JSON.stringify(ast.traverse)], ["path", JSON.stringify(ast.path)]].map(([k, v]) => (
                <div key={k} style={{ marginBottom: 8 }}>
                  <span style={{ color: "#fd79a8" }}>{k}</span>: <span style={{ color: v === "null" || !v ? "#7a7890" : "#55efc4" }}>{String(v)}</span>
                </div>
              ))}
              <div style={{ marginTop: 16, borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 12 }}>
                <div style={{ fontSize: 9, color: "#7a7890", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>SQL Compilation</div>
                <div style={{ color: "#55efc4", lineHeight: 1.8, whiteSpace: "pre" }}>{toSQL(ast)}</div>
              </div>
            </div>
          )}

          {/* Plan tab */}
          {activeTab === "plan" && ast && (() => {
            const steps = [
              { label: "Parse GQL", detail: `type=${ast.type} entity=${ast.entity}` },
              ...(ast.filters.length ? [{ label: "Apply filter", detail: `${ast.filters[0].field} = "${ast.filters[0].value}"` }] : []),
              ...(ast.type === "PATH" ? [{ label: "BFS pathfinding", detail: `${ast.path?.from} → ${ast.path?.to}` }] : []),
              ...(ast.traverse ? [{ label: "Graph traversal", detail: `edge=${ast.traverse.edge} dir=${ast.traverse.direction}` }] : []),
              { label: `Execute via ${p.label}`, detail: `cost=${estimateCost(ast)}` },
            ];
            const cost = estimateCost(ast);
            const pct = Math.round((cost / 16) * 100);
            return (
              <div>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#7a7890", marginBottom: 6 }}>
                    <span>Query cost</span><span style={{ color: badgeColor }}>{cost} / 16 · {p.label}</span>
                  </div>
                  <div style={{ height: 4, background: "rgba(255,255,255,0.07)", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: badgeColor, borderRadius: 2, transition: "width 0.4s" }} />
                  </div>
                </div>
                {steps.map((s, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", borderBottom: i < steps.length - 1 ? "1px solid rgba(255,255,255,0.07)" : "none" }}>
                    <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#181824", border: "1px solid rgba(255,255,255,0.13)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace", fontSize: 10, color: "#7a7890", flexShrink: 0 }}>{i+1}</div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 3 }}>{s.label}</div>
                      <div style={{ fontSize: 11, color: "#7a7890", fontFamily: "monospace" }}>{s.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

        </div>
      </div>
    </div>
  );
}
