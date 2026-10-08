import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  ensureDefaultProfileSeeded,
  parseProfileConfig,
  serializeConfig,
  type ReconciliationConfig,
} from "@/lib/reconciliation-tool-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/recon-tool/profiles — list all reconciliation tool profiles.
// Auto-seeds the default profile on first load (spec §5 default profile).
export async function GET() {
  try {
    await ensureDefaultProfileSeeded();
    const profiles = await db.reconToolProfile.findMany({
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    });
    const hydrated = profiles.map((p) => ({
      ...p,
      fieldMappings: safeParse(p.fieldMappings, []),
      matchKeys: safeParse(p.matchKeys, []),
      statusMapping: safeParse(p.statusMapping, {}),
      tolerance: safeParse(p.tolerance, { type: "absolute", value: 0 }),
      preFilter: safeParse(p.preFilter, {}),
      sizeTransformRules: safeParse(p.sizeTransformRules, []),
      normalizeConfig: safeParse(p.normalizeConfig, {}),
    }));
    return NextResponse.json({ ok: true, profiles: hydrated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}

// POST /api/recon-tool/profiles — create a new profile.
// Body: ReconciliationConfig + { name, description? }
export async function POST(req: NextRequest) {
  try {
    await ensureDefaultProfileSeeded();
    const body = (await req.json()) as Partial<ReconciliationConfig> & {
      name: string;
      description?: string;
    };
    if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    if (!body.sourceDataset) return NextResponse.json({ error: "sourceDataset is required" }, { status: 400 });
    if (!body.targetDataset) return NextResponse.json({ error: "targetDataset is required" }, { status: 400 });

    const existing = await db.reconToolProfile.findUnique({ where: { name: body.name } });
    if (existing) {
      return NextResponse.json({ error: `Profile "${body.name}" already exists` }, { status: 409 });
    }

    const config: ReconciliationConfig = {
      sourceDataset: body.sourceDataset,
      targetDataset: body.targetDataset,
      fieldMappings: body.fieldMappings ?? [],
      matchKeys: body.matchKeys ?? [],
      statusMapping: body.statusMapping ?? {},
      tolerance: body.tolerance ?? { type: "absolute", value: 0 },
      mode: body.mode ?? "aggregate",
      preFilter: body.preFilter ?? {},
      sizeTransformRules: body.sizeTransformRules ?? [],
      normalizeConfig: body.normalizeConfig ?? {},
    };
    const s = serializeConfig(config);
    const profile = await db.reconToolProfile.create({
      data: {
        name: body.name,
        description: body.description ?? null,
        sourceDataset: config.sourceDataset,
        targetDataset: config.targetDataset,
        fieldMappings: s.fieldMappings,
        matchKeys: s.matchKeys,
        statusMapping: s.statusMapping,
        tolerance: s.tolerance,
        mode: s.mode,
        preFilter: s.preFilter,
        sizeTransformRules: s.sizeTransformRules,
        normalizeConfig: s.normalizeConfig,
        active: true,
      },
    });
    const hydrated = parseProfileConfig(profile);
    return NextResponse.json({ ok: true, profile: { ...profile, ...hydrated } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}

function safeParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
