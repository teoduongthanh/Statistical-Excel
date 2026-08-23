import { db } from "./db";
import { SHARED_FIELDS, type CanonicalField } from "./fields";
import { scoreMatch } from "./fuzzy";
import type {
  AutocompleteSuggestion,
  MasterGroup,
  SharedFlags,
  QtyValidationGroup,
  ProductionStats,
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
  productType: string | null;
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
    productType: row.productType,
    sourceFile: row.sourceFile,
    sheetName: row.sheetName,
    rowIndex: row.rowIndex,
  };
}

// Parse a deadline string into a Date for comparison. Handles Excel serials and yyyy-MM-dd.
function parseDeadline(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  if (!s) return null;
  // Try yyyy-MM-dd or yyyy/MM/dd
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  // Try Excel serial (number of days since 1900-01-01)
  const n = Number(s);
  if (!isNaN(n) && n > 1000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setDate(epoch.getDate() + n);
    return epoch;
  }
  return null;
}

// Rebuild MasterGroup index from MasterData, grouped by (productType + Factory PO).
// Product isolation: groups are scoped by productType to prevent cross-product lookup.
export async function rebuildMasterGroups(sourceFile?: string, productType?: string): Promise<number> {
  const where: any = {};
  if (sourceFile) where.sourceFile = sourceFile;
  if (productType) where.productType = productType;
  const rows = await db.masterData.findMany({
    where,
    orderBy: [{ productType: "asc" }, { factoryPO: "asc" }],
  });

  // Group by productType|factoryPO for isolation.
  const groups = new Map<string, { productType: string; factoryPO: string; rows: typeof rows }>();
  for (const r of rows) {
    const pt = (r.productType || "").trim();
    const fpo = (r.factoryPO || "").trim();
    if (!pt || !fpo) continue;
    const key = `${pt}|${fpo}`;
    if (!groups.has(key)) groups.set(key, { productType: pt, factoryPO: fpo, rows: [] });
    groups.get(key)!.rows.push(r);
  }

  await db.$transaction(async (tx) => {
    if (sourceFile) {
      await tx.masterGroup.deleteMany({ where: { sourceFile } });
    } else if (productType) {
      await tx.masterGroup.deleteMany({ where: { productType } });
    } else {
      await tx.masterGroup.deleteMany({});
    }
    const inserts = [];
    for (const { productType: pt, factoryPO, rows: groupRows } of groups.values()) {
      const sharedFlags: SharedFlags = {};
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
          picked[f] = null;
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
      // Find nearest (earliest) deadline across all rows.
      const deadlines = groupRows
        .map((r) => parseDeadline(r.deadline))
        .filter((d): d is Date => d !== null)
        .sort((a, b) => a.getTime() - b.getTime());
      const nearestDeadline = deadlines.length > 0 ? deadlines[0]!.toISOString().slice(0, 10) : null;

      // Product type: use the most common value, or derive from sourceFile.
      const productTypes = new Set(
        groupRows.map((r) => (r.productType ?? "").toString().trim()).filter(Boolean)
      );
      const productType = productTypes.size === 1 ? [...productTypes][0] : null;

      inserts.push(
        tx.masterGroup.create({
          data: {
            productType: pt,
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
            deadline: picked.deadline ?? null,
            nearestDeadline,
            sizes: JSON.stringify(sizes),
            sharedFlags: JSON.stringify(sharedFlags),
            rowCount: groupRows.length,
            sourceFile: sourceFile ?? null,
          },
        })
      );
    }
    for (let i = 0; i < inserts.length; i += 50) {
      await Promise.all(inserts.slice(i, i + 50));
    }
  });
  return groups.size;
}

