import { pool } from '@/lib/db';
import { getMetaProfiles } from '@/lib/config';
import V2MediaLabLayout from '../components/V2MediaLabLayout';
import ClientCampaignBuilder from './ClientCampaignBuilder';

export const dynamic = 'force-dynamic';

interface AccountRow {
  account_id: string;
  account_name: string;
  bm_name: string;
  moeda: string | null;
  timezone: string | null;
  account_status: string | null;
  /** preenchido server-side cruzando access_token com getMetaProfiles() */
  profile_name: string | null;
  /** apelido livre dado pelo usuário; null se não definido */
  nickname: string | null;
}

export default async function CampaignsPage() {
  let accounts: AccountRow[] = [];
  let profileNames: string[] = [];

  try {
    const profiles = await getMetaProfiles();
    profileNames = profiles.map((p) => p.name);
    const tokenToProfile = new Map(profiles.map((p) => [p.token, p.name]));

    // Garante as colunas (caso /campaigns seja aberta antes do primeiro sync pós-deploy).
    await pool.query(
      `ALTER TABLE meta_ad_accounts ADD COLUMN IF NOT EXISTS accessible_profiles TEXT[] DEFAULT '{}'`
    );
    await pool.query(
      `ALTER TABLE meta_ad_accounts ADD COLUMN IF NOT EXISTS nickname TEXT`
    );

    // Mostra todas as contas que não estão desabilitadas/fechadas, independente de is_selected.
    // O usuário pode publicar em qualquer conta visível na BM dele.
    const res = await pool.query(
      `SELECT account_id, account_name, bm_name, moeda, timezone, account_status,
              access_token, accessible_profiles, nickname
         FROM meta_ad_accounts
        WHERE access_token IS NOT NULL
          AND COALESCE(account_status, 'ACTIVE') NOT IN ('DISABLED', 'CLOSED', 'PENDING_CLOSURE')
        ORDER BY bm_name ASC, account_name ASC`
    );

    // "Explode" cada conta em N entradas — uma por perfil que pode acessá-la.
    // Mesmo account_id pode aparecer sob múltiplos perfis (não há dedup nesta tela).
    // Fallback: se accessible_profiles estiver vazio (sync antigo), usa token-match.
    accounts = res.rows.flatMap((r): AccountRow[] => {
      const profilesForAccount: string[] =
        Array.isArray(r.accessible_profiles) && r.accessible_profiles.length > 0
          ? r.accessible_profiles
          : (() => {
              const fallback = tokenToProfile.get(r.access_token);
              return fallback ? [fallback] : [];
            })();

      // Se não conseguimos atribuir a nenhum perfil, ainda mostra como "sem perfil"
      // — útil pra debug, mas sem efeito prático já que availableProfiles é fonte
      // separada.
      if (profilesForAccount.length === 0) {
        return [{
          account_id: r.account_id,
          account_name: r.account_name,
          bm_name: r.bm_name,
          moeda: r.moeda,
          timezone: r.timezone,
          account_status: r.account_status,
          profile_name: null,
          nickname: r.nickname ?? null,
        }];
      }

      return profilesForAccount.map((pname) => ({
        account_id: r.account_id,
        account_name: r.account_name,
        bm_name: r.bm_name,
        moeda: r.moeda,
        timezone: r.timezone,
        account_status: r.account_status,
        profile_name: pname,
        nickname: r.nickname ?? null,
      }));
    });
  } catch (err) {
    console.error('[campaigns] erro carregando contas/perfis:', err);
  }

  return (
    <V2MediaLabLayout title="Criar campanha">
      <div className="max-w-5xl">
        <ClientCampaignBuilder accounts={accounts} profileNames={profileNames} />
      </div>
    </V2MediaLabLayout>
  );
}
