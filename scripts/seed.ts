// Seed script: imports MAFATE, ONYX, MIZUNO data into MasterData + rebuilds MasterGroup index.
import { db } from "../src/lib/db";
import { readWorkbook, parseSheet, applyMapping } from "../src/lib/excel";
import { buildAutoMapping } from "../src/lib/header-normalize";
import { rebuildMasterGroups } from "../src/lib/master-service";
import * as fs from "fs";

const FILES: { path: string; sheet: string; productType: string }[] = [
  {
    path: "/home/z/my-project/upload/data-mafate.xlsx",
    sheet: "data-mafate",
    productType: "MAFATE",
  },
  {
    path: "/home/z/my-project/upload/Data onyx.xlsx",
    sheet: "Sheet1",
    productType: "ONYX",
  },
  {
    path: "/home/z/my-project/upload/Data Hoongwon(HW).xlsx",
    sheet: "Sheet1",
    productType: "MIZUNO",
  },
];

async function importFile(fileInfo: { path: string; sheet: string; productType: string }) {
  console.log(`\n=== Importing ${fileInfo.productType}: ${fileInfo.path} ===`);
  const buf = fs.readFileSync(fileInfo.path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const { wb, sheets } = readWorkbook(ab);
  console.log("Sheets:", sheets.map((s) => s.name).join(", "));
  const { headers, rows } = parseSheet(wb, fileInfo.sheet);
  console.log("Headers:", headers.slice(0, 20).join(" | "));
  console.log("Parsed rows:", rows.length);

  const mapping = buildAutoMapping(headers);
  console.log("Auto mapping:", JSON.stringify(mapping, null, 2));
  const mapped = applyMapping(rows, mapping);

  const fileName = fileInfo.path.split("/").pop()!;
  await db.masterData.deleteMany({ where: { sourceFile: fileName } });

  const valid = mapped.filter((m) => m.factoryPO && m.size);
  console.log(`Valid rows: ${valid.length} / ${mapped.length}`);

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
        qty1: m.qty1 !== undefined && m.qty1 !== "" && m.qty1 !== null ? parseInt(String(m.qty1), 10) || 0 : null,
        qty2: m.qty2 !== undefined && m.qty2 !== "" && m.qty2 !== null ? parseInt(String(m.qty2), 10) || 0 : null,
        deadline: m.deadline ?? null,
        productType: fileInfo.productType,
        sourceFile: fileName,
        sheetName: fileInfo.sheet,
        rowIndex: i + 2,
      })),
    });
    inserted += batch.length;
    if (inserted % 5000 === 0 || inserted === valid.length) {
      console.log(`  inserted ${inserted}/${valid.length}`);
    }
  }

  await db.importHistory.create({
    data: {
      fileName,
      sheetName: fileInfo.sheet,
      productType: fileInfo.productType,
      totalRows: mapped.length,
      validRows: valid.length,
      invalidRows: mapped.length - valid.length,
      errors: "[]",
    },
  });

  console.log(`✓ ${fileInfo.productType}: ${inserted} rows imported`);
  return inserted;
}

async function main() {
  let totalInserted = 0;
  for (const f of FILES) {
    totalInserted += await importFile(f);
  }

  console.log("\n=== Rebuilding MasterGroup index (product-scoped) ===");
  const groups = await rebuildMasterGroups();
  console.log("Built", groups, "Factory PO groups");

  // Verify color code mapping per product.
  console.log("\n=== Verification: color code mapping per product ===");
  for (const pt of ["MAFATE", "ONYX", "MIZUNO"]) {
    const sample = await db.masterGroup.findMany({
      where: { productType: pt },
      take: 2,
      orderBy: { factoryPO: "asc" },
    });
    for (const g of sample) {
      console.log(`  ${pt} | ${g.factoryPO}:`);
      console.log(`    colorCode: ${g.colorCode?.slice(0, 60) ?? "—"}`);
      console.log(`    colorCode2: ${g.colorCode2?.slice(0, 60) ?? "—"}`);
      console.log(`    nearestDeadline: ${g.nearestDeadline ?? "—"}`);
    }
  }

  console.log(`\n✓ Seed complete: ${totalInserted} total rows, ${groups} Factory PO groups`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
