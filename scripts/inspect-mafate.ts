import * as XLSX from "xlsx";
import fs from "fs";

const FILE = "/home/z/my-project/upload/Data-mafate.xlsx";
const buf = fs.readFileSync(FILE);
const wb = XLSX.read(buf, { type: "buffer", cellDates: false, cellNF: false });

console.log("=== Sheets ===");
console.log(wb.SheetNames);
console.log("Total sheets:", wb.SheetNames.length);

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const ref = ws["!ref"];
  const range = ref ? XLSX.utils.decode_range(ref) : null;
  console.log(`\n=== Sheet: ${name} | ref=${ref} | rows=${range ? range.e.r - range.s.r + 1 : "?"} cols=${range ? range.e.c - range.s.c + 1 : "?"}`);
  // Print first 8 rows as CSV
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as any[][];
  console.log(`  total rows parsed: ${rows.length}`);
  for (let i = 0; i < Math.min(8, rows.length); i++) {
    const r = rows[i];
    console.log(`  row[${i}] (${r.length} cols): ${JSON.stringify(r.slice(0, 18)).slice(0, 400)}`);
  }
}
