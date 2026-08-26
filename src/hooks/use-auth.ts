"use client";

import { useSession, signIn, signOut } from "next-auth/react";

export function useAuth() {
  const { data: session, status } = useSession();
  const user = session?.user as
    | { id?: string; email?: string | null; name?: string | null; role?: string }
    | undefined;
  return {
    user,
    status, // "loading" | "authenticated" | "unauthenticated"
    isAuthenticated: status === "authenticated",
    isLoading: status === "loading",
    role: user?.role ?? null,
    signIn,
    signOut,
  };
}
