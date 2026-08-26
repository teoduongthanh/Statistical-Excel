import { db } from "../src/lib/db";
async function main() {
  const rows = await db.masterData.findMany({
    where: { productType: "MAFATE" },
    select: { colorCode: true },
    take: 5,
    distinct: ["colorCode"],
  });
  for (const r of rows) {
    const s = r.colorCode || "";
    const match = s.match(/\(([A-Z]+(?:\(W\))?)\)/);
    console.log(`colorCode="${s.slice(0,60)}" → match=${match ? match[1] : "NONE"}`);
  }
}
main().finally(() => process.exit(0));
