// Import FVO Excel into MasterData with productType="ONYX_FVO"
// Mapping: PO NO# → poNo, ART → factoryPO, Size → size (composite key matches STECH)
import { db } from "../src/lib/db";
import { applyMapping } from "../src/lib/excel";
import { buildAutoMapping } from "../src/lib/header-normalize";
import { rebuildMasterGroups } from "../src/lib/master-service";
import * as XLSX from "xlsx";
import * as fs from "fs";

const FILE = "/home/z/my-project/upload/Data Onyx  FVO.xlsx";
const PRODUCT_TYPE = "ONYX_FVO";

function isPending(s: string) { const t = (s||"").trim().toLowerCase(); return t.startsWith("3") || t.includes("pending"); }
function normStatus(s: string|null) { if(!s) return s; const t=s.trim(); if(/^1\./i.test(t))return "1.Order"; if(/^2\./i.test(t))return "2.Output"; if(/^4\./i.test(t))return "4.Input"; return t; }
function normKey(s: string) { return String(s||"").replace(/\r?\n/g," ").replace(/\s+/g," ").trim(); }

async function main() {
  console.log(`=== Import FVO: ${FILE.split("/").pop()} → ${PRODUCT_TYPE} ===`);
  const buf = fs.readFileSync(FILE);
  const wb = XLSX.read(buf, { type: "buffer", dense: true, sheetStubs: false });
  const dataSheet = wb.SheetNames.find(n => n.trim().toUpperCase() === "DATA");
  if (!dataSheet) { console.log("✗ No DATA sheet"); return; }
  for (const n of wb.SheetNames) if (n !== dataSheet) delete wb.Sheets[n];
  const ws = wb.Sheets[dataSheet];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "", blankrows: false }) as unknown[][];
  const headers = (raw[0] as unknown[]).map((h,i) => String(h ?? "").trim() || `Col_${i+1}`);
  console.log(`Headers: ${headers.join(" | ")}`);

  // Build custom mapping: ART → factoryPO (critical for composite key match with STECH)
  const mapping = buildAutoMapping(headers);
  // Override: ensure ART maps to factoryPO
  const artIdx = headers.findIndex(h => h.toUpperCase() === "ART");
  if (artIdx >= 0) { mapping[headers[artIdx]] = "factoryPO"; }
  console.log(`ART → factoryPO override: ${artIdx >= 0 ? "applied" : "ART column not found"}`);

  const seen = new Set<string>();
  const rows: any[] = [];
  let pending = 0, invalid = 0, dup = 0;
  for (let i = 1; i < raw.length; i++) {
    const arr = raw[i] as unknown[];
    const obj: Record<string,string> = {};
    for (let c = 0; c < headers.length; c++) obj[headers[c]] = arr[c]===undefined||arr[c]===null ? "" : String(arr[c]).trim();
    const m = applyMapping([obj], mapping)[0];
    if (isPending(m.shippingStatus || "")) { pending++; continue; }
    if (!m.poNo || !m.factoryPO || !m.size) { invalid++; continue; }
    m.shippingStatus = normStatus(m.shippingStatus || null) || m.shippingStatus;
    const sig = [m.date,m.shippingStatus,m.poNo,m.factoryPO,m.size,m.model,m.sku,m.season,m.colorCode,m.colorCode2,m.painting,m.printingColor,m.qty1,m.qty2,m.deadline].join("\u0001");
    if (seen.has(sig)) { dup++; continue; }
    seen.add(sig);
    rows.push({ m, sourceFile: FILE.split("/").pop()!, productType: PRODUCT_TYPE });
  }
  console.log(`Parsed: ${raw.length-1} | pending=${pending} | invalid=${invalid} | dup=${dup} | unique=${rows.length}`);

  // Status breakdown
  const byStatus: Record<string, number> = {};
  for (const r of rows) { const s = r.m.shippingStatus || "(none)"; byStatus[s] = (byStatus[s] || 0) + 1; }
  console.log(`Status breakdown: ${JSON.stringify(byStatus)}`);

  // Clear existing ONYX_FVO data
  const deleted = await db.masterData.deleteMany({ where: { productType: PRODUCT_TYPE } });
  console.log(`Deleted ${deleted.count} existing ${PRODUCT_TYPE} rows`);

  // Insert in batches
  const BATCH = 2000, CONC = 5;
  for (let i = 0; i < rows.length; i += BATCH * CONC) {
    const batches: typeof rows[] = [];
    for (let j = 0; j < CONC && i + j * BATCH < rows.length; j++) batches.push(rows.slice(i + j * BATCH, i + (j+1) * BATCH));
    await Promise.all(batches.map(batch => db.masterData.createMany({
      data: batch.map(item => {
        const m = item.m;
        return {
          date: m.date ?? null, shippingStatus: m.shippingStatus ?? null, model: m.model ?? null,
          sku: m.sku ?? null, poNo: normKey(m.poNo) || null, factoryPO: normKey(m.factoryPO) || null,
          item: m.item ?? null, season: m.season ?? null, colorCode: m.colorCode ?? null,
          colorCode2: m.colorCode2 ?? null, painting: m.painting ?? null, printingColor: m.printingColor ?? null,
          size: normKey(m.size) || null,
          qty1: m.qty1 ? parseInt(String(m.qty1),10)||0 : null,
          qty2: m.qty2 ? parseInt(String(m.qty2),10)||0 : null,
          deadline: m.deadline ?? null, productType: item.productType,
          sourceFile: item.sourceFile, sheetName: "DATA", rowIndex: 0,
        };
      })
    })));
  }
  console.log(`✓ Inserted ${rows.length} rows`);

  // Sample to verify composite key
  const samples = await db.masterData.findMany({ where: { productType: PRODUCT_TYPE, shippingStatus: "1.Order" }, take: 3, select: { poNo: true, factoryPO: true, size: true, qty1: true, model: true } });
  console.log(`\nSample FVO 1.Order rows (poNo|factoryPO|size = composite key):`);
  for (const s of samples) console.log(`  poNo=${s.poNo} | factoryPO(ART)=${s.factoryPO} | size=${s.size} | qty=${s.qty1} | model=${s.model}`);

  // Compare with STECH (ONYX) composite key
  const stechSamples = await db.masterData.findMany({ where: { productType: "ONYX", shippingStatus: "1.Order" }, take: 3, select: { poNo: true, factoryPO: true, size: true, qty1: true } });
  console.log(`\nSample STECH 1.Order rows (factoryPO|poNo|size = composite key):`);
  for (const s of stechSamples) console.log(`  factoryPO=${s.factoryPO} | poNo=${s.poNo} | size=${s.size} | qty=${s.qty1}`);

  // Verify match: FVO poNo should equal STECH factoryPO, FVO factoryPO(ART) should equal STECH poNo
  console.log(`\n=== Match verification ===`);
  const fvoKeys = new Set(samples.map(s => `${s.poNo}|${s.factoryPO}|${s.size}`));
  const stechKeys = new Set(stechSamples.map(s => `${s.factoryPO}|${s.poNo}|${s.size}`));
  let matched = 0;
  for (const k of fvoKeys) if (stechKeys.has(k)) matched++;
  console.log(`FVO keys: ${fvoKeys.size}, STECH keys: ${stechKeys.size}, matched: ${matched}`);

  // Don't rebuild MasterGroup for ONYX_FVO (it's a tracking source, not a dashboard product)
  console.log(`\n✓ Import complete (skipped MasterGroup rebuild — ONYX_FVO is a tracking source)`);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
