import { db } from "../src/lib/db";
async function main() {
  const audits = await db.masterDataAudit.findMany({ take: 3, orderBy: { changedAt: "desc" } });
  console.log("Recent audits:", JSON.stringify(audits, null, 2));
  const edited = await db.masterData.findFirst({ where: { isEdited: true }, select: { factoryPO: true, season: true, isEdited: true, editedBy: true, editedAt: true } });
  console.log("Edited row:", JSON.stringify(edited));
}
main().finally(() => process.exit(0));
