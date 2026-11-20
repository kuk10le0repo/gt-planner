(() => {
"use strict";
const TIERS = ["ULV","LV","MV","HV","EV","IV","LuV","ZPM","UV","UHV","UEV","UIV","UXV","OpV","MAX"];
const VOLT = TIERS.map((_, i) => Math.min(8 * Math.pow(4, i), 2147483647));
const tierOfEut = e => { for (let i = 0; i < VOLT.length; i++) if (VOLT[i] >= e) return i; return VOLT.length - 1; };
const TIERS_LC = TIERS.map(t => t.toLowerCase());
const pathOf = id => String(id).split(":").pop();
const idName = id => pathOf(id).replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const isCoil = id => /coil_block$/.test(id);
const isHatch = id => /(hatch|_bus$|_bus_|muffler|maintenance)/.test(pathOf(id));
const NW = 260, ROWS_TOP = 104, ROW_H = 24;
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let DATA, REC = {};
let S = { nodes: [], wires: [], view: { x: 60, y: 60, z: 1 }, unit: 60, nextId: 1 };
let sel = null;          // {type:'node'|'wire', id}
let pend = null;         // {node, idx, side:'out'|'in'}
let CALC = null;

// ---------- pages + undo/redo ----------
// S.nodes / S.wires / S.view always point at the CURRENT page; S.pages holds every page.
S.pages = []; S.cur = 0; S.notes = []; S.frames = [];
function syncPage() { const p = S.pages[S.cur]; if (p) { p.nodes = S.nodes; p.wires = S.wires; p.notes = S.notes; p.frames = S.frames; p.view = S.view; } }
function loadPage(i) {
  S.cur = i; const p = S.pages[i];
  p.notes = p.notes || []; p.frames = p.frames || [];
  S.nodes = p.nodes; S.wires = p.wires; S.notes = p.notes; S.frames = p.frames; S.view = p.view || { x: 60, y: 60, z: 1 }; p.view = S.view;
}
function ensurePages() {
  if (!Array.isArray(S.pages) || !S.pages.length) {
    S.pages = [{ id: S.nextId++, name: "Page 1", nodes: S.nodes || [], wires: S.wires || [], notes: S.notes || [], frames: S.frames || [], view: S.view || { x: 60, y: 60, z: 1 } }];
    S.cur = 0;
  }
  loadPage(Math.min(Math.max(S.cur || 0, 0), S.pages.length - 1));
}
function boardState() { syncPage(); return { pages: S.pages, cur: S.cur, unit: S.unit, nextId: S.nextId }; }

const H = { stack: [], idx: -1, busy: false };
function snap() {
  syncPage();
  return JSON.stringify({
    nextId: S.nextId,
    pages: S.pages.map(p => ({ id: p.id, name: p.name, nodes: p.nodes, notes: p.notes || [], frames: p.frames || [], wires: p.wires.map(w => ({ id: w.id, from: w.from, fromIdx: w.fromIdx, to: w.to, toIdx: w.toIdx })) }))
  }, (k, v) => (k === "flow" || k === "cycle") ? undefined : v);   // solver scratch fields inside modules are not state
}
function record() {
  if (H.busy) return;
  const s = snap(); if (H.stack[H.idx] === s) return;
  H.stack.length = H.idx + 1; H.stack.push(s);
  if (H.stack.length > 100) H.stack.shift();
  H.idx = H.stack.length - 1; histButtons();
}
function restore(s) {
  const o = JSON.parse(s), curId = S.pages[S.cur] && S.pages[S.cur].id;
  syncPage(); const views = {}; S.pages.forEach(p => views[p.id] = p.view);
  S.pages = o.pages.map(p => ({ id: p.id, name: p.name, nodes: p.nodes, wires: p.wires, notes: p.notes || [], frames: p.frames || [], view: views[p.id] || { x: 60, y: 60, z: 1 } }));
  S.nextId = Math.max(S.nextId, o.nextId);
  const k = S.pages.findIndex(p => p.id === curId);
  loadPage(k >= 0 ? k : 0); sel = null; pend = null;
  H.busy = true; try { update(); } finally { H.busy = false; }
  histButtons();
}
function undo() { if (H.idx > 0) { H.idx--; restore(H.stack[H.idx]); } else toast("Nothing to undo"); }
function redo() { if (H.idx < H.stack.length - 1) { H.idx++; restore(H.stack[H.idx]); } else toast("Nothing to redo"); }
function histButtons() { $("#btnUndo").disabled = H.idx <= 0; $("#btnRedo").disabled = H.idx >= H.stack.length - 1; }

function switchPage(i) {
  if (i === S.cur || !S.pages[i]) return;
  syncPage(); loadPage(i); sel = null; pend = null;
  H.busy = true; try { update(); } finally { H.busy = false; }
}
function addPage() {
  syncPage();
  let k = S.pages.length + 1; while (S.pages.some(p => p.name === "Page " + k)) k++;       // first unused "Page N"
  S.pages.push({ id: S.nextId++, name: "Page " + k, nodes: [], wires: [], notes: [], frames: [], view: { x: 60, y: 60, z: 1 } });
  loadPage(S.pages.length - 1); sel = null; pend = null; update();
}
function deletePage(i) {
  if (S.pages.length < 2) return toast("Can't delete the only page");
  const p = S.pages[i];
  if ((p.nodes.length || (p.notes || []).length || (p.frames || []).length) && !confirm('Delete page "' + p.name + '" and everything on it? (Undo can bring it back)')) return;
  syncPage(); S.pages.splice(i, 1);
  loadPage(Math.min(S.cur > i ? S.cur - 1 : S.cur, S.pages.length - 1)); sel = null; pend = null; update();
}
function renamePage(i) {
  const n = prompt("Page name", S.pages[i].name);
  if (n && n.trim()) { S.pages[i].name = n.trim().slice(0, 40); update(); }
}
function renderTabs() {
  $("#tabs").innerHTML = S.pages.map((p, i) =>
    `<div class="tab${i === S.cur ? " on" : ""}" data-i="${i}" title="Double-click to rename"><span>${esc(p.name)}</span>${S.pages.length > 1 ? `<b data-act="closepage" title="Delete page">×</b>` : ""}</div>`).join("") +
    `<button id="btnAddPage" title="New page">+</button>`;
}
$("#tabs").addEventListener("mousedown", e => e.stopPropagation());
$("#tabs").addEventListener("click", e => {
  if (e.target.id === "btnAddPage") return addPage();
  const t = e.target.closest(".tab"); if (!t) return;
  const i = +t.dataset.i;
  if (e.target.dataset.act === "closepage") deletePage(i); else switchPage(i);
});
$("#tabs").addEventListener("dblclick", e => { const t = e.target.closest(".tab"); if (t && !e.target.dataset.act) renamePage(+t.dataset.i); });

// ---------- data ----------
function setData(d) {
  DATA = d; REC = {};
  (d.recipes || []).forEach(r => REC[r.id] = r);
  refreshCoils();
  $("#dataName").textContent = d.name || "Custom data";
  renderList();
}
const itemName = id => (DATA.items && DATA.items[id] && DATA.items[id].name) || id;
const isFluid = id => !!(DATA.items && DATA.items[id] && DATA.items[id].fluid);
const machineName = id => (DATA.machines && DATA.machines[id] && DATA.machines[id].name) || id;
const recipeName = r => r.outputs.map(o => itemName(o.item)).join(" + ");

// ---------- icons ----------
// Fallback: letter tile. Upgraded to a real icon by hydrateIcons() when icons/index.js knows the item.
const TIER_COLORS = ["#4a4a4a", "#8a8f99", "#e0762a", "#d8c32a", "#8a5cc2", "#3a6fd8", "#c24a8a", "#2fa89a", "#c23a3a", "#e05a5a", "#5acd7a", "#7a5ae0", "#e0c05a", "#5ac0e0", "#f0f0f0"];
function matchMaterial(path) {                         // longest run of "_"-separated words that is a material name
  const mats = window.ICON_INDEX && window.ICON_INDEX.materials; if (!mats) return null;
  const w = path.split("_"); let best = null;
  for (let i = 0; i < w.length; i++) for (let j = w.length; j > i; j--) {
    const n = w.slice(i, j).join("_");
    if (mats[n] && (!best || n.length > best.length)) best = n;
  }
  return best ? mats[best] : null;
}
function tileColor(id) {
  const p = pathOf(id), mat = matchMaterial(p);
  if (mat && mat[0] !== 0xFFFFFF) return hex(mat[0]);
  const t = TIERS_LC.indexOf(p.split("_")[0]);
  if (t >= 0) return TIER_COLORS[t];
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h},45%,38%)`;
}
function iconHtml(id) {
  const nm = itemName(id).split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const bg = tileColor(id), m = /^#([0-9a-f]{6})$/i.exec(bg);
  const lum = m ? (0.299 * parseInt(m[1].slice(0, 2), 16) + 0.587 * parseInt(m[1].slice(2, 4), 16) + 0.114 * parseInt(m[1].slice(4), 16)) : 90;
  return `<span class="ico" data-icon="${esc(id)}" style="background:${bg};color:${lum > 150 ? "#111" : "#fff"}">${esc(nm)}</span>`;
}
const MAT_PATTERNS = [
  [/^hot_(.+)_ingot$/, "ingot_hot"], [/^double_(.+)_ingot$/, "ingot_double"], [/^(.+)_ingot$/, "ingot"],
  [/^small_(.+)_dust$/, "dust_small"], [/^tiny_(.+)_dust$/, "dust_tiny"], [/^impure_(.+)_dust$/, "dust_impure"], [/^pure_(.+)_dust$/, "dust_pure"], [/^(.+)_dust$/, "dust"],
  [/^dense_(.+)_plate$/, "plate_dense"], [/^double_(.+)_plate$/, "plate_double"], [/^(.+)_plate$/, "plate"],
  [/^long_(.+)_rod$/, "rod_long"], [/^(.+)_rod$/, "rod"],
  [/^small_(.+)_gear$/, "gear_small"], [/^(.+)_gear$/, "gear"],
  [/^small_(.+)_spring$/, "spring_small"], [/^(.+)_spring$/, "spring"],
  [/^fine_(.+)_wire$/, "wire_fine"],
  [/^(.+)_(bolt|screw|foil|nugget|ring|rotor|round|lens)$/, null],
  [/^flawed_(.+)_gem$/, "gem_flawed"], [/^chipped_(.+)_gem$/, "gem_chipped"], [/^flawless_(.+)_gem$/, "gem_flawless"], [/^exquisite_(.+)_gem$/, "gem_exquisite"], [/^(.+)_gem$/, "gem"],
  [/^crushed_(.+)_ore$/, "crushed"], [/^purified_(.+)_ore$/, "crushed_purified"], [/^refined_(.+)_ore$/, "crushed_refined"], [/^raw_(.+)$/, "raw_ore"],
  [/^(.+)_turbine_blade$/, "turbine_blade"],
  [/^(.+)_wrench_tip$/, "tool_head_wrench"], [/^(.+)_screwdriver_tip$/, "tool_head_screwdriver"], [/^(.+)_drill_head$/, "tool_head_drill"],
  [/^(.+)_buzz_saw_blade$/, "tool_head_buzz_saw"], [/^(.+)_chainsaw_head$/, "tool_head_chainsaw"], [/^(.+)_wirecutter_head$/, "tool_head_wirecutter"],
  [/^(.+)_foil_ream$/, "foil"], [/^(.+)_ultradense_plate$/, "plate_dense"],
  [/^(.+)_block$/, "block"], [/^(.+)_frame$/, "frame"]
];
const hex = n => "#" + (n & 0xFFFFFF).toString(16).padStart(6, "0");
function iconSpec(id) {
  const IX = window.ICON_INDEX; if (!IX) return null;
  if (IX.direct && IX.direct[id]) return { kind: "layers", layers: [].concat(IX.direct[id]).map(url => ({ url })) };
  const name = pathOf(id), mats = IX.materials || {};
  if (isFluid(id)) {
    const fm = mats[name] || mats[name.replace(/^(molten|liquid|plasma|gas)_/, "").replace(/_(molten|liquid|plasma|gas)$/, "")];
    if (fm) return { kind: "swatch", color: hex(fm[0]) };
  }
  for (const [re, tex] of MAT_PATTERNS) {
    const m = re.exec(name); if (!m || !mats[m[1]]) continue;
    const mat = mats[m[1]], t = tex || m[2];
    for (const set of [mat[2], "dull", "shiny", "metallic"]) {
      const l = IX.ms && IX.ms[set] && IX.ms[set][t];
      if (l) return { kind: "layers", layers: [{ url: l[0], tint: hex(mat[0]) }, { url: l[1], tint: hex(mat[1]) }, { url: l[2] }] };
    }
  }
  if (mats[name]) return { kind: "swatch", color: hex(mats[name][0]) };
  return null;
}
const imgCache = {}, iconCache = {};
function loadImg(rel) {
  if (!rel) return Promise.resolve(null);
  // icons/textures.js (one file, data URIs) is preferred: one request, works from anywhere, never taints the canvas.
  return imgCache[rel] || (imgCache[rel] = new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = (window.ICON_TEX && window.ICON_TEX[rel]) || ("icons/" + rel); }));
}
function drawLayer(ctx, im, tint) {
  const s = im.width;                                   // animated strips: use the first square frame
  if (!tint) { ctx.drawImage(im, 0, 0, s, s, 0, 0, 16, 16); return; }
  const t = document.createElement("canvas"); t.width = t.height = 16;
  const c = t.getContext("2d"); c.imageSmoothingEnabled = false;
  c.drawImage(im, 0, 0, s, s, 0, 0, 16, 16);
  c.globalCompositeOperation = "multiply"; c.fillStyle = tint; c.fillRect(0, 0, 16, 16);
  c.globalCompositeOperation = "destination-in"; c.drawImage(im, 0, 0, s, s, 0, 0, 16, 16);
  ctx.drawImage(t, 0, 0);
}
function buildIcon(id) {
  if (iconCache[id]) return iconCache[id];
  const spec = iconSpec(id); if (!spec) return (iconCache[id] = Promise.resolve(null));
  return iconCache[id] = (async () => {
    const cv = document.createElement("canvas"); cv.width = cv.height = 16;
    const ctx = cv.getContext("2d"); ctx.imageSmoothingEnabled = false;
    if (spec.kind === "swatch") {
      ctx.fillStyle = spec.color; ctx.beginPath(); ctx.arc(8, 9, 6, 0, 7); ctx.fill();
      ctx.fillStyle = "#ffffff55"; ctx.beginPath(); ctx.arc(6, 7, 2, 0, 7); ctx.fill();
      return cv;
    }
    let drew = false;
    for (const l of spec.layers) { const im = await loadImg(l.url); if (im) { drawLayer(ctx, im, l.tint); drew = true; } }
    return drew ? cv : null;
  })();
}
function hydrateIcons(root) {
  if (!window.ICON_INDEX) return;
  (root || document).querySelectorAll(".ico[data-icon]:not([data-h])").forEach(el => {
    el.dataset.h = "1";
    buildIcon(el.dataset.icon).then(src => {
      if (!src || !el.isConnected) return;
      const c = document.createElement("canvas"); c.width = c.height = 16; c.getContext("2d").drawImage(src, 0, 0);
      el.textContent = ""; el.style.background = "transparent"; el.appendChild(c);
    });
  });
}

