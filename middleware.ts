import { auth } from "@/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Rotas públicas que não precisam de autenticação
const PUBLIC_ROUTES = ["/login"];
const AUTH_ROUTES = ["/api/auth"];

export default auth((req) => {
  const { nextUrl, auth: session } = req as NextRequest & { auth: typeof req.auth };
  const pathname = nextUrl.pathname;

  // Permite rotas de autenticação passarem sem verificação
  if (AUTH_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Permite rotas públicas passarem sem verificação
  if (PUBLIC_ROUTES.includes(pathname)) {
    // Se já está logado, redireciona para o app
    if (session) {
      return NextResponse.redirect(new URL("/import", nextUrl));
    }
    return NextResponse.next();
  }

  // Para todas as outras rotas: exige autenticação
  if (!session) {
    return NextResponse.redirect(new URL("/login", nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  // Aplica o middleware em todas as rotas exceto arquivos estáticos
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.jpeg|.*\\.svg).*)"],
};
