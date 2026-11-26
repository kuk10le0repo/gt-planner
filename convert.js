// Converts the raw KubeJS dump (gt_planner_dump.json) into the planner's dataset format.
// Written against GTCEu Modern's recipe JSON; tolerant of small format variations.
window.convertKubeDump = function (raw) {
  const tagMap = raw.tags || {};
  const recipesIn = raw.recipes || [];
  const titleCase = id => String(id).split(":").pop().replace(/[_\/]/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  // Items that some recipe produces: used to pick a sensible member for tag ingredients.
  const produced = new Set();
  const outIds = (sec) => {
    if (!sec) return;
    ["item", "fluid"].forEach(k => (sec[k] || []).forEach(e => { const id = rawId(e && e.content); if (id && id[0] !== "#") produced.add(id); }));
  };

  function rawId(x) {
    if (x == null) return null;
    if (Array.isArray(x)) { for (const y of x) { const r = rawId(y); if (r) return r; } return null; }
    if (typeof x === "string") return x;
    if (x.item) return x.item;
    if (x.fluid) return x.fluid;
    if (x.tag) return "#" + x.tag;
    if (x.ingredient !== undefined) return rawId(x.ingredient);
    if (x.value !== undefined) return rawId(x.value);
    if (x.values !== undefined) return rawId(x.values);
    return null;
  }
  recipesIn.forEach(r => outIds((r.json || {}).outputs));

  function resolve(id) {
    if (!id) return null;
    if (id[0] !== "#") return id;
    const tag = id.slice(1), m = tagMap[tag];
    if (m && m.length) return m.find(i => produced.has(i)) || m.find(i => i.startsWith("minecraft:")) || m[0];
    return "tag:" + tag;
  }

  const items = {}, machines = {}, recipes = [];
  let skipped = 0;

  // Inputs with zero chance are needed in the machine but never used up: programmed circuits, molds, lenses, catalysts.
  const addNeeded = (nc, c, kind) => {
    let id, entry;
    if (c.type === "gtceu:circuit") {
      const n = Number(c.configuration) || 0;
      id = "gtceu:programmed_circuit_" + n; entry = { item: id, amount: 1, circuit: n };
      if (!items[id]) items[id] = { name: "Programmed Circuit " + n };
    } else {
      id = resolve(rawId(c)); if (!id) return;
      entry = { item: id, amount: kind === "fluid" ? (c.amount != null ? c.amount : 1000) : (c.count != null ? c.count : 1) };
      if (!items[id]) items[id] = { name: titleCase(id.replace(/^tag:/, "")) };
      if (kind === "fluid") items[id].fluid = true;
    }
    if (!nc.some(q => q.item === id)) nc.push(entry);
  };

  const parse = (sec, isOut, nc) => {
    const list = [];
    if (!sec) return list;
    ["item", "fluid"].forEach(kind => (sec[kind] || []).forEach(e => {
      const c = e.content; if (c == null) return;
      const max = e.maxChance || 10000, chance = (e.chance != null ? e.chance : max) / max;
      if (!isOut && chance <= 0) { if (nc) addNeeded(nc, c, kind); return; }
      const id = resolve(rawId(c)); if (!id) return;
      const amount = kind === "fluid" ? (c.amount != null ? c.amount : 1000) : (c.count != null ? c.count : (c.amount != null ? c.amount : 1));
      if (!(amount > 0)) return;
      const ex = list.find(q => q.item === id);
      if (ex) { ex.amount += amount; return; }
      const o = { item: id, amount };
      if (isOut && chance < 1) o.chance = Math.round(chance * 1e4) / 1e4;
      list.push(o);
      if (!items[id]) items[id] = { name: titleCase(id.replace(/^tag:/, "")) };
      if (kind === "fluid") items[id].fluid = true;
    }));
    return list;
  };

  recipesIn.forEach(r => {
    const j = r.json || {};
    const eu = j.tickInputs && j.tickInputs.eu && j.tickInputs.eu[0];
    const eut = eu && eu.content != null ? Math.abs(Number(eu.content)) : null;
    if (!eut || !j.duration) { skipped++; return; }            // generators / non-power recipes
    const nc = [];
    const inputs = parse(j.inputs, false, nc), outputs = parse(j.outputs, true);
    if (!outputs.length) { skipped++; return; }
    const machine = String(r.type).replace("gtceu:", "");
    if (!machines[machine]) machines[machine] = { name: titleCase(machine) };
    const rec = { id: r.id, machine, inputs, outputs, duration: Number(j.duration), eut };
    if (nc.length) rec.nc = nc;                                 // needed, not consumed
    recipes.push(rec);
  });

  // Fluid tags (e.g. "forge:oxygen") cannot be resolved inside the game like item tags can.
  // Map each one to the real fluid id by name so recipes that make and use the fluid can be wired together.
  const fluidByPath = {};
  Object.keys(items).forEach(id => { if (items[id].fluid && id.indexOf("tag:") !== 0) { const p = id.split(":").pop(); if (!fluidByPath[p]) fluidByPath[p] = id; } });
  const remap = {};
  Object.keys(items).forEach(id => {
    if (id.indexOf("tag:") !== 0 || !items[id].fluid) return;
    const p = id.replace(/^tag:[^:]*:/, "");
    remap[id] = fluidByPath[p] || fluidByPath["molten_" + p] || (p === "water" ? "minecraft:water" : p === "lava" ? "minecraft:lava" : "gtceu:" + p);
  });
  const nRemap = Object.keys(remap).length;
  if (nRemap) {
    const fix = list => {
      const out = [];
      list.forEach(e => {
        if (remap[e.item]) e.item = remap[e.item];
        const ex = out.find(q => q.item === e.item && q.chance === e.chance);
        if (ex) ex.amount += e.amount; else out.push(e);
      });
      return out;
    };
    recipes.forEach(r => { r.inputs = fix(r.inputs); r.outputs = fix(r.outputs); if (r.nc) r.nc = fix(r.nc); });
    Object.keys(remap).forEach(id => {
      delete items[id];
      const t = remap[id]; if (!items[t]) items[t] = { name: titleCase(t) };
      items[t].fluid = true;
    });
  }

  return { name: "KubeJS dump (" + recipes.length + " recipes)", items, machines, recipes, _skipped: skipped, _fluidTagsMapped: nRemap };
};
