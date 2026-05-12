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
  // single
  link: string;
  message: string;
  headline: string;
  description: string;
  image_hash: string;
  image_preview?: string;
  cta_type: CTA;
  cta_link: string;
  // carousel
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
    name: 'Anúncio 1',
    type: 'single',
    link: '',
    message: '',
    headline: '',
    description: '',
    image_hash: '',
    cta_type: 'SHOP_NOW',
    cta_link: '',
    child_attachments: [],
  };
}

function emptyChild(): ChildCard {
  return { id: makeId(), link: '', headline: '', description: '', image_hash: '', cta_link: '' };
}

function Section({ title, hint, children, step }: { title: string; hint?: string; step: number; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
      <header className="mb-4 flex items-baseline gap-3">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-600 text-white text-[11px] font-bold">{step}</span>
        <div>
          <h2 className="text-sm font-bold text-gray-800">{title}</h2>
          {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
        </div>
      </header>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
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
  // ── Lista de perfis: todos os perfis configurados em /api-config ──
  const availableProfiles = profileNames;

  // Conta quantas contas cada perfil tem (pra mostrar no dropdown)
  const accountsByProfile = useMemo(() => {
    const map = new Map<string, number>();
    accounts.forEach(a => {
      if (!a.profile_name) return;
      map.set(a.profile_name, (map.get(a.profile_name) ?? 0) + 1);
    });
    return map;
  }, [accounts]);

  // ── Seleção do perfil ──
  const [profileName, setProfileName] = useState<string>(availableProfiles[0] ?? '');

  // ── Sync de contas (puxa do banco + Meta e atualiza accessible_profiles) ──
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

  // ── Contas filtradas pelo perfil ──
  const accountsForProfile = useMemo(
    () => accounts.filter(a => !profileName || a.profile_name === profileName),
    [accounts, profileName]
  );

  // 1. Conta + listas dependentes
  const [accountId, setAccountId] = useState(accountsForProfile[0]?.account_id ?? '');
  // Quando o perfil muda, reseta a conta para a primeira do novo perfil
  useEffect(() => {
    if (!accountsForProfile.find(a => a.account_id === accountId)) {
      setAccountId(accountsForProfile[0]?.account_id ?? '');
    }
  }, [profileName, accountsForProfile, accountId]);

  const account = accounts.find(a => a.account_id === accountId);

  const [pixels, setPixels] = useState<Pixel[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [audiences, setAudiences] = useState<{ custom: Audience[]; saved: Audience[] }>({ custom: [], saved: [] });
  const [loadingDeps, setLoadingDeps] = useState(false);
  const [depsError, setDepsError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) return;
    const qs = `account_id=${encodeURIComponent(accountId)}${profileName ? `&profile_name=${encodeURIComponent(profileName)}` : ''}`;
    setLoadingDeps(true); setDepsError(null);
    Promise.all([
      fetch(`/api/campaigns/pixels?${qs}`).then(r => r.json()),
      fetch(`/api/campaigns/pages?${qs}`).then(r => r.json()),
      fetch(`/api/campaigns/audiences?${qs}`).then(r => r.json()),
    ]).then(([p, pg, au]) => {
      if (p.error) setDepsError(p.error);
      setPixels(p.pixels ?? []);
      setPages(pg.pages ?? []);
      setAudiences({ custom: au.custom ?? [], saved: au.saved ?? [] });
    }).catch(e => setDepsError(e?.message ?? String(e)))
      .finally(() => setLoadingDeps(false));
  }, [accountId, profileName]);

  // 2. Campanha
  const [campaignName, setCampaignName] = useState('Conversão Website — ' + new Date().toISOString().slice(0, 10));
  const [specialCategory, setSpecialCategory] = useState<'NONE' | 'EMPLOYMENT' | 'HOUSING' | 'CREDIT' | 'FINANCIAL_PRODUCTS_SERVICES'>('NONE');

  // 3. Ad set
  const [pixelId, setPixelId] = useState('');
  const [customEvent, setCustomEvent] = useState<CustomEvent>('PURCHASE');
  const [optGoal, setOptGoal] = useState<OptGoal>('OFFSITE_CONVERSIONS');
  const [dailyBudget, setDailyBudget] = useState(50); // valor em moeda
  const [bidCap, setBidCap] = useState<number | ''>('');
  const [bidStrategy, setBidStrategy] = useState<'LOWEST_COST_WITHOUT_CAP' | 'COST_CAP'>('LOWEST_COST_WITHOUT_CAP');
  const [country, setCountry] = useState('BR');
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(65);
  const [gender, setGender] = useState<'all' | 'male' | 'female'>('all');
  const [includedAudiences, setIncludedAudiences] = useState<string[]>([]);
  const [excludedAudiences, setExcludedAudiences] = useState<string[]>([]);
  const [platforms, setPlatforms] = useState<{ facebook: boolean; instagram: boolean; audience_network: boolean; messenger: boolean }>({
    facebook: true, instagram: true, audience_network: false, messenger: false,
  });
  const [startTime, setStartTime] = useState(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000); // 1h no futuro
    return d.toISOString().slice(0, 16);
  });
  const [endTime, setEndTime] = useState('');

  // 4. Page (creative)
  const [pageId, setPageId] = useState('');
  const selectedPage = pages.find(p => p.id === pageId);
  useEffect(() => { if (!pageId && pages[0]) setPageId(pages[0].id); }, [pages, pageId]);
  useEffect(() => { if (!pixelId && pixels[0]) setPixelId(pixels[0].id); }, [pixels, pixelId]);

  // 5. Anúncios
  const [ads, setAds] = useState<AdDraft[]>([emptyAd()]);

  const updateAd = (id: string, patch: Partial<AdDraft>) =>
    setAds(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));

  const addAd = () => setAds(prev => [...prev, { ...emptyAd(), name: `Anúncio ${prev.length + 1}` }]);
  const removeAd = (id: string) => setAds(prev => prev.length === 1 ? prev : prev.filter(a => a.id !== id));

  // Upload de imagem para um ad
  const uploadFor = async (file: File): Promise<{ hash: string; preview: string } | null> => {
    const fd = new FormData();
    fd.append('account_id', accountId);
    if (profileName) fd.append('profile_name', profileName);
    fd.append('file', file);
    const res = await fetch('/api/campaigns/image', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) { alert('Erro no upload: ' + (data?.error ?? res.statusText)); return null; }
    return { hash: data.hash, preview: URL.createObjectURL(file) };
  };

  // 6. Status / publish
  const [publishActive, setPublishActive] = useState(false);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<any[]>([]);
  const [doneInfo, setDoneInfo] = useState<{ campaign_id: string; adset_id: string; ad_ids: string[] } | null>(null);
  const [errorInfo, setErrorInfo] = useState<{ step?: string; error?: string; campaign_id?: string; adset_id?: string } | null>(null);

  // ── Validação ──────────────────────────────────────────────────────────────
  const errors: string[] = [];
  if (!profileName) errors.push('Selecione um perfil Meta.');
  if (!accountId) errors.push('Selecione uma conta.');
  if (!campaignName.trim()) errors.push('Nome da campanha é obrigatório.');
  if (!pixelId) errors.push('Selecione um pixel.');
  if (!pageId) errors.push('Selecione uma Página do Facebook.');
  if (dailyBudget < 1) errors.push('Orçamento diário inválido.');
  if (ageMin < 13 || ageMax > 65 || ageMin > ageMax) errors.push('Faixa etária inválida (13–65).');
  if (!Object.values(platforms).some(Boolean)) errors.push('Escolha ao menos uma plataforma.');
  if (ads.length === 0) errors.push('Adicione ao menos um anúncio.');
  ads.forEach((a, i) => {
    if (!a.name.trim()) errors.push(`Anúncio ${i + 1}: nome obrigatório.`);
    if (a.type === 'single') {
      if (!a.link.trim())       errors.push(`Anúncio ${i + 1}: link obrigatório.`);
      if (!a.image_hash)        errors.push(`Anúncio ${i + 1}: faça upload da imagem.`);
      if (!a.message.trim())    errors.push(`Anúncio ${i + 1}: texto principal obrigatório.`);
    } else {
      if (a.child_attachments.length < 2) errors.push(`Anúncio ${i + 1}: carrossel exige 2+ cards.`);
      a.child_attachments.forEach((c, j) => {
        if (!c.link.trim())  errors.push(`Anúncio ${i + 1}, card ${j + 1}: link obrigatório.`);
        if (!c.image_hash)   errors.push(`Anúncio ${i + 1}, card ${j + 1}: imagem obrigatória.`);
      });
    }
  });

  const canSubmit = errors.length === 0 && !running;

  // ── Submit ─────────────────────────────────────────────────────────────────
  const submit = async (active: boolean) => {
    setRunning(true);
    setEvents([]);
    setDoneInfo(null);
    setErrorInfo(null);

    const status = active ? 'ACTIVE' : 'PAUSED';

    const targeting: any = {
      geo_locations: { countries: [country] },
      age_min: ageMin,
      age_max: ageMax,
      publisher_platforms: Object.entries(platforms).filter(([, v]) => v).map(([k]) => k),
    };
    if (gender !== 'all') targeting.genders = [gender === 'male' ? 1 : 2];
    if (includedAudiences.length) targeting.custom_audiences = includedAudiences.map(id => ({ id }));
    if (excludedAudiences.length) targeting.excluded_custom_audiences = excludedAudiences.map(id => ({ id }));

    // Garantir publisher coerente (se IG selecionado mas FB não, manter mesmo assim)

    const moeda = account?.moeda ?? 'BRL';
    const cents = Math.round(dailyBudget * 100);

    const adset: any = {
      name: campaignName + ' — Conjunto 1',
      optimization_goal: optGoal,
      billing_event: optGoal === 'LINK_CLICKS' ? 'LINK_CLICKS' : 'IMPRESSIONS',
      bid_strategy: bidStrategy,
      daily_budget_cents: cents,
      promoted_object: { pixel_id: pixelId, custom_event_type: customEvent },
      targeting,
      destination_type: 'WEBSITE',
      start_time: new Date(startTime).toISOString(),
      end_time: endTime ? new Date(endTime).toISOString() : undefined,
      status,
    };
    if (bidStrategy === 'COST_CAP' && bidCap !== '') {
      adset.bid_amount_cents = Math.round(Number(bidCap) * 100);
    }

    const adsPayload = ads.map(a => ({
      name: a.name,
      creative: a.type === 'single'
        ? {
            name: a.name + ' — Creative',
            page_id: pageId,
            instagram_actor_id: selectedPage?.instagram_business_account?.id,
            type: 'single',
            link: a.link,
            message: a.message,
            headline: a.headline,
            description: a.description,
            image_hash: a.image_hash,
            cta_type: a.cta_type,
            cta_link: a.cta_link || a.link,
          }
        : {
            name: a.name + ' — Creative',
            page_id: pageId,
            instagram_actor_id: selectedPage?.instagram_business_account?.id,
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
          },
    }));

    const payload: any = {
      account_id: accountId,
      profile_name: profileName || undefined,
      campaign: {
        name: campaignName,
        objective: 'OUTCOME_SALES',
        status,
        special_ad_categories: specialCategory === 'NONE' ? [] : [specialCategory],
        buying_type: 'AUCTION',
      },
      adset,
      ads: adsPayload,
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
      await readNdjson(res, (e) => {
        setEvents(prev => [...prev, e]);
        if (e.type === 'done')  setDoneInfo({ campaign_id: e.campaign_id, adset_id: e.adset_id, ad_ids: e.ad_ids });
        if (e.type === 'error') setErrorInfo({ step: e.step, error: e.error, campaign_id: e.campaign_id, adset_id: e.adset_id });
      });
    } catch (e: any) {
      setErrorInfo({ error: e?.message ?? String(e) });
    } finally {
      setRunning(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const moedaSym = useMemo(() => {
    const m = account?.moeda ?? 'BRL';
    if (m === 'BRL') return 'R$';
    if (m === 'USD') return '$';
    if (m === 'EUR') return '€';
    return m + ' ';
  }, [account]);

  const audienceOptions = useMemo(() => {
    const items = [
      ...audiences.custom.map(a => ({ ...a, group: 'Custom' })),
      ...audiences.saved.map(a => ({ ...a, group: 'Saved' })),
    ];
    return items;
  }, [audiences]);

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
        Nenhum perfil Meta configurado em <a href="/api-config" className="underline font-semibold">Configurações</a>, ou os tokens não batem com as contas selecionadas. Verifique se o token de cada perfil em <code>/api-config</code> é o mesmo que sincronizou as contas em <code>/settings</code>.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">

      {/* ───────── 0. Perfil (token) ───────── */}
      <Section step={0} title="Perfil / token Meta" hint="Define qual token será usado pra ler contas, pixels, páginas, públicos e publicar.">
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
            <button
              type="button"
              onClick={handleSyncAccounts}
              disabled={syncing}
              title="Re-escaneia BMs/contas de todos os perfis e atualiza accessible_profiles no banco."
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors shrink-0"
            >
              <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Sincronizando…' : 'Sincronizar contas'}
            </button>
          </div>
        </div>
        {syncing && syncMsg && (
          <p className="text-[11px] text-gray-400">{syncMsg}</p>
        )}
        {syncError && (
          <p className="text-[11px] text-rose-600">Erro ao sincronizar: {syncError}</p>
        )}
      </Section>

      {/* ───────── 1. Conta ───────── */}
      <Section step={1} title="Conta de anúncios" hint="Mostra todas as contas do perfil que não estão desabilitadas/fechadas.">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Conta">
            <select className={inputBase} value={accountId} onChange={e => setAccountId(e.target.value)} disabled={accountsForProfile.length === 0}>
              {accountsForProfile.length === 0 && <option value="">— nenhuma conta deste perfil —</option>}
              {accountsForProfile.map(a => (
                <option key={a.account_id} value={a.account_id}>
                  {a.bm_name} — {a.account_name} ({a.account_id}){a.account_status && a.account_status !== 'ACTIVE' ? ` · ${a.account_status}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-end gap-3 text-[11px] text-gray-500">
            {account && (
              <>
                <span>Moeda: <strong className="text-gray-700">{account.moeda ?? 'BRL'}</strong></span>
                <span>Fuso: <strong className="text-gray-700">{account.timezone ?? '—'}</strong></span>
              </>
            )}
          </div>
        </div>
        {loadingDeps && <p className="text-[11px] text-gray-400">Carregando pixels, páginas e públicos…</p>}
        {depsError && <p className="text-[11px] text-rose-600">{depsError}</p>}
      </Section>

      {/* ───────── 2. Campanha ───────── */}
      <Section step={2} title="Campanha" hint="Objetivo fixo: Conversões de website (OUTCOME_SALES).">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nome da campanha">
            <input className={inputBase} value={campaignName} onChange={e => setCampaignName(e.target.value)} />
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
      </Section>

      {/* ───────── 3. Conjunto de anúncios ───────── */}
      <Section step={3} title="Conjunto de anúncios" hint="Pixel, evento, orçamento, segmentação e plataformas.">
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
          <Field label="Otimização de entrega">
            <select className={inputBase} value={optGoal} onChange={e => setOptGoal(e.target.value as OptGoal)}>
              {OPT_GOALS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Estratégia de lance">
            <select className={inputBase} value={bidStrategy} onChange={e => setBidStrategy(e.target.value as any)}>
              <option value="LOWEST_COST_WITHOUT_CAP">Menor custo (auto)</option>
              <option value="COST_CAP">Custo-alvo (cost cap)</option>
            </select>
          </Field>
          <Field label={`Orçamento diário (${moedaSym})`}>
            <input type="number" min={1} step={1} className={inputBase}
              value={dailyBudget} onChange={e => setDailyBudget(Number(e.target.value))} />
          </Field>
          {bidStrategy === 'COST_CAP' && (
            <Field label={`Custo-alvo por evento (${moedaSym})`}>
              <input type="number" min={0.01} step={0.01} className={inputBase}
                value={bidCap} onChange={e => setBidCap(e.target.value === '' ? '' : Number(e.target.value))} />
            </Field>
          )}
        </div>

        {/* Targeting */}
        <div className="border-t border-gray-100 pt-4 mt-2">
          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">Segmentação</p>
          <div className="grid grid-cols-4 gap-3">
            <Field label="País">
              <select className={inputBase} value={country} onChange={e => setCountry(e.target.value)}>
                {COUNTRIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Idade mínima">
              <input type="number" min={13} max={65} className={inputBase}
                value={ageMin} onChange={e => setAgeMin(Number(e.target.value))} />
            </Field>
            <Field label="Idade máxima">
              <input type="number" min={13} max={65} className={inputBase}
                value={ageMax} onChange={e => setAgeMax(Number(e.target.value))} />
            </Field>
            <Field label="Gênero">
              <select className={inputBase} value={gender} onChange={e => setGender(e.target.value as any)}>
                <option value="all">Todos</option>
                <option value="male">Masculino</option>
                <option value="female">Feminino</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Field label="Públicos incluídos" hint="Custom audiences + saved audiences. Ctrl/Cmd para múltiplos.">
              <select multiple className={cls(inputBase, 'h-24')} value={includedAudiences}
                onChange={e => setIncludedAudiences(Array.from(e.target.selectedOptions).map(o => o.value))}>
                {audienceOptions.map(a => (
                  <option key={a.id} value={a.id}>[{a.subtype}] {a.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Públicos excluídos">
              <select multiple className={cls(inputBase, 'h-24')} value={excludedAudiences}
                onChange={e => setExcludedAudiences(Array.from(e.target.selectedOptions).map(o => o.value))}>
                {audiences.custom.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
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
        </div>

        {/* Plataformas */}
        <div className="border-t border-gray-100 pt-4 mt-2">
          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">Posicionamentos</p>
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

        {/* Agendamento */}
        <div className="border-t border-gray-100 pt-4 mt-2">
          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">Agendamento</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Início">
              <input type="datetime-local" className={inputBase} value={startTime} onChange={e => setStartTime(e.target.value)} />
            </Field>
            <Field label="Fim (opcional)">
              <input type="datetime-local" className={inputBase} value={endTime} onChange={e => setEndTime(e.target.value)} />
            </Field>
          </div>
        </div>
      </Section>

      {/* ───────── 4. Página + Anúncios ───────── */}
      <Section step={4} title="Anúncios" hint="Selecione a Página do Facebook e crie um ou mais anúncios (single ou carrossel).">
        <Field label="Página do Facebook">
          <select className={inputBase} value={pageId} onChange={e => setPageId(e.target.value)} disabled={pages.length === 0}>
            {pages.length === 0 && <option value="">— sem páginas associadas —</option>}
            {pages.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} {p.instagram_business_account ? '· IG vinculado' : ''}
              </option>
            ))}
          </select>
        </Field>

        <div className="flex flex-col gap-3 mt-2">
          {ads.map((a, i) => (
            <AdEditor
              key={a.id}
              index={i}
              ad={a}
              canRemove={ads.length > 1}
              onChange={(patch) => updateAd(a.id, patch)}
              onRemove={() => removeAd(a.id)}
              uploadFor={uploadFor}
            />
          ))}
          <button type="button" onClick={addAd}
            className="self-start text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold">
            + Adicionar outro anúncio
          </button>
        </div>
      </Section>

      {/* ───────── 5. Publicar ───────── */}
      <Section step={5} title="Publicar" hint="Por padrão publica em PAUSED para você revisar no Ads Manager. Use 'Publicar ativo' para subir já rodando.">
        {errors.length > 0 && (
          <div className="bg-rose-50 border border-rose-200 rounded-lg p-3">
            <p className="text-xs font-bold text-rose-700 mb-1">Corrija antes de publicar:</p>
            <ul className="text-[11px] text-rose-700 list-disc list-inside space-y-0.5">
              {errors.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}
              {errors.length > 8 && <li>+ {errors.length - 8} outros…</li>}
            </ul>
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={() => submit(false)} disabled={!canSubmit}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-gray-700 text-white hover:bg-gray-800 disabled:opacity-50">
            {running && !publishActive ? 'Criando…' : 'Publicar pausado'}
          </button>
          <button type="button" onClick={() => { setPublishActive(true); submit(true); }} disabled={!canSubmit}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
            {running && publishActive ? 'Publicando ativo…' : 'Publicar ativo agora'}
          </button>
        </div>

        {/* Stream log */}
        {(events.length > 0 || doneInfo || errorInfo) && (
          <div className="mt-3 border border-gray-100 rounded-lg overflow-hidden">
            <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider px-4 py-2 bg-gray-50 border-b border-gray-100">
              Progresso
            </div>
            <div className="bg-gray-900 text-gray-100 font-mono text-[11px] leading-relaxed px-3 py-2 max-h-64 overflow-y-auto">
              {events.map((e, i) => (
                <EventLine key={i} e={e} />
              ))}
            </div>
          </div>
        )}

        {doneInfo && (
          <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-lg p-4">
            <p className="text-xs font-bold text-emerald-800">✓ Campanha criada com sucesso</p>
            <p className="text-[11px] text-emerald-700 mt-1">
              Campaign ID: <code>{doneInfo.campaign_id}</code> · AdSet ID: <code>{doneInfo.adset_id}</code> · {doneInfo.ad_ids.length} anúncio(s)
            </p>
            <a
              href={`https://business.facebook.com/adsmanager/manage/campaigns?act=${accountId.replace('act_', '')}&selected_campaign_ids=${doneInfo.campaign_id}`}
              target="_blank" rel="noopener noreferrer"
              className="inline-block mt-2 text-[11px] text-emerald-700 underline font-semibold"
            >
              Abrir no Ads Manager →
            </a>
          </div>
        )}

        {errorInfo && (
          <div className="mt-3 bg-rose-50 border border-rose-200 rounded-lg p-4">
            <p className="text-xs font-bold text-rose-800">✗ Erro {errorInfo.step ? `em ${errorInfo.step}` : ''}</p>
            <p className="text-[11px] text-rose-700 mt-1">{errorInfo.error}</p>
            {(errorInfo.campaign_id || errorInfo.adset_id) && (
              <p className="text-[11px] text-rose-700 mt-1">
                Parcial: {errorInfo.campaign_id && <>campaign {errorInfo.campaign_id}</>}
                {errorInfo.adset_id && <> · adset {errorInfo.adset_id}</>}
                . Reveja no Ads Manager — esses ficaram criados.
              </p>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Editor de um anúncio
// ────────────────────────────────────────────────────────────────────────────

function AdEditor({
  index, ad, canRemove, onChange, onRemove, uploadFor,
}: {
  index: number;
  ad: AdDraft;
  canRemove: boolean;
  onChange: (patch: Partial<AdDraft>) => void;
  onRemove: () => void;
  uploadFor: (file: File) => Promise<{ hash: string; preview: string } | null>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleSingleUpload = async (file: File) => {
    setUploading(true);
    const r = await uploadFor(file);
    setUploading(false);
    if (r) onChange({ image_hash: r.hash, image_preview: r.preview });
  };

  const updateChild = (cid: string, patch: Partial<ChildCard>) =>
    onChange({ child_attachments: ad.child_attachments.map(c => c.id === cid ? { ...c, ...patch } : c) });

  const addChild = () => onChange({ child_attachments: [...ad.child_attachments, emptyChild()] });
  const removeChild = (cid: string) =>
    onChange({ child_attachments: ad.child_attachments.filter(c => c.id !== cid) });

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-gray-50/50">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Anúncio #{index + 1}</span>
          <input className={cls(inputBase, 'min-w-[200px]')} value={ad.name}
            onChange={e => onChange({ name: e.target.value })} placeholder="Nome do anúncio" />
          <select className={inputBase} value={ad.type}
            onChange={e => onChange({ type: e.target.value as 'single' | 'carousel',
              child_attachments: e.target.value === 'carousel' && ad.child_attachments.length === 0
                ? [emptyChild(), emptyChild()] : ad.child_attachments })}>
            <option value="single">Imagem única</option>
            <option value="carousel">Carrossel</option>
          </select>
        </div>
        {canRemove && (
          <button type="button" onClick={onRemove}
            className="text-[11px] text-rose-500 hover:text-rose-700 font-semibold">Remover</button>
        )}
      </div>

      <Field label="Texto principal (message)">
        <textarea className={cls(inputBase, 'min-h-[60px]')} value={ad.message}
          onChange={e => onChange({ message: e.target.value })}
          placeholder="O texto que aparece acima da imagem" />
      </Field>

      {ad.type === 'single' ? (
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label="URL de destino (link)">
            <input className={inputBase} value={ad.link}
              onChange={e => onChange({ link: e.target.value })} placeholder="https://seu-site.com/produto" />
          </Field>
          <Field label="CTA">
            <select className={inputBase} value={ad.cta_type}
              onChange={e => onChange({ cta_type: e.target.value as CTA })}>
              {CTA_OPTIONS.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
            </select>
          </Field>
          <Field label="Headline (name)">
            <input className={inputBase} value={ad.headline}
              onChange={e => onChange({ headline: e.target.value })} />
          </Field>
          <Field label="Descrição">
            <input className={inputBase} value={ad.description}
              onChange={e => onChange({ description: e.target.value })} />
          </Field>
          <Field label="Imagem" hint="JPG/PNG, idealmente 1200×628 (1.91:1) ou 1080×1080 (1:1)">
            <div className="flex items-center gap-3">
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleSingleUpload(f); }} />
              <button type="button" onClick={() => fileRef.current?.click()}
                className="text-xs px-3 py-2 rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50"
                disabled={uploading}>
                {uploading ? 'Enviando…' : ad.image_hash ? 'Trocar imagem' : 'Fazer upload'}
              </button>
              {ad.image_preview && (
                <img src={ad.image_preview} alt="" className="h-12 w-12 object-cover rounded border border-gray-200" />
              )}
              {ad.image_hash && <span className="text-[10px] text-gray-400 font-mono">{ad.image_hash.slice(0, 12)}…</span>}
            </div>
          </Field>
          <Field label="URL de destino do CTA (opcional)" hint="Se vazio, usa o link principal">
            <input className={inputBase} value={ad.cta_link}
              onChange={e => onChange({ cta_link: e.target.value })} placeholder="https://seu-site.com/checkout" />
          </Field>
        </div>
      ) : (
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
  uploadFor: (file: File) => Promise<{ hash: string; preview: string } | null>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (file: File) => {
    setUploading(true);
    const r = await uploadFor(file);
    setUploading(false);
    if (r) onChange({ image_hash: r.hash, image_preview: r.preview });
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
    case 'adset_created':    txt = `✓ Conjunto criado (${e.id})`; color = 'text-emerald-300'; break;
    case 'ad_progress':      txt = `→ Anúncio ${e.index}/${e.total}: ${e.message}`; color = 'text-indigo-300'; break;
    case 'creative_created': txt = `  ✓ Creative ${e.index} criado (${e.id})`; color = 'text-emerald-300'; break;
    case 'ad_created':       txt = `  ✓ Anúncio ${e.index} criado (${e.id})`; color = 'text-emerald-300'; break;
    case 'done':             txt = `✓✓ Concluído. ${e.ad_ids?.length} ad(s) publicados.`; color = 'text-emerald-400'; break;
    case 'error':            txt = `✗ Erro em ${e.step ?? '?'}: ${e.error}` + (e.fbCode ? ` (FB code ${e.fbCode})` : ''); color = 'text-rose-400'; break;
    default:                 txt = JSON.stringify(e);
  }
  return <div className={color}>{txt}</div>;
}
