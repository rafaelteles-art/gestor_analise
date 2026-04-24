import { redirect } from 'next/navigation';
import { pool } from '@/lib/db';
import { auth } from '@/auth';
import V2MediaLabLayout from '../components/V2MediaLabLayout';
import UsersClient, { type UserRow } from './UsersClient';
import { PAGES, canManageUsers, type Role } from '@/lib/access';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const session = await auth();
  const role = (session?.user as any)?.role as Role | undefined;
  if (!canManageUsers(role)) redirect('/import');

  const users = await pool.query(
    `SELECT u.email, u.name, u.role, u.created_at,
            COALESCE(
              (SELECT array_agg(p.page) FROM public.user_page_access p WHERE p.email = u.email),
              ARRAY[]::varchar[]
            ) AS pages
       FROM public.app_users u
      ORDER BY
        CASE u.role WHEN 'super_admin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
        u.email ASC`
  );

  const rows: UserRow[] = users.rows.map((r: any) => ({
    email: r.email,
    name: r.name,
    role: r.role,
    pages: r.pages ?? [],
    createdAt: (r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)),
  }));

  return (
    <V2MediaLabLayout title="Usuários">
      <UsersClient
        rows={rows}
        pages={PAGES}
        currentUserEmail={session?.user?.email ?? ''}
        currentUserRole={role ?? 'user'}
      />
    </V2MediaLabLayout>
  );
}
