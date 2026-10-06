import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseProfileConfig, type ComparisonProfileConfig } from "@/lib/comparison-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

// GET /api/comparison-studio/profiles/[id] — get a single profile.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const profile = await db.comparisonProfile.findUnique({ where: { id } });
    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    const hydrated = {
      ...profile,
      statusMapping: safeParse(profile.statusMapping, {}),
      matchKeyFields: safeParse(profile.matchKeyFields, []),
      fieldMappings: safeParse(profile.fieldMappings, []),
      aggregationConfig: safeParse(profile.aggregationConfig, {}),
      metrics: safeParse(profile.metrics, []),
      rules: safeParse(profile.rules, []),
    };
    return NextResponse.json({ ok: true, profile: hydrated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}

// PATCH /api/comparison-studio/profiles/[id] — update a profile.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as Partial<ComparisonProfileConfig>;
    const existing = await db.comparisonProfile.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

    // If name is being changed, ensure uniqueness
    if (body.name && body.name !== existing.name) {
      const dup = await db.comparisonProfile.findUnique({ where: { name: body.name } });
      if (dup) return NextResponse.json({ error: `Profile name "${body.name}" already in use` }, { status: 409 });
    }

    // Bump version when key config changes (matchKeyFields, fieldMappings, rules)
    const structuralChange =
      body.matchKeyFields ||
      body.fieldMappings ||
      body.rules ||
      body.aggregationConfig ||
      body.statusMapping;

    const updated = await db.comparisonProfile.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.sourceDataset !== undefined && { sourceDataset: body.sourceDataset }),
        ...(body.targetDataset !== undefined && { targetDataset: body.targetDataset }),
        ...(body.statusMapping !== undefined && { statusMapping: JSON.stringify(body.statusMapping) }),
        ...(body.matchKeyFields !== undefined && { matchKeyFields: JSON.stringify(body.matchKeyFields) }),
        ...(body.fieldMappings !== undefined && { fieldMappings: JSON.stringify(body.fieldMappings) }),
        ...(body.aggregationConfig !== undefined && { aggregationConfig: JSON.stringify(body.aggregationConfig) }),
        ...(body.metrics !== undefined && { metrics: JSON.stringify(body.metrics) }),
        ...(body.rules !== undefined && { rules: JSON.stringify(body.rules) }),
        ...(body.mode !== undefined && { mode: body.mode }),
        ...(body.version !== undefined && { version: body.version }),
        ...(structuralChange && { version: existing.version + 1 }),
      },
    });
    const hydrated = parseProfileConfig(updated);
    return NextResponse.json({ ok: true, profile: { ...updated, ...hydrated } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}

// DELETE /api/comparison-studio/profiles/[id] — delete a profile.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await db.comparisonProfile.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}