// ---------- formatting ----------
function fmt(n) {
  if (!isFinite(n)) return "∞";
  if (n === 0) return "0";
  const a = Math.abs(n);
  if (a < 0.01) return n.toExponential(1);
  if (a >= 1000) return Math.round(n).toLocaleString();
  return String(Number(n.toPrecision(3)));
}
const unitLbl = () => S.unit === 1 ? "/s" : "/min";
const rate = (n, id) => fmt(n * S.unit) + (id && isFluid(id) ? " mB" : "") + unitLbl();

// ---------- node info ----------
function baseTier(r) { return Math.max(tierOfEut(r.eut), r.minTier != null ? r.minTier : 0); }
// A compound module behaves like a recipe node: one "run" per second = one copy of its inner flowsheet.
function moduleInfo(n) {
  const c = compute(n.inner.nodes, n.inner.wires);       // solve ONE copy of the inner flowsheet
  const mk = (items, src) => items.map(it => ({ item: it, amount: src[it] || 0 }));
  const r = { id: "module:" + n.id, machine: "module", inputs: mk(n.pinsIn, c.raw), outputs: mk(n.pinsOut, c.net), duration: 20, eut: c.avg };
  return { r, rt: 0, tier: 0, dur: 20, eut: c.avg, rps: 1, mod: c };
}
const recOf = n => n.type === "module" ? (CALC && CALC.N[n.id] && CALC.N[n.id].r) : REC[n.recipeId];
function nodeInfo(n) {
  if (n.type === "module") return moduleInfo(n);
  const r = REC[n.recipeId]; if (!r) return null;
  const rt = baseTier(r);
  const tier = Math.max(n.tier, rt);
  const oc = tier - rt;
  const dur = Math.max(1, Math.floor(r.duration / Math.pow(n.perfect ? 4 : 2, oc)));
  return { r, rt, tier, dur, eut: r.eut * Math.pow(4, oc), rps: 20 / dur };
}

// ---------- solver ----------
function compute(nodes = S.nodes, allWires = S.wires) {
  const N = {};
  nodes.forEach(n => {
    const info = nodeInfo(n);
    if (info) N[n.id] = { n, ...info, demand: info.r.outputs.map(() => 0), need: [], prod: [], runs: 0, m: 0, mc: 0, supplied: [], consumed: [], net: [] };
  });
  const wires = allWires.filter(w => N[w.from] && N[w.to]);
  const outW = {}, inCount = {};
  wires.forEach(w => { (outW[w.from] = outW[w.from] || []).push(w); const k = w.to + ":" + w.toIdx; inCount[k] = (inCount[k] || 0) + 1; w.cycle = false; w.flow = 0; });

  // order: consumers first
  const visited = {}, stack = {}, order = [];
  const dfs = id => {
    visited[id] = 1; stack[id] = 1;
    (outW[id] || []).forEach(w => { if (stack[w.to]) w.cycle = true; else if (!visited[w.to]) dfs(w.to); });
    stack[id] = 0; order.push(id);
  };
  Object.keys(N).forEach(id => { if (!visited[id]) dfs(+id); });
  const live = wires.filter(w => !w.cycle);

  order.forEach(id => {
    const x = N[id], n = x.n, r = x.r;
    let runs = 0;
    if (n.mode === "auto") {
      r.outputs.forEach((o, i) => {
        if (!(o.amount > 0)) return;
        const d = x.demand[i] + (n.targetIdx === i ? (n.targetRate || 0) : 0);
        runs = Math.max(runs, d / (o.amount * (o.chance != null ? o.chance : 1)));
      });
      if (runs <= 0) runs = (n.machines || 0) * x.rps;
    } else runs = (n.machines || 0) * x.rps;
    x.runs = runs; x.m = runs / x.rps; x.mc = Math.ceil(x.m - 1e-9);
    r.inputs.forEach((inp, k) => {
      x.need[k] = inp.amount * runs;
      const c = inCount[id + ":" + k] || 0;
      live.filter(w => w.to === +id && w.toIdx === k).forEach(w => { N[w.from].demand[w.fromIdx] += x.need[k] / c; });
    });
  });
  Object.values(N).forEach(x => {
    x.prod = x.r.outputs.map(o => o.amount * (o.chance != null ? o.chance : 1) * x.runs);
    x.supplied = x.r.inputs.map(() => 0); x.consumed = x.r.outputs.map(() => 0);
  });
  // distribute supply
  const groups = {};
  live.forEach(w => { const k = w.from + ":" + w.fromIdx; (groups[k] = groups[k] || []).push(w); });
  Object.values(groups).forEach(ws => {
    const share = w => N[w.to].need[w.toIdx] / (inCount[w.to + ":" + w.toIdx] || 1);
    const tot = ws.reduce((a, w) => a + share(w), 0);
    const P = N[ws[0].from].prod[ws[0].fromIdx];
    const f = tot > 0 ? Math.min(1, P / tot) : 0;
    ws.forEach(w => { w.flow = share(w) * f; N[w.to].supplied[w.toIdx] += w.flow; N[w.from].consumed[w.fromIdx] += w.flow; });
  });
  Object.values(N).forEach(x => { x.net = x.prod.map((p, j) => Math.max(0, p - x.consumed[j])); });

  // summary
  // mlist keeps one fractional machine count PER NODE (flattened through modules, scaled by their copies);
  // whole machines are then rounded up per node, because two nodes can't share a machine.
  const mlist = [], raw = {}, net = {}, blocks = {}, hatches = {};
  let avg = 0, peak = 0, warn = 0;
  Object.values(N).forEach(x => {
    x.r.inputs.forEach((inp, k) => { const d = x.need[k] - x.supplied[k]; if (d > 1e-9) raw[inp.item] = (raw[inp.item] || 0) + d; });
    x.r.outputs.forEach((o, j) => { if (x.net[j] > 1e-9) net[o.item] = (net[o.item] || 0) + x.net[j]; });
    if (x.mod) {                                    // compound module: scale its inner totals by the copy count
      const c = x.mod, k = x.m;
      c.mlist.forEach(e => mlist.push({ key: e.key, m: e.m * k }));
      Object.entries(c.blocks).forEach(([nm, v]) => { blocks[nm] = (blocks[nm] || 0) + Math.ceil(v * k - 1e-9); });
      Object.entries(c.hatches).forEach(([nm, v]) => { hatches[nm] = (hatches[nm] || 0) + Math.ceil(v * k - 1e-9); });
      avg += k * c.avg; peak += x.mc * c.peak;
      return;
    }
    const key = x.r.machine + "|" + x.tier;
    mlist.push({ key, m: x.m });
    avg += x.m * x.eut; peak += x.mc * x.eut;
    const mb = mbFor(x.n);
    if (mb && x.mc > 0) {
      Object.entries(mb.blocks || {}).forEach(([bid, cnt]) => {
        if (!(cnt > 0)) return;
        let id = bid;
        if (isCoil(id) && x.n.coil) id = x.n.coil;
        else if (/energy/.test(pathOf(id))) {
          const t = TIERS_LC.find(tl => pathOf(id).startsWith(tl + "_"));
          if (t) id = id.slice(0, id.indexOf(":") + 1) + TIERS[x.tier].toLowerCase() + pathOf(id).slice(t.length);
        }
        const nm = idName(id), total = cnt * x.mc;
        if (pathOf(id) === pathOf(mb.id)) blocks[nm + " (Controller)"] = (blocks[nm + " (Controller)"] || 0) + total;
        else if (isHatch(id)) hatches[nm] = (hatches[nm] || 0) + total;
        else blocks[nm] = (blocks[nm] || 0) + total;
      });
    }
  });
  wires.forEach(w => { if (w.cycle) warn++; });
  const machines = {};
  mlist.forEach(e => { machines[e.key] = (machines[e.key] || 0) + Math.ceil(e.m - 1e-9); });
  return { N, wires, machines, mlist, raw, net, blocks, hatches, avg, peak, warn };
}

// ---------- node ops ----------
function addNode(recipeId, x, y) {
  const r = REC[recipeId]; if (!r) return;
  if (x == null) {
    const c = $("#canvas").getBoundingClientRect(), v = S.view;
    x = (c.width / 2 - v.x) / v.z - NW / 2 + (S.nodes.length % 5) * 24;
    y = (c.height / 2 - v.y) / v.z - 80 + (S.nodes.length % 5) * 24;
  }
  const n = { id: S.nextId++, recipeId, x: Math.round(x), y: Math.round(y), tier: baseTier(r), perfect: false, mode: "manual", machines: 1, targetIdx: 0, targetRate: 0 };
  S.nodes.push(n); sel = { type: "node", id: n.id };
  update(); return n;
}
// ---------- compound modules ----------
// Collapse the nodes inside a frame into one module. Inputs the group still needs and surplus it produces become pins;
// wires that crossed the frame edge are re-attached to those pins (same wire ids, so Expand can restore them).
function groupFrame(fid) {
  const f = S.frames.find(q => q.id === fid); if (!f) return;
  const members = frameContents(f);
  if (!members.length) return toast("This frame has no nodes inside");
  const ids = new Set(members.map(n => n.id));
  // Freeze today's solved rates (full precision, so internal flows balance exactly and no phantom pins appear).
  // The original settings are remembered so Expand can put them back.
  const orig = {};
  members.forEach(n => {
    const x = CALC.N[n.id]; if (!x || n.type === "module") return;
    orig[n.id] = { mode: n.mode, machines: n.machines, targetIdx: n.targetIdx, targetRate: n.targetRate };
    n.mode = "manual"; n.machines = x.m;
  });
  const inner = S.wires.filter(w => ids.has(w.from) && ids.has(w.to));
  const boundary = S.wires.filter(w => ids.has(w.from) !== ids.has(w.to));
  const c = compute(members, inner);
  const mod = { id: S.nextId++, type: "module", name: (f.title || "Module").slice(0, 30), x: f.x + 20, y: f.y + 44, tier: 0, mode: "manual", machines: 1, targetIdx: 0, targetRate: 0,
    inner: { nodes: members, wires: inner }, pinsIn: Object.keys(c.raw), pinsOut: Object.keys(c.net), ports: { in: [], out: [] }, orig };
  const moved = [];
  boundary.forEach(w => {
    if (ids.has(w.to)) {
      const item = c.N[w.to] && c.N[w.to].r.inputs[w.toIdx] && c.N[w.to].r.inputs[w.toIdx].item, p = mod.pinsIn.indexOf(item);
      if (p < 0) return;
      mod.ports.in.push({ wire: w.id, node: w.to, idx: w.toIdx });
      moved.push({ id: w.id, from: w.from, fromIdx: w.fromIdx, to: mod.id, toIdx: p });
    } else {
      const item = c.N[w.from] && c.N[w.from].r.outputs[w.fromIdx] && c.N[w.from].r.outputs[w.fromIdx].item, p = mod.pinsOut.indexOf(item);
      if (p < 0) return;
      mod.ports.out.push({ wire: w.id, node: w.from, idx: w.fromIdx });
      moved.push({ id: w.id, from: mod.id, fromIdx: p, to: w.to, toIdx: w.toIdx });
    }
  });
  const dropped = boundary.length - moved.length;
  S.nodes = S.nodes.filter(n => !ids.has(n.id)).concat(mod);
  S.wires = S.wires.filter(w => !ids.has(w.from) && !ids.has(w.to)).concat(moved);
  sel = { type: "node", id: mod.id }; update();
  toast("Grouped " + members.length + " nodes into a module" + (dropped ? " (" + dropped + " idle wire(s) dropped)" : ""));
}
function findInnerPort(m, side, item) {          // an unwired inner port for this item (for wires added after grouping)
  const ic = CALC.N[m.id] && CALC.N[m.id].mod && CALC.N[m.id].mod.N; if (!ic) return null;
  for (const n of m.inner.nodes) {
    const r = ic[n.id] && ic[n.id].r; if (!r) continue;
    const list = side === "in" ? r.inputs : r.outputs;
    for (let i = 0; i < list.length; i++) {
      if (list[i].item !== item) continue;
      const used = m.inner.wires.some(w => side === "in" ? (w.to === n.id && w.toIdx === i) : (w.from === n.id && w.fromIdx === i));
      if (!used) return { node: n.id, idx: i };
    }
  }
  return null;
}
function expandModule(id) {
  const m = S.nodes.find(n => n.id === id && n.type === "module"); if (!m) return;
  const rest = S.wires.filter(w => w.from !== id && w.to !== id);
  let lost = 0;
  S.wires.filter(w => w.from === id || w.to === id).forEach(w => {
    const incoming = w.to === id, list = incoming ? m.ports.in : m.ports.out, pin = incoming ? m.pinsIn[w.toIdx] : m.pinsOut[w.fromIdx];
    const rec = list.find(p => p.wire === w.id), tgt = rec ? { node: rec.node, idx: rec.idx } : findInnerPort(m, incoming ? "in" : "out", pin);
    if (!tgt) { lost++; return; }
    rest.push(incoming ? { id: w.id, from: w.from, fromIdx: w.fromIdx, to: tgt.node, toIdx: tgt.idx } : { id: w.id, from: tgt.node, fromIdx: tgt.idx, to: w.to, toIdx: w.toIdx });
  });
  // At one copy the nodes go back exactly as they were (including Auto targets); at another scale they keep the scaled counts.
  const k = CALC.N[id] ? CALC.N[id].m : 1;
  m.inner.nodes.forEach(n => {
    const o = m.orig && m.orig[n.id]; if (!o || n.type === "module") return;
    if (Math.abs(k - 1) < 1e-9) Object.assign(n, o); else n.machines = n.machines * k;
  });
  S.nodes = S.nodes.filter(n => n.id !== id).concat(m.inner.nodes);
  S.wires = rest.concat(m.inner.wires);
  sel = null; update();
  toast("Expanded into " + m.inner.nodes.length + " nodes" + (lost ? " (" + lost + " wire(s) had no matching port)" : ""));
}

