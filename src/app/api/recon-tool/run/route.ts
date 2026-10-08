import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  parseProfileConfig,
  runReconciliation,
  type ReconciliationConfig,
} from "@/lib/reconciliation-tool-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/recon-tool/run — run reconciliation.
// Body: { profileId?: string, config?: ReconciliationConfig }
//   - If profileId is provided, load config from DB.
//   - Else, use the inline config.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    let config: ReconciliationConfig;
    let profile: { id: string; name: string } | null = null;

    if (body?.profileId) {
      const profileRow = await db.reconToolProfile.findUnique({ where: { id: body.profileId } });
      if (!profileRow) {
        return NextResponse.json({ error: "Profile not found" }, { status: 404 });
      }
      config = parseProfileConfig(profileRow);
      // Allow overrides from the body (e.g. dynamic preFilter for this run).
      if (body?.overrides) {
        const o = body.overrides;
        if (o.tolerance) config.tolerance = o.tolerance;
        if (o.mode) config.mode = o.mode;
        if (o.preFilter) config.preFilter = { ...config.preFilter, ...o.preFilter };
        if (o.matchKeys) config.matchKeys = o.matchKeys;
      }
      profile = { id: profileRow.id, name: profileRow.name };
    } else if (body?.config) {
      config = body.config as ReconciliationConfig;
    } else {
      return NextResponse.json(
        { error: "Either profileId or config must be provided" },
        { status: 400 }
      );
    }

    const result = await runReconciliation(config, profile);
    return NextResponse.json({ ok: true, runId: result.runId, summary: result.summary });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Reconciliation failed", detail: e?.message },
      { status: 500 }
    );
  }
}
