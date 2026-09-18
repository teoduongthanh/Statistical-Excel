import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/order-notes?factoryPO=&size=&noteDate=
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const factoryPO = searchParams.get("factoryPO") || "";
  const size = searchParams.get("size") || "";
  const noteDate = searchParams.get("noteDate") || "";

  const where: any = { AND: [] };
  if (factoryPO) where.AND.push({ factoryPO });
  if (size) where.AND.push({ size });
  if (noteDate) where.AND.push({ noteDate });
  if (where.AND.length === 0) delete where.AND;

  const notes = await db.orderNote.findMany({
    where,
    orderBy: [{ noteDate: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  return NextResponse.json(notes);
}

// POST /api/order-notes — create a new daily note for an order
export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.factoryPO || !body.size || !body.noteDate || !body.content) {
    return NextResponse.json(
      { error: "factoryPO, size, noteDate, and content are required" },
      { status: 400 }
    );
  }
  const note = await db.orderNote.create({
    data: {
      productType: body.productType || "MAFATE",
      factoryPO: body.factoryPO.trim(),
      size: body.size.trim(),
      poNo: body.poNo || null,
      noteDate: body.noteDate,
      content: body.content,
      author: body.author || null,
    },
  });
  return NextResponse.json(note);
}