function removeNode(id) {
  S.nodes = S.nodes.filter(n => n.id !== id);
  S.wires = S.wires.filter(w => w.from !== id && w.to !== id);
  sel = null; update();
}
function connect(a, ai, b, bi) {
  const na = S.nodes.find(n => n.id === a), nb = S.nodes.find(n => n.id === b);
  if (!na || !nb || a === b) return toast("Can't connect a node to itself");
  const ra = recOf(na), rb = recOf(nb);
  if (!ra || !rb) return;
  if (ra.outputs[ai].item !== rb.inputs[bi].item) return toast("Items don't match");
  if (S.wires.some(w => w.from === a && w.fromIdx === ai && w.to === b && w.toIdx === bi)) return;
  S.wires.push({ id: S.nextId++, from: a, fromIdx: ai, to: b, toIdx: bi });
  update();
}

// ---------- rendering ----------
function renderList() {
  const q = $("#search").value.trim().toLowerCase();
  const score = r => {
    const o = r.outputs.map(x => itemName(x.item).toLowerCase());
    if (o.some(n => n === q)) return 0;
    if (o.some(n => n.startsWith(q))) return 1;
    if (o.some(n => n.includes(q))) return 2;
    return 3;
  };
  let rs = (DATA.recipes || []).filter(r => {
    if (!q) return true;
    const hay = [machineName(r.machine), ...r.inputs.map(i => itemName(i.item)), ...r.outputs.map(o => itemName(o.item))].join(" ").toLowerCase();
    return q.split(/\s+/).every(t => hay.includes(t));
  });
  if (q) rs = rs.map(r => [score(r), r]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  rs = rs.slice(0, 200);
  $("#recipeList").innerHTML = rs.map(r =>
    `<div class="rec" data-rid="${esc(r.id)}">${iconHtml(r.outputs[0].item)}<div class="t"><div>${esc(recipeName(r))}</div><div class="m">${esc(machineName(r.machine))} · ${TIERS[baseTier(r)]} · ${r.inputs.map(i => esc(itemName(i.item))).join(", ")}</div></div><button>+</button></div>`).join("")
    || `<div class="muted" style="padding:10px">No matches.</div>`;
  hydrateIcons($("#recipeList"));
}

// ---------- auto-fit node width ----------
// Every card is as wide as its content needs: header title, item names + rates (left and right columns),
// the target / coil selects and the stats line. Text is measured with the same fonts the page uses.
const _mctx = document.createElement("canvas").getContext("2d");
const tw = (t, font) => { _mctx.font = font + ' system-ui, "Segoe UI", sans-serif'; return _mctx.measureText(String(t)).width; };
function statsText(n, x) {
  return n.type === "module"
    ? `×${fmt(x.m)} copies · ${n.inner.nodes.length} nodes · ${fmt(x.m * x.eut)} EU/t`
    : `${fmt(x.m)} machines → ${x.mc} (${x.mc > 0 ? Math.round(100 * x.m / x.mc) : 0}%) · ${fmt(x.eut)} EU/t each · ${fmt(x.dur / 20)}s`;
}
function nodeLay(n) {                              // {w, lw, rw}: card width and the widths of its input / output columns
  const x = CALC && CALC.N[n.id];
  if (!x) return { w: NW, lw: NW / 2, rw: NW / 2 };
  if (x.lay) return x.lay;
  const r = x.r, mod = n.type === "module";
  const bw = tw(mod ? "MODULE" : TIERS[x.tier], "700 10px") + 12;
  const head = 6 + bw + 6 + tw(mod ? n.name : machineName(r.machine) + ": " + recipeName(r), "600 13px") + 10 + (mod ? 46 : 22);
  let lw = 128, rw = 128;
  r.inputs.forEach((i, k) => { lw = Math.max(lw, 10 + 18 + 5 + tw(itemName(i.item), "12px") + 8 + tw(rate(x.need[k], i.item), "11px") + 10); });
  r.outputs.forEach((o, j) => {
    const rt = rate(x.prod[j], o.item) + (o.chance != null && o.chance < 1 ? " (" + Math.round(o.chance * 100) + "%)" : "");
    rw = Math.max(rw, 10 + tw(rt, "11px") + 8 + tw(itemName(o.item), "12px") + 5 + 18 + 10);
  });
  let row2;
  if (n.mode === "auto") {
    const t = r.outputs[n.targetIdx || 0];
    row2 = 8 + tw("Target", "11px") + 4 + (t ? tw(itemName(t.item), "12px") : 40) + 34 + 4 + 76 + 4 + tw(unitLbl(), "11px") + 14;
  } else {
    const mb = mod ? null : mbFor(n), pc = mb && Object.keys(mb.blocks || {}).find(isCoil);
    row2 = 8 + tw(mod ? "Copies" : "Machines", "11px") + 4 + 76 + (pc ? 4 + tw(idName(n.coil || pc), "12px") + 34 : 0) + 14;
  }
  const row1 = mod ? 8 + 140 + 4 + 84 + 10 : 262;
  const stats = 18 + tw(statsText(n, x), "11px");
  const w = Math.ceil(Math.min(640, Math.max(NW, head, lw + rw, row2, row1, stats)));
  let L = lw + rw;
  if (w >= L) { const extra = w - L; lw += extra / 2; } else { lw = lw * w / L; }          // spread spare width / squeeze when capped
  lw = Math.floor(lw);
  return (x.lay = { w, lw, rw: w - lw });
}

function nodeHtml(n) {
  const x = CALC.N[n.id];
  if (!x) return `<div class="node broken" data-id="${n.id}" style="left:${n.x}px;top:${n.y}px"><div class="nh" data-drag><span class="nm">Missing recipe: ${esc(n.recipeId)}</span><span class="x" data-act="del">✕</span></div><div class="ns">Not in the loaded dataset.</div></div>`;
  const r = x.r, rows = Math.max(r.inputs.length, r.outputs.length), L = nodeLay(n);
  const h = ROWS_TOP + rows * ROW_H + 6;
  const tierOpts = TIERS.map((t, i) => i >= x.rt ? `<option value="${i}"${i === x.tier ? " selected" : ""}>${t}</option>` : "").join("");
  const mbSel = mbFor(n);
  const previewCoil = mbSel && Object.keys(mbSel.blocks || {}).find(isCoil);
  const coilSel = previewCoil
    ? `<select class="grow" data-f="coil" title="Heating coil (changes the BOM)">${(DATA._coils || [previewCoil]).map(o => `<option value="${esc(o)}"${o === (n.coil || previewCoil) ? " selected" : ""}>${esc(idName(o))}</option>`).join("")}</select>` : "";
  const row2 = n.mode === "auto"
    ? `<label>Target</label><select class="grow" data-f="targetIdx">${r.outputs.map((o, i) => `<option value="${i}"${i === n.targetIdx ? " selected" : ""}>${esc(itemName(o.item))}</option>`).join("")}</select><input type="number" min="0" step="any" data-f="targetRate" value="${+(n.targetRate * S.unit).toFixed(4)}"><label>${unitLbl()}</label>`
    : `<label>Machines</label><input type="number" min="0" step="any" data-f="machines" value="${+Number(n.machines).toFixed(4)}">${coilSel}`;
  let rowsHtml = "", ports = "";
  for (let i = 0; i < rows; i++) {
    const top = ROWS_TOP + i * ROW_H;
    let a = "", b = "";
    if (r.inputs[i]) {
      const inp = r.inputs[i], d = x.need[i] - x.supplied[i], bad = d > 1e-9;
      a = `${iconHtml(inp.item)}<span>${esc(itemName(inp.item))}</span><span class="r ${bad ? "bad" : "ok"}">${rate(x.need[i], inp.item)}</span>`;
      ports += `<div class="port" data-port="in" data-idx="${i}" data-item="${esc(inp.item)}" style="left:-6px;top:${top + 6}px"></div>`;
    }
    if (r.outputs[i]) {
      const o = r.outputs[i];
      b = `<span class="r">${rate(x.prod[i], o.item)}${o.chance != null && o.chance < 1 ? " (" + Math.round(o.chance * 100) + "%)" : ""}</span><span>${esc(itemName(o.item))}</span>${iconHtml(o.item)}`;
      ports += `<div class="port" data-port="out" data-idx="${i}" data-item="${esc(o.item)}" style="left:${L.w - 6}px;top:${top + 6}px"></div>`;
    }
    rowsHtml += `<div class="row" style="top:${top}px"><div class="a" style="width:${L.lw}px">${a}</div><div class="b" style="width:${L.rw}px">${b}</div></div>`;
  }
  if (n.type === "module") {
    const mrow2 = n.mode === "auto" ? row2 : `<label>Copies</label><input type="number" min="0" step="any" data-f="machines" value="${+Number(n.machines).toFixed(4)}">`;
    return `<div class="node module${sel && sel.type === "node" && sel.id === n.id ? " sel" : ""}" data-id="${n.id}" style="left:${n.x}px;top:${n.y}px;height:${h}px;width:${L.w}px">
    <div class="nh" data-drag><span class="badge mod">MODULE</span><span class="nm" title="${esc(n.name)}">${esc(n.name)}</span><span class="x" data-act="expand" title="Expand back into its ${n.inner.nodes.length} nodes">⤢</span><span class="x" data-act="del">✕</span></div>
    <div class="nc"><input type="text" class="grow" data-f="mname" value="${esc(n.name)}" title="Module name"><select data-f="mode"><option value="manual"${n.mode === "manual" ? " selected" : ""}>Manual</option><option value="auto"${n.mode === "auto" ? " selected" : ""}>Auto</option></select></div>
    <div class="nc">${mrow2}</div>
    <div class="ns"><b>×${fmt(x.m)}</b> copies · ${n.inner.nodes.length} nodes · ${fmt(x.m * x.eut)} EU/t</div>
    ${rowsHtml}${ports}</div>`;
  }
  const util = x.mc > 0 ? Math.round(100 * x.m / x.mc) : 0;
  return `<div class="node${sel && sel.type === "node" && sel.id === n.id ? " sel" : ""}" data-id="${n.id}" style="left:${n.x}px;top:${n.y}px;height:${h}px;width:${L.w}px">
    <div class="nh" data-drag><span class="badge">${TIERS[x.tier]}</span><span class="nm" title="${esc(recipeName(r))}">${esc(machineName(r.machine))}: ${esc(recipeName(r))}</span><span class="x" data-act="del">✕</span></div>
    <div class="nc"><select data-f="tier" title="Machine tier">${tierOpts}</select><select data-f="mode"><option value="manual"${n.mode === "manual" ? " selected" : ""}>Manual</option><option value="auto"${n.mode === "auto" ? " selected" : ""}>Auto</option></select><label title="Perfect overclock (÷4 time)"><input type="checkbox" data-f="perfect"${n.perfect ? " checked" : ""}> perfect OC</label></div>
    <div class="nc">${row2}</div>
    <div class="ns"><b>${fmt(x.m)}</b> machines → ${x.mc} (${util}%) · ${fmt(x.eut)} EU/t each · ${fmt(x.dur / 20)}s</div>
    ${rowsHtml}${ports}</div>`;
}

function renderNodes() {
  $("#nodes").innerHTML = S.nodes.map(nodeHtml).join("");
  applyPortStates(); hydrateIcons($("#nodes"));
}
function portPos(id, side, idx) {
  const n = S.nodes.find(q => q.id === id);
  return { x: n.x + (side === "out" ? nodeLay(n).w : 0), y: n.y + ROWS_TOP + idx * ROW_H + ROW_H / 2 };
}
function curve(a, b) {
  const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
  return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
}
function drawWires() {
  if (!CALC) return;
  let h = "";
  CALC.wires.forEach(w => {
    const a = portPos(w.from, "out", w.fromIdx), b = portPos(w.to, "in", w.toIdx);
    const x = CALC.N[w.to], need = x ? x.need[w.toIdx] : 0;
    const bad = x && x.need[w.toIdx] - x.supplied[w.toIdx] > 1e-9;
    const cls = "wire" + (w.cycle ? " cyc" : bad ? " bad" : "") + (sel && sel.type === "wire" && sel.id === w.id ? " sel" : "");
    const d = curve(a, b), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const item = CALC.N[w.from].r.outputs[w.fromIdx].item;
    h += `<path class="${cls}" d="${d}"/><path class="wirehit" data-wid="${w.id}" d="${d}"/>`;
    h += `<text class="wirelbl" x="${mx}" y="${my - 4}">${w.cycle ? "cycle (ignored)" : rate(w.flow, item)}</text>`;
  });
  if (pend && pend.mouse) {
    const a = portPos(pend.node, pend.side, pend.idx);
    h += pend.side === "out" ? `<path class="temp" d="${curve(a, pend.mouse)}"/>` : `<path class="temp" d="${curve(pend.mouse, a)}"/>`;
  }
  $("#wires").innerHTML = h;
}
function applyPortStates() {
  document.querySelectorAll(".port").forEach(p => {
    p.classList.remove("valid", "pend", "dim");
    if (!pend) return;
    const nid = +p.closest(".node").dataset.id, idx = +p.dataset.idx, side = p.dataset.port;
    if (nid === pend.node && idx === pend.idx && side === pend.side) p.classList.add("pend");
    else if (side !== pend.side && p.dataset.item === pend.item && nid !== pend.node) p.classList.add("valid");
    else p.classList.add("dim");
  });
}
// ---- whole-project totals: every page added together ----
let totalsMode = "page", netAcross = true;
try { totalsMode = localStorage.getItem("gtp.totals") === "project" ? "project" : "page"; netAcross = localStorage.getItem("gtp.netAcross") !== "0"; } catch (_) {}
const addInto = (dst, src) => { Object.entries(src).forEach(([k, v]) => { dst[k] = (dst[k] || 0) + v; }); };
function projectTotals() {
  syncPage();
  const T = { avg: 0, peak: 0, nodes: 0, wires: 0, warn: 0, machines: {}, raw: {}, net: {}, blocks: {}, hatches: {}, supplied: {}, pages: [] };
  S.pages.forEach((p, i) => {
    const c = i === S.cur ? CALC : compute(p.nodes, p.wires);
    T.avg += c.avg; T.peak += c.peak; T.nodes += p.nodes.length; T.wires += p.wires.length; T.warn += c.warn;
    addInto(T.machines, c.machines); addInto(T.raw, c.raw); addInto(T.net, c.net); addInto(T.blocks, c.blocks); addInto(T.hatches, c.hatches);
    T.pages.push({ name: p.name, nodes: p.nodes.length, machines: Object.values(c.machines).reduce((a, b) => a + b, 0), avg: c.avg });
  });
  if (netAcross) {                                  // surplus made on one page covers a shortfall on another
    Object.keys(T.raw).forEach(item => {
      const m = Math.min(T.raw[item], T.net[item] || 0);
      if (m > 1e-9) { T.raw[item] -= m; T.net[item] -= m; T.supplied[item] = m; }
    });
  }
  [T.raw, T.net].forEach(o => Object.keys(o).forEach(k => { if (o[k] < 1e-9) delete o[k]; }));
  return T;
}
function renderSummary() {
  const proj = totalsMode === "project" && S.pages.length > 1;
  const c = proj ? projectTotals() : CALC, list = (obj, withUnit, build) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
    `<div class="li">${withUnit ? iconHtml(k) : ""}<span class="n">${esc(withUnit ? itemName(k) : k)}</span><span class="v">${withUnit ? rate(v, k) : "×" + fmt(v)}</span>${build && byOutIndex()[k] ? `<button class="mini" data-build="${esc(k)}" title="Build a supply chain for this input and wire it in">⛏</button>` : ""}</div>`).join("") || `<div class="muted">—</div>`;
  const mach = {};
  Object.entries(c.machines).forEach(([k, v]) => { if (v > 0) { const [m, t] = k.split("|"); mach[TIERS[t] + " " + machineName(m)] = v; } });
  const warns = [];
  if (c.warn) warns.push(`${c.warn} wire(s) form a cycle and are ignored.`);
  let selHtml = "";
  if (S.pages.length > 1) {                         // switch between this page and the whole project
    selHtml += `<div class="seg"><button data-tm="page" class="${proj ? "" : "on"}">This page</button><button data-tm="project" class="${proj ? "on" : ""}">Whole project (${S.pages.length})</button></div>`;
    if (proj) selHtml += `<label class="chk" title="A surplus made on one page covers a shortfall for the same item on another page"><input type="checkbox" data-na${netAcross ? " checked" : ""}> Match surplus against shortfalls between pages</label>`;
  }
  if (proj) {
    selHtml += `<h3>Pages</h3><table class="pg">${c.pages.map((p, i) => `<tr data-page="${i}" class="${i === S.cur ? "cur" : ""}" title="Open this page"><td>${esc(p.name)}</td><td>${p.nodes} nodes</td><td>${p.machines} mach.</td><td>${fmt(p.avg)} EU/t</td></tr>`).join("")}</table>`;
  } else if (sel && sel.type === "node") {
    const n = S.nodes.find(q => q.id === sel.id), x = n && c.N[n.id];
    const alts = n ? recipeAlternatives(n) : [];
    if (alts.length > 1) {
      selHtml += `<h3>Selected node: recipe</h3><select data-sf="recipe" data-id="${n.id}" style="width:100%">${alts.map(r =>
        `<option value="${esc(r.id)}"${r.id === x.r.id ? " selected" : ""}>${esc(machineName(r.machine))} ${TIERS[baseTier(r)]}: ${esc(r.inputs.map(i => itemName(i.item)).join(" + ") || "(no input)")}</option>`).join("")}</select>`;
    }
    const l = x && DATA._mbByType && DATA._mbByType[x.r.machine];
    if (l && l.length) {
      const cur = mbFor(n), canSingle = DATA._single && DATA._single[x.r.machine];
      selHtml += `<h3>Selected node: machine type</h3><select data-sf="mb" data-id="${n.id}" style="width:100%">${canSingle ? `<option value="single"${!cur ? " selected" : ""}>Single-block machine (no structure)</option>` : ""}${l.map(m => `<option value="${esc(m.id)}"${cur && m.id === cur.id ? " selected" : ""}>${esc(m.name || m.id)}${m.dims ? " (" + m.dims.join("×") + ")" : ""}</option>`).join("")}</select>`;
    }
  }
  $("#summary").innerHTML = selHtml + `
    <h3>Power</h3>
    <div class="kv"><span>Average</span><b>${fmt(c.avg)} EU/t</b></div>
    <div class="kv"><span>Peak (all machines on)</span><b>${fmt(c.peak)} EU/t</b></div>
    <div class="kv"><span>Nodes / wires</span><span>${proj ? c.nodes + " / " + c.wires : S.nodes.length + " / " + S.wires.length}</span></div>
    ${warns.map(w => `<div class="bad">${w}</div>`).join("")}
    <h3>Machines</h3>${list(mach)}
    <h3>Raw inputs needed</h3>${list(c.raw, true, !proj)}
    <h3>Net products / surplus</h3>${list(c.net, true)}
    ${proj && Object.keys(c.supplied).length ? `<h3>Supplied between pages</h3>${list(c.supplied, true)}` : ""}
    <h3>Blocks (multiblocks)</h3>${list(c.blocks)}
    <h3>Hatches / buses</h3>${list(c.hatches)}
    <div class="muted" style="margin-top:14px">Data is approximate sample data unless you load your own export.</div>`;
  hydrateIcons($("#summary"));
}

