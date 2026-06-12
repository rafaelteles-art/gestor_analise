'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { todayStr, toDatetimeLocal, datetimeLocalToISO } from '@/lib/timezone';
import {
  SearchableSelect as SSSelect,
  filterOptions as ssFilterOptions,
  type SSOption,
} from '@/app/components/SearchableSelect';
import { QueueWidget, useQueuePolling } from '@/app/components/QueueWidget';
import { defaultCreativeName } from '@/lib/creative-name';
import type { CreativeMedia, SeparationLevel } from '@/lib/batch-contract';

// ────────────────────────────────────────────────────────────────────────────
// SCOPE NOTE (for orchestrator):
// Commit 5120755 (labelled feat B1a) landed the B1a spec (Steps 1-3:
// SearchableSelect swap, nickname labels, tsc gate) AND the full B1b feature
// set in a single commit on this file:
//   F1  enqueue-only rework — NDJSON stream removed, 202/jobs path wired
//       with QueueWidget + useQueuePolling (imported from app/components/QueueWidget)
//   F4  Google Drive Picker — openDrivePicker / ensurePickerLoaded /
//       loadScriptOnce + /api/google/drive/status probe
//   F5  defaultCreativeName usage at enqueue
//   F6  PresetConfig expansion (pixel / audiences / catalog / product_set /
//       creatives_copy / naming_template) + applyAccountScopedPreset
//       apply-if-valid-else-skip + localStorage naming-template migration
//   F7  separation_level state, payload field, and PresetConfig wiring
// B1b SHOULD BE TREATED AS ALREADY IMPLEMENTED — do not re-run Task B1b.
// Sibling files required by these imports are untracked in the working tree:
//   app/components/QueueWidget.tsx  (B1b / A-wave)
//   lib/creative-name.ts            (B1b / A-wave)
// tsc passes because those files exist on disk; they must be committed by
// their respective owners.
//
// FIX (spec-review B1a, commit fix(B1a)):
// The original B1a+B1b combined commit left the submit path broken: it set
// queuedJobIds/showQueueWidget/enqueueError but never rendered them in JSX,
// while also leaving dead NDJSON-era state (events/doneInfo/errorInfo/
// broadcastProgress/broadcastSummary) whose panels were permanently hidden.
// This commit removes the dead state and wires QueueWidget + enqueueError into
// the Publish section so the user sees progress and error feedback after
// clicking "Publicar".
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Tipos (alinhados com app/lib/meta-campaigns.ts — repetidos aqui pra evitar
// import server-only no client)
// ────────────────────────────────────────────────────────────────────────────

interface Account {
  account_id: string;
  account_name: string;
  nickname?: string | null;
  bm_name: string;
  moeda: string | null;
  timezone: string | null;
  account_status: string | null;
  profile_name: string | null;
}

interface Pixel { id: string; name: string; last_fired_time?: string }
interface Page {
  id: string;
  name: string;
  instagram_business_account?: { id: string };
  ad_limit?: number | null;
  ads_running?: number;
}
interface Audience {
  id: string; name: string; subtype: string;
  approximate_count_lower_bound?: number;
  approximate_count_upper_bound?: number;
}
interface Catalog { id: string; name: string; product_count?: number; vertical?: string; bm_id?: string; bm_name?: string }
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
  // ── F7: separação de criativos ──────────────────────────────────────────
  // 'campaign' | 'adset' | 'ad'. Default 'campaign' = comportamento legado.
  separation_level?: SeparationLevel;
  // ── F6: campos expandidos do template ───────────────────────────────────
  // Guardados com IDs *e* nomes de exibição. Na aplicação usamos a regra
  // "apply-if-valid-else-skip" — o ID só é aplicado se existir nas opções
  // carregadas da conta selecionada; caso contrário é ignorado (com aviso).
  pixel?: { id: string; name: string };
  custom_audiences?: { id: string; name: string }[];
  saved_audiences?: { id: string; name: string }[];
  catalog?: { id: string; name: string };
  product_set?: { id: string; name: string };
  creatives_copy?: {
    message: string;
    headline: string;
    description: string;
    cta_type: string;
    link: string;
    url_tags: string;
  }[];
  naming_template?: { campaign: string; adset: string; ad: string };
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
  /**
   * Mídia importada do Google Drive (F4). Quando presente, o worker baixa o
   * arquivo na hora de executar e faz o upload pra Meta — não há image_hash /
   * video_id ainda. Mutuamente exclusivo com um upload Meta direto: importar do
   * Drive limpa image_hash/video_id e vice-versa.
   */
  drive_media?: { file_id: string; filename: string; mime: string };
  cta_type: CTA;
  cta_link: string;
  display_link: string;
  // carousel (sempre imagem por enquanto)
  child_attachments: ChildCard[];
  // DPA: product set específico desse anúncio. Vazio = usa o set global (fallback).
  product_set_id: string;
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
    product_set_id: '',
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
    <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-6 shadow-sm">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-gray-800 dark:text-gray-100">{title}</h2>
          {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>}
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
          {label && <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</p>}
          {badge}
        </div>
      )}
      {hint && <p className="text-[11px] text-gray-400 dark:text-gray-500 -mt-1">{hint}</p>}
      {children}
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-gray-400 dark:text-gray-500">{hint}</span>}
    </label>
  );
}

const inputBase = 'text-xs px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none disabled:opacity-50';

/**
 * Multi-select de contas agrupado por BM. Quando ≥2 contas marcadas, vira
 * modo broadcast — a campanha será criada em todas as contas sequencialmente.
 * A primeira conta marcada é a "primária" e dirige carregamentos account-scoped
 * (pixels, públicos, catálogos) na UI.
 */
