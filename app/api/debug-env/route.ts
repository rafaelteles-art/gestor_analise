export async function GET() {
  let usdBrlResult: unknown = null;
  let usdBrlError: string | null = null;

  try {
    const res = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL', {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    usdBrlResult = {
      status: res.status,
      bid: data?.USDBRL?.bid ?? null,
      raw: data,
    };
  } catch (e) {
    usdBrlError = String(e);
  }

  return Response.json({ usdBrlResult, usdBrlError });
}
