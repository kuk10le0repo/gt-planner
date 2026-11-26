# GT Planner: what changed in each version

## v1.2 (2026-11-27)

### New
- **Animation:** watch items move through the factory as small pulses on the wires, with a progress bar and busy count on every machine.
- Starts from an **empty factory** and shows the time until the **first** product, how many were made, and the actual rate next to the planned rate.
- Speed from 1x to 600x, pause, restart, and **Machines at full speed** to see what rounded-up machines could really make.
- **Animation On/Off switch** at the front of the header, plus **Show pulses** to keep only the numbers.
- **Programmed circuits, molds and lenses** are now shown as an orange **Needs** row on each card (needed in the machine, never used up).
- A **Circuits & molds** total in the side panel (one set per machine), also in the PNG export.
- Search for them in **Uses** mode, for example `circuit 2` or `mold`. The recipe switcher shows them too.
- This **What's new** page.

### Changed
- The recipe data was rebuilt to include 9,320 programmed-circuit entries and other non-consumed items. Older saved data from the same export updates itself.

## v1.1 (2026-11-21)

### New
- Choose **what** you search: **All**, **Makes** (recipes that produce an item), **Uses** (recipes that consume it) or **Machine**.
- A **machine filter** with recipe counts.
- Full recipe rows (outputs, inputs with amounts, machine and tier) with your search words highlighted.
- A result count, a **Show more** button, and a recipe panel you can drag wider.

### Changed
- Recipes where your item is the main product now come before ones where it is only a byproduct.

## v1.0 (2026-11-20)

First published version.

### Planning
- Recipe search and a node graph with wires, built from a Star Technology export (38,775 recipes, 234 multiblocks).
- **Auto** and **Manual** machine sizing with tier overclocking and perfect overclock.
- Side panel with power, machines, raw inputs, net products, multiblock blocks and hatches.
- **Auto-build** a whole production chain, a supply button for any raw input, and a recipe switcher.

### Organising
- Pages, whole-project totals, undo and redo, sticky notes, group frames and compound modules.

### Looks and sharing
- Item icons drawn from the modpack textures, cards that fit their text, and **PNG export**.
- Board export and import, a Windows launcher (`GTPlanner.exe`), and this online version.
