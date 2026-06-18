// Client-side Google Picker helper for choosing a Google Sheet.
//
// Mirrors the Drive Picker wiring in ClientCampaignBuilder (lazy-loaded gapi +
// GIS token client, browser-side drive.readonly consent) but filtered to Google
// Sheets. Used by the catalog video importer. Globals are typed minimally to
// avoid a deps add. Browser-only — call from client components.

declare const gapi: any;
declare const google: any;

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';
const GOOGLE_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? '';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

export const isPickerConfigured = !!(GOOGLE_CLIENT_ID && GOOGLE_API_KEY);

function loadScriptOnce(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') return reject(new Error('no document'));
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === '1') return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error(`failed to load ${src}`)));
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.defer = true;
    s.dataset.loaded = '0';
    s.addEventListener('load', () => { s.dataset.loaded = '1'; resolve(); });
    s.addEventListener('error', () => reject(new Error(`failed to load ${src}`)));
    document.head.appendChild(s);
  });
}

let pickerApiLoaded = false;
async function ensurePickerLoaded(): Promise<void> {
  await loadScriptOnce('https://apis.google.com/js/api.js');
  await loadScriptOnce('https://accounts.google.com/gsi/client');
  if (!pickerApiLoaded) {
    await new Promise<void>((resolve, reject) => {
      try {
        gapi.load('picker', { callback: () => { pickerApiLoaded = true; resolve(); } });
      } catch (e) {
        reject(e);
      }
    });
  }
}

/**
 * Opens the Google Picker filtered to Google Sheets and resolves with the chosen
 * spreadsheet's id + name, or null if the user cancels. Throws on config/auth errors.
 */
export async function openSheetPicker(): Promise<{ file_id: string; filename: string } | null> {
  if (!isPickerConfigured) {
    throw new Error('Google Picker não configurado (NEXT_PUBLIC_GOOGLE_CLIENT_ID / NEXT_PUBLIC_GOOGLE_API_KEY ausentes).');
  }
  await ensurePickerLoaded();

  const accessToken: string = await new Promise((resolve, reject) => {
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: (resp: any) => {
        if (resp?.error) return reject(new Error(resp.error));
        resolve(resp.access_token);
      },
    });
    tokenClient.requestAccessToken({ prompt: '' });
  });

  return new Promise((resolve, reject) => {
    try {
      const sheetsView = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS);
      sheetsView.setIncludeFolders(true);
      sheetsView.setMimeTypes('application/vnd.google-apps.spreadsheet');

      const picker = new google.picker.PickerBuilder()
        .setOAuthToken(accessToken)
        .setDeveloperKey(GOOGLE_API_KEY)
        .addView(sheetsView)
        .setCallback((data: any) => {
          const action = data[google.picker.Response.ACTION];
          if (action === google.picker.Action.PICKED) {
            const doc = data[google.picker.Response.DOCUMENTS]?.[0];
            if (!doc) return resolve(null);
            resolve({
              file_id: doc[google.picker.Document.ID],
              filename: doc[google.picker.Document.NAME] ?? 'planilha',
            });
          } else if (action === google.picker.Action.CANCEL) {
            resolve(null);
          }
        })
        .build();
      picker.setVisible(true);
    } catch (e) {
      reject(e);
    }
  });
}
