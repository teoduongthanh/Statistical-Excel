import { NextRequest, NextResponse } from "next/server";
import { searchMaster } from "@/lib/master-service";
import type { CanonicalField } from "@/lib/fields";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/master-data/search?q=228&field=factoryPO&limit=15
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";
  const field = (searchParams.get("field") || "factoryPO") as CanonicalField;
  const limit = Math.min(30, Math.max(1, Number(searchParams.get("limit") || "15")));
  const suggestions = await searchMaster(field, q, limit);
  return NextResponse.json(suggestions);
}
