'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

// ────────────────────────────────────────────────────────────────────────────
// Tipos (alinhados com app/lib/meta-campaigns.ts — repetidos aqui pra evitar
// import server-only no client)
// ────────────────────────────────────────────────────────────────────────────

interface Account {
  account_id: string;
  account_name: string;
  bm_name: string;
  moeda: string | null;
  timezone: string | null;
  account_status: string | null;
  profile_name: string | null;
}

interface Pixel { id: string; name: string; last_fired_time?: string }
interface Page { id: string; name: string; instagram_business_account?: { id: string } }
interface Audience {
  id: string; name: string; subtype: string;
  approximate_count_lower_bound?: number;
  approximate_count_upper_bound?: number;
}
interface Catalog { id: string; name: string; product_count?: number; vertical?: string }
interface ProductSet { id: string; name: string; product_count?: number }

interface CampaignPreset {
  id: number;
  name: string;
  config: PresetConfig;
  created_at?: string;
  updated_at?: string;
}

interface PresetConfig {
  campaignType: 'CBO' | 'ABO';
  useCatalog: boolean;
  catalogLevel: 'ad' | 'campaign';
  catalogConfigMode: 'new' | 'existing';
  specialCategory: 'NONE' | 'EMPLOYMENT' | 'HOUSING' | 'CREDIT' | 'FINANCIAL_PRODUCTS_SERVICES';
  bidStrategy: 'LOWEST_COST_WITHOUT_CAP' | 'LOWEST_COST_WITH_BID_CAP' | 'COST_CAP' | 'LOWEST_COST_WITH_MIN_ROAS';
  bidCap: number | '';
  costCap: number | '';
  minRoas: number | '';
  publishPaused: boolean;
  campaignsPerCreative: number;
  adsetsPerCampaign: number;
  adsPerAdset: number;
  customEvent: 'PURCHASE' | 'LEAD' | 'COMPLETE_REGISTRATION' | 'ADD_TO_CART' | 'INITIATE_CHECKOUT' | 'ADD_PAYMENT_INFO' | 'CONTENT_VIEW' | 'SUBSCRIBE' | 'START_TRIAL' | 'OTHER';
  optGoal: 'OFFSITE_CONVERSIONS' | 'LANDING_PAGE_VIEWS' | 'LINK_CLICKS' | 'IMPRESSIONS' | 'REACH' | 'VALUE';
  dailyBudget: number;
  budgetKind: 'daily' | 'lifetime';
  aboShare: boolean;
  clickWindow: 1 | 7;
  viewWindow: 0 | 1 | 7;
  engagedViewWindow: 0 | 1 | 7;
  country: string;
  ageMin: number;
  ageMax: number;
  gender: 'all' | 'male' | 'female';
  locales: number[];
  advantageAudience: boolean;
  advantagePositioning: boolean;
  platforms: { facebook: boolean; instagram: boolean; audience_network: boolean; messenger: boolean };
  devices: { mobile: boolean; desktop: boolean };
  wifiOnly: boolean;
  urlTagsTpl: string;
  adNameTpl: string;
  autoRetryPage: boolean;
  adv: { all: boolean; site_extensions: boolean; relevant_comments: boolean; cta_optimization: boolean };
  multiAdvertiser: boolean;
}

type CTA =
  | 'SHOP_NOW' | 'LEARN_MORE' | 'SIGN_UP' | 'SUBSCRIBE'
  | 'DOWNLOAD' | 'GET_OFFER' | 'CONTACT_US' | 'APPLY_NOW'
  | 'BUY_NOW' | 'GET_QUOTE' | 'ORDER_NOW';

type CustomEvent =
  | 'PURCHASE' | 'LEAD' | 'COMPLETE_REGISTRATION'
  | 'ADD_TO_CART' | 'INITIATE_CHECKOUT' | 'ADD_PAYMENT_INFO'
  | 'CONTENT_VIEW' | 'SUBSCRIBE' | 'START_TRIAL' | 'OTHER';

type OptGoal =
  | 'OFFSITE_CONVERSIONS' | 'LANDING_PAGE_VIEWS'
  | 'LINK_CLICKS' | 'IMPRESSIONS' | 'REACH' | 'VALUE';

type CampaignType = 'CBO' | 'ABO';

type BidStrategyUI =
  | 'LOWEST_COST_WITHOUT_CAP'      // Maior volume
  | 'LOWEST_COST_WITH_BID_CAP'     // Bid cap
  | 'COST_CAP'                     // Meta de custo
  | 'LOWEST_COST_WITH_MIN_ROAS';   // Meta de ROAS

type UploadResult =
  | { kind: 'image'; hash: string; preview: string }
  | { kind: 'video'; video_id: string; thumbnail_url: string; preview: string };

interface ChildCard {
  id: string;
  link: string;
  headline: string;
  description: string;
  image_hash: string;
  image_preview?: string;
  cta_link: string;
}

interface AdDraft {
  id: string;
  name: string;
  type: 'single' | 'carousel';
  // single — pode ser imagem OU vídeo
  link: string;
  message: string;
  headline: string;
  description: string;
  /** Imagem única: hash do adimages. */
  image_hash: string;
  /** Vídeo único: video_id do advideos. */
  video_id: string;
  /** Miniatura auto-gerada do vídeo (image_url). */
  video_thumbnail_url: string;
  /** 'image' (default) ou 'video' — define qual branch o creative usa. */
  media_kind: 'image' | 'video';
  /** Preview local (object URL) — funciona tanto pra imagem quanto vídeo. */
  image_preview?: string;
  cta_type: CTA;
  cta_link: string;
  display_link: string;
  // carousel (sempre imagem por enquanto)
  child_attachments: ChildCard[];
}

// ────────────────────────────────────────────────────────────────────────────
// Constantes
// ────────────────────────────────────────────────────────────────────────────

const COUNTRIES = [
  { key: 'BR', label: 'Brasil' },
  { key: 'PT', label: 'Portugal' },
  { key: 'US', label: 'Estados Unidos' },
  { key: 'AR', label: 'Argentina' },
  { key: 'MX', label: 'México' },
  { key: 'CO', label: 'Colômbia' },
  { key: 'CL', label: 'Chile' },
  { key: 'ES', label: 'Espanha' },
];

const CTA_OPTIONS: CTA[] = [
  'SHOP_NOW', 'LEARN_MORE', 'SIGN_UP', 'SUBSCRIBE',
  'DOWNLOAD', 'GET_OFFER', 'CONTACT_US', 'APPLY_NOW',
  'BUY_NOW', 'GET_QUOTE', 'ORDER_NOW',
];

const CUSTOM_EVENTS: { value: CustomEvent; label: string }[] = [
  { value: 'PURCHASE',              label: 'Compra (Purchase)' },
  { value: 'LEAD',                  label: 'Lead' },
  { value: 'COMPLETE_REGISTRATION', label: 'Cadastro completo' },
  { value: 'ADD_TO_CART',           label: 'Adicionar ao carrinho' },
  { value: 'INITIATE_CHECKOUT',     label: 'Iniciar checkout' },
  { value: 'ADD_PAYMENT_INFO',      label: 'Adicionar pagamento' },
  { value: 'SUBSCRIBE',             label: 'Assinatura' },
  { value: 'START_TRIAL',           label: 'Iniciar trial' },
  { value: 'CONTENT_VIEW',          label: 'Visualizar conteúdo' },
];

const OPT_GOALS: { value: OptGoal; label: string; help: string }[] = [
  { value: 'OFFSITE_CONVERSIONS', label: 'Conversões (recomendado)', help: 'Otimiza para o evento do pixel selecionado.' },
  { value: 'LANDING_PAGE_VIEWS',  label: 'Visitas à landing page',   help: 'Quando o pixel ainda não tem volume suficiente.' },
  { value: 'LINK_CLICKS',         label: 'Cliques em links',          help: 'Maior alcance, conversões menos refinadas.' },
  { value: 'VALUE',               label: 'Valor (ROAS)',              help: 'Requer evento de Purchase com value.' },
];

// Locale IDs da Meta (subset comum). Lista oficial é gigantesca; expandimos
// conforme necessário em vez de carregar toda na primeira renderização.
const LOCALE_OPTIONS: { id: number; label: string }[] = [
  { id: 6,  label: 'Inglês (Todos)' },
  { id: 46, label: 'Português (Brasil)' },
  { id: 19, label: 'Português (Portugal)' },
  { id: 24, label: 'Espanhol (Espanha)' },
  { id: 23, label: 'Espanhol (América Latina)' },
  { id: 9,  label: 'Francês' },
  { id: 16, label: 'Alemão' },
  { id: 22, label: 'Italiano' },
];

// ────────────────────────────────────────────────────────────────────────────
// UI helpers
// ────────────────────────────────────────────────────────────────────────────

function cls(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(' ');
}

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function emptyAd(): AdDraft {
  return {
    id: makeId(),
    name: 'Criativo 1',
    type: 'single',
    link: '',
    message: '',
    headline: '',
    description: '',
    image_hash: '',
    video_id: '',
    video_thumbnail_url: '',
    media_kind: 'image',
    cta_type: 'SHOP_NOW',
    cta_link: '',
    display_link: '',
    child_attachments: [],
  };
}

function emptyChild(): ChildCard {
  return { id: makeId(), link: '', headline: '', description: '', image_hash: '', cta_link: '' };
}

/** Bloco visual principal — uma das 3 grandes seções (Campanha / Conjuntos / Anúncios). */
function MainSection({
  title, subtitle, badge, children,
}: { title: string; subtitle?: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-gray-800">{title}</h2>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        {badge}
      </header>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}

/** Mini-cabeçalho de bloco interno (IDENTIFICAÇÃO, TIPO DE CAMPANHA, etc.). */
function SubBlock({
  label, hint, badge, children,
}: { label?: string; hint?: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {(label || badge) && (
        <div className="flex items-center justify-between">
          {label && <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{label}</p>}
          {badge}
        </div>
      )}
      {hint && <p className="text-[11px] text-gray-400 -mt-1">{hint}</p>}
      {children}
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold text-gray-600">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-gray-400">{hint}</span>}
    </label>
  );
}

const inputBase = 'text-xs px-3 py-2 rounded-md border border-gray-200 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none disabled:opacity-50';

/** Toggle visual estilo iOS/Tailwind. */
function Toggle({
  checked, onChange, disabled, label, hint,
}: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string; hint?: string }) {
  return (
    <label className={cls('flex items-center gap-3 select-none', disabled && 'opacity-50')}>
      <span
        role="switch"
        aria-checked={checked}
        onClick={() => !disabled && onChange(!checked)}
        className={cls(
          'relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer',
          checked ? 'bg-indigo-600' : 'bg-gray-300',
          disabled && 'cursor-not-allowed'
        )}
      >
        <span className={cls(
          'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5'
        )} />
      </span>
      {(label || hint) && (
        <span className="flex flex-col">
          {label && <span className="text-[11px] font-semibold text-gray-700">{label}</span>}
          {hint && <span className="text-[10px] text-gray-400">{hint}</span>}
        </span>
      )}
    </label>
  );
}

