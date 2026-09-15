// Minimal seed: read Excel sheet_to_json with limited columns, no extra processing.
import { db } from "../src/lib/db";
import { buildAutoMapping } from "../src/lib/header-normalize";
import { rebuildMasterGroups } from "../src/lib/master-service";

// Use a minimal approach: read only the columns we need (first 16 columns, skip extras).
// This reduces memory significantly for the 17MB file.

async function main() {
  // Step 1: Convert XLSX to CSV using a python script (more memory-efficient).
  console.log("=== Converting Excel to CSV ===");

  const files = [
    { path: "/home/z/my-project/upload/FMT shipped out S-TECH mafate -2026.xlsx", sheet: "DATA", productType: "MAFATE" },
    { path: "/home/z/my-project/upload/Data onyx.xlsx", sheet: "Sheet1", productType: "ONYX" },
    { path: "/home/z/my-project/upload/Data Hoongwon(HW).xlsx", sheet: "Sheet1", productType: "MIZUNO" },
  ];

  let totalInserted = 0;

  for (const f of files) {
    console.log(`\n=== Importing ${f.productType} ===`);

    // Use bun to parse Excel with sheet_to_json but only read first 16 columns.
    const { readFileSync } = await import("fs");
    const XLSX = await import("xlsx");

    const buf = readFileSync(f.path);
    console.log(`File size: ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

    // Read with dense: false to skip empty cells, and only get the range.
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true, dense: false });
    console.log(`Sheets: ${wb.SheetNames.join(", ")}`);

    const ws = wb.Sheets[f.sheet];
    if (!ws) {
      console.error(`Sheet "${f.sheet}" not found! Available: ${wb.SheetNames.join(", ")}`);
      continue;
    }

    // Get range.
    const ref = ws["!ref"];
    if (!ref) {
      console.error("No data in sheet");
      continue;
    }
    const range = XLSX.utils.decode_range(ref);
    const totalRows = range.e.r - range.s.r;
    console.log(`Total rows: ${totalRows}, cols: ${range.e.c - range.s.c + 1}`);

    // Read header.
    const headerRow = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "", range: 0, limit: 1 })[0] as any[];
    const headers = headerRow.map((h: any, i: number) => String(h ?? "").trim() || `Column_${i + 1}`);
    console.log(`Headers: ${headers.slice(0, 16).join(" | ")}`);

    const mapping = buildAutoMapping(headers);

    // Delete existing.
    await db.masterData.deleteMany({ where: { productType: f.productType } });
    console.log(`Cleared existing ${f.productType} data.`);

    // Read in chunks of 500 rows.
    const CHUNK = 500;
    let inserted = 0;
    let valid = 0;
    let invalid = 0;

    for (let start = 1; start <= totalRows; start += CHUNK) {
      const end = Math.min(start + CHUNK - 1, totalRows);
      const chunk = XLSX.utils.sheet_to_json(ws, {
        header: 1, raw: true, defval: "",
        range: `${start}-${end}`,
      }) as unknown[][];

      const batch: any[] = [];
      for (const r of chunk) {
        if (!r || r.every((c) => c === "" || c === null || c === undefined)) { invalid++; continue; }

        const obj: Record<string, string> = {};
        headers.forEach((h, idx) => {
          let val = r[idx];
          if (val instanceof Date) val = val.toISOString().slice(0, 10);
          else if (typeof val === "number") val = String(val);
          else val = String(val ?? "").replace(/\r\n/g, " ").replace(/\n/g, " ").trim();
          obj[h] = val;
        });

        const out: any = {};
        for (const [excelHeader, field] of Object.entries(mapping)) {
          if (!field) continue;
          const v = obj[excelHeader];
          if (v !== undefined && v !== "") out[field] = v;
        }

        if (!out.factoryPO || !out.size) { invalid++; continue; }
        valid++;

        batch.push({
          date: out.date ?? null,
          shippingStatus: out.shippingStatus ?? null,
          model: out.model ?? null,
          sku: out.sku ?? null,
          poNo: out.poNo ?? null,
          factoryPO: out.factoryPO ?? null,
          item: out.item ?? null,
          season: out.season ?? null,
          colorCode: out.colorCode ?? null,
          colorCode2: out.colorCode2 ?? null,
          painting: out.painting ?? null,
          printingColor: out.printingColor ?? null,
          size: out.size ?? null,
          qty1: out.qty1 ? parseInt(String(out.qty1), 10) || 0 : null,
          qty2: out.qty2 ? parseInt(String(out.qty2), 10) || 0 : null,
          deadline: out.deadline ?? null,
          productType: f.productType,
          sourceFile: f.path.split("/").pop()!,
          sheetName: f.sheet,
          rowIndex: start + batch.length,
        });
      }

      if (batch.length > 0) {
        await db.masterData.createMany({ data: batch });
        inserted += batch.length;
      }

      if (inserted % 5000 < CHUNK || start + CHUNK > totalRows) {
        console.log(`  ${f.productType}: ${inserted} rows (read ${end}/${totalRows})`);
      }
    }

    await db.importHistory.create({
      data: {
        fileName: f.path.split("/").pop()!,
        sheetName: f.sheet,
        productType: f.productType,
        totalRows: valid + invalid,
        validRows: valid,
        invalidRows: invalid,
        errors: "[]",
      },
    });

    console.log(`✓ ${f.productType}: ${inserted} rows (${invalid} skipped)`);
    totalInserted += inserted;

    // Free memory.
    delete (wb as any).Sheets;
    global.gc?.();
  }

  console.log("\n=== Rebuilding MasterGroup index ===");
  const groups = await rebuildMasterGroups();
  console.log(`Built ${groups} Factory PO groups`);
  console.log(`\n✓ Complete: ${totalInserted} total rows, ${groups} Factory PO groups`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
