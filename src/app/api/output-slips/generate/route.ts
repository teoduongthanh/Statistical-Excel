import { NextRequest, NextResponse } from "next/server";
import { createSlip, type SlipItem, type SlipMode } from "@/lib/output-slip-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GenerateBody {
  productType: string;
  poNo: string;
  slipMode: SlipMode;
  items: SlipItem[];
  createdBy?: string;
  note?: string;
}

// POST /api/output-slips/generate
// Creates an Output Slip record in the DB (status: "generated").
// Does NOT write to EntryData — that happens only at Confirm time.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as GenerateBody;
    if (!body.productType || !body.poNo || !body.items || body.items.length === 0) {
      return NextResponse.json(
        { ok: false, error: "productType, poNo, and items are required" },
        { status: 400 }
      );
    }
    // Validate: no item may have qtyToOutput > remainingOutput.
    for (const item of body.items) {
      if (item.qtyToOutput > item.remainingOutput) {
        return NextResponse.json(
          { ok: false, error: `Factory PO ${item.factoryPO} Size ${item.size}: qtyToOutput (${item.qtyToOutput}) exceeds Remaining (${item.remainingOutput})` },
          { status: 400 }
        );
      }
      if (item.qtyToOutput <= 0) {
        return NextResponse.json(
          { ok: false, error: `Factory PO ${item.factoryPO} Size ${item.size}: qtyToOutput must be > 0` },
          { status: 400 }
        );
      }
    }
    const slip = await createSlip(body);
    return NextResponse.json({ ok: true, slip });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Generate failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
