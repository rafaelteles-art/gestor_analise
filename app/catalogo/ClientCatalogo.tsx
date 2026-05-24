'use client';

import React, { useEffect, useMemo, useState } from 'react';

interface CatalogEntry {
  id: string;
  name: string;
  product_count: number | null;
  vertical: string | null;
  relationship: 'owned' | 'client';
}

interface BMWithCatalogs {
  bm_id: string;
  bm_name: string;
  accessible_profiles: string[];
  catalogs: CatalogEntry[];
}

type Availability = 'in stock' | 'out of stock' | 'preorder' | 'available for order' | 'discontinued';
type Condition = 'new' | 'refurbished' | 'used';

interface ProductPresetConfig {
  description: string;
  link: string;
  image_url: string;
  price: string;
  currency: string;
  brand: string;
  availability: Availability;
  condition: Condition;
}

interface SavedPreset {
  id: number;
  name: string;
  config: ProductPresetConfig;
}

const EMPTY_PRESET: ProductPresetConfig = {
  description: '',
  link: '',
  image_url: '',
  price: '',
  currency: 'BRL',
  brand: '',
  availability: 'in stock',
  condition: 'new',
};

const AVAILABILITIES: Availability[] = ['in stock', 'out of stock', 'preorder', 'available for order', 'discontinued'];
const CONDITIONS: Condition[] = ['new', 'refurbished', 'used'];

function brtDayMonthClient(): { dmShort: string; dmId: string } {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
  }).formatToParts(new Date());
  const dd = parts.find((p) => p.type === 'day')?.value ?? '00';
  const mm = parts.find((p) => p.type === 'month')?.value ?? '00';
  return { dmShort: `${dd}/${mm}`, dmId: `${dd}-${mm}` };
}

interface CatalogEndpointAttempt {
  endpoint: 'owned' | 'client';
  status: 'ok' | 'empty' | 'error';
  count: number;
  error_code: number | string | null;
  error_message: string | null;
}

interface CatalogTokenAttempt {
  profile_name: string;
  token_preview: string;
  endpoints: CatalogEndpointAttempt[];
}

interface BMDiagnostic {
  bm_id: string;
  bm_name: string;
  total_catalogs: number;
  attempts: CatalogTokenAttempt[];
}

const formatNumber = (v: number) => v.toLocaleString('pt-BR');

