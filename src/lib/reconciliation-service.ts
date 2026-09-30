// Reconciliation Service
// Đối soát dữ liệu đối tác (Partner Excel) với dữ liệu Website (MongoDB).
//
// Workflow (spec §36):
//   1. Parse Partner Excel (3 sheets: orders, order_size_summary, transactions)
//   2. Normalize PO/FactoryPO/Size
//   3. Aggregate Partner transactions (GROUP BY PO+FactoryPO+Size, SUM qty)
//   4. Load Website data (MasterData) for the same productType
//   5. Match by business key (PO NO# + Factory PO + Size)
//   6. Compare Order/OUT/IN
//   7. Detect: mismatch / missing / duplicate / over qty / date diff
//   8. Generate ReconciliationResult rows + summary
//
// CRITICAL (spec §35, §52): This service NEVER modifies Website data.
// It only READS, COMPARES, and REPORTS.

import { db } from "./db";
import * as XLSX from "xlsx";
import * as fs from "fs";
import { classifyShippingStatus } from "./quantity-service";
import { formatDateDisplay } from "./utils";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PartnerOrder {
  orderId: string;
  sddDate: string | null;
  model: string | null;
  purchasePo: string | null; // → Website Factory PO
  po: string | null; // → Website PO NO#
  purchasePo2: string | null;
  po2: string | null;
  colorCode: string | null;
  orderTotalQty: number;
}

export interface PartnerSizeSummary {
  orderId: string;
  size: string;
  orderQty: number;
  totalIn: number;
  balIn: number;
  totalOut: number;
  balOut: number;
}

export interface PartnerTransaction {
  transactionId: string;
  orderId: string;
  type: string; // "OUT" | "IN" (default mapping)
  date: string | null; // Excel serial or string
  size: string;
  qty: number;
}

export interface PartnerData {
  orders: PartnerOrder[];
  summary: PartnerSizeSummary[];
  transactions: PartnerTransaction[];
  orderMap: Map<string, PartnerOrder>; // orderId → order
}

export interface WebsiteAggRow {
  poNo: string;
  factoryPO: string;
  size: string;
  model: string | null;
  sku: string | null;
  colorCode: string | null;
  orderQty: number;
  outputQty: number;
  inputQty: number;
  // Transactions by date for date-distribution check
  outputByDate: Map<string, number>; // "yyyy-MM-dd" → qty
  inputByDate: Map<string, number>;
}

export interface CompareResult {
  poNo: string;
  factoryPO: string;
  size: string;
  model: string | null;
  sku: string | null;
  colorCode: string | null;
  partnerOrderQty: number;
  partnerOutQty: number;
  partnerInQty: number;
  websiteOrderQty: number;
  websiteOutputQty: number;
  websiteInputQty: number;
  orderDifference: number;
  outDifference: number;
  inDifference: number;
  pendingPartner: number;
  pendingWebsite: number;
  remainingOrder: number;
  status: string;
  issues: string[];
  reason: string | null;
  partnerTransactions: Array<{ date: string; type: string; qty: number }>;
  websiteTransactions: Array<{ date: string; type: string; qty: number }>;
  dateDiff: boolean;
}

export interface ReconciliationSummary {
  totalLines: number;
  matchedLines: number;
  mismatchLines: number;
  missingOnWebsite: number;
  missingOnPartner: number;
  duplicateLines: number;
  overOutputLines: number;
  overInputLines: number;
  dateDiffLines: number;
  invalidLines: number;
  totalOrderQty: number;
  totalPartnerOut: number;
  totalWebsiteOutput: number;
  totalPartnerIn: number;
  totalWebsiteInput: number;
}

export interface MappingConfig {
  ordersSheet: string;
  summarySheet: string;
  transactionsSheet: string;
  partnerOutType: string; // default "OUT"
  partnerInType: string; // default "IN"
  partnerPoField: string; // default "po" → Website PO NO#
  partnerPurchasePoField: string; // default "purchase_po" → Website Factory PO
}

export const DEFAULT_MAPPING: MappingConfig = {
  ordersSheet: "orders",
  summarySheet: "order_size_summary",
  transactionsSheet: "transactions",
  partnerOutType: "OUT",
  partnerInType: "IN",
  partnerPoField: "po",
  partnerPurchasePoField: "purchase_po",
};

