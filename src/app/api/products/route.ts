import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/products — list all active products (for sidebar + route config).
export async function GET() {
  try {
    const products = await db.product.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { productType: "asc" }],
    });

    // If no products in DB yet, seed defaults (migration from hardcoded).
    if (products.length === 0) {
      const defaults = [
        { productType: "MAFATE", label: "Mafate", slug: "mafate", description: "MAFATE production line", color: "emerald", active: true, sortOrder: 0 },
        { productType: "ONYX", label: "Onyx", slug: "onyx", description: "ONYX production line", color: "violet", active: true, sortOrder: 1 },
        { productType: "MIZUNO", label: "Mizuno", slug: "mizuno", description: "MIZUNO production line", color: "rose", active: true, sortOrder: 2 },
        { productType: "ONYX_FVO", label: "Onyx FVO", slug: "onyx-fvo", description: "ONYX FVO tracking data source", color: "cyan", active: true, sortOrder: 3 },
      ];
      await db.product.createMany({ data: defaults });
      const seeded = await db.product.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { productType: "asc" }],
      });
      return NextResponse.json({ ok: true, products: seeded });
    }

    return NextResponse.json({ ok: true, products });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}

// POST /api/products — create a new product.
// Body: { productType, label, slug, description?, color? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { productType, label, slug, description, color } = body;

    if (!productType) return NextResponse.json({ error: "productType is required" }, { status: 400 });
    if (!label) return NextResponse.json({ error: "label is required" }, { status: 400 });
    if (!slug) return NextResponse.json({ error: "slug is required (URL segment, lowercase)" }, { status: 400 });

    // Validate slug: lowercase, kebab-case, no spaces
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return NextResponse.json({ error: "slug must be lowercase kebab-case (e.g., 'adidas', 'onyx-pro')" }, { status: 400 });
    }

    // Validate productType: uppercase, no spaces
    if (!/^[A-Z0-9_]+$/.test(productType)) {
      return NextResponse.json({ error: "productType must be uppercase (e.g., 'ADIDAS', 'ONYX_PRO')" }, { status: 400 });
    }

    // Check uniqueness
    const existing = await db.product.findFirst({
      where: { OR: [{ productType }, { slug }] },
    });
    if (existing) {
      return NextResponse.json({ error: `Product with productType="${productType}" or slug="${slug}" already exists` }, { status: 409 });
    }

    // Auto-assign sort order (max + 1)
    const maxSort = await db.product.aggregate({ _max: { sortOrder: true } });
    const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;

    // Pick color (default: cycle through presets if not specified)
    const chosenColor = color || "blue"; // default to blue for new products

    const product = await db.product.create({
      data: {
        productType,
        label,
        slug,
        description: description || null,
        color: chosenColor,
        active: true,
        sortOrder,
      },
    });

    return NextResponse.json({ ok: true, product });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}
