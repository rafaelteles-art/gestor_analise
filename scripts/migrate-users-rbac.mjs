import pg from 'pg';
const { Pool } = pg;

const gcpDbUrl = process.env.DATABASE_URL;
if (!gcpDbUrl) {
  console.error('Missing DATABASE_URL in .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: gcpDbUrl,
  ssl: { rejectUnauthorized: false },
});

const SUPER_ADMINS = [
  { email: 'rafael.teles@v2globalteam.com', name: 'Rafael Teles' },
  { email: 'pedro.oliveira@v2globalteam.com', name: 'Pedro Oliveira' },
];

async function main() {
  console.log('==> Criando schema de RBAC (users + user_page_access)...');

  const sql = `
    CREATE TABLE IF NOT EXISTS public.app_users (
      email        varchar PRIMARY KEY,
      name         varchar,
      role         varchar NOT NULL DEFAULT 'user' CHECK (role IN ('super_admin','admin','user')),
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.user_page_access (
      email   varchar NOT NULL REFERENCES public.app_users(email) ON DELETE CASCADE,
      page    varchar NOT NULL,
      PRIMARY KEY (email, page)
    );

    CREATE INDEX IF NOT EXISTS idx_user_page_access_email ON public.user_page_access(email);
  `;

  await pool.query(sql);
  console.log('    OK: tabelas criadas/atualizadas.');

  console.log('\n==> Garantindo super_admins...');
  for (const sa of SUPER_ADMINS) {
    await pool.query(
      `INSERT INTO public.app_users (email, name, role)
       VALUES ($1, $2, 'super_admin')
       ON CONFLICT (email) DO UPDATE SET role = 'super_admin', name = COALESCE(public.app_users.name, EXCLUDED.name), updated_at = now()`,
      [sa.email, sa.name]
    );
    console.log(`    OK: ${sa.email}`);
  }

  console.log('\n==> Concluído.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
