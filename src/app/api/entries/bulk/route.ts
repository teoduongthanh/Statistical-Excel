import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createEntry } from "@/lib/master-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BulkItem {
  factoryPO: string;
  size: string;
  qty1: string;
  productType?: string; // optional per-item override (product-scoped bulk entry)
}
interface BulkBody {
  items: BulkItem[];
  autoCalcQty2?: boolean;
  productType?: string; // optional global override applied to all items
}

// POST /api/entries/bulk — create many entries, returning per-item results + error report.
export async function POST(req: NextRequest) {
  const body = (await req.json()) as BulkBody;
  const autoCalcQty2 = body.autoCalcQty2 ?? true;
  const globalProductType = body.productType;
  const results: { index: number; ok: boolean; entry?: any; errors?: string[]; input: BulkItem }[] = [];

  for (let i = 0; i < body.items.length; i++) {
    const it = body.items[i];
    const productType = it.productType || globalProductType;
    const r = await createEntry(
      { factoryPO: it.factoryPO, size: it.size, qty1: it.qty1 },
      { autoCalcQty2, productType }
    );
    if (r.ok) {
      results.push({ index: i, ok: true, entry: r.entry, input: it });
    } else {
      results.push({ index: i, ok: false, errors: r.errors, input: it });
    }
  }

  return NextResponse.json({
    ok: true,
    total: body.items.length,
    success: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
