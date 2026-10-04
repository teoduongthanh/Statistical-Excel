import { NextRequest, NextResponse } from "next/server";
import { createBatch } from "@/lib/staging-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/entry-staging/create
// Body: { productType: string, text: string, createdBy?: string }
// Parses pasted TSV/CSV text and creates an EntryBatch + EntryStagingRow rows.
// Returns: { ok, batchId, batchDbId, totalRows }
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      productType?: string;
      text?: string;
      createdBy?: string;
    };

    if (!body.productType) {
      return NextResponse.json(
        { ok: false, error: "productType is required" },
        { status: 400 }
      );
    }
    if (!body.text || !body.text.trim()) {
      return NextResponse.json(
        { ok: false, error: "text is required (paste rows first)" },
        { status: 400 }
      );
    }

    const result = await createBatch(body.productType, body.text, body.createdBy);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create staging batch";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
