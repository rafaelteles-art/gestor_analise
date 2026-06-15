// Task A3 — Google Drive integration UI panel.
'use client';

import { useState, useEffect } from 'react';
import { HardDrive, CheckCircle2, AlertTriangle, Loader2, LogOut, ExternalLink } from 'lucide-react';

interface DriveStatus {
  connected: boolean;
  email?: string;
}

export default function GoogleDrivePanel() {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchStatus() {
    try {
      const res = await fetch('/api/google/drive/status');
      if (res.ok) {
        setStatus(await res.json());
      } else {
        setStatus({ connected: false });
      }
    } catch {
      setStatus({ connected: false });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Check URL params for OAuth result
    const params = new URLSearchParams(window.location.search);
    const googleConnected = params.get('google_connected');
    const googleError = params.get('google_error');

    if (googleError) {
      setError(decodeURIComponent(googleError));
      // Clean up URL without reload
      const url = new URL(window.location.href);
      url.searchParams.delete('google_error');
      window.history.replaceState({}, '', url.toString());
    }
    if (googleConnected) {
      const url = new URL(window.location.href);
      url.searchParams.delete('google_connected');
      window.history.replaceState({}, '', url.toString());
    }

    fetchStatus();
  }, []);

  async function handleDisconnect() {
    setDisconnecting(true);
    setError(null);
    try {
      const res = await fetch('/api/google/drive/status', { method: 'DELETE' });
      if (res.ok) {
        setStatus({ connected: false });
      } else {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? 'Erro ao desconectar');
      }
    } catch (err: any) {
      setError(err?.message ?? 'Erro ao desconectar');
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm dark:bg-gray-900 dark:border-gray-700">
      <div className="p-6 border-b border-gray-100 bg-gray-50 flex items-center justify-between dark:bg-gray-800 dark:border-gray-800">
        <div>
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2 dark:text-gray-100">
            <HardDrive className="w-5 h-5 text-blue-500" />
            Google Drive
          </h2>
          <p className="text-sm text-gray-500 mt-1 dark:text-gray-400">
            Conecte sua conta Google para usar arquivos do Drive como criativos de campanha.
          </p>
        </div>
      </div>

      <div className="p-6">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Verificando conexão...
          </div>
        ) : status?.connected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-400">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">Conectado</span>
                {status.email && (
                  <span className="text-xs text-emerald-600 ml-2 dark:text-emerald-500">
                    {status.email}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md border border-emerald-300 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition-colors dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-900/40"
              >
                {disconnecting
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <LogOut className="w-3.5 h-3.5" />}
                Desconectar
              </button>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-400">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="text-xs">{error}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <a
                href="/api/google/oauth/start"
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium rounded-lg shadow-sm transition-colors text-sm"
              >
                <ExternalLink className="w-4 h-4" />
                Conectar Google Drive
              </a>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                Acesso somente leitura ao seu Drive
              </span>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-400">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <span className="font-semibold">Erro na conexão: </span>
                  {error}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
