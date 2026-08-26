import * as XLSX from "xlsx";
import * as fs from "fs";
const file = "/home/z/my-project/upload/Copy of Copy of FMT shipped out S-TECH mafate -2026 (1).xlsx";
const buf = fs.readFileSync(file);
const wb = XLSX.read(buf, { type: "buffer", cellDates: true });

// Analyze NMNN and NMNN(W) — they may have different sizes
for (const sheetName of ["IN PO NMNN", "IN PO NMNN(W)", "IN PO BZS"]) {
  console.log(`\n=== ${sheetName} ===`);
  const ws = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
  const headerRow = raw[0];
  // Show all size columns (index 5 onwards)
  console.log("Header columns:");
  headerRow.forEach((h, idx) => {
    if (h !== "") console.log(`  [${idx}] "${String(h).replace(/\n/g, "\\n")}"`);
  });
  console.log("Total header cols:", headerRow.filter(h => h !== "").length);
}
