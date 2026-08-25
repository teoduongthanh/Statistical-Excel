import { NextRequest, NextResponse } from "next/server";
import { searchMaster } from "@/lib/master-service";
import type { CanonicalField } from "@/lib/fields";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/master-data/search?q=228&field=factoryPO&limit=15&productType=MAFATE&poNo=H411351070
// Product isolation: productType is MANDATORY for autocomplete (spec §52).
// PO NO# linkage: when searching factoryPO and poNo is provided, only Factory POs
// that co-occur with that PO NO# in Master Data are returned.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";
  const field = (searchParams.get("field") || "factoryPO") as CanonicalField;
  const limit = Math.min(30, Math.max(1, Number(searchParams.get("limit") || "15")));
  const prioritizeByDeadline = searchParams.get("prioritizeByDeadline") !== "false";
  const productType = searchParams.get("productType") || undefined;
  const poNo = searchParams.get("poNo") || undefined;
  const suggestions = await searchMaster(field, q, limit, prioritizeByDeadline, productType, poNo);
  return NextResponse.json(suggestions);
}
