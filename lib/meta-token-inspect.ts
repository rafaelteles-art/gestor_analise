/**
 * Inspeção de tokens Meta — verifica se um token tem as permissões certas
 * para ler dados E publicar campanhas.
 *
 * Refs:
 *  - GET /me                  https://developers.facebook.com/docs/graph-api/reference/user
 *  - GET /me/permissions      https://developers.facebook.com/docs/facebook-login/permissions
 *  - GET /debug_token         https://developers.facebook.com/docs/facebook-login/guides/access-tokens/debugging
 *  - GET /me/businesses       https://developers.facebook.com/docs/marketing-api/business-asset-management
 */

import { META_API_VERSION } from './meta-campaigns';

const GRAPH = `https://graph.facebook.com/${META_API_VERSION}`;

// Permissões necessárias para PUBLICAR campanhas de conversão de website
export const REQUIRED_SCOPES_PUBLISH = [
  'ads_management',
  'pages_show_list',
  'pages_manage_ads',
  'pages_read_engagement',
  'business_management',
] as const;

// Permissões opcionais (úteis mas não bloqueiam)
export const OPTIONAL_SCOPES = [
  'instagram_basic',
  'instagram_content_publish',
  'ads_read',
] as const;

// Conjunto mínimo só pra LER (status atual da app antes desta feature)
export const REQUIRED_SCOPES_READ = ['ads_read'] as const;

export type Scope =
  | (typeof REQUIRED_SCOPES_PUBLISH)[number]
  | (typeof OPTIONAL_SCOPES)[number]
  | (typeof REQUIRED_SCOPES_READ)[number]
  | string;

export interface TokenInspection {
  /** Token funciona e respondeu /me */
  valid: boolean;
  /** Mensagem amigável quando não é válido */
  error?: string;
  /** Dados do dono do token */
  user?: {
    id: string;
    name: string;
  };
  /** Permissões concedidas */
  granted: Scope[];
  /** Permissões negadas (usuário desativou alguma) */
  declined: Scope[];
  /** Faltando (entre as obrigatórias) — gera ✗ na UI */
  missingRequired: Scope[];
  /** Opcionais que faltam — só info */
  missingOptional: Scope[];
  /** Pode publicar? = todas required atendidas */
  canPublish: boolean;
  /** Quantos BMs o token enxerga */
  businessesCount?: number;
  /** Expiração — se o token tiver TTL (System User não expira) */
  expiresAt?: string | null;
  /** Se for de System User (não há "expira em X dias") */
  neverExpires?: boolean;
}

interface PermissionItem {
  permission: string;
  status: 'granted' | 'declined' | 'expired';
}

/**
 * Inspeciona um token. Não joga exceção — sempre retorna o resultado,
 * com `valid=false` + `error` se algo falhou.
 */
export async function inspectMetaToken(token: string): Promise<TokenInspection> {
  const baseResult: TokenInspection = {
    valid: false,
    granted: [],
    declined: [],
    missingRequired: [...REQUIRED_SCOPES_PUBLISH],
    missingOptional: [...OPTIONAL_SCOPES],
    canPublish: false,
  };

  if (!token || token.length < 20) {
    return { ...baseResult, error: 'Token vazio ou curto demais.' };
  }

  // 1. /me — confirma que o token funciona
  let user: { id: string; name: string } | undefined;
  try {
    const meRes = await fetch(`${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(token)}`);
    const me = (await meRes.json()) as { id?: string; name?: string; error?: { message?: string } };
    if (me.error) return { ...baseResult, error: me.error.message ?? 'Token inválido.' };
    if (!me.id) return { ...baseResult, error: 'Resposta inesperada da Meta em /me.' };
    user = { id: me.id, name: me.name ?? me.id };
  } catch (err) {
    return { ...baseResult, error: 'Falha de rede ao consultar /me: ' + (err instanceof Error ? err.message : String(err)) };
  }

  // 2. /me/permissions — descobre os scopes
  let permissions: PermissionItem[] = [];
  try {
    const permRes = await fetch(`${GRAPH}/me/permissions?access_token=${encodeURIComponent(token)}`);
    const perm = (await permRes.json()) as { data?: PermissionItem[]; error?: { message?: string } };
    if (perm.error) {
      // System User tokens podem não responder /me/permissions — fallback para /debug_token abaixo
      permissions = [];
    } else {
      permissions = perm.data ?? [];
    }
  } catch {
    permissions = [];
  }

  let granted = permissions.filter((p) => p.status === 'granted').map((p) => p.permission);
  const declined = permissions.filter((p) => p.status !== 'granted').map((p) => p.permission);

  // 3. Se não conseguimos scopes via /me/permissions (típico de System User),
  //    tenta via /debug_token usando o próprio token como app token (funciona quando
  //    é um token de System User do mesmo app — mas geralmente exige App Access Token).
  //    Como não temos APP_ID|APP_SECRET configurados, pulamos esse caminho e
  //    inferimos via "consigo listar /me/businesses?" como heurística.
  let businessesCount: number | undefined;
  try {
    const bmRes = await fetch(`${GRAPH}/me/businesses?fields=id&limit=1&access_token=${encodeURIComponent(token)}`);
    const bm = (await bmRes.json()) as { data?: unknown[]; error?: { message?: string } };
    if (!bm.error) {
      businessesCount = Array.isArray(bm.data) ? bm.data.length : 0;
      // Se /me/permissions veio vazio mas /me/businesses respondeu, presumimos
      // ao menos business_management
      if (granted.length === 0 && businessesCount !== undefined) {
        granted = ['business_management'];
      }
    }
  } catch {
    // ignora
  }

  // 4. Heurística complementar: tenta /me/adaccounts pra inferir ads_*
  try {
    const adRes = await fetch(`${GRAPH}/me/adaccounts?fields=id&limit=1&access_token=${encodeURIComponent(token)}`);
    const ad = (await adRes.json()) as { data?: unknown[]; error?: { message?: string } };
    if (!ad.error && granted.length <= 1) {
      // Se conseguimos listar contas, ao menos ads_read existe.
      if (!granted.includes('ads_read')) granted.push('ads_read');
    }
  } catch {
    // ignora
  }

  // 5. Tenta /me/accounts pra inferir pages_show_list
  try {
    const pgRes = await fetch(`${GRAPH}/me/accounts?fields=id&limit=1&access_token=${encodeURIComponent(token)}`);
    const pg = (await pgRes.json()) as { data?: unknown[]; error?: { message?: string } };
    if (!pg.error && granted.length <= 2) {
      if (!granted.includes('pages_show_list')) granted.push('pages_show_list');
    }
  } catch {
    // ignora
  }

  // Calcula faltantes
  const grantedSet = new Set(granted);
  const missingRequired = REQUIRED_SCOPES_PUBLISH.filter((s) => !grantedSet.has(s));
  const missingOptional = OPTIONAL_SCOPES.filter((s) => !grantedSet.has(s));

  // Detecta token "permanente" (System User) via padrão do token: começam com EAAB/EAAG e são
  // muito longos. Só uma heurística — não confiável a 100%, então marcamos como dica.
  const looksLikeSystemUser = permissions.length === 0 && /^EAA[A-Z0-9]{4,}/.test(token) && token.length > 150;

  return {
    valid: true,
    user,
    granted,
    declined,
    missingRequired,
    missingOptional,
    canPublish: missingRequired.length === 0,
    businessesCount,
    expiresAt: null, // sem App Token não dá pra checar expiração via /debug_token
    neverExpires: looksLikeSystemUser ? true : undefined,
  };
}
