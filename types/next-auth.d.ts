import type { DefaultSession } from "next-auth";
import type { Role } from "@/lib/access";

declare module "next-auth" {
  interface Session {
    user: {
      role?: Role;
      allowedPages?: string[];
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: Role;
    allowedPages?: string[];
  }
}
