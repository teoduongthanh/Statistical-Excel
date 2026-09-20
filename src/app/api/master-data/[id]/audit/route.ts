import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/master-data/[id]/audit — audit trail for a master row.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const audit = await db.masterDataAudit.findMany({
    where: { masterId: id },
    orderBy: { changedAt: "desc" },
    take: 100,
  });
  return NextResponse.json(
    audit.map((a) => ({
      ...a,
      changedAt: a.changedAt.toISOString(),
    }))
  );
}
