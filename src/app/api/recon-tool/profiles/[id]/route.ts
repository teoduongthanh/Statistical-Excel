import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  parseProfileConfig,
  serializeConfig,
  type ReconciliationConfig,
} from "@/lib/reconciliation-tool-service";

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

// GET /api/recon-tool/profiles/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const profile = await db.reconToolProfile.findUnique({ where: { id } });
    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    const hydrated = {
      ...profile,
      fieldMappings: safeParse(profile.fieldMappings, []),
      matchKeys: safeParse(profile.matchKeys, []),
      statusMapping: safeParse(profile.statusMapping, {}),
      tolerance: safeParse(profile.tolerance, { type: "absolute", value: 0 }),
      preFilter: safeParse(profile.preFilter, {}),
      sizeTransformRules: safeParse(profile.sizeTransformRules, []),
      normalizeConfig: safeParse(profile.normalizeConfig, {}),
    };
    return NextResponse.json({ ok: true, profile: hydrated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}

// PATCH /api/recon-tool/profiles/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as Partial<ReconciliationConfig> & {
      name?: string;
      description?: string;
    };
    const existing = await db.reconToolProfile.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

    if (body.name && body.name !== existing.name) {
      const dup = await db.reconToolProfile.findUnique({ where: { name: body.name } });
      if (dup) return NextResponse.json({ error: `Profile name "${body.name}" already in use` }, { status: 409 });
    }

    const config: Partial<ReconciliationConfig> = {
      sourceDataset: body.sourceDataset,
      targetDataset: body.targetDataset,
      fieldMappings: body.fieldMappings,
      matchKeys: body.matchKeys,
      statusMapping: body.statusMapping,
      tolerance: body.tolerance,
      mode: body.mode,
      preFilter: body.preFilter,
      sizeTransformRules: body.sizeTransformRules,
      normalizeConfig: body.normalizeConfig,
    };
    const s = serializeConfig(config as ReconciliationConfig);

    const updated = await db.reconToolProfile.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.sourceDataset !== undefined && { sourceDataset: body.sourceDataset }),
        ...(body.targetDataset !== undefined && { targetDataset: body.targetDataset }),
        ...(config.fieldMappings !== undefined && { fieldMappings: s.fieldMappings }),
        ...(config.matchKeys !== undefined && { matchKeys: s.matchKeys }),
        ...(config.statusMapping !== undefined && { statusMapping: s.statusMapping }),
        ...(config.tolerance !== undefined && { tolerance: s.tolerance }),
        ...(config.mode !== undefined && { mode: s.mode as string }),
        ...(config.preFilter !== undefined && { preFilter: s.preFilter }),
        ...(config.sizeTransformRules !== undefined && { sizeTransformRules: s.sizeTransformRules }),
        ...(config.normalizeConfig !== undefined && { normalizeConfig: s.normalizeConfig }),
      },
    });
    const hydrated = parseProfileConfig(updated);
    return NextResponse.json({ ok: true, profile: { ...updated, ...hydrated } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}

// DELETE /api/recon-tool/profiles/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await db.reconToolProfile.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}