// Determine urgency based on deadline.
function deadlineUrgency(deadline: string | null | undefined): "overdue" | "today" | "soon" | "normal" {
  if (!deadline) return "normal";
  const d = parseDeadline(deadline);
  if (!d) return "normal";
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = d.getTime() - now.getTime();
  const dayMs = 86400000;
  if (diff < 0) return "overdue";
  if (diff < dayMs) return "today";
  if (diff < 7 * dayMs) return "soon";
  return "normal";
}

// Autocomplete: pre-filter with SQL LIKE, then fuzzy-score and rank.
// Product isolation: productType is MANDATORY — searches never cross products.
// If prioritizeByDeadline is true, boost scores for Factory POs with nearer deadlines.
export async function searchMaster(
  field: CanonicalField,
  query: string,
  limit = 15,
  prioritizeByDeadline = true,
  productType?: string
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

  // Product-scoped query: only returns rows for the active product.
  const sql = productType
    ? `SELECT DISTINCT "${col}" AS v FROM MasterData
       WHERE productType = ? AND "${col}" IS NOT NULL AND "${col}" != ''
         AND LOWER("${col}") LIKE ?
       LIMIT 200`
    : `SELECT DISTINCT "${col}" AS v FROM MasterData
       WHERE "${col}" IS NOT NULL AND "${col}" != ''
         AND LOWER("${col}") LIKE ?
       LIMIT 200`;
  const rows = productType
    ? await db.$queryRawUnsafe<{ v: string }[]>(sql, productType, like)
    : await db.$queryRawUnsafe<{ v: string }[]>(sql, like);

  const candidates = rows.map((r) => ({ value: r.v, sub: "" }));
  const scored: AutocompleteSuggestion[] = [];
  for (const c of candidates) {
    const s = scoreMatch(q, c.value);
    if (s > 0) scored.push({ value: c.value, label: c.value, score: s });
  }

  // For factoryPO searches, enrich with season/model/deadline and apply urgency boost.
  if (field === "factoryPO" && scored.length > 0) {
    const fpos = scored.map((s) => s.value);
    const groups = await db.masterGroup.findMany({
      where: productType
        ? { productType, factoryPO: { in: fpos } }
        : { factoryPO: { in: fpos } },
      select: { factoryPO: true, model: true, season: true, nearestDeadline: true, productType: true },
    });
    const gmap = new Map(groups.map((g) => [g.factoryPO, g]));
    for (const s of scored) {
      const g = gmap.get(s.value);
      if (g) {
        s.sub = [g.model, g.season].filter(Boolean).join(" · ");
        s.deadline = g.nearestDeadline;
        s.urgency = deadlineUrgency(g.nearestDeadline);
        if (prioritizeByDeadline) {
          if (s.urgency === "overdue") s.score += 300;
          else if (s.urgency === "today") s.score += 200;
          else if (s.urgency === "soon") s.score += 100;
        }
      }
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// Lookup a Factory PO group → shared attributes + sizes.
// Product isolation: looks up by composite (productType + factoryPO).
export async function lookupFactoryPO(
  factoryPO: string,
  productType?: string
): Promise<MasterGroup | null> {
  // Use composite unique key when productType is provided (product isolation).
  // Fallback to first match for backward compatibility.
  const g = productType
    ? await db.masterGroup.findUnique({ where: { productType_factoryPO: { productType, factoryPO } } })
    : await db.masterGroup.findFirst({ where: { factoryPO } });
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
    deadline: g.deadline,
    nearestDeadline: g.nearestDeadline,
    productType: g.productType,
    sizes: JSON.parse(g.sizes || "[]"),
    sharedFlags: JSON.parse(g.sharedFlags || "{}"),
    rowCount: g.rowCount,
    sourceFile: g.sourceFile,
  };
}

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

export async function validateEntry(input: EntryInput, productType?: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const fpo = (input.factoryPO || "").trim();
  const size = (input.size || "").trim();
  const qty1 = (input.qty1 || "").trim();
  if (!fpo) errors.push("Factory PO is required");
  if (!size) errors.push("Size is required");
  if (!qty1) errors.push("Qty 1 is required");
  if (qty1 && isNaN(Number(qty1))) errors.push("Qty 1 must be a number");

  if (errors.length) return { ok: false, errors };

  const group = await lookupFactoryPO(fpo, productType);
  if (!group) {
    return {
      ok: false,
      errors: [`Factory PO "${fpo}" does not exist in ${productType || "any"} Master Data`],
    };
  }
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

export async function createEntry(
  input: EntryInput,
  opts: { autoCalcQty2: boolean; productType?: string }
) {
  const vr = await validateEntry(input, opts.productType);
  if (!vr.ok || !vr.group) {
    return { ok: false as const, errors: vr.errors };
  }
  const g = vr.group;
  const qty1Num = Number(input.qty1);
  const qty2 = opts.autoCalcQty2 ? String(-Math.abs(qty1Num)) : input.qty1;

  const created = await db.entryData.create({
    data: {
      productType: opts.productType || g.productType || "MAFATE",
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
      productType: g.productType,
    },
  });
  return { ok: true as const, entry: created };
}

export async function checkDuplicate(factoryPO: string, size: string) {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const entries = await db.entryData.findMany({
    where: { factoryPO: factoryPO.trim() },
    select: { id: true, size: true, qty1: true, createdAt: true },
  });
  const dup = entries.find((e) => norm(e.size) === norm(size));
  return dup ?? null;
}

// ===== Quantity Validation =====
// Groups master data rows by poNo + factoryPO + size and validates that
// Order, Output, and Input quantities are consistent.
//
// Shipping status values in the data:
//   1.Order  → order quantity (đặt hàng đi gia công)
//   2.Output → output quantity (xuất đi gia công)
//   3.Pending → spending/during processing
//   4.Input  → input quantity (nhận được)
//
// Rule: order = input = output. If any differ, flag as quantity error.
export async function validateQuantities(
  filters?: { factoryPO?: string; poNo?: string; productType?: string }
): Promise<QtyValidationGroup[]> {
  const where: any = { AND: [] };
  if (filters?.factoryPO) where.AND.push({ factoryPO: { contains: filters.factoryPO } });
  if (filters?.poNo) where.AND.push({ poNo: { contains: filters.poNo } });
  if (filters?.productType) where.AND.push({ productType: filters.productType });
  if (where.AND.length === 0) delete where.AND;

  const rows = await db.masterData.findMany({
    where,
    select: {
      poNo: true, factoryPO: true, size: true, model: true,
      shippingStatus: true, qty1: true, deadline: true, productType: true,
    },
  });

  // Group by poNo + factoryPO + size
  const groups = new Map<string, QtyValidationGroup>();
  for (const r of rows) {
    const poNo = (r.poNo || "").trim();
    const fpo = (r.factoryPO || "").trim();
    const size = (r.size || "").trim();
    if (!poNo || !fpo || !size) continue;
    const key = `${poNo}|${fpo}|${size}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key, poNo, factoryPO: fpo, size,
        model: r.model || "",
        productType: r.productType,
        deadline: r.deadline,
        orderQty: null, outputQty: null, inputQty: null, pendingQty: null,
        isConsistent: true, missingQty: null, errors: [],
      });
    }
    const g = groups.get(key)!;
    const qty = Number(r.qty1);
    const qtyNum = isNaN(qty) ? 0 : qty;
    const status = (r.shippingStatus || "").trim().toLowerCase();
    if (status.startsWith("1") || status.includes("order")) {
      g.orderQty = (g.orderQty ?? 0) + qtyNum;
    } else if (status.startsWith("2") || status.includes("output")) {
      g.outputQty = (g.outputQty ?? 0) + qtyNum;
    } else if (status.startsWith("4") || status.includes("input")) {
      g.inputQty = (g.inputQty ?? 0) + qtyNum;
    } else if (status.startsWith("3") || status.includes("pending") || status.includes("spend")) {
      g.pendingQty = (g.pendingQty ?? 0) + qtyNum;
    }
  }

  // Validate consistency.
  for (const g of groups.values()) {
    const errs: string[] = [];
    // Check order = output = input (all three should be equal when present)
    const vals = [g.orderQty, g.outputQty, g.inputQty].filter((v) => v !== null);
    if (vals.length >= 2) {
      const allEqual = vals.every((v) => v === vals[0]);
      if (!allEqual) {
        g.isConsistent = false;
        errs.push(
          `Quantity mismatch: Order=${g.orderQty ?? "—"}, Output=${g.outputQty ?? "—"}, Input=${g.inputQty ?? "—"}`
        );
      }
    }
    // Missing quantity: ordered but not received (order - input)
    if (g.orderQty !== null && g.inputQty !== null) {
      g.missingQty = g.orderQty - g.inputQty;
      if (g.missingQty > 0) {
        errs.push(`Missing ${g.missingQty} units (ordered ${g.orderQty}, received ${g.inputQty})`);
      } else if (g.missingQty < 0) {
        errs.push(`Excess ${Math.abs(g.missingQty)} units (received more than ordered)`);
      }
    }
    g.errors = errs;
  }

  return [...groups.values()].sort((a, b) => {
    // Inconsistent groups first, then by missing qty descending.
    if (a.isConsistent !== b.isConsistent) return a.isConsistent ? 1 : -1;
    return (b.missingQty ?? 0) - (a.missingQty ?? 0);
  });
}

// ===== Production Statistics =====
export async function getProductionStats(
  filters?: { productType?: string; factoryPO?: string }
): Promise<ProductionStats> {
  const where: any = { AND: [] };
  if (filters?.productType) where.AND.push({ productType: filters.productType });
  if (filters?.factoryPO) where.AND.push({ factoryPO: { contains: filters.factoryPO } });
  if (where.AND.length === 0) delete where.AND;

  const rows = await db.masterData.findMany({
    where,
    select: { shippingStatus: true, qty1: true, productType: true, factoryPO: true },
  });

  let totalOrdered = 0, totalSent = 0, totalReceived = 0;
  const byProduct = new Map<string, { ordered: number; sent: number; received: number }>();
  const byFPO = new Map<string, { ordered: number; sent: number; received: number }>();

  for (const r of rows) {
    const qty = Number(r.qty1) || 0;
    const status = (r.shippingStatus || "").trim().toLowerCase();
    const pt = r.productType || "Unknown";
    const fpo = r.factoryPO || "—";

    if (!byProduct.has(pt)) byProduct.set(pt, { ordered: 0, sent: 0, received: 0 });
    if (!byFPO.has(fpo)) byFPO.set(fpo, { ordered: 0, sent: 0, received: 0 });

    const pp = byProduct.get(pt)!;
    const pf = byFPO.get(fpo)!;

    if (status.startsWith("1") || status.includes("order")) {
      totalOrdered += qty; pp.ordered += qty; pf.ordered += qty;
    } else if (status.startsWith("2") || status.includes("output")) {
      totalSent += qty; pp.sent += qty; pf.sent += qty;
    } else if (status.startsWith("4") || status.includes("input")) {
      totalReceived += qty; pp.received += qty; pf.received += qty;
    }
  }

  return {
    totalSent,
    totalReceived,
    totalOrdered,
    completionRate: totalOrdered > 0 ? (totalReceived / totalOrdered) * 100 : 0,
    byProductType: [...byProduct.entries()].map(([productType, v]) => ({ productType, ...v })),
    byFactoryPO: [...byFPO.entries()]
      .map(([factoryPO, v]) => ({ factoryPO, ...v, missing: v.ordered - v.received }))
      .sort((a, b) => Math.abs(b.missing) - Math.abs(a.missing))
      .slice(0, 20),
  };
}
