import { NextRequest, NextResponse } from "next/server";
import { scanColumns } from "@/lib/reconciliation-tool-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/recon-tool/scan — scan columns of a dataset (F1).
// Body: { dataset: string }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const dataset = body?.dataset;
    if (!dataset) {
      return NextResponse.json({ error: "dataset is required" }, { status: 400 });
    }
    const profiles = await scanColumns(dataset);
    return NextResponse.json({ ok: true, dataset, profiles });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Scan failed", detail: e?.message },
      { status: 500 }
    );
  }
}
