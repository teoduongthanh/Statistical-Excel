import * as XLSX from "xlsx";
import fs from "fs";
const FILE = "/home/z/my-project/upload/FMT shipped out S-TECH Onyx-2026 10.24.xlsx";
const wb = XLSX.read(fs.readFileSync(FILE), { type: "buffer", cellDates: false, dense: true, sheetStubs: false });
console.log("Sheets:", wb.SheetNames);
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as any[][];
  console.log(`\nSheet: ${name} | rows: ${rows.length}`);
  if (rows.length > 0) console.log("Headers:", JSON.stringify(rows[0]).slice(0, 500));
  if (rows.length > 1) console.log("Row1:", JSON.stringify(rows[1]).slice(0, 500));
}
