export async function GET() {
  const authSecret = process.env.AUTH_SECRET ?? "";
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";

  return Response.json({
    authSecretLength: authSecret.length,
    authSecretEndsWithNewline: authSecret.endsWith("\n"),
    authSecretLastCharCode: authSecret.charCodeAt(authSecret.length - 1),
    googleClientSecretLength: googleClientSecret.length,
    googleClientSecretEndsWithNewline: googleClientSecret.endsWith("\n"),
    hasGoogleClientId: !!process.env.GOOGLE_CLIENT_ID,
    authUrl: process.env.AUTH_URL ?? null,
  });
}
