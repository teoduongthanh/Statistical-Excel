// Memory-efficient MAFATE re-import.
// Reads only the DATA sheet using raw cell access in dense mode.
// Each cell is {t,v,w,...} — we extract .v directly to avoid sheet_to_json's
// full materialization (which OOM-kills Bun on 3.9GB container).
import * as XLSX from "xlsx";
import * as fs from "fs";
import { db } from "../src/lib/db";
import { buildAutoMapping } from "../src/lib/header-normalize";
import { rebuildMasterGroups } from "../src/lib/master-service";

const FILE = "/home/z/my-project/upload/FMT shipped out S-TECH mafate -2026 04.11.xlsx";
const PRODUCT_TYPE = "MAFATE";
const SOURCE_FILE_NAME = "FMT shipped out S-TECH mafate -2026 04.11.xlsx";

interface RowMap { date?: string; shippingStatus?: string; model?: string; sku?: string; poNo?: string; factoryPO?: string; item?: string; season?: string; colorCode?: string; colorCode2?: string; painting?: string; printingColor?: string; size?: string; qty1?: string; qty2?: string; deadline?: string; }

function rowSig(m: RowMap): string {
  return [m.date||"", m.shippingStatus||"", m.poNo||"", m.factoryPO||"", m.size||"", m.model||"", m.sku||"", m.item||"", m.season||"", m.colorCode||"", m.colorCode2||"", m.painting||"", m.printingColor||"", m.qty1||"", m.qty2||"", m.deadline||""].join("\u0001");
}
function isPending(s: string): boolean { const t = (s||"").trim().toLowerCase(); return t.startsWith("3") || t.includes("pending"); }
function normStatus(s: string | null): string | null { if (!s) return s; const t = s.trim(); if (/^1\./i.test(t)) return "1.Order"; if (/^2\./i.test(t)) return "2.Output"; if (/^4\./i.test(t)) return "4.Input"; return t; }
function cellVal(c: any): string {
  if (c === undefined || c === null) return "";
  if (typeof c === "object") {
    // dense cell: {t, v, w, ...}
    if (c.v !== undefined && c.v !== null) return String(c.v).trim();
    if (c.w !== undefined && c.w !== null) return String(c.w).trim();
    return "";
  }
  return String(c).trim();
}

async function main() {
  const t0 = Date.now();
  console.log(`[stream] Reading ${FILE}`);
  const buf = fs.readFileSync(FILE);
  const wb: any = XLSX.read(buf, { type: "buffer", cellDates: false, dense: true, sheetStubs: false });
  console.log(`[stream] Sheets: ${wb.SheetNames.length}`);

  const sheetName = wb.SheetNames.find((n: string) => n.trim().toUpperCase() === "DATA") || wb.SheetNames[0];
  console.log(`[stream] Using sheet: "${sheetName}"`);

  // Free other sheets immediately.
  for (const n of wb.SheetNames) { if (n !== sheetName) delete wb.Sheets[n]; }
  wb.SheetNames = [sheetName];

  const ws: any = wb.Sheets[sheetName];
  if (!ws) throw new Error("Sheet not readable");
  // In dense mode, ws IS the array of rows (ws[i] = row i, ws[i][j] = cell {t,v,w}).
  const dataArr: any[][] = ws; // dense sheets are arrays
  console.log(`[stream] Dense data: ${dataArr.length} rows`);

  // Header row
  const headerRow = dataArr[0] || [];
  const headers = headerRow.map((c: any, i: number) => { const s = cellVal(c); return s || `Column_${i+1}`; });
  console.log(`[stream] Headers (${headers.length}): ${headers.slice(0, 16).join(" | ")}`);

  const mapping = buildAutoMapping(headers);

  const colFields: { col: number; field: string }[] = [];
  for (let c = 0; c < headers.length; c++) {
    const f = mapping[headers[c]];
    if (f) colFields.push({ col: c, field: f });
  }
  console.log(`[stream] Mapped columns (${colFields.length}): ${colFields.map(c => c.field).join(", ")}`);

  // Pass 1: collect unique rows
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
  console.log(`[stream] Pending: ${pending}, Invalid: ${invalid}, Duplicates: ${duplicates}`);
  console.log(`[stream] Valid unique rows: ${uniqueRows.length}`);

  // Free the sheet data before inserting (big memory savings)
  (ws as any).length = 0;
  delete wb.Sheets[sheetName];

  // Delete existing MAFATE
  const before = await db.masterData.count({ where: { productType: PRODUCT_TYPE } });
  console.log(`[stream] Existing MAFATE: ${before}, deleting...`);
  const del = await db.masterData.deleteMany({ where: { productType: PRODUCT_TYPE } });
  console.log(`[stream] Deleted: ${del.count}`);

  // Insert in batches
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
    console.log(`[stream] Progress: ${Math.min(i + BATCH * CONC, uniqueRows.length)}/${uniqueRows.length}`);
  }
  console.log(`[stream] Inserted: ${inserted}`);

  console.log(`[stream] Rebuilding MasterGroups...`);
  const groups = await rebuildMasterGroups(undefined, PRODUCT_TYPE);
  console.log(`[stream] MasterGroups: ${groups}`);

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
  console.log(`\n[stream] === RESULT ===`);
  console.log(`  MAFATE rows: ${after}`);
  console.log(`  MasterGroups: ${gc}`);
  console.log(`  elapsed: ${((Date.now() - t0)/1000).toFixed(1)}s`);
  await db.$disconnect();
}
main().catch(async (e) => { console.error("[stream] FATAL:", e); await db.$disconnect(); process.exit(1); });
