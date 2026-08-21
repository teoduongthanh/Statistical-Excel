import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ALL_FIELDS, type CanonicalField } from "@/lib/fields";
import type { AppSettings } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SETTING_KEY = "app_settings";
const DEFAULTS: AppSettings = {
  autoCalcQty2: true,
  allowNegativeQty1: false,
  duplicateDetection: true,
  defaultExportColumns: ALL_FIELDS,
  prioritizeByDeadline: true,
};

async function getSettings(): Promise<AppSettings> {
  const row = await db.setting.findUnique({ where: { key: SETTING_KEY } });
  if (!row) return DEFAULTS;
  try {
    return { ...DEFAULTS, ...(JSON.parse(row.value) as Partial<AppSettings>) };
  } catch {
    return DEFAULTS;
  }
}

export async function GET() {
  return NextResponse.json(await getSettings());
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as Partial<AppSettings>;
  const current = await getSettings();
  const next: AppSettings = { ...current, ...body };
  await db.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: JSON.stringify(next) },
    create: { key: SETTING_KEY, value: JSON.stringify(next) },
  });
  return NextResponse.json(next);
}

export { getSettings };
