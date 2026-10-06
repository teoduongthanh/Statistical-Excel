import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDefaultProfileSeeded, parseProfileConfig, type ComparisonProfileConfig } from "@/lib/comparison-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/comparison-studio/profiles — list all comparison profiles.
// Auto-seeds the default profile on first load (spec §66 default profile).
export async function GET() {
  try {
    await ensureDefaultProfileSeeded();
    const profiles = await db.comparisonProfile.findMany({
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    });
    // Hydrate JSON fields
    const hydrated = profiles.map((p) => ({
      ...p,
      statusMapping: safeParse(p.statusMapping, {}),
      matchKeyFields: safeParse(p.matchKeyFields, []),
      fieldMappings: safeParse(p.fieldMappings, []),
      aggregationConfig: safeParse(p.aggregationConfig, {}),
      metrics: safeParse(p.metrics, []),
      rules: safeParse(p.rules, []),
    }));
    return NextResponse.json({ ok: true, profiles: hydrated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}

// POST /api/comparison-studio/profiles — create a new comparison profile.
// Body: ComparisonProfileConfig (name, sourceDataset, targetDataset, matchKeyFields, etc.)
export async function POST(req: NextRequest) {
  try {
    await ensureDefaultProfileSeeded();
    const body = (await req.json()) as Partial<ComparisonProfileConfig>;
    if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    if (!body.sourceDataset) return NextResponse.json({ error: "sourceDataset is required" }, { status: 400 });
    if (!body.targetDataset) return NextResponse.json({ error: "targetDataset is required" }, { status: 400 });

    const existing = await db.comparisonProfile.findUnique({ where: { name: body.name } });
    if (existing) {
      return NextResponse.json({ error: `Profile with name "${body.name}" already exists` }, { status: 409 });
    }

    const profile = await db.comparisonProfile.create({
      data: {
        name: body.name,
        description: body.description ?? null,
        sourceDataset: body.sourceDataset,
        targetDataset: body.targetDataset,
        statusMapping: JSON.stringify(body.statusMapping ?? {}),
        matchKeyFields: JSON.stringify(body.matchKeyFields ?? []),
        fieldMappings: JSON.stringify(body.fieldMappings ?? []),
        aggregationConfig: JSON.stringify(body.aggregationConfig ?? {}),
        metrics: JSON.stringify(body.metrics ?? []),
        rules: JSON.stringify(body.rules ?? []),
        mode: body.mode ?? "SMART",
        version: body.version ?? 1,
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
