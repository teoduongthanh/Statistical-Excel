import { db } from "../src/lib/db";
async function main() {
  await db.user.deleteMany({});
  console.log("All users cleared — demo mode restored.");
}
main().finally(() => process.exit(0));
