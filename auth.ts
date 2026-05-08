import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { canAccessPage, firstAllowedPath, pageKeyFromPath, type Role } from "@/lib/access";

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
    authorized({ auth: session, request }) {
      const { nextUrl } = request;
      const isLoggedIn = !!session?.user;
      const pathname = nextUrl.pathname;

      if (pathname.startsWith("/api/auth")) return true;
      // Cron jobs (Cloud Scheduler) — auth via Bearer token dentro do handler
      if (pathname.startsWith("/api/cron/")) return true;
      // Rotas /api/sync/* chamadas pelo cron — libera quando Bearer bate com CRON_SECRET
      if (pathname.startsWith("/api/sync/") && process.env.CRON_SECRET) {
        const authz = request.headers.get("authorization") ?? "";
        if (authz === `Bearer ${process.env.CRON_SECRET}`) return true;
      }

      const role = (session?.user as any)?.role as Role | undefined;
      const allowedPages = ((session?.user as any)?.allowedPages as string[] | undefined) ?? [];
      const fallback = isLoggedIn ? firstAllowedPath(role, allowedPages) : null;

      if (pathname === "/login") {
        if (!isLoggedIn) return true;
        // Logado com acesso a alguma página → vai pra ela
        if (fallback) return Response.redirect(new URL(fallback, nextUrl));
        // Logado sem acesso a nada → mostra erro no /login (sem loop)
        if (nextUrl.searchParams.get("error") === "no_access") return true;
        const url = new URL("/login", nextUrl);
        url.searchParams.set("error", "no_access");
        return Response.redirect(url);
      }

      if (!isLoggedIn) return false;

      // Rotas públicas para qualquer usuário logado (APIs internas, root, etc.)
      const alwaysAllowed =
        pathname === "/" ||
        pathname.startsWith("/api/") ||
        pathname.startsWith("/_next/");
      if (alwaysAllowed) return true;

      const pageKey = pageKeyFromPath(pathname);
      if (!pageKey) return true; // rota não catalogada: libera (ex.: 404 interna)

      if (canAccessPage(role, allowedPages, pageKey)) return true;

      // Sem permissão: manda pra primeira página permitida; se não houver, /login com erro
      if (fallback && fallback !== pathname) {
        return Response.redirect(new URL(fallback, nextUrl));
      }
      const url = new URL("/login", nextUrl);
      url.searchParams.set("error", "no_access");
      return Response.redirect(url);
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
