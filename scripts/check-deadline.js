import { db } from "../src/lib/db";
async function main() {
  const rows = await db.masterData.findMany({
    where: { productType: "MAFATE", deadline: { not: null } },
    select: { deadline: true },
    take: 10,
    distinct: ["deadline"],
  });
  console.log("Sample deadline values in DB:");
  for (const r of rows) {
    console.log(`  "${r.deadline}"`);
  }
}
main().finally(() => process.exit(0));
