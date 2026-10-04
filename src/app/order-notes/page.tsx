"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Breadcrumb } from "@/components/layout/breadcrumb";
import { OrderNotesView } from "@/components/views/order-notes-view";

export default function OrderNotesPage() {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <Breadcrumb />
        <main className="flex-1 overflow-y-auto">
          <OrderNotesView />
        </main>
      </div>
    </div>
  );
}
