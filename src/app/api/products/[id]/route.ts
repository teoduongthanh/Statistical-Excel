import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/products/[id] — update product (label, slug, description, color, active, sortOrder).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    const existing = await db.product.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Product not found" }, { status: 404 });

    // Validate slug if changed
    if (body.slug && !/^[a-z0-9-]+$/.test(body.slug)) {
      return NextResponse.json({ error: "slug must be lowercase kebab-case" }, { status: 400 });
    }

    // Check slug uniqueness if changed
    if (body.slug && body.slug !== existing.slug) {
      const conflict = await db.product.findFirst({ where: { slug: body.slug, NOT: { id } } });
      if (conflict) return NextResponse.json({ error: `slug "${body.slug}" already in use` }, { status: 409 });
    }

    const updateData: any = {};
    if (body.label !== undefined) updateData.label = body.label;
    if (body.slug !== undefined) updateData.slug = body.slug;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.color !== undefined) updateData.color = body.color;
    if (body.active !== undefined) updateData.active = body.active;
    if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder;

    const product = await db.product.update({ where: { id }, data: updateData });
    return NextResponse.json({ ok: true, product });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}

// DELETE /api/products/[id] — soft delete (set active=false).
// Does NOT delete the product's MasterData/EntryData — just hides it from UI.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await db.product.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Product not found" }, { status: 404 });

    // Soft delete: set active=false (data preserved)
    await db.product.update({ where: { id }, data: { active: false } });
    return NextResponse.json({ ok: true, message: `Product "${existing.productType}" deactivated. Data preserved.` });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}
