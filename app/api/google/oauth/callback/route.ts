import { NextRequest, NextResponse } from 'next/server';
import { setGoogleDriveOAuth, invalidateAccessTokenCache } from '@/lib/google-drive';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Must match the cookie name set in /api/google/oauth/start. */
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
 *
 * IMPORTANT: The redirect_uri sent to Google for the token exchange MUST
 * exactly match the one used at authorization time (in /start/route.ts) and
 * must match the URI registered in GCP (the public host). Using the internal
 * Cloud Run URL here causes a redirect_uri_mismatch error from Google.
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
 * GET /api/google/oauth/callback
 * Handles the OAuth callback from Google:
 *   0. Validates the `state` param against the httpOnly cookie set by /start
 *      (login-CSRF protection — rejects if missing or mismatched).
 *   1. Exchanges the authorization code for tokens.
 *   2. Fetches the user email from Google's userinfo endpoint.
 *   3. Stores { refresh_token, email, connected_at } in app_settings.
 *   4. Redirects back to the API config settings page.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const stateParam = searchParams.get('state');

  // Derive the public base URL once; used for both redirect_uri and redirects.
  const origin = getPublicBaseUrl(req);

  // --- CSRF state validation ---
  // The cookie was set by /api/google/oauth/start; if it's absent or doesn't
  // match the query param the request did NOT originate from our own /start
  // redirect, so we must refuse to process the authorization code.
  const stateCookie = req.cookies.get(STATE_COOKIE)?.value;

  if (!stateCookie || !stateParam || stateParam !== stateCookie) {
    return NextResponse.redirect(
      `${origin}/api-config?google_error=${encodeURIComponent('state_mismatch: invalid OAuth state')}`
    );
  }

  /**
   * Helper: redirect and delete the one-time state cookie so it can't be
   * replayed.  We always clear the cookie regardless of success/failure.
   */
  function redirectAndClearState(url: string): NextResponse {
    const res = NextResponse.redirect(url);
    res.cookies.set(STATE_COOKIE, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 0, // immediately expire
    });
    return res;
  }

  if (error) {
    return redirectAndClearState(`${origin}/api-config?google_error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return redirectAndClearState(`${origin}/api-config?google_error=missing_code`);
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return redirectAndClearState(
      `${origin}/api-config?google_error=${encodeURIComponent('GOOGLE_OAUTH_CLIENT_ID ou GOOGLE_OAUTH_CLIENT_SECRET não configurado')}`
    );
  }

  const redirectUri = `${origin}/api/google/oauth/callback`;

  // Exchange code for tokens
  const tokenBody = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  let refreshToken: string;
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text().catch(() => tokenRes.statusText);
      return redirectAndClearState(
        `${origin}/api-config?google_error=${encodeURIComponent('Falha ao trocar código: ' + text)}`
      );
    }

    const tokenJson = await tokenRes.json();
    refreshToken = tokenJson.refresh_token;

    if (!refreshToken) {
      return redirectAndClearState(
        `${origin}/api-config?google_error=${encodeURIComponent('refresh_token ausente na resposta do Google')}`
      );
    }

    // Fetch user email
    const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });

    let email = '';
    if (userinfoRes.ok) {
      const info = await userinfoRes.json();
      email = info.email ?? '';
    }

    // Persist to app_settings
    await setGoogleDriveOAuth({
      refresh_token: refreshToken,
      email,
      connected_at: new Date().toISOString(), // UTC audit timestamp — intentionally timezone-agnostic
    });

    // Bust the in-memory access-token cache so next request refreshes
    invalidateAccessTokenCache();
  } catch (err: any) {
    console.error('Google OAuth callback error:', err);
    return redirectAndClearState(
      `${origin}/api-config?google_error=${encodeURIComponent(err?.message ?? 'Erro desconhecido')}`
    );
  }

  return redirectAndClearState(`${origin}/api-config?google_connected=1`);
}
