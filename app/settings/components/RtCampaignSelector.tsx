'use client';

import { useState, useTransition } from 'react';
import Select, { MultiValue } from 'react-select';
import { setRtCampaignSelections } from '../actions';
import { RefreshCw } from 'lucide-react';

interface Campaign {
  campaign_id: string;
  campaign_name: string;
  status: string;
  is_selected: boolean;
}

interface Option {
  value: string;
  label: string;
  status: string;
}

export default function RtCampaignSelector({ initialCampaigns }: { initialCampaigns: Campaign[] }) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const allOptions: Option[] = initialCampaigns.map(c => ({
    value: c.campaign_id,
    label: c.campaign_name,
    status: c.status,
  }));

  const [selected, setSelected] = useState<MultiValue<Option>>(
    allOptions.filter(o => initialCampaigns.find(c => c.campaign_id === o.value)?.is_selected)
  );

  const handleChange = (newValue: MultiValue<Option>) => {
    setSelected(newValue);
    setSaved(false);

    startTransition(async () => {
      try {
        await setRtCampaignSelections(newValue.map(o => o.value));
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch {
        // silently fail — user can retry
      }
    });
  };

  const syncCampaigns = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch('/api/accounts/sync', { method: 'GET' });
      const data = await res.json();
      if (data.success) window.location.reload();
      else alert('Erro: ' + data.error);
    } catch {
      alert('Erro de rede.');
    } finally {
      setIsSyncing(false);
    }
  };

  const selectedCount = selected.length;
  const totalCount    = allOptions.length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-end justify-between mb-5">
        <div>
          <h2 className="text-sm font-bold text-gray-800">Campanhas RedTrack</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {selectedCount} de {totalCount} campanha(s) selecionada(s)
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Indicador de salvamento */}
          {(isPending || saved) && (
            <span className={`text-[11px] font-medium transition-opacity ${saved ? 'text-emerald-600' : 'text-gray-400'}`}>
              {saved ? '✓ Salvo' : 'Salvando...'}
            </span>
          )}

          <button
            onClick={syncCampaigns}
            disabled={isSyncing}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-xl text-xs font-semibold text-white transition-all disabled:opacity-50 shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Escaneando...' : 'Escanear campanhas'}
          </button>
        </div>
      </div>

      {/* Multi-select */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
        {totalCount === 0 ? (
          <p className="text-sm text-center text-gray-400 py-6">
            Nenhuma campanha importada. Clique em "Escanear campanhas".
          </p>
        ) : (
          <Select<Option, true>
            isMulti
            options={allOptions}
            value={selected}
            onChange={handleChange}
            placeholder="Pesquise e selecione campanhas..."
            noOptionsMessage={() => 'Nenhuma campanha encontrada'}
            isLoading={isPending}
            closeMenuOnSelect={false}
            hideSelectedOptions={false}
            classNamePrefix="rt-select"
            styles={{
              control: (base, state) => ({
                ...base,
                minHeight: '42px',
                borderRadius: '0.5rem',
                borderColor: state.isFocused ? '#6366f1' : '#e5e7eb',
                boxShadow: state.isFocused ? '0 0 0 1px #6366f1' : 'none',
                backgroundColor: '#f9fafb',
                '&:hover': { borderColor: '#6366f1' },
              }),
              menu: (base) => ({
                ...base,
                borderRadius: '0.5rem',
                boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
                border: '1px solid #e5e7eb',
                zIndex: 50,
              }),
              option: (base, state) => ({
                ...base,
                fontSize: '12px',
                backgroundColor: state.isSelected
                  ? '#eef2ff'
                  : state.isFocused
                  ? '#f5f5f5'
                  : 'white',
                color: state.isSelected ? '#4338ca' : '#374151',
                fontWeight: state.isSelected ? 600 : 400,
              }),
              multiValue: (base) => ({
                ...base,
                backgroundColor: '#eef2ff',
                borderRadius: '0.375rem',
              }),
              multiValueLabel: (base) => ({
                ...base,
                color: '#4338ca',
                fontSize: '11px',
                fontWeight: 600,
              }),
              multiValueRemove: (base) => ({
                ...base,
                color: '#6366f1',
                ':hover': { backgroundColor: '#c7d2fe', color: '#4338ca' },
              }),
              placeholder: (base) => ({
                ...base,
                fontSize: '13px',
                color: '#9ca3af',
              }),
              input: (base) => ({
                ...base,
                fontSize: '13px',
              }),
            }}
          />
        )}

        {selectedCount > 0 && (
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
            <span className="text-[11px] text-gray-400">
              {selectedCount} selecionada(s)
            </span>
            <button
              onClick={() => handleChange([])}
              className="text-[11px] text-rose-500 hover:text-rose-700 font-medium transition-colors"
            >
              Limpar seleção
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
