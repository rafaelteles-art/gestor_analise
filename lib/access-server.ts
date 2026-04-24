import 'server-only';
import { pool } from '@/lib/db';
import { SUPER_ADMIN_EMAILS, type Role } from '@/lib/access';

export async function loadUserAccess(email: string): Promise<{
  role: Role;
  name: string | null;
  pages: string[];
} | null> {
  const isSuper = SUPER_ADMIN_EMAILS.includes(email);
  const upsertRole = isSuper ? 'super_admin' : 'user';

  const { rows } = await pool.query(
    `INSERT INTO public.app_users (email, role)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET
       role = CASE
         WHEN $2 = 'super_admin' THEN 'super_admin'
         ELSE public.app_users.role
       END,
       updated_at = now()
     RETURNING email, name, role`,
    [email, upsertRole]
  );

  if (rows.length === 0) return null;
  const u = rows[0];

  const pagesRes = await pool.query(
    'SELECT page FROM public.user_page_access WHERE email = $1',
    [email]
  );

  return {
    role: u.role as Role,
    name: u.name ?? null,
    pages: pagesRes.rows.map((r: any) => r.page),
  };
}
