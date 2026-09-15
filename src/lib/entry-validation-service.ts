// EntryValidationService
// Real-time pre-save validation for Entry Data.
// Checks existing Order/Output/Input for a product group (PO NO# + Factory PO + Size),
// simulates the new totals after adding the entry, and returns warnings/errors.

import { db } from "./db";
import { classifyShippingStatus } from "./quantity-service";

export type ValidationSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export interface ValidationInput {
  productType: string;
  shippingStatus: string;
  poNo: string;
  factoryPO: string;
  size: string;
  qty: number;
}

export interface ValidationWarning {
  severity: ValidationSeverity;
  code: string;
  title: string;
  description: string;
  possibleCauses: string[];
  suggestedActions: string[];
}

export interface ValidationResult {
  ok: boolean;
  hasCritical: boolean;
  hasError: boolean;
  hasWarning: boolean;
  warnings: ValidationWarning[];
  current: {
    orderQty: number;
    outputQty: number;
    inputQty: number;
    pendingQty: number;
    productionStatus: string;
  };
  afterSave: {
    orderQty: number;
    outputQty: number;
    inputQty: number;
  };
  difference: number;
  transactions: { date: string; shippingStatus: string; qty1: number }[];
  masterExists: boolean;
  masterColorCode: string | null;
}

