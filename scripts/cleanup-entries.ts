import { db } from "../src/lib/db";
async function main() {
  const r = await db.entryData.deleteMany({});
  console.log(`Deleted ${r.count} entries (demo data reset).`);
}
main().finally(() => process.exit(0));
