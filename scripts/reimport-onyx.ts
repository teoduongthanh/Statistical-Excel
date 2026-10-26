// Re-import ONYX production data from the uploaded Excel file.
// Mirrors scripts/reimport-mafate.ts but for ONYX productType.
import * as XLSX from "xlsx";
import * as fs from "fs";
import { db } from "../src/lib/db";
import { applyMapping } from "../src/lib/excel";
import { buildAutoMapping } from "../src/lib/header-normalize";
import { rebuildMasterGroups } from "../src/lib/master-service";

const FILE = "/home/z/my-project/upload/FMT shipped out S-TECH Onyx-2026 10.24.xlsx";
const PRODUCT_TYPE = "ONYX";
const SOURCE_FILE_NAME = "FMT shipped out S-TECH Onyx-2026 10.24.xlsx";

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
  console.log(`[reimport-onyx] Reading ${FILE}`);
  const buf = fs.readFileSync(FILE);
  // IMPORTANT: sheetStubs:true so all sheets are visible (sheetStubs:false hides some).
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false, dense: true, sheetStubs: true });
  console.log(`[reimport-onyx] Sheets (${wb.SheetNames.length}): ${wb.SheetNames.join(", ")}`);

  const dataSheetName = wb.SheetNames.find((n) => n.trim().toUpperCase() === "DATA");
  if (!dataSheetName) throw new Error(`DATA sheet not found. Available: ${wb.SheetNames.join(", ")}`);
  const ws = wb.Sheets[dataSheetName];
  if (!ws) throw new Error(`DATA sheet not readable`);

  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "", blankrows: false }) as unknown[][];
  if (raw.length === 0) throw new Error("DATA sheet is empty");

  const headerRow = raw[0] as unknown[];
  const headers = headerRow.map((h, i) => {
    const s = String(h ?? "").trim();
    return s || `Column_${i + 1}`;
  });
  console.log(`[reimport-onyx] Headers (${headers.length}): ${headers.join(" | ")}`);

  const mapping = buildAutoMapping(headers);
  console.log(`[reimport-onyx] Auto-mapping:`);
  for (const [h, f] of Object.entries(mapping)) {
    if (f) console.log(`  ${h}  ->  ${f}`);
  }

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
  console.log(`[reimport-onyx] Parsed rows: ${unmappedRows.length}`);

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
    uniqueRows.push({ m, sourceFile: SOURCE_FILE_NAME, productType: PRODUCT_TYPE });
  }

  console.log(`[reimport-onyx] Pending skipped: ${pending}`);
  console.log(`[reimport-onyx] Invalid skipped (no factoryPO/size): ${invalid}`);
  console.log(`[reimport-onyx] Duplicates skipped: ${duplicates}`);
  console.log(`[reimport-onyx] Valid unique rows to import: ${uniqueRows.length}`);

  const beforeCount = await db.masterData.count({ where: { productType: PRODUCT_TYPE } });
  console.log(`[reimport-onyx] Existing ONYX rows: ${beforeCount}`);
  console.log(`[reimport-onyx] Deleting existing ONYX masterData...`);
  const del = await db.masterData.deleteMany({ where: { productType: PRODUCT_TYPE } });
  console.log(`[reimport-onyx] Deleted: ${del.count}`);

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
              sheetName: dataSheetName,
              rowIndex: batchBaseOffsets[bi] + idx + 2,
            };
          }),
        }).then((r: any) => { insertedTotal += r.count || batch.length; })
      )
    );
    console.log(`[reimport-onyx] Progress: ${Math.min(i + BATCH * CONCURRENCY, uniqueRows.length)}/${uniqueRows.length} rows`);
  }
  console.log(`[reimport-onyx] Inserted total: ${insertedTotal}`);

  console.log(`[reimport-onyx] Rebuilding MasterGroups for ONYX...`);
  const groups = await rebuildMasterGroups(undefined, PRODUCT_TYPE);
  console.log(`[reimport-onyx] MasterGroups rebuilt: ${groups}`);

  await db.importHistory.create({
    data: {
      fileName: SOURCE_FILE_NAME,
      sheetName: dataSheetName,
      productType: PRODUCT_TYPE,
      totalRows: mappedRows.length,
      validRows: uniqueRows.length,
      invalidRows: pending + invalid + duplicates,
      errors: JSON.stringify({ pendingSkipped: pending, invalidSkipped: invalid, duplicatesSkipped: duplicates }),
    },
  });

  const afterCount = await db.masterData.count({ where: { productType: PRODUCT_TYPE } });
  const groupCount = await db.masterGroup.count({ where: { productType: PRODUCT_TYPE } });
  const pendingCount = await db.masterData.count({ where: { productType: PRODUCT_TYPE, shippingStatus: { startsWith: "3" } } });

  console.log(`\n[reimport-onyx] === RESULT ===`);
  console.log(`  masterData ONYX rows: ${afterCount}`);
  console.log(`  masterGroup ONYX: ${groupCount}`);
  console.log(`  pending (status 3.*): ${pendingCount}`);
  console.log(`  elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("[reimport-onyx] FATAL:", e);
  await db.$disconnect();
  process.exit(1);
});
