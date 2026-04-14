'use client';

import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { PlusCircle, Trash2, ChevronDown } from 'lucide-react';

interface Oferta {
  id: number;
  nome: string;
  status: 'ATIVO' | 'PAUSADO';
  created_at: string;
}

const STATUS_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  ATIVO:   { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  PAUSADO: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
};

export default function ClientOfertas({ initialOfertas }: { initialOfertas: Oferta[] }) {
  const [ofertas, setOfertas] = useState<Oferta[]>(initialOfertas);
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

  const ativas = ofertas.filter(o => o.status === 'ATIVO').length;
  const pausadas = ofertas.filter(o => o.status === 'PAUSADO').length;

  return (
    <div className="max-w-4xl flex flex-col gap-6">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-2">TOTAL</p>
          <p className="text-2xl font-bold text-gray-800">{ofertas.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-2">ATIVAS</p>
          <p className="text-2xl font-bold text-green-600">{ativas}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-2">PAUSADAS</p>
          <p className="text-2xl font-bold text-amber-500">{pausadas}</p>
        </div>
      </div>

      {/* Create Form */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h3 className="text-sm font-bold text-gray-800 mb-3">Adicionar Nova Oferta</h3>
        <form onSubmit={handleCreate} className="flex gap-3">
          <input
            type="text"
            value={newNome}
            onChange={e => setNewNome(e.target.value)}
            placeholder="Nome da oferta"
            className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            disabled={isCreating}
          />
          <button
            type="submit"
            disabled={isCreating || !newNome.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium text-white transition-colors shadow-sm"
          >
            <PlusCircle className="w-4 h-4" />
            Adicionar
          </button>
        </form>
      </div>

      {/* Ofertas Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-bold text-gray-800">Ofertas Cadastradas</h3>
        </div>

        {ofertas.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-gray-400 italic">
            Nenhuma oferta cadastrada ainda.
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-[10px] uppercase tracking-wider">
                <th className="px-5 py-3 font-bold">Nome</th>
                <th className="px-5 py-3 font-bold">Status</th>
                <th className="px-5 py-3 font-bold w-20 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ofertas.map(oferta => {
                const s = STATUS_STYLE[oferta.status] ?? STATUS_STYLE.ATIVO;
                return (
                  <tr key={oferta.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-5 py-3 text-sm font-medium text-gray-800">{oferta.nome}</td>
                    <td className="px-5 py-3">
                      <button
                        ref={el => {
                          if (el) buttonRefs.current.set(oferta.id, el);
                          else buttonRefs.current.delete(oferta.id);
                        }}
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
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                        title="Remover oferta"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
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
            className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-xl py-1 min-w-[120px]"
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
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-gray-50 transition-colors ${active ? 'font-semibold' : ''}`}
                >
                  <span className={`w-3.5 text-indigo-500 shrink-0 ${active ? '' : 'invisible'}`}>✓</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${ss.bg} ${ss.text}`}>{st}</span>
                </button>
              );
            })}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
