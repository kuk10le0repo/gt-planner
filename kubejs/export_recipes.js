// priority: -20000
// (runs after every other script, so modpack recipe changes are included)
//
// GT Planner recipe exporter for KubeJS 6 (Minecraft 1.20.1).
//
// Install: copy this file to  <your instance>/kubejs/server_scripts/export_recipes.js
//          and create an empty folder  <your instance>/kubejs/exported
// Run:     load a world (avoid /reload on very large packs).
//          The dump is written to  <your instance>/kubejs/exported/gt_planner_dump.json
// Then in GT Planner click "Import KubeJS dump" and pick that file.
//
// Remove the script afterwards if you don't want it running on every world load.

ServerEvents.recipes(event => {
  var parts = [];
  var tags = {};
  var tagRe = /"tag"\s*:\s*"([^"]+)"/g;

  event.forEachRecipe({}, r => {
    try {
      var rType = String(r.getType());
      if (rType.indexOf('gtceu:') !== 0) return;       // only GregTech machine recipes
      var rText = String(r.json);
      tagRe.lastIndex = 0;
      var mt;
      while ((mt = tagRe.exec(rText)) !== null) tags[mt[1]] = true;
      parts.push('{"id":' + JSON.stringify(String(r.getId())) + ',"type":' + JSON.stringify(rType) + ',"json":' + rText + '}');
    } catch (e) {
      console.error('[GTPlanner] skipped a recipe: ' + e);
    }
  });
  console.info('[GTPlanner] collected ' + parts.length + ' GregTech recipes, resolving tags...');

  // Resolve every tag used by those recipes to its member item ids.
  var tagMembers = {};
  Object.keys(tags).forEach(tag => {
    try {
      var ids = [];
      Ingredient.of('#' + tag).getItemIds().forEach(x => ids.push(String(x)));
      if (ids.length) tagMembers[tag] = ids;
    } catch (e) { /* fluid tags or empty tags: ignored, converter falls back */ }
  });

  var text = '{"version":1,"recipes":[' + parts.join(',') + '],"tags":' + JSON.stringify(tagMembers) + '}';
  console.info('[GTPlanner] writing ' + Math.round(text.length / 1048576) + ' MB...');
  var JsonParser = Java.loadClass('com.google.gson.JsonParser');
  JsonIO.write('kubejs/exported/gt_planner_dump.json', JsonParser.parseString(text));
  console.info('[GTPlanner] exported ' + parts.length + ' GregTech recipes, ' + Object.keys(tagMembers).length + ' tags');
});
