import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

// §43 Security: NextAuth credentials provider with bcrypt password hashing
// and role-based access control (admin | operator | viewer).
export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const user = await db.user.findUnique({
          where: { email: credentials.email.toLowerCase().trim() },
        });
        if (!user) return null;
        const ok = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!ok) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          role: user.role,
        } as any;
      },
    }),
  ],
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 }, // 8 hours
  pages: { signIn: "/login" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role;
        token.id = (user as any).id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).role = token.role;
        (session.user as any).id = token.id;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

// Role permission matrix (spec §43).
//   Admin:    Import, Export, Edit Master, Settings, Users, Data Entry, Delete
//   Operator: Data Entry, Search, Export, Edit own entries
//   Viewer:   View, Search, Export (read-only)
export type Role = "admin" | "operator" | "viewer";

const PERMISSIONS: Record<Role, Set<string>> = {
  admin: new Set([
    "master:read", "master:edit", "master:delete",
    "entry:read", "entry:create", "entry:edit", "entry:delete",
    "excel:import", "excel:export",
    "settings:read", "settings:write",
    "users:read", "users:write",
    "quantity:read", "notes:read", "notes:write",
    "statistics:read",
  ]),
  operator: new Set([
    "master:read",
    "entry:read", "entry:create", "entry:edit",
    "excel:export",
    "settings:read",
    "quantity:read", "notes:read", "notes:write",
    "statistics:read",
  ]),
  viewer: new Set([
    "master:read",
    "entry:read",
    "excel:export",
    "settings:read",
    "quantity:read", "notes:read",
    "statistics:read",
  ]),
};

export function can(role: string | undefined | null, permission: string): boolean {
  if (!role) return false;
  return (PERMISSIONS[role as Role] ?? new Set()).has(permission);
}

// Helper for API route handlers: returns the session user's role, or null.
// In demo mode (no users in DB), write operations are allowed without auth.
export async function getRoleOrDemo(): Promise<{ role: string | null; demo: boolean; user: any | null }> {
  const session = await getServerSession(authOptions);
  if (session?.user) {
    return { role: (session.user as any).role, demo: false, user: session.user };
  }
  // Demo mode: if no users exist yet, allow all operations (bootstrap).
  const count = await db.user.count();
  if (count === 0) return { role: "admin", demo: true, user: null };
  return { role: null, demo: false, user: null };
}

// Convenience: check a permission in demo-aware mode.
export async function checkPerm(permission: string): Promise<{ ok: boolean; status?: number; error?: string; user: any | null }> {
  const { role, user } = await getRoleOrDemo();
  if (can(role, permission)) return { ok: true, user };
  return { ok: false, status: 403, error: "Forbidden — insufficient permissions" + (role ? ` (role: ${role})` : " (not authenticated)"), user: null };
}
