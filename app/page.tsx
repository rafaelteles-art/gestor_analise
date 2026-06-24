import { redirect } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { auth } from '@/auth';
import { ALL_PAGES, canAccessPage, type Role } from '@/lib/access';
import HomeSignOut from './HomeSignOut';
import ConsoleClock from './ConsoleClock';

const PAGE_DESCRIPTIONS: Record<string, string> = {
  'overview':      'Painel executivo com os números do dia.',
  'import':        'Visão geral de Meta Ads e RedTrack.',
  'importv2':      'Nova versão do dashboard com filtros avançados.',
  'status-contas': 'Saúde e limites das contas de anúncios.',
  'paginas':       'Sincronização e saúde das páginas do Facebook.',
  'analise':       'Análise detalhada de performance.',
  'ofertas':       'Catálogo de ofertas e criativos.',
  'catalogo':      'Catálogo do Facebook: produtos, conjuntos e feeds.',
  'campaigns':     'Criação rápida de campanhas em escala.',
  'settings':      'Conexões de BMs, contas e tokens.',
  'api-config':    'Variáveis de ambiente e integrações.',
  'users':         'Gerenciar usuários e permissões.',
  'data-studio':   'Relatório embed do Looker Studio.',
};

/** Call-signs: 3-letter mnemonics operators learn — identity, not order. */
const PAGE_CODES: Record<string, string> = {
  'overview':      'OVR',
  'import':        'DSH',
  'importv2':      'DS2',
  'status-contas': 'STS',
  'paginas':       'PGS',
  'analise':       'ANL',
  'ofertas':       'OFR',
  'catalogo':      'CAT',
  'campaigns':     'CMP',
  'settings':      'CFG',
  'api-config':    'TKN',
  'data-studio':   'STD',
  'users':         'USR',
};

const PAGE_ICONS: Record<string, React.ReactNode> = {
  'overview': (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
  ),
  'import': (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
  ),
  'importv2': (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M4 6h16M4 12h16M4 18h16" /></svg>
  ),
  'status-contas': (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
  ),
  'paginas': (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M7 8h10M7 12h4m1 8a8 8 0 100-16 8 8 0 000 16zm0 0c1.657 0 3-3.582 3-8s-1.343-8-3-8-3 3.582-3 8 1.343 8 3 8z" /></svg>
  ),
  'analise': (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
  ),
  'ofertas': (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>
  ),
  'catalogo': (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
  ),
  'campaigns': (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" /></svg>
  ),
  'settings': (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
  ),
  'api-config': (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
  ),
  'users': (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
  ),
  'data-studio': (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M9 19V6l12-3v13M9 19c0 1.657-1.79 3-4 3s-4-1.343-4-3 1.79-3 4-3 4 1.343 4 3zm12-3c0 1.657-1.79 3-4 3s-4-1.343-4-3 1.79-3 4-3 4 1.343 4 3zM9 10l12-3" /></svg>
  ),
};

const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'SUPER ADMIN',
  admin: 'ADMIN',
  user: 'OPERADOR',
};

