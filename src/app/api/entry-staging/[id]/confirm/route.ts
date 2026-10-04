import { NextRequest, NextResponse } from "next/server";
import { confirmImport } from "@/lib/staging-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/entry-staging/[id]/confirm
// Body: { mode: "valid_only" | "valid_and_accepted", user?: string }
// Imports confirmed rows into EntryData, marks them as imported, and writes
// per-row audit logs (action: "IMPORT"). Errors and (in valid_only mode) warnings
// are left in staging for the user to fix or accept.
// Returns: { ok, imported, remaining }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { ok: false, error: "Batch id is required" },
        { status: 400 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      mode?: "valid_only" | "valid_and_accepted";
      user?: string;
    };

    if (body.mode !== "valid_only" && body.mode !== "valid_and_accepted") {
      return NextResponse.json(
        {
          ok: false,
          error: "mode must be 'valid_only' or 'valid_and_accepted'",
        },
        { status: 400 }
      );
    }

    const result = await confirmImport(id, {
      mode: body.mode,
      user: body.user,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Confirm import failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
