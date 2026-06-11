// Google Drive download lib — Contract 2 of docs/superpowers/plans/
// 2026-06-11-campaign-builder-features.md. Stub signatures so parallel wave-1
// agents compile; Task A3 replaces the bodies with the real implementation
// (user-OAuth refresh token stored in app_settings, plain-fetch Drive REST).

export class DriveAuthError extends Error {
  constructor(message = 'Google Drive não conectado') {
    super(message);
    this.name = 'DriveAuthError';
  }
}

export async function getDriveFileMeta(
  _fileId: string
): Promise<{ name: string; mimeType: string; size: number }> {
  throw new DriveAuthError('Google Drive não conectado (stub — Task A3 pendente)');
}

export async function downloadDriveFile(_fileId: string): Promise<Buffer> {
  throw new DriveAuthError('Google Drive não conectado (stub — Task A3 pendente)');
}
