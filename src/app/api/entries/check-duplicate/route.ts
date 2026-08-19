import { NextRequest, NextResponse } from "next/server";
import { checkDuplicate } from "@/lib/master-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  factoryPO: string;
  size: string;
  excludeId?: string;
}

// POST /api/entries/check-duplicate → returns existing entry if duplicate found.
export async function POST(req: NextRequest) {
  const body = (await req.json()) as Body;
  const dup = await checkDuplicate(body.factoryPO, body.size);
  return NextResponse.json({ duplicate: !!dup, existing: dup ?? null });
}
