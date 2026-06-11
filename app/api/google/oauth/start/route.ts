import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Cookie name that holds the CSRF state token during the OAuth flow. */
const STATE_COOKIE = 'google_oauth_state';

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

  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/google/oauth/callback`;

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/drive.readonly');
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
