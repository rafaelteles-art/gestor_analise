import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Cookie name that holds the CSRF state token during the OAuth flow. */
const STATE_COOKIE = 'google_oauth_state';

/**
 * Returns the public-facing base URL (no trailing slash).
 *
 * Priority order:
 *  1. NEXT_PUBLIC_APP_URL env var — set this in production to the canonical
 *     public URL (e.g. https://v2-media-lab--v2-media-lab.us-central1.hosted.app).
 *  2. x-forwarded-proto + x-forwarded-host — Firebase App Hosting / Cloud Run
 *     load-balancer headers; reliable when NEXT_PUBLIC_APP_URL is absent.
 *  3. req.nextUrl.origin — accurate in local dev; may return the internal
 *     Cloud Run host in production (see daily-sync/route.ts:18 for the same
 *     warning), so it is intentionally the last resort.
 */
function getPublicBaseUrl(req: NextRequest): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  }
  const proto = req.headers.get('x-forwarded-proto');
  const host = req.headers.get('x-forwarded-host');
  if (proto && host) {
    return `${proto}://${host}`;
  }
  return req.nextUrl.origin;
}

/**
 * GET /api/google/oauth/start
 * Redirects the user to Google's OAuth consent screen.
 * Generates a random `state` token, stores it in a short-lived httpOnly
 * cookie, and includes it in the consent URL so the callback can verify
 * the request originated from this server (login-CSRF protection).
 */
export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: 'GOOGLE_OAUTH_CLIENT_ID não configurado' },
      { status: 500 }
    );
  }

  // Generate a cryptographically random state token (16 bytes = 32 hex chars).
  const state = randomBytes(16).toString('hex');

  const baseUrl = getPublicBaseUrl(req);
  const redirectUri = `${baseUrl}/api/google/oauth/callback`;

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  // 'drive.readonly' grants access to the user's Drive files.
  // 'openid email' (or 'userinfo.email') is required so the callback's call to
  // https://www.googleapis.com/oauth2/v2/userinfo succeeds — drive.readonly alone
  // does NOT grant access to userinfo, causing the email lookup to get 403
  // insufficient_scope and the stored email to always be blank.
  authUrl.searchParams.set(
    'scope',
    'https://www.googleapis.com/auth/drive.readonly openid email'
  );
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', state);

  // Store state in an httpOnly, SameSite=Lax cookie (10 min TTL).
  // The callback reads this cookie and rejects any request whose `state`
  // query-param doesn't match — preventing login-CSRF / account-linking attacks.
  const response = NextResponse.redirect(authUrl.toString());
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600, // 10 minutes — plenty of time for the consent screen
  });

  return response;
}
