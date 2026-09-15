// Memory-efficient MAFATE import script.
// - Reads each Excel file one at a time.
// - Uses XLSX dense mode + deletes non-DATA sheets immediately to minimize RAM.
// - SKIPS 3.Pending rows (Pending = -Output, calculated dynamically).
// - DEDUPLICATES across files by full row signature.
// - REPLACES existing MAFATE data.
// - Rebuilds MasterGroup index after import.
import { db } from "../src/lib/db";
import { applyMapping } from "../src/lib/excel";
import { buildAutoMapping } from "../src/lib/header-normalize";
import { rebuildMasterGroups } from "../src/lib/master-service";
import * as XLSX from "xlsx";
import * as fs from "fs";

const FILES: { path: string; productType: string }[] = [
  {
    path: "/home/z/my-project/upload/Copy of FMT shipped out S-TECH mafate -2026.xlsx",
    productType: "MAFATE",
  },
  {
    path: "/home/z/my-project/upload/FMT shipped out S-TECH mafate -2026.xlsx",
    productType: "MAFATE",
  },
];

function rowSignature(m: Record<string, string>): string {
  return [
    m.date || "",
    m.shippingStatus || "",
    m.poNo || "",
    m.factoryPO || "",
    m.size || "",
    m.model || "",
    m.sku || "",
    m.item || "",
    m.season || "",
    m.colorCode || "",
    m.colorCode2 || "",
    m.painting || "",
    m.printingColor || "",
    m.qty1 || "",
    m.qty2 || "",
    m.deadline || "",
  ].join("\u0001");
}

function isPendingStatus(status: string): boolean {
  const s = (status || "").trim().toLowerCase();
  return s.startsWith("3") || s.includes("pending");
}

