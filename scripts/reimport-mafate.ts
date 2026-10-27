// Re-import MAFATE production data from /home/z/my-project/upload/Data-mafate.xlsx.
// Steps:
//   1. Parse Excel (first sheet — handles both "DATA" and "Sheet1")
//   2. Auto-map headers via buildAutoMapping
//   3. Skip pending (status starts with "3"), invalid (no factoryPO/size), duplicates
//   4. Delete ALL existing MAFATE masterData
//   5. Insert new rows in batches (2000, concurrency 5)
//   6. Rebuild MasterGroup aggregates for MAFATE
//   7. Log to ImportHistory
import * as XLSX from "xlsx";
import * as fs from "fs";
import { db } from "../src/lib/db";
import { applyMapping } from "../src/lib/excel";
import { buildAutoMapping } from "../src/lib/header-normalize";
import { rebuildMasterGroups } from "../src/lib/master-service";

const FILE = "/home/z/my-project/upload/Data-mafate.xlsx";
const PRODUCT_TYPE = "MAFATE";

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

function normalizeStatus(s: string | null): string | null {
  if (!s) return s;
  const t = s.trim();
  if (/^1\./i.test(t)) return "1.Order";
  if (/^2\./i.test(t)) return "2.Output";
  if (/^4\./i.test(t)) return "4.Input";
  return t;
}

async function main() {
  const t0 = Date.now();
  console.log(`[reimport-mafate] Reading ${FILE}`);
  const buf = fs.readFileSync(FILE);
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false, dense: true, sheetStubs: false });
  console.log(`[reimport-mafate] Sheets: ${wb.SheetNames.join(", ")}`);

  // Use the first sheet (file has "Sheet1", not "DATA").
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet ${sheetName} not readable`);

  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "", blankrows: false }) as unknown[][];
  if (raw.length === 0) throw new Error("Sheet is empty");

  const headerRow = raw[0] as unknown[];
  const headers = headerRow.map((h, i) => {
    const s = String(h ?? "").trim();
    return s || `Column_${i + 1}`;
  });
  console.log(`[reimport-mafate] Headers (${headers.length}): ${headers.join(" | ")}`);

  const mapping = buildAutoMapping(headers);
  console.log(`[reimport-mafate] Auto-mapping:`);
  for (const [h, f] of Object.entries(mapping)) {
    if (f) console.log(`  ${h}  ->  ${f}`);
  }

  // Build row objects.
  const unmappedRows: Record<string, string>[] = [];
  for (let i = 1; i < raw.length; i++) {
    const arr = raw[i] as unknown[];
    if (!arr || arr.every((c) => c === "" || c === null || c === undefined)) continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const v = arr[c];
      obj[headers[c]] = v === undefined || v === null ? "" : String(v).trim();
    }
    unmappedRows.push(obj);
  }
  console.log(`[reimport-mafate] Parsed rows: ${unmappedRows.length}`);

  const mappedRows = applyMapping(unmappedRows, mapping);

  let pending = 0, invalid = 0, duplicates = 0;
  const seen = new Set<string>();
  const uniqueRows: { m: Record<string, string>; sourceFile: string; productType: string }[] = [];

  for (const m of mappedRows) {
    if (isPendingStatus(m.shippingStatus || "")) { pending++; continue; }
    if (!m.factoryPO || !m.size) { invalid++; continue; }
    const sig = rowSignature(m);
    if (seen.has(sig)) { duplicates++; continue; }
    seen.add(sig);
    m.shippingStatus = normalizeStatus(m.shippingStatus || null) || m.shippingStatus;
    uniqueRows.push({ m, sourceFile: "Data-mafate.xlsx", productType: PRODUCT_TYPE });
  }

  console.log(`[reimport-mafate] Pending skipped: ${pending}`);
  console.log(`[reimport-mafate] Invalid skipped (no factoryPO/size): ${invalid}`);
  console.log(`[reimport-mafate] Duplicates skipped: ${duplicates}`);
  console.log(`[reimport-mafate] Valid unique rows to import: ${uniqueRows.length}`);

  // Step: Delete existing MAFATE data.
  const beforeCount = await db.masterData.count({ where: { productType: PRODUCT_TYPE } });
  console.log(`[reimport-mafate] Existing MAFATE rows: ${beforeCount}`);
  console.log(`[reimport-mafate] Deleting existing MAFATE masterData...`);
  const del = await db.masterData.deleteMany({ where: { productType: PRODUCT_TYPE } });
  console.log(`[reimport-mafate] Deleted: ${del.count}`);

  // Step: Insert in batches of 2000, concurrency 5.
  const BATCH = 2000;
  const CONCURRENCY = 5;
  let insertedTotal = 0;
  for (let i = 0; i < uniqueRows.length; i += BATCH * CONCURRENCY) {
    const batches: typeof uniqueRows[] = [];
    for (let j = 0; j < CONCURRENCY && i + j * BATCH < uniqueRows.length; j++) {
      batches.push(uniqueRows.slice(i + j * BATCH, i + (j + 1) * BATCH));
    }
    const batchBaseOffsets = batches.map((_, bi) => i + bi * BATCH);
    await Promise.all(
      batches.map((batch, bi) =>
        db.masterData.createMany({
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
              sheetName: sheetName,
              rowIndex: batchBaseOffsets[bi] + idx + 2,
            };
          }),
        }).then((r: any) => { insertedTotal += r.count || batch.length; })
      )
    );
    console.log(`[reimport-mafate] Progress: ${Math.min(i + BATCH * CONCURRENCY, uniqueRows.length)}/${uniqueRows.length} rows`);
  }
  console.log(`[reimport-mafate] Inserted total: ${insertedTotal}`);

  // Step: Rebuild MasterGroup aggregates for MAFATE only.
  console.log(`[reimport-mafate] Rebuilding MasterGroups for MAFATE...`);
  const groups = await rebuildMasterGroups(undefined, PRODUCT_TYPE);
  console.log(`[reimport-mafate] MasterGroups rebuilt: ${groups}`);

  // Step: ImportHistory log.
  await db.importHistory.create({
    data: {
      fileName: "Data-mafate.xlsx",
      sheetName,
      productType: PRODUCT_TYPE,
      totalRows: mappedRows.length,
      validRows: uniqueRows.length,
      invalidRows: pending + invalid + duplicates,
      errors: JSON.stringify({ pendingSkipped: pending, invalidSkipped: invalid, duplicatesSkipped: duplicates }),
    },
  });

  // Final verification.
  const afterCount = await db.masterData.count({ where: { productType: PRODUCT_TYPE } });
  const groupCount = await db.masterGroup.count({ where: { productType: PRODUCT_TYPE } });
  const pendingCount = await db.masterData.count({ where: { productType: PRODUCT_TYPE, shippingStatus: { startsWith: "3" } } });

  console.log(`\n[reimport-mafate] === RESULT ===`);
  console.log(`  masterData MAFATE rows: ${afterCount}`);
  console.log(`  masterGroup MAFATE: ${groupCount}`);
  console.log(`  pending (status 3.*): ${pendingCount}`);
  console.log(`  elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("[reimport-mafate] FATAL:", e);
  await db.$disconnect();
  process.exit(1);
});
