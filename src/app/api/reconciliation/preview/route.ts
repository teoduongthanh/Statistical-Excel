import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { previewPartnerExcel, DEFAULT_MAPPING, type MappingConfig } from "@/lib/reconciliation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPLOAD_DIR = "/home/z/my-project/upload";

// POST /api/reconciliation/preview — preview uploaded partner file (sheets, headers, counts).
// Body: { fileName: string, mapping?: Partial<MappingConfig> }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const fileName = body.fileName;
    if (!fileName) {
      return NextResponse.json({ error: "fileName is required" }, { status: 400 });
    }
    const filePath = path.join(UPLOAD_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: `File not found: ${fileName}` }, { status: 404 });
    }
    const mapping: MappingConfig = { ...DEFAULT_MAPPING, ...body.mapping };
    const preview = previewPartnerExcel(filePath, mapping);
    return NextResponse.json({ ok: true, preview });
  } catch (e: any) {
    return NextResponse.json({ error: "Preview failed", detail: e?.message }, { status: 500 });
  }
}
