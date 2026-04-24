import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { canAccessPage, pageKeyFromPath, type Role } from "@/lib/access";

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    // Enriquecer o JWT com role + páginas a partir do DB.
    // Só entra aqui no signIn ou quando explicitamente chamado via update().
    async jwt({ token, trigger, user }) {
      const shouldRefresh =
        trigger === "signIn" || trigger === "signUp" || trigger === "update" || !token.role;

      if (shouldRefresh && token.email) {
        // Import dinâmico para não puxar pg para o edge runtime do proxy.
        const { loadUserAccess } = await import("@/lib/access-server");
        const access = await loadUserAccess(token.email as string);
        if (access) {
          token.role = access.role;
          token.allowedPages = access.pages;
          if (access.name && !token.name) token.name = access.name;
        }
      }

      // user.image vem do provider somente no signIn
      if (user?.image) token.picture = user.image;

      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        (session.user as any).role = (token.role as Role | undefined) ?? "user";
        (session.user as any).allowedPages = (token.allowedPages as string[] | undefined) ?? [];
      }
      return session;
    },

    // Controla o acesso a rotas — chamado pelo middleware
    authorized({ auth: session, request: { nextUrl } }) {
      const isLoggedIn = !!session?.user;
      const pathname = nextUrl.pathname;

      if (pathname.startsWith("/api/auth")) return true;

      if (pathname === "/login") {
        if (isLoggedIn) return Response.redirect(new URL("/import", nextUrl));
        return true;
      }

      if (!isLoggedIn) return false;

      // Rotas públicas para qualquer usuário logado (APIs internas, root, etc.)
      const alwaysAllowed =
        pathname === "/" ||
        pathname.startsWith("/api/") ||
        pathname.startsWith("/_next/");
      if (alwaysAllowed) return true;

      const role = (session!.user as any).role as Role | undefined;
      const allowedPages = ((session!.user as any).allowedPages as string[] | undefined) ?? [];

      const pageKey = pageKeyFromPath(pathname);
      if (!pageKey) return true; // rota não catalogada: libera (ex.: 404 interna)

      if (!canAccessPage(role, allowedPages, pageKey)) {
        return Response.redirect(new URL("/import", nextUrl));
      }

      return true;
    },

    // Restringe acesso apenas a emails @v2globalteam.com
    signIn({ profile }) {
      const email = profile?.email ?? "";
      return email.endsWith("@v2globalteam.com");
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});
