import { db } from "../src/lib/db";
async function main() {
  const master = await db.masterData.count();
  const entry = await db.entryData.count();
  const pending = await db.masterData.count({ where: { shippingStatus: { startsWith: "3" } } });
  console.log(`MasterData: ${master} (was 42,665)`);
  console.log(`EntryData: ${entry}`);
  console.log(`Pending rows: ${pending} (should be 0)`);
  // Status breakdown
  const byStatus = await db.masterData.groupBy({ by: ["shippingStatus"], _count: { _all: true }, orderBy: { shippingStatus: "asc" } });
  console.log("By status:");
  for (const s of byStatus) {
    console.log(`  ${s.shippingStatus || "(empty)"}: ${s._count._all}`);
  }
}
main().finally(() => process.exit(0));
