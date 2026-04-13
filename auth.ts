import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    // Controla o acesso a rotas — chamado pelo middleware
    authorized({ auth: session, request: { nextUrl } }) {
      const isLoggedIn = !!session?.user;
      const pathname = nextUrl.pathname;

      // Rotas internas do NextAuth: sempre permitir (senão bloqueia o próprio login)
      if (pathname.startsWith("/api/auth")) return true;

      // Na página de login: se já logado, manda pro app
      if (pathname === "/login") {
        if (isLoggedIn) return Response.redirect(new URL("/import", nextUrl));
        return true;
      }

      // Em qualquer outra rota: exige login
      if (!isLoggedIn) return false; // NextAuth redireciona para /login automaticamente

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
