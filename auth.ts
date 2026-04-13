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
    signIn({ profile }) {
      // Restringe acesso apenas a emails do domínio @v2globalteam.com
      const email = profile?.email ?? "";
      return email.endsWith("@v2globalteam.com");
    },
    session({ session, token }) {
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});
