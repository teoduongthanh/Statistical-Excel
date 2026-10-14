import { NextRequest, NextResponse } from "next/server";
import { runValidation, DEFAULT_CONFIG } from "@/lib/timeline-validator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/validation/run — run chronology & causality validation (spec VAL1-VAL5)
// Body: { productType: string, config?: Partial<ValidationConfig> }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { productType, config } = body;
    if (!productType) {
      return NextResponse.json({ ok: false, error: "productType is required" }, { status: 400 });
    }
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    const result = await runValidation(productType, mergedConfig);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}
