import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { runReconciliation, DEFAULT_MAPPING, type MappingConfig } from "@/lib/reconciliation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UPLOAD_DIR = "/home/z/my-project/upload";

// POST /api/reconciliation/run — execute reconciliation.
// Body: {
//   fileName: string,
//   productType: string,
//   dateFrom?: string (yyyy-MM-dd),
//   dateTo?: string,
//   asOfDate?: string,
//   mapping?: Partial<MappingConfig>,
//   uploadedBy?: string,
// }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const fileName = body.fileName;
    const productType = body.productType;
    if (!fileName) return NextResponse.json({ error: "fileName is required" }, { status: 400 });
    if (!productType) return NextResponse.json({ error: "productType is required" }, { status: 400 });

    const filePath = path.join(UPLOAD_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: `File not found: ${fileName}` }, { status: 404 });
    }

    const mapping: MappingConfig = { ...DEFAULT_MAPPING, ...body.mapping };

    const result = await runReconciliation({
      filePath,
      productType,
      dateFrom: body.dateFrom,
      dateTo: body.dateTo,
      asOfDate: body.asOfDate,
      mapping,
      uploadedBy: body.uploadedBy,
    });

    return NextResponse.json({
      ok: true,
      runId: result.runId,
      runNumber: result.runNumber,
      summary: result.summary,
      resultsCount: result.resultsCount,
    });
  } catch (e: any) {
    return NextResponse.json({ error: "Reconciliation failed", detail: e?.message }, { status: 500 });
  }
}
