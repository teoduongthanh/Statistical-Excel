import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/import-history
export async function GET() {
  const items = await db.importHistory.findMany({ orderBy: { importedAt: "desc" }, take: 50 });
  return NextResponse.json(
    items.map((h) => ({
      ...h,
      errors: JSON.parse(h.errors || "[]"),
    }))
  );
}
