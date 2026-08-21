import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rebuildMasterGroups } from "@/lib/master-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface UpdateBody {
  date?: string;
  shippingStatus?: string;
  model?: string;
  sku?: string;
  poNo?: string;
  factoryPO?: string;
  item?: string;
  season?: string;
  colorCode?: string;
  colorCode2?: string;
  painting?: string;
  printingColor?: string;
  size?: string;
  qty1?: string;
  qty2?: string;
  deadline?: string;
  productType?: string;
}

// PUT /api/master-data/[id] — edit a single master data row.
// After editing, rebuild the MasterGroup index to keep it in sync.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as UpdateBody;
  const existing = await db.masterData.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updateData: any = {};
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined) updateData[k] = v === "" ? null : v;
  }

  const updated = await db.masterData.update({ where: { id }, data: updateData });

  // Rebuild MasterGroup index to reflect the change.
  // This is a background-safe operation (rebuilds from all MasterData).
  rebuildMasterGroups().catch(() => {});

  return NextResponse.json({ ok: true, row: updated });
}

// DELETE /api/master-data/[id] — delete a single master data row.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.masterData.delete({ where: { id } });
  rebuildMasterGroups().catch(() => {});
  return NextResponse.json({ ok: true });
}
