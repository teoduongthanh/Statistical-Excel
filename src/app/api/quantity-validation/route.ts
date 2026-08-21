import { NextRequest, NextResponse } from "next/server";
import { validateQuantities } from "@/lib/master-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/quantity-validation?factoryPO=&poNo=&productType=
// Returns groups of (poNo + factoryPO + size) with Order/Output/Input quantity
// consistency checks. Inconsistent groups are flagged with errors.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const filters = {
    factoryPO: searchParams.get("factoryPO") || undefined,
    poNo: searchParams.get("poNo") || undefined,
    productType: searchParams.get("productType") || undefined,
  };
  const groups = await validateQuantities(filters);
  const inconsistent = groups.filter((g) => !g.isConsistent).length;
  const totalMissing = groups.reduce((sum, g) => sum + (g.missingQty ?? 0), 0);
  return NextResponse.json({
    total: groups.length,
    inconsistent,
    consistent: groups.length - inconsistent,
    totalMissing,
    groups,
  });
}