// ---------- sticky notes + group frames ----------
const NOTE_COLORS = ["#f4d35e", "#8fd694", "#7cb7ff", "#f29cc1", "#c9c9c9"];
const FRAME_COLORS = ["#4da3ff", "#4cc38a", "#ffb454", "#c586ff", "#ff6b6b"];
function frameContents(f) {                       // nodes whose centre is inside the frame
  return S.nodes.filter(n => { const cx = n.x + nodeLay(n).w / 2, cy = n.y + 60; return cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h; });
}
function renderDecor() {
  $("#notes").innerHTML = S.notes.map(n => `<div class="note${sel && sel.type === "note" && sel.id === n.id ? " sel" : ""}" data-id="${n.id}" style="left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px;background:${NOTE_COLORS[n.color % 5]}">
      <div class="nth" data-drag><span class="dot" data-act="notecolor" title="Change colour"></span><span class="x" data-act="delnote" title="Delete note">✕</span></div>
      <textarea data-nf="text" placeholder="Note...">${esc(n.text || "")}</textarea><div class="resize" data-resize></div></div>`).join("");
  $("#frames").innerHTML = S.frames.map(f => {
    const ns = frameContents(f); let m = 0, e = 0;
    ns.forEach(n => { const x = CALC && CALC.N[n.id]; if (x) { m += x.mc; e += x.m * x.eut; } });
    const c = FRAME_COLORS[f.color % 5];
    return `<div class="frame${sel && sel.type === "frame" && sel.id === f.id ? " sel" : ""}" data-id="${f.id}" style="left:${f.x}px;top:${f.y}px;width:${f.w}px;height:${f.h}px;--fc:${c}">
      <div class="fh" data-drag><input data-ff="title" value="${esc(f.title || "")}" placeholder="Group title"><span class="fs">${ns.length} nodes · ${m} machines · ${fmt(e)} EU/t</span><span class="x" data-act="modulize" title="Collapse the nodes in this frame into a compound module">▣ Module</span><span class="dot" data-act="framecolor" title="Change colour"></span><span class="x" data-act="delframe" title="Delete frame (nodes stay)">✕</span></div>
      <div class="resize" data-resize></div></div>`;
  }).join("");
}
function viewCentre() { const c = $("#canvas").getBoundingClientRect(), v = S.view; return { x: (c.width / 2 - v.x) / v.z, y: (c.height / 2 - v.y) / v.z }; }
function addNote() {
  const c = viewCentre(), n = { id: S.nextId++, x: Math.round(c.x - 100), y: Math.round(c.y - 65), w: 200, h: 130, text: "", color: S.notes.length % 5 };
  S.notes.push(n); sel = { type: "note", id: n.id }; update();
  const t = document.querySelector(`.note[data-id="${n.id}"] textarea`); if (t) t.focus();
}
function addFrame() {
  const c = viewCentre(), f = { id: S.nextId++, x: Math.round(c.x - 210), y: Math.round(c.y - 130), w: 420, h: 260, title: "Group " + (S.frames.length + 1), color: S.frames.length % 5 };
  S.frames.push(f); sel = { type: "frame", id: f.id }; update();
}
function decorDown(e, noteEl, frameEl) {          // returns true when the click was consumed
  const el = noteEl || frameEl, isNote = !!noteEl, id = +el.dataset.id;
  const obj = (isNote ? S.notes : S.frames).find(q => q.id === id); if (!obj) return false;
  const act = e.target.dataset.act;
  if (act === "delnote") { S.notes = S.notes.filter(q => q.id !== id); sel = null; update(); return true; }
  if (act === "delframe") { S.frames = S.frames.filter(q => q.id !== id); sel = null; update(); return true; }
  if (act === "modulize") { groupFrame(id); return true; }
  if (act === "notecolor" || act === "framecolor") { obj.color = (obj.color + 1) % 5; update(); return true; }
  sel = { type: isNote ? "note" : "frame", id };
  document.querySelectorAll(".note,.frame,.node").forEach(q => q.classList.toggle("sel", q === el));
  drawWires();
  if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return true;   // let the user type
  const w = toWorld(e);
  if (e.target.closest("[data-resize]")) { drag = { kind: "resize", obj, el, isNote, sx: w.x, sy: w.y, w0: obj.w, h0: obj.h }; return true; }
  if (e.target.closest("[data-drag]")) {
    drag = { kind: isNote ? "note" : "frame", obj, el, ox: w.x - obj.x, oy: w.y - obj.y,
      carried: isNote ? [] : frameContents(obj).map(n => ({ n, dx: n.x - obj.x, dy: n.y - obj.y })) };
  }
  return true;
}
$("#notes").addEventListener("change", e => {
  const n = S.notes.find(q => q.id === +e.target.closest(".note").dataset.id);
  if (n && e.target.dataset.nf === "text") { n.text = e.target.value; save(); record(); }
});
$("#frames").addEventListener("change", e => {
  const f = S.frames.find(q => q.id === +e.target.closest(".frame").dataset.id);
  if (f && e.target.dataset.ff === "title") { f.title = e.target.value; save(); record(); }
});