// ── Normalize helpers (spec §17, §18) ────────────────────────────────────────

// Normalize PO/Size: trim + collapse whitespace + remove line breaks.
// PRESERVES the T suffix (M10 ≠ M10T). Does NOT change any other chars.
export function normalizeKey(s: string | null | undefined): string {
  if (!s) return "";
  return String(s)
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Format Excel serial date → yyyy-MM-dd (for storage + comparison).
// Handles both numeric serials and dd/MM/yyyy strings.
export function normalizeDate(s: string | null | undefined): string {
  if (!s) return "";
  const v = String(s).trim();
  if (!v) return "";
  // Excel serial (number)
  const n = Number(v);
  if (!isNaN(n) && n > 30000 && n < 80000) {
    // Excel epoch: 1899-12-30
    const ms = Math.round((n - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }
  // Already yyyy-MM-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  // dd/MM/yyyy → yyyy-MM-dd
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    return `${m[3]}-${mm}-${dd}`;
  }
  // Fallback: try Date parse
  const d = new Date(v);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return v;
}

// ── Parse Partner Excel (spec §36 step 1) ───────────────────────────────────

export interface ParsePreview {
  fileName: string;
  sheets: string[];
  ordersCount: number;
  summaryCount: number;
  transactionsCount: number;
  headers: {
    orders: string[];
    summary: string[];
    transactions: string[];
  };
  preview: {
    orders: PartnerOrder[];
    summary: PartnerSizeSummary[];
    transactions: PartnerTransaction[];
  };
}

export function parsePartnerExcel(
  filePath: string,
  mapping: MappingConfig = DEFAULT_MAPPING
): PartnerData {
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, {
    type: "buffer",
    cellDates: false,
    dense: true,
    sheetStubs: false,
  });

  const ordersSheet =
    wb.SheetNames.find((n) => n.toLowerCase() === mapping.ordersSheet.toLowerCase()) ||
    wb.SheetNames.find((n) => n.toLowerCase().includes("order") && !n.toLowerCase().includes("size") && !n.toLowerCase().includes("summary") && !n.toLowerCase().includes("transaction"));
  const summarySheet =
    wb.SheetNames.find((n) => n.toLowerCase() === mapping.summarySheet.toLowerCase()) ||
    wb.SheetNames.find((n) => n.toLowerCase().includes("size") || n.toLowerCase().includes("summary"));
  const transactionsSheet =
    wb.SheetNames.find((n) => n.toLowerCase() === mapping.transactionsSheet.toLowerCase()) ||
    wb.SheetNames.find((n) => n.toLowerCase().includes("transaction"));

  if (!ordersSheet || !summarySheet || !transactionsSheet) {
    throw new Error(
      `Cannot find required sheets. Need: ${mapping.ordersSheet}, ${mapping.summarySheet}, ${mapping.transactionsSheet}. ` +
        `Available: ${wb.SheetNames.join(", ")}`
    );
  }

  const orders = parseSheet(ordersSheet, wb, parseOrderRow) as PartnerOrder[];
  const summary = parseSheet(summarySheet, wb, parseSummaryRow) as PartnerSizeSummary[];
  const transactions = parseSheet(transactionsSheet, wb, parseTxRow) as PartnerTransaction[];

  const orderMap = new Map<string, PartnerOrder>();
  for (const o of orders) orderMap.set(o.orderId, o);

  return { orders, summary, transactions, orderMap };
}

function parseSheet<T>(
  sheetName: string,
  wb: XLSX.WorkBook,
  rowParser: (row: Record<string, string>, headers: string[]) => T
): T[] {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const raw = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  }) as unknown[][];
  if (raw.length < 2) return [];
  const headers = (raw[0] as unknown[]).map((h, i) => {
    const s = String(h ?? "").trim();
    return s || `Column_${i + 1}`;
  });
  const out: T[] = [];
  for (let i = 1; i < raw.length; i++) {
    const arr = raw[i] as unknown[];
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const v = arr[c];
      obj[headers[c]] = v === undefined || v === null ? "" : String(v).trim();
    }
    out.push(rowParser(obj, headers));
  }
  return out;
}

