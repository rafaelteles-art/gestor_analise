'use client';

import { useState, useEffect } from 'react';
import { getStoredTokens, saveApiTokens } from '../actions';
import { handleStaleServerAction } from '@/lib/stale-action';
import { Key, Save, CheckCircle2, Plus, Trash2, ShieldCheck, AlertTriangle, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

// Mantemos as constantes alinhadas com lib/meta-token-inspect.ts.
// (Repetidas aqui pra evitar import server-only dentro do client.)
const REQUIRED_SCOPES_PUBLISH = [
  'ads_management',
  'pages_show_list',
  'pages_read_engagement',
  'business_management',
] as const;

const OPTIONAL_SCOPES = [
  'pages_manage_ads',
  'instagram_basic',
  'instagram_content_publish',
  'ads_read',
] as const;

interface Inspection {
  valid: boolean;
  error?: string;
  user?: { id: string; name: string };
  granted: string[];
  declined: string[];
  missingRequired: string[];
  missingOptional: string[];
  canPublish: boolean;
  businessesCount?: number;
  neverExpires?: boolean;
}

type ProfileState = {
  name: string;
  token: string;
  inspection?: Inspection;
  inspecting?: boolean;
};

async function inspectToken(token: string): Promise<Inspection> {
  const res = await fetch('/api/meta/inspect-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  return res.json();
}

export default function ApiTokenForm() {
  const [profiles, setProfiles] = useState<ProfileState[]>([{ name: '', token: '' }]);
  const [redtrackKey, setRedtrackKey] = useState('');
  const [vturbToken, setVturbToken] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    getStoredTokens()
      .then(async (data) => {
        if (data.metaProfiles && data.metaProfiles.length > 0) {
          setProfiles(data.metaProfiles.map((p) => ({ name: p.name, token: p.token })));
          // Inspeciona todos os tokens já salvos (em paralelo)
          const inspected = await Promise.all(
            data.metaProfiles.map(async (p) => ({
              name: p.name,
              token: p.token,
              inspection: await inspectToken(p.token).catch(() => undefined),
            }))
          );
          setProfiles(inspected);
        }
        setRedtrackKey(data.redtrackKey);
        setVturbToken(data.vturbToken || '');
      })
      .catch((err) => {
        if (handleStaleServerAction(err)) return;
        console.error(err);
      });
  }, []);

  const addProfile = () => setProfiles([...profiles, { name: '', token: '' }]);
  const removeProfile = (idx: number) => setProfiles(profiles.filter((_, i) => i !== idx));

  const updateProfile = (idx: number, field: 'name' | 'token', value: string) => {
    setProfiles((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: value, inspection: undefined } : p)));
  };

  const validateOne = async (idx: number) => {
    const p = profiles[idx];
    if (!p.token.trim()) return;
    setProfiles((prev) => prev.map((x, i) => (i === idx ? { ...x, inspecting: true } : x)));
    const inspection = await inspectToken(p.token).catch((e) => ({
      valid: false,
      error: e?.message ?? String(e),
      granted: [],
      declined: [],
      missingRequired: [...REQUIRED_SCOPES_PUBLISH],
      missingOptional: [...OPTIONAL_SCOPES],
      canPublish: false,
    } as Inspection));
    setProfiles((prev) => prev.map((x, i) => (i === idx ? { ...x, inspection, inspecting: false } : x)));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaved(false);

    try {
      const validProfiles = profiles
        .filter((p) => p.token.trim() !== '')
        .map((p) => ({ name: p.name, token: p.token }));
      const res = await saveApiTokens(validProfiles, redtrackKey.trim(), vturbToken.trim());
      if (res.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        // Re-valida tudo após salvar
        const inspected = await Promise.all(
          profiles.map(async (p) =>
            p.token.trim()
              ? { ...p, inspection: await inspectToken(p.token).catch(() => undefined) }
              : p
          )
        );
        setProfiles(inspected);
      } else {
        alert('Erro ao salvar: ' + res.error);
      }
    } catch (err: unknown) {
      if (handleStaleServerAction(err)) return;
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      alert('Erro na requisição: ' + msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      <div className="p-6 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <Key className="w-5 h-5 text-indigo-500" />
            Tokens de Integração API
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Configure suas chaves de API globais para sincronização de diversas contas.
          </p>
        </div>
      </div>

      <form onSubmit={handleSave} className="p-6 space-y-8">

        {/* ─────────────────────────── Meta ─────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="block text-sm font-bold text-gray-700">Meta Ads (System User Tokens)</label>
            <button
              type="button"
              onClick={addProfile}
              className="flex items-center gap-1.5 text-xs text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-md font-medium transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Adicionar Perfil
            </button>
          </div>

          {/* Bloco de ajuda colapsável */}
          <div className="mb-4 border border-indigo-100 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setShowHelp((s) => !s)}
              className="w-full flex items-center justify-between px-4 py-2 bg-indigo-50/50 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
            >
              <span className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" />
                Como gerar um System User Token com permissão de publicar
              </span>
              {showHelp ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {showHelp && (
              <div className="px-4 py-3 text-[12px] text-gray-700 leading-relaxed bg-white border-t border-indigo-100 space-y-2">
                <ol className="list-decimal list-inside space-y-1.5">
                  <li>Abra o <a className="text-indigo-600 underline" href="https://business.facebook.com/settings/system-users" target="_blank" rel="noreferrer">Business Settings → System Users</a> do BM dono das contas.</li>
                  <li>Clique <strong>Add</strong> → escolha um nome (ex: <em>v2-media-lab-publisher</em>) → role <strong>Admin</strong>.</li>
                  <li>No System User criado, clique <strong>Add Assets</strong> e atribua: <em>Ad Accounts</em> (Manage), <em>Pages</em> (Create Content + Manage Page) e <em>Pixels</em> (Manage).</li>
                  <li>Clique <strong>Generate New Token</strong>. Selecione o seu App, marque <strong>nunca expira</strong>, e marque as permissões:
                    <div className="bg-gray-50 border border-gray-200 rounded p-2 mt-1 font-mono text-[11px] text-gray-700">
                      ads_management · pages_show_list · pages_read_engagement · business_management · instagram_basic
                    </div>
                  </li>
                  <li>Copie o token gerado e cole no campo abaixo. Use <strong>Validar token</strong> pra conferir as permissões.</li>
                </ol>
                <p className="text-[11px] text-gray-500 pt-2 border-t border-gray-100">
                  Tokens de System User são permanentes — não expiram a cada 60 dias como tokens de usuário comum.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-4">
            {profiles.map((profile, idx) => (
              <div key={idx} className="bg-gray-50 p-4 border border-gray-100 rounded-lg space-y-3">
                <div className="flex gap-3 items-start">
                  <div className="flex-1 space-y-3">
                    <input
                      type="text"
                      required
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-800 outline-none focus:border-indigo-500 transition-all font-medium placeholder:font-normal placeholder:text-gray-400"
                      placeholder="Nome do Perfil (ex: BM Cliente X)"
                      value={profile.name}
                      onChange={(e) => updateProfile(idx, 'name', e.target.value)}
                    />
                    <input
                      type="password"
                      required
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg text-xs text-gray-600 outline-none focus:border-indigo-500 transition-all font-mono placeholder:font-sans placeholder:text-gray-400"
                      placeholder="System User Access Token..."
                      value={profile.token}
                      onChange={(e) => updateProfile(idx, 'token', e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2 items-end">
                    {profiles.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeProfile(idx)}
                        className="p-2 text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                        title="Remover perfil"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => validateOne(idx)}
                      disabled={profile.inspecting || !profile.token.trim()}
                      className="px-3 py-1.5 text-[11px] font-semibold rounded-md border border-gray-200 text-gray-600 hover:bg-white disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {profile.inspecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                      Validar
                    </button>
                  </div>
                </div>

                {/* Resultado da inspeção */}
                {profile.inspection && <InspectionPanel ins={profile.inspection} />}
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-3">
            Você pode cadastrar tokens de vários perfis/Business Managers. O token é validado automaticamente ao salvar.
          </p>
        </div>

        <hr className="border-gray-100" />

        {/* RedTrack */}
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">RedTrack (API Key)</label>
          <input
            type="password"
            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all font-mono placeholder:font-sans placeholder:text-gray-400"
            placeholder="Cole sua API Key do RedTrack..."
            value={redtrackKey}
            onChange={(e) => setRedtrackKey(e.target.value)}
          />
          <p className="text-xs text-gray-400 mt-2">Encontrada no seu painel principal do RedTrack, em Perfil &gt; Integração API.</p>
        </div>

        <hr className="border-gray-100" />

        {/* vturb */}
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">vturb Analytics (API Token)</label>
          <input
            type="password"
            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all font-mono placeholder:font-sans placeholder:text-gray-400"
            placeholder="Cole seu X-Api-Token do vturb..."
            value={vturbToken}
            onChange={(e) => setVturbToken(e.target.value)}
          />
          <p className="text-xs text-gray-400 mt-2">Dashboard vturb &gt; Configurações de API Key. Enviado no header X-Api-Token em cada chamada.</p>
        </div>

        <div className="pt-4 border-t border-gray-100 flex items-center gap-4">
          <button
            type="submit"
            disabled={isSaving}
            className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-medium rounded-lg shadow-sm transition-colors text-sm disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="animate-spin h-4 w-4 text-white" /> : <Save className="w-4 h-4" />}
            Salvar Configurações
          </button>

          {saved && (
            <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
              <CheckCircle2 className="w-4 h-4" /> Salvo com sucesso!
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

function InspectionPanel({ ins }: { ins: Inspection }) {
  if (!ins.valid) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 flex gap-2 items-start">
        <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
        <div className="text-[12px] text-rose-700">
          <p className="font-semibold">Token inválido</p>
          <p className="text-[11px] mt-0.5">{ins.error ?? 'Erro desconhecido.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`border rounded-lg p-3 ${ins.canPublish ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/50'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[12px] text-gray-700">
          <span className="font-semibold">{ins.user?.name ?? 'Usuário desconhecido'}</span>
          {ins.user?.id && <span className="text-gray-400 font-mono ml-1">({ins.user.id})</span>}
          {typeof ins.businessesCount === 'number' && (
            <span className="text-gray-500 ml-2">· {ins.businessesCount} BM(s) acessíveis</span>
          )}
          {ins.neverExpires && (
            <span className="text-emerald-700 ml-2 text-[11px]">· token permanente</span>
          )}
        </div>
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${ins.canPublish ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
          {ins.canPublish ? '✓ pode publicar' : '✗ falta permissão'}
        </span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
        {REQUIRED_SCOPES_PUBLISH.map((s) => {
          const ok = ins.granted.includes(s);
          return (
            <div key={s} className={`text-[11px] font-mono flex items-center gap-1.5 ${ok ? 'text-emerald-700' : 'text-rose-600'}`}>
              {ok ? '✓' : '✗'} {s}
            </div>
          );
        })}
      </div>

      {ins.missingOptional.length > 0 && (
        <p className="mt-2 text-[10px] text-gray-500">
          Opcionais ausentes: <span className="font-mono">{ins.missingOptional.join(', ')}</span>
        </p>
      )}

      {!ins.canPublish && (
        <p className="mt-2 text-[11px] text-amber-800">
          As permissões marcadas com ✗ acima precisam ser concedidas pelo System User na geração do token.
          Heurística baseada em /me/permissions e endpoints auxiliares — se o token foi gerado via Graph API
          Explorer, refaça com as scopes corretas.
        </p>
      )}
    </div>
  );
}