function update(skipNodes) {
  CALC = compute();
  if (!skipNodes) { renderNodes(); renderDecor(); }
  drawWires(); renderSummary(); applyView(); renderTabs(); save(); record();
}
function applyView() { const v = S.view; $("#world").style.transform = `translate(${v.x}px,${v.y}px) scale(${v.z})`; }

// ---------- interaction ----------
function toWorld(e) {
  const c = $("#canvas").getBoundingClientRect(), v = S.view;
  return { x: (e.clientX - c.left - v.x) / v.z, y: (e.clientY - c.top - v.y) / v.z };
}
let drag = null;
$("#canvas").addEventListener("mousedown", e => {
  const noteEl = e.target.closest(".note"), frameEl = e.target.closest(".frame");
  if ((noteEl || frameEl) && decorDown(e, noteEl, frameEl)) return;
  const portEl = e.target.closest(".port");
  if (portEl) { portClick(portEl); e.stopPropagation(); return; }
  const wh = e.target.closest(".wirehit");
  if (wh) { sel = { type: "wire", id: +wh.dataset.wid }; renderNodes(); drawWires(); return; }
  if (e.target.closest("[data-act=expand]")) { expandModule(+e.target.closest(".node").dataset.id); return; }
  if (e.target.closest("[data-act=del]")) { removeNode(+e.target.closest(".node").dataset.id); return; }
  const head = e.target.closest("[data-drag]");
  if (head) {
    const nel = head.closest(".node"), n = S.nodes.find(q => q.id === +nel.dataset.id), w = toWorld(e);
    if (!(sel && sel.type === "node" && sel.id === n.id)) { sel = { type: "node", id: n.id }; document.querySelectorAll(".node.sel").forEach(q => q.classList.remove("sel")); nel.classList.add("sel"); renderSummary(); }
    drag = { kind: "node", n, el: nel, ox: w.x - n.x, oy: w.y - n.y }; return;
  }
  if (e.target.closest(".node")) {
    const id = +e.target.closest(".node").dataset.id;
    if (!(sel && sel.type === "node" && sel.id === id)) { sel = { type: "node", id }; document.querySelectorAll(".node").forEach(q => q.classList.toggle("sel", +q.dataset.id === id)); renderSummary(); }
    return;
  }
  // background
  if (pend) { pend = null; applyPortStates(); drawWires(); }
  if (sel) { sel = null; document.querySelectorAll(".node.sel").forEach(q => q.classList.remove("sel")); drawWires(); renderSummary(); }
  drag = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: S.view.x, vy: S.view.y };
  $("#canvas").classList.add("panning");
});
window.addEventListener("mousemove", e => {
  if (drag) {
    if (drag.kind === "node") { const w = toWorld(e); drag.n.x = Math.round(w.x - drag.ox); drag.n.y = Math.round(w.y - drag.oy); drag.el.style.left = drag.n.x + "px"; drag.el.style.top = drag.n.y + "px"; drawWires(); }
    else if (drag.kind === "note" || drag.kind === "frame") {
      const w = toWorld(e); drag.obj.x = Math.round(w.x - drag.ox); drag.obj.y = Math.round(w.y - drag.oy);
      drag.el.style.left = drag.obj.x + "px"; drag.el.style.top = drag.obj.y + "px";
      drag.carried.forEach(c => {                                  // a frame carries the nodes inside it
        c.n.x = drag.obj.x + c.dx; c.n.y = drag.obj.y + c.dy;
        const ne = document.querySelector(`.node[data-id="${c.n.id}"]`); if (ne) { ne.style.left = c.n.x + "px"; ne.style.top = c.n.y + "px"; }
      });
      drawWires();
    }
    else if (drag.kind === "resize") {
      const w = toWorld(e), o = drag.obj;
      o.w = Math.max(drag.isNote ? 120 : 200, Math.round(drag.w0 + w.x - drag.sx)); o.h = Math.max(drag.isNote ? 80 : 120, Math.round(drag.h0 + w.y - drag.sy));
      drag.el.style.width = o.w + "px"; drag.el.style.height = o.h + "px";
    }
    else { S.view.x = drag.vx + e.clientX - drag.sx; S.view.y = drag.vy + e.clientY - drag.sy; applyView(); }
  } else if (pend) { pend.mouse = toWorld(e); drawWires(); }
});
window.addEventListener("mouseup", () => {
  if (!drag) return;
  const k = drag.kind; drag = null; $("#canvas").classList.remove("panning");
  if (k === "node") { save(); record(); }
  else if (k === "pan") save();
  else update();                                   // note/frame move or resize: refresh frame stats, save, record
});
$("#canvas").addEventListener("wheel", e => {
  e.preventDefault();
  const c = $("#canvas").getBoundingClientRect(), v = S.view;
  const nz = Math.min(2, Math.max(0.2, v.z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
  const mx = e.clientX - c.left, my = e.clientY - c.top;
  v.x = mx - (mx - v.x) * nz / v.z; v.y = my - (my - v.y) * nz / v.z; v.z = nz;
  applyView();
}, { passive: false });

function portClick(p) {
  const nid = +p.closest(".node").dataset.id, idx = +p.dataset.idx, side = p.dataset.port, item = p.dataset.item;
  if (!pend) { pend = { node: nid, idx, side, item, mouse: null }; applyPortStates(); return; }
  if (pend.side === side || pend.node === nid) { pend = { node: nid, idx, side, item, mouse: null }; applyPortStates(); drawWires(); return; }
  const out = pend.side === "out" ? pend : { node: nid, idx };
  const inn = pend.side === "in" ? pend : { node: nid, idx };
  pend = null; connect(out.node, out.idx, inn.node, inn.idx);
}

$("#nodes").addEventListener("change", e => {
  const f = e.target.dataset.f; if (!f) return;
  const n = S.nodes.find(q => q.id === +e.target.closest(".node").dataset.id); if (!n) return;
  const v = e.target;
  if (f === "mname") { n.name = v.value.trim().slice(0, 30) || "Module"; }
  else if (f === "tier") n.tier = +v.value;
  else if (f === "mode") n.mode = v.value;
  else if (f === "perfect") n.perfect = v.checked;
  else if (f === "machines") n.machines = Math.max(0, +v.value || 0);
  else if (f === "targetIdx") n.targetIdx = +v.value;
  else if (f === "targetRate") n.targetRate = Math.max(0, +v.value || 0) / S.unit;
  else if (f === "coil") n.coil = v.value;
  update();
});
$("#summary").addEventListener("change", e => {
  if (e.target.dataset.na !== undefined) {                                 // match surplus against shortfalls between pages
    netAcross = e.target.checked; try { localStorage.setItem("gtp.netAcross", netAcross ? "1" : "0"); } catch (_) {}
    return renderSummary();
  }
  const f = e.target.dataset.sf; if (!f) return;
  const n = S.nodes.find(q => q.id === +e.target.dataset.id); if (!n) return;
  if (f === "mb") { n.mb = e.target.value; n.coil = undefined; update(); }
  else if (f === "recipe") switchRecipe(n, e.target.value);
});
window.addEventListener("keydown", e => {
  if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); return redo(); }
  if (e.key === "Escape") { pend = null; applyPortStates(); drawWires(); }
  if ((e.key === "Delete" || e.key === "Backspace") && sel) {
    if (sel.type === "node") removeNode(sel.id);
    else if (sel.type === "note") { S.notes = S.notes.filter(q => q.id !== sel.id); sel = null; update(); }
    else if (sel.type === "frame") { S.frames = S.frames.filter(q => q.id !== sel.id); sel = null; update(); }
    else { S.wires = S.wires.filter(w => w.id !== sel.id); sel = null; update(); }
  }
});

