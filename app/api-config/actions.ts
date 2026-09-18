'use server'

import { pool } from '@/lib/db';
import { invalidateConfigCache } from '@/lib/config';
import { META_API_VERSION } from '@/lib/meta-campaigns';
import { inspectMetaToken } from '@/lib/meta-token-inspect';
import { diffProfiles } from '@/lib/profile-diff';
import { createPageSyncJob } from '@/lib/sync-jobs';

// Garante que a tabela de configurações existe
async function ensureSettingsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

export async function getStoredTokens() {
  let metaProfiles: { name: string; token: string }[] = [];
  let redtrackKey = '';
  let vturbToken = '';

  // 1. Tenta ler do banco de dados (fonte primária e persistente)
  try {
    await ensureSettingsTable();
    const result = await pool.query(
      `SELECT key, value FROM app_settings WHERE key IN ('META_PROFILES', 'REDTRACK_API_KEY', 'VTURB_API_TOKEN')`
    );
    for (const row of result.rows) {
      if (row.key === 'META_PROFILES') {
        try { metaProfiles = JSON.parse(row.value); } catch {}
      } else if (row.key === 'REDTRACK_API_KEY') {
        redtrackKey = row.value;
      } else if (row.key === 'VTURB_API_TOKEN') {
        vturbToken = row.value;
      }
    }
  } catch (e) {
    // DB indisponível — cai no fallback abaixo
  }

  // 2. Fallback: lê de process.env (compatibilidade com .env.local existente)
  if (metaProfiles.length === 0) {
    try {
      if (process.env.META_PROFILES) {
        metaProfiles = JSON.parse(process.env.META_PROFILES);
      } else if (process.env.META_ACCESS_TOKEN) {
        metaProfiles = [{ name: 'Default', token: process.env.META_ACCESS_TOKEN }];
      }
    } catch {}
  }
  if (!redtrackKey) {
    redtrackKey = process.env.REDTRACK_API_KEY || '';
  }
  if (!vturbToken) {
    vturbToken = process.env.VTURB_API_TOKEN || '';
  }

  return { metaProfiles, redtrackKey, vturbToken };
}

// Tabelas que ligam ativos ao NOME do perfil. Rename sem migrar = tudo órfão.
const PROFILE_LINK_TABLES = ['meta_pages', 'meta_ad_accounts', 'meta_catalogs'] as const;

/** id estável do dono do token (System User) via /me — undefined se o token estiver morto. */
async function metaUserId(token: string): Promise<string | undefined> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/me?fields=id&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    const j = (await res.json()) as { id?: string };
    return j.id;
  } catch {
    return undefined;
  }
}

async function renameProfileEverywhere(from: string, to: string): Promise<void> {
  for (const table of PROFILE_LINK_TABLES) {
    try {
      await pool.query(
        `UPDATE ${table}
            SET accessible_profiles = ARRAY(SELECT DISTINCT unnest(array_replace(accessible_profiles, $1::text, $2::text)))
          WHERE $1 = ANY(accessible_profiles)`,
        [from, to],
      );
    } catch (e: unknown) {
      if ((e as { code?: string })?.code !== '42P01') throw e; // tabela ainda não existe neste ambiente — ignora
    }
  }
}

export interface SaveApiTokensResult {
  success: boolean;
  error?: string;
  /** Avisos não bloqueantes (perfil novo sem Páginas, sync não enfileirado…). */
  warnings?: string[];
  /** Renames migrados automaticamente. */
  renamed?: { from: string; to: string }[];
  /** Perfis cujo sync de páginas foi enfileirado automaticamente. */
  synced?: string[];
}

/**
 * Salva os perfis e mantém o resto do app coerente sozinho:
 *  1. Rename (mesmo token ou mesmo System User com nome novo) → migra
 *     `accessible_profiles` em páginas/contas/catálogos para o nome novo.
 *  2. Token trocado/renomeado que não enxerga NENHUMA Página → recusa salvar
 *     (System User sem Páginas atribuídas no BM não publica; ver ApiTokenForm).
 *     Perfil novo com zero Páginas só gera aviso (pode estar em configuração).
 *  3. Perfil novo, renomeado ou com token trocado → enfileira o sync de páginas
 *     do perfil automaticamente (o cron /api/cron/pages-sync executa).
 */
