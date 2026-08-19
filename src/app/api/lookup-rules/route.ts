import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { SHARED_FIELDS, type CanonicalField } from "@/lib/fields";
import type { LookupRuleConfig } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function rowToConfig(row: {
  id: string;
  name: string;
  primaryKey: string;
  secondaryKey: string | null;
  lookupFields: string;
  autoCalcQty2: boolean;
  active: boolean;
}): LookupRuleConfig {
  return {
    id: row.id,
    name: row.name,
    primaryKey: row.primaryKey as CanonicalField,
    secondaryKey: row.secondaryKey ? (row.secondaryKey as CanonicalField) : null,
    lookupFields: JSON.parse(row.lookupFields || "[]"),
    autoCalcQty2: row.autoCalcQty2,
    active: row.active,
  };
}

export async function GET() {
  const rows = await db.lookupRule.findMany({ orderBy: { createdAt: "asc" } });
  // Seed a default rule if none exist.
  if (rows.length === 0) {
    const seeded = await db.lookupRule.create({
      data: {
        name: "Default (Factory PO → Shared)",
        primaryKey: "factoryPO",
        secondaryKey: "size",
        lookupFields: JSON.stringify(SHARED_FIELDS),
        autoCalcQty2: true,
        active: true,
      },
    });
    return NextResponse.json([rowToConfig(seeded)]);
  }
  return NextResponse.json(rows.map(rowToConfig));
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as LookupRuleConfig;
  const created = await db.lookupRule.create({
    data: {
      name: body.name,
      primaryKey: body.primaryKey,
      secondaryKey: body.secondaryKey ?? null,
      lookupFields: JSON.stringify(body.lookupFields),
      autoCalcQty2: body.autoCalcQty2,
      active: body.active,
    },
  });
  return NextResponse.json(rowToConfig(created));
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as LookupRuleConfig & { id: string };
  const updated = await db.lookupRule.update({
    where: { id: body.id },
    data: {
      name: body.name,
      primaryKey: body.primaryKey,
      secondaryKey: body.secondaryKey ?? null,
      lookupFields: JSON.stringify(body.lookupFields),
      autoCalcQty2: body.autoCalcQty2,
      active: body.active,
    },
  });
  return NextResponse.json(rowToConfig(updated));
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await db.lookupRule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