function num(s: string | undefined): number {
  if (!s) return 0;
  const n = Number(String(s).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
}

function parseOrderRow(row: Record<string, string>): PartnerOrder {
  return {
    orderId: row.order_id ?? "",
    sddDate: row.sdd_date ?? null,
    model: row.model ?? null,
    purchasePo: row.purchase_po ?? null,
    po: row.po ?? null,
    purchasePo2: row.purchase_po_2 ?? null,
    po2: row.po_2 ?? null,
    colorCode: row.color_code ?? null,
    orderTotalQty: num(row.order_total_qty),
  };
}

function parseSummaryRow(row: Record<string, string>): PartnerSizeSummary {
  return {
    orderId: row.order_id ?? "",
    size: row.size ?? "",
    orderQty: num(row.order_qty),
    totalIn: num(row.total_in),
    balIn: num(row.bal_in),
    totalOut: num(row.total_out),
    balOut: num(row.bal_out),
  };
}

function parseTxRow(row: Record<string, string>): PartnerTransaction {
  return {
    transactionId: row.transaction_id ?? "",
    orderId: row.order_id ?? "",
    type: (row.type ?? "").toUpperCase().trim(),
    date: row.date ?? null,
    size: row.size ?? "",
    qty: num(row.qty),
  };
}

// ── Preview (spec §37) ──────────────────────────────────────────────────────

export function previewPartnerExcel(filePath: string, mapping: MappingConfig = DEFAULT_MAPPING): ParsePreview {
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: "buffer", dense: true, sheetStubs: false });
  const data = parsePartnerExcel(filePath, mapping);
  // Re-parse for headers preview
  const ordersSheet = wb.SheetNames.find((n) => n.toLowerCase() === mapping.ordersSheet.toLowerCase());
  const summarySheet = wb.SheetNames.find((n) => n.toLowerCase() === mapping.summarySheet.toLowerCase());
  const transactionsSheet = wb.SheetNames.find((n) => n.toLowerCase() === mapping.transactionsSheet.toLowerCase());

  const getHeaders = (sheetName?: string): string[] => {
    if (!sheetName) return [];
    const ws = wb.Sheets[sheetName];
    if (!ws) return [];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "", blankrows: false }) as unknown[][];
    if (raw.length === 0) return [];
    return (raw[0] as unknown[]).map((h) => String(h ?? "").trim());
  };

  return {
    fileName: filePath.split("/").pop() || "",
    sheets: wb.SheetNames,
    ordersCount: data.orders.length,
    summaryCount: data.summary.length,
    transactionsCount: data.transactions.length,
    headers: {
      orders: getHeaders(ordersSheet),
      summary: getHeaders(summarySheet),
      transactions: getHeaders(transactionsSheet),
    },
    preview: {
      orders: data.orders.slice(0, 3),
      summary: data.summary.slice(0, 3),
      transactions: data.transactions.slice(0, 3),
    },
  };
}

// ── Aggregate Partner (spec §6: GROUP BY business key, SUM qty) ─────────────

interface PartnerAggRow {
  poNo: string;
  factoryPO: string;
  size: string;
  model: string | null;
  colorCode: string | null;
  orderQty: number;
  outQty: number;
  inQty: number;
  outByDate: Map<string, number>;
  inByDate: Map<string, number>;
  partnerTransactions: Array<{ date: string; type: string; qty: number }>;
}

