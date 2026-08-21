"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { useAppStore } from "@/store/app-store";
import { DashboardView } from "@/components/views/dashboard-view";
import { MasterDataView } from "@/components/views/master-data-view";
import { DataEntryView } from "@/components/views/data-entry-view";
import { DataManagementView } from "@/components/views/data-management-view";
import { ImportExcelView } from "@/components/views/import-excel-view";
import { ExportExcelView } from "@/components/views/export-excel-view";
import { ImportHistoryView } from "@/components/views/import-history-view";
import { SettingsMappingView } from "@/components/views/settings-mapping-view";
import { SettingsLookupView } from "@/components/views/settings-lookup-view";
import { SettingsValidationView } from "@/components/views/settings-validation-view";
import { QuantityValidationView } from "@/components/views/quantity-validation-view";
import { ProductionStatsView } from "@/components/views/production-stats-view";
import { OrderNotesView } from "@/components/views/order-notes-view";

export default function Home() {
  const { view } = useAppStore();
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="flex-1 overflow-y-auto scroll-thin">
          <div className="mx-auto w-full max-w-[1500px] px-4 py-6 md:px-6">
            {view === "dashboard" && <DashboardView />}
            {view === "master-data" && <MasterDataView />}
            {view === "data-entry" && <DataEntryView />}
            {view === "data-management" && <DataManagementView />}
            {view === "import-excel" && <ImportExcelView />}
            {view === "export-excel" && <ExportExcelView />}
            {view === "import-history" && <ImportHistoryView />}
            {view === "settings-mapping" && <SettingsMappingView />}
            {view === "settings-lookup" && <SettingsLookupView />}
            {view === "settings-validation" && <SettingsValidationView />}
            {view === "quantity-validation" && <QuantityValidationView />}
            {view === "production-stats" && <ProductionStatsView />}
            {view === "order-notes" && <OrderNotesView />}
          </div>
        </main>
      </div>
    </div>
  );
}
