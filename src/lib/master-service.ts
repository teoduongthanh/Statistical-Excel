import { db } from "./db";
import { SHARED_FIELDS, type CanonicalField } from "./fields";
import { scoreMatch } from "./fuzzy";
import type {
  AutocompleteSuggestion,
  ImportError,
  MasterGroup,
  SharedFlags,
} from "@/types";

// MasterData field columns that are "shared" (constant per Factory PO) vs variable.
const SHARED_COLS: CanonicalField[] = [
  "model",
  "sku",
  "poNo",
  "item",
  "season",
  "colorCode",
  "colorCode2",
  "painting",
  "printingColor",
];
const META_SHARED: CanonicalField[] = ["date", "shippingStatus", "deadline"];

// Convert a DB master_data row to a plain object (string values).
export function masterRowToObj(row: {
  id: string;
  date: string | null;
  shippingStatus: string | null;
  model: string | null;
  sku: string | null;
  poNo: string | null;
  factoryPO: string | null;
  item: string | null;
  season: string | null;
  colorCode: string | null;
  colorCode2: string | null;
  painting: string | null;
  printingColor: string | null;
  size: string | null;
  qty1: string | null;
  qty2: string | null;
  deadline: string | null;
  sourceFile: string | null;
  sheetName: string | null;
  rowIndex: number;
}) {
  return {
    id: row.id,
    date: row.date,
    shippingStatus: row.shippingStatus,
    model: row.model,
    sku: row.sku,
    poNo: row.poNo,
    factoryPO: row.factoryPO,
    item: row.item,
    season: row.season,
    colorCode: row.colorCode,
    colorCode2: row.colorCode2,
    painting: row.painting,
    printingColor: row.printingColor,
    size: row.size,
    qty1: row.qty1,
    qty2: row.qty2,
    deadline: row.deadline,
    sourceFile: row.sourceFile,
    sheetName: row.sheetName,
    rowIndex: row.rowIndex,
  };
}

// Rebuild MasterGroup index from MasterData, grouped by Factory PO.
// Computes shared attributes (single-valued across group) and the sizes list.
export async function rebuildMasterGroups(sourceFile?: string): Promise<number> {
  const where = sourceFile ? { sourceFile } : {};
  const rows = await db.masterData.findMany({
    where,
    orderBy: { factoryPO: "asc" },
  });

  // Group by factoryPO.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = (r.factoryPO || "").trim();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  // Replace existing groups (for the same source scope).
  await db.$transaction(async (tx) => {
    if (sourceFile) {
      await tx.masterGroup.deleteMany({ where: { sourceFile } });
    } else {
      await tx.masterGroup.deleteMany({});
    }
    const inserts = [];
    for (const [factoryPO, groupRows] of groups) {
      const sharedFlags: SharedFlags = {};
      const first = groupRows[0];
      const picked: Record<string, string | null> = {};
      for (const f of SHARED_COLS) {
        const vals = new Set(
          groupRows.map((r) => (r[f] ?? "").toString().trim()).filter(Boolean)
        );
        if (vals.size === 1) {
          sharedFlags[f as keyof SharedFlags] = true;
          picked[f] = [...vals][0];
        } else if (vals.size > 1) {
          sharedFlags[f as keyof SharedFlags] = false;
          picked[f] = null; // multiple values
        } else {
          sharedFlags[f as keyof SharedFlags] = true;
          picked[f] = "";
        }
      }
      for (const f of META_SHARED) {
        const vals = new Set(
          groupRows.map((r) => (r[f] ?? "").toString().trim()).filter(Boolean)
        );
        if (vals.size === 1) {
          sharedFlags[f as keyof SharedFlags] = true;
          picked[f] = [...vals][0];
        } else {
          sharedFlags[f as keyof SharedFlags] = false;
          picked[f] = null;
        }
      }
      const sizes = [...new Set(groupRows.map((r) => (r.size ?? "").toString().trim()).filter(Boolean))];
      inserts.push(
        tx.masterGroup.create({
          data: {
            factoryPO,
            date: picked.date ?? null,
            shippingStatus: picked.shippingStatus ?? null,
            model: picked.model ?? null,
            sku: picked.sku ?? null,
            poNo: picked.poNo ?? null,
            item: picked.item ?? null,
            season: picked.season ?? null,
            colorCode: picked.colorCode ?? null,
            colorCode2: picked.colorCode2 ?? null,
            painting: picked.painting ?? null,
            printingColor: picked.printingColor ?? null,
            sizes: JSON.stringify(sizes),
            sharedFlags: JSON.stringify(sharedFlags),
            rowCount: groupRows.length,
            sourceFile: sourceFile ?? null,
          },
        })
      );
    }
    // Run inserts in batches to avoid huge transactions.
    for (let i = 0; i < inserts.length; i += 50) {
      await Promise.all(inserts.slice(i, i + 50));
    }
  });
  return groups.size;
}

