// Re-import ONYX_FVO production data from FMT shipped out FVO - ONYX.xlsx.
// Memory-efficient: reads DATA sheet in dense mode, accesses cell .v directly.
// Custom header mapping because FVO files use different column names:
//   " PO NO#" → poNo (contains OCF numbers like OCF26060136)
//   "ART"     → factoryPO (contains 3MH numbers like 3MH10325626)
//   "Color Name" → colorCode
//   "COLOR CODE" → colorCode2
//   "TRANSLUCENT" → painting
//   "ETD" (first one) → deadline
import * as XLSX from "xlsx";
import * as fs from "fs";
import { db } from "../src/lib/db";
import { rebuildMasterGroups } from "../src/lib/master-service";

const FILE = "/home/z/my-project/upload/FMT shipped out FVO - ONYX.xlsx";
const PRODUCT_TYPE = "ONYX_FVO";
const SOURCE_FILE_NAME = "FMT shipped out FVO - ONYX.xlsx";

interface RowMap { date?: string; shippingStatus?: string; model?: string; sku?: string; poNo?: string; factoryPO?: string; item?: string; season?: string; colorCode?: string; colorCode2?: string; painting?: string; printingColor?: string; size?: string; qty1?: string; qty2?: string; deadline?: string; }

function rowSig(m: RowMap): string {
  return [m.date||"", m.shippingStatus||"", m.poNo||"", m.factoryPO||"", m.size||"", m.model||"", m.sku||"", m.item||"", m.season||"", m.colorCode||"", m.colorCode2||"", m.painting||"", m.printingColor||"", m.qty1||"", m.qty2||"", m.deadline||""].join("\u0001");
}
function isPending(s: string): boolean { const t = (s||"").trim().toLowerCase(); return t.startsWith("3") || t.includes("pending"); }
function normStatus(s: string | null): string | null { if (!s) return s; const t = s.trim(); if (/^1\./i.test(t)) return "1.Order"; if (/^2\./i.test(t)) return "2.Output"; if (/^4\./i.test(t)) return "4.Input"; return t; }
function cellVal(c: any): string {
  if (c === undefined || c === null) return "";
  if (typeof c === "object") {
    if (c.v !== undefined && c.v !== null) return String(c.v).trim();
    if (c.w !== undefined && c.w !== null) return String(c.w).trim();
    return "";
  }
  return String(c).trim();
}

// Custom mapping: header (lowercased, trimmed) → canonical field.
// FVO file uses different column names than MAFATE/ONYX.
const CUSTOM_MAP: Record<string, string> = {
  "date": "date",
  "shipping status": "shippingStatus",
  "model": "model",
  "po no#": "poNo",      // contains OCF numbers (e.g. OCF26060136)
  "art": "factoryPO",      // contains 3MH numbers (e.g. 3MH10325626)
  "etd": "deadline",       // first ETD column → deadline
  "season": "season",
  "color name": "colorCode",
  "color code": "colorCode2",
  "translucent": "painting",
  "printing color": "printingColor",
  "size": "size",
  "q'ty 1": "qty1",
  "q'ty 2": "qty2",
  "dead line": "deadline",
};