export default async function HomePage() {
  const session = await auth();

  if (!session?.user) {
    redirect('/login');
  }

  const user = session.user as typeof session.user & {
    role?: Role;
    allowedPages?: string[];
  };

  const role = user.role;
  const allowedPages = user.allowedPages ?? [];

  const visiblePages = ALL_PAGES.filter((p) =>
    canAccessPage(role, allowedPages, p.key)
  );

  const firstName = user.name?.split(' ')[0] ?? '';
  const roleLabel = role ? ROLE_LABELS[role] : 'CONVIDADO';
  const stationCount = String(visiblePages.length).padStart(2, '0');

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#EEF1F6] text-[#0F1729] dark:bg-[#0A0E1A] dark:text-[#EAEEF7]">
      {/* Ambient blueprint grid */}
      <div className="console-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black,transparent_78%)]" />

      <div className="relative">
        {/* Console bar */}
        <header className="border-b border-[#D8DEE9] bg-white/70 backdrop-blur-md dark:border-[#1E293F] dark:bg-[#0B1120]/70">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6 sm:px-8">
            <div className="flex items-center gap-3">
              <Image
                src="/v2medialab-logo.jpeg"
                alt="V2 Media Lab"
                width={38}
                height={38}
                className="rounded-md object-cover ring-1 ring-black/5 dark:ring-white/10"
              />
              <div className="leading-none">
                <p
                  className="text-sm font-semibold tracking-tight text-[#0F1729] dark:text-[#EAEEF7]"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  V2 Media Lab
                </p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.28em] text-[#F2B12C]">
                  Analytics Console
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="hidden text-right sm:block">
                <p className="text-sm font-medium leading-tight text-[#0F1729] dark:text-[#EAEEF7]">{user.name}</p>
                <p className="font-mono text-[11px] text-[#5A6582] dark:text-[#7E8AA6]">{user.email}</p>
              </div>
              <HomeSignOut />
            </div>
          </div>
        </header>

        {/* Telemetry strip */}
        <div className="border-b border-[#D8DEE9] dark:border-[#1E293F]">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-6 py-3 font-mono text-[11px] sm:px-8">
            <Field label="OPERADOR" value={user.name ?? '—'} />
            <Field label="SESSÃO" value={<ConsoleClock />} />
            <Field label="ESTAÇÕES" value={`${stationCount} liberadas`} />
            <span className="ml-auto inline-flex items-center gap-1.5 rounded border border-[#F2B12C]/40 bg-[#F2B12C]/10 px-2 py-0.5 tracking-[0.18em] text-[#9a6b08] dark:text-[#F2B12C]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#F2B12C]" />
              {roleLabel}
            </span>
          </div>
        </div>

        {/* Hero */}
        <section className="mx-auto max-w-6xl px-6 pb-7 pt-12 sm:px-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[#5A6582] dark:text-[#7E8AA6]">
            Console de Operações
          </p>
          <h1
            className="mt-3 text-3xl font-semibold tracking-tight text-[#0F1729] sm:text-4xl dark:text-[#EAEEF7]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {firstName ? <>Bem-vindo de volta, {firstName}.</> : 'Bem-vindo.'}
          </h1>
          <p className="mt-2 max-w-xl text-[15px] text-[#5A6582] dark:text-[#7E8AA6]">
            Selecione uma estação para começar.
          </p>
        </section>

        {/* Stations */}
        <section className="mx-auto max-w-6xl px-6 pb-20 sm:px-8">
          {visiblePages.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[#C9D1DE] bg-white/60 px-8 py-14 text-center dark:border-[#26334d] dark:bg-[#10172A]/60">
              <p className="font-mono text-[12px] uppercase tracking-[0.28em] text-[#F2B12C]">
                Nenhuma estação liberada
              </p>
              <p className="mx-auto mt-3 max-w-sm text-[15px] text-[#5A6582] dark:text-[#7E8AA6]">
                Peça a um administrador para liberar o seu acesso. Assim que liberado, suas estações aparecem aqui.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visiblePages.map((page, i) => (
                <Link
                  key={page.key}
                  href={page.path}
                  className="station-anim group relative overflow-hidden rounded-lg border border-[#D8DEE9] bg-white px-5 py-5 outline-none transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-[#F2B12C]/60 hover:shadow-[0_10px_34px_-14px_rgba(15,23,41,0.30)] focus-visible:border-[#F2B12C] focus-visible:ring-2 focus-visible:ring-[#F2B12C]/40 dark:border-[#1E293F] dark:bg-[#10172A] dark:hover:border-[#F2B12C]/50 dark:hover:shadow-[0_12px_42px_-18px_rgba(0,0,0,0.85)]"
                  style={{ animationDelay: `${Math.min(i, 12) * 45}ms` }}
                >
                  {/* Amber index rail */}
                  <span className="absolute inset-y-0 left-0 w-[3px] origin-top scale-y-0 bg-[#F2B12C] transition-transform duration-300 group-hover:scale-y-100" />

                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] tracking-[0.2em] text-[#5A6582] dark:text-[#7E8AA6]">
                      <span className="text-[#F2B12C]">[</span> {PAGE_CODES[page.key] ?? '···'} <span className="text-[#F2B12C]">]</span>
                    </span>
                    <span className="grid h-9 w-9 place-items-center rounded-md border border-transparent text-[#5A6582] transition-colors group-hover:border-[#F2B12C]/30 group-hover:text-[#F2B12C] dark:text-[#7E8AA6]">
                      <span className="block h-[18px] w-[18px]">{PAGE_ICONS[page.key]}</span>
                    </span>
                  </div>

                  <h3
                    className="mt-4 text-[17px] font-semibold tracking-tight text-[#0F1729] dark:text-[#EAEEF7]"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {page.label}
                  </h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-[#5A6582] dark:text-[#7E8AA6]">
                    {PAGE_DESCRIPTIONS[page.key] ?? ''}
                  </p>

                  <div className="mt-4 flex items-center gap-1.5 font-mono text-[11px] tracking-[0.2em] text-[#9aa3b8] transition-colors group-hover:text-[#F2B12C] dark:text-[#5A6582]">
                    ABRIR
                    <svg className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="tracking-[0.2em] text-[#9aa3b8] dark:text-[#5A6582]">{label}</span>
      <span className="text-[#0F1729] dark:text-[#C7CFE0]">{value}</span>
    </span>
  );
}
