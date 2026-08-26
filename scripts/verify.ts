import { db } from "../src/lib/db";
async function main() {
  // BUG-4 verify: colorCode vs colorCode2 not swapped.
  const sample = await db.masterData.findFirst({ where: { factoryPO: "MH26110228" }, select: { colorCode: true, colorCode2: true, company: true } });
  console.log("Mafate MH26110228:", JSON.stringify(sample));
  // For Mafate: "Color Code" (title) = descriptive name e.g. "NEON FLAME..."; "COLOR CODE" (caps) = paint formula
  const onyx = await db.masterData.findFirst({ where: { company: "onyx" }, select: { factoryPO: true, colorCode: true, colorCode2: true } });
  console.log("Onyx sample:", JSON.stringify(onyx));
  // Quantity check sample
  const qc = await db.quantityCheck.findFirst({ where: { match: false }, select: { company: true, poNo: true, factoryPO: true, size: true, orderQty: true, outputQty: true, inputQty: true, shortage: true } });
  console.log("Quantity mismatch sample:", JSON.stringify(qc));
  const okCount = await db.quantityCheck.count({ where: { match: true } });
  const errCount = await db.quantityCheck.count({ where: { match: false } });
  console.log(`QuantityCheck: ${okCount} ok, ${errCount} errors`);
  const shortageCount = await db.quantityCheck.count({ where: { shortage: { gt: 0 } } });
  console.log(`Shortage orders (>0): ${shortageCount}`);
}
main().finally(() => process.exit(0));
