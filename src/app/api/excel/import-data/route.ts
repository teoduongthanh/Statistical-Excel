import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { db } from "@/lib/db";
import { applyMapping } from "@/lib/excel";
import { buildAutoMapping } from "@/lib/header-normalize";
import { rebuildMasterGroups } from "@/lib/master-service";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UPLOAD_DIR = "/home/z/my-project/upload";

interface ImportRequest {
  files?: Array<{ fileName: string; productType: string }>;
}

function detectProductType(fileName: string): string | null {
  const n = fileName.toLowerCase();
  if (n.includes("mafate")) return "MAFATE";
  if (n.includes("onyx")) return "ONYX";
  if (n.includes("mizuno")) return "MIZUNO";
  return null;
}

function rowSignature(m: Record<string, string>): string {
  return [
    m.date || "", m.shippingStatus || "", m.poNo || "", m.factoryPO || "",
    m.size || "", m.model || "", m.sku || "", m.item || "", m.season || "",
    m.colorCode || "", m.colorCode2 || "", m.painting || "", m.printingColor || "",
    m.qty1 || "", m.qty2 || "", m.deadline || "",
  ].join("\u0001");
}

function isPendingStatus(status: string): boolean {
  const s = (status || "").trim().toLowerCase();
  return s.startsWith("3") || s.includes("pending");
}

function normalizeStatus(s: string | null): string | null {
  if (!s) return s;
  const t = s.trim();
  if (/^1\./i.test(t)) return "1.Order";
  if (/^2\./i.test(t)) return "2.Output";
  if (/^4\./i.test(t)) return "4.Input";
  return t;
}

interface ImportFileResult {
  fileName: string;
  productType: string;
  totalRows: number;
  validRows: number;
  pendingSkipped: number;
  invalidSkipped: number;
  duplicatesSkipped: number;
  groups: number;
  status: "ok" | "error";
  error?: string;
}