$("#recipeList").addEventListener("click", e => { const r = e.target.closest(".rec"); if (r) addNode(r.dataset.rid); });
$("#search").addEventListener("input", renderList);
$("#btnUnit").onclick = () => { S.unit = S.unit === 60 ? 1 : 60; $("#btnUnit").textContent = S.unit === 60 ? "per min" : "per sec"; update(); };
$("#btnFit").onclick = fit;
function fit() {
  if (!S.nodes.length) return;
  const c = $("#canvas").getBoundingClientRect();
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  S.nodes.forEach(n => { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + nodeLay(n).w); y1 = Math.max(y1, n.y + 260); });
  const z = Math.min(1, Math.max(0.25, Math.min((c.width - 60) / (x1 - x0), (c.height - 60) / (y1 - y0))));
  S.view = { z, x: (c.width - (x1 - x0) * z) / 2 - x0 * z, y: (c.height - (y1 - y0) * z) / 2 - y0 * z };
  applyView(); save();
}
$("#btnUndo").onclick = undo; $("#btnRedo").onclick = redo;
$("#btnNote").onclick = addNote; $("#btnFrame").onclick = addFrame;
$("#btnClear").onclick = () => {
  if (!(S.nodes.length || S.notes.length || S.frames.length) || confirm("Clear this page? (Undo can bring it back)")) { S.nodes = []; S.wires = []; S.notes = []; S.frames = []; sel = null; pend = null; update(); }
};
$("#btnExport").onclick = () => download("board.json", JSON.stringify(boardState(), null, 1));
$("#btnImport").onclick = () => $("#fileBoard").click();
$("#btnData").onclick = () => $("#fileData").click();
$("#fileBoard").onchange = e => readJson(e, j => {
  if (!Array.isArray(j.pages) && !(j.nodes && j.wires)) return toast("Not a board file");
  S = Object.assign({ nodes: [], wires: [], view: { x: 60, y: 60, z: 1 }, unit: 60, nextId: 1, pages: [], cur: 0 }, j);
  ensurePages(); sel = null; pend = null;
  $("#btnUnit").textContent = S.unit === 60 ? "per min" : "per sec"; update();
});
function loadDataset(j) {
  if (!Array.isArray(j.recipes)) return toast("Dataset needs a 'recipes' array");
  setData(j); idbSet("data", persistable()).catch(() => toast("Loaded, but could not be remembered"));
  update(); toast("Loaded " + j.recipes.length + " recipes");
}
$("#fileData").onchange = e => readJson(e, loadDataset);
$("#btnKube").onclick = () => $("#fileKube").click();
function persistable() {                              // the dataset without the lookup tables derived from it
  const o = Object.assign({}, DATA);
  delete o._byOut; delete o._mbByType; delete o._single; delete o._coils;
  return o;
}
// Multiblock structures live in DATA.multiblocks = { id: {name, blocks:{blockId:count}, dims, types:[recipeTypeId]} }
function refreshCoils() {
  // legacy/sample data: structure stored on the machine itself
  DATA.multiblocks = DATA.multiblocks || {};
  Object.entries(DATA.machines || {}).forEach(([mid, m]) => {
    if (m.structure && m.structure.blocks && !DATA.multiblocks["machine:" + mid]) DATA.multiblocks["machine:" + mid] = { name: m.name, blocks: m.structure.blocks, types: [mid] };
  });
  const byType = {}, coils = new Set();
  Object.entries(DATA.multiblocks).forEach(([id, mb]) => {
    mb.id = id;
    (mb.types && mb.types.length ? mb.types : [pathOf(id)]).forEach(t => { const k = pathOf(t); (byType[k] = byType[k] || []).push(mb); });
    Object.keys(mb.blocks || {}).forEach(b => { if (isCoil(b)) coils.add(b); });
  });
  Object.values(byType).forEach(l => l.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id)));
  DATA._mbByType = byType; DATA._coils = [...coils].sort();
  // A recipe type has a single-block machine when tiered machine items exist for it (e.g. gtceu:lv_assembler).
  // Those default to "no structure"; multiblock-only types (blast furnace, distillation tower...) default to their structure.
  const ids = DATA.items || {}, single = {};
  Object.keys(DATA.machines || {}).forEach(m => { single[m] = TIERS_LC.some(t => ids["gtceu:" + t + "_" + m]); });
  DATA._single = single;
}
function mbFor(n) {
  const r = REC[n.recipeId]; if (!r || !DATA._mbByType) return null;
  const l = DATA._mbByType[r.machine]; if (!l || !l.length) return null;
  if (n.mb === "single") return null;
  const chosen = l.find(m => m.id === n.mb); if (chosen) return chosen;
  if (DATA._single && DATA._single[r.machine]) return null;
  const size = m => Object.values(m.blocks || {}).reduce((a, b) => a + b, 0);
  return l.find(m => m.id === n.mb) || l.find(m => pathOf(m.id) === r.machine) || l.slice().sort((a, b) => size(a) - size(b))[0];
}
function importMultiblocks(raw) {
  const mbs = {};
  raw.multiblocks.forEach(m => { if (m.blocks && Object.keys(m.blocks).length) mbs[m.id] = { name: (m.name && m.name !== "null" && m.name !== m.id) ? m.name : idName(m.id), blocks: m.blocks, dims: m.dims, types: m.types || [] }; });
  DATA.multiblocks = mbs;
  refreshCoils();
  const covered = Object.keys(DATA.machines || {}).filter(k => DATA._mbByType[k]).length;
  idbSet("data", persistable()).catch(() => toast("Applied, but could not be remembered"));
  update(); toast(Object.keys(mbs).length + " multiblocks loaded, covering " + covered + " of " + Object.keys(DATA.machines).length + " machine types");
}
function importKubeRaw(raw) {
  if (Array.isArray(raw.multiblocks)) { importMultiblocks(raw); return true; }
  if (!Array.isArray(raw.recipes) || !raw.recipes.length) { toast("No recipes in this file. Is it the KubeJS dump?"); return false; }
  const d = window.convertKubeDump(raw);
  if (!d.recipes.length) { toast("0 usable recipes (" + d._skipped + " skipped). Format may differ; send me a sample."); return false; }
  delete d._skipped; delete d._fluidTagsMapped; loadDataset(d);
  return true;
}
$("#fileKube").onchange = e => readJson(e, importKubeRaw);
// Ready-made data shipped with the app: data/dataset.json (built by tools/make_dataset.ps1) + data/version.json.
// First visit loads it; later visits re-load it only when version.json says a newer build was published.
async function loadBundled(msg) {
  try {
    const r = await fetch("data/dataset.json"); if (!r.ok) return false;
    const d = await r.json(); if (!Array.isArray(d.recipes) || !d.recipes.length) return false;
    toast(msg || "Loading the recipe data (a few seconds)...");
    loadDataset(d);
    return true;
  } catch (_) { return false; }
}
async function checkDataUpdate(storedVersion) {
  try {
    const r = await fetch("data/version.json", { cache: "no-store" }); if (!r.ok) return;
    const v = await r.json();
    if (v.version && v.version !== storedVersion && await loadBundled("A newer recipe dataset was published: updating...")) toast("Recipe data updated to the latest version.");
  } catch (_) { /* offline or no version file: keep what we have */ }
}
// First run (served over http, e.g. by GitHub Pages or GTPlanner.exe): load the bundled data, else import dumps/ by hand-free fallback.
async function autoImport() {
  if (await loadBundled("First run: loading the recipe data (a few seconds)...")) return true;
  try {
    const r1 = await fetch("dumps/gt_planner_dump.json"); if (!r1.ok) return false;
    toast("First run: importing your recipe data (a few seconds)...");
    if (!importKubeRaw(await r1.json())) return false;
    const r2 = await fetch("dumps/gt_planner_multiblocks.json"); if (r2.ok) importKubeRaw(await r2.json());
    toast("Your recipe data is imported. It is remembered from now on.");
    return true;
  } catch (_) { return false; }
}
// Lets GTPlanner.exe notice when the window is closed (a long-poll the server holds open; other servers answer 404).
(function keepAlive() {
  if (!/^https?:/.test(location.protocol)) return;
  const loop = async () => {
    try { const r = await fetch("/alive", { cache: "no-store" }); if (r.status === 404) return; }
    catch (_) { await new Promise(res => setTimeout(res, 2000)); }
    setTimeout(loop, 0);
  };
  loop();
})();
// dataset persistence (IndexedDB: handles multi-MB data that localStorage can't)
function idb() {
  return new Promise((res, rej) => { const q = indexedDB.open("gtplanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("kv"); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
function idbSet(k, v) { return idb().then(db => new Promise((res, rej) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); })); }
function idbGet(k) { return idb().then(db => new Promise((res, rej) => { const r = db.transaction("kv").objectStore("kv").get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); })); }
function readJson(e, cb) {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => { try { cb(JSON.parse(rd.result)); } catch (err) { toast("Invalid JSON"); } };
  rd.readAsText(f);
}
function download(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
let tt; function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("on"), 2200); }
function save() { try { localStorage.setItem("gtp.board", JSON.stringify(boardState())); } catch (_) {} }

// ---------- auto-build ----------
// 1. cost[item] = cheapest number of crafting steps down to "raw" items (what you chose to stop at), over ALL recipes.
// 2. the chain is built from the target item downwards, always taking the cheapest recipe that doesn't loop back.
const AB_INF = 1e9;
const AB_DECOMP = { packer: 3, unpacker: 3, centrifuge: 1, electrolyzer: 1, arc_furnace: 1.5, thermal_centrifuge: 1, macerator: 0.5, extractor: 0.5 };
const AB_PREFER = { lathe: 0, wiremill: 0, polarizer: 0, bender: 0, assembler: 1, cutter: 1, compressor: 1, electric_furnace: 1, extruder: 2, forge_hammer: 2, alloy_smelter: 2, mixer: 2, fluid_solidifier: 3, macerator: 3 };
function byOutIndex() {
  if (DATA._byOut) return DATA._byOut;
  const m = {};
  (DATA.recipes || []).forEach(r => r.outputs.forEach((o, i) => (m[o.item] = m[o.item] || []).push({ r, i })));
  return (DATA._byOut = m);
}
function abPenalty(r) {
  let p = (AB_DECOMP[r.machine] || 0) + 0.4 * (r.outputs.length - 1);
  r.inputs.forEach(i => { if (isFluid(i.item)) p += 0.3; });                  // prefer solid-material routes over casting from fluid
  return p;
}
function abRawFn(o) {
  const idx = byOutIndex(), memo = {};
  return item => {
    if (item in memo) return memo[item];
    const p = pathOf(item), ns = item.split(":")[0];
    const v = !idx[item]                                                   // nothing makes it: must be supplied
      || (o.other && ns !== "gtceu") || (o.fluids && isFluid(item))
      || (o.ingots && /_(ingot|gem)$/.test(p)) || (o.ores && /(_ore$|^raw_)/.test(p)) || (o.dusts && /_dust$/.test(p));
    return (memo[item] = !!v);
  };
}
function abCosts(isRaw) {
  const cost = {}, get = i => isRaw(i) ? 0 : (i in cost ? cost[i] : AB_INF);
  for (let round = 0; round < 14; round++) {
    let changed = false;
    for (const r of DATA.recipes) {
      let c = 1 + abPenalty(r), ok = true;
      for (const inp of r.inputs) { const g = get(inp.item); if (g >= AB_INF) { ok = false; break; } c += g; }
      if (!ok) continue;
      r.outputs.forEach((o, i) => {
        if (isRaw(o.item)) return;
        const cc = c + (i > 0 ? 1.5 : 0);
        if (cc < (o.item in cost ? cost[o.item] : AB_INF)) { cost[o.item] = cc; changed = true; }
      });
    }
    if (!changed) break;
  }
  return { get };
}
function abPick(item, costs, path) {
  let best = null, bs = Infinity;
  for (const { r, i } of byOutIndex()[item] || []) {
    if (r.inputs.some(x => path.has(x.item))) continue;                    // would loop back on itself
    let c = 1 + abPenalty(r) + (i > 0 ? 1.5 : 0), ok = true;
    for (const inp of r.inputs) { const g = costs.get(inp.item); if (g >= AB_INF) { ok = false; break; } c += g; }
    if (!ok) continue;
    c += (AB_PREFER[r.machine] || 0) * 0.01 + baseTier(r) * 0.02;
    if (c < bs) { bs = c; best = r; }
  }
  return best;
}
const nodeHeight = r => ROWS_TOP + Math.max(r.inputs.length, r.outputs.length) * ROW_H + 6;

// rate is items/s. extend=true: wire the new chain's output to every existing node that is short of this item.
function buildChain(item, rate, o, extend) {
  const isRaw = abRawFn(o), costs = abCosts(isRaw);
  const created = {}, order = [], edges = [];
  const visit = (it, depth, path) => {
    if (depth > o.depth) return null;
    const r = abPick(it, costs, path); if (!r) return null;
    let nd = created[r.id];
    if (!nd) {
      if (order.length >= o.max) return null;
      nd = { r, layer: 0 }; created[r.id] = nd; order.push(nd);
      const p2 = new Set([...path, ...r.outputs.map(x => x.item)]);
      r.inputs.forEach(inp => {
        if (isRaw(inp.item)) return;
        const up = visit(inp.item, depth + 1, p2);
        if (up && !edges.some(e => e.from === up && e.to === nd && e.item === inp.item)) edges.push({ from: up, item: inp.item, to: nd });
      });
    }
    return nd;
  };
  const root = visit(item, 0, new Set());
  if (!root) { toast("No usable recipe produces " + itemName(item)); return null; }

  // layers: every producer sits left of its consumers
  for (let pass = 0; pass < order.length + 1; pass++) {
    let ch = false;
    edges.forEach(e => { if (e.from.layer < e.to.layer + 1) { e.from.layer = e.to.layer + 1; ch = true; } });
    if (!ch) break;
  }
  const cols = {}; order.forEach(n => (cols[n.layer] = cols[n.layer] || []).push(n));
  Object.values(cols).forEach(list => { let y = 0; list.forEach(n => { n.ly = y; y += nodeHeight(n.r) + 30; }); });   // x is set below, once card widths are known
  const existing = S.nodes.slice();                                        // what is already on the page

  const consumers = [];
  if (extend) {                                                            // existing nodes still short of this item
    S.nodes.forEach(n => {
      const x = CALC.N[n.id]; if (!x) return;
      x.r.inputs.forEach((inp, k) => { if (inp.item === item && x.need[k] - x.supplied[k] > 1e-9) consumers.push({ n, k }); });
    });
  }
  const made = [];
  order.forEach(nd => {
    const n = { id: S.nextId++, recipeId: nd.r.id, x: 0, y: Math.round(nd.ly), tier: baseTier(nd.r), perfect: false, mode: "auto", machines: 1, targetIdx: 0, targetRate: 0 };
    nd.node = n; S.nodes.push(n); made.push(n);
  });
  const wire = (a, ai, b, bi) => {
    if (!S.wires.some(w => w.from === a && w.fromIdx === ai && w.to === b && w.toIdx === bi)) S.wires.push({ id: S.nextId++, from: a, fromIdx: ai, to: b, toIdx: bi });
  };
  edges.forEach(e => {
    const oi = e.from.r.outputs.findIndex(x => x.item === e.item), ii = e.to.r.inputs.findIndex(x => x.item === e.item);
    if (oi >= 0 && ii >= 0) wire(e.from.node.id, oi, e.to.node.id, ii);
  });
  const rootOut = root.r.outputs.findIndex(x => x.item === item);
  if (extend && consumers.length) consumers.forEach(c => wire(root.node.id, rootOut, c.n.id, c.k));
  else { root.node.targetIdx = rootOut; root.node.targetRate = rate; }

  // place the columns using each card's real (auto-fitted) width; the root column goes just left of whatever was already there
  CALC = compute();
  const keys = Object.keys(cols).map(Number).sort((a, b) => a - b), colW = {}, colLeft = {};
  keys.forEach(k => { colW[k] = Math.max(...cols[k].map(nd => nodeLay(nd.node).w)); });
  keys.forEach((k, i) => { colLeft[k] = i === 0 ? 0 : colLeft[keys[i - 1]] - 70 - colW[k]; });
  const dx = existing.length ? Math.min(...existing.map(n => n.x)) - 80 - colW[keys[0]] : 0, dy = existing.length ? Math.min(...existing.map(n => n.y)) : 0;
  order.forEach(nd => {
    nd.node.x = Math.round(colLeft[nd.layer] + (colW[nd.layer] - nodeLay(nd.node).w) + dx);          // right-aligned in its column
    nd.node.y = Math.round(nd.ly + dy);
  });

  // a labelled frame around the new nodes
  const x0 = Math.min(...made.map(n => n.x)) - 24, y0 = Math.min(...made.map(n => n.y)) - 44;
  const x1 = Math.max(...made.map(n => n.x + nodeLay(n).w)) + 24, y1 = Math.max(...made.map(n => n.y + nodeHeight(REC[n.recipeId]))) + 24;
  S.frames.push({ id: S.nextId++, x: x0, y: y0, w: x1 - x0, h: y1 - y0, title: (extend ? "Supply: " : "Chain: ") + itemName(item), color: S.frames.length % 5 });
  sel = { type: "node", id: root.node.id };
  return { nodes: made.length, wired: consumers.length };
}

