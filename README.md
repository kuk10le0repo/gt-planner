# GT Planner (prototype)

Lightweight, standalone flowsheet + BOM planner inspired by GregTech Calculator Board. No Minecraft, no build step.
Recipes and multiblocks come from a Star Technology (GregTech CEu, Minecraft 1.20.1) export that ships with the app.

## Use it online (GitHub Pages)
If this is published, just open the link (`https://<user>.github.io/<repo>/`). The recipe data and icons load on first visit
(a few seconds), then everything is remembered in your browser. Your boards stay in your own browser: use **Export board** /
**Import board** to send one to a friend. How to publish it yourself: see `SHARING.md`.

## Run
**Double-click `GTPlanner.exe`** (build it once with `tools\build_exe.ps1`; it is not stored in the repository).
It opens the planner in its own window (Edge app mode: no tabs or address bar) and stops
by itself about 20 seconds after you close the window. The first time, it loads the bundled recipe data from
`data/dataset.json` (a few seconds); after that everything is remembered. Launching it again while it is open just opens another
window. Keep `GTPlanner.exe` inside this folder: it serves the files next to it.

- Your boards and data live in the app's private profile, `%LOCALAPPDATA%\GTPlanner\profile` (delete that folder to reset).
- Needs Microsoft Edge (built into Windows 10/11) or Google Chrome; otherwise it opens your default browser.
- Rebuild the exe after editing `tools\GTPlanner.cs`: `powershell -ExecutionPolicy Bypass -File tools\build_exe.ps1`
  (uses the C# compiler that ships with Windows; nothing to install).
- Moving to another PC: copy the whole `gt-planner` folder (about 40 MB).
- Windows SmartScreen may warn about an unsigned exe if you copy it from a download or e-mail; one built here will not.

Alternatives: double-click `index.html` (no icons in exported PNGs, and import the dumps by hand the first time), or run
`serve.ps1` and open http://127.0.0.1:8099/ in a browser.

## Making the data file
`data/dataset.json` (about 10 MB) is built from the in-game exports in `dumps/` with
`powershell -ExecutionPolicy Bypass -File tools\make_dataset.ps1`; the icons come from `tools\build_icons.ps1`
(one packed file, `icons/textures.js`). The app checks `data/version.json` on each visit and reloads the dataset when a
newer one was published.

## Notice
Recipes and icon textures are taken from Minecraft, GregTech CEu Modern and the Star Technology modpack and belong to their
respective authors. This project is an unofficial fan tool and is not affiliated with or endorsed by them.

## Use
- Left: search recipes (by item, machine) and click to add a node.
- Click an **output dot**, then an **input dot** of the same item to wire (Esc cancels).
- Node **Manual** = you set the machine count. **Auto** = machines are derived from a target rate and/or downstream demand.
- **Cards fit their text:** every node card sizes itself to its content (title, item names and rates, target / coil
  selects, stats line), so nothing is cut off. Cards in one chain can therefore have different widths; auto-build, wires,
  frames, modules and the PNG export all follow the real width.
- Tier select applies overclocking (EU/t x4, time /2 per tier; "perfect OC" = /4).
- Right panel: power, machine counts, raw inputs, net outputs, multiblock blocks and hatches (BOM).
- Select + Del removes a node or wire. Board autosaves; Export/Import board as JSON.
- **Pages:** tabs along the top of the canvas. `+` adds a page, double-click a tab to rename it, `x` deletes it.
  Each page has its own nodes, wires and view. The side panel totals are for the current page.
- **Whole-project totals:** with two or more pages, the right panel gets a **This page / Whole project** switch (remembered
  between sessions). Whole project adds up every page: power, machines, blocks, hatches, raw inputs and net products, with a
  per-page table (click a row to open that page). "Match surplus against shortfalls between pages" (on by default) lets
  one page's surplus cover another page's raw input for the same item, and lists what was supplied between pages.
  Pages are independent flowsheets, so this is a bookkeeping view, not a wire between pages.
- **Sticky notes** (`+ Note`): drag by the top bar, resize from the corner, click the dot to change colour, type to edit.
- **Group frames** (`+ Frame`): a labelled box. Nodes whose centre is inside it are "in" the group: dragging the frame
  by its title bar moves them too, and its title bar shows the group's node count, machine count and power.
  Deleting a frame keeps its nodes. Notes and frames are per page and are covered by undo.
- **Auto-build** (`⚙ Auto-build`): pick any item and a rate and the planner builds the whole production chain for it,
  wired and in Auto mode, inside a labelled frame (one undo step). It first works out the cheapest route to every item
  from ALL recipes, down to "raw" items you choose to stop at (ingots and gems, ores, vanilla and other-mod items, fluids,
  dusts), then takes the cheapest recipe at each step, avoiding loops, decomposition recipes and fluid-casting routes.
  Max depth and max nodes limit the size. A chain of ~20 nodes builds in well under 0.2 s on the full dataset.
  - **⛏ next to any raw input** in the side panel builds a supply chain for just that input and wires it into every node
    that is short of it (change the "stop at" options first to go deeper or shallower).
  - **Recipe switcher:** select a node and use the "recipe" list in the side panel to swap in any other recipe that makes
    its main product. Wires are re-attached by item; ones that no longer fit are removed (and you are told).
  - The heuristic follows your recipe data, so it can pick odd-but-valid recipes (e.g. wood dust from a fence gate);
    switch the recipe on that node if you prefer another.
- **Export PNG:** saves the current page as `<page name>.png`; Shift+click copies it to the clipboard instead (falls back to
  saving if the browser blocks clipboard images). It is drawn straight onto a canvas at 2x (scaled down to stay under
  16 megapixels / 16384 px; pages too large to export clearly are refused: split them). The image has a title bar with the
  page's totals, the frames, wires with flow labels, node cards with icons, notes, modules, and a footer listing machines,
  raw inputs and net products. If you open `index.html` straight from the disk, browsers refuse to read back local icon
  images, so the PNG is saved with letter tiles instead of icons; run `serve.ps1` and open http://127.0.0.1:8099/ for icons.
- **Compound modules:** put a frame around part of a flowsheet and click **▣ Module** on its title bar. The nodes inside
  collapse into one purple module node. Inputs the group still needs and surplus it produces become pins, and wires that
  crossed the frame edge are re-attached to them. The module is frozen at the rates the group had when you collapsed it.
  Set **Copies** (manual) or switch to **Auto** with a target rate and it scales every inner machine together.
  Its machines, power, blocks and hatches roll up into the totals (scaled linearly). **⤢** expands it back into its
  nodes and restores the original wires. To edit inside a module, expand it, change things, and group it again.
- **Undo / redo:** header buttons or Ctrl+Z, Ctrl+Y (Ctrl+Shift+Z). Up to 100 steps; covers adding, removing, wiring,
  moving, editing and page changes (including deleting a page). Undo history is not saved between sessions.

## Icons
Icons are built from your own modpack files (nothing is downloaded):
1. Copy `kubejs/export_materials.js` to `<instance>/kubejs/server_scripts/`, load a world, and copy
   `<instance>/kubejs/exported/gt_planner_materials.json` to `dumps/`.
2. Run `powershell -ExecutionPolicy Bypass -File tools\build_icons.ps1` (about 15 seconds).
   It reads the mod jars, the Minecraft jar and `kubejs/assets`, copies the textures it needs into `icons/tex/`,
   and writes `icons/index.js`.
GregTech material items (ingots, dusts, plates, gears...) are drawn from the icon-set templates tinted with the
material colours, exactly like the game. Other items use their model's texture. Machines and hatches are drawn
flat from their casing texture plus the front overlay (no 3D). Fluids are colour swatches.
Anything unresolved falls back to a coloured letter tile. Icons are tiny 16x16 canvases, no 3D.
If your instance is elsewhere, pass `-Instance` and `-ClientJar` to the script.

## Real data from your modpack (KubeJS)
1. Copy `kubejs/export_recipes.js` to `<instance>/kubejs/server_scripts/`.
2. Start the game and load a world (or run `/reload`). Check `logs/kubejs/server.log` for `[GTPlanner] exported N GregTech recipes`.
3. Take `<instance>/kubejs/exported/gt_planner_dump.json` and click **Import KubeJS dump** in the planner.
The dataset is remembered in the browser (IndexedDB). Only GregTech (`gtceu:`) power-consuming recipes are imported; generators are skipped.
Item names are derived from ids (iron_ingot -> Iron Ingot). Multiblock block counts are not in the dump yet.

## Multiblock block counts
1. Copy `kubejs/export_multiblocks.js` to `<instance>/kubejs/server_scripts/` and load a world (no `/reload`).
2. Import `<instance>/kubejs/exported/gt_planner_multiblocks.json` with the same **Import KubeJS dump** button (after the recipe dump).
It reads each multiblock's preview structure from GTCEu (casings, coils, frames, pipes, hatches) and which recipe types it runs.
Select a node to pick which multiblock it uses; the BOM multiplies the structure by the machine count.
Recipe types that have an ordinary single-block machine (assembler, lathe, macerator...) default to
"Single-block machine (no structure)"; multiblock-only types (blast furnace, distillation tower...) default to their
structure. Single-block detection is a heuristic based on tiered machine items (e.g. `gtceu:lv_assembler`) in your recipes.
Fluid tags such as `forge:oxygen` are mapped to the real fluid by name when the recipe dump is imported.
Energy hatches follow the node's tier; the coil dropdown swaps the heating coil.

## Dataset schema (`Load data`, manual format)
```json
{
  "name": "My modpack",
  "items":    { "iron_ingot": { "name": "Iron Ingot", "fluid": false } },
  "machines": { "macerator": { "name": "Macerator" },
                "electric_blast_furnace": { "name": "Electric Blast Furnace", "multiblock": true,
                  "structure": { "controller": 1,
                    "blocks": [{ "name": "Heat Proof Machine Casing", "count": 9 }],
                    "coil": { "count": 16, "default": "Cupronickel Coil Block", "options": ["Cupronickel Coil Block"] },
                    "hatches": [{ "name": "Energy Hatch", "count": 1, "tiered": true }] } } },
  "recipes":  [ { "id": "unique_id", "machine": "macerator",
                  "inputs":  [{ "item": "iron_ore", "amount": 1 }],
                  "outputs": [{ "item": "crushed_iron_ore", "amount": 2, "chance": 1 }],
                  "duration": 400, "eut": 8, "minTier": 0 } ]
}
```
Fluid amounts are in mB. `duration` is in ticks. `chance` (0-1) and `minTier` (0=ULV, 1=LV, ...) are optional.
The sample data in `data.js` is approximate; replace it with an export from your pack.