// Autocomplete: pre-filter with SQL LIKE, then fuzzy-score and rank.
export async function searchMaster(
  field: CanonicalField,
  query: string,
  limit = 15
): Promise<AutocompleteSuggestion[]> {
  const q = query.trim();
  if (!q) return [];
  const valid: CanonicalField[] = [
    "factoryPO",
    "sku",
    "poNo",
    "model",
    "item",
    "season",
    "colorCode",
    "colorCode2",
    "painting",
    "printingColor",
    "shippingStatus",
    "size",
  ];
  if (!valid.includes(field)) return [];

  const colMap: Record<string, string> = {
    factoryPO: "factoryPO",
    sku: "sku",
    poNo: "poNo",
    model: "model",
    item: "item",
    season: "season",
    colorCode: "colorCode",
    colorCode2: "colorCode2",
    painting: "painting",
    printingColor: "printingColor",
    shippingStatus: "shippingStatus",
    size: "size",
  };
  const col = colMap[field];
  const like = `%${q.toLowerCase()}%`;

  // $queryRawUnsafe with a validated column identifier (col is from a fixed allowlist)
  // and a bound parameter for the LIKE value (injection-safe).
  const rows = await db.$queryRawUnsafe<{ v: string }[]>(
    `SELECT DISTINCT "${col}" AS v FROM MasterData
     WHERE "${col}" IS NOT NULL AND "${col}" != ''
       AND LOWER("${col}") LIKE ?
     LIMIT 200`,
    like
  );

  const candidates = rows.map((r) => ({ value: r.v, sub: "" }));
  const scored: AutocompleteSuggestion[] = [];
  for (const c of candidates) {
    const s = scoreMatch(q, c.value);
    if (s > 0) scored.push({ value: c.value, label: c.value, score: s });
  }
  // For factoryPO searches, enrich with season/model as sub.
  if (field === "factoryPO" && scored.length > 0) {
    const fpos = scored.map((s) => s.value);
    const groups = await db.masterGroup.findMany({
      where: { factoryPO: { in: fpos } },
      select: { factoryPO: true, model: true, season: true },
    });
    const gmap = new Map(groups.map((g) => [g.factoryPO, g]));
    for (const s of scored) {
      const g = gmap.get(s.value);
      if (g) s.sub = [g.model, g.season].filter(Boolean).join(" · ");
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// Lookup a Factory PO group → shared attributes + sizes.
export async function lookupFactoryPO(
  factoryPO: string
): Promise<MasterGroup | null> {
  const g = await db.masterGroup.findUnique({ where: { factoryPO } });
  if (!g) return null;
  return {
    id: g.id,
    factoryPO: g.factoryPO,
    date: g.date,
    shippingStatus: g.shippingStatus,
    model: g.model,
    sku: g.sku,
    poNo: g.poNo,
    item: g.item,
    season: g.season,
    colorCode: g.colorCode,
    colorCode2: g.colorCode2,
    painting: g.painting,
    printingColor: g.printingColor,
    sizes: JSON.parse(g.sizes || "[]"),
    sharedFlags: JSON.parse(g.sharedFlags || "{}"),
    rowCount: g.rowCount,
    sourceFile: g.sourceFile,
  };
}

// Validate a single entry input against master data.
export interface EntryInput {
  factoryPO: string;
  size: string;
  qty1: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  group?: MasterGroup;
}

export async function validateEntry(input: EntryInput): Promise<ValidationResult> {
  const errors: string[] = [];
  const fpo = (input.factoryPO || "").trim();
  const size = (input.size || "").trim();
  const qty1 = (input.qty1 || "").trim();
  if (!fpo) errors.push("Factory PO is required");
  if (!size) errors.push("Size is required");
  if (!qty1) errors.push("Qty 1 is required");
  if (qty1 && isNaN(Number(qty1))) errors.push("Qty 1 must be a number");

  if (errors.length) return { ok: false, errors };

  const group = await lookupFactoryPO(fpo);
  if (!group) {
    return { ok: false, errors: ["Factory PO does not exist in Master Data"] };
  }
  // Normalize size comparison (ignore newlines).
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const sizeExists = group.sizes.some((s) => norm(s) === norm(size));
  if (!sizeExists) {
    return {
      ok: false,
      errors: [`Size "${size}" does not belong to Factory PO ${fpo}`],
      group,
    };
  }
  return { ok: true, errors: [], group };
}

// Create an entry row from validated input.
export async function createEntry(
  input: EntryInput,
  opts: { autoCalcQty2: boolean }
) {
  const vr = await validateEntry(input);
  if (!vr.ok || !vr.group) {
    return { ok: false as const, errors: vr.errors };
  }
  const g = vr.group;
  const qty1Num = Number(input.qty1);
  const qty2 = opts.autoCalcQty2 ? String(-Math.abs(qty1Num)) : input.qty1;

  const created = await db.entryData.create({
    data: {
      factoryPO: input.factoryPO.trim(),
      size: input.size.trim(),
      qty1: input.qty1.trim(),
      qty2,
      date: g.date,
      shippingStatus: g.shippingStatus,
      model: g.model,
      sku: g.sku,
      poNo: g.poNo,
      item: g.item,
      season: g.season,
      colorCode: g.colorCode,
      colorCode2: g.colorCode2,
      painting: g.painting,
      printingColor: g.printingColor,
      deadline: g.deadline,
    },
  });
  return { ok: true as const, entry: created };
}

// Check duplicate (factoryPO + size) in entries.
export async function checkDuplicate(factoryPO: string, size: string) {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const entries = await db.entryData.findMany({
    where: { factoryPO: factoryPO.trim() },
    select: { id: true, size: true, qty1: true, createdAt: true },
  });
  const dup = entries.find((e) => norm(e.size) === norm(size));
  return dup ?? null;
}
