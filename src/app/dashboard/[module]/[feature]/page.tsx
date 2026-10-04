"use client";

import { useParams, notFound } from "next/navigation";
import { useEffect } from "react";
import { getModule, getFeature } from "@/lib/route-config";
import { useAppStore, PRODUCT_THEME } from "@/store/app-store";
import { cn } from "@/lib/utils";

import { ProductDataEntryView } from "@/components/views/product-data-entry-view";
import { ProductMasterDataView } from "@/components/views/product-master-data-view";
import { ProductProductionTrackingView } from "@/components/views/product-production-tracking-view";
import { ProductStatisticsView } from "@/components/views/product-statistics-view";
import { ProductShipmentView } from "@/components/views/product-shipment-view";
import { ProductReportView } from "@/components/views/product-report-view";
import { ProductBulkCheckView } from "@/components/views/product-bulk-check-view";
import { ProductOrderMonitorView } from "@/components/views/product-order-monitor-view";
import { ProductOutputSlipView } from "@/components/views/product-output-slip-view";
import { ProductReconciliationView } from "@/components/views/product-reconciliation-view";
import { FvoStechTrackingView } from "@/components/views/fvo-stech-tracking-view";
import { ProductImportView } from "@/components/views/product-import-view";
import { ProductExportView } from "@/components/views/product-export-view";
import { ProductReviewView } from "@/components/views/product-review-view";

export default function FeaturePage() {
  const params = useParams<{ module: string; feature: string }>();
  const moduleSlug = params.module;
  const featureSlug = params.feature;

  const moduleConfig = getModule(moduleSlug);
  const feature = getFeature(featureSlug);

  const { currentProduct, setCurrentProduct } = useAppStore();
  const theme = PRODUCT_THEME[currentProduct];

  useEffect(() => {
    if (moduleConfig && currentProduct !== moduleConfig.productType) {
      setCurrentProduct(moduleConfig.productType);
    }
  }, [moduleConfig, currentProduct, setCurrentProduct]);

  if (!moduleConfig) notFound();
  if (!feature) notFound();

  const renderView = () => {
    switch (feature.view) {
      case "data-entry":
        return <ProductDataEntryView />;
      case "master-data":
        return (
          <div className="space-y-0">
            {feature.statusFilter && (
              <div className={cn("flex items-center gap-2 px-4 py-1.5 text-xs font-medium text-white bg-gradient-to-r", theme.gradient)}>
                <span className="opacity-90">FILTERED BY:</span>
                <span className="font-bold">{feature.statusFilter}</span>
              </div>
            )}
            <ProductMasterDataView statusFilter={feature.statusFilter} />
          </div>
        );
      case "production-tracking":
        return <ProductProductionTrackingView />;
      case "statistics":
        return <ProductStatisticsView />;
      case "shipment":
        return <ProductShipmentView />;
      case "report":
        return <ProductReportView />;
      case "bulk-check":
        return <ProductBulkCheckView />;
      case "order-monitor":
        return <ProductOrderMonitorView />;
      case "output-slip":
        return <ProductOutputSlipView />;
      case "reconciliation":
        return <ProductReconciliationView />;
      case "fvo-stech":
        return <FvoStechTrackingView />;
      case "import":
        return <ProductImportView />;
      case "export":
        return <ProductExportView />;
      case "review":
        return <ProductReviewView />;
      default:
        return <div>Unknown view: {feature.view}</div>;
    }
  };

  return (
    <div>
      <div className={cn("flex items-center gap-2 px-4 py-1.5 text-xs font-medium text-white bg-gradient-to-r", theme.gradient)}>
        <span className="opacity-90">PRODUCT CONTEXT:</span>
        <span className="font-bold">{currentProduct}</span>
        <span className="opacity-70">— all data & operations are isolated to {currentProduct}</span>
      </div>
      {renderView()}
    </div>
  );
}
