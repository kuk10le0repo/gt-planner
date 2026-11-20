// GT Planner material exporter for KubeJS 6 (Minecraft 1.20.1, GTCEu Modern).
//
// Install: copy to  <instance>/kubejs/server_scripts/export_materials.js
//          (the folder  <instance>/kubejs/exported  must exist)
// Run:     load a world. Writes  <instance>/kubejs/exported/gt_planner_materials.json
//
// Exports each GregTech material's name, colours and icon set so the planner can tint
// item icons. Read-only: it does not change any game data.

ServerEvents.loaded(event => {
  var diag = { errors: [] };
  var mats = [];
  try {
    var GTCEuAPI = Java.loadClass('com.gregtechceu.gtceu.api.GTCEuAPI');
    var mgr = GTCEuAPI.materialManager;
    var all = [];
    var regs = [];
    try {
      var rit = mgr.getRegistries().iterator();           // every MaterialRegistry (gtceu + addons)
      while (rit.hasNext()) regs.push(rit.next());
    } catch (e1) {
      diag.regsError = String(e1);
      regs.push(mgr.getRegistry('gtceu'));
    }
    diag.registries = regs.length;
    regs.forEach(function (r) {
      var mit = r.getAllMaterials().iterator();
      while (mit.hasNext()) all.push(mit.next());
    });
    diag.total = all.length;
    console.info('[GTPlanner] found ' + all.length + ' materials');
    all.forEach(function (m) {
      try {
        var e = { name: String(m.getName()) };
        try { e.color = (m.getMaterialARGB() & 0xFFFFFF); } catch (a) { diag.colorErr = String(a); }
        try { e.secondary = (m.getMaterialSecondaryARGB() & 0xFFFFFF); } catch (b) { diag.secErr = String(b); }
        try { e.modid = String(m.getModid()); } catch (d) { /* optional */ }
        try {
          var set = m.getMaterialIconSet();
          e.iconSet = String(set.name);
          if (e.iconSet === 'undefined' || e.iconSet === 'null') e.iconSet = String(set);
        } catch (c) { diag.setErr = String(c); }
        mats.push(e);
      } catch (e2) {
        if (diag.errors.length < 10) diag.errors.push(String(e2));
      }
    });
  } catch (e) {
    diag.fatal = String(e);
    console.error('[GTPlanner] material export failed: ' + e);
  }
  console.info('[GTPlanner] materials exported: ' + mats.length + ', errors: ' + diag.errors.length +
    (diag.fatal ? ', fatal: ' + diag.fatal : '') + (diag.colorErr ? ', colorErr: ' + diag.colorErr : '') + (diag.setErr ? ', setErr: ' + diag.setErr : ''));
  try {
    var text = JSON.stringify({ version: 1, diag: diag, materials: mats });
    var JsonParser = Java.loadClass('com.google.gson.JsonParser');
    JsonIO.write('kubejs/exported/gt_planner_materials.json', JsonParser.parseString(text));
    console.info('[GTPlanner] wrote gt_planner_materials.json');
  } catch (e3) {
    console.error('[GTPlanner] could not write materials file: ' + e3);
  }
});
