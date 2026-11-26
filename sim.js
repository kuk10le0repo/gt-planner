// Flow simulation engine for the "Animate" mode: a small event-driven model of the flowsheet. No DOM, no drawing.
//
// The factory starts EMPTY at t = 0. Inputs with no wire are supplied without limit. A machine starts a craft when it is
// free and its wired inputs are in stock; the craft takes the recipe duration; its outputs are then split over the wires
// (in the planner's proportions) and whatever is left counts as finished product. Pipes/transport take no time.
//   planned mode: each node starts crafts no faster than the planner's rate, so results match the numbers on the cards.
//   full mode:    every whole machine runs whenever it can (shows what the rounded-up machine counts could really do).
//
// spec = { nodes: [{ id, dur (s), machines (whole), rate (crafts/s planned), inputs: [{amount, wired}], outputs: [{amount}] }],
//          wires: [{ id, from, fromIdx, to, toIdx, share (0..1 of that output) }] }
window.createFlowSim = function (spec, opts) {
  const full = !!(opts && opts.full), on = (opts && opts.on) || {};
  const EPS = 1e-6;
  const nodes = new Map(), outWires = new Map();
  spec.nodes.forEach(n => nodes.set(n.id, {
    ...n, dur: Math.max(0.05, n.dur), buf: n.inputs.map(() => 0), busy: 0, batches: [],
    credit: n.rate > 0 ? 1 : 0, last: 0, wakeAt: null, crafts: 0
  }));
  spec.wires.forEach(w => { const k = w.from + ":" + w.fromIdx; if (!outWires.has(k)) outWires.set(k, []); outWires.get(k).push(w); });

  // binary heap of events ordered by time (insertion order breaks ties, so results are repeatable)
  const heap = []; let seq = 0;
  const less = (a, b) => a.t < b.t || (a.t === b.t && a.s < b.s);
  const push = e => { e.s = seq++; heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (!less(heap[i], heap[p])) break; [heap[i], heap[p]] = [heap[p], heap[i]]; i = p; } };
  const pop = () => {
    const top = heap[0], end = heap.pop();
    if (heap.length) { heap[0] = end; let i = 0; for (;;) { let m = i; const l = 2 * i + 1, r = l + 1; if (l < heap.length && less(heap[l], heap[m])) m = l; if (r < heap.length && less(heap[r], heap[m])) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } }
    return top;
  };

  // how many crafts the stock of wired inputs allows
  const stockLimit = n => n.inputs.reduce((lim, inp, k) => (inp.wired && inp.amount > 0) ? Math.min(lim, Math.floor(n.buf[k] / inp.amount + EPS)) : lim, Infinity);

  function tryStart(n, t) {
    if (!(n.rate > 0) && !full) return;
    if (!full) { n.credit = Math.min(n.machines + 1, n.credit + n.rate * (t - n.last)); n.last = t; }
    const free = n.machines - n.busy; if (free <= 0) return;
    const stock = stockLimit(n); if (stock <= 0) return;
    const allowed = full ? Infinity : Math.floor(n.credit + EPS);
    const k = Math.min(free, stock, allowed);
    if (k > 0) {
      n.inputs.forEach((inp, i) => { if (inp.wired) n.buf[i] = Math.max(0, n.buf[i] - inp.amount * k); });
      n.busy += k; if (!full) n.credit -= k;
      const b = { start: t, end: t + n.dur, k }; n.batches.push(b);
      push({ t: b.end, type: "done", n, b });
      if (on.start) on.start(n.id, k, t);
    }
    // waiting only for the planned rate: wake up when the next craft is due
    if (!full && n.machines - n.busy > 0 && stockLimit(n) > 0 && n.credit < 1 - EPS && n.rate > 0) {
      const at = t + (1 - n.credit) / n.rate;
      if (n.wakeAt === null || at < n.wakeAt - EPS) { n.wakeAt = at; push({ t: at, type: "wake", n }); }
    }
  }

  function finish(n, b, t) {
    n.busy -= b.k; n.crafts += b.k; n.batches.splice(n.batches.indexOf(b), 1);
    const touched = new Set();
    n.outputs.forEach((o, j) => {
      const q = o.amount * b.k; if (!(q > 0)) return;
      let used = 0;
      (outWires.get(n.id + ":" + j) || []).forEach(w => {
        const to = nodes.get(w.to); if (!to) return;
        const give = q * Math.min(1, w.share); used += give; to.buf[w.toIdx] += give; touched.add(to);
        if (on.deliver) on.deliver(w.id, give, t);
      });
      const left = q - used;
      if (left > q * 1e-6 && on.product) on.product(n.id, j, left, t);
    });
    touched.forEach(m => tryStart(m, t));
    tryStart(n, t);
  }

  const sim = {
    t: 0,
    node: id => nodes.get(id),
    // run the model forward to time `until`; returns false if it had to stop early (too many events in one step)
    advance(until, maxEvents = 40000) {
      let count = 0;
      while (heap.length && heap[0].t <= until + 1e-9) {
        if (++count > maxEvents) { return false; }
        const e = pop(); sim.t = e.t;
        if (e.type === "done") finish(e.n, e.b, e.t);
        else { if (e.n.wakeAt !== null && Math.abs(e.n.wakeAt - e.t) < 1e-9) e.n.wakeAt = null; tryStart(e.n, e.t); }
      }
      sim.t = until; return true;
    },
    // "busy" | "starved" (a wired input is missing) | "idle"
    state(id) { const n = nodes.get(id); return !n ? "idle" : n.busy > 0 ? "busy" : (n.rate > 0 || full) && stockLimit(n) <= 0 ? "starved" : "idle"; }
  };
  nodes.forEach(n => tryStart(n, 0));
  return sim;
};
