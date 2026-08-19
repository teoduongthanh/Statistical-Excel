import { NextRequest, NextResponse } from "next/server";
import { readWorkbook, parseSheet, applyMapping } from "@/lib/excel";
import { buildAutoMapping } from "@/lib/header-normalize";
import type { ParseResult, SheetInfo } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST a file (multipart/form-data with `file`) → returns sheets, headers, preview + auto mapping.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    const buffer = await file.arrayBuffer();
    const { wb, sheets } = readWorkbook(buffer);
    const sheetName = form.get("sheet")?.toString() || sheets[0]?.name;
    if (!sheetName) {
      return NextResponse.json({ error: "No sheets found" }, { status: 400 });
    }
    const { headers, rows } = parseSheet(wb, sheetName, 50);
    const autoMapping = buildAutoMapping(headers);
    const result: ParseResult & { autoMapping: typeof autoMapping } = {
      fileName: file.name,
      sheets: sheets as SheetInfo[],
      selectedSheet: sheetName,
      headers,
      preview: rows,
      totalRows: sheets.find((s) => s.name === sheetName)?.totalRows ?? rows.length,
      autoMapping,
    };
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Parse failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    usage: "POST a file (multipart/form-data field 'file', optional 'sheet') to parse.",
  });
}