// ---- dialog ----
let abState = { item: null, extend: false };
function openBuildDialog(init) {
  abState = { item: init.item || null, extend: !!init.extend };
  $("#dlgTitle").textContent = init.extend ? "Build supply for " + itemName(init.item) : "Auto-build a chain";
  $("#dlgItem").value = init.item ? itemName(init.item) : ""; $("#dlgItem").disabled = !!init.extend;
  $("#dlgUnit").textContent = S.unit === 1 ? "per second" : "per minute";
  $("#dlgRate").value = init.rate != null ? +(init.rate * S.unit).toPrecision(4) : 1;
  $("#dlgNote").textContent = init.extend ? "Wires the new chain into the nodes that are short of this item; their demand sets how much it makes." : "";
  $("#dlgResults").innerHTML = ""; $("#dlg").classList.remove("hidden");
  setTimeout(() => (init.extend ? $("#dlgRate") : $("#dlgItem")).focus(), 30);
}
function closeBuildDialog() { $("#dlg").classList.add("hidden"); }
function searchTargets() {
  const q = $("#dlgItem").value.trim().toLowerCase(); abState.item = null;
  if (!q) { $("#dlgResults").innerHTML = ""; return; }
  const res = Object.keys(byOutIndex()).map(id => [id, itemName(id).toLowerCase()]).filter(([, n]) => q.split(/\s+/).every(t => n.includes(t)))
    .map(([id, n]) => [n === q ? 0 : n.startsWith(q) ? 1 : 2, n.length, id]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, 40);
  $("#dlgResults").innerHTML = res.map(([, , id]) => `<div data-id="${esc(id)}">${iconHtml(id)}<span>${esc(itemName(id))}</span><span class="muted">${esc(id)}</span></div>`).join("") || `<div class="muted">No recipe produces anything like that.</div>`;
  hydrateIcons($("#dlgResults"));
}
$("#dlgItem").addEventListener("input", searchTargets);
$("#dlgResults").addEventListener("click", e => {
  const d = e.target.closest("[data-id]"); if (!d) return;
  abState.item = d.dataset.id; $("#dlgItem").value = itemName(d.dataset.id); $("#dlgResults").innerHTML = "";
});
function doBuild() {
  if (!abState.item) return toast("Pick a target item from the list first");
  const rate = Math.max(0, +$("#dlgRate").value || 0) / S.unit;
  const o = { ingots: $("#rawIngots").checked, ores: $("#rawOres").checked, other: $("#rawOther").checked, fluids: $("#rawFluids").checked, dusts: $("#rawDusts").checked,
    depth: Math.min(15, Math.max(1, +$("#dlgDepth").value || 8)), max: Math.min(120, Math.max(1, +$("#dlgMax").value || 40)) };
  closeBuildDialog();
  H.busy = true; let res = null;                                           // the whole build is ONE undo step
  try { res = buildChain(abState.item, rate, o, abState.extend); } finally { H.busy = false; }
  if (!res) return;
  update(); fit();
  toast("Built " + res.nodes + " nodes" + (res.wired ? ", wired into " + res.wired + " input(s)" : "") + ". Switch any recipe from the side panel.");
}
$("#btnAuto").onclick = () => openBuildDialog({});
$("#dlgCancel").onclick = closeBuildDialog; $("#dlgBuild").onclick = doBuild;
$("#dlg").addEventListener("mousedown", e => { if (e.target.id === "dlg") closeBuildDialog(); });
window.addEventListener("keydown", e => {
  if ($("#dlg").classList.contains("hidden")) return;
  if (e.key === "Escape") closeBuildDialog();
  if (e.key === "Enter" && e.target.id !== "dlgItem") doBuild();
});
$("#summary").addEventListener("click", e => {
  const tm = e.target.closest("[data-tm]");                                // This page / Whole project
  if (tm) { totalsMode = tm.dataset.tm; try { localStorage.setItem("gtp.totals", totalsMode); } catch (_) {} return renderSummary(); }
  const pg = e.target.closest("tr[data-page]");                            // a row in the project's page table
  if (pg) return switchPage(+pg.dataset.page);
  const b = e.target.closest("[data-build]"); if (!b) return;              // ⛏ next to a raw input: build its supply
  openBuildDialog({ item: b.dataset.build, extend: true, rate: CALC.raw[b.dataset.build] || 0 });
});

// ---- switch a node's recipe (same main product, different recipe) ----
function recipeAlternatives(n) {
  const x = CALC.N[n.id]; if (!x || n.type === "module") return [];
  const out = x.r.outputs[Math.max(0, n.targetIdx || 0)] || x.r.outputs[0];
  return (byOutIndex()[out.item] || []).map(e => e.r).sort((a, b) => (a.machine.localeCompare(b.machine)) || (baseTier(a) - baseTier(b)) || a.inputs.length - b.inputs.length).slice(0, 80);
}
function switchRecipe(n, rid) {
  const nr = REC[rid], old = CALC.N[n.id] && CALC.N[n.id].r; if (!nr || !old || nr.id === old.id) return;
  let dropped = 0;
  S.wires = S.wires.filter(w => {
    if (w.from === n.id) { const i = nr.outputs.findIndex(o => o.item === old.outputs[w.fromIdx].item); if (i < 0) { dropped++; return false; } w.fromIdx = i; }
    if (w.to === n.id) { const i = nr.inputs.findIndex(o => o.item === old.inputs[w.toIdx].item); if (i < 0) { dropped++; return false; } w.toIdx = i; }
    return true;
  });
  const tItem = old.outputs[n.targetIdx || 0] && old.outputs[n.targetIdx || 0].item, ti = nr.outputs.findIndex(o => o.item === tItem);
  n.recipeId = rid; n.tier = baseTier(nr); n.targetIdx = ti >= 0 ? ti : 0; n.mb = undefined; n.coil = undefined;
  update();
  toast("Recipe switched" + (dropped ? " (" + dropped + " wire(s) no longer fit and were removed)" : ""));
}

// ---------- PNG export ----------
// Draws the current page onto a canvas (cards, wires, frames, notes, totals) - no screenshot library, no 3D.
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function rtop(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r); ctx.lineTo(x + w, y + h); ctx.closePath();
}
function clipText(ctx, t, maxW) {
  t = String(t); if (maxW <= 4) return "";
  if (ctx.measureText(t).width <= maxW) return t;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}
function wrapText(ctx, text, maxW) {
  const out = [];
  String(text || "").split("\n").forEach(par => {
    let line = "";
    par.split(/\s+/).forEach(w => {
      const t = line ? line + " " + w : w;
      if (line && ctx.measureText(t).width > maxW) { out.push(line); line = w; } else line = t;
    });
    out.push(line);
  });
  return out;
}
function lumOf(col) {
  const m = /^#([0-9a-f]{6})$/i.exec(col);
  return m ? 0.299 * parseInt(m[1].slice(0, 2), 16) + 0.587 * parseInt(m[1].slice(2, 4), 16) + 0.114 * parseInt(m[1].slice(4), 16) : 90;
}
function drawIconPng(ctx, id, x, y, size, icons) {
  const ic = icons[id];
  if (ic) { ctx.imageSmoothingEnabled = false; ctx.drawImage(ic, x, y, size, size); return; }
  const bg = tileColor(id), nm = itemName(id).split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  rrect(ctx, x, y, size, size, 4); ctx.fillStyle = bg; ctx.fill();
  ctx.fillStyle = lumOf(bg) > 150 ? "#111" : "#fff"; ctx.font = "700 " + Math.round(size * 0.5) + "px system-ui,sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(nm, x + size / 2, y + size / 2 + 0.5); ctx.textAlign = "left";
}

