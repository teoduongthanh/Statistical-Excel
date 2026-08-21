import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readWorkbook, parseSheet, applyMapping } from "@/lib/excel";
import { rebuildMasterGroups } from "@/lib/master-service";
import type { ColumnMapping, ImportError } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ImportBody {
  fileName: string;
  sheetName: string;
  fileBase64: string; // base64-encoded workbook
  mapping: ColumnMapping;
  replaceExisting?: boolean;
  productType?: string; // "Mafate" | "Onyx" | "Hoong Won" | null
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ImportBody;
    if (!body.fileBase64 || !body.mapping) {
      return NextResponse.json({ error: "Missing file or mapping" }, { status: 400 });
    }
    // Convert base64 to ArrayBuffer cleanly.
    const buffer = Buffer.from(body.fileBase64, "base64");
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;
    const { wb } = readWorkbook(arrayBuffer);
    const { rows } = parseSheet(wb, body.sheetName);

    const mapped = applyMapping(rows, body.mapping);

    // Validate rows: factoryPO + size required.
    const errors: ImportError[] = [];
    const valid: (typeof mapped[number] & { _rowIndex: number })[] = [];
    mapped.forEach((m, idx) => {
      const rowIndex = idx + 2; // 1-based + header
      if (!m.factoryPO) {
        errors.push({ row: rowIndex, message: "Factory PO not found", data: m as Record<string, string> });
        return;
      }
      if (!m.size) {
        errors.push({ row: rowIndex, message: "Size not found", data: m as Record<string, string> });
        return;
      }
      valid.push({ ...m, _rowIndex: rowIndex });
    });

    // Optional: replace existing data from the same source file.
    if (body.replaceExisting) {
      await db.masterData.deleteMany({ where: { sourceFile: body.fileName } });
    }

    const productType = body.productType || null;

    // Insert master rows in batches.
    const BATCH = 200;
    let inserted = 0;
    for (let i = 0; i < valid.length; i += BATCH) {
      const batch = valid.slice(i, i + BATCH);
      await db.masterData.createMany({
        data: batch.map((m) => ({
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
          qty1: m.qty1 ?? null,
          qty2: m.qty2 ?? null,
          deadline: m.deadline ?? null,
          productType,
          sourceFile: body.fileName,
          sheetName: body.sheetName,
          rowIndex: m._rowIndex,
        })),
      });
      inserted += batch.length;
    }

    // Rebuild the MasterGroup index.
    await rebuildMasterGroups();

    const history = await db.importHistory.create({
      data: {
        fileName: body.fileName,
        sheetName: body.sheetName,
        productType,
        totalRows: mapped.length,
        validRows: valid.length,
        invalidRows: errors.length,
        errors: JSON.stringify(errors.slice(0, 200)),
      },
    });

    return NextResponse.json({
      ok: true,
      inserted,
      totalRows: mapped.length,
      validRows: valid.length,
      invalidRows: errors.length,
      errors: errors.slice(0, 50),
      historyId: history.id,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Import failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
