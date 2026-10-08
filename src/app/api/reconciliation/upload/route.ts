import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPLOAD_DIR = "/home/z/my-project/upload";
const ALLOWED_EXT = [".xlsx", ".xls"];
const MAX_SIZE = 30 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) return NextResponse.json({ error: `Extension ${ext} not allowed` }, { status: 400 });
    if (file.size > MAX_SIZE) return NextResponse.json({ error: "File too large" }, { status: 400 });
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const savedPath = path.join(UPLOAD_DIR, file.name);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(savedPath, buffer);
    return NextResponse.json({ ok: true, fileName: file.name, savedPath, size: file.size, sizeMB: +(file.size / 1024 / 1024).toFixed(2) });
  } catch (e: any) { return NextResponse.json({ error: "Upload failed", detail: e?.message }, { status: 500 }); }
}