async function renderBoard(opts = {}) {
  const useIcons = opts.icons !== false, summary = opts.summary !== false, c = CALC;
  const C = { bg: cssVar("--bg") || "#14161a", panel: cssVar("--panel") || "#1c1f26", panel2: cssVar("--panel2") || "#242831", line: cssVar("--line") || "#343a46",
    text: cssVar("--text") || "#e4e7ee", muted: cssVar("--muted") || "#8b93a3", acc: cssVar("--acc") || "#4da3ff", ok: cssVar("--ok") || "#4cc38a", bad: cssVar("--bad") || "#ff6b6b" };
  const box = [];
  S.nodes.forEach(n => { const x = c.N[n.id]; box.push([n.x, n.y, n.x + nodeLay(n).w, n.y + (x ? nodeHeight(x.r) : 60)]); });
  S.frames.forEach(f => box.push([f.x, f.y, f.x + f.w, f.y + f.h]));
  S.notes.forEach(n => box.push([n.x, n.y, n.x + n.w, n.y + n.h]));
  if (!box.length) return null;
  const M = 40, bx0 = Math.min(...box.map(b => b[0])) - M, by0 = Math.min(...box.map(b => b[1])) - M, bx1 = Math.max(...box.map(b => b[2])) + M, by1 = Math.max(...box.map(b => b[3])) + M;
  const W = Math.max(bx1 - bx0, summary ? 860 : 0), HH = summary ? 70 : 0;

  // totals shown in the footer
  const mach = Object.entries(c.machines).filter(([, v]) => v > 0).map(([k, v]) => { const [m, t] = k.split("|"); return [TIERS[t] + " " + machineName(m), "×" + v, null]; });
  const lists = [["Machines", mach], ["Raw inputs", Object.entries(c.raw).sort((a, b) => b[1] - a[1]).map(([k, v]) => [itemName(k), rate(v, k), k])],
    ["Net products / surplus", Object.entries(c.net).sort((a, b) => b[1] - a[1]).map(([k, v]) => [itemName(k), rate(v, k), k])]];
  const CAP = 14, FH = summary ? 40 + Math.min(CAP + 1, Math.max(...lists.map(l => l[1].length), 1)) * 20 + 14 : 0;

  // icons: load every one we are going to draw
  const ids = new Set();
  S.nodes.forEach(n => { const x = c.N[n.id]; if (x) { x.r.inputs.forEach(i => ids.add(i.item)); x.r.outputs.forEach(o => ids.add(o.item)); } });
  lists.forEach(l => l[1].forEach(e => { if (e[2]) ids.add(e[2]); }));
  const icons = {};
  if (useIcons && window.ICON_INDEX) await Promise.all([...ids].map(async id => { icons[id] = await buildIcon(id); }));

  // size / scale (browsers cap canvases; stay under 16 megapixels and 16384 px)
  const totalW = W, totalH = HH + (by1 - by0) + FH;
  let s = opts.scale || 2;
  s = Math.min(s, 16384 / totalW, 16384 / totalH, Math.sqrt(16e6 / (totalW * totalH)));
  if (s < 0.4) return { tooLarge: true };
  const cv = document.createElement("canvas"); cv.width = Math.ceil(totalW * s); cv.height = Math.ceil(totalH * s);
  const ctx = cv.getContext("2d"); ctx.scale(s, s); ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, totalW, totalH);

  if (summary) {                                    // title bar
    ctx.fillStyle = C.panel; ctx.fillRect(0, 0, totalW, HH);
    ctx.fillStyle = C.text; ctx.font = "700 20px system-ui,sans-serif"; ctx.fillText(S.pages[S.cur] ? S.pages[S.cur].name : "Board", 20, 30);
    const totMach = Object.values(c.machines).reduce((a, b) => a + b, 0);
    ctx.fillStyle = C.muted; ctx.font = "13px system-ui,sans-serif";
    ctx.fillText(`${S.nodes.length} nodes · ${S.wires.length} wires · ${totMach} machines · average ${fmt(c.avg)} EU/t · peak ${fmt(c.peak)} EU/t · rates ${unitLbl()}`, 20, 54);
    ctx.fillStyle = C.line; ctx.fillRect(0, HH - 1, totalW, 1);
  }
  ctx.save(); ctx.translate(-bx0, HH - by0);

  // frames
  S.frames.forEach(f => {
    const col = FRAME_COLORS[f.color % 5], ns = frameContents(f); let m = 0, e = 0;
    ns.forEach(n => { const x = c.N[n.id]; if (x) { m += x.mc; e += x.m * x.eut; } });
    rrect(ctx, f.x, f.y, f.w, f.h, 10); ctx.globalAlpha = 0.08; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1;
    ctx.setLineDash([7, 5]); ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.stroke(); ctx.setLineDash([]);
    rtop(ctx, f.x, f.y, f.w, 30, 9); ctx.globalAlpha = 0.35; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = C.text; ctx.font = "600 13px system-ui,sans-serif";
    const stats = `${ns.length} nodes · ${m} machines · ${fmt(e)} EU/t`;
    ctx.font = "11px system-ui,sans-serif"; const sw = ctx.measureText(stats).width;
    ctx.fillStyle = C.muted; ctx.fillText(stats, f.x + f.w - sw - 10, f.y + 19);
    ctx.fillStyle = C.text; ctx.font = "600 13px system-ui,sans-serif"; ctx.fillText(clipText(ctx, f.title || "", f.w - sw - 34), f.x + 10, f.y + 20);
  });

  // wires
  const pos = (id, side, idx) => { const n = S.nodes.find(q => q.id === id); return { x: n.x + (side === "out" ? nodeLay(n).w : 0), y: n.y + ROWS_TOP + idx * ROW_H + ROW_H / 2 }; };
  c.wires.forEach(w => {
    const a = pos(w.from, "out", w.fromIdx), b = pos(w.to, "in", w.toIdx), x = c.N[w.to];
    const bad = x && x.need[w.toIdx] - x.supplied[w.toIdx] > 1e-9, dx = Math.max(40, Math.abs(b.x - a.x) / 2);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.bezierCurveTo(a.x + dx, a.y, b.x - dx, b.y, b.x, b.y);
    ctx.lineWidth = 2.5; ctx.strokeStyle = w.cycle ? "#ffb454" : bad ? C.bad : "#5b6a85"; ctx.setLineDash(w.cycle ? [6, 4] : []); ctx.stroke(); ctx.setLineDash([]);
    const item = c.N[w.from].r.outputs[w.fromIdx].item, label = w.cycle ? "cycle (ignored)" : rate(w.flow, item);
    ctx.font = "11px system-ui,sans-serif"; const lw = ctx.measureText(label).width, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - 4;
    ctx.lineWidth = 3; ctx.strokeStyle = C.bg; ctx.strokeText(label, mx - lw / 2, my); ctx.fillStyle = C.muted; ctx.fillText(label, mx - lw / 2, my);
  });

  // node cards
  S.nodes.forEach(n => {
    const x = c.N[n.id]; if (!x) return;
    const r = x.r, rows = Math.max(r.inputs.length, r.outputs.length), h = nodeHeight(r), mod = n.type === "module", L = nodeLay(n), CW = L.w;   // CW = this card's auto-fitted width
    rrect(ctx, n.x, n.y, CW, h, 7); ctx.fillStyle = C.panel; ctx.fill(); ctx.lineWidth = mod ? 2 : 1; ctx.strokeStyle = mod ? "#8f5cc4" : C.line; ctx.stroke();
    rtop(ctx, n.x, n.y, CW, 28, 7); ctx.fillStyle = C.panel2; ctx.fill();
    // badge + title
    const bt = mod ? "MODULE" : TIERS[x.tier]; ctx.font = "700 10px system-ui,sans-serif"; const bw = ctx.measureText(bt).width + 10;
    rrect(ctx, n.x + 6, n.y + 7, bw, 15, 3); ctx.fillStyle = mod ? "#7a4db0" : "#3b4660"; ctx.fill();
    ctx.fillStyle = mod ? "#fff" : "#cfe0ff"; ctx.fillText(bt, n.x + 11, n.y + 18);
    ctx.fillStyle = C.text; ctx.font = "600 12px system-ui,sans-serif";
    ctx.fillText(clipText(ctx, mod ? n.name : machineName(r.machine) + ": " + recipeName(r), CW - bw - 24), n.x + 12 + bw, n.y + 18);
    // chips: tier / mode / machines
    const chip = (t, cx, cy, col) => { ctx.font = "11px system-ui,sans-serif"; const tw = ctx.measureText(t).width + 12; rrect(ctx, cx, cy, tw, 18, 4); ctx.fillStyle = C.bg; ctx.fill(); ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.stroke(); ctx.fillStyle = col || C.text; ctx.fillText(t, cx + 6, cy + 13); return cx + tw + 5; };
    let cx = chip(n.mode === "auto" ? "Auto" : "Manual", n.x + 8, n.y + 33);
    if (!mod) { cx = chip(TIERS[x.tier], cx, n.y + 33); if (n.perfect) cx = chip("perfect OC", cx, n.y + 33, C.muted); const mb = mbFor(n), pc = mb && Object.keys(mb.blocks || {}).find(isCoil); if (pc) chip(idName(n.coil || pc).replace(/ Coil Block$/, ""), cx, n.y + 33, C.muted); }
    else chip(`${n.inner.nodes.length} nodes`, cx, n.y + 33, C.muted);
    ctx.fillStyle = C.muted; ctx.font = "11px system-ui,sans-serif";
    if (n.mode === "auto") { const t = r.outputs[n.targetIdx || 0]; ctx.fillText(`Target: ${t ? itemName(t.item) : "-"}  ${rate(n.targetRate || 0)}`, n.x + 8, n.y + 66); }
    else ctx.fillText(`${mod ? "Copies" : "Machines"}: ${fmt(n.machines)}`, n.x + 8, n.y + 66);
    // stats line
    ctx.fillStyle = C.text; ctx.font = "700 11px system-ui,sans-serif"; const mt = (mod ? "×" : "") + fmt(x.m); ctx.fillText(mt, n.x + 8, n.y + 90); let tx = n.x + 8 + ctx.measureText(mt).width + 4;
    ctx.fillStyle = C.muted; ctx.font = "11px system-ui,sans-serif";
    ctx.fillText(clipText(ctx, mod ? `copies · ${n.inner.nodes.length} nodes · ${fmt(x.m * x.eut)} EU/t` : `machines → ${x.mc} (${x.mc > 0 ? Math.round(100 * x.m / x.mc) : 0}%) · ${fmt(x.eut)} EU/t each · ${fmt(x.dur / 20)}s`, n.x + CW - tx - 8), tx, n.y + 90);
    // item rows: inputs in the left column (width L.lw), outputs in the right one (width L.rw)
    for (let i = 0; i < rows; i++) {
      const top = n.y + ROWS_TOP + i * ROW_H, mid = top + ROW_H / 2, half = L.lw;
      if (r.inputs[i]) {
        const inp = r.inputs[i], bad = x.need[i] - x.supplied[i] > 1e-9, rt = rate(x.need[i], inp.item);
        drawIconPng(ctx, inp.item, n.x + 10, top + 3, 18, icons);
        ctx.font = "11px system-ui,sans-serif"; const rw = ctx.measureText(rt).width;
        ctx.font = "12px system-ui,sans-serif"; ctx.fillStyle = C.text; ctx.fillText(clipText(ctx, itemName(inp.item), half - 33 - rw - 14), n.x + 33, mid + 4);
        ctx.font = "11px system-ui,sans-serif"; ctx.fillStyle = bad ? C.bad : C.ok; ctx.fillText(rt, n.x + half - rw - 10, mid + 4);
      }
      if (r.outputs[i]) {
        const o = r.outputs[i], rt = rate(x.prod[i], o.item) + (o.chance != null && o.chance < 1 ? " (" + Math.round(o.chance * 100) + "%)" : "");
        drawIconPng(ctx, o.item, n.x + CW - 28, top + 3, 18, icons);
        ctx.font = "11px system-ui,sans-serif"; const rw = ctx.measureText(rt).width;
        ctx.font = "12px system-ui,sans-serif"; const nm = clipText(ctx, itemName(o.item), L.rw - 33 - rw - 18), nmw = ctx.measureText(nm).width;
        ctx.fillStyle = C.text; ctx.fillText(nm, n.x + CW - 33 - nmw, mid + 4);
        ctx.font = "11px system-ui,sans-serif"; ctx.fillStyle = C.muted; ctx.fillText(rt, n.x + CW - 33 - nmw - 8 - rw, mid + 4);
      }
    }
    // ports
    const port = (px, py) => { ctx.beginPath(); ctx.arc(px, py, 6, 0, 7); ctx.fillStyle = "#6c7a94"; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = C.panel; ctx.stroke(); };
    r.inputs.forEach((_, i) => port(n.x, n.y + ROWS_TOP + i * ROW_H + ROW_H / 2));
    r.outputs.forEach((_, i) => port(n.x + CW, n.y + ROWS_TOP + i * ROW_H + ROW_H / 2));
  });

  // sticky notes (on top, like in the app)
  S.notes.forEach(n => {
    rrect(ctx, n.x, n.y, n.w, n.h, 6); ctx.save(); ctx.shadowColor = "#0007"; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3; ctx.fillStyle = NOTE_COLORS[n.color % 5]; ctx.fill(); ctx.restore();
    rtop(ctx, n.x, n.y, n.w, 22, 6); ctx.fillStyle = "#0002"; ctx.fill();
    ctx.fillStyle = "#1d1d1d"; ctx.font = "12px system-ui,sans-serif";
    const lines = wrapText(ctx, n.text || "", n.w - 18), maxL = Math.floor((n.h - 34) / 15);
    lines.slice(0, maxL).forEach((l, i) => ctx.fillText(i === maxL - 1 && lines.length > maxL ? clipText(ctx, l + " …", n.w - 18) : l, n.x + 9, n.y + 40 + i * 15));
  });
  ctx.restore();

  if (summary) {                                    // footer: machines, raw inputs, products
    const fy = HH + (by1 - by0);
    ctx.fillStyle = C.panel; ctx.fillRect(0, fy, totalW, FH); ctx.fillStyle = C.line; ctx.fillRect(0, fy, totalW, 1);
    const colW = (totalW - 40) / 3;
    lists.forEach(([title, rowsL], ci) => {
      const x0 = 20 + ci * colW; ctx.fillStyle = C.muted; ctx.font = "700 11px system-ui,sans-serif"; ctx.fillText(title.toUpperCase(), x0, fy + 24);
      if (!rowsL.length) { ctx.font = "12px system-ui,sans-serif"; ctx.fillText("—", x0, fy + 46); return; }
      rowsL.slice(0, CAP).forEach(([name, val, id], i) => {
        const y = fy + 34 + i * 20; let tx = x0;
        if (id) { drawIconPng(ctx, id, x0, y, 16, icons); tx = x0 + 22; }
        ctx.font = "12px system-ui,sans-serif"; const vw = ctx.measureText(val).width;
        ctx.fillStyle = C.text; ctx.fillText(clipText(ctx, name, colW - (tx - x0) - vw - 22), tx, y + 12);
        ctx.fillStyle = C.muted; ctx.fillText(val, x0 + colW - 18 - vw, y + 12);
      });
      if (rowsL.length > CAP) { ctx.fillStyle = C.muted; ctx.font = "italic 12px system-ui,sans-serif"; ctx.fillText(`+ ${rowsL.length - CAP} more`, x0, fy + 34 + CAP * 20 + 12); }
    });
  }
  cv._scale = s; cv._world = [Math.round(totalW), Math.round(totalH)];
  return cv;
}

async function exportPng(copy) {
  if (!S.nodes.length && !S.notes.length && !S.frames.length) return toast("This page is empty");
  toast("Rendering PNG...");
  let cv = await renderBoard({ icons: true }), noIcons = false;
  if (cv && cv.tooLarge) return toast("This page is too large to export clearly. Split it into smaller pages.");
  const toBlob = c => new Promise((res, rej) => { try { c.toBlob(b => b ? res(b) : rej(new Error("no blob")), "image/png"); } catch (e) { rej(e); } });
  let blob;
  try { blob = await toBlob(cv); }
  catch (e) {                                                  // opened from a local file: the browser blocks reading back drawn images
    cv = await renderBoard({ icons: false }); noIcons = true;
    try { blob = await toBlob(cv); } catch (e2) { return toast("Could not create the image: " + e2.message); }
  }
  const size = `${cv.width}×${cv.height}px`, note = noIcons ? " (no icons: open via serve.ps1 for icons)" : "";
  if (copy && navigator.clipboard && window.ClipboardItem) {
    try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); return toast("Copied PNG to the clipboard, " + size + note); } catch (e) { /* fall through to download */ }
  }
  const name = (S.pages[S.cur] ? S.pages[S.cur].name : "board").replace(/[^\w\- ]+/g, "").trim() || "board";
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name + ".png"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast("Saved " + name + ".png, " + size + note + (copy ? " (clipboard blocked)" : ". Shift+click copies instead."));
}
$("#btnPng").onclick = e => exportPng(e.shiftKey);

// ---------- demo ----------
function demo() {
  if (!REC.mac_iron || !REC.ebf_steel) return toast("The demo needs the built-in sample data (it isn't loaded)");
  S.nodes = []; S.wires = []; sel = null; pend = null;
  H.busy = true;                                   // record the whole demo as ONE undo step
  try {
    const mk = (rid, x, y, o) => Object.assign(addNode(rid, x, y), o);
    const a = mk("mac_iron", 0, 0), b = mk("smelt_iron", 320, 0), c = mk("ebf_steel", 640, 0), d = mk("bend_steel_plate", 960, 0, { mode: "auto", targetRate: 30 / 60 });
    connect(a.id, 0, b.id, 0); connect(b.id, 0, c.id, 0); connect(c.id, 0, d.id, 0);
    b.mode = "auto"; c.mode = "auto"; a.mode = "auto";
  } finally { H.busy = false; }
  update(); fit();
}
$("#btnDemo").onclick = demo;

// ---------- init ----------
(async function init() {
  let d = window.SAMPLE_DATA, stored = false;
  try { const s = await idbGet("data"); if (s && Array.isArray(s.recipes)) { d = s; stored = true; } } catch (_) {}
  setData(d);
  try { const s = localStorage.getItem("gtp.board"); if (s) S = Object.assign(S, JSON.parse(s)); } catch (_) {}
  ensurePages();                                   // also upgrades boards saved before pages existed
  $("#btnUnit").textContent = S.unit === 60 ? "per min" : "per sec";
  update();
  if (!stored && /^https?:/.test(location.protocol)) await autoImport();
  else if (stored && d.version && /^https?:/.test(location.protocol)) checkDataUpdate(d.version);     // data from a published build: stay current
  if (!S.nodes.length && S.pages.length === 1 && REC.mac_iron) demo();
})();
})();