export default function ClientCatalogo({ initialGroups }: { initialGroups: BMWithCatalogs[] }) {
  const [groups, setGroups] = useState<BMWithCatalogs[]>(initialGroups);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(initialGroups.filter((g) => g.catalogs.length > 0).map((g) => g.bm_id))
  );
  const [diagnostics, setDiagnostics] = useState<BMDiagnostic[] | null>(null);
  const [diagOpen, setDiagOpen] = useState(false);
  const [diagFilter, setDiagFilter] = useState<'all' | 'empty' | 'errors'>('all');

  // ── Estado do modal "Adicionar produto" ────────────────────────────────
  const [modalCatalog, setModalCatalog] = useState<
    { catalog: CatalogEntry; bm_id: string; bm_name: string } | null
  >(null);
  const [adNames, setAdNames] = useState('');
  const [productTitle, setProductTitle] = useState('');
  const [presetConfig, setPresetConfig] = useState<ProductPresetConfig>(EMPTY_PRESET);
  const [presets, setPresets] = useState<SavedPreset[]>([]);
  const [selectedPresetName, setSelectedPresetName] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [createProgress, setCreateProgress] = useState<{ current: number; total: number } | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  interface BatchSuccessItem {
    ad_name: string;
    product_id: string;
    product_set_id: string;
    retailer_id: string;
    product_name: string;
  }
  interface BatchFailureItem {
    ad_name: string;
    error: string;
  }
  const [batchResult, setBatchResult] = useState<{
    successes: BatchSuccessItem[];
    failures: BatchFailureItem[];
  } | null>(null);

  // ── Estado do modal "Vídeos" ───────────────────────────────────────────
  interface CatalogProductRow {
    product_id: string;
    retailer_id: string | null;
    name: string | null;
    url: string | null;
    image_url: string | null;
    videos: Array<{ url: string; tag?: string }>;
    updated_at: string;
  }
  interface IgnoredProductRow {
    product_id: string;
    retailer_id: string | null;
    name: string | null;
    ignored_at: string;
  }
  const [videoModalCatalog, setVideoModalCatalog] = useState<
    { catalog: CatalogEntry; bm_id: string; bm_name: string } | null
  >(null);
  const [videoTab, setVideoTab] = useState<'missing' | 'ignored'>('missing');
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoSyncing, setVideoSyncing] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoProducts, setVideoProducts] = useState<CatalogProductRow[]>([]);
  const [videoIgnored, setVideoIgnored] = useState<IgnoredProductRow[]>([]);
  const [videoStats, setVideoStats] = useState<{ total: number; with_video: number; without_video: number; ignored: number } | null>(null);
  const [videoSyncDiag, setVideoSyncDiag] = useState<{
    raw_count: number;
    profile_used: string;
    page_count: number;
    first_page_keys: string[];
    sample_product_keys: string[];
    sample_videos: Array<{ url: string; tag?: string }>;
  } | null>(null);
  // URL digitada por linha (chave = product_id)
  const [videoUrlDrafts, setVideoUrlDrafts] = useState<Record<string, string>>({});
  // product_ids em ação (salvando/ignorando) — desabilita botões dessa linha
  const [videoRowBusy, setVideoRowBusy] = useState<Record<string, 'saving' | 'ignoring' | 'unignoring'>>({});

  // ── Handlers do modal "Vídeos" ─────────────────────────────────────────
  const loadVideoData = async (catalogId: string) => {
    setVideoLoading(true);
    setVideoError(null);
    try {
      const [pRes, iRes] = await Promise.all([
        fetch(`/api/catalogs/products/list?catalog_id=${encodeURIComponent(catalogId)}&missing_video=1`),
        fetch(`/api/catalogs/products/ignored?catalog_id=${encodeURIComponent(catalogId)}`),
      ]);
      const [pData, iData] = await Promise.all([pRes.json(), iRes.json()]);
      if (!pRes.ok || !pData.success) throw new Error(pData.error || `HTTP ${pRes.status} (list)`);
      if (!iRes.ok || !iData.success) throw new Error(iData.error || `HTTP ${iRes.status} (ignored)`);
      setVideoProducts(pData.products ?? []);
      setVideoIgnored(iData.items ?? []);
      setVideoStats(pData.stats ?? null);
    } catch (e: any) {
      setVideoError(e?.message ?? String(e));
    } finally {
      setVideoLoading(false);
    }
  };

  const openVideoModal = (catalog: CatalogEntry, bm: BMWithCatalogs) => {
    setVideoModalCatalog({ catalog, bm_id: bm.bm_id, bm_name: bm.bm_name });
    setVideoTab('missing');
    setVideoProducts([]);
    setVideoIgnored([]);
    setVideoStats(null);
    setVideoUrlDrafts({});
    setVideoRowBusy({});
    setVideoError(null);
    loadVideoData(catalog.id);
  };

  const closeVideoModal = () => {
    setVideoModalCatalog(null);
    setVideoProducts([]);
    setVideoIgnored([]);
    setVideoStats(null);
    setVideoUrlDrafts({});
    setVideoRowBusy({});
    setVideoError(null);
    setVideoLoading(false);
    setVideoSyncing(false);
  };

  const handleVideoSync = async () => {
    if (!videoModalCatalog) return;
    if (!window.confirm('Sincronizar produtos deste catálogo com a Meta? Pode levar alguns segundos.')) return;
    setVideoSyncing(true);
    setVideoError(null);
    setVideoSyncDiag(null);
    try {
      const res = await fetch('/api/catalogs/products/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ catalog_id: videoModalCatalog.catalog.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      setVideoSyncDiag({
        raw_count: data.raw_count ?? 0,
        profile_used: data.profile_used ?? '?',
        page_count: data.page_count ?? 0,
        first_page_keys: data.first_page_keys ?? [],
        sample_product_keys: data.sample_product_keys ?? [],
        sample_videos: data.sample_videos ?? [],
      });
      await loadVideoData(videoModalCatalog.catalog.id);
    } catch (e: any) {
      setVideoError(e?.message ?? String(e));
    } finally {
      setVideoSyncing(false);
    }
  };

  const handleSaveVideo = async (product: CatalogProductRow) => {
    if (!videoModalCatalog) return;
    const url = (videoUrlDrafts[product.product_id] ?? '').trim();
    if (!url) {
      setVideoError(`Informe uma URL para ${product.retailer_id || product.product_id}.`);
      return;
    }
    setVideoRowBusy((m) => ({ ...m, [product.product_id]: 'saving' }));
    setVideoError(null);
    try {
      const res = await fetch('/api/catalogs/products/video', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          catalog_id: videoModalCatalog.catalog.id,
          product_id: product.product_id,
          video_url: url,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      // Remove o produto da lista de "sem vídeo" (agora tem)
      setVideoProducts((prev) => prev.filter((p) => p.product_id !== product.product_id));
      setVideoUrlDrafts((d) => {
        const { [product.product_id]: _omit, ...rest } = d;
        return rest;
      });
    } catch (e: any) {
      setVideoError(`Falha em ${product.retailer_id || product.product_id}: ${e?.message ?? String(e)}`);
    } finally {
      setVideoRowBusy((m) => {
        const { [product.product_id]: _omit, ...rest } = m;
        return rest;
      });
    }
  };

  const handleIgnoreProduct = async (product: CatalogProductRow) => {
    if (!videoModalCatalog) return;
    setVideoRowBusy((m) => ({ ...m, [product.product_id]: 'ignoring' }));
    setVideoError(null);
    try {
      const res = await fetch('/api/catalogs/products/ignored', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          catalog_id: videoModalCatalog.catalog.id,
          product_id: product.product_id,
          retailer_id: product.retailer_id,
          name: product.name,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      // Move do "sem vídeo" pra "ignorados"
      setVideoProducts((prev) => prev.filter((p) => p.product_id !== product.product_id));
      setVideoIgnored((prev) => [
        {
          product_id: product.product_id,
          retailer_id: product.retailer_id,
          name: product.name,
          ignored_at: new Date().toISOString(),
        },
        ...prev,
      ]);
    } catch (e: any) {
      setVideoError(`Falha ao ignorar ${product.retailer_id || product.product_id}: ${e?.message ?? String(e)}`);
    } finally {
      setVideoRowBusy((m) => {
        const { [product.product_id]: _omit, ...rest } = m;
        return rest;
      });
    }
  };

  const handleUnignoreProduct = async (item: IgnoredProductRow) => {
    if (!videoModalCatalog) return;
    setVideoRowBusy((m) => ({ ...m, [item.product_id]: 'unignoring' }));
    setVideoError(null);
    try {
      const url = `/api/catalogs/products/ignored?catalog_id=${encodeURIComponent(videoModalCatalog.catalog.id)}&product_id=${encodeURIComponent(item.product_id)}`;
      const res = await fetch(url, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      setVideoIgnored((prev) => prev.filter((x) => x.product_id !== item.product_id));
      // Recarrega a lista de "sem vídeo" — o produto reaparece se ainda não tiver vídeo
      await loadVideoData(videoModalCatalog.catalog.id);
    } catch (e: any) {
      setVideoError(`Falha ao desfazer ignorar: ${e?.message ?? String(e)}`);
    } finally {
      setVideoRowBusy((m) => {
        const { [item.product_id]: _omit, ...rest } = m;
        return rest;
      });
    }
  };

  // Carrega presets ao abrir o modal pela primeira vez
  useEffect(() => {
    if (!modalCatalog) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/catalogs/product-presets');
        const data = await res.json();
        if (cancelled || !data?.success) return;
        setPresets(data.presets ?? []);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [modalCatalog]);

  const openCreateModal = (catalog: CatalogEntry, bm: BMWithCatalogs) => {
    setModalCatalog({ catalog, bm_id: bm.bm_id, bm_name: bm.bm_name });
    setAdNames('');
    setProductTitle('');
    setPresetConfig(EMPTY_PRESET);
    setSelectedPresetName('');
    setModalError(null);
    setBatchResult(null);
    setCreateProgress(null);
  };

  const closeCreateModal = () => {
    setModalCatalog(null);
    setAdNames('');
    setProductTitle('');
    setPresetConfig(EMPTY_PRESET);
    setSelectedPresetName('');
    setModalError(null);
    setBatchResult(null);
    setCreateProgress(null);
    setCreating(false);
  };

  const applyPreset = (name: string) => {
    setSelectedPresetName(name);
    if (!name) return;
    const p = presets.find((x) => x.name === name);
    if (p) setPresetConfig({ ...EMPTY_PRESET, ...p.config });
  };

  const saveCurrentAsPreset = async () => {
    const raw = window.prompt('Nome do preset:', selectedPresetName || '');
    if (raw === null) return;
    const name = raw.trim();
    if (!name) return;
    if (presets.some((p) => p.name === name) && !window.confirm(`Já existe um preset "${name}". Substituir?`)) return;
    try {
      const res = await fetch('/api/catalogs/product-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, config: presetConfig }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      const next = [...presets.filter((p) => p.name !== name), data.preset].sort((a, b) =>
        a.name.localeCompare(b.name)
      );
      setPresets(next);
      setSelectedPresetName(name);
    } catch (e: any) {
      setModalError(`Falha ao salvar preset: ${e?.message ?? String(e)}`);
    }
  };

  const deleteCurrentPreset = async () => {
    if (!selectedPresetName) return;
    if (!window.confirm(`Excluir preset "${selectedPresetName}"?`)) return;
    try {
      const res = await fetch(
        `/api/catalogs/product-presets?name=${encodeURIComponent(selectedPresetName)}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      setPresets(presets.filter((p) => p.name !== selectedPresetName));
      setSelectedPresetName('');
    } catch (e: any) {
      setModalError(`Falha ao excluir preset: ${e?.message ?? String(e)}`);
    }
  };

  // Extrai linhas não-vazias da textarea (uma por produto).
  const parsedAdNames = useMemo(() => {
    return adNames
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }, [adNames]);

  const handleCreateProduct = async () => {
    if (!modalCatalog) return;
    const names = parsedAdNames;
    const title = productTitle.trim();
    if (names.length === 0) {
      setModalError('Informe ao menos um nome de anúncio (uma linha = um produto).');
      return;
    }
    if (!title) {
      setModalError('Informe o título do produto.');
      return;
    }
    const required: (keyof ProductPresetConfig)[] = [
      'description', 'link', 'image_url', 'price', 'currency', 'brand', 'availability', 'condition',
    ];
    for (const k of required) {
      if (!presetConfig[k] || String(presetConfig[k]).trim() === '') {
        setModalError(`Preencha o campo "${k}".`);
        return;
      }
    }
    setCreating(true);
    setModalError(null);
    setBatchResult(null);
    setCreateProgress({ current: 0, total: names.length });

    const successes: BatchSuccessItem[] = [];
    const failures: BatchFailureItem[] = [];

    for (let i = 0; i < names.length; i++) {
      const ad = names[i];
      setCreateProgress({ current: i + 1, total: names.length });
      try {
        const res = await fetch('/api/catalogs/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            catalog_id: modalCatalog.catalog.id,
            bm_id: modalCatalog.bm_id,
            ad_name: ad,
            product_name: title,
            preset: presetConfig,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(`${data.error || `HTTP ${res.status}`}${data.step ? ` [${data.step}]` : ''}`);
        }
        successes.push({
          ad_name: ad,
          product_id: data.product_id,
          product_set_id: data.product_set_id,
          retailer_id: data.retailer_id,
          product_name: data.product_name,
        });
      } catch (e: any) {
        failures.push({ ad_name: ad, error: e?.message ?? String(e) });
      }
    }

    // Incrementa product_count localmente pelo número de criados com sucesso
    if (successes.length > 0) {
      setGroups((prev) =>
        prev.map((g) =>
          g.bm_id !== modalCatalog.bm_id
            ? g
            : {
                ...g,
                catalogs: g.catalogs.map((c) =>
                  c.id !== modalCatalog.catalog.id
                    ? c
                    : { ...c, product_count: (c.product_count ?? 0) + successes.length }
                ),
              }
        )
      );
    }

    setBatchResult({ successes, failures });
    setCreating(false);
    setCreateProgress(null);
  };

  // Preview dos retailer_ids — um por linha (ex: "LT1100 20/05").
  // Formato: "<nome_do_ad> <dd>/<mm>", sem sanitização (preserva dots como "LT129.150").
  const retailerIdPreviews = useMemo(() => {
    if (parsedAdNames.length === 0) return [];
    const { dmShort } = brtDayMonthClient();
    return parsedAdNames.map((ad) => `${ad} ${dmShort}`);
  }, [parsedAdNames]);

  const reloadFromDB = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/catalogs');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      const list: BMWithCatalogs[] = data.groups ?? [];
      setGroups(list);
      setExpanded(new Set(list.filter((g) => g.catalogs.length > 0).map((g) => g.bm_id)));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    if (!window.confirm('Sincronizar catálogos com a Meta? Isso pode levar alguns minutos dependendo da quantidade de BMs.')) return;
    setSyncing(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch('/api/catalogs/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      const list: BMWithCatalogs[] = data.groups ?? [];
      setGroups(list);
      setExpanded(new Set(list.filter((g) => g.catalogs.length > 0).map((g) => g.bm_id)));
      setDiagnostics(Array.isArray(data.diagnostics) ? data.diagnostics : null);
      setDiagOpen(true);
      setInfo(`${data.count} catálogos sincronizados em ${list.length} BMs.`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSyncing(false);
    }
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    return groups
      .map((g) => {
        const bmHit = g.bm_name.toLowerCase().includes(q) || g.bm_id.includes(q);
        const catalogs = bmHit
          ? g.catalogs
          : g.catalogs.filter(
              (c) => c.name.toLowerCase().includes(q) || c.id.includes(q)
            );
        if (!bmHit && catalogs.length === 0) return null;
        return { ...g, catalogs };
      })
      .filter(Boolean) as BMWithCatalogs[];
  }, [groups, search]);

  const totals = useMemo(() => {
    const totalCatalogs = groups.reduce((s, g) => s + g.catalogs.length, 0);
    const totalProducts = groups.reduce(
      (s, g) => s + g.catalogs.reduce((sc, c) => sc + (c.product_count ?? 0), 0),
      0
    );
    return { bms: groups.length, catalogs: totalCatalogs, products: totalProducts };
  }, [groups]);

  const toggle = (bmId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(bmId)) next.delete(bmId); else next.add(bmId);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header / actions */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-bold text-gray-900">Catálogos do Facebook</h1>
            <p className="text-xs text-gray-500">
              {syncing
                ? 'Sincronizando com a Meta…'
                : loading
                ? 'Lendo do banco…'
                : `${totals.bms} BMs · ${totals.catalogs} catálogos · ${formatNumber(totals.products)} produtos`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Filtrar BM ou catálogo..."
              className="pl-9 pr-4 py-1.5 border border-gray-200 rounded-md text-xs w-64 outline-none focus:border-indigo-500 bg-gray-50"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            onClick={reloadFromDB}
            disabled={loading || syncing}
            title="Recarregar do banco de dados"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-indigo-300 hover:text-indigo-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {loading ? 'Lendo...' : 'Recarregar'}
          </button>
          <button
            onClick={handleSync}
            disabled={loading || syncing}
            title="Buscar catálogos diretamente da Meta e atualizar o banco"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-emerald-200 text-emerald-600 hover:bg-emerald-50 hover:border-emerald-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m8.66-13l-.87.5M4.21 15.5l-.87.5M20.66 15.5l-.87-.5M4.21 8.5l-.87-.5M21 12h-1M4 12H3" />
              <circle cx="12" cy="12" r="4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {syncing ? 'Sincronizando...' : 'Sincronizar Meta'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 text-sm">
          {error}
        </div>
      )}
      {info && !error && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl p-3 text-xs">
          {info}
        </div>
      )}

      {diagnostics && diagnostics.length > 0 && (() => {
        const withCatalogs   = diagnostics.filter((d) => d.total_catalogs > 0).length;
        const withoutAny     = diagnostics.filter((d) => d.total_catalogs === 0).length;
        const withAnyError   = diagnostics.filter((d) =>
          d.attempts.some((a) => a.endpoints.some((e) => e.status === 'error'))
        ).length;

        const filtered = diagnostics.filter((d) => {
          if (diagFilter === 'all') return true;
          if (diagFilter === 'empty') return d.total_catalogs === 0;
          if (diagFilter === 'errors')
            return d.attempts.some((a) => a.endpoints.some((e) => e.status === 'error'));
          return true;
        });

        return (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <button
              onClick={() => setDiagOpen((v) => !v)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <svg className={`w-4 h-4 text-gray-500 transition-transform ${diagOpen ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
                <div>
                  <div className="text-sm font-bold text-gray-800">Diagnóstico do último sync</div>
                  <div className="text-[11px] text-gray-500">
                    {diagnostics.length} BMs varridas · {withCatalogs} com catálogos · {withoutAny} sem catálogos · {withAnyError} com erro de permissão/API
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 text-[10px]" onClick={(e) => e.stopPropagation()}>
                {(['all', 'empty', 'errors'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setDiagFilter(f)}
                    className={`px-2 py-1 rounded ${diagFilter === f ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                  >
                    {f === 'all' ? 'Todas' : f === 'empty' ? 'Sem catálogos' : 'Com erro'}
                  </button>
                ))}
              </div>
            </button>

            {diagOpen && (
              <div className="border-t border-gray-100 divide-y divide-gray-100 max-h-[480px] overflow-y-auto">
                {filtered.length === 0 ? (
                  <div className="p-6 text-center text-gray-400 text-xs">
                    Nada pra mostrar com este filtro.
                  </div>
                ) : (
                  filtered.map((d) => {
                    const anyError = d.attempts.some((a) => a.endpoints.some((e) => e.status === 'error'));
                    return (
                      <div key={d.bm_id} className="px-5 py-3 text-xs">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="font-semibold text-gray-800 truncate max-w-[320px]" title={d.bm_name}>{d.bm_name}</span>
                          <span className="font-mono text-[10px] text-gray-400">BM {d.bm_id}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                            d.total_catalogs > 0
                              ? 'bg-emerald-50 text-emerald-600'
                              : anyError
                              ? 'bg-rose-50 text-rose-600'
                              : 'bg-gray-100 text-gray-500'
                          }`}>
                            {d.total_catalogs > 0
                              ? `${d.total_catalogs} catálogo(s)`
                              : anyError ? 'Erro de permissão/API' : 'Sem catálogos'}
                          </span>
                        </div>
                        <div className="space-y-1 pl-2 border-l-2 border-gray-100">
                          {d.attempts.map((a, idx) => (
                            <div key={idx} className="flex flex-wrap items-start gap-2 py-1">
                              <div className="text-[11px] text-gray-600 font-medium min-w-[140px]">
                                {a.profile_name}
                                <span className="text-gray-400 font-mono ml-1">[{a.token_preview}]</span>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {a.endpoints.map((e, eidx) => (
                                  <span
                                    key={eidx}
                                    className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                                      e.status === 'ok'
                                        ? 'bg-emerald-50 text-emerald-700'
                                        : e.status === 'empty'
                                        ? 'bg-gray-100 text-gray-500'
                                        : 'bg-rose-50 text-rose-700'
                                    }`}
                                    title={e.error_message ?? ''}
                                  >
                                    {e.endpoint}: {e.status === 'error'
                                      ? `err ${e.error_code ?? ''}`
                                      : `${e.count}`}
                                  </span>
                                ))}
                                {a.endpoints.some((e) => e.error_message) && (
                                  <span className="text-[10px] text-rose-600 max-w-[420px] truncate">
                                    {a.endpoints.find((e) => e.error_message)?.error_message}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })()}

      {!loading && !syncing && !error && filtered.length === 0 && (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center text-gray-400 text-sm">
          {groups.length === 0
            ? 'Nenhum catálogo no banco. Clique em "Sincronizar Meta" para buscar.'
            : 'Nenhum catálogo encontrado para o filtro atual.'}
        </div>
      )}

      {filtered.map((g) => {
        const isOpen = expanded.has(g.bm_id);
        const bmProductTotal = g.catalogs.reduce((s, c) => s + (c.product_count ?? 0), 0);
        return (
          <div key={g.bm_id} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            {/* BM Header */}
            <div
              onClick={() => toggle(g.bm_id)}
              className="px-5 py-3 border-b border-gray-100 bg-gradient-to-r from-indigo-50/40 to-transparent flex flex-wrap items-center gap-x-6 gap-y-2 cursor-pointer hover:bg-indigo-50/60 transition-colors"
            >
              <div className={`w-5 h-5 flex items-center justify-center rounded bg-gray-100 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}>
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="w-1.5 h-6 bg-indigo-500 rounded-sm" />
              <div className="min-w-0">
                <div className="text-[10px] text-gray-400 font-bold tracking-wider uppercase">Business Manager</div>
                <div className="text-sm font-bold text-gray-800 truncate max-w-[420px]" title={g.bm_name}>
                  {g.bm_name}
                </div>
              </div>
              <div className="text-[10px] text-gray-400 font-mono">BM {g.bm_id}</div>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs ml-auto">
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Catálogos</span>
                  <span className="font-mono font-bold text-gray-800">{g.catalogs.length}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Produtos</span>
                  <span className="font-mono font-semibold text-gray-800">{formatNumber(bmProductTotal)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Perfis</span>
                  <span className="font-mono text-gray-500 truncate max-w-[200px]" title={g.accessible_profiles.join(', ')}>
                    {g.accessible_profiles.join(', ') || '—'}
                  </span>
                </div>
              </div>
            </div>

            {/* Catálogos */}
            {isOpen && (
              <>
                {g.catalogs.length === 0 ? (
                  <div className="p-6 text-center text-gray-400 text-xs">
                    Nenhum catálogo nesta BM.
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-12 bg-gray-50 text-[10px] text-gray-500 font-bold uppercase tracking-wider border-b border-gray-200">
                      <div className="col-span-4 px-6 py-3">Catálogo</div>
                      <div className="col-span-3 px-4 py-3">ID</div>
                      <div className="col-span-2 px-4 py-3 text-right">Produtos</div>
                      <div className="col-span-1 px-4 py-3">Vertical</div>
                      <div className="col-span-1 px-4 py-3">Acesso</div>
                      <div className="col-span-1 px-4 py-3" />
                    </div>
                    <div className="divide-y divide-gray-100">
                      {g.catalogs.map((c) => (
                        <div key={c.id} className="grid grid-cols-12 text-xs hover:bg-gray-50 transition-colors items-center">
                          <div className="col-span-4 px-6 py-3 font-semibold text-gray-800 break-words">{c.name}</div>
                          <div className="col-span-3 px-4 py-3 font-mono text-gray-400 text-[11px]">{c.id}</div>
                          <div className="col-span-2 px-4 py-3 text-right font-mono text-gray-700">
                            {c.product_count != null ? formatNumber(c.product_count) : '—'}
                          </div>
                          <div className="col-span-1 px-4 py-3 text-gray-500">{c.vertical ?? '—'}</div>
                          <div className="col-span-1 px-4 py-3">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                              c.relationship === 'owned'
                                ? 'bg-indigo-50 text-indigo-600'
                                : 'bg-amber-50 text-amber-600'
                            }`}>
                              {c.relationship === 'owned' ? 'Owned' : 'Client'}
                            </span>
                          </div>
                          <div className="col-span-1 px-4 py-3 flex flex-col gap-1">
                            <button
                              onClick={() => openCreateModal(c, g)}
                              title="Criar produto + conjunto neste catálogo"
                              className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded border border-indigo-200 text-indigo-600 hover:bg-indigo-50 hover:border-indigo-400 transition-colors whitespace-nowrap"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                              </svg>
                              Produto
                            </button>
                            <button
                              onClick={() => openVideoModal(c, g)}
                              title="Atualizar URLs de vídeo dos produtos deste catálogo"
                              className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded border border-purple-200 text-purple-600 hover:bg-purple-50 hover:border-purple-400 transition-colors whitespace-nowrap"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                              Vídeos
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        );
      })}

      {modalCatalog && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-6"
          onClick={closeCreateModal}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-2xl my-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-gray-900">Adicionar produto</h2>
                <p className="text-xs text-gray-500 truncate max-w-[480px]">
                  {modalCatalog.catalog.name}
                  <span className="text-gray-400 font-mono ml-2">ID {modalCatalog.catalog.id}</span>
                </p>
              </div>
              <button
                onClick={closeCreateModal}
                className="text-gray-400 hover:text-gray-700 transition-colors"
                title="Fechar"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              {batchResult ? (
                <div className="space-y-3">
                  <div className={`rounded-lg p-4 space-y-2 border ${
                    batchResult.failures.length === 0
                      ? 'bg-emerald-50 border-emerald-200'
                      : batchResult.successes.length === 0
                      ? 'bg-rose-50 border-rose-200'
                      : 'bg-amber-50 border-amber-200'
                  }`}>
                    <div className={`text-sm font-bold ${
                      batchResult.failures.length === 0
                        ? 'text-emerald-700'
                        : batchResult.successes.length === 0
                        ? 'text-rose-700'
                        : 'text-amber-700'
                    }`}>
                      {batchResult.successes.length} criado(s) · {batchResult.failures.length} falha(s)
                    </div>
                  </div>

                  {batchResult.successes.length > 0 && (
                    <div className="border border-emerald-200 rounded-lg overflow-hidden">
                      <div className="bg-emerald-50 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                        Criados ({batchResult.successes.length})
                      </div>
                      <div className="max-h-48 overflow-y-auto divide-y divide-emerald-100">
                        {batchResult.successes.map((s) => (
                          <div key={s.product_id} className="px-3 py-2 text-[11px] flex flex-wrap gap-x-3 gap-y-0.5">
                            <span className="font-mono text-emerald-700">{s.retailer_id}</span>
                            <span className="text-gray-500">prod {s.product_id}</span>
                            <span className="text-gray-500">set {s.product_set_id}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {batchResult.failures.length > 0 && (
                    <div className="border border-rose-200 rounded-lg overflow-hidden">
                      <div className="bg-rose-50 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-rose-700">
                        Falhas ({batchResult.failures.length})
                      </div>
                      <div className="max-h-48 overflow-y-auto divide-y divide-rose-100">
                        {batchResult.failures.map((f, i) => (
                          <div key={i} className="px-3 py-2 text-[11px]">
                            <div className="font-mono text-rose-700">{f.ad_name}</div>
                            <div className="text-rose-600">{f.error}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="pt-1 flex gap-2">
                    <button
                      onClick={() => {
                        setAdNames(batchResult.failures.map((f) => f.ad_name).join('\n'));
                        setBatchResult(null);
                      }}
                      className="px-3 py-1.5 text-xs font-semibold rounded border border-indigo-200 text-indigo-600 hover:bg-indigo-50 transition-colors"
                    >
                      {batchResult.failures.length > 0 ? 'Tentar novamente as falhas' : 'Criar mais'}
                    </button>
                    <button
                      onClick={closeCreateModal}
                      className="px-3 py-1.5 text-xs font-semibold rounded border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      Fechar
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Linha: nomes dos anúncios (uma linha = um produto) */}
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                      Nomes dos anúncios <span className="text-gray-400 font-normal normal-case tracking-normal">(uma linha = um produto · gera o ID)</span>
                    </label>
                    <textarea
                      value={adNames}
                      onChange={(e) => setAdNames(e.target.value)}
                      rows={4}
                      placeholder={'Ex:\nLT1100\nLT1101\nLT129.150'}
                      className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm outline-none focus:border-indigo-500 font-mono"
                    />
                    {retailerIdPreviews.length > 0 && (
                      <div className="mt-1.5 text-[11px] text-gray-500">
                        {retailerIdPreviews.length} produto(s) · IDs:{' '}
                        <span className="font-mono text-gray-700">
                          {retailerIdPreviews.slice(0, 3).join(', ')}
                          {retailerIdPreviews.length > 3 ? `, … (+${retailerIdPreviews.length - 3})` : ''}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Linha: título do produto (obrigatório) */}
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                      Título do produto
                    </label>
                    <input
                      type="text"
                      value={productTitle}
                      onChange={(e) => setProductTitle(e.target.value)}
                      placeholder="Digite o título do produto"
                      className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm outline-none focus:border-indigo-500"
                    />
                  </div>

                  {/* Linha: preset selector */}
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                        Preset
                      </label>
                      <select
                        value={selectedPresetName}
                        onChange={(e) => applyPreset(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm outline-none focus:border-indigo-500 bg-white"
                      >
                        <option value="">— Sem preset —</option>
                        {presets.map((p) => (
                          <option key={p.id} value={p.name}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={saveCurrentAsPreset}
                      title="Salvar configuração atual como preset"
                      className="px-3 py-2 text-xs font-semibold rounded border border-indigo-200 text-indigo-600 hover:bg-indigo-50 transition-colors whitespace-nowrap"
                    >
                      Salvar
                    </button>
                    <button
                      type="button"
                      onClick={deleteCurrentPreset}
                      disabled={!selectedPresetName}
                      className="px-3 py-2 text-xs font-semibold rounded border border-rose-200 text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Excluir
                    </button>
                  </div>

                  {/* Grid: campos do preset */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Descrição</label>
                      <textarea
                        value={presetConfig.description}
                        onChange={(e) => setPresetConfig({ ...presetConfig, description: e.target.value })}
                        rows={2}
                        className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Link (URL do produto)</label>
                      <input
                        type="url"
                        value={presetConfig.link}
                        onChange={(e) => setPresetConfig({ ...presetConfig, link: e.target.value })}
                        placeholder="https://..."
                        className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Image URL</label>
                      <input
                        type="url"
                        value={presetConfig.image_url}
                        onChange={(e) => setPresetConfig({ ...presetConfig, image_url: e.target.value })}
                        placeholder="https://..."
                        className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Preço</label>
                      <input
                        type="text"
                        value={presetConfig.price}
                        onChange={(e) => setPresetConfig({ ...presetConfig, price: e.target.value })}
                        placeholder="97.00"
                        className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Moeda</label>
                      <input
                        type="text"
                        value={presetConfig.currency}
                        onChange={(e) => setPresetConfig({ ...presetConfig, currency: e.target.value.toUpperCase() })}
                        placeholder="BRL"
                        maxLength={3}
                        className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm outline-none focus:border-indigo-500 font-mono uppercase"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Marca</label>
                      <input
                        type="text"
                        value={presetConfig.brand}
                        onChange={(e) => setPresetConfig({ ...presetConfig, brand: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Disponibilidade</label>
                      <select
                        value={presetConfig.availability}
                        onChange={(e) => setPresetConfig({ ...presetConfig, availability: e.target.value as Availability })}
                        className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm outline-none focus:border-indigo-500 bg-white"
                      >
                        {AVAILABILITIES.map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Condição</label>
                      <select
                        value={presetConfig.condition}
                        onChange={(e) => setPresetConfig({ ...presetConfig, condition: e.target.value as Condition })}
                        className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm outline-none focus:border-indigo-500 bg-white"
                      >
                        {CONDITIONS.map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {modalError && (
                    <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg p-3 text-xs">
                      {modalError}
                    </div>
                  )}
                </>
              )}
            </div>

            {!batchResult && (
              <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-end gap-2 rounded-b-xl">
                <button
                  onClick={closeCreateModal}
                  disabled={creating}
                  className="px-4 py-2 text-xs font-semibold rounded border border-gray-200 text-gray-600 hover:bg-white transition-colors disabled:opacity-40"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleCreateProduct}
                  disabled={creating || parsedAdNames.length === 0 || !productTitle.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {creating && (
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9" />
                    </svg>
                  )}
                  {creating && createProgress
                    ? `Criando ${createProgress.current}/${createProgress.total}...`
                    : `Criar ${parsedAdNames.length || ''} produto${parsedAdNames.length === 1 ? '' : 's'} + conjunto${parsedAdNames.length === 1 ? '' : 's'}`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modal: atualizar URLs de vídeo dos produtos ───────────────── */}
      {videoModalCatalog && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-6"
          onClick={closeVideoModal}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-3xl my-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-gray-900">URLs de vídeo</h2>
                <p className="text-xs text-gray-500 truncate">
                  {videoModalCatalog.catalog.name}
                  <span className="text-gray-400 font-mono ml-2">ID {videoModalCatalog.catalog.id}</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleVideoSync}
                  disabled={videoSyncing || videoLoading}
                  title="Buscar produtos atualizados do catálogo na Meta"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded border border-emerald-200 text-emerald-600 hover:bg-emerald-50 hover:border-emerald-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <svg className={`h-3.5 w-3.5 ${videoSyncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  {videoSyncing ? 'Sincronizando...' : 'Sincronizar Meta'}
                </button>
                <button
                  onClick={closeVideoModal}
                  className="text-gray-400 hover:text-gray-700 transition-colors"
                  title="Fechar"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Stats */}
            {videoStats && (
              <div className="px-6 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-3 text-[11px] text-gray-600">
                <span><span className="font-bold text-gray-800">{videoStats.total}</span> sincronizados</span>
                <span className="text-gray-300">·</span>
                <span><span className="font-bold text-emerald-700">{videoStats.with_video}</span> com vídeo</span>
                <span className="text-gray-300">·</span>
                <span><span className="font-bold text-purple-700">{videoStats.without_video}</span> sem vídeo</span>
                <span className="text-gray-300">·</span>
                <span><span className="font-bold text-gray-700">{videoStats.ignored}</span> ignorados</span>
              </div>
            )}

            {/* Tabs */}
            <div className="px-6 pt-3 border-b border-gray-200 flex items-center gap-1">
              {(['missing', 'ignored'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setVideoTab(t)}
                  className={`px-3 py-2 text-xs font-bold rounded-t-md border-b-2 transition-colors ${
                    videoTab === t
                      ? 'border-purple-500 text-purple-700 bg-purple-50/40'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {t === 'missing'
                    ? `Sem vídeo (${videoProducts.length})`
                    : `Ignorados (${videoIgnored.length})`}
                </button>
              ))}
            </div>

            <div className="px-6 py-4">
              {videoSyncDiag && (
                <div className="mb-3 bg-slate-50 border border-slate-200 text-slate-700 rounded-lg p-3 text-[11px] font-mono space-y-0.5">
                  <div><b>Último sync:</b> {videoSyncDiag.raw_count} produtos · {videoSyncDiag.page_count} página(s)</div>
                  <div><b>Perfil:</b> {videoSyncDiag.profile_used}</div>
                  <div><b>Chaves da 1ª resposta:</b> [{videoSyncDiag.first_page_keys.join(', ') || '—'}]</div>
                  <div><b>Chaves do produto-amostra:</b> [{videoSyncDiag.sample_product_keys.join(', ') || '—'}]</div>
                  <div>
                    <b>Vídeos extraídos do amostra:</b>{' '}
                    {videoSyncDiag.sample_videos.length === 0
                      ? '— nenhum —'
                      : videoSyncDiag.sample_videos.map((v) => v.url).join(', ')}
                  </div>
                </div>
              )}
              {videoError && (
                <div className="mb-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg p-3 text-xs">
                  {videoError}
                </div>
              )}

              {videoLoading ? (
                <div className="py-10 text-center text-gray-400 text-sm">Carregando produtos…</div>
              ) : videoTab === 'missing' ? (
                videoProducts.length === 0 ? (
                  <div className="py-10 text-center text-gray-400 text-sm space-y-1">
                    {videoStats && videoStats.total === 0 ? (
                      <>
                        <div>Snapshot vazio para este catálogo.</div>
                        <div className="text-xs">Clique em "Sincronizar Meta" para baixar os produtos.</div>
                      </>
                    ) : videoStats && videoStats.without_video === 0 ? (
                      <div>Todos os {videoStats.total} produtos já têm vídeo. 🎉</div>
                    ) : (
                      <div>
                        Nenhum produto pendente. Possivelmente todos foram ignorados — veja a aba "Ignorados".
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
                    {videoProducts.map((p) => {
                      const busy = videoRowBusy[p.product_id];
                      const draft = videoUrlDrafts[p.product_id] ?? '';
                      return (
                        <div key={p.product_id} className="px-4 py-3 flex items-start gap-3">
                          {p.image_url ? (
                            <img
                              src={p.image_url}
                              alt=""
                              className="w-12 h-12 rounded object-cover bg-gray-100 flex-shrink-0"
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
                            />
                          ) : (
                            <div className="w-12 h-12 rounded bg-gray-100 flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-gray-800 truncate" title={p.name ?? p.product_id}>
                              {p.name ?? <span className="text-gray-400 italic">sem nome</span>}
                            </div>
                            <div className="text-[10px] text-gray-400 font-mono mt-0.5">
                              {p.retailer_id || '—'} · prod {p.product_id}
                            </div>
                            <div className="mt-2 flex gap-2">
                              <input
                                type="url"
                                value={draft}
                                onChange={(e) =>
                                  setVideoUrlDrafts((d) => ({ ...d, [p.product_id]: e.target.value }))
                                }
                                placeholder="https://… (URL do vídeo)"
                                disabled={!!busy}
                                className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded outline-none focus:border-purple-500 font-mono disabled:bg-gray-50"
                              />
                              <button
                                onClick={() => handleSaveVideo(p)}
                                disabled={!!busy || !draft.trim()}
                                className="px-3 py-1 text-[11px] font-bold rounded bg-purple-600 text-white hover:bg-purple-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                              >
                                {busy === 'saving' ? 'Salvando...' : 'Salvar'}
                              </button>
                              <button
                                onClick={() => handleIgnoreProduct(p)}
                                disabled={!!busy}
                                title="Não cobrar esse produto na próxima abertura"
                                className="px-3 py-1 text-[11px] font-semibold rounded border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                              >
                                {busy === 'ignoring' ? 'Ignorando...' : 'Ignorar'}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              ) : (
                videoIgnored.length === 0 ? (
                  <div className="py-10 text-center text-gray-400 text-sm">
                    Nenhum produto ignorado neste catálogo.
                  </div>
                ) : (
                  <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
                    {videoIgnored.map((p) => {
                      const busy = videoRowBusy[p.product_id];
                      return (
                        <div key={p.product_id} className="px-4 py-3 flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-gray-800 truncate" title={p.name ?? p.product_id}>
                              {p.name ?? <span className="text-gray-400 italic">sem nome</span>}
                            </div>
                            <div className="text-[10px] text-gray-400 font-mono mt-0.5">
                              {p.retailer_id || '—'} · prod {p.product_id} · ignorado em{' '}
                              {new Date(p.ignored_at).toLocaleDateString('pt-BR')}
                            </div>
                          </div>
                          <button
                            onClick={() => handleUnignoreProduct(p)}
                            disabled={!!busy}
                            className="px-3 py-1 text-[11px] font-semibold rounded border border-indigo-200 text-indigo-600 hover:bg-indigo-50 hover:border-indigo-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                          >
                            {busy === 'unignoring' ? 'Desfazendo...' : 'Desfazer ignorar'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
