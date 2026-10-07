"use client";

import { useParams, notFound } from "next/navigation";
import { useEffect, useState } from "react";
import { getModule } from "@/lib/route-config";
import { api } from "@/lib/api-client";
import { useAppStore } from "@/store/app-store";
import { ProductDashboardView } from "@/components/views/product-dashboard-view";
import { Loader2 } from "lucide-react";

export default function ModulePage() {
  const params = useParams<{ module: string }>();
  const moduleSlug = params.module;
  const { currentProduct, setCurrentProduct } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [valid, setValid] = useState(false);

  useEffect(() => {
    const cached = getModule(moduleSlug);
    if (cached) {
      if (currentProduct !== cached.productType) {
        setCurrentProduct(cached.productType);
      }
      setTimeout(() => { setValid(true); setLoading(false); }, 0);
      return;
    }
    api.listProducts().then((r) => {
      if (r.ok) {
        const found = r.products.find((p: any) => p.slug === moduleSlug);
        if (found) {
          if (currentProduct !== found.productType) {
            setCurrentProduct(found.productType);
          }
          setValid(true);
        } else {
          setValid(false);
        }
      } else {
        setValid(false);
      }
      setLoading(false);
    }).catch(() => {
      setValid(false);
      setLoading(false);
    });
  }, [moduleSlug, currentProduct, setCurrentProduct]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!valid) {
    notFound();
  }

  return <ProductDashboardView />;
}
