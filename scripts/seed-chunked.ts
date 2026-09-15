// Optimized seed script: reads large Excel files in chunks to avoid OOM.
import { db } from "../src/lib/db";
import { buildAutoMapping } from "../src/lib/header-normalize";
import { rebuildMasterGroups } from "../src/lib/master-service";
import * as XLSX from "xlsx";
import * as fs from "fs";

const FILES: { path: string; sheet: string; productType: string }[] = [
  {
    path: "/home/z/my-project/upload/FMT shipped out S-TECH mafate -2026.xlsx",
    sheet: "DATA",
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

  // Read workbook with cellDates for date parsing.
  const wb = XLSX.read(ab, { type: "array", cellDates: true, sheetStubs: false });
  console.log(`Sheets: ${wb.SheetNames.join(", ")}`);

  const ws = wb.Sheets[fileInfo.sheet];
  if (!ws) {
    console.error(`Sheet "${fileInfo.sheet}" not found!`);
    return 0;
  }

  // Get range to know total rows.
  const ref = ws["!ref"];
  const range = ref ? XLSX.utils.decode_range(ref) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  const totalRows = range.e.r - range.s.r;
  console.log(`Total rows in sheet: ${totalRows}`);

  // Read header row only.
  const headerRaw: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1, raw: true, defval: "", range: 0, limit: 1,
  });
  const headerRow = (headerRaw[0] || []) as unknown[];
  const headers = headerRow.map((h, i) => {
    const s = String(h ?? "").trim();
    return s || `Column_${i + 1}`;
  });
  console.log(`Headers: ${headers.slice(0, 16).join(" | ")}`);

  const mapping = buildAutoMapping(headers);
  console.log(`Auto mapping:`, JSON.stringify(mapping, null, 2));

  // Delete existing data for this product.
  await db.masterData.deleteMany({ where: { productType: fileInfo.productType } });
  console.log(`Cleared existing ${fileInfo.productType} rows.`);

  // Read data in batches of 1000 rows.
  const BATCH_READ = 1000;
  const BATCH_WRITE = 500;
  let inserted = 0;
  let valid = 0;
  let invalid = 0;

  for (let startRow = 1; startRow <= totalRows; startRow += BATCH_READ) {
    const endRow = Math.min(startRow + BATCH_READ - 1, totalRows);
    const chunk: unknown[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1, raw: true, defval: "", range: `${startRow}-${endRow}`,
    });

    // Convert to mapped objects.
    const mapped: any[] = [];
    for (const r of chunk) {
      if (!r || r.every((c) => c === "" || c === null || c === undefined)) continue;
      const obj: Record<string, string> = {};
      headers.forEach((h, idx) => {
        let val = r[idx];
        if (val instanceof Date) {
          val = val.toISOString().slice(0, 10);
        } else if (typeof val === "number") {
          val = String(val);
        } else {
          val = String(val ?? "").replace(/\r\n/g, " ").replace(/\n/g, " ").trim();
        }
        obj[h] = String(val);
      });

      // Apply mapping.
      const out: any = {};
      for (const [excelHeader, field] of Object.entries(mapping)) {
        if (!field) continue;
        const v = obj[excelHeader];
        if (v !== undefined && v !== "") out[field] = v.trim();
      }

      if (!out.factoryPO || !out.size) {
        invalid++;
        continue;
      }
      valid++;
      mapped.push(out);
    }

    // Write in DB batches.
    for (let i = 0; i < mapped.length; i += BATCH_WRITE) {
      const batch = mapped.slice(i, i + BATCH_WRITE);
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
          qty1: m.qty1 ? parseInt(String(m.qty1), 10) || 0 : null,
          qty2: m.qty2 ? parseInt(String(m.qty2), 10) || 0 : null,
          deadline: m.deadline ?? null,
          productType: fileInfo.productType,
          sourceFile: fileInfo.path.split("/").pop()!,
          sheetName: fileInfo.sheet,
          rowIndex: startRow + i + 1,
        })),
      });
      inserted += batch.length;
    }

    if (inserted % 5000 < BATCH_WRITE || startRow + BATCH_READ > totalRows) {
      console.log(`  ${fileInfo.productType}: ${inserted}/${valid} rows (read up to row ${endRow})`);
    }
  }

  // Record import history.
  await db.importHistory.create({
    data: {
      fileName: fileInfo.path.split("/").pop()!,
      sheetName: fileInfo.sheet,
      productType: fileInfo.productType,
      totalRows: valid + invalid,
      validRows: valid,
      invalidRows: invalid,
      errors: "[]",
    },
  });

  console.log(`✓ ${fileInfo.productType}: ${inserted} rows imported (${invalid} invalid skipped)`);
  return inserted;
}

async function main() {
  let totalInserted = 0;
  for (const f of FILES) {
    totalInserted += await importFile(f);
  }

  console.log("\n=== Rebuilding MasterGroup index ===");
  const groups = await rebuildMasterGroups();
  console.log(`Built ${groups} Factory PO groups`);
  console.log(`\n✓ Seed complete: ${totalInserted} total rows`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