export function aggregatePartner(
  data: PartnerData,
  mapping: MappingConfig = DEFAULT_MAPPING,
  dateFrom?: string,
  dateTo?: string
): Map<string, PartnerAggRow> {
  const result = new Map<string, PartnerAggRow>();

  // Build order_id → PO/FactoryPO lookup
  const orderLookup = data.orderMap;

  // 1. Aggregate from order_size_summary for order_qty + initial OUT/IN
  // (We'll use transactions for OUT/IN sums — more accurate per spec §10)
  // But order_qty comes from summary.
  const summaryByKey = new Map<string, { orderQty: number; model: string | null; colorCode: string | null }>();
  for (const s of data.summary) {
    const order = orderLookup.get(s.orderId);
    if (!order) continue;
    const poNo = normalizeKey(order.po);
    const factoryPO = normalizeKey(order.purchasePo);
    const size = normalizeKey(s.size);
    if (!poNo || !factoryPO || !size) continue;
    const key = `${poNo}|${factoryPO}|${size}`;
    const existing = summaryByKey.get(key);
    if (existing) {
      existing.orderQty += s.orderQty;
    } else {
      summaryByKey.set(key, {
        orderQty: s.orderQty,
        model: order.model,
        colorCode: order.colorCode,
      });
    }
  }

  // 2. Aggregate transactions (OUT/IN by date)
  const txByKey = new Map<string, PartnerAggRow>();
  for (const t of data.transactions) {
    const order = orderLookup.get(t.orderId);
    if (!order) continue;
    const poNo = normalizeKey(order.po);
    const factoryPO = normalizeKey(order.purchasePo);
    const size = normalizeKey(t.size);
    if (!poNo || !factoryPO || !size) continue;
    if (t.qty === 0) continue;

    // Date filter (spec §27)
    const dateStr = normalizeDate(t.date);
    if (dateFrom && dateStr && dateStr < dateFrom) continue;
    if (dateTo && dateStr && dateStr > dateTo) continue;

    const key = `${poNo}|${factoryPO}|${size}`;
    let row = txByKey.get(key);
    if (!row) {
      const sm = summaryByKey.get(key);
      row = {
        poNo,
        factoryPO,
        size,
        model: sm?.model ?? order.model ?? null,
        colorCode: sm?.colorCode ?? order.colorCode ?? null,
        orderQty: sm?.orderQty ?? 0,
        outQty: 0,
        inQty: 0,
        outByDate: new Map(),
        inByDate: new Map(),
        partnerTransactions: [],
      };
      txByKey.set(key, row);
    }

    if (t.type === mapping.partnerOutType) {
      row.outQty += t.qty;
      if (dateStr) row.outByDate.set(dateStr, (row.outByDate.get(dateStr) ?? 0) + t.qty);
      row.partnerTransactions.push({ date: dateStr || "?", type: "OUT", qty: t.qty });
    } else if (t.type === mapping.partnerInType) {
      row.inQty += t.qty;
      if (dateStr) row.inByDate.set(dateStr, (row.inByDate.get(dateStr) ?? 0) + t.qty);
      row.partnerTransactions.push({ date: dateStr || "?", type: "IN", qty: t.qty });
    }
  }

  // 3. Merge: include keys that exist in summary but no transactions
  for (const [key, sm] of summaryByKey) {
    if (!txByKey.has(key)) {
      txByKey.set(key, {
        poNo: sm.model ? sm.model.split("|")[0] : "", // placeholder
        factoryPO: "",
        size: "",
        model: sm.model,
        colorCode: sm.colorCode,
        orderQty: sm.orderQty,
        outQty: 0,
        inQty: 0,
        outByDate: new Map(),
        inByDate: new Map(),
        partnerTransactions: [],
      });
      // Reconstruct from key
      const [poNo, factoryPO, size] = key.split("|");
      const row = txByKey.get(key)!;
      row.poNo = poNo;
      row.factoryPO = factoryPO;
      row.size = size;
    }
  }

  return txByKey;
}

// ── Load Website data (spec §50: load all, build Map) ────────────────────────

export async function loadWebsiteData(
  productType: string,
  dateFrom?: string,
  dateTo?: string
): Promise<Map<string, WebsiteAggRow>> {
  // Load ALL MasterData for this productType (one query, in-memory aggregation).
  // This is much faster than per-row queries (spec §50).
  const rows = await db.masterData.findMany({
    where: { productType },
    select: {
      poNo: true,
      factoryPO: true,
      size: true,
      model: true,
      sku: true,
      colorCode: true,
      shippingStatus: true,
      qty1: true,
      date: true,
    },
  });

  const map = new Map<string, WebsiteAggRow>();
  for (const r of rows) {
    const poNo = normalizeKey(r.poNo);
    const factoryPO = normalizeKey(r.factoryPO);
    const size = normalizeKey(r.size);
    if (!poNo || !factoryPO || !size) continue;

    const dateStr = normalizeDate(r.date);
    // Date filter for transactions (Output/Input only — Order is not date-filtered)
    const bucket = classifyShippingStatus(r.shippingStatus);
    if ((bucket === "output" || bucket === "input") && dateFrom && dateStr && dateStr < dateFrom) continue;
    if ((bucket === "output" || bucket === "input") && dateTo && dateStr && dateStr > dateTo) continue;

    const key = `${poNo}|${factoryPO}|${size}`;
    let row = map.get(key);
    if (!row) {
      row = {
        poNo,
        factoryPO,
        size,
        model: r.model,
        sku: r.sku,
        colorCode: r.colorCode,
        orderQty: 0,
        outputQty: 0,
        inputQty: 0,
        outputByDate: new Map(),
        inputByDate: new Map(),
      };
      map.set(key, row);
    }
    const qty = r.qty1 ?? 0;
    if (bucket === "order") row.orderQty += qty;
    else if (bucket === "output") {
      row.outputQty += qty;
      if (dateStr) row.outputByDate.set(dateStr, (row.outputByDate.get(dateStr) ?? 0) + qty);
    } else if (bucket === "input") {
      row.inputQty += qty;
      if (dateStr) row.inputByDate.set(dateStr, (row.inputByDate.get(dateStr) ?? 0) + qty);
    }
  }

  return map;
}

