// Sample dataset (APPROXIMATE values, for prototype only).
// Replace with your real modpack export using the "Load data" button (see README.md for the schema).
window.SAMPLE_DATA = {
  name: "Sample GregTech data (approximate)",
  items: {
    iron_ore: { name: "Iron Ore" }, copper_ore: { name: "Copper Ore" },
    crushed_iron_ore: { name: "Crushed Iron Ore" }, crushed_copper_ore: { name: "Crushed Copper Ore" },
    iron_ingot: { name: "Iron Ingot" }, copper_ingot: { name: "Copper Ingot" },
    coal_dust: { name: "Coal Dust" }, steel_ingot: { name: "Steel Ingot" },
    steel_plate: { name: "Steel Plate" }, steel_rod: { name: "Steel Rod" },
    copper_wire: { name: "Copper Wire" }, lv_motor: { name: "LV Electric Motor" },
    water: { name: "Water", fluid: true }, hydrogen: { name: "Hydrogen", fluid: true },
    oxygen: { name: "Oxygen", fluid: true }
  },
  machines: {
    macerator: { name: "Macerator" },
    electric_furnace: { name: "Electric Furnace" },
    wiremill: { name: "Wiremill" },
    bender: { name: "Bending Machine" },
    lathe: { name: "Lathe" },
    assembler: { name: "Assembler" },
    electrolyzer: { name: "Electrolyzer" },
    electric_blast_furnace: {
      name: "Electric Blast Furnace",
      multiblock: true,
      structure: {
        blocks: {
          "gtceu:electric_blast_furnace": 1, "gtceu:heat_proof_machine_casing": 9,
          "gtceu:cupronickel_coil_block": 16, "gtceu:ulv_input_bus": 1, "gtceu:ulv_output_bus": 1,
          "gtceu:mv_energy_input_hatch": 1, "gtceu:ulv_muffler_hatch": 1, "gtceu:auto_maintenance_hatch": 1
        }
      }
    }
  },
  recipes: [
    { id: "mac_iron", machine: "macerator", inputs: [{ item: "iron_ore", amount: 1 }], outputs: [{ item: "crushed_iron_ore", amount: 2 }], duration: 400, eut: 8 },
    { id: "mac_copper", machine: "macerator", inputs: [{ item: "copper_ore", amount: 1 }], outputs: [{ item: "crushed_copper_ore", amount: 2 }], duration: 400, eut: 8 },
    { id: "smelt_iron", machine: "electric_furnace", inputs: [{ item: "crushed_iron_ore", amount: 1 }], outputs: [{ item: "iron_ingot", amount: 1 }], duration: 128, eut: 4 },
    { id: "smelt_copper", machine: "electric_furnace", inputs: [{ item: "crushed_copper_ore", amount: 1 }], outputs: [{ item: "copper_ingot", amount: 1 }], duration: 128, eut: 4 },
    { id: "ebf_steel", machine: "electric_blast_furnace", inputs: [{ item: "iron_ingot", amount: 1 }, { item: "coal_dust", amount: 2 }], outputs: [{ item: "steel_ingot", amount: 1 }], duration: 500, eut: 120, minTier: 2 },
    { id: "bend_steel_plate", machine: "bender", inputs: [{ item: "steel_ingot", amount: 1 }], outputs: [{ item: "steel_plate", amount: 1 }], duration: 100, eut: 24 },
    { id: "lathe_steel_rod", machine: "lathe", inputs: [{ item: "steel_ingot", amount: 1 }], outputs: [{ item: "steel_rod", amount: 1 }], duration: 160, eut: 16 },
    { id: "wire_copper", machine: "wiremill", inputs: [{ item: "copper_ingot", amount: 1 }], outputs: [{ item: "copper_wire", amount: 2 }], duration: 100, eut: 4 },
    { id: "asm_lv_motor", machine: "assembler", inputs: [{ item: "steel_rod", amount: 2 }, { item: "copper_wire", amount: 4 }], outputs: [{ item: "lv_motor", amount: 1 }], duration: 100, eut: 30 },
    { id: "elec_water", machine: "electrolyzer", inputs: [{ item: "water", amount: 1000 }], outputs: [{ item: "hydrogen", amount: 2000 }, { item: "oxygen", amount: 1000 }], duration: 800, eut: 30 }
  ]
};
