// Seed script: imports the uploaded demo Excel into MasterData + rebuilds MasterGroup index.
import { db } from "../src/lib/db";
import { readWorkbook, parseSheet, applyMapping } from "../src/lib/excel";
import { buildAutoMapping } from "../src/lib/header-normalize";
import { rebuildMasterGroups } from "../src/lib/master-service";

const FILE = "/home/z/my-project/upload/Copy of FMT shipped out S-TECH mafate -2026 (1).xlsx";
const SHEET = "DATA";

async function main() {
  console.log("Reading", FILE);
  const fs = await import("fs");
  const buf = fs.readFileSync(FILE);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const { wb, sheets } = readWorkbook(ab);
  console.log("Sheets:", sheets.map((s) => s.name).join(", "));
  const { headers, rows } = parseSheet(wb, SHEET);
  console.log("Headers:", headers.join(" | "));
  console.log("Parsed rows:", rows.length);

  const mapping = buildAutoMapping(headers);
  console.log("Auto mapping:", JSON.stringify(mapping, null, 2));

  const mapped = applyMapping(rows, mapping);

  await db.masterData.deleteMany({ where: { sourceFile: FILE } });
  console.log("Cleared existing demo rows.");

  const valid = mapped.filter((m) => m.factoryPO && m.size);
  console.log("Valid rows:", valid.length, "/", mapped.length);

  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < valid.length; i += BATCH) {
    const batch = valid.slice(i, i + BATCH);
    await db.masterData.createMany({
      data: batch.map((m) => ({
        date: m.date ?? null,
        shippingStatus: m.shippingStatus ?? null,
        model: m.model ?? null,
        sku: m.sku ?? null,
        poNo: m.poNo ?? null,
        factoryPO: m.factoryPO ?? null,
        item: m.item ?? null,
        season: m.season ?? null,
        colorCode: m.colorCode ?? null,
        colorCode2: m.colorCode2 ?? null,
        painting: m.painting ?? null,
        printingColor: m.printingColor ?? null,
        size: m.size ?? null,
        qty1: m.qty1 ?? null,
        qty2: m.qty2 ?? null,
        deadline: m.deadline ?? null,
        sourceFile: FILE,
        sheetName: SHEET,
        rowIndex: i + 2,
      })),
    });
    inserted += batch.length;
    if (inserted % 5000 === 0 || inserted === valid.length) {
      console.log(`  inserted ${inserted}/${valid.length}`);
    }
  }

  console.log("Rebuilding MasterGroup index...");
  const groups = await rebuildMasterGroups(FILE);
  console.log("Built", groups, "Factory PO groups");

  await db.importHistory.create({
    data: {
      fileName: FILE.split("/").pop()!,
      sheetName: SHEET,
      totalRows: mapped.length,
      validRows: valid.length,
      invalidRows: mapped.length - valid.length,
      errors: "[]",
    },
  });

  console.log("Seed complete. Sample groups:");
  const sample = await db.masterGroup.findMany({ take: 5, orderBy: { factoryPO: "asc" } });
  for (const g of sample) {
    console.log(`  ${g.factoryPO}: model=${g.model}, sku=${g.sku}, season=${g.season}, sizes=${g.sizes.slice(0, 120)}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
