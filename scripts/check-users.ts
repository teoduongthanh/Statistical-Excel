import { db } from "../src/lib/db";
async function main() {
  const count = await db.user.count();
  console.log("Users in DB:", count);
  const recent = await db.entryData.count();
  console.log("Entries:", recent);
}
main().finally(() => process.exit(0));
