"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Redirect / → /dashboard (spec §3: /dashboard is the main entry point).
// Using client-side redirect to avoid redirect loop through gateway proxy.
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard");
  }, [router]);
  return null;
}
