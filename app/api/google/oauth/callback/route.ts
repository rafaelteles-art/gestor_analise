import { NextRequest, NextResponse } from 'next/server';
import { setGoogleDriveOAuth, invalidateAccessTokenCache } from '@/lib/google-drive';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/google/oauth/callback
 * Handles the OAuth callback from Google:
 *   1. Exchanges the authorization code for tokens.
 *   2. Fetches the user email from Google's userinfo endpoint.
 *   3. Stores { refresh_token, email, connected_at } in app_settings.
 *   4. Redirects back to the API config settings page.
 */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(`${origin}/api-config?google_error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/api-config?google_error=missing_code`);
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
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
      return NextResponse.redirect(
        `${origin}/api-config?google_error=${encodeURIComponent('Falha ao trocar código: ' + text)}`
      );
    }

    const tokenJson = await tokenRes.json();
    refreshToken = tokenJson.refresh_token;

    if (!refreshToken) {
      return NextResponse.redirect(
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
      connected_at: new Date().toISOString(),
    });

    // Bust the in-memory access-token cache so next request refreshes
    invalidateAccessTokenCache();
  } catch (err: any) {
    console.error('Google OAuth callback error:', err);
    return NextResponse.redirect(
      `${origin}/api-config?google_error=${encodeURIComponent(err?.message ?? 'Erro desconhecido')}`
    );
  }

  return NextResponse.redirect(`${origin}/api-config?google_connected=1`);
}