// ── Compare (spec §7, §8, §9, §10, §11) ───────────────────────────────────────

export function compareAggregates(
  partner: Map<string, PartnerAggRow>,
  website: Map<string, WebsiteAggRow>
): CompareResult[] {
  const results: CompareResult[] = [];
  const allKeys = new Set<string>([...partner.keys(), ...website.keys()]);

  for (const key of allKeys) {
    const p = partner.get(key);
    const w = website.get(key);
    const poNo = p?.poNo ?? w?.poNo ?? "";
    const factoryPO = p?.factoryPO ?? w?.factoryPO ?? "";
    const size = p?.size ?? w?.size ?? "";

    const partnerOrderQty = p?.orderQty ?? 0;
    const partnerOutQty = p?.outQty ?? 0;
    const partnerInQty = p?.inQty ?? 0;
    const websiteOrderQty = w?.orderQty ?? 0;
    const websiteOutputQty = w?.outputQty ?? 0;
    const websiteInputQty = w?.inputQty ?? 0;

    const orderDifference = partnerOrderQty - websiteOrderQty;
    const outDifference = partnerOutQty - websiteOutputQty;
    const inDifference = partnerInQty - websiteInputQty;

    const pendingPartner = partnerOutQty - partnerInQty;
    const pendingWebsite = websiteOutputQty - websiteInputQty;
    const remainingOrder = websiteOrderQty - websiteOutputQty;

    const issues: string[] = [];
    const reasons: string[] = [];
    let status = "MATCHED";

    // Missing checks (spec §21)
    if (p && !w) {
      status = "MISSING_ON_WEBSITE";
      issues.push("MISSING_ON_WEBSITE");
      reasons.push(
        `Partner has data (Order=${partnerOrderQty}, OUT=${partnerOutQty}, IN=${partnerInQty}) but Website has no matching line for PO=${poNo} / FactoryPO=${factoryPO} / Size=${size}.`
      );
    } else if (!p && w) {
      status = "MISSING_ON_PARTNER";
      issues.push("MISSING_ON_PARTNER");
      reasons.push(
        `Website has data (Order=${websiteOrderQty}, Output=${websiteOutputQty}, Input=${websiteInputQty}) but Partner file has no matching line for PO=${poNo} / FactoryPO=${factoryPO} / Size=${size}.`
      );
    } else if (p && w) {
      // Quantity comparisons (spec §7, §8, §9)
      if (orderDifference !== 0) {
        issues.push("ORDER_QTY_MISMATCH");
        reasons.push(
          `Order Qty mismatch: Partner=${partnerOrderQty}, Website=${websiteOrderQty}, Difference=${orderDifference > 0 ? "+" : ""}${orderDifference}.`
        );
        status = "ORDER_QTY_MISMATCH";
      }
      if (outDifference !== 0) {
        issues.push("OUTPUT_MISMATCH");
        reasons.push(
          `OUT mismatch: Partner OUT=${partnerOutQty}, Website Output=${websiteOutputQty}, Difference=${outDifference > 0 ? "+" : ""}${outDifference}.`
        );
        if (status === "MATCHED") status = "OUTPUT_MISMATCH";
      }
      if (inDifference !== 0) {
        issues.push("INPUT_MISMATCH");
        reasons.push(
          `IN mismatch: Partner IN=${partnerInQty}, Website Input=${websiteInputQty}, Difference=${inDifference > 0 ? "+" : ""}${inDifference}.`
        );
        if (status === "MATCHED") status = "INPUT_MISMATCH";
      }

      // Over quantity (spec §22, §46)
      if (partnerOutQty > partnerOrderQty && partnerOrderQty > 0) {
        issues.push("OVER_OUTPUT");
        reasons.push(
          `Over Output: Partner OUT=${partnerOutQty} exceeds Order Qty=${partnerOrderQty} by ${partnerOutQty - partnerOrderQty}.`
        );
        if (status === "MATCHED") status = "OVER_OUTPUT";
      }
      if (websiteOutputQty > websiteOrderQty && websiteOrderQty > 0) {
        issues.push("OVER_OUTPUT");
        reasons.push(
          `Over Output: Website Output=${websiteOutputQty} exceeds Order Qty=${websiteOrderQty} by ${websiteOutputQty - websiteOrderQty}.`
        );
        if (status === "MATCHED") status = "OVER_OUTPUT";
      }
      if (partnerInQty > partnerOutQty && partnerOutQty > 0) {
        issues.push("OVER_INPUT");
        reasons.push(
          `Over Input: Partner IN=${partnerInQty} exceeds Partner OUT=${partnerOutQty} by ${partnerInQty - partnerOutQty}.`
        );
        if (status === "MATCHED") status = "OVER_INPUT";
      }
      if (websiteInputQty > websiteOutputQty && websiteOutputQty > 0) {
        issues.push("OVER_INPUT");
        reasons.push(
          `Over Input: Website Input=${websiteInputQty} exceeds Website Output=${websiteOutputQty} by ${websiteInputQty - websiteOutputQty}.`
        );
        if (status === "MATCHED") status = "OVER_INPUT";
      }

      // Still with partner (spec §11)
      if (pendingPartner > 0 && issues.length === 0) {
        // Not an error per se — informational. Only flag if also >0 diff already.
      }

      // Date distribution mismatch (spec §15, §16, §33)
      let dateDiff = false;
      if (outDifference === 0 && p && w) {
        // Total OUT matches — check date distribution
        const pDates = new Set(p.outByDate.keys());
        const wDates = new Set(w.outputByDate.keys());
        if (pDates.size > 0 || wDates.size > 0) {
          for (const d of new Set([...pDates, ...wDates])) {
            const pv = p.outByDate.get(d) ?? 0;
            const wv = w.outputByDate.get(d) ?? 0;
            if (pv !== wv) {
              dateDiff = true;
              break;
            }
          }
        }
      }
      if (!dateDiff && inDifference === 0 && p && w) {
        const pDates = new Set(p.inByDate.keys());
        const wDates = new Set(w.inputByDate.keys());
        if (pDates.size > 0 || wDates.size > 0) {
          for (const d of new Set([...pDates, ...wDates])) {
            const pv = p.inByDate.get(d) ?? 0;
            const wv = w.inputByDate.get(d) ?? 0;
            if (pv !== wv) {
              dateDiff = true;
              break;
            }
          }
        }
      }
      if (dateDiff) {
        issues.push("DATE_DISTRIBUTION_MISMATCH");
        reasons.push(
          `Date distribution mismatch: total qty matches but transactions occur on different dates.`
        );
        if (status === "MATCHED") status = "DATE_DISTRIBUTION_MISMATCH";
      }

      // Invalid data (spec §46)
      if (partnerOrderQty < 0 || partnerOutQty < 0 || partnerInQty < 0) {
        issues.push("INVALID_DATA");
        reasons.push(`Invalid data: Partner has negative quantity (Order=${partnerOrderQty}, OUT=${partnerOutQty}, IN=${partnerInQty}).`);
        if (status === "MATCHED") status = "INVALID_DATA";
      }
    }

    results.push({
      poNo,
      factoryPO,
      size,
      model: p?.model ?? w?.model ?? null,
      sku: w?.sku ?? null,
      colorCode: p?.colorCode ?? w?.colorCode ?? null,
      partnerOrderQty,
      partnerOutQty,
      partnerInQty,
      websiteOrderQty,
      websiteOutputQty,
      websiteInputQty,
      orderDifference,
      outDifference,
      inDifference,
      pendingPartner,
      pendingWebsite,
      remainingOrder,
      status,
      issues,
      reason: reasons.join(" ") || null,
      partnerTransactions: p?.partnerTransactions ?? [],
      websiteTransactions: buildWebsiteTxList(w),
      dateDiff: issues.includes("DATE_DISTRIBUTION_MISMATCH"),
    });
  }

  return results;
}

