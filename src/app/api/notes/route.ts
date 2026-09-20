import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkPerm } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/notes?company=&poNo=&factoryPO=&entryId=
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const company = searchParams.get("company") || undefined;
  const poNo = searchParams.get("poNo") || undefined;
  const factoryPO = searchParams.get("factoryPO") || undefined;
  const entryId = searchParams.get("entryId") || undefined;

  const where: any = { AND: [] };
  if (company && company !== "all") where.AND.push({ company });
  if (poNo) where.AND.push({ poNo });
  if (factoryPO) where.AND.push({ factoryPO });
  if (entryId) where.AND.push({ entryId });
  if (where.AND.length === 0) delete where.AND;

  const notes = await db.orderNote.findMany({
    where,
    orderBy: { noteDate: "desc" },
    take: 200,
  });
  return NextResponse.json(
    notes.map((n) => ({
      ...n,
      noteDate: n.noteDate.toISOString(),
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
    }))
  );
}

interface CreateBody {
  company?: string;
  poNo: string;
  factoryPO: string;
  entryId?: string | null;
  noteDate?: string; // ISO date
  content: string;
  author?: string;
}

export async function POST(req: NextRequest) {
  const perm = await checkPerm("notes:write");
  if (!perm.ok) return NextResponse.json({ error: perm.error }, { status: perm.status });
  const body = (await req.json()) as CreateBody;
  if (!body.poNo || !body.factoryPO || !body.content?.trim()) {
    return NextResponse.json({ error: "poNo, factoryPO and content are required" }, { status: 400 });
  }
  const created = await db.orderNote.create({
    data: {
      company: body.company || "mafate",
      poNo: body.poNo,
      factoryPO: body.factoryPO,
      entryId: body.entryId ?? null,
      noteDate: body.noteDate ? new Date(body.noteDate) : new Date(),
      content: body.content.trim(),
      author: body.author || "operator",
    },
  });
  return NextResponse.json({
    ...created,
    noteDate: created.noteDate.toISOString(),
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  });
}
