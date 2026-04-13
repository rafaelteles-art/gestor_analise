import { signIn } from "@/auth";
import Image from "next/image";

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const error = searchParams?.error;

  return (
    <div className="min-h-screen bg-[#f4f7fb] flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-10 w-full max-w-sm flex flex-col items-center gap-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <Image
            src="/v2medialab-logo.jpeg"
            alt="V2 Media Lab"
            width={64}
            height={64}
            className="rounded-full object-cover"
          />
          <div className="text-center">
            <p className="text-lg font-bold text-gray-900">V2 Media Lab</p>
            <p className="text-xs text-gray-400 font-medium tracking-wider uppercase">Analytics</p>
          </div>
        </div>

        {/* Mensagem de erro */}
        {error && (
          <div className="w-full bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 text-center">
            {error === "AccessDenied"
              ? "Acesso negado. Use um email @v2globalteam.com para entrar."
              : "Ocorreu um erro ao fazer login. Tente novamente."}
          </div>
        )}

        {/* Título */}
        <div className="text-center">
          <h1 className="text-xl font-semibold text-gray-900">Bem-vindo</h1>
          <p className="text-sm text-gray-500 mt-1">
            Faça login com sua conta Google corporativa
          </p>
        </div>

        {/* Botão Google */}
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/import" });
          }}
          className="w-full"
        >
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-3 border border-gray-300 rounded-lg px-4 py-3 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors shadow-sm"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Entrar com Google
          </button>
        </form>

        <p className="text-xs text-gray-400 text-center">
          Apenas emails <span className="font-medium text-gray-500">@v2globalteam.com</span> têm acesso
        </p>
      </div>
    </div>
  );
}