export async function validateEntryBeforeSave(
  input: ValidationInput
): Promise<ValidationResult> {
  const warnings: ValidationWarning[] = [];

  // 1. Validate basic input.
  if (!input.shippingStatus) {
    warnings.push({
      severity: "CRITICAL",
      code: "MISSING_STATUS",
      title: "Missing Shipping Status",
      description: "Shipping Status is required.",
      possibleCauses: ["User hasn't selected a status."],
      suggestedActions: ["Select a Shipping Status."],
    });
  }
  if (!input.factoryPO) {
    warnings.push({
      severity: "CRITICAL",
      code: "MISSING_FACTORY_PO",
      title: "Missing Factory PO",
      description: "Factory PO is required.",
      possibleCauses: ["User hasn't entered a Factory PO."],
      suggestedActions: ["Enter a Factory PO."],
    });
  }
  if (!input.size) {
    warnings.push({
      severity: "CRITICAL",
      code: "MISSING_SIZE",
      title: "Missing Size",
      description: "Size is required.",
      possibleCauses: ["User hasn't entered a Size."],
      suggestedActions: ["Enter a Size."],
    });
  }
  if (input.qty <= 0) {
    warnings.push({
      severity: "CRITICAL",
      code: "INVALID_QTY",
      title: "Invalid Quantity",
      description: `Qty must be a positive integer. Got: ${input.qty}`,
      possibleCauses: ["User entered 0, negative, or non-numeric value."],
      suggestedActions: ["Enter a valid positive quantity."],
    });
  }

  // If critical errors, return early.
  if (warnings.some((w) => w.severity === "CRITICAL")) {
    return {
      ok: false,
      hasCritical: true,
      hasError: true,
      hasWarning: false,
      warnings,
      current: { orderQty: 0, outputQty: 0, inputQty: 0, pendingQty: 0, productionStatus: "UNKNOWN" },
      afterSave: { orderQty: 0, outputQty: 0, inputQty: 0 },
      difference: 0,
      transactions: [],
      masterExists: false,
      masterColorCode: null,
    };
  }

  // 2. Fetch existing transactions for this group (PO NO# + Factory PO + Size).
  const existing = await db.$queryRawUnsafe<any[]>(`
    SELECT date, shippingStatus, qty1
    FROM MasterData
    WHERE productType = ?
      AND poNo = ?
      AND factoryPO = ?
      AND size = ?
    ORDER BY date ASC
  `, input.productType, input.poNo, input.factoryPO, input.size);

  // Also check EntryData for existing entries.
  const existingEntries = await db.entryData.findMany({
    where: {
      productType: input.productType,
      poNo: input.poNo,
      factoryPO: input.factoryPO,
      size: input.size,
    },
    select: { shippingStatus: true, qty1: true, date: true },
  });

  // Combine all transactions.
  const allTransactions = [
    ...existing.map((r) => ({
      date: r.date || "",
      shippingStatus: r.shippingStatus || "",
      qty1: Number(r.qty1) || 0,
    })),
    ...existingEntries.map((r) => ({
      date: r.date || "",
      shippingStatus: r.shippingStatus || "",
      qty1: Number(r.qty1) || 0,
    })),
  ];

  // 3. Calculate current totals.
  let orderQty = 0, outputQty = 0, inputQty = 0;
  for (const t of allTransactions) {
    const bucket = classifyShippingStatus(t.shippingStatus);
    if (bucket === "order") orderQty += t.qty1;
    else if (bucket === "output") outputQty += t.qty1;
    else if (bucket === "input") inputQty += t.qty1;
  }
  const pendingQty = -outputQty; // Dynamic

  // 4. Simulate new totals after adding this entry.
  const bucket = classifyShippingStatus(input.shippingStatus);
  let newOrderQty = orderQty;
  let newOutputQty = outputQty;
  let newInputQty = inputQty;
  if (bucket === "order") newOrderQty += input.qty;
  else if (bucket === "output") newOutputQty += input.qty;
  else if (bucket === "input") newInputQty += input.qty;

  // 5. Check Master Data existence.
  const masterGroup = await db.masterGroup.findUnique({
    where: { productType_factoryPO: { productType: input.productType, factoryPO: input.factoryPO } },
    select: { factoryPO: true, colorCode: true, poNo: true, sizes: true },
  });
  const masterExists = !!masterGroup;
  const masterColorCode = masterGroup?.colorCode || null;

  // 6. Production status.
  let productionStatus = "NOT_STARTED";
  if (orderQty > 0 && outputQty >= orderQty && inputQty >= orderQty) {
    productionStatus = "COMPLETED";
  } else if (outputQty > 0 && inputQty > 0 && inputQty < outputQty) {
    productionStatus = "PARTIALLY_RECEIVED";
  } else if (outputQty > 0 && outputQty < orderQty) {
    productionStatus = "PARTIALLY_OUTPUT";
  } else if (outputQty >= orderQty) {
    productionStatus = "WAITING_FOR_INPUT";
  }

  // 7. Run validation checks.

  // Check 1: Output > Order after save.
  if (newOutputQty > newOrderQty && newOrderQty > 0) {
    const excess = newOutputQty - newOrderQty;
    warnings.push({
      severity: "ERROR",
      code: "OUTPUT_EXCEEDS_ORDER",
      title: "Output Exceeds Order",
      description: `After this entry, Output (${newOutputQty}) will exceed Order (${newOrderQty}) by ${excess}.`,
      possibleCauses: [
        "Entered wrong Output Qty.",
        "Selected wrong Factory PO.",
        "Selected wrong Size.",
        "Surplus from another Factory PO.",
        "Order not fully entered.",
      ],
      suggestedActions: [
        "Check PO NO#.",
        "Check Factory PO.",
        "Check Size.",
        "Check Qty.",
        "Confirm surplus if applicable.",
      ],
    });
  }

  // Check 2: Input > Output after save.
  if (newInputQty > newOutputQty && newOutputQty > 0) {
    const excess = newInputQty - newOutputQty;
    warnings.push({
      severity: "ERROR",
      code: "INPUT_EXCEEDS_OUTPUT",
      title: "Input Exceeds Output",
      description: `After this entry, Input (${newInputQty}) will exceed Output (${newOutputQty}) by ${excess}.`,
      possibleCauses: [
        "Duplicate Input entry.",
        "Wrong Factory PO.",
        "Wrong PO NO#.",
        "Goods transferred from another Factory PO.",
        "Previous Output missing.",
      ],
      suggestedActions: [
        "Check transaction history.",
        "Verify Input records.",
        "Edit or delete duplicate.",
      ],
    });
  }

  // Check 3: Input > Order after save.
  if (newInputQty > newOrderQty && newOrderQty > 0) {
    const excess = newInputQty - newOrderQty;
    warnings.push({
      severity: "ERROR",
      code: "INPUT_EXCEEDS_ORDER",
      title: "Input Exceeds Order",
      description: `After this entry, Input (${newInputQty}) will exceed Order (${newOrderQty}) by ${excess}.`,
      possibleCauses: [
        "Wrong PO NO#.",
        "Wrong Factory PO.",
        "Wrong Size.",
        "Wrong Qty.",
        "Duplicate Input.",
        "Order not fully entered.",
      ],
      suggestedActions: [
        "Check all fields.",
        "Verify against Master Data.",
        "Check transaction history.",
      ],
    });
  }

  // Check 4: Product already completed + adding Output.
  if (productionStatus === "COMPLETED" && bucket === "output") {
    warnings.push({
      severity: "WARNING",
      code: "ALREADY_COMPLETED_OUTPUT",
      title: "Product Already Completed",
      description: `This product has already completed its Order (${orderQty}), Output (${outputQty}), and Input (${inputQty}). Adding more Output (${input.qty}) will cause over-quantity.`,
      possibleCauses: [
        "Data correction.",
        "Duplicate transaction correction.",
        "Surplus quantity.",
        "Transfer from another Factory PO.",
      ],
      suggestedActions: [
        "Verify the transaction is correct.",
        "Select a confirmation reason.",
      ],
    });
  }

  // Check 5: Product already completed + adding Input.
  if (productionStatus === "COMPLETED" && bucket === "input") {
    warnings.push({
      severity: "WARNING",
      code: "ALREADY_COMPLETED_INPUT",
      title: "Product Already Completed",
      description: `This product has already completed its Order (${orderQty}), Output (${outputQty}), and Input (${inputQty}). Adding more Input (${input.qty}) will cause over-quantity.`,
      possibleCauses: [
        "Data correction.",
        "Duplicate transaction correction.",
        "Surplus quantity.",
        "Transfer from another Factory PO.",
      ],
      suggestedActions: [
        "Verify the transaction is correct.",
        "Select a confirmation reason.",
      ],
    });
  }

  // Check 6: Output already fully output + adding more Output.
  if (outputQty >= orderQty && orderQty > 0 && bucket === "output") {
    const excess = newOutputQty - orderQty;
    warnings.push({
      severity: "WARNING",
      code: "ALREADY_FULLY_OUTPUT",
      title: "Product Already Fully Output",
      description: `Output (${outputQty}) already equals Order (${orderQty}). New Output (${input.qty}) will exceed by ${excess}.`,
      possibleCauses: ["Surplus quantity.", "Duplicate Output.", "Data correction."],
      suggestedActions: ["Confirm surplus if applicable.", "Check transaction history."],
    });
  }

  // Check 7: Input already fully received + adding more Input.
  if (inputQty >= outputQty && outputQty > 0 && bucket === "input") {
    const excess = newInputQty - outputQty;
    warnings.push({
      severity: "WARNING",
      code: "ALREADY_FULLY_RECEIVED",
      title: "Product Already Fully Received",
      description: `Input (${inputQty}) already equals Output (${outputQty}). New Input (${input.qty}) will exceed by ${excess}.`,
      possibleCauses: ["Surplus quantity.", "Duplicate Input.", "Data correction."],
      suggestedActions: ["Confirm surplus if applicable.", "Check transaction history."],
    });
  }

  // Check 8: Possible duplicate transaction.
  const today = new Date().toISOString().slice(0, 10);
  const duplicate = allTransactions.find(
    (t) =>
      t.date === today &&
      t.shippingStatus === input.shippingStatus &&
      t.qty1 === input.qty
  );
  if (duplicate) {
    warnings.push({
      severity: "WARNING",
      code: "POSSIBLE_DUPLICATE",
      title: "Possible Duplicate Transaction",
      description: `A transaction with the same date (${today}), status (${input.shippingStatus}), and qty (${input.qty}) already exists.`,
      possibleCauses: ["Same transaction entered twice.", "Copy-paste error."],
      suggestedActions: ["Check transaction history.", "Delete duplicate if confirmed."],
    });
  }

  // Check 9: Input without Output.
  if (bucket === "input" && outputQty === 0 && input.qty > 0) {
    warnings.push({
      severity: "WARNING",
      code: "INPUT_WITHOUT_OUTPUT",
      title: "Input Without Output",
      description: `Adding Input (${input.qty}) but there is no existing Output for this product.`,
      possibleCauses: [
        "Missing Output transaction.",
        "Wrong Factory PO.",
        "Wrong PO NO#.",
        "Wrong Size.",
        "Wrong Shipping Status.",
        "Historical Output data not imported.",
      ],
      suggestedActions: [
        "Check transaction history.",
        "Add missing Output first.",
        "Verify all fields.",
      ],
    });
  }

  // Check 10: Output without Order.
  if (bucket === "output" && orderQty === 0 && input.qty > 0) {
    warnings.push({
      severity: "WARNING",
      code: "OUTPUT_WITHOUT_ORDER",
      title: "Output Without Order",
      description: `Adding Output (${input.qty}) but there is no existing Order for this product.`,
      possibleCauses: [
        "Missing Order data.",
        "Wrong PO NO#.",
        "Wrong Factory PO.",
        "Wrong Size.",
        "Historical Order data missing.",
      ],
      suggestedActions: ["Enter Order data first.", "Verify all fields."],
    });
  }

  // Check 11: Factory PO not in Master Data.
  if (!masterExists) {
    warnings.push({
      severity: "WARNING",
      code: "UNKNOWN_FACTORY_PO",
      title: "Unknown Factory PO",
      description: `Factory PO "${input.factoryPO}" does not exist in Master Data.`,
      possibleCauses: ["New Factory PO not yet created.", "Typo in Factory PO."],
      suggestedActions: ["Add to Master Data.", "Check spelling."],
    });
  }

  // Check 12: Size not in Master Data.
  if (masterExists && masterGroup) {
    const sizes: string[] = JSON.parse(masterGroup.sizes || "[]");
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    const sizeExists = sizes.some((s) => norm(s) === norm(input.size));
    if (!sizeExists) {
      warnings.push({
        severity: "WARNING",
        code: "INVALID_SIZE",
        title: "Invalid Size",
        description: `Size "${input.size}" does not belong to Factory PO "${input.factoryPO}". Available: ${sizes.join(", ")}`,
        possibleCauses: ["Wrong Size selected.", "Wrong Factory PO."],
        suggestedActions: ["Select a valid Size.", "Check Master Data."],
      });
    }
  }

  // Check 13: Deadline passed.
  if (masterExists && masterGroup) {
    const deadline = await db.masterGroup.findUnique({
      where: { productType_factoryPO: { productType: input.productType, factoryPO: input.factoryPO } },
      select: { nearestDeadline: true },
    });
    const dl = deadline?.nearestDeadline;
    if (dl) {
      const dlDate = new Date(dl);
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      if (dlDate < now) {
        const lateDays = Math.floor((now.getTime() - dlDate.getTime()) / 86400000);
        warnings.push({
          severity: "WARNING",
          code: "DEADLINE_PASSED",
          title: "Deadline Passed",
          description: `Deadline ${dl} has passed ${lateDays} day(s) ago. Remaining: ${Math.max(0, orderQty - outputQty)} units not yet output.`,
          possibleCauses: ["Production delay.", "Output/Input not yet entered.", "Deadline too aggressive."],
          suggestedActions: ["Check production status.", "Enter data if goods were processed.", "Update deadline if extended."],
        });
      }
    }
  }

  // Determine flags.
  const hasCritical = warnings.some((w) => w.severity === "CRITICAL");
  const hasError = warnings.some((w) => w.severity === "ERROR");
  const hasWarning = warnings.some((w) => w.severity === "WARNING");

  // Sort by severity.
  const order = { CRITICAL: 0, ERROR: 1, WARNING: 2, INFO: 3 };
  warnings.sort((a, b) => order[a.severity] - order[b.severity]);

  // Difference (qty change).
  let difference = 0;
  if (bucket === "order") difference = input.qty;
  else if (bucket === "output") difference = newOutputQty - outputQty;
  else if (bucket === "input") difference = newInputQty - inputQty;

  return {
    ok: !hasCritical,
    hasCritical,
    hasError,
    hasWarning,
    warnings,
    current: {
      orderQty,
      outputQty,
      inputQty,
      pendingQty,
      productionStatus,
    },
    afterSave: {
      orderQty: newOrderQty,
      outputQty: newOutputQty,
      inputQty: newInputQty,
    },
    difference,
    transactions: allTransactions,
    masterExists,
    masterColorCode,
  };
}
