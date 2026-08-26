// SurplusTransferService
// Detects Factory POs with surplus output (Output > Order) and suggests
// transfers to Factory POs that are short (Order > Output) within the same
// PO NO# + Color Code + Size combination.
//
// Rules (per spec):
//   - Transfer only within same PO NO# + Color Code + Size
//   - Transfer amount ≤ Source Surplus
//   - Transfer amount ≤ Destination Remaining Capacity (Order - Output)
//   - Multiple destinations: fill from top to bottom by priority
//   - Priority: same PO NO# → same Color → same Size → same MODEL → nearest deadline

import type { ShipmentGroup } from "./shipment-planning-service";
import { normalizeSize } from "./shipment-planning-service";

export interface SurplusSource {
  key: string;
  poNo: string;
  factoryPO: string;
  size: string;
  colorCode: string;
  model: string;
  deadline: string | null;
  orderQty: number;
  outputQty: number;
  surplus: number;
}

export interface TransferDestination {
  key: string;
  poNo: string;
  factoryPO: string;
  size: string;
  colorCode: string;
  model: string;
  deadline: string | null;
  orderQty: number;
  outputQty: number;
  remainingCapacity: number; // Order - Output
}

export interface TransferProposal {
  source: SurplusSource;
  destination: TransferDestination;
  transferQty: number;
  sourceRemainingSurplus: number; // surplus after transfer
  destinationRemainingCapacity: number; // capacity after transfer
}

// Detect all surplus Factory POs and find matching destinations.
export function detectSurplusTransfers(groups: ShipmentGroup[]): TransferProposal[] {
  const proposals: TransferProposal[] = [];

  // Find surplus sources (Output > Order).
  const surplusSources = groups.filter((g) => g.surplus > 0);

  // Find short destinations (Order > Output, i.e. remainingOutput > 0).
  const shortDestinations = groups.filter((g) => g.remainingOutput > 0);

  for (const source of surplusSources) {
    const normSrcSize = normalizeSize(source.size);
    const srcColorCode = source.colorCode;

    // Find matching destinations: same PO NO# + same Color Code + same Size + different Factory PO.
    let matching = shortDestinations.filter((d) => {
      return (
        d.poNo === source.poNo &&
        d.colorCode === srcColorCode &&
        normalizeSize(d.size) === normSrcSize &&
        d.factoryPO !== source.factoryPO
      );
    });

    // Sort destinations by priority: nearest deadline first.
    matching.sort((a, b) => {
      const da = a.deadline ?? "9999";
      const db = b.deadline ?? "9999";
      return da.localeCompare(db);
    });

    let remainingSurplus = source.surplus;

    for (const dest of matching) {
      if (remainingSurplus <= 0) break;
      const transferQty = Math.min(remainingSurplus, dest.remainingOutput);
      if (transferQty <= 0) continue;

      proposals.push({
        source: {
          key: source.key,
          poNo: source.poNo,
          factoryPO: source.factoryPO,
          size: source.size,
          colorCode: source.colorCode,
          model: source.model,
          deadline: source.deadline,
          orderQty: source.orderQty,
          outputQty: source.outputQty,
          surplus: source.surplus,
        },
        destination: {
          key: dest.key,
          poNo: dest.poNo,
          factoryPO: dest.factoryPO,
          size: dest.size,
          colorCode: dest.colorCode,
          model: dest.model,
          deadline: dest.deadline,
          orderQty: dest.orderQty,
          outputQty: dest.outputQty,
          remainingCapacity: dest.remainingOutput,
        },
        transferQty,
        sourceRemainingSurplus: remainingSurplus - transferQty,
        destinationRemainingCapacity: dest.remainingOutput - transferQty,
      });

      remainingSurplus -= transferQty;
    }
  }

  return proposals;
}

// Get only surplus sources (without transfer proposals) for display.
export function getSurplusSources(groups: ShipmentGroup[]): SurplusSource[] {
  return groups
    .filter((g) => g.surplus > 0)
    .map((g) => ({
      key: g.key,
      poNo: g.poNo,
      factoryPO: g.factoryPO,
      size: g.size,
      colorCode: g.colorCode,
      model: g.model,
      deadline: g.deadline,
      orderQty: g.orderQty,
      outputQty: g.outputQty,
      surplus: g.surplus,
    }));
}

// Get short destinations for a specific surplus source.
export function getDestinationsForSurplus(
  groups: ShipmentGroup[],
  source: SurplusSource
): TransferDestination[] {
  const normSrcSize = normalizeSize(source.size);
  return groups
    .filter((g) => {
      return (
        g.poNo === source.poNo &&
        g.colorCode === source.colorCode &&
        normalizeSize(g.size) === normSrcSize &&
        g.factoryPO !== source.factoryPO &&
        g.remainingOutput > 0
      );
    })
    .sort((a, b) => {
      const da = a.deadline ?? "9999";
      const db = b.deadline ?? "9999";
      return da.localeCompare(db);
    })
    .map((g) => ({
      key: g.key,
      poNo: g.poNo,
      factoryPO: g.factoryPO,
      size: g.size,
      colorCode: g.colorCode,
      model: g.model,
      deadline: g.deadline,
      orderQty: g.orderQty,
      outputQty: g.outputQty,
      remainingCapacity: g.remainingOutput,
    }));
}