function buildWebsiteTxList(w?: WebsiteAggRow): Array<{ date: string; type: string; qty: number }> {
  if (!w) return [];
  const out: Array<{ date: string; type: string; qty: number }> = [];
  for (const [d, q] of w.outputByDate) out.push({ date: d, type: "Output", qty: q });
  for (const [d, q] of w.inputByDate) out.push({ date: d, type: "Input", qty: q });
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// ── Detect duplicates (spec §11 POSSIBLE_DUPLICATE) ─────────────────────────

export function detectDuplicates(data: PartnerData): Set<string> {
  // Key: orderId|size|type|date|qty — if appears >1 time → duplicate
  const seen = new Map<string, number>();
  const dupKeys = new Set<string>();
  for (const t of data.transactions) {
    const order = data.orderMap.get(t.orderId);
    if (!order) continue;
    const poNo = normalizeKey(order.po);
    const factoryPO = normalizeKey(order.purchasePo);
    const size = normalizeKey(t.size);
    const dateStr = normalizeDate(t.date);
    const key = `${poNo}|${factoryPO}|${size}|${dateStr}|${t.type}|${t.qty}`;
    const c = (seen.get(key) ?? 0) + 1;
    seen.set(key, c);
    if (c > 1) dupKeys.add(`${poNo}|${factoryPO}|${size}`);
  }
  return dupKeys;
}

// ── Build summary (spec §24) ─────────────────────────────────────────────────

export function buildSummary(results: CompareResult[], duplicateKeys: Set<string>): ReconciliationSummary {
  const summary: ReconciliationSummary = {
    totalLines: results.length,
    matchedLines: 0,
    mismatchLines: 0,
    missingOnWebsite: 0,
    missingOnPartner: 0,
    duplicateLines: 0,
    overOutputLines: 0,
    overInputLines: 0,
    dateDiffLines: 0,
    invalidLines: 0,
    totalOrderQty: 0,
    totalPartnerOut: 0,
    totalWebsiteOutput: 0,
    totalPartnerIn: 0,
    totalWebsiteInput: 0,
  };
  for (const r of results) {
    if (r.status === "MATCHED") summary.matchedLines++;
    else summary.mismatchLines++;
    if (r.issues.includes("MISSING_ON_WEBSITE")) summary.missingOnWebsite++;
    if (r.issues.includes("MISSING_ON_PARTNER")) summary.missingOnPartner++;
    if (r.issues.includes("OVER_OUTPUT")) summary.overOutputLines++;
    if (r.issues.includes("OVER_INPUT")) summary.overInputLines++;
    if (r.issues.includes("DATE_DISTRIBUTION_MISMATCH")) summary.dateDiffLines++;
    if (r.issues.includes("INVALID_DATA")) summary.invalidLines++;
    if (duplicateKeys.has(`${r.poNo}|${r.factoryPO}|${r.size}`)) summary.duplicateLines++;
    summary.totalOrderQty += r.partnerOrderQty || r.websiteOrderQty;
    summary.totalPartnerOut += r.partnerOutQty;
    summary.totalWebsiteOutput += r.websiteOutputQty;
    summary.totalPartnerIn += r.partnerInQty;
    summary.totalWebsiteInput += r.websiteInputQty;
  }
  return summary;
}

// ── Run reconciliation end-to-end ───────────────────────────────────────────

export interface RunOptions {
  filePath: string;
  productType: string;
  dateFrom?: string;
  dateTo?: string;
  asOfDate?: string;
  mapping?: MappingConfig;
  uploadedBy?: string;
}

export async function runReconciliation(opts: RunOptions): Promise<{
  runId: string;
  runNumber: string;
  summary: ReconciliationSummary;
  resultsCount: number;
}> {
  const mapping = opts.mapping ?? DEFAULT_MAPPING;
  const fileName = opts.filePath.split("/").pop() || opts.filePath;

  // Parse partner file
  const partnerData = parsePartnerExcel(opts.filePath, mapping);

  // Detect duplicates
  const duplicateKeys = detectDuplicates(partnerData);

  // Aggregate partner (with date filter)
  const partnerAgg = aggregatePartner(partnerData, mapping, opts.dateFrom, opts.dateTo);

  // Load website data (with date filter)
  const websiteAgg = await loadWebsiteData(opts.productType, opts.dateFrom, opts.dateTo);

  // Compare
  const results = compareAggregates(partnerAgg, websiteAgg);

  // Mark duplicates
  for (const r of results) {
    if (duplicateKeys.has(`${r.poNo}|${r.factoryPO}|${r.size}`)) {
      if (!r.issues.includes("POSSIBLE_DUPLICATE")) {
        r.issues.push("POSSIBLE_DUPLICATE");
        r.reason = (r.reason ?? "") + ` Possible duplicate transactions detected in Partner file (same PO+FactoryPO+Size+Date+Type+Qty).`;
        if (r.status === "MATCHED") r.status = "POSSIBLE_DUPLICATE";
      }
    }
  }

  // Build summary
  const summary = buildSummary(results, duplicateKeys);

  // Generate run number
  const runCount = await db.reconciliationRun.count();
  const runNumber = `RECON-${String(runCount + 1).padStart(6, "0")}`;

  // Create run record
  const run = await db.reconciliationRun.create({
    data: {
      runNumber,
      fileName,
      uploadedBy: opts.uploadedBy ?? "system",
      uploadedAt: new Date(),
      dateFrom: opts.dateFrom ?? null,
      dateTo: opts.dateTo ?? null,
      asOfDate: opts.asOfDate ?? null,
      productType: opts.productType,
      status: "completed",
      mappingConfig: JSON.stringify(mapping),
      totalLines: summary.totalLines,
      matchedLines: summary.matchedLines,
      mismatchLines: summary.mismatchLines,
      missingOnWebsite: summary.missingOnWebsite,
      missingOnPartner: summary.missingOnPartner,
      duplicateLines: summary.duplicateLines,
      overOutputLines: summary.overOutputLines,
      overInputLines: summary.overInputLines,
      dateDiffLines: summary.dateDiffLines,
      invalidLines: summary.invalidLines,
      totalOrderQty: summary.totalOrderQty,
      totalPartnerOut: summary.totalPartnerOut,
      totalWebsiteOutput: summary.totalWebsiteOutput,
      totalPartnerIn: summary.totalPartnerIn,
      totalWebsiteInput: summary.totalWebsiteInput,
      previewOrdersCount: partnerData.orders.length,
      previewSummaryCount: partnerData.summary.length,
      previewTxCount: partnerData.transactions.length,
      completedAt: new Date(),
    },
  });

  // Save results in batches
  const BATCH = 200;
  for (let i = 0; i < results.length; i += BATCH) {
    const batch = results.slice(i, i + BATCH);
    await db.reconciliationResult.createMany({
      data: batch.map((r) => ({
        runId: run.id,
        poNo: r.poNo,
        factoryPO: r.factoryPO,
        size: r.size,
        model: r.model,
        sku: r.sku,
        colorCode: r.colorCode,
        partnerOrderQty: r.partnerOrderQty,
        partnerOutQty: r.partnerOutQty,
        partnerInQty: r.partnerInQty,
        websiteOrderQty: r.websiteOrderQty,
        websiteOutputQty: r.websiteOutputQty,
        websiteInputQty: r.websiteInputQty,
        orderDifference: r.orderDifference,
        outDifference: r.outDifference,
        inDifference: r.inDifference,
        pendingPartner: r.pendingPartner,
        pendingWebsite: r.pendingWebsite,
        remainingOrder: r.remainingOrder,
        status: r.status,
        issues: JSON.stringify(r.issues),
        reason: r.reason,
        partnerTransactions: JSON.stringify(r.partnerTransactions),
        websiteTransactions: JSON.stringify(r.websiteTransactions),
        dateDiff: r.dateDiff,
      })),
    });
  }

  return {
    runId: run.id,
    runNumber,
    summary,
    resultsCount: results.length,
  };
}