async function importOneFile(
  filePath: string,
  productType: string
): Promise<ImportFileResult> {
  const fileName = path.basename(filePath);
  const result: ImportFileResult = {
    fileName,
    productType,
    totalRows: 0,
    validRows: 0,
    pendingSkipped: 0,
    invalidSkipped: 0,
    duplicatesSkipped: 0,
    groups: 0,
    status: "ok",
  };

  try {
    const buf = fs.readFileSync(filePath);
    const wb = XLSX.read(buf, {
      type: "buffer",
      cellDates: false,
      dense: true,
      sheetStubs: false,
    });

    for (const name of wb.SheetNames) {
      if (name !== "DATA") delete wb.Sheets[name];
    }
    wb.SheetNames = wb.SheetNames.filter((n) => n === "DATA");

    const ws = wb.Sheets["DATA"];
    if (!ws) {
      result.status = "error";
      result.error = `DATA sheet not found. Available: ${Object.keys(wb.Sheets).join(", ")}`;
      return result;
    }

    const raw = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: true,
      defval: "",
      blankrows: false,
    }) as unknown[][];

    if (raw.length === 0) {
      result.status = "error";
      result.error = "DATA sheet is empty";
      return result;
    }

    const headerRow = raw[0] as unknown[];
    const headers = headerRow.map((h, i) => {
      const s = String(h ?? "").trim();
      return s || `Column_${i + 1}`;
    });

    const mapping = buildAutoMapping(headers);

    const unmappedRows: Record<string, string>[] = [];
    for (let i = 1; i < raw.length; i++) {
      const arr = raw[i] as unknown[];
      const obj: Record<string, string> = {};
      for (let c = 0; c < headers.length; c++) {
        const v = arr[c];
        obj[headers[c]] = v === undefined || v === null ? "" : String(v).trim();
      }
      unmappedRows.push(obj);
    }

    const mappedRows = applyMapping(unmappedRows, mapping);
    result.totalRows = mappedRows.length;

    let pending = 0,
      invalid = 0,
      duplicates = 0;
    const seen = new Set<string>();
    const uniqueRows: {
      m: Record<string, string>;
      sourceFile: string;
      productType: string;
    }[] = [];

    for (const m of mappedRows) {
      if (isPendingStatus(m.shippingStatus || "")) {
        pending++;
        continue;
      }
      if (!m.factoryPO || !m.size) {
        invalid++;
        continue;
      }
      const sig = rowSignature(m);
      if (seen.has(sig)) {
        duplicates++;
        continue;
      }
      seen.add(sig);
      m.shippingStatus = normalizeStatus(m.shippingStatus || null) || m.shippingStatus;
      uniqueRows.push({ m, sourceFile: fileName, productType });
    }

    result.pendingSkipped = pending;
    result.invalidSkipped = invalid;
    result.duplicatesSkipped = duplicates;
    result.validRows = uniqueRows.length;

    await db.masterData.deleteMany({ where: { productType } });

    const BATCH = 500;
    for (let i = 0; i < uniqueRows.length; i += BATCH) {
      const batch = uniqueRows.slice(i, i + BATCH);
      await db.masterData.createMany({
        data: batch.map((item, idx) => {
          const m = item.m;
          return {
            date: m.date ?? null,
            shippingStatus: m.shippingStatus ?? null,
            model: m.model ?? null,
            sku: m.sku ?? null,
            poNo: m.poNo ?? null,
            factoryPO: m.factoryPO ?? null,
            item: m.item ?? null,
            season: m.season ?? null,
            colorCode: m.colorCode ?? null,
            colorCode2: m.colorCode2 ?? null,
            painting: m.painting ?? null,
            printingColor: m.printingColor ?? null,
            size: m.size ?? null,
            qty1:
              m.qty1 !== undefined && m.qty1 !== "" && m.qty1 !== null
                ? parseInt(String(m.qty1), 10) || 0
                : null,
            qty2:
              m.qty2 !== undefined && m.qty2 !== "" && m.qty2 !== null
                ? parseInt(String(m.qty2), 10) || 0
                : null,
            deadline: m.deadline ?? null,
            productType: item.productType,
            sourceFile: item.sourceFile,
            sheetName: "DATA",
            rowIndex: i + idx + 2,
          };
        }),
      });
    }

    await db.importHistory.create({
      data: {
        fileName,
        sheetName: "DATA",
        productType,
        totalRows: result.totalRows,
        validRows: result.validRows,
        invalidRows: pending + invalid + duplicates,
        errors: JSON.stringify({
          pendingSkipped: pending,
          invalidSkipped: invalid,
          duplicatesSkipped: duplicates,
        }),
      },
    });

    result.groups = await rebuildMasterGroups(undefined, productType);
  } catch (e: any) {
    result.status = "error";
    result.error = e?.message || String(e);
  }

  return result;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ImportRequest;

    let fileSpecs: Array<{ fileName: string; productType: string }> = [];

    if (body.files && body.files.length > 0) {
      fileSpecs = body.files;
    } else {
      if (!fs.existsSync(UPLOAD_DIR)) {
        return NextResponse.json(
          { error: "Upload directory does not exist" },
          { status: 404 }
        );
      }
      const entries = fs.readdirSync(UPLOAD_DIR);
      const byProduct: Record<string, { name: string; mtime: number }> = {};
      for (const name of entries) {
        if (!name.toLowerCase().endsWith(".xlsx")) continue;
        const pt = detectProductType(name);
        if (!pt) continue;
        const stat = fs.statSync(path.join(UPLOAD_DIR, name));
        if (!byProduct[pt] || stat.mtimeMs > byProduct[pt].mtime) {
          byProduct[pt] = { name, mtime: stat.mtimeMs };
        }
      }
      fileSpecs = Object.entries(byProduct).map(([pt, info]) => ({
        fileName: info.name,
        productType: pt,
      }));
    }

    if (fileSpecs.length === 0) {
      return NextResponse.json({
        ok: false,
        error: "No files to import. Upload files first via /api/excel/upload.",
      }, { status: 400 });
    }

    const results: ImportFileResult[] = [];
    for (const spec of fileSpecs) {
      const filePath = path.join(UPLOAD_DIR, spec.fileName);
      if (!fs.existsSync(filePath)) {
        results.push({
          fileName: spec.fileName,
          productType: spec.productType,
          totalRows: 0,
          validRows: 0,
          pendingSkipped: 0,
          invalidSkipped: 0,
          duplicatesSkipped: 0,
          groups: 0,
          status: "error",
          error: "File not found in upload dir",
        });
        continue;
      }
      const r = await importOneFile(filePath, spec.productType);
      results.push(r);
    }

    const verification: Array<{ productType: string; rows: number; groups: number; pending: number }> = [];
    for (const pt of ["MAFATE", "ONYX", "MIZUNO"]) {
      const rows = await db.masterData.count({ where: { productType: pt } });
      const groups = await db.masterGroup.count({ where: { productType: pt } });
      const pending = await db.masterData.count({
        where: { productType: pt, shippingStatus: { startsWith: "3" } },
      });
      verification.push({ productType: pt, rows, groups, pending });
    }

    return NextResponse.json({
      ok: results.every((r) => r.status === "ok"),
      results,
      verification,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Import failed" },
      { status: 500 }
    );
  }
}
