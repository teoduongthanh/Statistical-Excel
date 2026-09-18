"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { useAppStore, PRODUCT_THEME } from "@/store/app-store";
import { ProductDashboardView } from "@/components/views/product-dashboard-view";
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
import { ProductImportView } from "@/components/views/product-import-view";
import { ProductExportView } from "@/components/views/product-export-view";
import { ProductReviewView } from "@/components/views/product-review-view";
import { GlobalDashboardView } from "@/components/views/global-dashboard-view";
import { ImportHistoryView } from "@/components/views/import-history-view";
import { SettingsMappingView } from "@/components/views/settings-mapping-view";
import { SettingsLookupView } from "@/components/views/settings-lookup-view";
import { SettingsValidationView } from "@/components/views/settings-validation-view";
import { OrderNotesView } from "@/components/views/order-notes-view";

export default function Home() {
  const { view, currentProduct } = useAppStore();
  const theme = PRODUCT_THEME[currentProduct];

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        {/* Product context banner for product-scoped views */}
        {view.startsWith("product-") && (
          <div className={`flex items-center gap-2 px-4 py-1.5 text-xs font-medium text-white bg-gradient-to-r ${theme.gradient}`}>
            <span className="opacity-90">PRODUCT CONTEXT:</span>
            <span className="font-bold tracking-wide">{currentProduct}</span>
            <span className="opacity-75">— all data & operations are isolated to {currentProduct}</span>
          </div>
        )}
        <main className="flex-1 overflow-y-auto scroll-thin">
          <div className="mx-auto w-full max-w-[1500px] px-4 py-6 md:px-6">
            {view === "global-dashboard" && <GlobalDashboardView />}
            {view === "product-dashboard" && <ProductDashboardView />}
            {view === "product-data-entry" && <ProductDataEntryView />}
            {view === "product-master-data" && <ProductMasterDataView />}
            {view === "product-production-tracking" && <ProductProductionTrackingView />}
            {view === "product-statistics" && <ProductStatisticsView />}
            {view === "product-shipment" && <ProductShipmentView />}
            {view === "product-report" && <ProductReportView />}
            {view === "product-bulk-check" && <ProductBulkCheckView />}
            {view === "product-order-monitor" && <ProductOrderMonitorView />}
            {view === "product-output-slip" && <ProductOutputSlipView />}
            {view === "product-reconciliation" && <ProductReconciliationView />}
            {view === "product-import" && <ProductImportView />}
            {view === "product-export" && <ProductExportView />}
            {view === "product-review" && <ProductReviewView />}
            {view === "import-history" && <ImportHistoryView />}
            {view === "settings-mapping" && <SettingsMappingView />}
            {view === "settings-lookup" && <SettingsLookupView />}
            {view === "settings-validation" && <SettingsValidationView />}
            {view === "order-notes" && <OrderNotesView />}
          </div>
        </main>
      </div>
    </div>
  );
}
