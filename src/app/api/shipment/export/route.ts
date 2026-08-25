import { NextRequest, NextResponse } from "next/server";
import { generateShipmentExcel } from "@/lib/shipment-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExportBody {
  productType: string;
  selectedColors: string[];
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
// Generates a Daily Shipment Excel file in IN PO [Color] format.
// Each selected color gets its own sheet; a DAILY SHIPMENT SUMMARY sheet is added.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ExportBody;
    if (!body.productType || !body.selectedColors || !body.plannedOutputs) {
      return NextResponse.json(
        { error: "productType, selectedColors, and plannedOutputs are required" },
        { status: 400 }
      );
    }

    // Default template path: look for the uploaded Excel files.
    const templatePath = body.templatePath ||
      "/home/z/my-project/upload/Copy of Copy of FMT shipped out S-TECH mafate -2026 (1).xlsx";

    const buffer = await generateShipmentExcel(
      body.productType,
      body.selectedColors,
      body.plannedOutputs,
      templatePath
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
