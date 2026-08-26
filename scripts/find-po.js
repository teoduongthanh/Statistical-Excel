import { db } from "../src/lib/db";
async function main() {
  const rows = await db.$queryRawUnsafe(`SELECT poNo, COUNT(DISTINCT factoryPO) as cnt, GROUP_CONCAT(DISTINCT factoryPO) as fpos FROM MasterData WHERE productType='MAFATE' AND poNo != '' AND poNo IS NOT NULL GROUP BY poNo HAVING cnt BETWEEN 2 AND 6 LIMIT 5`);
  for (const r of rows) {
    console.log(`PO NO#: ${r.poNo} (${r.cnt} Factory POs): ${r.fpos}`);
  }
}
main().finally(() => process.exit(0));
