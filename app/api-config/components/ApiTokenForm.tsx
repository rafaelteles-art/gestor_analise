'use client';

import { useState, useEffect } from 'react';
import { getStoredTokens, saveApiTokens } from '../actions';
import { Key, Save, CheckCircle2, Plus, Trash2 } from 'lucide-react';

export default function ApiTokenForm() {
  const [profiles, setProfiles] = useState<{name: string, token: string}[]>([{name: '', token: ''}]);
  const [redtrackKey, setRedtrackKey] = useState('');
  const [vturbToken, setVturbToken] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getStoredTokens().then((data) => {
      if (data.metaProfiles && data.metaProfiles.length > 0) {
        setProfiles(data.metaProfiles);
      }
      setRedtrackKey(data.redtrackKey);
      setVturbToken(data.vturbToken || '');
    });
  }, []);

  const addProfile = () => setProfiles([...profiles, {name: '', token: ''}]);
  const removeProfile = (idx: number) => setProfiles(profiles.filter((_, i) => i !== idx));

  const updateProfile = (idx: number, field: 'name' | 'token', value: string) => {
    const newProfiles = [...profiles];
    newProfiles[idx][field] = value;
    setProfiles(newProfiles);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaved(false);

    try {
      const validProfiles = profiles.filter(p => p.token.trim() !== '');
      const res = await saveApiTokens(validProfiles, redtrackKey.trim(), vturbToken.trim());
      if (res.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        alert("Erro ao salvar: " + res.error);
      }
    } catch (err: any) {
      console.error(err);
      alert("Erro na requisição: " + err.message);
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
        
        {/* Sessão Meta Profiles */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <label className="block text-sm font-bold text-gray-700">Meta Ads (Múltiplos Perfis)</label>
            <button 
              type="button" 
              onClick={addProfile}
              className="flex items-center gap-1.5 text-xs text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-md font-medium transition-colors"
            >
              <Plus className="w-3.5 h-3.5"/> Adicionar Perfil
            </button>
          </div>

          <div className="space-y-4">
            {profiles.map((profile, idx) => (
              <div key={idx} className="flex gap-3 items-start bg-gray-50 p-4 border border-gray-100 rounded-lg">
                <div className="flex-1 space-y-3">
                  <input
                    type="text"
                    required
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-800 outline-none focus:border-indigo-500 transition-all font-medium placeholder:font-normal placeholder:text-gray-400"
                    placeholder="Nome do Perfil (ex: Perfil Contingência 1)"
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
                {profiles.length > 1 && (
                  <button 
                    type="button" 
                    onClick={() => removeProfile(idx)}
                    className="p-2 text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors mt-1"
                  >
                    <Trash2 className="w-4 h-4"/>
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-3">Você pode cadastrar tokens de vários perfis/Business Managers para sincronizar todas as contas de anúncio de uma vez.</p>
        </div>

        <hr className="border-gray-100" />

        {/* Sessão RedTrack */}
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

        {/* Sessão vturb */}
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
            {isSaving ? (
              <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            ) : (
              <Save className="w-4 h-4" />
            )}
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
