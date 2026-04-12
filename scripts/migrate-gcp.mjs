
import pg from 'pg';
const { Pool } = pg;
import { createClient } from '@supabase/supabase-js';

// Setup Supabase Client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE URL or KEY in .env");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

// Setup GCP Postgres Client
const gcpDbUrl = process.env.DATABASE_URL;
if (!gcpDbUrl) {
  console.error("Missing DATABASE_URL in .env");
  process.exit(1);
}
const pool = new Pool({
  connectionString: gcpDbUrl,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  console.log("==> Iniciando migração do Supabase para GCP PostgreSQL...");

  // 1. Criar as Tabelas no GCP
  console.log("\\n[1/3] Criando schemas no GCP...");
  const createTablesSql = `
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

    CREATE TABLE IF NOT EXISTS public.meta_ad_accounts (
      id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
      account_id character varying NOT NULL UNIQUE,
      account_name character varying,
      bm_id character varying,
      bm_name character varying,
      is_selected boolean DEFAULT false,
      access_token text,
      created_at timestamp with time zone DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.redtrack_campaign_selections (
      id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
      campaign_id character varying NOT NULL UNIQUE,
      campaign_name character varying,
      status character varying,
      is_selected boolean DEFAULT false,
      created_at timestamp with time zone DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.meta_ads_metrics (
      id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
      date date NOT NULL,
      campaign_id character varying NOT NULL,
      campaign_name character varying,
      spend numeric DEFAULT 0,
      impressions integer DEFAULT 0,
      clicks integer DEFAULT 0,
      conversions integer DEFAULT 0,
      ctr numeric DEFAULT 0,
      cpm numeric DEFAULT 0,
      created_at timestamp with time zone DEFAULT now(),
      UNIQUE (date, campaign_id)
    );

    CREATE TABLE IF NOT EXISTS public.redtrack_metrics (
      id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
      date date NOT NULL,
      campaign_id character varying NOT NULL,
      campaign_name character varying,
      clicks integer DEFAULT 0,
      conversions integer DEFAULT 0,
      total_conversions integer DEFAULT 0,
      revenue numeric DEFAULT 0,
      total_revenue numeric DEFAULT 0,
      cost numeric DEFAULT 0,
      profit numeric DEFAULT 0,
      roas numeric DEFAULT 0,
      created_at timestamp with time zone DEFAULT now(),
      UNIQUE (date, campaign_id)
    );
  `;
  await pool.query(createTablesSql);
  console.log("      Tabelas criadas com sucesso!");

  // 2. Migrando Meta Ad Accounts
  console.log("\\n[2/3] Migrando meta_ad_accounts...");
  let { data: metaData, error: metaErr } = await supabase.from('meta_ad_accounts').select('*');
  if (metaErr) {
    console.error("Erro no supabase / meta_ad_accounts: ", metaErr);
  } else if (metaData && metaData.length > 0) {
    console.log(`      Extraídas ${metaData.length} contas do Supabase. Inserindo no GCP...`);
    let count = 0;
    for (const row of metaData) {
      await pool.query(
        `INSERT INTO public.meta_ad_accounts (id, account_id, account_name, bm_id, bm_name, is_selected, access_token, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (account_id) DO NOTHING`,
        [row.id, row.account_id, row.account_name, row.bm_id, row.bm_name, row.is_selected, row.access_token, row.created_at]
      );
      count++;
    }
    console.log(`      Finalizado! ${count} inserções bem sucedidas.`);
  }

  // 3. Migrando RedTrack Campaigns
  console.log("\\n[3/3] Migrando redtrack_campaign_selections...");
  let hasMore = true;
  let page = 0;
  const pageSize = 1000;
  let totalCount = 0;

  while(hasMore) {
    let { data: rtData, error: rtErr } = await supabase.from('redtrack_campaign_selections').select('*').range(page * pageSize, (page + 1) * pageSize - 1);
    if (rtErr) {
      console.error("Erro no supabase / redtrack_campaign: ", rtErr);
      break;
    } else if (rtData && rtData.length > 0) {
      console.log(`      Lendo página ${page+1}... Extraídas ${rtData.length} campanhas do Supabase. Inserindo no GCP...`);
      for (const row of rtData) {
        await pool.query(
          `INSERT INTO public.redtrack_campaign_selections (id, campaign_id, campaign_name, status, is_selected, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (campaign_id) DO NOTHING`,
          [row.id, row.campaign_id, row.campaign_name, row.status, row.is_selected, row.created_at]
        );
        totalCount++;
      }
      if (rtData.length < pageSize) {
        hasMore = false;
      } else {
        page++;
      }
    } else {
      hasMore = false;
    }
  }
  console.log(`      Finalizado! ${totalCount} totais de inserções bem sucedidas da tabela redtrack_campaign_selections.`);

  console.log("\\n==> Migração Finalizada com Sucesso!");
  process.exit(0);
}

main().catch(err => {
  console.error("Critical Error Detail:", err);
  process.exit(1);
});
