import { NextRequest, NextResponse } from "next/server";
import { generateShipmentExcel, getShipmentGroups, type ShipmentFilters } from "@/lib/shipment-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExportBody {
  productType: string;
  selectedPoNos: string[];
  plannedOutputs: {
    poNo: string;
    factoryPO: string;
    model: string;
    colorCode: string;
    size: string;
    plannedQty: number;
    deadline: string | null;
  }[];
  templatePath?: string;
}

// POST /api/shipment/export
// Generates a Daily Shipment Excel file in IN PO format.
// Each PO NO# becomes its own sheet containing ALL its Factory POs as rows.
// This lets users export multiple Factory POs at once (one PO NO# can have
// many Factory POs). The DAILY SHIPMENT SUMMARY sheet is enriched with
// Order / Previous Output / Total Output / Remaining quantities.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ExportBody;
    if (!body.productType || !body.selectedPoNos || !body.plannedOutputs) {
      return NextResponse.json(
        { error: "productType, selectedPoNos, and plannedOutputs are required" },
        { status: 400 }
      );
    }

    // Default template path: look for the uploaded Excel files.
    const templatePath = body.templatePath ||
      "/home/z/my-project/upload/Copy of Copy of FMT shipped out S-TECH mafate -2026 (1).xlsx";

    // Fetch shipment groups to enrich the summary sheet with Order/Output quantities.
    const shipmentGroups = await getShipmentGroups({ productType: body.productType });

    const buffer = await generateShipmentExcel(
      body.productType,
      body.selectedPoNos,
      body.plannedOutputs,
      templatePath,
      shipmentGroups
    );

    const today = new Date().toISOString().slice(0, 10);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Daily_Shipment_${today}.xlsx"`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Shipment export failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
