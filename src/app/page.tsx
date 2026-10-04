import { redirect } from "next/navigation";

// Redirect / → /dashboard (spec §3: /dashboard is the main entry point).
export default function Home() {
  redirect("/dashboard");
}
