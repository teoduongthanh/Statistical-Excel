import { redirect } from "next/navigation";

// Redirect / → /dashboard (spec §3: /dashboard is the main entry point).
// Using a server-side redirect so the browser follows the HTTP 307
// response directly — no blank screen while waiting for client JS to
// execute (which is critical inside the cross-origin preview iframe,
// where HMR/asset loading can be flaky).
export default function Home() {
  redirect("/dashboard");
}
