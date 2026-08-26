import { db } from "../src/lib/db";
async function main() {
  const r = await db.entryData.deleteMany({ where: { factoryPO: "MH26110228", size: "M(14)" } });
  console.log("Deleted test entry:", r.count);
}
main().finally(() => process.exit(0));
