import { auth } from "@/auth";

export default auth;

export const config = {
  // Aplica em todas as rotas exceto arquivos estáticos e de imagem
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.jpeg|.*\\.svg).*)"],
};
