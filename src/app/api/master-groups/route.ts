import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/master-groups?productType=MAFATE
// Returns all Factory PO groups (MasterGroup) for a product — used by the
// batch-generate dialog to show a selectable list of all Factory POs.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const productType = searchParams.get("productType") || "";
  if (!productType) {
    return NextResponse.json({ error: "productType is required" }, { status: 400 });
  }

  const groups = await db.masterGroup.findMany({
    where: { productType },
    select: {
      factoryPO: true,
      model: true,
      season: true,
      nearestDeadline: true,
      poNo: true,
      rowCount: true,
    },
    orderBy: { factoryPO: "asc" },
  });

  return NextResponse.json({
    ok: true,
    total: groups.length,
    groups: groups.map((g) => ({
      factoryPO: g.factoryPO,
      poNo: g.poNo || "",
      model: g.model || "",
      season: g.season || "",
      nearestDeadline: g.nearestDeadline,
      rowCount: g.rowCount,
      sub: [g.model, g.season].filter(Boolean).join(" · ") || undefined,
    })),
  });
}