/** Card seletor (radio em formato de cartão) — usado pra Tipo de Campanha / Estratégia de Lance. */
function OptionCard<T extends string>({
  value, selected, onClick, title, desc, badge, disabled,
}: {
  value: T;
  selected: boolean;
  onClick: (v: T) => void;
  title: string;
  desc?: string;
  badge?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onClick(value)}
      disabled={disabled}
      className={cls(
        'flex flex-col items-start gap-1 p-3 rounded-lg border text-left transition-all',
        selected
          ? 'border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-500'
          : 'border-gray-200 bg-white hover:border-gray-300',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <div className="flex items-center gap-2 w-full">
        <span className={cls(
          'inline-block w-3 h-3 rounded-full border-2',
          selected ? 'border-indigo-600 bg-indigo-600' : 'border-gray-300'
        )} />
        <span className="text-[12px] font-semibold text-gray-800">{title}</span>
        {badge && <span className="ml-auto">{badge}</span>}
      </div>
      {desc && <p className="text-[10px] text-gray-500 leading-tight">{desc}</p>}
    </button>
  );
}

function EmBreve() {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-200">
      Em breve
    </span>
  );
}

function AudiencePicker({
  options,
  selectedIds,
  onChange,
  emptyText = 'Nenhum público selecionado',
}: {
  options: { id: string; name: string; subtype?: string }[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  emptyText?: string;
}) {
  const byId = new Map(options.map(o => [o.id, o]));
  const available = options.filter(o => !selectedIds.includes(o.id));

  const add = (id: string) => {
    if (!id || selectedIds.includes(id)) return;
    onChange([...selectedIds, id]);
  };
  const remove = (id: string) => onChange(selectedIds.filter(x => x !== id));

  return (
    <div className="flex flex-col gap-1.5">
      <div className="min-h-[60px] border border-gray-200 rounded-md bg-white px-2 py-1.5 flex flex-wrap gap-1.5 content-start">
        {selectedIds.length === 0 && (
          <span className="text-[11px] text-gray-400 italic px-1 py-1">{emptyText}</span>
        )}
        {selectedIds.map(id => {
          const a = byId.get(id);
          if (!a) {
            return (
              <span key={id} className="inline-flex items-center gap-1 bg-gray-100 text-gray-500 border border-gray-200 rounded-full px-2 py-0.5 text-[11px]">
                <span className="truncate max-w-[220px]" title={id}>id: {id}</span>
                <button type="button" onClick={() => remove(id)}
                  className="text-gray-400 hover:text-rose-500 leading-none text-sm font-bold"
                  aria-label="Remover">×</button>
              </span>
            );
          }
          const label = a.subtype ? `[${a.subtype}] ${a.name}` : a.name;
          return (
            <span key={id}
              className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-2 py-0.5 text-[11px] font-medium">
              <span className="truncate max-w-[220px]" title={label}>{label}</span>
              <button type="button" onClick={() => remove(id)}
                className="text-indigo-400 hover:text-rose-500 leading-none text-sm font-bold"
                aria-label="Remover">×</button>
            </span>
          );
        })}
      </div>
      <select
        className={inputBase}
        value=""
        onChange={e => { add(e.target.value); e.currentTarget.value = ''; }}
        disabled={available.length === 0}
      >
        <option value="">{available.length === 0 ? '— todos já adicionados —' : '+ adicionar público...'}</option>
        {available.map(a => (
          <option key={a.id} value={a.id}>{a.subtype ? `[${a.subtype}] ` : ''}{a.name}</option>
        ))}
      </select>
    </div>
  );
}

/** Similar ao AudiencePicker mas com chips removíveis pra qualquer lista plana. */
function ChipPicker<T extends string | number>({
  options, selected, onChange, emptyText, addText, loading, noOptionsText,
}: {
  options: { value: T; label: string }[];
  selected: T[];
  onChange: (v: T[]) => void;
  emptyText: string;
  addText: string;
  loading?: boolean;
  noOptionsText?: string;
}) {
  const byVal = new Map(options.map(o => [o.value, o]));
  const available = options.filter(o => !selected.includes(o.value));
  // Estado da listagem: distinguir "sem opções" de "todas adicionadas" pra
  // mensagem de erro não confundir o usuário.
  const dropdownLabel = loading
    ? '— carregando… —'
    : options.length === 0
      ? (noOptionsText ?? '— nenhuma opção disponível —')
      : available.length === 0
        ? '— todos adicionados —'
        : addText;

  const add = (v: T) => { if (!selected.includes(v)) onChange([...selected, v]); };
  const remove = (v: T) => onChange(selected.filter(x => x !== v));

  return (
    <div className="flex flex-col gap-1.5">
      <div className="min-h-[40px] border border-gray-200 rounded-md bg-white px-2 py-1.5 flex flex-wrap gap-1.5 content-start">
        {selected.length === 0 && <span className="text-[11px] text-gray-400 italic px-1 py-1">{emptyText}</span>}
        {selected.map(v => {
          const o = byVal.get(v);
          return (
            <span key={String(v)}
              className="inline-flex items-center gap-1 bg-rose-50 text-rose-700 border border-rose-200 rounded-full px-2 py-0.5 text-[11px] font-medium">
              <span>{o?.label ?? String(v)}</span>
              <button type="button" onClick={() => remove(v)}
                className="text-rose-400 hover:text-rose-600 leading-none text-sm font-bold">×</button>
            </span>
          );
        })}
      </div>
      <select className={inputBase} value="" onChange={e => {
        const raw = e.target.value; if (!raw) return;
        const opt = options.find(o => String(o.value) === raw);
        if (opt) add(opt.value);
        e.currentTarget.value = '';
      }} disabled={available.length === 0 || loading}>
        <option value="">{dropdownLabel}</option>
        {available.map(o => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Stream NDJSON reader
// ────────────────────────────────────────────────────────────────────────────

async function readNdjson(res: Response, onLine: (l: any) => void) {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n');
    buf = parts.pop() ?? '';
    for (const p of parts) if (p.trim()) try { onLine(JSON.parse(p)); } catch {}
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Painel de criação de Lookalike (modal-inline)
// ────────────────────────────────────────────────────────────────────────────

function LookalikeBuilder({
  accountId,
  profileName,
  customAudiences,
  onCreated,
}: {
  accountId: string;
  profileName: string;
  customAudiences: Audience[];
  onCreated: (a: Audience) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [seed, setSeed] = useState('');
  const [ratio, setRatio] = useState(0.01);
  const [country, setCountry] = useState('BR');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleCreate = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/campaigns/audiences/lookalike', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: accountId, profile_name: profileName || undefined, name, origin_audience_id: seed, ratio, country }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? res.statusText);
      onCreated({ id: data.id, name: data.name, subtype: 'LOOKALIKE' });
      setOpen(false);
      setName(''); setSeed(''); setRatio(0.01);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold">
        + Criar lookalike a partir de um público
      </button>
    );
  }

  return (
    <div className="border border-indigo-100 bg-indigo-50/40 rounded-lg p-3 flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Nome">
          <input className={inputBase} value={name} onChange={e => setName(e.target.value)} placeholder="LAL 1% BR — Compradores 90d" />
        </Field>
        <Field label="Público de origem">
          <select className={inputBase} value={seed} onChange={e => setSeed(e.target.value)}>
            <option value="">— escolha —</option>
            {customAudiences.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Tamanho (% top)" hint="1% = mais semelhante, 20% = mais alcance">
          <input type="number" min={1} max={20} step={1}
            className={inputBase}
            value={Math.round(ratio * 100)}
            onChange={e => setRatio(Math.max(1, Math.min(20, Number(e.target.value))) / 100)}
          />
        </Field>
        <Field label="País">
          <select className={inputBase} value={country} onChange={e => setCountry(e.target.value)}>
            {COUNTRIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </Field>
      </div>
      {err && <p className="text-[11px] text-rose-600">{err}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={() => setOpen(false)} disabled={busy}
          className="px-3 py-1.5 text-xs font-semibold rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50">
          Cancelar
        </button>
        <button type="button" onClick={handleCreate} disabled={busy || !name || !seed}
          className="px-3 py-1.5 text-xs font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
          {busy ? 'Criando…' : 'Criar lookalike'}
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Componente principal
// ────────────────────────────────────────────────────────────────────────────

export default function ClientCampaignBuilder({ accounts, profileNames }: { accounts: Account[]; profileNames: string[] }) {
  const availableProfiles = profileNames;

  const accountsByProfile = useMemo(() => {
    const map = new Map<string, number>();
    accounts.forEach(a => {
      if (!a.profile_name) return;
      map.set(a.profile_name, (map.get(a.profile_name) ?? 0) + 1);
    });
    return map;
  }, [accounts]);

  const [profileName, setProfileName] = useState<string>(availableProfiles[0] ?? '');

  // ── Sync de contas ────────────────────────────────────────────────────────
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string>('');
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleSyncAccounts = async () => {
    setSyncing(true);
    setSyncError(null);
    setSyncMsg('Iniciando…');
    try {
      const res = await fetch('/api/accounts/sync');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      let last: any = null;
      await readNdjson(res, (line) => {
        last = line;
        if (line?.message) setSyncMsg(String(line.message));
      });
      if (last?.type === 'done' && last?.success) {
        setSyncMsg('Concluído — recarregando…');
        window.location.reload();
      } else if (last?.type === 'error') {
        throw new Error(last.error ?? 'erro desconhecido');
      } else {
        throw new Error('resposta inesperada do servidor');
      }
    } catch (e: any) {
      setSyncError(e?.message ?? String(e));
      setSyncing(false);
      setSyncMsg('');
    }
  };

  const accountsForProfile = useMemo(
    () => accounts.filter(a => !profileName || a.profile_name === profileName),
    [accounts, profileName]
  );

  // ── Estado base ───────────────────────────────────────────────────────────
  const [accountId, setAccountId] = useState(accountsForProfile[0]?.account_id ?? '');
  useEffect(() => {
    if (!accountsForProfile.find(a => a.account_id === accountId)) {
      setAccountId(accountsForProfile[0]?.account_id ?? '');
    }
  }, [profileName, accountsForProfile, accountId]);

  const account = accounts.find(a => a.account_id === accountId);

  // Listas dependentes da conta
  const [pixels, setPixels] = useState<Pixel[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [audiences, setAudiences] = useState<{ custom: Audience[]; saved: Audience[] }>({ custom: [], saved: [] });
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [loadingDeps, setLoadingDeps] = useState(false);
  const [depsError, setDepsError] = useState<string | null>(null);

  // Pixels, audiences, catalogs — específicos da conta (mudam quando troca conta).
  useEffect(() => {
    if (!accountId) return;
    const qs = `account_id=${encodeURIComponent(accountId)}${profileName ? `&profile_name=${encodeURIComponent(profileName)}` : ''}`;
    setLoadingDeps(true); setDepsError(null);
    Promise.all([
      fetch(`/api/campaigns/pixels?${qs}`).then(r => r.json()),
      fetch(`/api/campaigns/audiences?${qs}`).then(r => r.json()),
      fetch(`/api/campaigns/catalogs?${qs}`).then(r => r.json()).catch(() => ({ catalogs: [] })),
    ]).then(([p, au, cat]) => {
      if (p.error) setDepsError(p.error);
      setPixels(p.pixels ?? []);
      setAudiences({ custom: au.custom ?? [], saved: au.saved ?? [] });
      setCatalogs(cat.catalogs ?? []);
    }).catch(e => setDepsError(e?.message ?? String(e)))
      .finally(() => setLoadingDeps(false));
  }, [accountId, profileName]);

  // Páginas — escopo é o perfil (todos os BMs acessíveis). Não muda ao trocar
  // de conta dentro do mesmo perfil.
  const [loadingPages, setLoadingPages] = useState(false);
  useEffect(() => {
    if (!profileName) return;
    const qs = `profile_name=${encodeURIComponent(profileName)}`;
    setLoadingPages(true);
    fetch(`/api/campaigns/pages?${qs}`)
      .then(r => r.json())
      .then(pg => setPages(pg.pages ?? []))
      .catch(e => setDepsError(e?.message ?? String(e)))
      .finally(() => setLoadingPages(false));
  }, [profileName]);

  // ── Campanha ──────────────────────────────────────────────────────────────
  const [campaignName, setCampaignName] = useState('Conversão Website — ' + new Date().toISOString().slice(0, 10));
  const [specialCategory, setSpecialCategory] = useState<'NONE' | 'EMPLOYMENT' | 'HOUSING' | 'CREDIT' | 'FINANCIAL_PRODUCTS_SERVICES'>('NONE');
  const [campaignType, setCampaignType] = useState<CampaignType>('ABO');
  const [bidStrategy, setBidStrategy] = useState<BidStrategyUI>('LOWEST_COST_WITHOUT_CAP');
  const [bidCap, setBidCap] = useState<number | ''>('');
  const [costCap, setCostCap] = useState<number | ''>('');
  const [minRoas, setMinRoas] = useState<number | ''>('');
  const [publishPaused, setPublishPaused] = useState(true);

  // DPA (catálogo) — independente de ABO/CBO; quando ligado, a campanha vira PRODUCT_CATALOG_SALES-style
  const [useCatalog, setUseCatalog] = useState(false);
  const [catalogLevel, setCatalogLevel] = useState<'ad' | 'campaign'>('ad');
  const [catalogConfigMode, setCatalogConfigMode] = useState<'new' | 'existing'>('existing');
  const [catalogId, setCatalogId] = useState('');
  const [productSetId, setProductSetId] = useState('');
  const [productSets, setProductSets] = useState<ProductSet[]>([]);
  const [loadingProductSets, setLoadingProductSets] = useState(false);

  useEffect(() => {
    if (!catalogId) { setProductSets([]); return; }
    const qs = `account_id=${encodeURIComponent(accountId)}${profileName ? `&profile_name=${encodeURIComponent(profileName)}` : ''}&catalog_id=${encodeURIComponent(catalogId)}`;
    setLoadingProductSets(true);
    fetch(`/api/campaigns/product_sets?${qs}`)
      .then(r => r.json())
      .then(d => setProductSets(d.product_sets ?? []))
      .catch(() => setProductSets([]))
      .finally(() => setLoadingProductSets(false));
  }, [catalogId, accountId, profileName]);

  // ── Estrutura ─────────────────────────────────────────────────────────────
  const [campaignsPerCreative, setCampaignsPerCreative] = useState(1);
  const [adsetsPerCampaign, setAdsetsPerCampaign] = useState(1);
  const [adsPerAdset, setAdsPerAdset] = useState(1);

  // ── Conjunto ──────────────────────────────────────────────────────────────
  const [pixelId, setPixelId] = useState('');
  const [customEvent, setCustomEvent] = useState<CustomEvent>('PURCHASE');
  const [optGoal, setOptGoal] = useState<OptGoal>('OFFSITE_CONVERSIONS');
  const [dailyBudget, setDailyBudget] = useState(50);
  const [budgetKind, setBudgetKind] = useState<'daily' | 'lifetime'>('daily');
  const [aboShare, setAboShare] = useState(false); // Compartilhar 20% — só faz sentido em ABO (no CBO já é 100% compartilhado)

  const [setName, setSetName] = useState('');

  // Atribuição (janelas de conversão)
  const [clickWindow, setClickWindow] = useState<1 | 7>(1);
  const [viewWindow, setViewWindow] = useState<0 | 1 | 7>(1);
  const [engagedViewWindow, setEngagedViewWindow] = useState<0 | 1 | 7>(1);

  // Segmentação
  const [country, setCountry] = useState('BR');
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(65);
  const [gender, setGender] = useState<'all' | 'male' | 'female'>('all');
  const [includedAudiences, setIncludedAudiences] = useState<string[]>([]);
  const [excludedAudiences, setExcludedAudiences] = useState<string[]>([]);
  const [locales, setLocales] = useState<number[]>([]);
  const [advantageAudience, setAdvantageAudience] = useState(true);

  // Posicionamentos
  const [advantagePositioning, setAdvantagePositioning] = useState(true);
  const [platforms, setPlatforms] = useState<{ facebook: boolean; instagram: boolean; audience_network: boolean; messenger: boolean }>({
    facebook: true, instagram: true, audience_network: true, messenger: false,
  });
  const [devices, setDevices] = useState<{ mobile: boolean; desktop: boolean }>({ mobile: true, desktop: true });
  const [wifiOnly, setWifiOnly] = useState(false);

  // Agendamento
  const [startTime, setStartTime] = useState(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    return d.toISOString().slice(0, 16);
  });
  const [endTime, setEndTime] = useState('');
  const [hasEndTime, setHasEndTime] = useState(false);

  // ── Anúncios ──────────────────────────────────────────────────────────────
  const [pageIds, setPageIds] = useState<string[]>([]);
  const [autoRetryPage, setAutoRetryPage] = useState(true);
  const [adNameTpl, setAdNameTpl] = useState('');

  // ── Configurações avançadas: URL params, Advantage+ Creative, Multi-Advertiser
  const [urlTagsTpl, setUrlTagsTpl] = useState('utm_source=FB&utm_campaign={{campaign.id}}');
  const [adv, setAdv] = useState({
    all: false,             // Master "Todas as Otimizações"
    site_extensions: false,
    relevant_comments: false,
    cta_optimization: false,
  });
  const [multiAdvertiser, setMultiAdvertiser] = useState(false);

  // ── Presets de configuração (sincronizados via Postgres) ────────────────
  // Salva apenas campos genéricos/reusáveis. NÃO salva: conta, pixel, catálogo,
  // audiências, páginas, nome da campanha, datas e criativos — esses ficam
  // intactos ao aplicar.
  const [presets, setPresets] = useState<CampaignPreset[]>([]);
  const [activePresetName, setActivePresetName] = useState('');
  const [presetBusy, setPresetBusy] = useState(false);

  useEffect(() => {
    fetch('/api/campaigns/presets')
      .then(r => r.json())
      .then(d => setPresets(d.presets ?? []))
      .catch(() => setPresets([]));
  }, []);

  const buildCurrentPresetConfig = (): PresetConfig => ({
    campaignType, useCatalog, catalogLevel, catalogConfigMode,
    specialCategory, bidStrategy, bidCap, costCap, minRoas, publishPaused,
    campaignsPerCreative, adsetsPerCampaign, adsPerAdset,
    customEvent, optGoal, dailyBudget, budgetKind, aboShare,
    clickWindow, viewWindow, engagedViewWindow,
    country, ageMin, ageMax, gender, locales, advantageAudience,
    advantagePositioning, platforms, devices, wifiOnly,
    urlTagsTpl, adNameTpl, autoRetryPage, adv, multiAdvertiser,
  });

  const applyPresetConfig = (c: PresetConfig) => {
    setCampaignType(c.campaignType);
    setUseCatalog(c.useCatalog);
    setCatalogLevel(c.catalogLevel);
    setCatalogConfigMode(c.catalogConfigMode);
    setSpecialCategory(c.specialCategory);
    setBidStrategy(c.bidStrategy);
    setBidCap(c.bidCap);
    setCostCap(c.costCap);
    setMinRoas(c.minRoas);
    setPublishPaused(c.publishPaused);
    setCampaignsPerCreative(c.campaignsPerCreative);
    setAdsetsPerCampaign(c.adsetsPerCampaign);
    setAdsPerAdset(c.adsPerAdset);
    setCustomEvent(c.customEvent);
    setOptGoal(c.optGoal);
    setDailyBudget(c.dailyBudget);
    setBudgetKind(c.budgetKind);
    setAboShare(c.aboShare);
    setClickWindow(c.clickWindow);
    setViewWindow(c.viewWindow);
    setEngagedViewWindow(c.engagedViewWindow);
    setCountry(c.country);
    setAgeMin(c.ageMin);
    setAgeMax(c.ageMax);
    setGender(c.gender);
    setLocales(c.locales);
    setAdvantageAudience(c.advantageAudience);
    setAdvantagePositioning(c.advantagePositioning);
    setPlatforms(c.platforms);
    setDevices(c.devices);
    setWifiOnly(c.wifiOnly);
    setUrlTagsTpl(c.urlTagsTpl);
    setAdNameTpl(c.adNameTpl);
    setAutoRetryPage(c.autoRetryPage);
    setAdv(c.adv);
    setMultiAdvertiser(c.multiAdvertiser);
  };

  const handleApplyPreset = (name: string) => {
    setActivePresetName(name);
    if (!name) return;
    const p = presets.find(p => p.name === name);
    if (!p) return;
    try {
      applyPresetConfig(p.config);
    } catch (e) {
      alert('Preset inválido: ' + ((e as any)?.message ?? e));
    }
  };

  const handleSavePreset = async () => {
    const raw = window.prompt('Nome do preset:', activePresetName || '');
    const name = (raw ?? '').trim();
    if (!name) return;
    if (presets.some(p => p.name === name) && !window.confirm(`Já existe um preset "${name}". Substituir?`)) return;
    setPresetBusy(true);
    try {
      const res = await fetch('/api/campaigns/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, config: buildCurrentPresetConfig() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data?.error ?? res.statusText);
      setPresets(prev => {
        const others = prev.filter(p => p.name !== name);
        return [...others, data.preset].sort((a, b) => a.name.localeCompare(b.name));
      });
      setActivePresetName(name);
    } catch (e: any) {
      alert('Erro ao salvar preset: ' + (e?.message ?? e));
    } finally {
      setPresetBusy(false);
    }
  };

  const handleDeletePreset = async () => {
    if (!activePresetName) return;
    if (!window.confirm(`Excluir preset "${activePresetName}"?`)) return;
    setPresetBusy(true);
    try {
      const res = await fetch(`/api/campaigns/presets?name=${encodeURIComponent(activePresetName)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data?.error ?? res.statusText);
      setPresets(prev => prev.filter(p => p.name !== activePresetName));
      setActivePresetName('');
    } catch (e: any) {
      alert('Erro ao excluir preset: ' + (e?.message ?? e));
    } finally {
      setPresetBusy(false);
    }
  };

  useEffect(() => {
    // Sincroniza pageIds com a lista nova: descarta IDs órfãos (de outra conta)
    // e auto-seleciona a primeira página disponível se nada válido restar.
    // Sem o auto-select aqui o dropdown ficava em "todos adicionados" quando o
    // usuário trocava de conta — IDs antigos eram filtrados mas nada substituía.
    setPageIds(prev => {
      const valid = prev.filter(id => pages.find(p => p.id === id));
      if (valid.length === 0 && pages[0]) return [pages[0].id];
      return valid;
    });
  }, [pages]);

  useEffect(() => { if (!pixelId && pixels[0]) setPixelId(pixels[0].id); }, [pixels, pixelId]);

  // Anúncios (criativos drafted)
  const [ads, setAds] = useState<AdDraft[]>([emptyAd()]);
  const updateAd = (id: string, patch: Partial<AdDraft>) =>
    setAds(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));
  const addAd = () => setAds(prev => [...prev, { ...emptyAd(), name: `Criativo ${prev.length + 1}` }]);
  const removeAd = (id: string) => setAds(prev => prev.length === 1 ? prev : prev.filter(a => a.id !== id));

  const uploadFor = async (file: File): Promise<UploadResult | null> => {
    const fd = new FormData();
    fd.append('account_id', accountId);
    if (profileName) fd.append('profile_name', profileName);
    fd.append('file', file);
    const res = await fetch('/api/campaigns/image', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) { alert('Erro no upload: ' + (data?.error ?? res.statusText)); return null; }
    const preview = URL.createObjectURL(file);
    if (data.kind === 'video') {
      if (!data.thumbnail_url) {
        alert('Vídeo enviado, mas miniatura ainda não foi gerada. Aguarde alguns segundos e tente reenviar.');
      }
      return { kind: 'video', video_id: data.video_id, thumbnail_url: data.thumbnail_url ?? '', preview };
    }
    return { kind: 'image', hash: data.hash, preview };
  };

  // ── Publish state ─────────────────────────────────────────────────────────
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<any[]>([]);
  const [doneInfo, setDoneInfo] = useState<{ campaign_ids: string[]; adset_ids: string[]; ad_ids: string[] } | null>(null);
  const [errorInfo, setErrorInfo] = useState<{ step?: string; error?: string } | null>(null);

  // ── Validação ────────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    const camp = ads.length * Math.max(1, campaignsPerCreative);
    const sets = camp * Math.max(1, adsetsPerCampaign);
    const adsTotal = sets * Math.max(1, adsPerAdset);
    return { camp, sets, ads: adsTotal };
  }, [ads.length, campaignsPerCreative, adsetsPerCampaign, adsPerAdset]);

  const isDPA = useCatalog;
  const isCBO = campaignType === 'CBO';

  const errors: string[] = [];
  if (!profileName) errors.push('Selecione um perfil Meta.');
  if (!accountId) errors.push('Selecione uma conta.');
  if (!campaignName.trim()) errors.push('Nome da campanha é obrigatório.');
  if (!pixelId && !isDPA) errors.push('Selecione um pixel.');
  if (isDPA && catalogConfigMode === 'existing' && !catalogId) errors.push('Selecione um catálogo.');
  if (pageIds.length === 0) errors.push('Selecione pelo menos uma Página do Facebook.');
  if (dailyBudget < 1) errors.push('Orçamento inválido.');
  if (!advantageAudience && (ageMin < 13 || ageMax > 65 || ageMin > ageMax)) errors.push('Faixa etária inválida (13–65).');
  if (!advantagePositioning && !Object.values(platforms).some(Boolean)) errors.push('Escolha ao menos uma plataforma.');
  if (!devices.mobile && !devices.desktop) errors.push('Escolha pelo menos um dispositivo (mobile ou desktop).');
  if (ads.length === 0) errors.push('Adicione ao menos um criativo.');
  if (campaignsPerCreative < 1 || adsetsPerCampaign < 1 || adsPerAdset < 1) errors.push('Estrutura precisa ser ≥ 1 em cada campo.');
  if (bidStrategy === 'LOWEST_COST_WITH_BID_CAP' && bidCap === '') errors.push('Bid cap exige um valor.');
  if (bidStrategy === 'COST_CAP' && costCap === '') errors.push('Meta de custo exige um valor.');
  if (bidStrategy === 'LOWEST_COST_WITH_MIN_ROAS' && minRoas === '') errors.push('Meta de ROAS exige um valor.');
  ads.forEach((a, i) => {
    if (!a.name.trim()) errors.push(`Criativo ${i + 1}: nome obrigatório.`);
    if (a.type === 'single' && !isDPA) {
      if (!a.link.trim())       errors.push(`Criativo ${i + 1}: link obrigatório.`);
      if (a.media_kind === 'video') {
        if (!a.video_id)              errors.push(`Criativo ${i + 1}: faça upload do vídeo.`);
        if (a.video_id && !a.video_thumbnail_url) errors.push(`Criativo ${i + 1}: miniatura do vídeo ainda não disponível — aguarde o encoding terminar.`);
      } else {
        if (!a.image_hash)        errors.push(`Criativo ${i + 1}: faça upload da imagem.`);
      }
      if (!a.message.trim())    errors.push(`Criativo ${i + 1}: texto principal obrigatório.`);
    } else if (a.type === 'carousel') {
      if (a.child_attachments.length < 2) errors.push(`Criativo ${i + 1}: carrossel exige 2+ cards.`);
      a.child_attachments.forEach((c, j) => {
        if (!c.link.trim())  errors.push(`Criativo ${i + 1}, card ${j + 1}: link obrigatório.`);
        if (!c.image_hash)   errors.push(`Criativo ${i + 1}, card ${j + 1}: imagem obrigatória.`);
      });
    }
  });

  const canSubmit = errors.length === 0 && !running;

  const moedaSym = useMemo(() => {
    const m = account?.moeda ?? 'BRL';
    if (m === 'BRL') return 'R$';
    if (m === 'USD') return '$';
    if (m === 'EUR') return '€';
    return m + ' ';
  }, [account]);

  const audienceOptions = useMemo(() => {
    return [
      ...audiences.custom.map(a => ({ ...a, group: 'Custom' })),
      ...audiences.saved.map(a => ({ ...a, group: 'Saved' })),
    ];
  }, [audiences]);

  // ── Submit ───────────────────────────────────────────────────────────────
  const submit = async () => {
    setRunning(true);
    setEvents([]);
    setDoneInfo(null);
    setErrorInfo(null);

    const status = publishPaused ? 'PAUSED' : 'ACTIVE';
    const selectedPages = pages.filter(p => pageIds.includes(p.id));

    // Targeting comum (compartilhado entre todos os conjuntos via template)
    const targeting: any = {
      geo_locations: { countries: [country] },
      publisher_platforms: advantagePositioning
        ? ['facebook', 'instagram', 'audience_network', 'messenger']
        : Object.entries(platforms).filter(([, v]) => v).map(([k]) => k),
    };
    if (advantageAudience) {
      // Apenas idade mínima quando Advantage+ tá ligado
      targeting.age_min = ageMin;
      // Sinaliza relaxação total
      targeting.targeting_relaxation_types = { lookalike: 1, custom_audience: 1 };
    } else {
      targeting.age_min = ageMin;
      targeting.age_max = ageMax;
    }
    if (gender !== 'all') targeting.genders = [gender === 'male' ? 1 : 2];
    if (includedAudiences.length) targeting.custom_audiences = includedAudiences.map(id => ({ id }));
    if (excludedAudiences.length) targeting.excluded_custom_audiences = excludedAudiences.map(id => ({ id }));
    if (locales.length) targeting.locales = locales;
    const devList: ('mobile' | 'desktop')[] = [];
    if (devices.mobile) devList.push('mobile');
    if (devices.desktop) devList.push('desktop');
    if (devList.length === 1) targeting.device_platforms = devList; // só envia quando há restrição
    if (wifiOnly) targeting.connection_type = ['WIFI'];

    // Atribuição
    const attribution_spec: any[] = [];
    if (clickWindow > 0) attribution_spec.push({ event_type: 'CLICK_THROUGH', window_days: clickWindow });
    if (viewWindow > 0) attribution_spec.push({ event_type: 'VIEW_THROUGH', window_days: viewWindow });

    // Mapeia bid strategy + valor extra
    const cents = Math.round(dailyBudget * 100);
    const adsetBudgetCents = !isCBO ? cents : undefined;
    const campaignBudgetCents = isCBO ? cents : undefined;

    const promotedObject: any = isDPA
      ? {
          product_set_id: catalogLevel === 'ad' ? (productSetId || undefined) : undefined,
          product_catalog_id: catalogLevel === 'ad' ? catalogId : undefined,
        }
      : { pixel_id: pixelId, custom_event_type: customEvent };
    // Limpa undefined no DPA pra não enviar chave vazia
    Object.keys(promotedObject).forEach(k => promotedObject[k] === undefined && delete promotedObject[k]);

    const adset: any = {
      name: setName.trim() || campaignName + ' — Conjunto',
      optimization_goal: isDPA ? 'OFFSITE_CONVERSIONS' : optGoal,
      billing_event: optGoal === 'LINK_CLICKS' ? 'LINK_CLICKS' : 'IMPRESSIONS',
      bid_strategy: !isCBO ? bidStrategy : undefined,
      [budgetKind === 'daily' ? 'daily_budget_cents' : 'lifetime_budget_cents']: adsetBudgetCents,
      promoted_object: promotedObject,
      targeting,
      destination_type: isDPA ? undefined : 'WEBSITE',
      start_time: new Date(startTime).toISOString(),
      end_time: hasEndTime && endTime ? new Date(endTime).toISOString() : undefined,
      status,
      attribution_spec: attribution_spec.length ? attribution_spec : undefined,
    };
    if (bidStrategy === 'LOWEST_COST_WITH_BID_CAP' && bidCap !== '') {
      adset.bid_amount_cents = Math.round(Number(bidCap) * 100);
    }
    if (bidStrategy === 'COST_CAP' && costCap !== '') {
      adset.bid_amount_cents = Math.round(Number(costCap) * 100);
    }
    // Para Min ROAS, a Meta usa bid_amount como ROAS × 1000000 quando bid_strategy = LOWEST_COST_WITH_MIN_ROAS
    if (bidStrategy === 'LOWEST_COST_WITH_MIN_ROAS' && minRoas !== '') {
      adset.bid_amount_cents = Math.round(Number(minRoas) * 1000000);
    }

    const campaign: any = {
      name: campaignName,
      objective: isDPA ? 'OUTCOME_SALES' : 'OUTCOME_SALES',
      status,
      special_ad_categories: specialCategory === 'NONE' ? [] : [specialCategory],
      buying_type: 'AUCTION',
      is_adset_budget_sharing_enabled: campaignType === 'ABO' && aboShare,
      [budgetKind === 'daily' ? 'daily_budget_cents' : 'lifetime_budget_cents']: campaignBudgetCents,
      bid_strategy: isCBO ? bidStrategy : undefined,
      promoted_object: (isDPA && catalogLevel === 'campaign' && catalogId)
        ? { product_catalog_id: catalogId }
        : undefined,
    };

    // Monta lista de creative_features_spec a partir dos toggles Advantage+ Creative
    const advFeatures: Record<string, 'OPT_IN' | 'OPT_OUT'> = {};
    if (adv.all || adv.site_extensions)   advFeatures.site_extensions = 'OPT_IN';
    if (adv.all || adv.relevant_comments) advFeatures.relevant_comments_displayed = 'OPT_IN';
    if (adv.all || adv.cta_optimization)  advFeatures.cta_optimization = 'OPT_IN';

    // Monta a lista de "criativos drafted" para o orquestrador batch
    const creatives = ads.map((a) => {
      const baseName = (adNameTpl && adNameTpl.trim()) || a.name;
      const firstPageId = selectedPages[0]?.id ?? '';
      const firstIgId = selectedPages[0]?.instagram_business_account?.id;
      const creative: any = isDPA
        ? {
            name: baseName + ' — Creative',
            page_id: firstPageId,
            instagram_actor_id: firstIgId,
            type: 'dpa',
            message: a.message,
            headline: a.headline,
            description: a.description,
            template_link: a.link || '{{product.url}}',
            cta_type: a.cta_type,
            cta_link: a.cta_link || a.link || '{{product.url}}',
            product_set_id: productSetId || undefined,
          }
        : a.type === 'single'
        ? {
            name: baseName + ' — Creative',
            page_id: firstPageId,
            instagram_actor_id: firstIgId,
            type: 'single',
            link: a.link,
            message: a.message,
            headline: a.headline,
            description: a.description,
            ...(a.media_kind === 'video'
              ? { video_id: a.video_id, video_thumbnail_url: a.video_thumbnail_url }
              : { image_hash: a.image_hash }),
            cta_type: a.cta_type,
            cta_link: a.cta_link || a.link,
          }
        : {
            name: baseName + ' — Creative',
            page_id: firstPageId,
            instagram_actor_id: firstIgId,
            type: 'carousel',
            message: a.message,
            multi_share_optimized: true,
            child_attachments: a.child_attachments.map(c => ({
              link: c.link,
              name: c.headline,
              description: c.description,
              image_hash: c.image_hash,
              call_to_action: { type: a.cta_type, value: { link: c.cta_link || c.link } },
            })),
          };
      // Toggles avançados — resolvidos em createAdCreative via creative_features_spec
      if (Object.keys(advFeatures).length) creative.advantage_creative_features = advFeatures;
      if (multiAdvertiser) creative.multi_advertiser = true;
      return { name: baseName, creative };
    });

    const payload = {
      account_id: accountId,
      profile_name: profileName || undefined,
      batch: {
        campaigns_per_creative: campaignsPerCreative,
        adsets_per_campaign: adsetsPerCampaign,
        ads_per_adset: adsPerAdset,
        page_ids: selectedPages.map(p => p.id),
        page_auto_retry: autoRetryPage,
        campaign,
        adset,
        creatives,
        url_tags_template: urlTagsTpl?.trim() || undefined,
        context: {
          conta_nome: account?.account_name,
          conta_id: accountId,
          pixel: pixels.find(p => p.id === pixelId)?.name,
          objetivo: isDPA ? 'DPA' : 'SALES',
          estrutura: `${campaignsPerCreative}x${adsetsPerCampaign}x${adsPerAdset}`,
          pagina: selectedPages.map(p => p.name).join('|'),
          catalogo_nome: catalogs.find(c => c.id === catalogId)?.name,
          conjunto_de_produtos: productSets.find(s => s.id === productSetId)?.name,
          budget: `${dailyBudget}`,
        },
      },
    };

    try {
      const res = await fetch('/api/campaigns/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok && !res.body) {
        const data = await res.json().catch(() => ({}));
        setErrorInfo({ error: data?.error ?? res.statusText });
        return;
      }
      // Coleta os IDs criados ao longo do stream — orquestrador batch retorna múltiplos
      const collected = { campaign_ids: [] as string[], adset_ids: [] as string[], ad_ids: [] as string[] };
      await readNdjson(res, (e) => {
        setEvents(prev => [...prev, e]);
        if (e.type === 'campaign_created') collected.campaign_ids.push(e.id);
        if (e.type === 'adset_created')    collected.adset_ids.push(e.id);
        if (e.type === 'ad_created')       collected.ad_ids.push(e.id);
        if (e.type === 'done') setDoneInfo({ ...collected });
        if (e.type === 'error') setErrorInfo({ step: e.step, error: e.error });
      });
    } catch (e: any) {
      setErrorInfo({ error: e?.message ?? String(e) });
    } finally {
      setRunning(false);
    }
  };

  // ── Render guards ─────────────────────────────────────────────────────────
  if (accounts.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-sm text-amber-800">
        Nenhuma conta Meta selecionada com token válido. Vá em <a href="/settings" className="underline font-semibold">Contas de anúncios</a> para selecionar.
      </div>
    );
  }
  if (availableProfiles.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-sm text-amber-800">
        Nenhum perfil Meta configurado em <a href="/api-config" className="underline font-semibold">Configurações</a>, ou os tokens não batem com as contas selecionadas.
      </div>
    );
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">

      {/* ───────── 0. Perfil ───────── */}
      <MainSection title="Perfil Meta" subtitle="Token usado para ler contas, pixels, páginas, públicos e publicar.">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Perfil">
            <select className={inputBase} value={profileName} onChange={e => setProfileName(e.target.value)}>
              {availableProfiles.map(n => {
                const c = accountsByProfile.get(n) ?? 0;
                return <option key={n} value={n}>{n} — {c} conta{c === 1 ? '' : 's'}</option>;
              })}
            </select>
          </Field>
          <div className="flex items-end justify-between gap-3 text-[11px] text-gray-500">
            <span>{accountsForProfile.length} conta(s) deste perfil disponível(is) abaixo.</span>
            <button type="button" onClick={handleSyncAccounts} disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Sincronizando…' : 'Sincronizar contas'}
            </button>
          </div>
        </div>
        {syncing && syncMsg && <p className="text-[11px] text-gray-400">{syncMsg}</p>}
        {syncError && <p className="text-[11px] text-rose-600">Erro ao sincronizar: {syncError}</p>}
      </MainSection>

      {/* ───────── 1. Configurações da Campanha ───────── */}
      <MainSection
        title="Configurações da Campanha"
        subtitle="Defina o objetivo e as configurações principais"
        badge={<span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">Vendas</span>}
      >
        {/* PRESETS */}
        <SubBlock label="Presets" hint="Salva/aplica configurações genéricas (modo, segmentação, posicionamentos, etc.). Conta, pixel, catálogo, páginas e criativos ficam intactos.">
          <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-end">
            <select
              className={inputBase}
              value={activePresetName}
              onChange={e => handleApplyPreset(e.target.value)}
              disabled={presetBusy}
              title="Aplicar preset salvo"
            >
              <option value="">{presets.length === 0 ? 'Sem presets salvos' : '— selecione um preset —'}</option>
              {presets.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
            <button
              type="button"
              onClick={handleSavePreset}
              disabled={presetBusy}
              title="Salvar configuração atual como preset"
              className="px-3 py-2 text-[11px] font-semibold rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
            >
              Salvar
            </button>
            <button
              type="button"
              onClick={handleDeletePreset}
              disabled={presetBusy || !activePresetName}
              title={activePresetName ? `Excluir preset "${activePresetName}"` : 'Selecione um preset'}
              className="px-3 py-2 text-[11px] font-semibold rounded-lg border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-50"
            >
              Excluir
            </button>
          </div>
        </SubBlock>

        {/* IDENTIFICAÇÃO */}
        <SubBlock label="Identificação">
          <div className="grid grid-cols-1 gap-3">
            <Field label="Conta de Anúncio *">
              <select className={inputBase} value={accountId} onChange={e => setAccountId(e.target.value)} disabled={accountsForProfile.length === 0}>
                {accountsForProfile.length === 0 && <option value="">— nenhuma conta deste perfil —</option>}
                {accountsForProfile.map(a => (
                  <option key={a.account_id} value={a.account_id}>
                    {a.bm_name} — {a.account_name} ({a.account_id}){a.account_status && a.account_status !== 'ACTIVE' ? ` · ${a.account_status}` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Nome da Campanha *" hint={loadingDeps ? 'Carregando pixels/páginas/públicos/catálogos…' : depsError ?? undefined}>
              <input className={inputBase} value={campaignName} onChange={e => setCampaignName(e.target.value)} placeholder="Digite o nome da campanha…" maxLength={400} />
            </Field>
            <Field label="Categoria especial" hint="Habitação, emprego, crédito, etc. Use NONE se não se aplicar.">
              <select className={inputBase} value={specialCategory} onChange={e => setSpecialCategory(e.target.value as any)}>
                <option value="NONE">Nenhuma</option>
                <option value="EMPLOYMENT">Emprego</option>
                <option value="HOUSING">Habitação</option>
                <option value="CREDIT">Crédito</option>
                <option value="FINANCIAL_PRODUCTS_SERVICES">Produtos financeiros</option>
              </select>
            </Field>
          </div>
        </SubBlock>

        {/* TIPO DE CAMPANHA (orçamento) */}
        <SubBlock label="Tipo de Campanha">
          <div className="grid grid-cols-2 gap-3">
            <OptionCard<CampaignType>
              value="CBO" selected={campaignType === 'CBO'} onClick={setCampaignType}
              title="CBO (Orçamento de Campanha)"
              desc="O Facebook otimiza a distribuição do orçamento entre os conjuntos"
            />
            <OptionCard<CampaignType>
              value="ABO" selected={campaignType === 'ABO'} onClick={setCampaignType}
              title="ABO (Orçamento por Conjunto)"
              desc="Você define o orçamento para cada conjunto individualmente"
            />
          </div>
        </SubBlock>

        {/* CATÁLOGO (DPA) — independente de ABO/CBO */}
        <SubBlock label="Catálogo (DPA)" hint="Use catálogo de produtos. Combinável com ABO ou CBO.">
          <div className="rounded-lg border border-rose-200 bg-rose-50/40 px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-[12px] font-semibold text-rose-800">Usar catálogo de produtos</p>
              <p className="text-[11px] text-rose-700">Dynamic Product Ads — funciona com qualquer modo de orçamento ({campaignType}).</p>
            </div>
            <Toggle checked={useCatalog} onChange={setUseCatalog} />
          </div>
        </SubBlock>

        {/* DPA sub-config */}
        {isDPA && (
          <>
            <SubBlock label="Nível do Catálogo">
              <div className="grid grid-cols-2 gap-3">
                <OptionCard
                  value={'ad' as const} selected={catalogLevel === 'ad'} onClick={setCatalogLevel}
                  title="Nível de Anúncio" desc="Catálogo configurado dentro de cada anúncio"
                />
                <OptionCard
                  value={'campaign' as const} selected={catalogLevel === 'campaign'} onClick={setCatalogLevel}
                  title="Nível de Campanha" desc="Catálogo configurado dentro da campanha"
                />
              </div>
            </SubBlock>

            <SubBlock label="Como deseja configurar o catálogo?">
              <div className="grid grid-cols-2 gap-3">
                <OptionCard
                  value={'new' as const} selected={catalogConfigMode === 'new'}
                  onClick={() => {/* em breve */}}
                  title="+ Configurar novo catálogo"
                  desc="Configura um novo catálogo que será criado automaticamente"
                  badge={<EmBreve />} disabled
                />
                <OptionCard
                  value={'existing' as const} selected={catalogConfigMode === 'existing'}
                  onClick={setCatalogConfigMode}
                  title="Usar catálogo existente"
                  desc="Selecione um Business Manager e depois o catálogo"
                  badge={<span className="text-[9px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded font-bold">{catalogs.length} catálogo(s)</span>}
                />
              </div>
              {catalogConfigMode === 'existing' && (
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <Field label="Catálogo">
                    <select className={inputBase} value={catalogId} onChange={e => { setCatalogId(e.target.value); setProductSetId(''); }}>
                      <option value="">— selecione —</option>
                      {catalogs.map(c => (
                        <option key={c.id} value={c.id}>{c.name}{c.product_count !== undefined ? ` (${c.product_count})` : ''}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Conjunto de Produtos (opcional)">
                    <select className={inputBase} value={productSetId} onChange={e => setProductSetId(e.target.value)} disabled={!catalogId || loadingProductSets}>
                      <option value="">{loadingProductSets ? 'Carregando…' : '— todos os produtos —'}</option>
                      {productSets.map(s => (
                        <option key={s.id} value={s.id}>{s.name}{s.product_count !== undefined ? ` (${s.product_count})` : ''}</option>
                      ))}
                    </select>
                  </Field>
                </div>
              )}
              {catalogConfigMode === 'existing' && !catalogId && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mt-2">
                  Escolha um catálogo acima para prosseguir.
                </p>
              )}
            </SubBlock>
          </>
        )}

        {/* ESTRATÉGIA DE LANCE */}
        <SubBlock label="Estratégia de Lance">
          <div className="grid grid-cols-2 gap-3">
            <OptionCard<BidStrategyUI>
              value="LOWEST_COST_WITHOUT_CAP" selected={bidStrategy === 'LOWEST_COST_WITHOUT_CAP'} onClick={setBidStrategy}
              title="Maior Volume" desc="Máximo de resultados"
            />
            <OptionCard<BidStrategyUI>
              value="COST_CAP" selected={bidStrategy === 'COST_CAP'} onClick={setBidStrategy}
              title="Meta de custo"
              desc="Custo por Resultado"
              badge={<span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold">BETA</span>}
            />
            <OptionCard<BidStrategyUI>
              value="LOWEST_COST_WITH_BID_CAP" selected={bidStrategy === 'LOWEST_COST_WITH_BID_CAP'} onClick={setBidStrategy}
              title="Bid Cap"
              desc="Lance máximo por leilão"
              badge={<span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold">BETA</span>}
            />
            <OptionCard<BidStrategyUI>
              value="LOWEST_COST_WITH_MIN_ROAS" selected={bidStrategy === 'LOWEST_COST_WITH_MIN_ROAS'} onClick={setBidStrategy}
              title="Meta de ROAS"
              desc="Retorno em anúncios"
              badge={<span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold">BETA</span>}
            />
          </div>
          <div className="grid grid-cols-3 gap-3 mt-2">
            {bidStrategy === 'LOWEST_COST_WITH_BID_CAP' && (
              <Field label={`Bid Cap (${moedaSym})`}>
                <input type="number" min={0.01} step={0.01} className={inputBase}
                  value={bidCap} onChange={e => setBidCap(e.target.value === '' ? '' : Number(e.target.value))} />
              </Field>
            )}
            {bidStrategy === 'COST_CAP' && (
              <Field label={`Custo-alvo (${moedaSym})`}>
                <input type="number" min={0.01} step={0.01} className={inputBase}
                  value={costCap} onChange={e => setCostCap(e.target.value === '' ? '' : Number(e.target.value))} />
              </Field>
            )}
            {bidStrategy === 'LOWEST_COST_WITH_MIN_ROAS' && (
              <Field label="ROAS mínimo (ex: 1.5)">
                <input type="number" min={0.01} step={0.01} className={inputBase}
                  value={minRoas} onChange={e => setMinRoas(e.target.value === '' ? '' : Number(e.target.value))} />
              </Field>
            )}
          </div>
        </SubBlock>

        {/* PAUSADA */}
        <div className="rounded-lg border border-amber-200 bg-amber-50/40 px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-[12px] font-semibold text-amber-800">Pausada</p>
            <p className="text-[11px] text-amber-700">Suas campanhas serão publicadas pausadas. Você precisará ativá-las manualmente depois.</p>
          </div>
          <Toggle checked={publishPaused} onChange={setPublishPaused} />
        </div>
      </MainSection>

      {/* ───────── 2. Conjuntos ───────── */}
      <MainSection title="Conjuntos" subtitle="Estrutura, orçamento, segmentação e agendamento">

        {/* CONFIGURAÇÃO DA ESTRUTURA */}
        <SubBlock label="Configuração da Estrutura" hint="Defina quantas Campanhas, Conjuntos e Anúncios criar">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Campanhas/Criativo">
              <input type="number" min={1} step={1} className={inputBase}
                value={campaignsPerCreative} onChange={e => setCampaignsPerCreative(Math.max(1, Number(e.target.value) || 1))} />
            </Field>
            <Field label="Conjuntos/Campanha">
              <input type="number" min={1} step={1} className={inputBase}
                value={adsetsPerCampaign} onChange={e => setAdsetsPerCampaign(Math.max(1, Number(e.target.value) || 1))} />
            </Field>
            <Field label="Anúncios/Conjunto">
              <input type="number" min={1} step={1} className={inputBase}
                value={adsPerAdset} onChange={e => setAdsPerAdset(Math.max(1, Number(e.target.value) || 1))} />
            </Field>
          </div>
          <p className="text-[11px] text-gray-500 mt-1">
            = <strong>{totals.camp}</strong> camp · <strong>{totals.sets}</strong> conj · <strong>{totals.ads}</strong> anúncios ({ads.length} criativo{ads.length === 1 ? '' : 's'} drafted)
          </p>
        </SubBlock>

        {/* ORÇAMENTO */}
        <SubBlock label="Orçamento" hint="Defina o orçamento e período da campanha">
          <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-end">
            <Field label={isCBO ? `Orçamento/Campanha (${moedaSym}) *` : `Orçamento/Conjunto (${moedaSym}) *`}>
              <input type="number" min={1} step={1} className={inputBase}
                value={dailyBudget} onChange={e => setDailyBudget(Number(e.target.value))} />
            </Field>
            <select className={inputBase} value={budgetKind} onChange={e => setBudgetKind(e.target.value as any)}>
              <option value="daily">Diário</option>
              <option value="lifetime">Vitalício</option>
            </select>
            <Toggle
              checked={aboShare}
              onChange={v => { setAboShare(v); if (v && campaignType !== 'ABO') setCampaignType('ABO'); }}
              disabled={campaignType !== 'ABO'}
              label="Compartilhar 20% entre conjuntos"
            />
          </div>
        </SubBlock>

        {/* NOME DO CONJUNTO */}
        <SubBlock label="Nome do Conjunto" hint="Se vazio: [nome_criativo]_CJ01, CJ02…">
          <input className={inputBase} value={setName} onChange={e => setSetName(e.target.value)} placeholder="Ex: Conjunto — conta…" />
        </SubBlock>

        {/* PIXEL DE CONVERSÃO */}
        {!isDPA && (
          <SubBlock label="Pixel de Conversão" hint="Rastreamento de Conversão">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pixel">
                <select className={inputBase} value={pixelId} onChange={e => setPixelId(e.target.value)} disabled={pixels.length === 0}>
                  {pixels.length === 0 && <option value="">— sem pixels nessa conta —</option>}
                  {pixels.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.id}){p.last_fired_time ? '' : ' · sem disparos recentes'}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Evento de conversão">
                <select className={inputBase} value={customEvent} onChange={e => setCustomEvent(e.target.value as CustomEvent)}>
                  {CUSTOM_EVENTS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
                </select>
              </Field>
              <Field label="Otimização de Entrega">
                <select className={inputBase} value={optGoal} onChange={e => setOptGoal(e.target.value as OptGoal)}>
                  {OPT_GOALS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
            </div>
          </SubBlock>
        )}

        {/* CONFIGURAÇÕES DE ATRIBUIÇÃO */}
        <SubBlock label="Configurações de Atribuição" hint="Define o período em que conversões são atribuídas aos anúncios.">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Click-through">
              <select className={inputBase} value={clickWindow} onChange={e => setClickWindow(Number(e.target.value) as 1 | 7)}>
                <option value={1}>1 dia</option>
                <option value={7}>7 dias</option>
              </select>
            </Field>
            <Field label="View-through">
              <select className={inputBase} value={viewWindow} onChange={e => setViewWindow(Number(e.target.value) as 0 | 1 | 7)}>
                <option value={0}>Desligado</option>
                <option value={1}>1 dia</option>
                <option value={7}>7 dias</option>
              </select>
            </Field>
            <Field label="Engaged-view">
              <select className={inputBase} value={engagedViewWindow} onChange={e => setEngagedViewWindow(Number(e.target.value) as 0 | 1 | 7)}>
                <option value={0}>Desligado</option>
                <option value={1}>1 dia</option>
                <option value={7}>7 dias</option>
              </select>
            </Field>
          </div>
        </SubBlock>

        {/* PÚBLICO-ALVO */}
        <SubBlock>
          <div className="border border-indigo-100 bg-indigo-50/30 rounded-lg p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-[12px] font-bold text-gray-800">Público-Alvo</h3>
                <p className="text-[11px] text-gray-500">
                  {advantageAudience ? 'Advantage+ ativado: a I.A. do Meta otimizará seu público.' : 'Definição manual de público.'}
                </p>
              </div>
              <Toggle checked={advantageAudience} onChange={setAdvantageAudience} label="Advantage+" />
            </div>

            <Field label="Usar um público salvo">
              <select className={inputBase} value="" onChange={e => {
                const id = e.target.value;
                if (id && !includedAudiences.includes(id)) setIncludedAudiences([...includedAudiences, id]);
                e.currentTarget.value = '';
              }}>
                <option value="">— selecione —</option>
                {audiences.saved.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>

            {/* Controles */}
            <SubBlock label="Controles">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Localizações">
                  <select className={inputBase} value={country} onChange={e => setCountry(e.target.value)}>
                    {COUNTRIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Idade Mínima">
                    <input type="number" min={13} max={65} className={inputBase}
                      value={ageMin} onChange={e => setAgeMin(Number(e.target.value))} />
                  </Field>
                  <Field label="Idade Máxima" hint={advantageAudience ? 'Advantage+ pode expandir' : undefined}>
                    <input type="number" min={13} max={65} className={inputBase}
                      value={ageMax} onChange={e => setAgeMax(Number(e.target.value))} disabled={advantageAudience} />
                  </Field>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <Field label="Idiomas">
                  <ChipPicker
                    options={LOCALE_OPTIONS.map(o => ({ value: o.id, label: o.label }))}
                    selected={locales}
                    onChange={setLocales}
                    emptyText="Todos os idiomas"
                    addText="+ adicionar idioma"
                  />
                </Field>
                <Field label="Excluir Públicos Personalizados">
                  <AudiencePicker
                    options={audiences.custom}
                    selectedIds={excludedAudiences}
                    onChange={setExcludedAudiences}
                  />
                </Field>
              </div>
            </SubBlock>

            {/* Sugestões / Definição */}
            <SubBlock label={advantageAudience ? 'Sugestões de Público' : 'Definição de Público'}>
              <Field label="Incluir Públicos Personalizados">
                <AudiencePicker
                  options={audienceOptions}
                  selectedIds={includedAudiences}
                  onChange={setIncludedAudiences}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <Field label="Gênero">
                  <div className="grid grid-cols-3 gap-1 bg-gray-100 p-1 rounded-md">
                    {(['all', 'male', 'female'] as const).map(g => (
                      <button key={g} type="button" onClick={() => setGender(g)}
                        className={cls(
                          'text-[11px] font-semibold py-1.5 rounded transition-colors',
                          gender === g ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-200'
                        )}>
                        {g === 'all' ? 'Todos' : g === 'male' ? 'Masculino' : 'Feminino'}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Adicionar interesse ou comportamento">
                  <button type="button" disabled
                    className={cls(inputBase, 'flex items-center justify-between cursor-not-allowed')}>
                    <span className="text-gray-400">+ Adicionar interesse</span>
                    <EmBreve />
                  </button>
                </Field>
              </div>
              <div className="mt-2">
                <LookalikeBuilder
                  accountId={accountId}
                  profileName={profileName}
                  customAudiences={audiences.custom}
                  onCreated={(a) => setAudiences(prev => ({ ...prev, custom: [a, ...prev.custom] }))}
                />
              </div>
            </SubBlock>

            <p className="text-[11px] text-gray-500 flex items-center gap-3">
              <span>📍 1 local</span><span>👥 {advantageAudience ? `${ageMin}+` : `${ageMin}–${ageMax}`}</span><span>{gender === 'all' ? '⚥ Todos' : gender === 'male' ? '♂ Masc' : '♀ Fem'}</span><span>🗣 {locales.length || '0'} idioma(s)</span>
            </p>
          </div>
        </SubBlock>

        {/* CONFIGURAÇÕES AVANÇADAS */}
        <SubBlock label="Configurações Avançadas do Conjunto">
          {/* Posicionamentos */}
          <div className="border border-gray-200 rounded-lg p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-[12px] font-bold text-gray-800">Posicionamentos</h4>
                <p className="text-[11px] text-gray-500">Escolha onde seus anúncios serão exibidos</p>
              </div>
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200">
                {advantagePositioning ? 'Automático' : 'Manual'}
              </span>
            </div>

            <div className="rounded-md border border-indigo-100 bg-indigo-50/40 px-3 py-2 flex items-center justify-between">
              <div>
                <p className="text-[12px] font-semibold text-gray-800">✦ Advantage+ Posicionamentos</p>
                <p className="text-[10px] text-gray-500">Meta otimiza automaticamente onde seus anúncios aparecem</p>
              </div>
              <Toggle checked={advantagePositioning} onChange={setAdvantagePositioning} />
            </div>

            {!advantagePositioning && (
              <div>
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Plataformas</p>
                <div className="flex gap-4 flex-wrap">
                  {(['facebook', 'instagram', 'audience_network', 'messenger'] as const).map(p => (
                    <label key={p} className="flex items-center gap-2 text-xs text-gray-700">
                      <input type="checkbox" checked={platforms[p]}
                        onChange={e => setPlatforms(prev => ({ ...prev, [p]: e.target.checked }))} />
                      {p === 'audience_network' ? 'Audience Network' : p[0].toUpperCase() + p.slice(1)}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Dispositivos</p>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-xs text-gray-700">
                  <input type="checkbox" checked={devices.mobile}
                    onChange={e => setDevices(d => ({ ...d, mobile: e.target.checked }))} />
                  📱 Dispositivos Móveis
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-700">
                  <input type="checkbox" checked={devices.desktop}
                    onChange={e => setDevices(d => ({ ...d, desktop: e.target.checked }))} />
                  🖥 Desktop
                </label>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-[12px] font-semibold text-gray-800">Apenas Wi-Fi</p>
                <p className="text-[10px] text-gray-400">Exibir anúncios apenas quando conectado ao Wi-Fi</p>
              </div>
              <Toggle checked={wifiOnly} onChange={setWifiOnly} />
            </div>
          </div>

          {/* Agendamento */}
          <div className="border border-gray-200 rounded-lg p-4 flex flex-col gap-3 mt-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-[12px] font-bold text-gray-800">Agendamento</h4>
                <p className="text-[11px] text-gray-500">Defina quando seus anúncios começarão e terminarão de ser veiculados</p>
              </div>
              <Toggle checked={hasEndTime} onChange={setHasEndTime} label="Data de término" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Início">
                <input type="datetime-local" className={inputBase} value={startTime} onChange={e => setStartTime(e.target.value)} />
              </Field>
              <Field label="Término">
                <input type="datetime-local" className={inputBase}
                  value={endTime} onChange={e => setEndTime(e.target.value)} disabled={!hasEndTime}
                  placeholder="Sem limite" />
              </Field>
            </div>
          </div>
        </SubBlock>
      </MainSection>

      {/* ───────── 3. Anúncios ───────── */}
      <MainSection title="Anúncios" subtitle="Defina textos, links, chamada para ação e páginas de distribuição">
        {/* PÁGINAS E DISTRIBUIÇÃO */}
        <SubBlock label="Páginas e Distribuição">
          <Field label="Páginas do Facebook *" hint="Selecione 1 ou mais páginas. Os anúncios serão distribuídos em round-robin entre elas. Escopo: perfil (todas BMs).">
            <ChipPicker
              options={pages.map(p => ({ value: p.id, label: `${p.name}${p.instagram_business_account ? ' · IG' : ''}` }))}
              selected={pageIds}
              onChange={setPageIds}
              emptyText="Nenhuma página selecionada"
              addText="+ adicionar página"
              loading={loadingPages}
              noOptionsText="— nenhuma página acessível para este perfil —"
            />
          </Field>
          <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-md px-3 py-2 mt-2">
            <div>
              <p className="text-[12px] font-semibold text-gray-800">N anúncios por página</p>
              <p className="text-[10px] text-gray-400">Define quantos anúncios cada página recebe individualmente</p>
            </div>
            <EmBreve />
          </div>
          <div className="flex items-center justify-between mt-2">
            <div>
              <p className="text-[12px] font-semibold text-gray-800">Auto retry de página</p>
              <p className="text-[10px] text-gray-400">Se um anúncio falhar na página selecionada, o sistema tentará automaticamente em outra página disponível.</p>
            </div>
            <Toggle checked={autoRetryPage} onChange={setAutoRetryPage} />
          </div>
        </SubBlock>

        {/* NOME DO ANÚNCIO */}
        <SubBlock label="Nome do Anúncio" hint="Se vazio, usará o nome do criativo">
          <input className={inputBase} value={adNameTpl} onChange={e => setAdNameTpl(e.target.value)} placeholder="Ex: Anúncio — conta…" />
        </SubBlock>

        {/* CRIATIVOS (lista) */}
        <SubBlock label="Criativos" hint="Cada criativo gera N campanhas × M conjuntos × K anúncios conforme a estrutura definida.">
          <div className="flex flex-col gap-3">
            {ads.map((a, i) => (
              <AdEditor
                key={a.id}
                index={i}
                ad={a}
                isDPA={isDPA}
                canRemove={ads.length > 1}
                onChange={(patch) => updateAd(a.id, patch)}
                onRemove={() => removeAd(a.id)}
                uploadFor={uploadFor}
              />
            ))}
            <button type="button" onClick={addAd}
              className="self-start text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold">
              + Adicionar outro criativo
            </button>
          </div>
        </SubBlock>

        {/* CONFIGURAÇÕES AVANÇADAS DO ANÚNCIO */}
        <SubBlock label="Configurações Avançadas">
          {/* RASTREAMENTO — URL params */}
          <div className="border border-gray-200 rounded-lg p-4 flex flex-col gap-3">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Rastreamento</p>
            <Field label="Parâmetros de URL">
              <textarea className={cls(inputBase, 'font-mono min-h-[50px]')} value={urlTagsTpl}
                onChange={e => setUrlTagsTpl(e.target.value)}
                placeholder="utm_source=FB&utm_campaign={{campaign.id}}" />
            </Field>
            <p className="text-[10px] text-gray-500">
              Parâmetros adicionados à URL de destino. Variáveis suportadas (Facebook + DirectAds) são substituídas automaticamente; o restante é enviado como está.
            </p>
          </div>

          {/* ADVANTAGE+ CREATIVE */}
          <div className="border border-gray-200 rounded-lg p-4 flex flex-col gap-3 mt-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-[12px] font-bold text-gray-800">✦ Advantage+ Creative</h4>
                <p className="text-[11px] text-gray-500">Configurações de aprimoramentos automáticos de criativos para seus anúncios</p>
              </div>
            </div>
            <div className="rounded-md border border-indigo-100 bg-indigo-50/40 px-3 py-2 flex items-center justify-between">
              <div>
                <p className="text-[12px] font-semibold text-gray-800">⚙ Todas as Otimizações</p>
                <p className="text-[10px] text-gray-500">Ativa todas as melhorias automáticas de IA</p>
              </div>
              <Toggle checked={adv.all} onChange={v => setAdv(prev => ({ ...prev, all: v }))} />
            </div>

            <details className="border border-gray-100 rounded-md">
              <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold text-gray-700 flex items-center gap-2">
                <span className="text-gray-400">▸</span> Preview Avançado
                <span className="ml-auto text-[10px] text-gray-400">0/6</span>
              </summary>
              <div className="px-3 py-2 text-[10px] text-gray-400">Previews variantes do criativo após otimizações (carregado sob demanda).</div>
            </details>

            <div className="border border-gray-100 rounded-md">
              <div className="px-3 py-2 flex items-center justify-between border-b border-gray-100">
                <p className="text-[11px] font-semibold text-gray-700">✨ Melhorias Essenciais</p>
                <span className="text-[10px] text-gray-400">
                  {[adv.site_extensions, adv.relevant_comments, adv.cta_optimization].filter(Boolean).length}/3
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 px-3 py-2">
                <div className="rounded-md border border-gray-100 px-2 py-1.5 flex items-center justify-between">
                  <span className="text-[11px] text-gray-700">🌐 Extensões do Site</span>
                  <Toggle checked={adv.all || adv.site_extensions} onChange={v => setAdv(prev => ({ ...prev, site_extensions: v }))} />
                </div>
                <div className="rounded-md border border-gray-100 px-2 py-1.5 flex items-center justify-between">
                  <span className="text-[11px] text-gray-700">💬 Comentários Relevantes</span>
                  <Toggle checked={adv.all || adv.relevant_comments} onChange={v => setAdv(prev => ({ ...prev, relevant_comments: v }))} />
                </div>
                <div className="rounded-md border border-gray-100 px-2 py-1.5 flex items-center justify-between col-span-2">
                  <span className="text-[11px] text-gray-700">📝 Melhorar CTA</span>
                  <Toggle checked={adv.all || adv.cta_optimization} onChange={v => setAdv(prev => ({ ...prev, cta_optimization: v }))} />
                </div>
              </div>
            </div>

            <p className="text-[10px] text-gray-500">
              <span className="font-semibold">Recomendação:</span> Mantenha tudo desativado para controle total dos criativos.
            </p>
          </div>

          {/* MULTI-ADVERTISER ADS */}
          <div className="border border-gray-200 rounded-lg p-4 flex items-center justify-between mt-3">
            <div>
              <h4 className="text-[12px] font-bold text-gray-800 flex items-center gap-2">
                Multi-Advertiser Ads
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200">Opcional</span>
              </h4>
              <p className="text-[11px] text-gray-500">Permite que seu anúncio apareça ao lado de anúncios de outras marcas em carrosséis personalizados.</p>
            </div>
            <Toggle checked={multiAdvertiser} onChange={setMultiAdvertiser} />
          </div>
        </SubBlock>
      </MainSection>

      {/* ───────── 4. Publicar ───────── */}
      <MainSection title="Publicar" subtitle={publishPaused ? 'Publica em PAUSED para você revisar no Ads Manager.' : 'Publica ativo — vai entrar em leilão imediatamente.'}>
        {errors.length > 0 && (
          <div className="bg-rose-50 border border-rose-200 rounded-lg p-3">
            <p className="text-xs font-bold text-rose-700 mb-1">Corrija antes de publicar:</p>
            <ul className="text-[11px] text-rose-700 list-disc list-inside space-y-0.5">
              {errors.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}
              {errors.length > 8 && <li>+ {errors.length - 8} outros…</li>}
            </ul>
          </div>
        )}

        <div className="flex gap-2 items-center">
          <button type="button" onClick={submit} disabled={!canSubmit}
            className={cls(
              'px-4 py-2 text-xs font-semibold rounded-lg text-white disabled:opacity-50',
              publishPaused ? 'bg-gray-700 hover:bg-gray-800' : 'bg-emerald-600 hover:bg-emerald-700'
            )}>
            {running
              ? `Publicando ${publishPaused ? 'pausado' : 'ativo'}…`
              : publishPaused
                ? `Publicar (PAUSED) — ${totals.camp} camp · ${totals.ads} ads`
                : `Publicar ATIVO — ${totals.camp} camp · ${totals.ads} ads`}
          </button>
        </div>

        {(events.length > 0 || doneInfo || errorInfo) && (
          <div className="mt-3 border border-gray-100 rounded-lg overflow-hidden">
            <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider px-4 py-2 bg-gray-50 border-b border-gray-100">
              Progresso
            </div>
            <div className="bg-gray-900 text-gray-100 font-mono text-[11px] leading-relaxed px-3 py-2 max-h-64 overflow-y-auto">
              {events.map((e, i) => <EventLine key={i} e={e} />)}
            </div>
          </div>
        )}

        {doneInfo && (
          <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-lg p-4">
            <p className="text-xs font-bold text-emerald-800">✓ Criado com sucesso</p>
            <p className="text-[11px] text-emerald-700 mt-1">
              {doneInfo.campaign_ids.length} campanha(s) · {doneInfo.adset_ids.length} conjunto(s) · {doneInfo.ad_ids.length} anúncio(s)
            </p>
            {doneInfo.campaign_ids[0] && (
              <a
                href={`https://business.facebook.com/adsmanager/manage/campaigns?act=${accountId.replace('act_', '')}&selected_campaign_ids=${doneInfo.campaign_ids.join(',')}`}
                target="_blank" rel="noopener noreferrer"
                className="inline-block mt-2 text-[11px] text-emerald-700 underline font-semibold"
              >
                Abrir no Ads Manager →
              </a>
            )}
          </div>
        )}

        {errorInfo && (
          <div className="mt-3 bg-rose-50 border border-rose-200 rounded-lg p-4">
            <p className="text-xs font-bold text-rose-800">✗ Erro {errorInfo.step ? `em ${errorInfo.step}` : ''}</p>
            <p className="text-[11px] text-rose-700 mt-1">{errorInfo.error}</p>
          </div>
        )}
      </MainSection>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Editor de um criativo
// ────────────────────────────────────────────────────────────────────────────

function AdEditor({
  index, ad, isDPA, canRemove, onChange, onRemove, uploadFor,
}: {
  index: number;
  ad: AdDraft;
  isDPA: boolean;
  canRemove: boolean;
  onChange: (patch: Partial<AdDraft>) => void;
  onRemove: () => void;
  uploadFor: (file: File) => Promise<UploadResult | null>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleSingleUpload = async (file: File) => {
    setUploading(true);
    const r = await uploadFor(file);
    setUploading(false);
    if (!r) return;
    if (r.kind === 'video') {
      onChange({
        media_kind: 'video',
        video_id: r.video_id,
        video_thumbnail_url: r.thumbnail_url,
        image_hash: '',
        image_preview: r.preview,
      });
    } else {
      onChange({
        media_kind: 'image',
        image_hash: r.hash,
        video_id: '',
        video_thumbnail_url: '',
        image_preview: r.preview,
      });
    }
  };

  const updateChild = (cid: string, patch: Partial<ChildCard>) =>
    onChange({ child_attachments: ad.child_attachments.map(c => c.id === cid ? { ...c, ...patch } : c) });

  const addChild = () => onChange({ child_attachments: [...ad.child_attachments, emptyChild()] });
  const removeChild = (cid: string) =>
    onChange({ child_attachments: ad.child_attachments.filter(c => c.id !== cid) });

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-gray-50/50">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Criativo #{index + 1}</span>
          <input className={cls(inputBase, 'min-w-[200px]')} value={ad.name}
            onChange={e => onChange({ name: e.target.value })} placeholder="Nome do criativo" />
          {!isDPA && (
            <select className={inputBase} value={ad.type}
              onChange={e => onChange({ type: e.target.value as 'single' | 'carousel',
                child_attachments: e.target.value === 'carousel' && ad.child_attachments.length === 0
                  ? [emptyChild(), emptyChild()] : ad.child_attachments })}>
              <option value="single">Imagem única</option>
              <option value="carousel">Carrossel</option>
            </select>
          )}
          {isDPA && <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-rose-100 text-rose-700 border border-rose-200">DPA</span>}
        </div>
        {canRemove && (
          <button type="button" onClick={onRemove}
            className="text-[11px] text-rose-500 hover:text-rose-700 font-semibold">Remover</button>
        )}
      </div>

      {/* CONTEÚDO DO ANÚNCIO */}
      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Textos do Anúncio</p>
      <Field label="Texto Principal">
        <textarea className={cls(inputBase, 'min-h-[60px]')} value={ad.message}
          onChange={e => onChange({ message: e.target.value })}
          placeholder="O texto principal aparece acima da mídia do anúncio. Máximo recomendado: 125 caracteres." />
      </Field>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <Field label="Título" hint="Aparece em destaque abaixo da mídia.">
          <input className={inputBase} value={ad.headline}
            onChange={e => onChange({ headline: e.target.value })} placeholder="Ex: Transforme sua pele em 7 dias" />
        </Field>
        <Field label="Descrição" hint="Texto adicional (nem sempre visível).">
          <input className={inputBase} value={ad.description}
            onChange={e => onChange({ description: e.target.value })} placeholder="Escreva uma descrição…" />
        </Field>
      </div>

      {(!isDPA && ad.type === 'single') && (
        <>
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2 mt-4">Link e Ação</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="URL de Destino *">
              <input className={inputBase} value={ad.link}
                onChange={e => onChange({ link: e.target.value })} placeholder="https://yoursite.com/offer" />
            </Field>
            <Field label="Botão de Ação (CTA)">
              <select className={inputBase} value={ad.cta_type}
                onChange={e => onChange({ cta_type: e.target.value as CTA })}>
                {CTA_OPTIONS.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
              </select>
            </Field>
            <Field label="Link de Display/Exibição" hint="Texto que aparece no lugar da URL completa.">
              <input className={inputBase} value={ad.display_link}
                onChange={e => onChange({ display_link: e.target.value })} placeholder="seu-site.com" />
            </Field>
            <Field label="URL do CTA (opcional)" hint="Se vazio, usa o link principal">
              <input className={inputBase} value={ad.cta_link}
                onChange={e => onChange({ cta_link: e.target.value })} placeholder="https://seu-site.com/checkout" />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Mídia (imagem ou vídeo) *" hint="Imagem: JPG/PNG, ideal 1200×628 (1.91:1) ou 1080×1080 (1:1). Vídeo: MP4/MOV, até ~1GB; miniatura é gerada pela Meta em ~5-30s.">
              <div className="flex items-center gap-3">
                <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleSingleUpload(f); }} />
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="text-xs px-3 py-2 rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50"
                  disabled={uploading}>
                  {uploading
                    ? (ad.media_kind === 'video' ? 'Enviando vídeo…' : 'Enviando…')
                    : (ad.video_id || ad.image_hash ? 'Trocar mídia' : 'Fazer upload')}
                </button>
                {ad.media_kind === 'video' && ad.video_thumbnail_url ? (
                  <img src={ad.video_thumbnail_url} alt="thumbnail" className="h-12 w-12 object-cover rounded border border-gray-200" />
                ) : ad.image_preview && (
                  ad.media_kind === 'video'
                    ? <video src={ad.image_preview} className="h-12 w-12 object-cover rounded border border-gray-200" muted />
                    : <img src={ad.image_preview} alt="" className="h-12 w-12 object-cover rounded border border-gray-200" />
                )}
                {ad.media_kind === 'video' && ad.video_id && (
                  <span className="text-[10px] text-gray-400 font-mono">vid {ad.video_id.slice(0, 12)}…</span>
                )}
                {ad.media_kind === 'image' && ad.image_hash && (
                  <span className="text-[10px] text-gray-400 font-mono">{ad.image_hash.slice(0, 12)}…</span>
                )}
                {ad.media_kind === 'video' && (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-violet-100 text-violet-700 border border-violet-200">vídeo</span>
                )}
              </div>
            </Field>
          </div>
        </>
      )}

      {(!isDPA && ad.type === 'carousel') && (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-gray-500">{ad.child_attachments.length}/10 cards · CTA aplicado a todos os cards</p>
            <select className={inputBase} value={ad.cta_type}
              onChange={e => onChange({ cta_type: e.target.value as CTA })}>
              {CTA_OPTIONS.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {ad.child_attachments.map((c, j) => (
              <CarouselCardEditor key={c.id} index={j}
                card={c}
                canRemove={ad.child_attachments.length > 2}
                onChange={(p) => updateChild(c.id, p)}
                onRemove={() => removeChild(c.id)}
                uploadFor={uploadFor}
              />
            ))}
          </div>
          {ad.child_attachments.length < 10 && (
            <button type="button" onClick={addChild}
              className="self-start text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold">
              + Adicionar card
            </button>
          )}
        </div>
      )}

      {isDPA && (
        <>
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2 mt-4">Link e Ação (DPA)</p>
          <p className="text-[11px] text-gray-500 mb-2">
            DPA usa <code className="bg-gray-200 px-1 rounded">{'{{product.url}}'}</code>, <code className="bg-gray-200 px-1 rounded">{'{{product.name}}'}</code>, etc. — não precisa subir imagem (vem do catálogo).
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="URL Template (opcional)" hint="Default: {{product.url}}">
              <input className={inputBase} value={ad.link}
                onChange={e => onChange({ link: e.target.value })} placeholder="{{product.url}}" />
            </Field>
            <Field label="Botão de Ação (CTA)">
              <select className={inputBase} value={ad.cta_type}
                onChange={e => onChange({ cta_type: e.target.value as CTA })}>
                {CTA_OPTIONS.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
              </select>
            </Field>
          </div>
        </>
      )}
    </div>
  );
}

function CarouselCardEditor({
  index, card, canRemove, onChange, onRemove, uploadFor,
}: {
  index: number;
  card: ChildCard;
  canRemove: boolean;
  onChange: (patch: Partial<ChildCard>) => void;
  onRemove: () => void;
  uploadFor: (file: File) => Promise<UploadResult | null>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Cards de carrossel aceitam só imagem por enquanto — Meta suporta vídeo em
  // child_attachments, mas mistura/UI ficaria caótica nesta primeira versão.
  const handleUpload = async (file: File) => {
    if (file.type.startsWith('video/')) {
      alert('Carrossel ainda aceita apenas imagens nos cards. Use "Imagem única" para anúncios em vídeo.');
      return;
    }
    setUploading(true);
    const r = await uploadFor(file);
    setUploading(false);
    if (r && r.kind === 'image') onChange({ image_hash: r.hash, image_preview: r.preview });
  };

  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-white flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Card #{index + 1}</span>
        {canRemove && (
          <button type="button" onClick={onRemove} className="text-[10px] text-rose-500 hover:text-rose-700 font-semibold">Remover</button>
        )}
      </div>
      <input className={inputBase} value={card.headline} onChange={e => onChange({ headline: e.target.value })} placeholder="Título" />
      <input className={inputBase} value={card.description} onChange={e => onChange({ description: e.target.value })} placeholder="Descrição" />
      <input className={inputBase} value={card.link} onChange={e => onChange({ link: e.target.value })} placeholder="https://seu-site.com/…" />
      <input className={inputBase} value={card.cta_link} onChange={e => onChange({ cta_link: e.target.value })} placeholder="Link do CTA (opcional)" />
      <div className="flex items-center gap-2">
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
          className="text-[11px] px-2 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50">
          {uploading ? 'Enviando…' : card.image_hash ? 'Trocar' : 'Imagem'}
        </button>
        {card.image_preview && <img src={card.image_preview} alt="" className="h-10 w-10 object-cover rounded border border-gray-200" />}
      </div>
    </div>
  );
}

function EventLine({ e }: { e: any }) {
  let txt = '';
  let color = 'text-gray-100';
  switch (e.type) {
    case 'start':            txt = `▶ Iniciando criação de ${e.total} anúncio(s)…`; break;
    case 'campaign_created': txt = `✓ Campanha criada (${e.id})`; color = 'text-emerald-300'; break;
    case 'adset_created':    txt = `  ✓ Conjunto criado (${e.id})`; color = 'text-emerald-300'; break;
    case 'ad_progress':      txt = `    → Anúncio ${e.index}/${e.total}: ${e.message}`; color = 'text-indigo-300'; break;
    case 'creative_created': txt = `      ✓ Creative ${e.index} criado (${e.id})`; color = 'text-emerald-300'; break;
    case 'ad_created':       txt = `      ✓ Anúncio ${e.index} criado (${e.id})`; color = 'text-emerald-300'; break;
    case 'done':             txt = `✓✓ Concluído. ${e.ad_ids?.length} ad(s) publicados.`; color = 'text-emerald-400'; break;
    case 'error':            txt = `✗ Erro em ${e.step ?? '?'}: ${e.error}` + (e.fbCode ? ` (FB code ${e.fbCode})` : ''); color = 'text-rose-400'; break;
    default:                 txt = JSON.stringify(e);
  }
  return <div className={color}>{txt}</div>;
}