export async function saveApiTokens(
  metaProfiles: { name: string; token: string }[],
  redtrackKey: string,
  vturbToken: string = ''
): Promise<SaveApiTokensResult> {
  try {
    await ensureSettingsTable();

    const { metaProfiles: oldProfiles } = await getStoredTokens();

    // Identidade estável só para tokens que entraram/saíram (evita bater na Meta à toa).
    const oldTokens = new Set(oldProfiles.map((p) => p.token));
    const newTokens = new Set(metaProfiles.map((p) => p.token));
    const identity = new Map<string, string>();
    await Promise.all(
      [...oldProfiles.filter((p) => !newTokens.has(p.token)), ...metaProfiles.filter((p) => !oldTokens.has(p.token))]
        .map(async (p) => { const id = await metaUserId(p.token); if (id) identity.set(p.token, id); }),
    );
    const diff = diffProfiles(oldProfiles, metaProfiles, identity);

    const warnings: string[] = [];
    const toInspect = [
      ...diff.changedToken.map((name) => ({ name, existing: true })),
      ...diff.renamed.map((r) => ({ name: r.to, existing: true })),
      ...diff.added.map((name) => ({ name, existing: false })),
    ];
    for (const { name, existing } of toInspect) {
      const token = metaProfiles.find((p) => p.name === name)!.token;
      const ins = await inspectMetaToken(token);
      if (!ins.valid) {
        if (existing) return { success: false, error: `Perfil ${name}: token inválido — ${ins.error ?? 'sem detalhe'}. Nada foi salvo.` };
        warnings.push(`Perfil ${name}: token inválido (${ins.error ?? 'sem detalhe'}).`);
        continue;
      }
      if (ins.pagesCount === 0) {
        const msg =
          `Perfil ${name}: o token não enxerga nenhuma Página. No Business Manager, atribua as Páginas ao ` +
          `System User (Configurações do negócio → Usuários do sistema → Adicionar ativos → Páginas) e salve de novo.`;
        if (existing) return { success: false, error: msg + ' Nada foi salvo.' };
        warnings.push(msg);
      }
    }

    for (const r of diff.renamed) await renameProfileEverywhere(r.from, r.to);

    const profilesStr = JSON.stringify(metaProfiles);

    // Salva no banco de dados (persistente entre reinícios)
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('META_PROFILES', $1, NOW()),
              ('REDTRACK_API_KEY', $2, NOW()),
              ('VTURB_API_TOKEN', $3, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [profilesStr, redtrackKey, vturbToken]
    );

    // Atualiza process.env para a sessão atual (rotas de sync usam isso)
    process.env.META_PROFILES = profilesStr;
    process.env.REDTRACK_API_KEY = redtrackKey;
    process.env.VTURB_API_TOKEN = vturbToken;
    if (metaProfiles.length > 0) {
      process.env.META_ACCESS_TOKEN = metaProfiles[0].token;
    }

    // Invalida o cache in-memory de lib/config.ts
    invalidateConfigCache();

    // Sync de páginas automático para tudo que é novo/trocado/renomeado.
    const synced = [...new Set([...diff.changedToken, ...diff.renamed.map((r) => r.to), ...diff.added])];
    if (synced.length > 0) {
      try {
        await createPageSyncJob({ kind: 'profile', profiles: synced });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        warnings.push(`Perfis salvos, mas o sync de páginas não foi enfileirado (${msg}). Rode "Buscar páginas" em /paginas.`);
      }
    }

    return { success: true, warnings, renamed: diff.renamed, synced };
  } catch (err: any) {
    console.error(err);
    return { success: false, error: err.message };
  }
}
