"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Breadcrumb } from "@/components/layout/breadcrumb";
import { ReconV2View } from "@/components/views/recon-v2-view";

export default function ReconV2Page() {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <Breadcrumb />
        <main className="flex-1 overflow-y-auto">
          <ReconV2View />
        </main>
      </div>
    </div>
  );
}
