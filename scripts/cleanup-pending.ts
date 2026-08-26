// Cleanup script: delete all 3.Pending records from MasterData and EntryData.
// Pending is now calculated dynamically (= -Output) instead of stored.
// This reduces data volume by ~25-50% and speeds up all queries.
import { db } from "../src/lib/db";

async function main() {
  // Count before.
  const masterBefore = await db.masterData.count({ where: { shippingStatus: { contains: "3" }, productType: "MAFATE" } });
  const entryPending = await db.entryData.count({ where: { shippingStatus: "3.Pending" } });
  console.log("=== BEFORE CLEANUP ===");
  console.log(`MasterData rows with 3.* status: ${masterBefore}`);
  console.log(`EntryData rows with 3.Pending status: ${entryPending}`);

  const totalMasterBefore = await db.masterData.count();
  const totalEntryBefore = await db.entryData.count();
  console.log(`Total MasterData: ${totalMasterBefore}`);
  console.log(`Total EntryData: ${totalEntryBefore}`);

  // Delete MasterData rows where shippingStatus starts with "3" (3.Pending, 3. Pending, etc.)
  // These are pending offset rows that are not needed — Pending = -Output is calculated dynamically.
  const deletedMaster = await db.masterData.deleteMany({
    where: { shippingStatus: { startsWith: "3" } },
  });
  console.log(`\nDeleted ${deletedMaster.count} MasterData Pending rows`);

  // Delete EntryData rows where shippingStatus = "3.Pending"
  const deletedEntry = await db.entryData.deleteMany({
    where: { shippingStatus: "3.Pending" },
  });
  console.log(`Deleted ${deletedEntry.count} EntryData Pending rows`);

  // Count after.
  const totalMasterAfter = await db.masterData.count();
  const totalEntryAfter = await db.entryData.count();
  console.log("\n=== AFTER CLEANUP ===");
  console.log(`Total MasterData: ${totalMasterAfter} (was ${totalMasterBefore}, removed ${totalMasterBefore - totalMasterAfter})`);
  console.log(`Total EntryData: ${totalEntryAfter} (was ${totalEntryBefore}, removed ${totalEntryBefore - totalEntryAfter})`);

  // Rebuild MasterGroup index (without pending rows).
  console.log("\nRebuilding MasterGroup index...");
  const { rebuildMasterGroups } = await import("../src/lib/master-service");
  const groups = await rebuildMasterGroups();
  console.log(`Built ${groups} Factory PO groups`);

  console.log("\n✓ Cleanup complete");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
