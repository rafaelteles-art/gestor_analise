'use server';

import { revalidatePath } from 'next/cache';
import { pool } from '@/lib/db';
import { auth } from '@/auth';
import { ALL_PAGES, SUPER_ADMIN_EMAILS, type Role } from '@/lib/access';

async function requireAdmin(): Promise<{ email: string; role: Role }> {
  const session = await auth();
  const email = session?.user?.email;
  const role = (session?.user as any)?.role as Role | undefined;
  if (!email || (role !== 'admin' && role !== 'super_admin')) {
    throw new Error('Forbidden');
  }
  return { email, role };
}

async function requireSuperAdmin(): Promise<{ email: string }> {
  const session = await auth();
  const email = session?.user?.email;
  const role = (session?.user as any)?.role as Role | undefined;
  if (!email || role !== 'super_admin') {
    throw new Error('Forbidden: requer super_admin');
  }
  return { email };
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@v2globalteam\.com$/.test(email);
}

function isValidPageKey(key: string): boolean {
  return ALL_PAGES.some((p) => p.key === key);
}

export async function createUser(email: string, name: string | null): Promise<void> {
  await requireAdmin();
  const normalized = email.trim().toLowerCase();
  if (!isValidEmail(normalized)) {
    throw new Error('E-mail inválido. Deve terminar em @v2globalteam.com');
  }
  await pool.query(
    `INSERT INTO public.app_users (email, name, role)
     VALUES ($1, $2, 'user')
     ON CONFLICT (email) DO NOTHING`,
    [normalized, name?.trim() || null]
  );
  revalidatePath('/users');
}

export async function deleteUser(email: string): Promise<void> {
  await requireSuperAdmin();
  if (SUPER_ADMIN_EMAILS.includes(email)) {
    throw new Error('Não é possível remover um super_admin pré-definido.');
  }
  await pool.query('DELETE FROM public.app_users WHERE email = $1', [email]);
  revalidatePath('/users');
}

export async function updateUserRole(email: string, role: Role): Promise<void> {
  await requireSuperAdmin();
  if (role !== 'admin' && role !== 'user' && role !== 'super_admin') {
    throw new Error('Role inválido');
  }
  if (SUPER_ADMIN_EMAILS.includes(email) && role !== 'super_admin') {
    throw new Error('Super admins pré-definidos não podem ser rebaixados.');
  }
  await pool.query(
    `UPDATE public.app_users SET role = $2, updated_at = now() WHERE email = $1`,
    [email, role]
  );
  revalidatePath('/users');
}

export async function setUserPageAccess(email: string, pageKeys: string[]): Promise<void> {
  await requireAdmin();

  const unique = Array.from(new Set(pageKeys)).filter(isValidPageKey).filter((k) => k !== 'users');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const check = await client.query('SELECT email FROM public.app_users WHERE email = $1', [email]);
    if (check.rowCount === 0) throw new Error('Usuário não encontrado');

    await client.query('DELETE FROM public.user_page_access WHERE email = $1', [email]);
    if (unique.length > 0) {
      const values: string[] = [];
      const params: any[] = [email];
      unique.forEach((key, i) => {
        params.push(key);
        values.push(`($1, $${i + 2})`);
      });
      await client.query(
        `INSERT INTO public.user_page_access (email, page) VALUES ${values.join(', ')}`,
        params
      );
    }
    await client.query('COMMIT');
  } catch (err: any) {
    await client.query('ROLLBACK');
    throw new Error(err.message);
  } finally {
    client.release();
  }
  revalidatePath('/users');
}

export async function togglePageAccess(
  email: string,
  pageKey: string,
  grant: boolean
): Promise<void> {
  await requireAdmin();
  if (!isValidPageKey(pageKey) || pageKey === 'users') {
    throw new Error('Página inválida');
  }
  if (grant) {
    await pool.query(
      `INSERT INTO public.user_page_access (email, page) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [email, pageKey]
    );
  } else {
    await pool.query(
      `DELETE FROM public.user_page_access WHERE email = $1 AND page = $2`,
      [email, pageKey]
    );
  }
  revalidatePath('/users');
}