function AccountMultiSelect({
  accounts, selected, onChange,
}: {
  accounts: { account_id: string; account_name: string; nickname?: string | null; bm_name: string; account_status: string | null }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [acctFilter, setAcctFilter] = useState('');

  // Build SSOption list for filtering (label = nickname || account_name, sublabel = account_id)
  const acctOptions: SSOption[] = useMemo(
    () => accounts.map(a => ({
      value: a.account_id,
      label: a.nickname || a.account_name,
      sublabel: a.account_id,
      group: a.bm_name || '— sem BM —',
    })),
    [accounts],
  );

  const filteredAcctOptions = useMemo(
    () => ssFilterOptions(acctOptions, acctFilter),
    [acctOptions, acctFilter],
  );

  const grouped = useMemo(() => {
    // When filter active, group only filtered results; otherwise group all
    const src = acctFilter.trim() ? filteredAcctOptions : acctOptions;
    const m = new Map<string, typeof accounts>();
    for (const o of src) {
      const a = accounts.find(x => x.account_id === o.value);
      if (!a) continue;
      const key = a.bm_name || '— sem BM —';
      const arr = m.get(key) ?? [];
      arr.push(a);
      m.set(key, arr);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [accounts, acctOptions, filteredAcctOptions, acctFilter]);

  const selectedSet = new Set(selected);
  const primaryId = selected[0];
  const primary = accounts.find(a => a.account_id === primaryId);

  /** Display label: nickname if set, otherwise account_name */
  const acctLabel = (a: { account_name: string; nickname?: string | null }) =>
    a.nickname || a.account_name;

  const toggle = (id: string) => {
    if (selectedSet.has(id)) {
      // Mantém ordem; só remove. Se restou vazio e havia algo, reseta pra primária anterior.
      const next = selected.filter(x => x !== id);
      onChange(next.length === 0 && primaryId ? [primaryId] : next);
    } else {
      onChange([...selected, id]);
    }
  };

  const toggleBM = (bmName: string) => {
    const idsInBm = (grouped.find(([n]) => n === bmName)?.[1] ?? []).map(a => a.account_id);
    const allSelected = idsInBm.every(id => selectedSet.has(id));
    if (allSelected) {
      // Tira todos do BM, mas mantém primary se ela for desse BM (sem primary = inválido).
      const next = selected.filter(id => !idsInBm.includes(id));
      onChange(next.length === 0 && idsInBm[0] ? [idsInBm[0]] : next);
    } else {
      const merged = [...selected];
      for (const id of idsInBm) if (!selectedSet.has(id)) merged.push(id);
      onChange(merged);
    }
  };

  const summary = selected.length === 0
    ? '— nenhuma conta —'
    : selected.length === 1
      ? `${primary?.bm_name ?? ''} — ${primary ? acctLabel(primary) : primaryId} (${primaryId})`
      : `${primary ? acctLabel(primary) : primaryId} +${selected.length - 1} conta(s)`;

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        disabled={accounts.length === 0}
        className={cls(
          'flex items-center justify-between gap-2 text-xs px-3 py-2 rounded-md border bg-white dark:bg-gray-900 outline-none transition-colors',
          'disabled:opacity-50',
          selected.length > 1
            ? 'border-indigo-400 ring-1 ring-indigo-200 dark:ring-indigo-800'
            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
        )}
      >
        <span className="truncate text-left flex-1">{summary}</span>
        <span className="flex items-center gap-2 shrink-0">
          {selected.length > 1 && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 px-2 py-0.5 rounded">
              broadcast: {selected.length}
            </span>
          )}
          <span className="text-gray-400 dark:text-gray-500 text-[10px]">{expanded ? '▲' : '▼'}</span>
        </span>
      </button>

      {expanded && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 max-h-72 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
          {accounts.length > 0 && (
            <div className="px-2 py-1.5 sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 z-10">
              <input
                type="text"
                value={acctFilter}
                onChange={e => setAcctFilter(e.target.value)}
                placeholder="Filtrar contas…"
                className="w-full text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 outline-none focus:border-indigo-400"
              />
            </div>
          )}
          {accounts.length === 0 && (
            <div className="px-3 py-3 text-[11px] text-gray-400 dark:text-gray-500">— nenhuma conta deste perfil —</div>
          )}
          {grouped.length === 0 && acctFilter.trim() && (
            <div className="px-3 py-3 text-[11px] text-gray-400 dark:text-gray-500 italic">Nenhum resultado para "{acctFilter}"</div>
          )}
          {grouped.map(([bmName, list]) => {
            const ids = list.map(a => a.account_id);
            const allSel = ids.every(id => selectedSet.has(id));
            const someSel = ids.some(id => selectedSet.has(id));
            return (
              <div key={bmName} className="px-2 py-1.5">
                <label className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allSel}
                    ref={el => { if (el) el.indeterminate = !allSel && someSel; }}
                    onChange={() => toggleBM(bmName)}
                    className="w-3.5 h-3.5 accent-indigo-600"
                  />
                  <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 flex-1 truncate">{bmName}</span>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">{list.length} conta(s)</span>
                </label>
                <div className="ml-5 mt-0.5">
                  {list.map(a => {
                    const isPrimary = a.account_id === primaryId;
                    return (
                      <label
                        key={a.account_id}
                        className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedSet.has(a.account_id)}
                          onChange={() => toggle(a.account_id)}
                          className="w-3.5 h-3.5 accent-indigo-600"
                        />
                        <span className="text-[11px] text-gray-700 dark:text-gray-300 flex-1 truncate">
                          {acctLabel(a)}
                          {a.nickname && (
                            <span className="text-gray-400 dark:text-gray-500 ml-1 text-[10px]">({a.account_name})</span>
                          )}
                          <span className="text-gray-400 dark:text-gray-500"> ({a.account_id})</span>
                          {a.account_status && a.account_status !== 'ACTIVE' && (
                            <span className="text-amber-600 dark:text-amber-400"> · {a.account_status}</span>
                          )}
                        </span>
                        {isPrimary && selected.length > 1 && (
                          <span className="text-[9px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-1.5 py-0.5 rounded">
                            primária
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Toggle visual estilo iOS/Tailwind. */
function Toggle({
  checked, onChange, disabled, label, hint,
}: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string; hint?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cls(
        'group flex items-center gap-3 select-none outline-none',
        'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-emerald-500 rounded-full',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <span
        className={cls(
          'relative inline-flex h-7 w-16 items-center rounded-full border transition-all duration-300 ease-out',
          'shadow-inner overflow-hidden',
          checked
            ? 'bg-gradient-to-r from-emerald-400 to-emerald-600 border-emerald-700/30 shadow-emerald-900/20'
            : 'bg-gradient-to-r from-slate-200 to-slate-300 border-slate-400/40',
          !disabled && 'group-hover:brightness-110 group-active:scale-[0.96]'
        )}
      >
        {/* texto ON */}
        <span
          className={cls(
            'absolute left-2 text-[9px] font-bold tracking-wider transition-opacity duration-200',
            checked ? 'opacity-100 text-white' : 'opacity-0'
          )}
        >
          ON
        </span>
        {/* texto OFF */}
        <span
          className={cls(
            'absolute right-2 text-[9px] font-bold tracking-wider transition-opacity duration-200',
            !checked ? 'opacity-100 text-slate-500' : 'opacity-0'
          )}
        >
          OFF
        </span>
        {/* bolinha */}
        <span
          className={cls(
            'absolute top-0.5 inline-block h-6 w-6 rounded-full bg-white shadow-lg ring-1 ring-black/10',
            'transition-all duration-300 ease-out',
            checked ? 'left-[34px]' : 'left-0.5'
          )}
        />
      </span>
      {(label || hint) && (
        <span className="flex flex-col text-left">
          {label && <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">{label}</span>}
          {hint && <span className="text-[10px] text-gray-400 dark:text-gray-500">{hint}</span>}
        </span>
      )}
    </button>
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
          ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/40 ring-1 ring-indigo-500'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-600',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <div className="flex items-center gap-2 w-full">
        <span className={cls(
          'inline-block w-3 h-3 rounded-full border-2',
          selected ? 'border-indigo-600 bg-indigo-600' : 'border-gray-300 dark:border-gray-600'
        )} />
        <span className="text-[12px] font-semibold text-gray-800 dark:text-gray-100">{title}</span>
        {badge && <span className="ml-auto">{badge}</span>}
      </div>
      {desc && <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight">{desc}</p>}
    </button>
  );
}

// Local SearchableSelect removed — all usages now use SSSelect from @/app/components/SearchableSelect.

function EmBreve() {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
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
      <div className="min-h-[60px] border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 px-2 py-1.5 flex flex-wrap gap-1.5 content-start">
        {selectedIds.length === 0 && (
          <span className="text-[11px] text-gray-400 dark:text-gray-500 italic px-1 py-1">{emptyText}</span>
        )}
        {selectedIds.map(id => {
          const a = byId.get(id);
          if (!a) {
            return (
              <span key={id} className="inline-flex items-center gap-1 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-full px-2 py-0.5 text-[11px]">
                <span className="truncate max-w-[220px]" title={id}>id: {id}</span>
                <button type="button" onClick={() => remove(id)}
                  className="text-gray-400 dark:text-gray-500 hover:text-rose-500 dark:hover:text-rose-400 leading-none text-sm font-bold"
                  aria-label="Remover">×</button>
              </span>
            );
          }
          const label = a.subtype ? `[${a.subtype}] ${a.name}` : a.name;
          return (
            <span key={id}
              className="inline-flex items-center gap-1 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 rounded-full px-2 py-0.5 text-[11px] font-medium">
              <span className="truncate max-w-[220px]" title={label}>{label}</span>
              <button type="button" onClick={() => remove(id)}
                className="text-indigo-400 dark:text-indigo-500 hover:text-rose-500 dark:hover:text-rose-400 leading-none text-sm font-bold"
                aria-label="Remover">×</button>
            </span>
          );
        })}
      </div>
      <SSSelect
        options={available.map(a => ({
          value: a.id,
          label: a.subtype ? `[${a.subtype}] ${a.name}` : a.name,
          sublabel: a.id,
        }))}
        value={null}
        onChange={v => { if (v) add(v); }}
        placeholder={available.length === 0 ? '— todos já adicionados —' : '+ adicionar público…'}
        disabled={available.length === 0}
        clearable={false}
      />
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
      <div className="min-h-[40px] border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 px-2 py-1.5 flex flex-wrap gap-1.5 content-start">
        {selected.length === 0 && <span className="text-[11px] text-gray-400 dark:text-gray-500 italic px-1 py-1">{emptyText}</span>}
        {selected.map(v => {
          const o = byVal.get(v);
          return (
            <span key={String(v)}
              className="inline-flex items-center gap-1 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800 rounded-full px-2 py-0.5 text-[11px] font-medium">
              <span>{o?.label ?? String(v)}</span>
              <button type="button" onClick={() => remove(v)}
                className="text-rose-400 dark:text-rose-500 hover:text-rose-600 dark:hover:text-rose-400 leading-none text-sm font-bold">×</button>
            </span>
          );
        })}
      </div>
      <SSSelect
        options={available.map(o => ({ value: String(o.value), label: o.label }))}
        value={null}
        onChange={v => {
          if (!v) return;
          const opt = options.find(o => String(o.value) === v);
          if (opt) add(opt.value);
        }}
        placeholder={dropdownLabel}
        disabled={available.length === 0 || loading}
        clearable={false}
      />
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
// Google Drive Picker (F4) — lazy-loaded, browser-side OAuth (drive.readonly).
// The server stores a refresh token for the WORKER to download the picked file
// at execution time; this client-side picker is purely for the user to choose a
// file id. Globals (gapi / google) are typed minimally to avoid a deps add.
// ────────────────────────────────────────────────────────────────────────────

declare const gapi: any;
declare const google: any;

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';
const GOOGLE_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? '';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

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
 * Opens the Google Picker (images + videos) and resolves with the chosen file's
 * metadata, or null if the user cancels. Throws on config/auth errors.
 */
async function openDrivePicker(): Promise<{ file_id: string; filename: string; mime: string } | null> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_API_KEY) {
    throw new Error('Google Picker não configurado (NEXT_PUBLIC_GOOGLE_CLIENT_ID / NEXT_PUBLIC_GOOGLE_API_KEY ausentes).');
  }
  await ensurePickerLoaded();

  // 1) Get an OAuth access token via Google Identity Services (browser consent).
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

  // 2) Build + show the picker, filtered to images and videos.
  return new Promise((resolve, reject) => {
    try {
      const imagesView = new google.picker.DocsView(google.picker.ViewId.DOCS_IMAGES);
      imagesView.setIncludeFolders(true);
      const videosView = new google.picker.DocsView(google.picker.ViewId.DOCS_VIDEOS);
      videosView.setIncludeFolders(true);

      const picker = new google.picker.PickerBuilder()
        .setOAuthToken(accessToken)
        .setDeveloperKey(GOOGLE_API_KEY)
        .addView(imagesView)
        .addView(videosView)
        .setCallback((data: any) => {
          const action = data[google.picker.Response.ACTION];
          if (action === google.picker.Action.PICKED) {
            const doc = data[google.picker.Response.DOCUMENTS]?.[0];
            if (!doc) return resolve(null);
            resolve({
              file_id: doc[google.picker.Document.ID],
              filename: doc[google.picker.Document.NAME] ?? 'drive-file',
              mime: doc[google.picker.Document.MIME_TYPE] ?? 'application/octet-stream',
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
        className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-semibold">
        + Criar lookalike a partir de um público
      </button>
    );
  }

  return (
    <div className="border border-indigo-100 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-950/30 rounded-lg p-3 flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Nome">
          <input className={inputBase} value={name} onChange={e => setName(e.target.value)} placeholder="LAL 1% BR — Compradores 90d" />
        </Field>
        <Field label="Público de origem">
          <SSSelect
            options={customAudiences.map(a => ({ value: a.id, label: a.name, sublabel: a.id }))}
            value={seed || null}
            onChange={v => setSeed(v ?? '')}
            placeholder="— escolha —"
            clearable={false}
          />
        </Field>
        <Field label="Tamanho (% top)" hint="1% = mais semelhante, 20% = mais alcance">
          <input type="number" min={1} max={20} step={1}
            className={inputBase}
            value={Math.round(ratio * 100)}
            onChange={e => setRatio(Math.max(1, Math.min(20, Number(e.target.value))) / 100)}
          />
        </Field>
        <Field label="País">
          <SSSelect
            options={COUNTRIES.map(c => ({ value: c.key, label: c.label }))}
            value={country}
            onChange={v => setCountry(v ?? 'BR')}
            clearable={false}
          />
        </Field>
      </div>
      {err && <p className="text-[11px] text-rose-600 dark:text-rose-400">{err}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={() => setOpen(false)} disabled={busy}
          className="px-3 py-1.5 text-xs font-semibold rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800">
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
// Popup de Nomenclatura — gera o nome da campanha a partir de um template
// com variáveis (conta, orçamento, estrutura, criativo, data).
// ────────────────────────────────────────────────────────────────────────────

const CAMPAIGN_NAME_TPL_KEY = 'campaignNameTemplate_v1';
const DEFAULT_CAMPAIGN_NAME_TPL = '[{{conta}}] {{orcamento}} {{estrutura}} - {{criativo}} - {{data}}';

interface NameVars {
  conta: string;
  orcamento: string;
  estrutura: string;
  criativo: string;
  data: string;
}

function applyNameTemplate(tpl: string, vars: NameVars): string {
  return tpl
    .replace(/\{\{\s*conta\s*\}\}/gi,     vars.conta     || '—')
    .replace(/\{\{\s*orcamento\s*\}\}/gi, vars.orcamento || '—')
    .replace(/\{\{\s*estrutura\s*\}\}/gi, vars.estrutura || '—')
    .replace(/\{\{\s*criativo\s*\}\}/gi,  vars.criativo  || '—')
    .replace(/\{\{\s*data\s*\}\}/gi,      vars.data      || '—');
}

function CampaignNameModal({
  open, onClose, onApply, vars,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (name: string) => void;
  vars: NameVars;
}) {
  const [tpl, setTpl] = useState<string>(DEFAULT_CAMPAIGN_NAME_TPL);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Carrega template salvo só no client (evita mismatch de SSR)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CAMPAIGN_NAME_TPL_KEY);
      if (saved) setTpl(saved);
    } catch {}
  }, []);

  // ESC fecha o modal
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const preview = useMemo(() => applyNameTemplate(tpl, vars), [tpl, vars]);

  const insertToken = (token: string) => {
    const el = inputRef.current;
    if (!el) { setTpl(t => (t ? t + ' ' : '') + token); return; }
    const start = el.selectionStart ?? tpl.length;
    const end   = el.selectionEnd   ?? tpl.length;
    const next = tpl.slice(0, start) + token + tpl.slice(end);
    setTpl(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  };

  if (!open) return null;

  const chips: { token: string; label: string; sample: string; tone: string }[] = [
    { token: '{{conta}}',     label: 'Conta',         sample: vars.conta,     tone: 'bg-cyan-50 dark:bg-cyan-950/40 border-cyan-300 dark:border-cyan-800 text-cyan-800 dark:text-cyan-400 hover:bg-cyan-100 dark:hover:bg-cyan-900/40' },
    { token: '{{orcamento}}', label: 'Orçamento',     sample: vars.orcamento, tone: 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40' },
    { token: '{{estrutura}}', label: 'Estrutura',     sample: vars.estrutura, tone: 'bg-fuchsia-50 dark:bg-fuchsia-950/40 border-fuchsia-300 dark:border-fuchsia-800 text-fuchsia-800 dark:text-fuchsia-400 hover:bg-fuchsia-100 dark:hover:bg-fuchsia-900/40' },
    { token: '{{criativo}}',  label: 'Criativo',      sample: vars.criativo,  tone: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40' },
    { token: '{{data}}',      label: 'Data (DD/MM)',  sample: vars.data,      tone: 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/40' },
  ];

  const handleSave = () => { try { localStorage.setItem(CAMPAIGN_NAME_TPL_KEY, tpl); } catch {} };
  // Aplica o TEMPLATE (com tokens {{…}}), não o preview substituído.
  // A substituição final acontece na hora da criação — assim variáveis editáveis
  // (conta, orçamento, estrutura, criativo, data) continuam refletindo o estado
  // atual mesmo se o usuário ajustar campos depois de fechar o modal.
  const handleUse  = () => { handleSave(); onApply(tpl); onClose(); };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-3xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <header className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">✨</span>
            <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">Nomenclatura</h3>
            <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400">Campanha</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-2xl leading-none w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Fechar"
          >
            ×
          </button>
        </header>

        <div className="grid grid-cols-[220px_1fr]">
          {/* Sidebar de variáveis */}
          <aside className="border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-4 flex flex-col gap-3">
            <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Variáveis</p>
            <div className="flex flex-col gap-2">
              {chips.map(c => (
                <button
                  key={c.token}
                  type="button"
                  onClick={() => insertToken(c.token)}
                  className={cls(
                    'flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border text-[11px] font-semibold transition',
                    c.tone,
                  )}
                  title={`Inserir ${c.token}`}
                >
                  <span className="truncate">{c.label}</span>
                  <span className="px-1.5 py-0.5 rounded bg-white/80 border border-white/40 font-mono text-[9px] max-w-[80px] truncate">
                    {c.sample || '—'}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 leading-snug">
              Clique para inserir a variável no template. Os valores ao lado são uma prévia do estado atual.
            </p>
          </aside>

          {/* Editor + Preview */}
          <div className="px-5 py-4 flex flex-col gap-4 min-w-0">
            <div>
              <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Template</p>
              <textarea
                ref={inputRef}
                value={tpl}
                onChange={e => setTpl(e.target.value)}
                rows={2}
                className="w-full text-xs font-mono px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none resize-y"
                placeholder="Ex.: [{{conta}}] {{orcamento}} - {{criativo}} - {{data}}"
              />
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                Use chips ao lado ou digite manualmente. Variáveis disponíveis: <code>{'{{conta}}'}</code>, <code>{'{{orcamento}}'}</code>, <code>{'{{estrutura}}'}</code>, <code>{'{{criativo}}'}</code>, <code>{'{{data}}'}</code>.
              </p>
            </div>

            <div>
              <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Pré-visualização</p>
              <div className="rounded-md border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/40 px-3 py-2 text-[12px] font-mono text-indigo-900 dark:text-indigo-300 break-all min-h-[36px]">
                {preview || <span className="text-gray-400 dark:text-gray-500">—</span>}
              </div>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">{preview.length} caracteres</p>
            </div>
          </div>
        </div>

        <footer className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3 bg-gray-50 dark:bg-gray-800">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTpl(DEFAULT_CAMPAIGN_NAME_TPL)}
              className="px-3 py-1.5 text-[11px] font-semibold rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Padrão
            </button>
            <button
              type="button"
              onClick={() => setTpl('')}
              className="px-3 py-1.5 text-[11px] font-semibold rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Limpar
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-3 py-1.5 text-[11px] font-semibold rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800"
              title="Salvar template no navegador"
            >
              Salvar template
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-semibold rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleUse}
              disabled={!preview.trim()}
              className="px-4 py-1.5 text-xs font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 shadow"
            >
              Usar template
            </button>
          </div>
        </footer>
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
  // accountIds[] é a source-of-truth — 1 entrada = single-account, 2+ = broadcast.
  // accountId é sempre o "primary" (primeira entrada) e dirige carregamentos
  // account-scoped (pixels, públicos, catálogos). Em broadcast, esses recursos
  // são da conta primária; pixel_id/audience_id/catalog_id passam literais nas
  // demais contas (precisam existir nelas — disclaimer alerta).
  const [accountIds, setAccountIds] = useState<string[]>(
    accountsForProfile[0]?.account_id ? [accountsForProfile[0].account_id] : []
  );
  const accountId = accountIds[0] ?? '';
  useEffect(() => {
    // Prune ao trocar de perfil: descarta contas que não pertencem ao perfil ativo.
    const valid = accountIds.filter(id => accountsForProfile.some(a => a.account_id === id));
    if (valid.length === 0 && accountsForProfile[0]) {
      setAccountIds([accountsForProfile[0].account_id]);
    } else if (valid.length !== accountIds.length) {
      setAccountIds(valid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileName, accountsForProfile]);

  const account = accounts.find(a => a.account_id === accountId);
  const isBroadcast = accountIds.length > 1;

  // Listas dependentes da conta
  const [pixels, setPixels] = useState<Pixel[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [audiences, setAudiences] = useState<{ custom: Audience[]; saved: Audience[] }>({ custom: [], saved: [] });
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [catalogBmFilter, setCatalogBmFilter] = useState<string>(''); // filtra dropdown de catálogos por BM
  const [catalogSourceCounts, setCatalogSourceCounts] = useState<{ db: number; api: number; total: number } | null>(null);
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
      setCatalogSourceCounts(cat.source_counts ?? null);
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
  const [campaignName, setCampaignName] = useState('Conversão Website — ' + todayStr());
  const [showNameModal, setShowNameModal] = useState(false);
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

  // ── Criar catálogo novo (inline) ──────────────────────────────────────────
  const [newCatalogName, setNewCatalogName] = useState('');
  const [newCatalogBmId, setNewCatalogBmId] = useState('');
  const [manualBmMode, setManualBmMode] = useState(false);
  const [businesses, setBusinesses] = useState<{ id: string; name: string }[]>([]);
  const [businessSourceCounts, setBusinessSourceCounts] = useState<{ api: number; db: number; total: number } | null>(null);
  const [loadingBusinesses, setLoadingBusinesses] = useState(false);
  const [businessesError, setBusinessesError] = useState<string | null>(null);
  const [creatingCatalog, setCreatingCatalog] = useState(false);
  const [createdCatalog, setCreatedCatalog] = useState<{ id: string; name: string } | null>(null);
  const [createCatalogError, setCreateCatalogError] = useState<string | null>(null);

  // Carrega BMs visíveis ao token sempre que o usuário entra no modo "novo
  // catálogo" e ainda não tem a lista. Não pré-carrega no mount pra evitar
  // hit no Graph API quando o usuário não vai usar catálogo.
  const loadBusinesses = async () => {
    if (!accountId) return;
    setLoadingBusinesses(true);
    setBusinessesError(null);
    try {
      const qs = `account_id=${encodeURIComponent(accountId)}${profileName ? `&profile_name=${encodeURIComponent(profileName)}` : ''}`;
      const res = await fetch(`/api/campaigns/businesses?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? res.statusText);
      const list = (data.businesses ?? []) as { id: string; name: string }[];
      setBusinesses(list);
      setBusinessSourceCounts(data.source_counts ?? null);
      // Auto-seleciona o primeiro pra reduzir cliques
      if (list.length > 0 && !newCatalogBmId) setNewCatalogBmId(list[0].id);
    } catch (e: any) {
      setBusinessesError(e?.message ?? String(e));
      setBusinesses([]);
    } finally {
      setLoadingBusinesses(false);
    }
  };

  // Limpa lista de BMs ao trocar de conta/perfil — token muda → BMs mudam
  useEffect(() => {
    setBusinesses([]);
    setNewCatalogBmId('');
    setBusinessesError(null);
  }, [accountId, profileName]);

  const handleCreateCatalog = async () => {
    const name = newCatalogName.trim();
    if (!name || !accountId) return;
    setCreatingCatalog(true);
    setCreateCatalogError(null);
    try {
      const res = await fetch('/api/campaigns/catalogs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: accountId,
          profile_name: profileName || undefined,
          name,
          bm_id: newCatalogBmId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? res.statusText);
      const cat = data.catalog as { id: string; name: string };
      setCreatedCatalog(cat);
      setCatalogs(prev => [...prev, { id: cat.id, name: cat.name, product_count: 0 }]);
      setCatalogId(cat.id);
      setProductSetId('');
      setNewCatalogName('');
    } catch (e: any) {
      setCreateCatalogError(e?.message ?? String(e));
    } finally {
      setCreatingCatalog(false);
    }
  };

  // ── Criar produto + conjunto (inline) ─────────────────────────────────────
  const [productAdName, setProductAdName] = useState('');
  const [productTitle, setProductTitle] = useState('');
  const [productLink, setProductLink] = useState('');
  const [productImageUrl, setProductImageUrl] = useState('');
  const [productDescription, setProductDescription] = useState('');
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [createdProduct, setCreatedProduct] = useState<{ product_id: string; product_set_id: string; retailer_id: string; product_name: string } | null>(null);
  const [createProductError, setCreateProductError] = useState<string | null>(null);

  type SavedProductPreset = {
    id: number;
    name: string;
    config: {
      description?: string;
      link?: string;
      image_url?: string;
      price?: string;
      currency?: string;
      brand?: string;
      availability?: string;
      condition?: string;
    };
  };
  const [productPresets, setProductPresets] = useState<SavedProductPreset[]>([]);
  const [selectedProductPresetName, setSelectedProductPresetName] = useState('');
  const [productPresetExtras, setProductPresetExtras] = useState<{
    price?: string;
    currency?: string;
    brand?: string;
    availability?: string;
    condition?: string;
  }>({});
  const [loadingProductPresets, setLoadingProductPresets] = useState(false);

  const fetchProductPresets = async () => {
    setLoadingProductPresets(true);
    try {
      const res = await fetch('/api/catalogs/product-presets');
      const data = await res.json();
      setProductPresets(data.presets ?? []);
    } catch {
      setProductPresets([]);
    } finally {
      setLoadingProductPresets(false);
    }
  };

  const applyProductPreset = (name: string) => {
    setSelectedProductPresetName(name);
    if (!name) {
      setProductPresetExtras({});
      return;
    }
    const p = productPresets.find(x => x.name === name);
    if (!p) return;
    if (typeof p.config.description === 'string') setProductDescription(p.config.description);
    if (typeof p.config.link === 'string') setProductLink(p.config.link);
    if (typeof p.config.image_url === 'string') setProductImageUrl(p.config.image_url);
    setProductPresetExtras({
      price: p.config.price,
      currency: p.config.currency,
      brand: p.config.brand,
      availability: p.config.availability,
      condition: p.config.condition,
    });
  };

  const handleCreateProduct = async () => {
    if (!accountId || !catalogId) return;
    if (!productAdName.trim() || !productTitle.trim() || !productLink.trim() || !productImageUrl.trim()) return;
    setCreatingProduct(true);
    setCreateProductError(null);
    try {
      const res = await fetch('/api/campaigns/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: accountId,
          profile_name: profileName || undefined,
          catalog_id: catalogId,
          ad_name: productAdName.trim(),
          product_name: productTitle.trim(),
          link: productLink.trim(),
          image_url: productImageUrl.trim(),
          description: productDescription.trim() || undefined,
          price: productPresetExtras.price,
          currency: productPresetExtras.currency,
          brand: productPresetExtras.brand,
          availability: productPresetExtras.availability,
          condition: productPresetExtras.condition,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data?.error ?? res.statusText);
      const info = {
        product_id: data.product_id,
        product_set_id: data.product_set_id,
        retailer_id: data.retailer_id,
        product_name: data.product_name,
      };
      setCreatedProduct(info);
      setProductSets(prev => [...prev, { id: info.product_set_id, name: info.retailer_id, product_count: 1 }]);
      setProductSetId(info.product_set_id);
    } catch (e: any) {
      setCreateProductError(e?.message ?? String(e));
    } finally {
      setCreatingProduct(false);
    }
  };

  // Limpa estado de criação quando troca de conta/catálogo
  useEffect(() => {
    setCreatedProduct(null);
    setCreateProductError(null);
  }, [catalogId, accountId]);

  // Carrega presets de produto quando há catálogo selecionado
  useEffect(() => {
    if (!catalogId) {
      setProductPresets([]);
      setSelectedProductPresetName('');
      setProductPresetExtras({});
      return;
    }
    fetchProductPresets();
  }, [catalogId]);
  useEffect(() => {
    setCreatedCatalog(null);
    setCreateCatalogError(null);
  }, [accountId]);

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
  // F7 — nível de separação de criativos. Default 'campaign' = legado.
  const [separationLevel, setSeparationLevel] = useState<SeparationLevel>('campaign');

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
  const [startTime, setStartTime] = useState(() =>
    // Daqui a 1h, relógio de parede no fuso do app (GMT-3), para datetime-local.
    toDatetimeLocal(new Date(Date.now() + 60 * 60 * 1000)),
  );
  const [endTime, setEndTime] = useState('');
  const [hasEndTime, setHasEndTime] = useState(false);

  // ── Anúncios ──────────────────────────────────────────────────────────────
  const [pageIds, setPageIds] = useState<string[]>([]);
  // Criativos designados a cada página (chave = page_id). Quando undefined,
  // a página recebe distribuição automática round-robin (comportamento legado).
  const [pageAllocations, setPageAllocations] = useState<Record<string, number>>({});
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
    // ── F7 ──
    separation_level: separationLevel,
    // ── F6: account-scoped IDs (com nomes de exibição) ──
    pixel: pixelId
      ? { id: pixelId, name: pixels.find(p => p.id === pixelId)?.name ?? pixelId }
      : undefined,
    custom_audiences: includedAudiences.map(id => ({
      id,
      name: audiences.custom.find(a => a.id === id)?.name
        ?? audiences.saved.find(a => a.id === id)?.name
        ?? id,
    })),
    saved_audiences: excludedAudiences.map(id => ({
      id,
      name: audiences.saved.find(a => a.id === id)?.name
        ?? audiences.custom.find(a => a.id === id)?.name
        ?? id,
    })),
    catalog: catalogId
      ? { id: catalogId, name: catalogs.find(c => c.id === catalogId)?.name ?? catalogId }
      : undefined,
    product_set: productSetId
      ? { id: productSetId, name: productSets.find(s => s.id === productSetId)?.name ?? productSetId }
      : undefined,
    // ── F6: textos dos criativos ──
    creatives_copy: ads.map(a => ({
      message: a.message,
      headline: a.headline,
      description: a.description,
      cta_type: a.cta_type,
      link: a.link,
      url_tags: urlTagsTpl,
    })),
    // ── F6: template de nomenclatura (sai do localStorage) ──
    naming_template: { campaign: campaignName, adset: setName, ad: adNameTpl },
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
    // ── F7 — separação de criativos ──
    if (c.separation_level) setSeparationLevel(c.separation_level);
    // ── F6 — template de nomenclatura (preset é a fonte da verdade) ──
    if (c.naming_template) {
      if (typeof c.naming_template.campaign === 'string') setCampaignName(c.naming_template.campaign);
      if (typeof c.naming_template.adset === 'string') setSetName(c.naming_template.adset);
      if (typeof c.naming_template.ad === 'string') setAdNameTpl(c.naming_template.ad);
    }
    // ── F6 — textos dos criativos: aplica sobre os criativos existentes, na
    // ordem; cria/remove slots para casar a contagem salva. url_tags é único
    // pra campanha — adotamos o do primeiro criativo salvo (já vem de urlTagsTpl).
    if (Array.isArray(c.creatives_copy) && c.creatives_copy.length > 0) {
      setAds(prev => c.creatives_copy!.map((copy, i) => {
        const base = prev[i] ?? { ...emptyAd(), name: `Criativo ${i + 1}` };
        return {
          ...base,
          message: copy.message ?? base.message,
          headline: copy.headline ?? base.headline,
          description: copy.description ?? base.description,
          cta_type: (copy.cta_type as CTA) ?? base.cta_type,
          link: copy.link ?? base.link,
        };
      }));
      if (typeof c.creatives_copy[0].url_tags === 'string') setUrlTagsTpl(c.creatives_copy[0].url_tags);
    }
  };

  /**
   * Apply-if-valid-else-skip (F6) for account-scoped IDs. Each saved ID is only
   * adopted if it exists in the options currently loaded for the selected
   * account; otherwise it's left untouched. Returns the human labels of the
   * fields that were skipped so the caller can surface one combined notice.
   */
  const applyAccountScopedPreset = (c: PresetConfig): string[] => {
    const skipped: string[] = [];
    // Pixel
    if (c.pixel?.id) {
      if (pixels.some(p => p.id === c.pixel!.id)) setPixelId(c.pixel.id);
      else skipped.push('pixel');
    }
    // Custom audiences (incluídos)
    if (Array.isArray(c.custom_audiences) && c.custom_audiences.length) {
      const valid = c.custom_audiences.filter(a => audiences.custom.some(x => x.id === a.id));
      if (valid.length) setIncludedAudiences(valid.map(a => a.id));
      if (valid.length < c.custom_audiences.length) skipped.push('públicos personalizados');
    }
    // Saved audiences (excluídos)
    if (Array.isArray(c.saved_audiences) && c.saved_audiences.length) {
      const validIds = c.saved_audiences.filter(a =>
        audiences.saved.some(x => x.id === a.id) || audiences.custom.some(x => x.id === a.id));
      if (validIds.length) setExcludedAudiences(validIds.map(a => a.id));
      if (validIds.length < c.saved_audiences.length) skipped.push('públicos salvos');
    }
    // Catalog
    if (c.catalog?.id) {
      if (catalogs.some(x => x.id === c.catalog!.id)) {
        setCatalogId(c.catalog.id);
        setProductSetId('');
      } else {
        skipped.push('catálogo');
      }
    }
    // Product set (só aplica se o catálogo bateu e o set existe nele)
    if (c.product_set?.id) {
      if (productSets.some(x => x.id === c.product_set!.id)) setProductSetId(c.product_set.id);
      else skipped.push('conjunto de produtos');
    }
    return skipped;
  };

  // Notice combinado de campos ignorados na última aplicação de preset.
  const [presetSkipNotice, setPresetSkipNotice] = useState<string | null>(null);

  const handleApplyPreset = (name: string) => {
    setActivePresetName(name);
    setPresetSkipNotice(null);
    if (!name) return;
    const p = presets.find(p => p.name === name);
    if (!p) return;
    try {
      applyPresetConfig(p.config);
      const skipped = applyAccountScopedPreset(p.config);
      if (skipped.length) {
        setPresetSkipNotice(`Template aplicado; ignorados (não existem nesta conta): ${skipped.join(', ')}`);
      }
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

  // Mantém pageAllocations enxuto: descarta entradas de páginas que saíram
  // da seleção. Não cria entradas novas automaticamente — sem entrada = auto
  // (round-robin clássico).
  useEffect(() => {
    setPageAllocations(prev => {
      const next: Record<string, number> = {};
      for (const id of pageIds) if (prev[id] !== undefined) next[id] = prev[id];
      return next;
    });
  }, [pageIds]);

  useEffect(() => { if (!pixelId && pixels[0]) setPixelId(pixels[0].id); }, [pixels, pixelId]);

  // Anúncios (criativos drafted)
  const [ads, setAds] = useState<AdDraft[]>([emptyAd()]);
  const updateAd = (id: string, patch: Partial<AdDraft>) =>
    setAds(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));
  const addAd = () => setAds(prev => [...prev, { ...emptyAd(), name: `Criativo ${prev.length + 1}` }]);
  const removeAd = (id: string) => setAds(prev => prev.length === 1 ? prev : prev.filter(a => a.id !== id));

  // Quando o total de anúncios a publicar muda (mais/menos criativos ou
  // mudança nos multiplicadores), garante que a soma das alocações manuais
  // nunca exceda o teto. Estratégia: percorre pageIds em ordem e clampa o
  // saldo restante em cada página.
  useEffect(() => {
    const totalAds = ads.length
      * Math.max(1, campaignsPerCreative)
      * Math.max(1, adsetsPerCampaign)
      * Math.max(1, adsPerAdset);
    setPageAllocations(prev => {
      let remaining = totalAds;
      let changed = false;
      const next: Record<string, number> = {};
      for (const id of pageIds) {
        if (prev[id] === undefined) continue;
        const original = prev[id];
        const clamped = Math.max(0, Math.min(original, remaining));
        if (clamped !== original) changed = true;
        next[id] = clamped;
        remaining -= clamped;
      }
      return changed ? next : prev;
    });
  }, [ads.length, campaignsPerCreative, adsetsPerCampaign, adsPerAdset, pageIds]);

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

  // ── Google Drive connection (F4) — probed once on mount ────────────────────
  const [driveConnected, setDriveConnected] = useState<boolean | null>(null);
  useEffect(() => {
    fetch('/api/google/drive/status', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setDriveConnected(!!d.connected))
      .catch(() => setDriveConnected(false));
  }, []);

  // ── F6 back-compat: migrate the localStorage naming template into form state
  // as the default campaign-name template, until the user saves a preset. We
  // only adopt it if the user hasn't already typed a custom campaign name.
  const migratedNameTplRef = useRef(false);
  useEffect(() => {
    if (migratedNameTplRef.current) return;
    migratedNameTplRef.current = true;
    try {
      const saved = localStorage.getItem(CAMPAIGN_NAME_TPL_KEY);
      if (saved && saved.includes('{{')) setCampaignName(saved);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fila (F1) — job ids enfileirados nesta sessão + polling do widget ──────
  const [queuedJobIds, setQueuedJobIds] = useState<number[]>([]);
  const [enqueueError, setEnqueueError] = useState<string | null>(null);
  const [showQueueWidget, setShowQueueWidget] = useState(false);
  const queueRows = useQueuePolling(queuedJobIds);

  // ── Publish state ─────────────────────────────────────────────────────────
  const [running, setRunning] = useState(false);

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
  // Pixel é obrigatório quando otimização é por conversão (vale tanto para non-DPA quanto DPA
  // com OFFSITE_CONVERSIONS — Meta precisa saber qual evento do pixel otimizar).
  if (!pixelId) errors.push('Selecione um pixel.');
  if (isDPA && !catalogId) {
    errors.push(catalogConfigMode === 'new'
      ? 'Crie o novo catálogo (botão "Criar agora").'
      : 'Selecione um catálogo.');
  }
  if (isDPA && catalogId) {
    // Cada criativo precisa resolver pra ALGUM product set — o próprio do ad
    // ou o global como fallback. Sem isso a Meta não resolve {{product.url}}.
    const adsWithoutPsid = ads
      .map((a, i) => ({ idx: i + 1, ok: !!(a.product_set_id || productSetId) }))
      .filter(x => !x.ok);
    if (adsWithoutPsid.length > 0) {
      errors.push(
        `Conjunto de Produtos faltando em: ${adsWithoutPsid.map(x => `Criativo ${x.idx}`).join(', ')}. ` +
        `Defina por criativo ou escolha um global como fallback.`
      );
    }
  }
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

    const status = publishPaused ? 'PAUSED' : 'ACTIVE';
    const selectedPages = pages.filter(p => pageIds.includes(p.id));

    // Substitui variáveis "estáticas" do nome da campanha agora (no submit) —
    // {{conta}}, {{orcamento}}, {{estrutura}}, {{data}}. O token {{criativo}}
    // permanece e é resolvido por criativo no orquestrador (meta-campaigns.ts).
    const startDate = (() => {
      // startTime é 'YYYY-MM-DDTHH:mm' no fuso do app (GMT-3) — extrai DD/MM direto.
      if (!/^\d{4}-\d{2}-\d{2}/.test(startTime)) return '';
      return `${startTime.slice(8, 10)}/${startTime.slice(5, 7)}`;
    })();
    const resolvedCampaignName = campaignName
      .replace(/\{\{\s*conta\s*\}\}/gi,     (account?.nickname || account?.account_name) ?? '')
      .replace(/\{\{\s*orcamento\s*\}\}/gi, campaignType)
      .replace(/\{\{\s*estrutura\s*\}\}/gi, `${campaignsPerCreative}-${adsetsPerCampaign}-${adsPerAdset}`)
      .replace(/\{\{\s*data\s*\}\}/gi,      startDate);

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

    // promoted_object do AD SET:
    //  - DPA (catálogo na campanha): apenas product_set_id + pixel + evento — product_catalog_id
    //    NÃO vai no adset porque herda do campaign. Mandar gera erro 1815229
    //    ("product_catalog_id não aceito para WEBSITE_CONVERSIONS").
    //  - Non-DPA: pixel + evento de conversão.
    const promotedObject: any = isDPA
      ? {
          product_set_id: productSetId || undefined,
          pixel_id: pixelId || undefined,
          custom_event_type: pixelId ? (customEvent || 'PURCHASE') : undefined,
        }
      : { pixel_id: pixelId, custom_event_type: customEvent };
    // Limpa undefined pra não enviar chave vazia
    Object.keys(promotedObject).forEach(k => promotedObject[k] === undefined && delete promotedObject[k]);

    const adset: any = {
      name: setName.trim() || resolvedCampaignName + ' — Conjunto',
      optimization_goal: isDPA ? 'OFFSITE_CONVERSIONS' : optGoal,
      billing_event: optGoal === 'LINK_CLICKS' ? 'LINK_CLICKS' : 'IMPRESSIONS',
      bid_strategy: !isCBO ? bidStrategy : undefined,
      [budgetKind === 'daily' ? 'daily_budget_cents' : 'lifetime_budget_cents']: adsetBudgetCents,
      promoted_object: promotedObject,
      targeting,
      destination_type: isDPA ? undefined : 'WEBSITE',
      start_time: datetimeLocalToISO(startTime),
      end_time: hasEndTime && endTime ? datetimeLocalToISO(endTime) : undefined,
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
      name: resolvedCampaignName,
      objective: isDPA ? 'OUTCOME_SALES' : 'OUTCOME_SALES',
      status,
      special_ad_categories: specialCategory === 'NONE' ? [] : [specialCategory],
      buying_type: 'AUCTION',
      is_adset_budget_sharing_enabled: campaignType === 'ABO' && aboShare,
      [budgetKind === 'daily' ? 'daily_budget_cents' : 'lifetime_budget_cents']: campaignBudgetCents,
      bid_strategy: isCBO ? bidStrategy : undefined,
      // Em DPA com OUTCOME_SALES (ODAX), product_catalog_id é OBRIGATÓRIO no campaign
      // (independente do toggle catalogLevel) — sem isso a Meta trata como WEBSITE_CONVERSIONS
      // normal e rejeita os campos de catálogo.
      promoted_object: (isDPA && catalogId)
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
      // F5 — nome default client-side quando o input está vazio.
      const resolvedAdName = a.name.trim() || defaultCreativeName({
        dpa: isDPA,
        productSetName: isDPA
          ? (productSets.find(s => s.id === (a.product_set_id || productSetId))?.name)
          : undefined,
        fileName: a.drive_media?.filename || undefined,
      });
      const baseName = (adNameTpl && adNameTpl.trim()) || resolvedAdName;
      const firstPageId = selectedPages[0]?.id ?? '';
      // Sem IG Business Account, o server resolve via Page-Backed Instagram Account
      // (PBIA) na hora de criar o creative — não dá pra usar page_id direto aqui.
      const firstIgId = selectedPages[0]?.instagram_business_account?.id;
      const resolvedPsid = a.product_set_id || productSetId || undefined;
      const creative: any = isDPA
        ? {
            name: baseName + ' — Creative',
            page_id: firstPageId,
            instagram_user_id: firstIgId,
            type: 'dpa',
            message: a.message,
            headline: a.headline,
            description: a.description,
            template_link: a.link || '{{product.url}}',
            cta_type: a.cta_type,
            cta_link: a.cta_link || a.link || '{{product.url}}',
            product_set_id: resolvedPsid,
          }
        : a.type === 'single'
        ? {
            name: baseName + ' — Creative',
            page_id: firstPageId,
            instagram_user_id: firstIgId,
            type: 'single',
            link: a.link,
            message: a.message,
            headline: a.headline,
            description: a.description,
            // Mídia: importada do Drive (worker baixa+sobe na execução) OU já
            // enviada à Meta (hash/video_id). `media` é o slot discriminado da
            // Contract 2 (CreativeMedia); o worker resolve antes de criar o ad.
            ...(a.drive_media
              ? { media: { source: 'drive', file_id: a.drive_media.file_id, filename: a.drive_media.filename, mime: a.drive_media.mime } as CreativeMedia }
              : a.media_kind === 'video'
                ? { video_id: a.video_id, video_thumbnail_url: a.video_thumbnail_url }
                : { image_hash: a.image_hash }),
            cta_type: a.cta_type,
            cta_link: a.cta_link || a.link,
          }
        : {
            name: baseName + ' — Creative',
            page_id: firstPageId,
            instagram_user_id: firstIgId,
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
      account_ids: accountIds,
      profile_name: profileName || undefined,
      // F7 — top-level (a rota /api/campaigns/create lê body.separation_level e
      // o injeta em cada job para o orquestrador A2 consumir).
      separation_level: separationLevel,
      batch: {
        campaigns_per_creative: campaignsPerCreative,
        adsets_per_campaign: adsetsPerCampaign,
        ads_per_adset: adsPerAdset,
        page_ids: selectedPages.map(p => p.id),
        // Alocação manual de criativos por página. Páginas ausentes aqui
        // entram no rateio automático (round-robin) sobre o restante.
        page_allocations: selectedPages.reduce<Record<string, number>>((acc, p) => {
          const v = pageAllocations[p.id];
          if (v !== undefined) acc[p.id] = v;
          return acc;
        }, {}),
        page_auto_retry: autoRetryPage,
        campaign,
        adset,
        creatives,
        url_tags_template: urlTagsTpl?.trim() || undefined,
        context: {
          conta_nome: account?.account_name,
          conta_apelido: account?.nickname || account?.account_name,
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

    // ENQUEUE-ONLY (ADR-0005): a rota agora responde 202 com os jobs criados.
    // Não há mais stream NDJSON — o worker cria as campanhas em segundo plano e
    // o QueueWidget acompanha o progresso (kick + poll a cada 4s via
    // useQueuePolling). Em broadcast, vem um job por conta (broadcast_group_id
    // compartilhado).
    setEnqueueError(null);
    try {
      const res = await fetch('/api/campaigns/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status !== 202) {
        setEnqueueError(data?.error ?? `Falha ao enfileirar (HTTP ${res.status}).`);
        return;
      }
      const ids: number[] = Array.isArray(data?.jobs)
        ? data.jobs.map((j: any) => Number(j.id)).filter((n: number) => Number.isFinite(n))
        : [];
      if (ids.length === 0) {
        setEnqueueError('Resposta inesperada do servidor (sem jobs).');
        return;
      }
      setQueuedJobIds(ids);
      setShowQueueWidget(true);
      // Falhas de autenticação parciais (contas sem token) voltam em failures.
      if (Array.isArray(data?.failures) && data.failures.length) {
        setEnqueueError(
          `${data.failures.length} conta(s) ignorada(s) por falta de token: ` +
          data.failures.map((f: any) => f.account_id).join(', ')
        );
      }
    } catch (e: any) {
      setEnqueueError(e?.message ?? String(e));
    } finally {
      setRunning(false);
    }
  };

  // ── Render guards ─────────────────────────────────────────────────────────
  if (accounts.length === 0) {
    return (
      <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl p-6 text-sm text-amber-800 dark:text-amber-400">
        Nenhuma conta Meta selecionada com token válido. Vá em <a href="/settings" className="underline font-semibold">Contas de anúncios</a> para selecionar.
      </div>
    );
  }
  if (availableProfiles.length === 0) {
    return (
      <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl p-6 text-sm text-amber-800 dark:text-amber-400">
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
          <div className="flex items-end justify-between gap-3 text-[11px] text-gray-500 dark:text-gray-400">
            <span>{accountsForProfile.length} conta(s) deste perfil disponível(is) abaixo.</span>
            <button type="button" onClick={handleSyncAccounts} disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
              <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Sincronizando…' : 'Sincronizar contas'}
            </button>
          </div>
        </div>
        {syncing && syncMsg && <p className="text-[11px] text-gray-400 dark:text-gray-500">{syncMsg}</p>}
        {syncError && <p className="text-[11px] text-rose-600 dark:text-rose-400">Erro ao sincronizar: {syncError}</p>}
      </MainSection>

      {/* ───────── 1. Configurações da Campanha ───────── */}
      <MainSection
        title="Configurações da Campanha"
        subtitle="Defina o objetivo e as configurações principais"
        badge={<span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded">Vendas</span>}
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
              className="px-3 py-2 text-[11px] font-semibold rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 disabled:opacity-50"
            >
              Salvar
            </button>
            <button
              type="button"
              onClick={handleDeletePreset}
              disabled={presetBusy || !activePresetName}
              title={activePresetName ? `Excluir preset "${activePresetName}"` : 'Selecione um preset'}
              className="px-3 py-2 text-[11px] font-semibold rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/50 disabled:opacity-50"
            >
              Excluir
            </button>
          </div>
        </SubBlock>

        {/* IDENTIFICAÇÃO */}
        <SubBlock label="Identificação">
          <div className="grid grid-cols-1 gap-3">
            <Field label="Conta de Anúncio *" hint={isBroadcast ? `Modo broadcast: a campanha será criada em ${accountIds.length} contas sequencialmente.` : undefined}>
              <AccountMultiSelect
                accounts={accountsForProfile}
                selected={accountIds}
                onChange={setAccountIds}
              />
              {isBroadcast && (
                <div className="mt-2 text-[11px] leading-relaxed bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2 text-amber-800 dark:text-amber-400">
                  <strong>Atenção — IDs account-scoped:</strong> pixels, públicos, catálogos e product sets exibidos são da conta primária
                  <span className="font-mono"> ({(account?.nickname || account?.account_name) ?? accountId})</span>. Em broadcast, esses IDs serão enviados <em>tal qual</em> para as demais contas — se não existirem
                  na conta destino, a chamada à Meta falha (erro #100). A criação segue nas demais contas e o resumo final mostra sucessos/falhas.
                  <br />
                  <strong>Alocação de páginas:</strong> cada conta respeita o cap localmente, então a mesma página pode receber até
                  <span className="font-mono"> allocation × {accountIds.length}</span> ads no total entre todas as contas.
                </div>
              )}
            </Field>
            <Field label="Nome da Campanha *" hint={loadingDeps ? 'Carregando pixels/páginas/públicos/catálogos…' : depsError ?? undefined}>
              <div className="flex items-stretch gap-2">
                <input
                  className={cls(inputBase, 'flex-1 min-w-0')}
                  value={campaignName}
                  onChange={e => setCampaignName(e.target.value)}
                  placeholder="Digite o nome da campanha…"
                  maxLength={400}
                />
                <button
                  type="button"
                  onClick={() => setShowNameModal(true)}
                  className="shrink-0 px-3 py-2 text-[11px] font-semibold rounded-md border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 inline-flex items-center gap-1"
                  title="Gerar nome com variáveis"
                >
                  <span>✨</span>
                  <span>Variáveis</span>
                </button>
              </div>
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
          <div className="rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50/40 dark:bg-rose-950/30 px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-[12px] font-semibold text-rose-800 dark:text-rose-400">Usar catálogo de produtos</p>
              <p className="text-[11px] text-rose-700 dark:text-rose-400">Dynamic Product Ads — funciona com qualquer modo de orçamento ({campaignType}).</p>
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
                  onClick={(v) => {
                    setCatalogConfigMode(v);
                    setCatalogId('');
                    setProductSetId('');
                    if (businesses.length === 0 && !loadingBusinesses) loadBusinesses();
                  }}
                  title="+ Configurar novo catálogo"
                  desc="Cria um catálogo novo no BM da conta selecionada"
                />
                <OptionCard
                  value={'existing' as const} selected={catalogConfigMode === 'existing'}
                  onClick={(v) => { setCatalogConfigMode(v); setCreatedCatalog(null); }}
                  title="Usar catálogo existente"
                  desc="Selecione um Business Manager e depois o catálogo"
                  badge={<span className="text-[9px] bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 px-1.5 py-0.5 rounded font-bold">{catalogs.length} catálogo(s)</span>}
                />
              </div>

              {catalogConfigMode === 'new' && !createdCatalog && (
                <div className="border border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-950/30 rounded-lg p-3 mt-2 flex flex-col gap-2">
                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      label="Business Manager"
                      hint={
                        loadingBusinesses
                          ? 'Carregando…'
                          : businessSourceCounts
                            ? `${businessSourceCounts.total} BM(s) · API: ${businessSourceCounts.api} · DB: ${businessSourceCounts.db}`
                            : `${businesses.length} BM(s)`
                      }
                    >
                      {manualBmMode ? (
                        <div className="flex gap-2">
                          <input
                            className={inputBase + ' flex-1 font-mono'}
                            value={newCatalogBmId}
                            onChange={e => setNewCatalogBmId(e.target.value.trim())}
                            placeholder="ID do BM (ex: 123456789012345)"
                            disabled={creatingCatalog}
                          />
                          <button
                            type="button"
                            onClick={() => setManualBmMode(false)}
                            disabled={creatingCatalog}
                            className="px-2 py-1 text-[11px] font-semibold rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                          >
                            Lista
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <select
                            className={inputBase + ' flex-1'}
                            value={newCatalogBmId}
                            onChange={e => setNewCatalogBmId(e.target.value)}
                            disabled={loadingBusinesses || creatingCatalog}
                          >
                            <option value="">
                              {loadingBusinesses
                                ? '— carregando… —'
                                : businesses.length === 0
                                  ? '— nenhum BM disponível —'
                                  : '— selecione —'}
                            </option>
                            {businesses.map(b => (
                              <option key={b.id} value={b.id}>{b.name} ({b.id})</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={loadBusinesses}
                            disabled={loadingBusinesses || creatingCatalog || !accountId}
                            title="Recarregar BMs"
                            className="px-2 py-1 text-[11px] font-semibold rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                          >
                            <RefreshCw className={cls('h-3.5 w-3.5', loadingBusinesses && 'animate-spin')} />
                          </button>
                          <button
                            type="button"
                            onClick={() => { setManualBmMode(true); setNewCatalogBmId(''); }}
                            disabled={creatingCatalog}
                            title="Digitar bm_id manualmente"
                            className="px-2 py-1 text-[11px] font-semibold rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                          >
                            ID
                          </button>
                        </div>
                      )}
                    </Field>
                    <Field label="Nome do novo catálogo">
                      <input
                        className={inputBase}
                        value={newCatalogName}
                        onChange={e => setNewCatalogName(e.target.value)}
                        placeholder="Ex: Catálogo Produto X"
                        disabled={creatingCatalog}
                      />
                    </Field>
                  </div>
                  {!loadingBusinesses && businesses.length === 0 && !manualBmMode && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2">
                      Nenhum BM visível ao token deste perfil. Use o botão <strong>ID</strong> ao lado pra digitar o <code>bm_id</code> manualmente, ou sincronize as contas em <em>Status Contas</em> primeiro.
                    </p>
                  )}
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleCreateCatalog}
                      disabled={!newCatalogName.trim() || !accountId || !newCatalogBmId || creatingCatalog}
                      className="px-4 py-2 text-xs font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
                    >
                      {creatingCatalog ? 'Criando…' : 'Criar agora'}
                    </button>
                  </div>
                  {businessesError && (
                    <p className="text-[11px] text-rose-600 dark:text-rose-400">Erro ao listar BMs: {businessesError}</p>
                  )}
                  {createCatalogError && (
                    <p className="text-[11px] text-rose-600 dark:text-rose-400">{createCatalogError}</p>
                  )}
                  <p className="text-[10px] text-gray-500 dark:text-gray-400">
                    O catálogo será criado com vertical <code>commerce</code> no BM selecionado. Você precisa ser admin desse BM.
                  </p>
                </div>
              )}

              {catalogConfigMode === 'new' && createdCatalog && (
                <div className="border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/30 rounded-lg p-3 mt-2 flex items-center justify-between">
                  <div>
                    <p className="text-[12px] font-semibold text-emerald-800 dark:text-emerald-400">Catálogo criado ✓</p>
                    <p className="text-[11px] text-emerald-700 dark:text-emerald-400">{createdCatalog.name} <span className="text-emerald-600/70 dark:text-emerald-500">({createdCatalog.id})</span></p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setCreatedCatalog(null); setCatalogId(''); setProductSetId(''); }}
                    className="text-[11px] text-emerald-700 dark:text-emerald-400 hover:text-emerald-900 dark:hover:text-emerald-300 underline"
                  >
                    Criar outro
                  </button>
                </div>
              )}

              {catalogConfigMode === 'existing' && (() => {
                // BMs únicos com contagem de catálogos — alimenta o filtro à esquerda
                const bmGroups = new Map<string, { id: string; name: string; count: number }>();
                for (const c of catalogs) {
                  if (!c.bm_id) continue;
                  const cur = bmGroups.get(c.bm_id);
                  if (cur) cur.count++;
                  else bmGroups.set(c.bm_id, { id: c.bm_id, name: c.bm_name || c.bm_id, count: 1 });
                }
                const bmOptions = Array.from(bmGroups.values()).sort((a, b) => a.name.localeCompare(b.name));
                const filteredCatalogs = catalogBmFilter
                  ? catalogs.filter(c => c.bm_id === catalogBmFilter)
                  : catalogs;
                return (
                  <div className="grid grid-cols-3 gap-3 mt-2">
                    <Field label="Business Manager" hint={catalogBmFilter ? `filtrando ${filteredCatalogs.length}/${catalogs.length}` : `${bmOptions.length} BM(s) com catálogo`}>
                      <SSSelect
                        options={bmOptions.map(b => ({
                          value: b.id,
                          label: b.name,
                          sublabel: `${b.count} catálogos · ${b.id}`,
                        }))}
                        value={catalogBmFilter || null}
                        onChange={v => {
                          const nv = v ?? '';
                          setCatalogBmFilter(nv);
                          if (catalogId && nv) {
                            const cur = catalogs.find(c => c.id === catalogId);
                            if (cur && cur.bm_id !== nv) { setCatalogId(''); setProductSetId(''); }
                          }
                        }}
                        placeholder="— todos os BMs —"
                        clearable={true}
                      />
                    </Field>
                    <Field label="Catálogo">
                      <SSSelect
                        options={filteredCatalogs.map(c => {
                          const bits: string[] = [];
                          if (c.bm_name && !catalogBmFilter) bits.push(c.bm_name);
                          if (c.product_count !== undefined) bits.push(`${c.product_count} produtos`);
                          return {
                            value: c.id,
                            label: c.name,
                            sublabel: bits.length ? bits.join(' · ') : c.id,
                          };
                        })}
                        value={catalogId || null}
                        onChange={v => { setCatalogId(v ?? ''); setProductSetId(''); }}
                        placeholder="— selecione —"
                      />
                    </Field>
                    <Field label="Conjunto de Produtos (fallback)" hint="Usado quando o criativo não define o próprio set.">
                      <SSSelect
                        options={productSets.map(s => ({
                          value: s.id,
                          label: s.name,
                          sublabel: s.product_count !== undefined ? `${s.product_count} produtos` : s.id,
                        }))}
                        value={productSetId || null}
                        onChange={v => setProductSetId(v ?? '')}
                        placeholder={loadingProductSets ? 'Carregando…' : '— opcional, defina por criativo abaixo —'}
                        disabled={!catalogId || loadingProductSets}
                        clearable={true}
                      />
                    </Field>
                  </div>
                );
              })()}

              {catalogConfigMode === 'existing' && (
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                  {catalogSourceCounts
                    ? `${catalogSourceCounts.total} catálogo(s) · sincronizado (DB): ${catalogSourceCounts.db} · API live: ${catalogSourceCounts.api}`
                    : null}
                </p>
              )}

              {catalogConfigMode === 'existing' && !catalogId && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2 mt-2">
                  {catalogs.length === 0
                    ? <>Nenhum catálogo visível para esse perfil. Rode o sync em <strong>/catalogo</strong> antes (esse fluxo captura também catálogos compartilhados via Partner).</>
                    : <>Escolha um catálogo acima para prosseguir.</>}
                </p>
              )}

              {/* Criar produto + conjunto inline — disponível assim que houver catalogId */}
              {catalogId && (
                <div className="border border-rose-200 dark:border-rose-800 bg-rose-50/40 dark:bg-rose-950/30 rounded-lg p-3 mt-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[12px] font-semibold text-rose-800 dark:text-rose-400">Criar novo produto + conjunto</p>
                    {createdProduct && (
                      <span className="text-[10px] bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded font-bold">CRIADO ✓</span>
                    )}
                  </div>
                  <p className="text-[10px] text-rose-700/80 dark:text-rose-400/80 -mt-1">
                    Cria um produto e um conjunto com filtro <code>retailer_id == {'{ad_name} {dd/mm}'}</code>. Após criar, o conjunto é selecionado automaticamente.
                  </p>
                  <div className="flex items-end gap-2">
                    <Field label="Preset" hint={loadingProductPresets ? 'Carregando…' : `${productPresets.length} disponíveis`}>
                      <select
                        className={inputBase}
                        value={selectedProductPresetName}
                        onChange={e => applyProductPreset(e.target.value)}
                        disabled={creatingProduct || loadingProductPresets}
                      >
                        <option value="">— Sem preset —</option>
                        {productPresets.map(p => (
                          <option key={p.id} value={p.name}>{p.name}</option>
                        ))}
                      </select>
                    </Field>
                    <button
                      type="button"
                      onClick={fetchProductPresets}
                      disabled={loadingProductPresets}
                      title="Recarregar presets"
                      className="px-3 py-2 text-[11px] font-semibold rounded border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-40 whitespace-nowrap"
                    >
                      ↻
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Nome do anúncio (gera retailer_id)">
                      <input className={inputBase} value={productAdName} onChange={e => setProductAdName(e.target.value)} placeholder="Ex: LT1100" disabled={creatingProduct} />
                    </Field>
                    <Field label="Título do produto">
                      <input className={inputBase} value={productTitle} onChange={e => setProductTitle(e.target.value)} placeholder="Ex: Lanterna Tática LT1100" disabled={creatingProduct} />
                    </Field>
                    <Field label="Link (URL de destino)">
                      <input className={inputBase} value={productLink} onChange={e => setProductLink(e.target.value)} placeholder="https://..." disabled={creatingProduct} />
                    </Field>
                    <Field label="Imagem (URL pública)">
                      <input className={inputBase} value={productImageUrl} onChange={e => setProductImageUrl(e.target.value)} placeholder="https://..." disabled={creatingProduct} />
                    </Field>
                    <Field label="Descrição (opcional)">
                      <input className={inputBase} value={productDescription} onChange={e => setProductDescription(e.target.value)} placeholder="Ex: Lanterna recarregável de alta potência" disabled={creatingProduct} />
                    </Field>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={handleCreateProduct}
                        disabled={
                          creatingProduct
                          || !productAdName.trim()
                          || !productTitle.trim()
                          || !productLink.trim()
                          || !productImageUrl.trim()
                        }
                        className="w-full px-4 py-2 text-xs font-semibold rounded-md bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
                      >
                        {creatingProduct ? 'Criando…' : 'Criar agora'}
                      </button>
                    </div>
                  </div>
                  {createProductError && (
                    <p className="text-[11px] text-rose-700 dark:text-rose-400 bg-rose-100 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded px-2 py-1">{createProductError}</p>
                  )}
                  {createdProduct && (
                    <div className="text-[11px] text-emerald-800 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded px-2 py-1.5">
                      <strong>{createdProduct.product_name}</strong> — retailer_id <code>{createdProduct.retailer_id}</code>
                      <br />
                      <span className="text-emerald-700 dark:text-emerald-400">product_id: {createdProduct.product_id} · product_set_id: {createdProduct.product_set_id}</span>
                    </div>
                  )}
                </div>
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
              badge={<span className="text-[9px] bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded font-bold">BETA</span>}
            />
            <OptionCard<BidStrategyUI>
              value="LOWEST_COST_WITH_BID_CAP" selected={bidStrategy === 'LOWEST_COST_WITH_BID_CAP'} onClick={setBidStrategy}
              title="Bid Cap"
              desc="Lance máximo por leilão"
              badge={<span className="text-[9px] bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded font-bold">BETA</span>}
            />
            <OptionCard<BidStrategyUI>
              value="LOWEST_COST_WITH_MIN_ROAS" selected={bidStrategy === 'LOWEST_COST_WITH_MIN_ROAS'} onClick={setBidStrategy}
              title="Meta de ROAS"
              desc="Retorno em anúncios"
              badge={<span className="text-[9px] bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded font-bold">BETA</span>}
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

        {/* STATUS DA CAMPANHA */}
        <div
          className={cls(
            'relative rounded-xl border-2 px-5 py-4 flex items-center justify-between gap-4 transition-all duration-300',
            'shadow-sm hover:shadow-md',
            publishPaused
              ? 'border-slate-300 bg-gradient-to-br from-slate-50 to-slate-100/60'
              : 'border-emerald-300 bg-gradient-to-br from-emerald-50 to-emerald-100/40'
          )}
        >
          <div className="flex items-center gap-3">
            <div
              className={cls(
                'flex h-10 w-10 items-center justify-center rounded-full transition-colors duration-300',
                publishPaused ? 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300' : 'bg-emerald-200 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-400'
              )}
            >
              {publishPaused ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </div>
            <div>
              <p className={cls('text-[13px] font-bold leading-tight', publishPaused ? 'text-slate-800 dark:text-slate-100' : 'text-emerald-800 dark:text-emerald-300')}>
                {publishPaused ? 'Publicar pausada' : 'Publicar ativa'}
              </p>
              <p className={cls('text-[11px] mt-0.5 leading-snug max-w-md', publishPaused ? 'text-slate-600 dark:text-slate-300' : 'text-emerald-700 dark:text-emerald-400')}>
                {publishPaused
                  ? 'A campanha sobe em PAUSED para revisão. Conjuntos e anúncios já ficam ATIVOS — basta ligar a campanha depois.'
                  : 'A campanha entra em leilão imediatamente. Conjuntos e anúncios também ATIVOS.'}
              </p>
            </div>
          </div>
          <Toggle checked={!publishPaused} onChange={(v) => setPublishPaused(!v)} />
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
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
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

        {/* PIXEL DE CONVERSÃO — também aparece em DPA porque Meta exige pixel+evento
            no promoted_object quando optimization_goal = OFFSITE_CONVERSIONS. */}
        <SubBlock
          label="Pixel de Conversão"
          hint={isDPA
            ? 'DPA otimiza por evento do pixel — selecione o pixel do site que captura compras.'
            : 'Rastreamento de Conversão'}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pixel">
              <SSSelect
                options={pixels.map(p => ({
                  value: p.id,
                  label: p.name + (p.last_fired_time ? '' : ' · sem disparos recentes'),
                  sublabel: p.id,
                }))}
                value={pixelId || null}
                onChange={v => setPixelId(v ?? '')}
                placeholder={pixels.length === 0 ? '— sem pixels nessa conta —' : '— selecione um pixel —'}
                disabled={pixels.length === 0}
              />
            </Field>
            <Field label="Evento de conversão">
              <select className={inputBase} value={customEvent} onChange={e => setCustomEvent(e.target.value as CustomEvent)}>
                {CUSTOM_EVENTS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
              </select>
            </Field>
            {!isDPA && (
              <Field label="Otimização de Entrega">
                <select className={inputBase} value={optGoal} onChange={e => setOptGoal(e.target.value as OptGoal)}>
                  {OPT_GOALS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
            )}
          </div>
        </SubBlock>

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
          <div className="border border-indigo-100 dark:border-indigo-800 bg-indigo-50/30 dark:bg-indigo-950/20 rounded-lg p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-[12px] font-bold text-gray-800 dark:text-gray-100">Público-Alvo</h3>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  {advantageAudience ? 'Advantage+ ativado: a I.A. do Meta otimizará seu público.' : 'Definição manual de público.'}
                </p>
              </div>
              <Toggle checked={advantageAudience} onChange={setAdvantageAudience} label="Advantage+" />
            </div>

            <Field label="Usar um público salvo">
              <SSSelect
                options={audiences.saved.map(a => ({
                  value: a.id,
                  label: a.name,
                  sublabel: a.id,
                }))}
                value={null}
                onChange={id => {
                  if (id && !includedAudiences.includes(id))
                    setIncludedAudiences([...includedAudiences, id]);
                }}
                placeholder="— selecione —"
                clearable={false}
              />
            </Field>

            {/* Controles */}
            <SubBlock label="Controles">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Localizações">
                  <SSSelect
                    options={COUNTRIES.map(c => ({ value: c.key, label: c.label }))}
                    value={country}
                    onChange={v => setCountry(v ?? 'BR')}
                    clearable={false}
                  />
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
                  <div className="grid grid-cols-3 gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-md">
                    {(['all', 'male', 'female'] as const).map(g => (
                      <button key={g} type="button" onClick={() => setGender(g)}
                        className={cls(
                          'text-[11px] font-semibold py-1.5 rounded transition-colors',
                          gender === g ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                        )}>
                        {g === 'all' ? 'Todos' : g === 'male' ? 'Masculino' : 'Feminino'}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Adicionar interesse ou comportamento">
                  <button type="button" disabled
                    className={cls(inputBase, 'flex items-center justify-between cursor-not-allowed')}>
                    <span className="text-gray-400 dark:text-gray-500">+ Adicionar interesse</span>
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

            <p className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-3">
              <span>📍 1 local</span><span>👥 {advantageAudience ? `${ageMin}+` : `${ageMin}–${ageMax}`}</span><span>{gender === 'all' ? '⚥ Todos' : gender === 'male' ? '♂ Masc' : '♀ Fem'}</span><span>🗣 {locales.length || '0'} idioma(s)</span>
            </p>
          </div>
        </SubBlock>

        {/* CONFIGURAÇÕES AVANÇADAS */}
        <SubBlock label="Configurações Avançadas do Conjunto">
          {/* Posicionamentos */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-[12px] font-bold text-gray-800 dark:text-gray-100">Posicionamentos</h4>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">Escolha onde seus anúncios serão exibidos</p>
              </div>
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800">
                {advantagePositioning ? 'Automático' : 'Manual'}
              </span>
            </div>

            <div className="rounded-md border border-indigo-100 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-950/30 px-3 py-2 flex items-center justify-between">
              <div>
                <p className="text-[12px] font-semibold text-gray-800 dark:text-gray-100">✦ Advantage+ Posicionamentos</p>
                <p className="text-[10px] text-gray-500 dark:text-gray-400">Meta otimiza automaticamente onde seus anúncios aparecem</p>
              </div>
              <Toggle checked={advantagePositioning} onChange={setAdvantagePositioning} />
            </div>

            {!advantagePositioning && (
              <div>
                <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Plataformas</p>
                <div className="flex gap-4 flex-wrap">
                  {(['facebook', 'instagram', 'audience_network', 'messenger'] as const).map(p => (
                    <label key={p} className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                      <input type="checkbox" checked={platforms[p]}
                        onChange={e => setPlatforms(prev => ({ ...prev, [p]: e.target.checked }))} />
                      {p === 'audience_network' ? 'Audience Network' : p[0].toUpperCase() + p.slice(1)}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Dispositivos</p>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                  <input type="checkbox" checked={devices.mobile}
                    onChange={e => setDevices(d => ({ ...d, mobile: e.target.checked }))} />
                  📱 Dispositivos Móveis
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                  <input type="checkbox" checked={devices.desktop}
                    onChange={e => setDevices(d => ({ ...d, desktop: e.target.checked }))} />
                  🖥 Desktop
                </label>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-[12px] font-semibold text-gray-800 dark:text-gray-100">Apenas Wi-Fi</p>
                <p className="text-[10px] text-gray-400 dark:text-gray-500">Exibir anúncios apenas quando conectado ao Wi-Fi</p>
              </div>
              <Toggle checked={wifiOnly} onChange={setWifiOnly} />
            </div>
          </div>

          {/* Agendamento */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex flex-col gap-3 mt-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-[12px] font-bold text-gray-800 dark:text-gray-100">Agendamento</h4>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">Defina quando seus anúncios começarão e terminarão de ser veiculados</p>
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
          <Field label="Páginas do Facebook *" hint="Selecione 1 ou mais páginas. Os anúncios serão distribuídos em round-robin entre elas (ou conforme alocação manual abaixo). Escopo: perfil (todas BMs).">
            <ChipPicker
              options={pages.map(p => {
                const avail = p.ad_limit == null
                  ? '∞'
                  : `${Math.max(0, (p.ad_limit ?? 0) - (p.ads_running ?? 0))} livres`;
                const igTag = p.instagram_business_account ? ' · IG' : '';
                return { value: p.id, label: `${p.name}${igTag} — ${avail}` };
              })}
              selected={pageIds}
              onChange={setPageIds}
              emptyText="Nenhuma página selecionada"
              addText="+ adicionar página"
              loading={loadingPages}
              noOptionsText="— nenhuma página acessível para este perfil —"
            />
          </Field>
          {pageIds.length > 0 && (() => {
            const selPages = pages.filter(p => pageIds.includes(p.id));
            const totalAds = ads.length * Math.max(1, campaignsPerCreative) * Math.max(1, adsetsPerCampaign) * Math.max(1, adsPerAdset);
            const allocated = pageIds.reduce((s, id) => s + (pageAllocations[id] ?? 0), 0);
            const autoCount = pageIds.filter(id => pageAllocations[id] === undefined).length;
            const remaining = Math.max(0, totalAds - allocated);
            const perAuto = autoCount > 0 ? Math.floor(remaining / autoCount) : 0;
            return (
              <div className="mt-2 border border-gray-200 dark:border-gray-700 rounded-md bg-gray-50/60 dark:bg-gray-800/60">
                <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
                  <div>
                    <p className="text-[12px] font-semibold text-gray-800 dark:text-gray-100">Criativos por página</p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">
                      Total de anúncios a criar: <span className="font-mono text-gray-700 dark:text-gray-300">{totalAds}</span>
                      {' · '}Alocados manualmente: <span className="font-mono text-gray-700 dark:text-gray-300">{allocated}</span>
                      {autoCount > 0 && <> · Auto (round-robin) p/ {autoCount} página{autoCount > 1 ? 's' : ''}: <span className="font-mono text-gray-700 dark:text-gray-300">{remaining}</span></>}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPageAllocations({})}
                    className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-semibold"
                  >
                    Resetar (tudo auto)
                  </button>
                </div>
                <div className="max-h-[220px] overflow-y-auto">
                  <table className="w-full text-[11px]">
                    <thead className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                      <tr>
                        <th className="text-left px-3 py-1.5 font-semibold">Página</th>
                        <th className="text-right px-3 py-1.5 font-semibold">Disponíveis</th>
                        <th className="text-right px-3 py-1.5 font-semibold w-[140px]">Criativos designados</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selPages.map(p => {
                        const avail = p.ad_limit == null
                          ? null
                          : Math.max(0, (p.ad_limit ?? 0) - (p.ads_running ?? 0));
                        const manual = pageAllocations[p.id];
                        const isAuto = manual === undefined;
                        const shown = isAuto ? perAuto : manual;
                        const over = avail != null && shown > avail;
                        // Teto absoluto desta página = totalAds - alocações manuais
                        // das OUTRAS páginas. Garante que a soma jamais ultrapassa
                        // o número real de anúncios a publicar.
                        const otherManual = allocated - (manual ?? 0);
                        const capByTotal = Math.max(0, totalAds - otherManual);
                        const maxAllowed = avail == null
                          ? capByTotal
                          : Math.min(capByTotal, avail);
                        return (
                          <tr key={p.id} className="border-t border-gray-200 dark:border-gray-700">
                            <td className="px-3 py-1.5 text-gray-800 dark:text-gray-100">
                              {p.name}
                              {p.instagram_business_account && <span className="ml-1 text-rose-500 dark:text-rose-400">· IG</span>}
                            </td>
                            <td className={cls('px-3 py-1.5 text-right font-mono', avail == null ? 'text-gray-400 dark:text-gray-500' : over ? 'text-rose-600 dark:text-rose-400' : 'text-gray-700 dark:text-gray-300')}>
                              {avail == null ? '∞' : avail}
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <input
                                  type="number"
                                  min={0}
                                  max={maxAllowed}
                                  value={isAuto ? '' : manual}
                                  placeholder={isAuto ? `auto (${perAuto})` : ''}
                                  title={`Máx. permitido: ${maxAllowed} (total a publicar: ${totalAds}${avail != null ? `, vagas livres: ${avail}` : ''})`}
                                  onChange={e => {
                                    const raw = e.target.value;
                                    setPageAllocations(prev => {
                                      const next = { ...prev };
                                      if (raw === '') {
                                        delete next[p.id];
                                      } else {
                                        const proposed = Math.max(0, Number(raw) || 0);
                                        next[p.id] = Math.min(proposed, maxAllowed);
                                      }
                                      return next;
                                    });
                                  }}
                                  className={cls('w-[70px] text-right border rounded-md px-1.5 py-0.5 text-[11px] font-mono',
                                    over ? 'border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-950/40' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900')}
                                />
                                {!isAuto && (
                                  <button
                                    type="button"
                                    title="Voltar para auto"
                                    onClick={() => setPageAllocations(prev => {
                                      const next = { ...prev }; delete next[p.id]; return next;
                                    })}
                                    className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-sm leading-none"
                                  >×</button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
          <div className="flex items-center justify-between mt-2">
            <div>
              <p className="text-[12px] font-semibold text-gray-800 dark:text-gray-100">Auto retry de página</p>
              <p className="text-[10px] text-gray-400 dark:text-gray-500">Se um anúncio falhar na página selecionada, o sistema tentará automaticamente em outra página disponível.</p>
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
                productSets={productSets}
                loadingProductSets={loadingProductSets}
                catalogId={catalogId}
                defaultPsid={productSetId}
              />
            ))}
            <button type="button" onClick={addAd}
              className="self-start text-[11px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-semibold">
              + Adicionar outro criativo
            </button>
          </div>
        </SubBlock>

        {/* CONFIGURAÇÕES AVANÇADAS DO ANÚNCIO */}
        <SubBlock label="Configurações Avançadas">
          {/* RASTREAMENTO — URL params */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex flex-col gap-3">
            <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Rastreamento</p>
            <Field label="Parâmetros de URL">
              <textarea className={cls(inputBase, 'font-mono min-h-[50px]')} value={urlTagsTpl}
                onChange={e => setUrlTagsTpl(e.target.value)}
                placeholder="utm_source=FB&utm_campaign={{campaign.id}}" />
            </Field>
            <p className="text-[10px] text-gray-500 dark:text-gray-400">
              Parâmetros adicionados à URL de destino. Variáveis suportadas (Facebook + DirectAds) são substituídas automaticamente; o restante é enviado como está.
            </p>
          </div>

          {/* ADVANTAGE+ CREATIVE */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex flex-col gap-3 mt-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-[12px] font-bold text-gray-800 dark:text-gray-100">✦ Advantage+ Creative</h4>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">Configurações de aprimoramentos automáticos de criativos para seus anúncios</p>
              </div>
            </div>
            <div className="rounded-md border border-indigo-100 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-950/30 px-3 py-2 flex items-center justify-between">
              <div>
                <p className="text-[12px] font-semibold text-gray-800 dark:text-gray-100">⚙ Todas as Otimizações</p>
                <p className="text-[10px] text-gray-500 dark:text-gray-400">Ativa todas as melhorias automáticas de IA</p>
              </div>
              <Toggle checked={adv.all} onChange={v => setAdv(prev => ({ ...prev, all: v }))} />
            </div>

            <details className="border border-gray-100 dark:border-gray-800 rounded-md">
              <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                <span className="text-gray-400 dark:text-gray-500">▸</span> Preview Avançado
                <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500">0/6</span>
              </summary>
              <div className="px-3 py-2 text-[10px] text-gray-400 dark:text-gray-500">Previews variantes do criativo após otimizações (carregado sob demanda).</div>
            </details>

            <div className="border border-gray-100 dark:border-gray-800 rounded-md">
              <div className="px-3 py-2 flex items-center justify-between border-b border-gray-100 dark:border-gray-800">
                <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">✨ Melhorias Essenciais</p>
                <span className="text-[10px] text-gray-400 dark:text-gray-500">
                  {[adv.site_extensions, adv.relevant_comments, adv.cta_optimization].filter(Boolean).length}/3
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 px-3 py-2">
                <div className="rounded-md border border-gray-100 dark:border-gray-800 px-2 py-1.5 flex items-center justify-between">
                  <span className="text-[11px] text-gray-700 dark:text-gray-300">🌐 Extensões do Site</span>
                  <Toggle checked={adv.all || adv.site_extensions} onChange={v => setAdv(prev => ({ ...prev, site_extensions: v }))} />
                </div>
                <div className="rounded-md border border-gray-100 dark:border-gray-800 px-2 py-1.5 flex items-center justify-between">
                  <span className="text-[11px] text-gray-700 dark:text-gray-300">💬 Comentários Relevantes</span>
                  <Toggle checked={adv.all || adv.relevant_comments} onChange={v => setAdv(prev => ({ ...prev, relevant_comments: v }))} />
                </div>
                <div className="rounded-md border border-gray-100 dark:border-gray-800 px-2 py-1.5 flex items-center justify-between col-span-2">
                  <span className="text-[11px] text-gray-700 dark:text-gray-300">📝 Melhorar CTA</span>
                  <Toggle checked={adv.all || adv.cta_optimization} onChange={v => setAdv(prev => ({ ...prev, cta_optimization: v }))} />
                </div>
              </div>
            </div>

            <p className="text-[10px] text-gray-500 dark:text-gray-400">
              <span className="font-semibold">Recomendação:</span> Mantenha tudo desativado para controle total dos criativos.
            </p>
          </div>

          {/* MULTI-ADVERTISER ADS */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex items-center justify-between mt-3">
            <div>
              <h4 className="text-[12px] font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                Multi-Advertiser Ads
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700">Opcional</span>
              </h4>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">Permite que seu anúncio apareça ao lado de anúncios de outras marcas em carrosséis personalizados.</p>
            </div>
            <Toggle checked={multiAdvertiser} onChange={setMultiAdvertiser} />
          </div>
        </SubBlock>
      </MainSection>

      {/* ───────── 4. Publicar ───────── */}
      <MainSection title="Publicar" subtitle={publishPaused ? 'Campanha sobe PAUSED (conjuntos e ads ATIVOS) — revise no Ads Manager.' : 'Campanha ATIVA — vai entrar em leilão imediatamente.'}>
        {errors.length > 0 && (
          <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg p-3">
            <p className="text-xs font-bold text-rose-700 dark:text-rose-400 mb-1">Corrija antes de publicar:</p>
            <ul className="text-[11px] text-rose-700 dark:text-rose-400 list-disc list-inside space-y-0.5">
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

        {/* Enqueue error (e.g. HTTP error, missing jobs in response, partial token failures) */}
        {enqueueError && (
          <div className="mt-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg p-3">
            <p className="text-xs font-bold text-rose-800 dark:text-rose-400">Erro ao enfileirar</p>
            <p className="text-[11px] text-rose-700 dark:text-rose-400 mt-1">{enqueueError}</p>
          </div>
        )}

        {/* Queue widget — shown after a successful enqueue; polls job progress */}
        {showQueueWidget && queueRows.length > 0 && (
          <div className="mt-3">
            <QueueWidget
              jobs={queueRows}
              onClose={() => setShowQueueWidget(false)}
            />
          </div>
        )}


      </MainSection>

      <CampaignNameModal
        open={showNameModal}
        onClose={() => setShowNameModal(false)}
        onApply={(n) => setCampaignName(n)}
        vars={{
          conta: (() => { const a = accounts.find(x => x.account_id === accountId); return (a?.nickname || a?.account_name) ?? ''; })(),
          orcamento: campaignType,
          estrutura: `${campaignsPerCreative}-${adsetsPerCampaign}-${adsPerAdset}`,
          criativo: useCatalog
            ? (setName.trim() || ads[0]?.name || '')
            : (ads[0]?.name || ''),
          data: (() => {
            const d = new Date(startTime);
            if (isNaN(d.getTime())) return '';
            return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
          })(),
        }}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Editor de um criativo
// ────────────────────────────────────────────────────────────────────────────

function AdEditor({
  index, ad, isDPA, canRemove, onChange, onRemove, uploadFor,
  productSets, loadingProductSets, catalogId, defaultPsid,
}: {
  index: number;
  ad: AdDraft;
  isDPA: boolean;
  canRemove: boolean;
  onChange: (patch: Partial<AdDraft>) => void;
  onRemove: () => void;
  uploadFor: (file: File) => Promise<UploadResult | null>;
  productSets: ProductSet[];
  loadingProductSets: boolean;
  catalogId: string;
  defaultPsid: string;
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
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50/50 dark:bg-gray-800/50">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Criativo #{index + 1}</span>
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
          {isDPA && <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800">DPA</span>}
        </div>
        {canRemove && (
          <button type="button" onClick={onRemove}
            className="text-[11px] text-rose-500 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 font-semibold">Remover</button>
        )}
      </div>

      {/* CONTEÚDO DO ANÚNCIO */}
      <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Textos do Anúncio</p>
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
          <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 mt-4">Link e Ação</p>
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
                  className="text-xs px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 disabled:opacity-50"
                  disabled={uploading}>
                  {uploading
                    ? (ad.media_kind === 'video' ? 'Enviando vídeo…' : 'Enviando…')
                    : (ad.video_id || ad.image_hash ? 'Trocar mídia' : 'Fazer upload')}
                </button>
                {ad.media_kind === 'video' && ad.video_thumbnail_url ? (
                  <img src={ad.video_thumbnail_url} alt="thumbnail" className="h-12 w-12 object-cover rounded border border-gray-200 dark:border-gray-700" />
                ) : ad.image_preview && (
                  ad.media_kind === 'video'
                    ? <video src={ad.image_preview} className="h-12 w-12 object-cover rounded border border-gray-200 dark:border-gray-700" muted />
                    : <img src={ad.image_preview} alt="" className="h-12 w-12 object-cover rounded border border-gray-200 dark:border-gray-700" />
                )}
                {ad.media_kind === 'video' && ad.video_id && (
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">vid {ad.video_id.slice(0, 12)}…</span>
                )}
                {ad.media_kind === 'image' && ad.image_hash && (
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">{ad.image_hash.slice(0, 12)}…</span>
                )}
                {ad.media_kind === 'video' && (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400 border border-violet-200 dark:border-violet-800">vídeo</span>
                )}
              </div>
            </Field>
          </div>
        </>
      )}

      {(!isDPA && ad.type === 'carousel') && (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-gray-500 dark:text-gray-400">{ad.child_attachments.length}/10 cards · CTA aplicado a todos os cards</p>
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
              className="self-start text-[11px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-semibold">
              + Adicionar card
            </button>
          )}
        </div>
      )}

      {isDPA && (
        <>
          <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 mt-4">Link e Ação (DPA)</p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
            DPA usa <code className="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 px-1 rounded">{'{{product.url}}'}</code>, <code className="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 px-1 rounded">{'{{product.name}}'}</code>, etc. — não precisa subir imagem (vem do catálogo).
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
            <Field
              label="Conjunto de Produtos"
              hint={
                defaultPsid
                  ? 'Vazio = usa o fallback definido na config de catálogo.'
                  : 'Cada criativo precisa do seu (sem fallback definido).'
              }
            >
              <SSSelect
                options={productSets.map(s => ({
                  value: s.id,
                  label: s.name,
                  sublabel: s.product_count !== undefined ? `${s.product_count} produtos` : s.id,
                }))}
                value={ad.product_set_id || null}
                onChange={v => onChange({ product_set_id: v ?? '' })}
                placeholder={loadingProductSets ? 'Carregando…' : (defaultPsid ? '— usar fallback global —' : '— selecione um conjunto —')}
                disabled={!catalogId || loadingProductSets}
                clearable={!!defaultPsid}
              />
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
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-900 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Card #{index + 1}</span>
        {canRemove && (
          <button type="button" onClick={onRemove} className="text-[10px] text-rose-500 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 font-semibold">Remover</button>
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
          className="text-[11px] px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
          {uploading ? 'Enviando…' : card.image_hash ? 'Trocar' : 'Imagem'}
        </button>
        {card.image_preview && <img src={card.image_preview} alt="" className="h-10 w-10 object-cover rounded border border-gray-200 dark:border-gray-700" />}
      </div>
    </div>
  );
}
