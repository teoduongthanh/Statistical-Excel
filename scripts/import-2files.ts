// Import script: imports MAFATE + ONYX data from two Excel files into MasterData.
// - SKIPS 3.Pending rows (Pending = -Output, calculated dynamically, never stored).
// - DEDUPLICATES within each file by full row signature.
// - REPLACES existing data per productType before inserting.
// - Rebuilds MasterGroup index after import so dashboards reflect new data.
import { db } from "../src/lib/db";
import { applyMapping } from "../src/lib/excel";
import { buildAutoMapping } from "../src/lib/header-normalize";
import { rebuildMasterGroups } from "../src/lib/master-service";
import * as XLSX from "xlsx";
import * as fs from "fs";

const FILES: { path: string; productType: string }[] = [
  {
    path: "/home/z/my-project/upload/FMT shipped out S-TECH mafate -2026 (1).xlsx",
    productType: "MAFATE",
  },
  {
    path: "/home/z/my-project/upload/FMT shipped out S-TECH Onyx-2026.xlsx",
    productType: "ONYX",
  },
];

function rowSignature(m: Record<string, string>): string {
  return [
    m.date || "", m.shippingStatus || "", m.poNo || "", m.factoryPO || "",
    m.size || "", m.model || "", m.sku || "", m.item || "", m.season || "",
    m.colorCode || "", m.colorCode2 || "", m.painting || "", m.printingColor || "",
    m.qty1 || "", m.qty2 || "", m.deadline || "",
  ].join("\u0001");
}

function isPendingStatus(status: string): boolean {
  const s = (status || "").trim().toLowerCase();
  return s.startsWith("3") || s.includes("pending");
}

// Parse a single Excel file's DATA sheet into mapped row objects.
function parseDataSheet(filePath: string): { rows: Record<string, string>[]; fileName: string } {
  const fileName = filePath.split("/").pop()!;
  console.log(`  Reading file: ${fileName}`);
  const buf = fs.readFileSync(filePath);
  console.log(`  File size: ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

  const wb = XLSX.read(buf, { type: "buffer", cellDates: false, dense: true, sheetStubs: false });
  console.log(`  Sheets: ${wb.SheetNames.length}`);

  // Delete all non-DATA sheets immediately to free memory.
  for (const name of wb.SheetNames) {
    if (name !== "DATA") delete wb.Sheets[name];
  }
  wb.SheetNames = wb.SheetNames.filter((n) => n === "DATA");

  const ws = wb.Sheets["DATA"];
  if (!ws) {
    throw new Error(`DATA sheet not found in ${fileName}. Available: ${Object.keys(wb.Sheets).join(", ")}`);
  }
  const ref = ws["!ref"] as string;
  const range = XLSX.utils.decode_range(ref);
  console.log(`  DATA sheet: ${range.e.r} rows, ${range.e.c + 1} cols`);

  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1, raw: true, defval: "", blankrows: false,
  });

  delete wb.Sheets["DATA"];
  wb.SheetNames = [];

  if (raw.length === 0) return { rows: [], fileName };

  const headerRow = raw[0] as unknown[];
  const headers = headerRow.map((h, i) => {
    const s = String(h ?? "").trim();
    return s || `Column_${i + 1}`;
  });

  const mapping = buildAutoMapping(headers);
  console.log(`  Auto mapping (first 8): ${JSON.stringify(Object.fromEntries(Object.entries(mapping).slice(0, 8)))}`);

  const unmappedRows: Record<string, string>[] = [];
  for (let i = 1; i < raw.length; i++) {
    const arr = raw[i] as unknown[];
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const v = arr[c];
      obj[headers[c]] = v === undefined || v === null ? "" : String(v).trim();
    }
    unmappedRows.push(obj);
  }

  const mappedRows = applyMapping(unmappedRows, mapping);
  console.log(`  Parsed ${mappedRows.length} mapped rows`);
  return { rows: mappedRows, fileName };
}

async function main() {
  console.log("=== Import (skip Pending + dedup) ===\n");

  // Process each file separately, clearing that product's data first.
  let totalInserted = 0;
  const productGroupsMap: Record<string, number> = {};

  for (const fileInfo of FILES) {
    console.log(`\n--- Processing: ${fileInfo.productType} ---`);
    const { rows, fileName } = parseDataSheet(fileInfo.path);

    let pending = 0, invalid = 0, duplicates = 0;
    const seen = new Set<string>();
    const uniqueRows: { m: Record<string, string>; sourceFile: string; productType: string }[] = [];

    for (const m of rows) {
      if (isPendingStatus(m.shippingStatus || "")) { pending++; continue; }
      if (!m.factoryPO || !m.size) { invalid++; continue; }
      const sig = rowSignature(m);
      if (seen.has(sig)) { duplicates++; continue; }
      seen.add(sig);
      uniqueRows.push({ m, sourceFile: fileName, productType: fileInfo.productType });
    }

    console.log(`  Pending skipped: ${pending}`);
    console.log(`  Invalid (no factoryPO/size): ${invalid}`);
    console.log(`  Within-file duplicates skipped: ${duplicates}`);
    console.log(`  Unique rows to insert: ${uniqueRows.length}`);

    // Clear existing data for this productType.
    const deleted = await db.masterData.deleteMany({ where: { productType: fileInfo.productType } });
    console.log(`  Deleted ${deleted.count} existing ${fileInfo.productType} rows`);

    // Insert in batches.
    const BATCH = 500;
    let inserted = 0;
    for (let i = 0; i < uniqueRows.length; i += BATCH) {
      const batch = uniqueRows.slice(i, i + BATCH);
      await db.masterData.createMany({
        data: batch.map((item, idx) => {
          const m = item.m;
          return {
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
            productType: item.productType,
            sourceFile: item.sourceFile,
            sheetName: "DATA",
            rowIndex: i + idx + 2,
          };
        }),
      });
      inserted += batch.length;
      if (inserted % 5000 === 0 || inserted === uniqueRows.length) {
        console.log(`    inserted ${inserted}/${uniqueRows.length}`);
      }
    }
    totalInserted += inserted;

    // Record import history.
    await db.importHistory.create({
      data: {
        fileName,
        sheetName: "DATA",
        productType: fileInfo.productType,
        totalRows: rows.length,
        validRows: uniqueRows.length,
        invalidRows: pending + invalid + duplicates,
        errors: JSON.stringify({ note: "Import via import-2files.ts (pending skipped, within-file dedup)", pendingSkipped: pending }),
      },
    });

    // Rebuild MasterGroup index for this product.
    const groups = await rebuildMasterGroups(undefined, fileInfo.productType);
    console.log(`  Rebuilt ${groups} Factory PO groups for ${fileInfo.productType}`);
    productGroupsMap[fileInfo.productType] = groups;

    // Free memory between files.
    if (global.gc) global.gc();
  }

  // Final verification.
  console.log("\n=== Verification ===");
  for (const pt of ["MAFATE", "ONYX", "MIZUNO"]) {
    const count = await db.masterData.count({ where: { productType: pt } });
    const pendingCount = await db.masterData.count({
      where: { productType: pt, shippingStatus: { startsWith: "3" } },
    });
    const groupCount = await db.masterGroup.count({ where: { productType: pt } });
    console.log(`  ${pt}: ${count} rows, ${pendingCount} pending (should be 0), ${groupCount} groups`);
  }
  console.log(`\n✓ Import complete: ${totalInserted} total rows imported`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
