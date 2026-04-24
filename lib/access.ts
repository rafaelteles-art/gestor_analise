export type Role = 'super_admin' | 'admin' | 'user';

export type PageDef = {
  key: string;
  label: string;
  path: string;
};

export const SUPER_ADMIN_EMAILS = [
  'rafael.teles@v2globalteam.com',
  'pedro.oliveira@v2globalteam.com',
];

export const PAGES: PageDef[] = [
  { key: 'import',        label: 'Dashboard',           path: '/import' },
  { key: 'status-contas', label: 'Status de Contas',    path: '/status-contas' },
  { key: 'analise',       label: 'Análise',             path: '/analise' },
  { key: 'ofertas',       label: 'Ofertas',             path: '/ofertas' },
  { key: 'settings',      label: 'Contas de anúncios',  path: '/settings' },
  { key: 'api-config',    label: 'Configurações',       path: '/api-config' },
];

export const ADMIN_ONLY_PAGES: PageDef[] = [
  { key: 'users', label: 'Usuários', path: '/users' },
];

export const ALL_PAGES: PageDef[] = [...PAGES, ...ADMIN_ONLY_PAGES];

export function pageKeyFromPath(pathname: string): string | null {
  const clean = pathname.split('?')[0].replace(/\/+$/, '') || '/';
  const hit = ALL_PAGES.find((p) => clean === p.path || clean.startsWith(p.path + '/'));
  return hit?.key ?? null;
}

export function canManageUsers(role: Role | undefined | null): boolean {
  return role === 'super_admin' || role === 'admin';
}

export function canAccessPage(
  role: Role | undefined | null,
  allowedPages: string[] | undefined,
  pageKey: string
): boolean {
  if (!role) return false;
  if (role === 'super_admin') return true;
  if (role === 'admin' && pageKey === 'users') return true;
  return (allowedPages ?? []).includes(pageKey);
}