async function main() {
  const t0 = Date.now();
  console.log(`[fvo] Reading ${FILE}`);
  const buf = fs.readFileSync(FILE);
  const wb: any = XLSX.read(buf, { type: "buffer", cellDates: false, dense: true, sheetStubs: false });
  console.log(`[fvo] Sheets (${wb.SheetNames.length}): ${wb.SheetNames.join(", ")}`);

  const sheetName = wb.SheetNames.find((n: string) => n.trim().toUpperCase() === "DATA") || wb.SheetNames[0];
  console.log(`[fvo] Using sheet: "${sheetName}"`);

  for (const n of wb.SheetNames) { if (n !== sheetName) delete wb.Sheets[n]; }
  wb.SheetNames = [sheetName];

  const ws: any = wb.Sheets[sheetName];
  const dataArr: any[][] = ws;
  console.log(`[fvo] Dense data: ${dataArr.length} rows`);

  const headerRow = dataArr[0] || [];
  const headers = headerRow.map((c: any) => cellVal(c));
  console.log(`[fvo] Headers (${headers.length}): ${headers.join(" | ")}`);

  // Build colFields using custom mapping
  const colFields: { col: number; field: string }[] = [];
  const deadlineCol = { col: -1, set: false };
  for (let c = 0; c < headers.length; c++) {
    const h = headers[c];
    const field = CUSTOM_MAP[h.toLowerCase()];
    if (field) {
      // For "deadline", only take the first ETD column (skip subsequent ETD or Dead Line)
      if (field === "deadline") {
        if (!deadlineCol.set) {
          colFields.push({ col: c, field });
          deadlineCol.col = c;
          deadlineCol.set = true;
        }
      } else {
        colFields.push({ col: c, field });
      }
    }
  }
  console.log(`[fvo] Mapped columns (${colFields.length}):`);
  for (const cf of colFields) console.log(`  col[${cf.col}] "${headers[cf.col]}" -> ${cf.field}`);

  let pending = 0, invalid = 0, duplicates = 0;
  const seen = new Set<string>();
  const uniqueRows: { m: RowMap; rowIndex: number }[] = [];

  for (let i = 1; i < dataArr.length; i++) {
    const row = dataArr[i];
    if (!row) continue;
    let anyNonEmpty = false;
    const m: RowMap = {};
    for (const { col, field } of colFields) {
      const v = cellVal(row[col]);
      if (v !== "") anyNonEmpty = true;
      (m as any)[field] = v;
    }
    if (!anyNonEmpty) continue;

    if (isPending(m.shippingStatus || "")) { pending++; continue; }
    if (!m.factoryPO || !m.size) { invalid++; continue; }
    const sig = rowSig(m);
    if (seen.has(sig)) { duplicates++; continue; }
    seen.add(sig);
    m.shippingStatus = normStatus(m.shippingStatus || null) || m.shippingStatus;
    uniqueRows.push({ m, rowIndex: i + 1 });
  }
  console.log(`[fvo] Pending: ${pending}, Invalid: ${invalid}, Duplicates: ${duplicates}`);
  console.log(`[fvo] Valid unique rows: ${uniqueRows.length}`);

  // Free sheet data
  (ws as any).length = 0;
  delete wb.Sheets[sheetName];

  const before = await db.masterData.count({ where: { productType: PRODUCT_TYPE } });
  console.log(`[fvo] Existing ONYX_FVO: ${before}, deleting...`);
  const del = await db.masterData.deleteMany({ where: { productType: PRODUCT_TYPE } });
  console.log(`[fvo] Deleted: ${del.count}`);

  const BATCH = 2000, CONC = 5;
  let inserted = 0;
  for (let i = 0; i < uniqueRows.length; i += BATCH * CONC) {
    const batches: typeof uniqueRows[] = [];
    for (let j = 0; j < CONC && i + j * BATCH < uniqueRows.length; j++) {
      batches.push(uniqueRows.slice(i + j * BATCH, i + (j + 1) * BATCH));
    }
    const baseOffsets = batches.map((_, bi) => i + bi * BATCH);
    await Promise.all(batches.map((batch, bi) =>
      db.masterData.createMany({
        data: batch.map((item, idx) => {
          const m = item.m;
          return {
            date: m.date ?? null, shippingStatus: m.shippingStatus ?? null,
            model: m.model ?? null, sku: m.sku ?? null, poNo: m.poNo ?? null,
            factoryPO: m.factoryPO ?? null, item: m.item ?? null, season: m.season ?? null,
            colorCode: m.colorCode ?? null, colorCode2: m.colorCode2 ?? null,
            painting: m.painting ?? null, printingColor: m.printingColor ?? null,
            size: m.size ?? null,
            qty1: m.qty1 && m.qty1 !== "" ? parseInt(String(m.qty1), 10) || 0 : null,
            qty2: m.qty2 && m.qty2 !== "" ? parseInt(String(m.qty2), 10) || 0 : null,
            deadline: m.deadline ?? null,
            productType: PRODUCT_TYPE, sourceFile: SOURCE_FILE_NAME,
            sheetName, rowIndex: baseOffsets[bi] + idx + 2,
          };
        }),
      }).then((r: any) => { inserted += r.count || batch.length; })
    ));
    console.log(`[fvo] Progress: ${Math.min(i + BATCH * CONC, uniqueRows.length)}/${uniqueRows.length}`);
  }
  console.log(`[fvo] Inserted: ${inserted}`);

  console.log(`[fvo] Rebuilding MasterGroups...`);
  const groups = await rebuildMasterGroups(undefined, PRODUCT_TYPE);
  console.log(`[fvo] MasterGroups: ${groups}`);

  await db.importHistory.create({
    data: {
      fileName: SOURCE_FILE_NAME, sheetName, productType: PRODUCT_TYPE,
      totalRows: uniqueRows.length + pending + invalid + duplicates,
      validRows: uniqueRows.length, invalidRows: pending + invalid + duplicates,
      errors: JSON.stringify({ pendingSkipped: pending, invalidSkipped: invalid, duplicatesSkipped: duplicates }),
    },
  });

  const after = await db.masterData.count({ where: { productType: PRODUCT_TYPE } });
  const gc = await db.masterGroup.count({ where: { productType: PRODUCT_TYPE } });
  console.log(`\n[fvo] === RESULT ===`);
  console.log(`  ONYX_FVO rows: ${after}`);
  console.log(`  MasterGroups: ${gc}`);
  console.log(`  elapsed: ${((Date.now() - t0)/1000).toFixed(1)}s`);
  await db.$disconnect();
}
main().catch(async (e) => { console.error("[fvo] FATAL:", e); await db.$disconnect(); process.exit(1); });