// Parse a single Excel file's DATA sheet into mapped row objects.
// Memory-efficient: reads with dense mode, deletes non-DATA sheets immediately.
function parseDataSheet(filePath: string): { rows: Record<string, string>[]; fileName: string } {
  const fileName = filePath.split("/").pop()!;
  console.log(`  Reading file: ${fileName}`);
  const buf = fs.readFileSync(filePath);
  console.log(`  File size: ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

  // Read with dense mode for memory efficiency.
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false, dense: true, sheetStubs: false });
  console.log(`  Sheets in workbook: ${wb.SheetNames.length}`);

  // Delete all non-DATA sheets immediately to free memory.
  for (const name of wb.SheetNames) {
    if (name !== "DATA") {
      delete wb.Sheets[name];
    }
  }
  wb.SheetNames = wb.SheetNames.filter((n) => n === "DATA");

  const ws = wb.Sheets["DATA"];
  if (!ws) {
    throw new Error(`DATA sheet not found in ${fileName}. Available: ${Object.keys(wb.Sheets).join(", ")}`);
  }
  const ref = ws["!ref"] as string;
  const range = XLSX.utils.decode_range(ref);
  console.log(`  DATA sheet: ${range.e.r} rows, ${range.e.c + 1} cols`);

  // Convert to rows (array of arrays, then to objects keyed by header name).
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  });

  // Free the workbook/sheet now that we have the raw rows.
  delete wb.Sheets["DATA"];
  wb.SheetNames = [];

  if (raw.length === 0) {
    return { rows: [], fileName };
  }

  const headerRow = raw[0] as unknown[];
  const headers = headerRow.map((h, i) => {
    const s = String(h ?? "").trim();
    return s || `Column_${i + 1}`;
  });

  // Build auto-mapping: { [excelHeader]: canonicalField }.
  const mapping = buildAutoMapping(headers);
  console.log(`  Auto mapping (first 6): ${JSON.stringify(Object.fromEntries(Object.entries(mapping).slice(0, 6)))}`);

  // Convert raw rows to objects keyed by Excel header name.
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

  // Apply canonical field mapping.
  const mappedRows = applyMapping(unmappedRows, mapping);

  console.log(`  Parsed ${mappedRows.length} mapped rows`);
  return { rows: mappedRows, fileName };
}

async function main() {
  console.log("=== MAFATE Import (skip Pending + dedup across files) ===\n");

  // Collect unique rows from all files.
  const seen = new Set<string>();
  const uniqueRows: { m: Record<string, string>; sourceFile: string; productType: string }[] = [];
  let totalParsed = 0;
  let totalPending = 0;
  let totalInvalid = 0;
  let totalDuplicates = 0;

  for (const fileInfo of FILES) {
    console.log(`\n--- Processing file ${FILES.indexOf(fileInfo) + 1}/${FILES.length} ---`);
    const { rows, fileName } = parseDataSheet(fileInfo.path);
    totalParsed += rows.length;

    let filePending = 0;
    let fileInvalid = 0;
    let fileDupes = 0;
    let fileAdded = 0;

    for (const m of rows) {
      // Skip Pending rows.
      if (isPendingStatus(m.shippingStatus || "")) {
        filePending++;
        continue;
      }
      // Skip rows without required fields.
      if (!m.factoryPO || !m.size) {
        fileInvalid++;
        continue;
      }
      // Deduplicate across files.
      const sig = rowSignature(m);
      if (seen.has(sig)) {
        fileDupes++;
        continue;
      }
      seen.add(sig);
      uniqueRows.push({ m, sourceFile: fileName, productType: fileInfo.productType });
      fileAdded++;
    }

    totalPending += filePending;
    totalInvalid += fileInvalid;
    totalDuplicates += fileDupes;
    console.log(`  Pending skipped: ${filePending}`);
    console.log(`  Invalid (no factoryPO/size): ${fileInvalid}`);
    console.log(`  Duplicates (already seen): ${fileDupes}`);
    console.log(`  Unique rows added from this file: ${fileAdded}`);

    // Run GC to free memory between files.
    if (global.gc) {
      global.gc();
    }
  }

  console.log("\n=== Summary (both files combined) ===");
  console.log(`  Total parsed rows: ${totalParsed}`);
  console.log(`  Pending skipped: ${totalPending}`);
  console.log(`  Invalid rows: ${totalInvalid}`);
  console.log(`  Cross-file duplicates skipped: ${totalDuplicates}`);
  console.log(`  Unique rows to insert: ${uniqueRows.length}`);

  // Clear existing MAFATE data.
  console.log("\n=== Clearing existing MAFATE data ===");
  const deleted = await db.masterData.deleteMany({ where: { productType: "MAFATE" } });
  console.log(`  Deleted ${deleted.count} existing MAFATE rows`);

  // Insert unique rows in batches.
  console.log("\n=== Inserting unique rows ===");
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
      console.log(`  inserted ${inserted}/${uniqueRows.length}`);
    }
  }

  // Record import history.
  for (const fileInfo of FILES) {
    const fileName = fileInfo.path.split("/").pop()!;
    await db.importHistory.create({
      data: {
        fileName,
        sheetName: "DATA",
        productType: fileInfo.productType,
        totalRows: 0,
        validRows: 0,
        invalidRows: 0,
        errors: JSON.stringify({ note: "Bulk import via import-mafate.ts (pending skipped, dedup)", pendingSkipped: true }),
      },
    });
  }

  // Rebuild MasterGroup index (scoped to MAFATE).
  // NOTE: rebuildMasterGroups(sourceFile?, productType?) — pass undefined for
  // sourceFile and "MAFATE" for productType to scope the rebuild correctly.
  console.log("\n=== Rebuilding MasterGroup index (MAFATE) ===");
  const groups = await rebuildMasterGroups(undefined, "MAFATE");
  console.log(`  Built ${groups} Factory PO groups for MAFATE`);

  // Verify.
  console.log("\n=== Verification ===");
  const finalCount = await db.masterData.count({ where: { productType: "MAFATE" } });
  console.log(`  Final MAFATE row count: ${finalCount}`);

  // Status breakdown — use raw SQL for compatibility with all Prisma versions.
  const statusRows = await db.$queryRaw<{ shippingStatus: string; cnt: number }[]>(
    `SELECT shippingStatus, COUNT(*) as cnt FROM MasterData WHERE productType = 'MAFATE' GROUP BY shippingStatus ORDER BY cnt DESC`
  );
  console.log("  Status breakdown:");
  for (const s of statusRows) {
    console.log(`    ${s.shippingStatus}: ${s.cnt}`);
  }
  const pendingCount = await db.masterData.count({
    where: { productType: "MAFATE", shippingStatus: { startsWith: "3" } },
  });
  console.log(`  Pending rows in DB: ${pendingCount} (should be 0)`);

  console.log(`\n✓ Import complete: ${inserted} unique MAFATE rows, ${groups} Factory PO groups`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
