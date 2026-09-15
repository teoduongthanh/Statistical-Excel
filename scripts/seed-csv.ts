// Import CSV into database — memory efficient, no XLSX parsing.
import { db } from "../src/lib/db";
import { buildAutoMapping } from "../src/lib/header-normalize";
import { rebuildMasterGroups } from "../src/lib/master-service";
import * as fs from "fs";
import * as readline from "readline";

const IMPORTS = [
  { csv: "/tmp/mafate_data.csv", productType: "MAFATE", sourceFile: "FMT shipped out S-TECH mafate -2026.xlsx" },
  { csv: "/tmp/onyx_data.csv", productType: "ONYX", sourceFile: "FMT shipped out S-TECH Onyx-2026.xlsx" },
  { csv: "/tmp/hw_data.csv", productType: "MIZUNO", sourceFile: "Data Hoongwon(HW).xlsx" },
];

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { result.push(current); current = ""; }
      else current += ch;
    }
  }
  result.push(current);
  return result;
}

async function importCSV(csvPath: string, productType: string, sourceFile: string) {
  console.log(`\n=== Importing ${productType} from ${csvPath} ===`);

  if (!fs.existsSync(csvPath)) {
    console.log(`  File not found, skipping.`);
    return 0;
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(csvPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  const headerIter = rl[Symbol.asyncIterator]();
  const headerResult = await headerIter.next();
  if (headerResult.done) {
    console.log("  Empty file, skipping.");
    return 0;
  }
  const headers = parseCSVLine(headerResult.value).map(h => h.trim() || `Column_${headers.length + 1}`);
  console.log(`  Headers: ${headers.slice(0, 17).join(" | ")}`);

  const mapping = buildAutoMapping(headers);
  console.log(`  Mapping:`, JSON.stringify(mapping));

  await db.masterData.deleteMany({ where: { productType } });
  console.log(`  Cleared existing ${productType} data.`);

  let inserted = 0;
  let valid = 0;
  let invalid = 0;
  let batch: any[] = [];
  const BATCH_SIZE = 500;

  for await (const line of rl) {
    if (!line.trim()) continue;
    const cells = parseCSVLine(line);

    const obj: any = {};
    headers.forEach((h, idx) => {
      const field = mapping[h];
      if (field) {
        const v = (cells[idx] ?? "").trim();
        if (v) obj[field] = v;
      }
    });

    // Skip Pending rows (3.Pending) — Pending = -Output calculated dynamically.
    const status = (obj.shippingStatus || "").toLowerCase();
    if (status.startsWith("3") || status.includes("pending")) {
      invalid++;
      continue;
    }

    if (!obj.factoryPO || !obj.size) {
      invalid++;
      continue;
    }
    valid++;

    batch.push({
      date: obj.date ?? null,
      shippingStatus: obj.shippingStatus ?? null,
      model: obj.model ?? null,
      sku: obj.sku ?? null,
      poNo: obj.poNo ?? null,
      factoryPO: obj.factoryPO,
      item: obj.item ?? null,
      season: obj.season ?? null,
      colorCode: obj.colorCode ?? null,
      colorCode2: obj.colorCode2 ?? null,
      painting: obj.painting ?? null,
      printingColor: obj.printingColor ?? null,
      size: obj.size,
      qty1: obj.qty1 ? parseInt(String(obj.qty1), 10) || 0 : null,
      qty2: obj.qty2 ? parseInt(String(obj.qty2), 10) || 0 : null,
      deadline: obj.deadline ?? null,
      productType,
      sourceFile,
      sheetName: "DATA",
      rowIndex: valid,
    });

    if (batch.length >= BATCH_SIZE) {
      await db.masterData.createMany({ data: batch });
      inserted += batch.length;
      batch = [];
      if (inserted % 5000 < BATCH_SIZE) {
        console.log(`  ${productType}: ${inserted} rows inserted...`);
      }
    }
  }

  if (batch.length > 0) {
    await db.masterData.createMany({ data: batch });
    inserted += batch.length;
  }

  await db.importHistory.create({
    data: {
      fileName: sourceFile,
      sheetName: "DATA",
      productType,
      totalRows: valid + invalid,
      validRows: valid,
      invalidRows: invalid,
      errors: "[]",
    },
  });

  console.log(`✓ ${productType}: ${inserted} rows (${invalid} skipped — Pending or missing fields)`);
  return inserted;
}

async function main() {
  let total = 0;

  // Convert HW to CSV if not exists.
  if (!fs.existsSync("/tmp/hw_data.csv")) {
    console.log("Converting Hoongwon(HW) to CSV...");
    const XLSX = await import("xlsx");
    const buf = fs.readFileSync("/home/z/my-project/upload/Data Hoongwon(HW).xlsx");
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
    const ws = wb.Sheets["Sheet1"];
    if (ws) {
      const csv = XLSX.utils.sheet_to_csv(ws);
      fs.writeFileSync("/tmp/hw_data.csv", csv);
      console.log("  Saved /tmp/hw_data.csv");
    }
  }

  for (const imp of IMPORTS) {
    total += await importCSV(imp.csv, imp.productType, imp.sourceFile);
  }

  console.log("\n=== Rebuilding MasterGroup index ===");
  const groups = await rebuildMasterGroups();
  console.log(`Built ${groups} Factory PO groups`);
  console.log(`\n✓ Complete: ${total} total rows, ${groups} Factory PO groups`);

  const count = await db.masterData.count();
  console.log(`DB count: ${count}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
