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
    const files = form.getAll("files");
    if (files.length === 0) return NextResponse.json({ error: "No files provided" }, { status: 400 });
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const results: Array<{ fileName: string; size: number; savedPath: string; status: "ok" | "skipped" | "error"; message?: string }> = [];
    for (const entry of files) {
      if (!(entry instanceof File)) { results.push({ fileName: String(entry), size: 0, savedPath: "", status: "error", message: "Not a File" }); continue; }
      const fileName = entry.name;
      const ext = path.extname(fileName).toLowerCase();
      if (!ALLOWED_EXT.includes(ext)) { results.push({ fileName, size: entry.size, savedPath: "", status: "error", message: `Extension ${ext} not allowed` }); continue; }
      if (entry.size > MAX_SIZE) { results.push({ fileName, size: entry.size, savedPath: "", status: "error", message: "File too large" }); continue; }
      const savedPath = path.join(UPLOAD_DIR, fileName);
      if (fs.existsSync(savedPath)) { const st = fs.statSync(savedPath); if (st.size === entry.size) { results.push({ fileName, size: entry.size, savedPath, status: "skipped", message: "Already exists" }); continue; } }
      const buffer = Buffer.from(await entry.arrayBuffer());
      fs.writeFileSync(savedPath, buffer);
      results.push({ fileName, size: entry.size, savedPath, status: "ok", message: "Saved" });
    }
    const ok = results.filter((r) => r.status === "ok").length;
    const sk = results.filter((r) => r.status === "skipped").length;
    const er = results.filter((r) => r.status === "error").length;
    return NextResponse.json({ ok: er === 0, uploaded: ok, skipped: sk, errors: er, total: results.length, files: results });
  } catch (e: any) { return NextResponse.json({ error: "Upload failed", detail: e?.message }, { status: 500 }); }
}

export async function GET() {
  try {
    if (!fs.existsSync(UPLOAD_DIR)) return NextResponse.json({ files: [] });
    const entries = fs.readdirSync(UPLOAD_DIR);
    const files = entries.filter((n) => ALLOWED_EXT.includes(path.extname(n).toLowerCase())).map((n) => { const st = fs.statSync(path.join(UPLOAD_DIR, n)); return { name: n, size: st.size, sizeMB: +(st.size / 1024 / 1024).toFixed(2), mtime: st.mtime.toISOString() }; }).sort((a, b) => b.mtime.localeCompare(a.mtime));
    return NextResponse.json({ files, total: files.length });
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }); }
}
