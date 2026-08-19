import { db } from "../src/lib/db";
async function main() {
  const sample = await db.masterData.findMany({ take: 3, orderBy: { factoryPO: "asc" }, select: { factoryPO: true, poNo: true, model: true, sku: true, size: true } });
  console.log("Sample masterData rows:", JSON.stringify(sample, null, 2));
  const all = await db.masterGroup.findMany({ select: { factoryPO: true }, take: 600 });
  const mh = all.filter(g => g.factoryPO.startsWith("MH")).length;
  const h4 = all.filter(g => g.factoryPO.startsWith("H4")).length;
  const other = all.length - mh - h4;
  console.log(`MH: ${mh}, H4: ${h4}, other: ${other}, total: ${all.length}`);
  const others = all.filter(g => !g.factoryPO.startsWith("MH") && !g.factoryPO.startsWith("H4")).slice(0,10).map(g=>g.factoryPO);
  console.log("Other factoryPO values:", others);
}
main().finally(() => process.exit(0));
