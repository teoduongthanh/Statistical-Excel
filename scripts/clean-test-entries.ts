import { db } from "../src/lib/db";
async function main() {
  // Keep only the 2 demo entries: MH26110228 M(13) qty=20 and OCF26060137 M10 qty=50
  const keep = await db.entryData.findMany({
    where: {
      OR: [
        { AND: [{ factoryPO: "MH26110228" }, { size: "M(13)" }, { qty1: "20" }] },
        { AND: [{ factoryPO: "OCF26060137" }, { size: "M10" }, { qty1: "50" }] },
      ],
    },
    select: { id: true, factoryPO: true, size: true, qty1: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  console.log("Keeping entries:");
  for (const k of keep) console.log(`  ${k.factoryPO} ${k.size} q${k.qty1} (${k.createdAt.toISOString()})`);
  // If duplicates exist, keep the newest one of each combination.
  const keepIds = new Set<string>();
  const seen = new Set<string>();
  for (const k of keep) {
    const key = `${k.factoryPO}|${k.size}`;
    if (!seen.has(key)) { seen.add(key); keepIds.add(k.id); }
  }
  const deleted = await db.entryData.deleteMany({
    where: { id: { notIn: [...keepIds] } },
  });
  console.log(`Deleted ${deleted.count} test entries.`);
  const final = await db.entryData.count();
  console.log(`Final entry count: ${final}`);
}
main().finally(() => process.exit(0));
