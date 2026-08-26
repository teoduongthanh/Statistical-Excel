import * as XLSX from "xlsx";
import * as fs from "fs";

const file = "/home/z/my-project/upload/Copy of Copy of FMT shipped out S-TECH mafate -2026 (1).xlsx";
const buf = fs.readFileSync(file);
const wb = XLSX.read(buf, { type: "buffer", cellDates: true });

// Find all IN PO sheets
const inpoSheets = wb.SheetNames.filter(n => n.includes("IN PO"));
console.log("IN PO sheets:", inpoSheets);

// Analyze first 2 IN PO sheets to understand structure
for (const sheetName of inpoSheets.slice(0, 3)) {
  console.log(`\n=== ${sheetName} ===`);
  const ws = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
  console.log("Total rows:", raw.length);
  // Show first 5 rows to understand header structure
  for (let i = 0; i < Math.min(5, raw.length); i++) {
    const row = raw[i];
    // Show non-empty cells
    const nonEmpty = row.map((v, idx) => v !== "" ? `[${idx}]${String(v).slice(0,30)}` : null).filter(Boolean);
    console.log(`Row ${i}:`, nonEmpty.join(" | "));
  }
  // Find the header row (usually row 0 or 7 based on earlier analysis)
  // Count columns
  const maxCols = raw.reduce((max, r) => Math.max(max, r.length), 0);
  console.log("Max cols:", maxCols);
}
