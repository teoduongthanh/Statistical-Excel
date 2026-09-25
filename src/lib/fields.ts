// Canonical field definitions for the Smart Excel Data Entry System.

export type CanonicalField =
  | "date"
  | "shippingStatus"
  | "model"
  | "sku"
  | "poNo"
  | "factoryPO"
  | "item"
  | "season"
  | "colorCode"
  | "colorCode2"
  | "painting"
  | "printingColor"
  | "size"
  | "qty1"
  | "qty2"
  | "deadline"
  | "productType";

export interface FieldDef {
  key: CanonicalField;
  label: string;
  // Aliases used during header normalization (lowercased, alphanumeric-only).
  aliases: string[];
  // Case-sensitive aliases: if the original header (alphanumeric-only, preserving case)
  // matches one of these exactly, it wins over the lowercased aliases.
  caseSensitiveAliases?: string[];
  group: "shared" | "variable" | "meta";
  searchable: boolean;
}

// Field metadata. `group` distinguishes shared attributes (constant per Factory PO)
// from variable attributes (change per row: size, qty1, qty2, deadline).
//
// Color Code vs COLOR CODE: these two headers normalize to the SAME lowercase string
// ("colorcode"). To disambiguate, we use case-sensitive detection:
//   - "Color Code" (Title Case) → colorCode (the color name/description)
//   - "COLOR CODE" (ALL CAPS) → colorCode2 (the paint/material code)
//   - "COLOR NAME" (Onyx file) → colorCode (treated as the color description)
export const FIELDS: FieldDef[] = [
  { key: "date", label: "Date", aliases: ["date", "ngay"], group: "meta", searchable: true },
  { key: "shippingStatus", label: "Shipping Status", aliases: ["shippingstatus", "shipstatus", "status", "shipping"], group: "meta", searchable: true },
  { key: "model", label: "MODEL", aliases: ["model"], group: "shared", searchable: true },
  { key: "sku", label: "SKU", aliases: ["sku"], group: "shared", searchable: true },
  { key: "poNo", label: "PO NO#", aliases: ["pono", "po", "ponumber"], group: "shared", searchable: true },
  { key: "factoryPO", label: "Factory PO", aliases: ["factorypo", "facpo"], group: "shared", searchable: true },
  { key: "item", label: "ITEM", aliases: ["item"], group: "shared", searchable: true },
  { key: "season", label: "Season", aliases: ["season"], group: "shared", searchable: true },
  {
    key: "colorCode",
    label: "Color Code",
    aliases: ["colorcode", "colorname", "color"],
    caseSensitiveAliases: ["ColorCode", "COLORNAME", "ColorName"],
    group: "shared",
    searchable: true,
  },
  {
    key: "colorCode2",
    label: "COLOR CODE",
    aliases: ["colorcode2"],
    caseSensitiveAliases: ["COLORCODE"],
    group: "shared",
    searchable: true,
  },
  { key: "painting", label: "PAINTING", aliases: ["painting"], group: "shared", searchable: true },
  { key: "printingColor", label: "PRINTING COLOR", aliases: ["printingcolor", "printing", "printcolor"], group: "shared", searchable: true },
  { key: "size", label: "Size", aliases: ["size"], group: "variable", searchable: true },
  { key: "qty1", label: "Q'ty 1", aliases: ["qty1", "qty", "quantity1", "quantity", "q1"], group: "variable", searchable: false },
  { key: "qty2", label: "Q'ty 2", aliases: ["qty2", "quantity2", "q2"], group: "variable", searchable: false },
  { key: "deadline", label: "Dead Line", aliases: ["deadline", "dl", "duedate", "etd", "dead line", "deadlineetd"], group: "variable", searchable: true },
  { key: "productType", label: "Product Type", aliases: ["producttype", "company"], group: "meta", searchable: true },
];

export const FIELD_MAP: Record<CanonicalField, FieldDef> = FIELDS.reduce(
  (acc, f) => {
    acc[f.key] = f;
    return acc;
  },
  {} as Record<CanonicalField, FieldDef>
);

export const FIELD_LABELS: Record<CanonicalField, string> = FIELDS.reduce(
  (acc, f) => {
    acc[f.key] = f.label;
    return acc;
  },
  {} as Record<CanonicalField, string>
);

// Fields auto-filled from Master Data when a Factory PO is selected (shared attributes).
export const SHARED_FIELDS: CanonicalField[] = [
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

// Fields the user manually enters.
export const INPUT_FIELDS: CanonicalField[] = ["factoryPO", "size", "qty1"];

export const ALL_FIELDS: CanonicalField[] = [
  "date",
  "shippingStatus",
  "model",
  "sku",
  "poNo",
  "factoryPO",
  "item",
  "season",
  "colorCode",
  "colorCode2",
  "painting",
  "printingColor",
  "size",
  "qty1",
  "qty2",
  "deadline",
  "productType",
];

// Product types supported by the system.
export const PRODUCT_TYPES = ["Mafate", "Onyx", "Hoong Won"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];
