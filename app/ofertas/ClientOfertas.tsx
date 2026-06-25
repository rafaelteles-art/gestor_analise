'use client';

import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { PlusCircle, Trash2, ChevronDown, ChevronRight, Plus, X, RefreshCw } from 'lucide-react';

interface Oferta {
  id: number;
  nome: string;
  status: 'ATIVO' | 'PAUSADO';
  created_at: string;
}
interface Campaign { campaign_id: string; campaign_name: string; status: string | null; oferta_id: number | null; }
interface Player { player_id: string; player_name: string | null; video_duration: number | null; oferta_id: number | null; }
interface AccountLink { oferta_id: number; account_id: string; account_name: string; bm_name: string | null; }

const STATUS_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  ATIVO:   { bg: 'bg-green-50 dark:bg-green-950/40', text: 'text-green-700 dark:text-green-400', border: 'border-green-200 dark:border-green-800' },
  PAUSADO: { bg: 'bg-amber-50 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-800' },
};

export default function ClientOfertas({
  initialOfertas,
  campaigns: initialCampaigns,
  players: initialPlayers,
  accountLinks: initialAccountLinks,
  accounts,
}: {
  initialOfertas: Oferta[];
  campaigns: Campaign[];
  players: Player[];
  accountLinks: AccountLink[];
  accounts: { account_id: string; account_name: string; bm_name: string | null }[];
}) {
  const router = useRouter();
  const [syncingVideos, setSyncingVideos] = useState(false);
  const [ofertas, setOfertas] = useState<Oferta[]>(initialOfertas);
  const [campaigns, setCampaigns] = useState<Campaign[]>(initialCampaigns);
  const [players, setPlayers] = useState<Player[]>(initialPlayers);
  const [accountLinks, setAccountLinks] = useState<AccountLink[]>(initialAccountLinks);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [picker, setPicker] = useState<{ ofertaId: number; kind: 'campaign' | 'player' | 'account' } | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());
  const [newNome, setNewNome] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [openStatusId, setOpenStatusId] = useState<number | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  const openStatusDropdown = (id: number) => {
    if (openStatusId === id) {
      setOpenStatusId(null);
      setDropdownPos(null);
      return;
    }
    const btn = buttonRefs.current.get(id);
    if (btn) {
      const rect = btn.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpenStatusId(id);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const nome = newNome.trim();
    if (!nome) return;

    setIsCreating(true);
    try {
      const res = await fetch('/api/ofertas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, status: 'ATIVO' }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Erro ao criar');
      setOfertas(prev => {
        const filtered = prev.filter(o => o.id !== data.oferta.id);
        return [...filtered, data.oferta].sort((a, b) => a.nome.localeCompare(b.nome));
      });
      setNewNome('');
    } catch (err: any) {
      alert('Falha ao criar oferta: ' + err.message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Remover esta oferta?')) return;
    const prev = ofertas;
    setDeletingId(id);
    setOfertas(list => list.filter(o => o.id !== id));
    try {
      const res = await fetch(`/api/ofertas?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Erro ao remover');
    } catch (err: any) {
      setOfertas(prev);
      alert('Falha ao remover oferta: ' + err.message);
    } finally {
      setDeletingId(null);
    }
  };

  const handleStatusChange = async (id: number, status: 'ATIVO' | 'PAUSADO') => {
    const prev = ofertas;
    setOfertas(list => list.map(o => o.id === id ? { ...o, status } : o));
    setOpenStatusId(null);
    try {
      const res = await fetch('/api/ofertas', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Erro ao atualizar');
    } catch (err: any) {
      setOfertas(prev);
      alert('Falha ao atualizar status: ' + err.message);
    }
  };

  const syncVideos = async () => {
    setSyncingVideos(true);
    try {
      const res = await fetch('/api/vturb/sync-players', { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Erro');
      alert(`${data.count} vídeo(s) sincronizado(s) do vTurb.`);
      router.refresh();
    } catch (err: any) {
      alert('Falha ao sincronizar vídeos: ' + err.message);
    } finally {
      setSyncingVideos(false);
    }
  };

  const ofertaName = (id: number | null) => ofertas.find(o => o.id === id)?.nome ?? null;

  // Aplica um vínculo (sem confirmação — a confirmação de "mover" é feita em lote no picker).
  const commitLink = async (
    kind: 'campaign' | 'player',
    id: string,
    ofertaId: number | null,
  ) => {
    if (kind === 'campaign') {
      setCampaigns(list => list.map(c => c.campaign_id === id ? { ...c, oferta_id: ofertaId } : c));
    } else {
      setPlayers(list => list.map(p => p.player_id === id ? { ...p, oferta_id: ofertaId } : p));
    }
    try {
      const res = await fetch('/api/ofertas/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id, oferta_id: ofertaId }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Erro');
    } catch (err: any) {
      alert('Falha ao vincular: ' + err.message);
      window.location.reload();
    }
  };

  // Vínculo de conta Meta — aditivo (N:N), sem confirmação de "mover".
  const commitAccountLink = async (accountId: string, ofertaId: number, linked: boolean) => {
    // optimistic
    setAccountLinks(list => {
      if (linked) {
        if (list.some(l => l.account_id === accountId && l.oferta_id === ofertaId)) return list;
        const acc = accounts.find(a => a.account_id === accountId);
        return [...list, { oferta_id: ofertaId, account_id: accountId, account_name: acc?.account_name ?? accountId, bm_name: acc?.bm_name ?? null }];
      }
      return list.filter(l => !(l.account_id === accountId && l.oferta_id === ofertaId));
    });
    try {
      const res = await fetch('/api/ofertas/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'account', id: accountId, oferta_id: ofertaId, linked }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Erro');
    } catch (err: any) {
      alert('Falha ao vincular conta: ' + err.message);
      window.location.reload();
    }
  };

  const openPicker = (ofertaId: number, kind: 'campaign' | 'player' | 'account') => {
    setPickerSearch('');
    setPickerSelected(new Set());
    setPicker({ ofertaId, kind });
  };

  const togglePickerSel = (id: string) =>
    setPickerSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // Vincula todos os itens selecionados à oferta do picker (movendo os que já estão em outra).
  const applyPicker = async () => {
    if (!picker) return;
    const ids = [...pickerSelected];
    if (ids.length === 0) { setPicker(null); return; }
    // Contas Meta: aditivo (N:N), sem confirmação de "mover".
    if (picker.kind === 'account') {
      for (const id of ids) await commitAccountLink(id, picker.ofertaId, true);
      setPicker(null);
      return;
    }
    const oidOf = (id: string) => picker.kind === 'campaign'
      ? campaigns.find(c => c.campaign_id === id)?.oferta_id ?? null
      : players.find(p => p.player_id === id)?.oferta_id ?? null;
    const moving = ids.filter(id => { const o = oidOf(id); return o !== null && o !== picker.ofertaId; });
    if (moving.length > 0) {
      const ok = confirm(
        `${moving.length} item(ns) já estão em outra oferta e serão movidos para "${ofertaName(picker.ofertaId)}". Continuar?`,
      );
      if (!ok) return;
    }
    for (const id of ids) await commitLink(picker.kind, id, picker.ofertaId);
    setPicker(null);
  };

  const ativas = ofertas.filter(o => o.status === 'ATIVO').length;
  const pausadas = ofertas.filter(o => o.status === 'PAUSADO').length;

  return (
    <div className="max-w-4xl flex flex-col gap-6">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-console-surface rounded border border-console-border p-5">
          <p className="text-[10px] text-console-muted font-bold uppercase tracking-widest mb-2">TOTAL</p>
          <p className="text-2xl font-bold text-foreground">{ofertas.length}</p>
        </div>
        <div className="bg-console-surface rounded border border-console-border p-5">
          <p className="text-[10px] text-console-muted font-bold uppercase tracking-widest mb-2">ATIVAS</p>
          <p className="text-2xl font-bold text-green-600">{ativas}</p>
        </div>
        <div className="bg-console-surface rounded border border-console-border p-5">
          <p className="text-[10px] text-console-muted font-bold uppercase tracking-widest mb-2">PAUSADAS</p>
          <p className="text-2xl font-bold text-amber-500">{pausadas}</p>
        </div>
      </div>

      {/* Create Form */}
      <div className="bg-console-surface rounded border border-console-border p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-foreground">Adicionar Nova Oferta</h3>
          <button
            onClick={syncVideos}
            disabled={syncingVideos}
            className="inline-flex items-center gap-2 px-3 py-2 rounded border border-console-border text-sm font-medium text-console-muted hover:bg-console-surface-2 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${syncingVideos ? 'animate-spin' : ''}`} />
            {syncingVideos ? 'Sincronizando…' : 'Sincronizar vídeos vTurb'}
          </button>
        </div>
        <form onSubmit={handleCreate} className="flex gap-3">
          <input
            type="text"
            value={newNome}
            onChange={e => setNewNome(e.target.value)}
            placeholder="Nome da oferta"
            className="flex-1 px-4 py-2 border border-console-border rounded text-sm bg-background text-foreground placeholder:text-console-muted focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
            disabled={isCreating}
          />
          <button
            type="submit"
            disabled={isCreating || !newNome.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-medium text-white transition-colors"
          >
            <PlusCircle className="w-4 h-4" />
            Adicionar
          </button>
        </form>
      </div>

      {/* Ofertas Table */}
      <div className="bg-console-surface rounded border border-console-border overflow-hidden">
        <div className="px-5 py-4 border-b border-console-border">
          <h3 className="text-sm font-bold text-foreground">Ofertas Cadastradas</h3>
        </div>

        {ofertas.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-console-muted italic">
            Nenhuma oferta cadastrada ainda.
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="bg-console-surface-2 text-console-muted text-[10px] uppercase tracking-wider">
                <th className="px-5 py-3 font-bold">Nome</th>
                <th className="px-5 py-3 font-bold">Status</th>
                <th className="px-5 py-3 font-bold w-20 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-console-border">
              {ofertas.map(oferta => {
                const s = STATUS_STYLE[oferta.status] ?? STATUS_STYLE.ATIVO;
                const myCampaigns = campaigns.filter(c => c.oferta_id === oferta.id);
                const myPlayers = players.filter(p => p.oferta_id === oferta.id);
                const myAccounts = accountLinks.filter(a => a.oferta_id === oferta.id);
                const expanded = expandedId === oferta.id;
                return (
                  <React.Fragment key={oferta.id}>
                  <tr className="border-l-2 border-transparent hover:border-amber-500 hover:bg-console-surface-2 transition-colors">
                    <td className="px-5 py-3 text-sm font-medium text-foreground">
                      <button
                        onClick={() => setExpandedId(expanded ? null : oferta.id)}
                        className="inline-flex items-center gap-2 hover:text-amber-400"
                      >
                        {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        {oferta.nome}
                        <span className="text-[10px] text-console-muted font-normal">
                          {myCampaigns.length}c · {myPlayers.length}v · {myAccounts.length}a
                        </span>
                      </button>
                    </td>
                    <td className="px-5 py-3">
                      <button
                        ref={el => { if (el) buttonRefs.current.set(oferta.id, el); else buttonRefs.current.delete(oferta.id); }}
                        onClick={() => openStatusDropdown(oferta.id)}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border whitespace-nowrap transition-opacity hover:opacity-80 ${s.bg} ${s.text} ${s.border}`}
                      >
                        {oferta.status}
                        <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
                      </button>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => handleDelete(oferta.id)}
                        disabled={deletingId === oferta.id}
                        className="inline-flex items-center justify-center w-8 h-8 rounded text-console-muted hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                        title="Remover oferta"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={3} className="px-5 py-4 bg-console-surface-2/60">
                        <div className="grid grid-cols-3 gap-4">
                          <LinkGroup
                            title="Campanhas RedTrack"
                            items={myCampaigns.map(c => ({ id: c.campaign_id, label: c.campaign_name }))}
                            onAdd={() => openPicker(oferta.id, 'campaign')}
                            onRemove={(id) => commitLink('campaign', id, null)}
                          />
                          <LinkGroup
                            title="Vídeos vTurb"
                            items={myPlayers.map(p => ({ id: p.player_id, label: p.player_name ?? p.player_id }))}
                            onAdd={() => openPicker(oferta.id, 'player')}
                            onRemove={(id) => commitLink('player', id, null)}
                          />
                          <LinkGroup
                            title="Contas Meta"
                            items={myAccounts.map(a => ({ id: a.account_id, label: `${a.account_name}${a.bm_name ? ' · ' + a.bm_name : ''}` }))}
                            onAdd={() => openPicker(oferta.id, 'account')}
                            onRemove={(id) => commitAccountLink(id, oferta.id, false)}
                          />
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Floating status dropdown (portal — escapes overflow:hidden clipping) */}
      {openStatusId !== null && dropdownPos && typeof window !== 'undefined' && createPortal(
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => { setOpenStatusId(null); setDropdownPos(null); }}
          />
          <div
            className="fixed z-50 bg-console-surface border border-console-border rounded shadow-xl py-1 min-w-[120px]"
            style={{ top: dropdownPos.top, left: dropdownPos.left }}
          >
            {(['ATIVO', 'PAUSADO'] as const).map(st => {
              const ss = STATUS_STYLE[st];
              const current = ofertas.find(o => o.id === openStatusId)?.status;
              const active = current === st;
              return (
                <button
                  key={st}
                  onClick={() => {
                    handleStatusChange(openStatusId, st);
                    setDropdownPos(null);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-console-surface-2 transition-colors ${active ? 'font-semibold' : ''}`}
                >
                  <span className={`w-3.5 text-amber-400 shrink-0 ${active ? '' : 'invisible'}`}>✓</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${ss.bg} ${ss.text}`}>{st}</span>
                </button>
              );
            })}
          </div>
        </>,
        document.body
      )}

      {picker && typeof window !== 'undefined' && createPortal(
        <>
          <div className="fixed inset-0 z-40 bg-black/20" />
          <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-console-surface border border-console-border rounded shadow-xl w-[560px] max-w-[90vw] max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-console-border">
              <h4 className="text-sm font-bold text-foreground">
                {picker.kind === 'campaign' ? 'Vincular campanhas' : picker.kind === 'player' ? 'Vincular vídeos' : 'Vincular contas'}
              </h4>
              <button onClick={() => setPicker(null)} className="text-console-muted hover:text-foreground" title="Fechar">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-3 pt-3">
              <input
                type="text"
                autoFocus
                value={pickerSearch}
                onChange={e => setPickerSearch(e.target.value)}
                placeholder="Pesquisar…"
                className="w-full px-3 py-2 border border-console-border rounded text-xs bg-background text-foreground placeholder:text-console-muted focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
              />
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {(picker.kind === 'campaign'
                ? campaigns.map(c => ({ id: c.campaign_id, label: c.campaign_name, oferta_id: c.oferta_id }))
                : picker.kind === 'player'
                ? players.map(p => ({ id: p.player_id, label: p.player_name ?? p.player_id, oferta_id: p.oferta_id }))
                : accounts.map(a => ({ id: a.account_id, label: `${a.account_name}${a.bm_name ? ' · ' + a.bm_name : ''}`, oferta_id: null as number | null }))
              )
                .filter(item => (item.label ?? '').toLowerCase().includes(pickerSearch.trim().toLowerCase()))
                .map(item => {
                  // Contas (N:N): "aqui" = já vinculada A ESTA oferta. Demais (single): oferta_id === ofertaId.
                  const here = picker.kind === 'account'
                    ? accountLinks.some(l => l.account_id === item.id && l.oferta_id === picker.ofertaId)
                    : item.oferta_id === picker.ofertaId;
                  const checked = here || pickerSelected.has(item.id);
                  return (
                    <label
                      key={item.id}
                      className={`w-full px-3 py-2 rounded text-xs flex items-center gap-2 text-foreground ${here ? 'opacity-60' : 'hover:bg-console-surface-2 cursor-pointer'}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={here}
                        onChange={() => togglePickerSel(item.id)}
                        className="shrink-0 accent-amber-500"
                      />
                      <span className="flex-1 text-foreground break-words leading-snug" title={item.label}>{item.label}</span>
                      {/* Badge âmbar "em <oferta>" só para campaign/player (single-ownership). Contas são N:N. */}
                      {picker.kind !== 'account' && item.oferta_id != null && !here && (
                        <span className="ml-1 shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                          em {ofertaName(item.oferta_id)}
                        </span>
                      )}
                      {here && (
                        <span className="ml-1 shrink-0 text-[10px] text-green-600">✓ aqui</span>
                      )}
                    </label>
                  );
                })}
            </div>
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-console-border">
              <button onClick={() => setPicker(null)} className="px-3 py-1.5 text-xs text-console-muted hover:text-foreground">
                Cancelar
              </button>
              <button
                onClick={applyPicker}
                disabled={pickerSelected.size === 0}
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs font-medium text-white"
              >
                Vincular{pickerSelected.size > 0 ? ` (${pickerSelected.size})` : ''}
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

function LinkGroup({
  title, items, onAdd, onRemove,
}: {
  title: string;
  items: { id: string; label: string }[];
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] text-console-muted font-bold uppercase tracking-widest">{title}</p>
        <button onClick={onAdd} className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300">
          <Plus className="w-3 h-3" /> Adicionar
        </button>
      </div>
      {items.length === 0
        ? <p className="text-xs text-console-muted italic">Nenhum vinculado.</p>
        : items.map(it => (
            <div key={it.id} className="flex items-center justify-between text-xs text-foreground py-0.5 group">
              <span className="truncate" title={it.label}>{it.label}</span>
              <button onClick={() => onRemove(it.id)} className="opacity-0 group-hover:opacity-100 text-console-muted hover:text-red-600" title="Remover">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
    </div>
  );
}
