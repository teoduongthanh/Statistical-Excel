"use client";

import { useParams, notFound } from "next/navigation";
import { useEffect } from "react";
import { getModule } from "@/lib/route-config";
import { useAppStore } from "@/store/app-store";
import { ProductDashboardView } from "@/components/views/product-dashboard-view";

export default function ModulePage() {
  const params = useParams<{ module: string }>();
  const moduleSlug = params.module;
  const moduleConfig = getModule(moduleSlug);

  const { currentProduct, setCurrentProduct } = useAppStore();

  useEffect(() => {
    if (moduleConfig && currentProduct !== moduleConfig.productType) {
      setCurrentProduct(moduleConfig.productType);
    }
  }, [moduleConfig, currentProduct, setCurrentProduct]);

  if (!moduleConfig) {
    notFound();
  }

  return <ProductDashboardView />;
}
