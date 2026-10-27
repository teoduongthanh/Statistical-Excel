import { db } from "../src/lib/db";

async function main() {
  const count = await db.masterData.count({ where: { productType: "MAFATE" } });
  console.log("MAFATE masterData count:", count);
  const sample = await db.masterData.findFirst({ where: { productType: "MAFATE" } });
  console.log("Sample:", JSON.stringify(sample, null, 2).slice(0, 1500));
}
main().catch(e => { console.error(e); process.exit(1); });
