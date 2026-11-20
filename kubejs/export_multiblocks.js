// GT Planner multiblock exporter for KubeJS 6 (Minecraft 1.20.1, GTCEu Modern).
//
// Install: copy to  <instance>/kubejs/server_scripts/export_multiblocks.js
//          (the folder  <instance>/kubejs/exported  must exist)
// Run:     load a world. Writes  <instance>/kubejs/exported/gt_planner_multiblocks.json
//          and logs [GTPlanner] lines to logs/kubejs/server.log.
//
// It only reads GregTech's registry and each multiblock's preview structure (the one
// shown in the recipe viewer). It does not change any game data.
// Remove the script afterwards if you don't want it running on every world load.

ServerEvents.loaded(event => {
  var diag = { errors: [], methodsA: [] };
  var result = [];
  try {
    var GTRegistries = Java.loadClass('com.gregtechceu.gtceu.api.registry.GTRegistries');
    var defs = [];
    var all = [];
    var reg = GTRegistries.MACHINES;
    try {
      var it = reg.iterator();
      while (it.hasNext()) all.push(it.next());
    } catch (e1) {
      diag.iterError = String(e1);
      var vals = reg.values();
      var it2 = vals.iterator();
      while (it2.hasNext()) all.push(it2.next());
    }
    diag.totalMachines = all.length;
    all.forEach(function (d) {
      // only multiblock definitions have getMatchingShapes()
      if (d != null && typeof d.getMatchingShapes === 'function') defs.push(d);
    });
    diag.multiblocks = defs.length;
    if (all.length) diag.firstMachineClass = String(all[0].getClass().getName());
    if (defs.length) {
      try {
        var ms = defs[0].getClass().getMethods(), nm = [];
        for (var q = 0; q < ms.length; q++) nm.push(String(ms[q].getName()));
        diag.defMethods = nm.filter(function (v, i, a) { return a.indexOf(v) === i && /shape|pattern|preview|part/i.test(v); });
      } catch (e3) { diag.defMethodsError = String(e3); }
    }
    console.info('[GTPlanner] found ' + defs.length + ' multiblock definitions');

    defs.forEach(function (def) {
      var id = String(def.getId());
      var entry = { id: id, name: id, blocks: {}, variants: 0, dims: null };
      try { entry.name = String(def.getLangValue()); } catch (e) { /* keep id */ }
      // which recipe types this multiblock can run (ids like "gtceu:electric_blast_furnace")
      entry.types = [];
      try {
        var rts = def.getRecipeTypes();
        for (var k = 0; k < rts.length; k++) {
          if (rts[k] == null) continue;
          try { entry.types.push(String(rts[k].registryName)); } catch (e4) { entry.types.push(String(rts[k])); }
        }
      } catch (e5) { entry.typesError = String(e5); }
      try {
        // copy into a normal ArrayList: some results are JDK-internal immutable lists that Rhino cannot index
        var ArrayList = Java.loadClass('java.util.ArrayList');
        var shapes = new ArrayList(def.getMatchingShapes());
        entry.variants = shapes.size();
        if (shapes.size() > 0) {
          var grid = shapes.get(0).getBlocks();
          entry.dims = [grid.length, grid[0].length, grid[0][0].length];
          for (var x = 0; x < grid.length; x++) for (var y = 0; y < grid[x].length; y++) for (var z = 0; z < grid[x][y].length; z++) {
            var bi = grid[x][y][z];
            if (bi == null) continue;
            var s = String(bi.getBlockState().getBlock());          // "Block{namespace:name}"
            var m = /\{([^}]*)\}/.exec(s);
            var key = m ? m[1] : s;
            if (key === 'minecraft:air') continue;
            entry.blocks[key] = (entry.blocks[key] || 0) + 1;
          }
        }
      } catch (e) {
        entry.error = String(e);
        if (diag.errors.length < 10) diag.errors.push(id + ': ' + String(e));
      }
      result.push(entry);
    });
  } catch (e) {
    diag.fatal = String(e);
    console.error('[GTPlanner] multiblock export failed: ' + e);
  }

  var withBlocks = result.filter(function (r) { return Object.keys(r.blocks).length > 0; }).length;
  diag.withBlocks = withBlocks;
  console.info('[GTPlanner] multiblocks with block data: ' + withBlocks + '/' + result.length + ', errors: ' + diag.errors.length);
  if (diag.errors.length) console.info('[GTPlanner] first error: ' + diag.errors[0]);
  if (diag.fatal) console.info('[GTPlanner] fatal: ' + diag.fatal);

  try {
    var text = JSON.stringify({ version: 1, diag: diag, multiblocks: result });
    var JsonParser = Java.loadClass('com.google.gson.JsonParser');
    JsonIO.write('kubejs/exported/gt_planner_multiblocks.json', JsonParser.parseString(text));
    console.info('[GTPlanner] wrote gt_planner_multiblocks.json (' + text.length + ' chars)');
  } catch (e) {
    console.error('[GTPlanner] could not write multiblock file: ' + e);
  }
});
