// Estado client-side dos Creative Groups (ADR-0009) — nivel de separacao
// 'group' do campaign builder. Puro e testavel: o ClientCampaignBuilder so
// chama estes helpers e renderiza. Invariante mantido por normalizeGroups:
// indices compactos 0..K-1, sem grupos vazios, todo draft atribuido.

export type CreativeGroupsState = {
  /** Nome da coluna por indice de grupo (editavel; fallback "Grupo N"). */
  names: string[];
  /** draftId -> indice de grupo. */
  byId: Record<string, number>;
};

/** Estado inicial: todos os drafts num unico "Grupo 1". */
export function singleGroup(draftIds: string[]): CreativeGroupsState {
  return { names: ['Grupo 1'], byId: Object.fromEntries(draftIds.map((id) => [id, 0])) };
}

/**
 * Reconcilia o estado com a lista atual de drafts: ids mortos saem, ids novos
 * caem no grupo 0, grupos vazios somem e os indices sao compactados em ordem
 * ascendente (nomes sobreviventes preservados; ausentes ganham "Grupo N" pelo
 * indice ORIGINAL, que e o rotulo que o usuario via antes da compactacao).
 */
export function normalizeGroups(state: CreativeGroupsState, draftIds: string[]): CreativeGroupsState {
  if (draftIds.length === 0) return { names: ['Grupo 1'], byId: {} };
  const raw: Record<string, number> = {};
  for (const id of draftIds) {
    const g = state.byId[id];
    raw[id] = typeof g === 'number' && Number.isInteger(g) && g >= 0 ? g : 0;
  }
  const distinct = [...new Set(Object.values(raw))].sort((x, y) => x - y);
  const remap = new Map(distinct.map((g, i) => [g, i]));
  const byId: Record<string, number> = {};
  for (const id of draftIds) byId[id] = remap.get(raw[id])!;
  // `??` (não `||`): nome '' em edição é preservado — o fallback "Grupo N" é
  // aplicado na exibição (placeholder) e no servidor (groupNameOf), nunca aqui.
  const names = distinct.map((g) => state.names[g] ?? `Grupo ${g + 1}`);
  return { names, byId };
}

/**
 * Move um draft para o grupo `target`. `target === names.length` cria um grupo
 * novo ("Grupo N"). O grupo de origem, se esvaziar, some na compactacao —
 * mecanica "clique p/ mover" do painel (ADR-0009).
 */
export function moveToGroup(
  state: CreativeGroupsState,
  draftIds: string[],
  draftId: string,
  target: number
): CreativeGroupsState {
  const names =
    target === state.names.length ? [...state.names, `Grupo ${state.names.length + 1}`] : state.names;
  const t = Math.max(0, Math.min(Math.floor(target), names.length - 1));
  return normalizeGroups({ names, byId: { ...state.byId, [draftId]: t } }, draftIds);
}

/** Renomeia uma coluna. Vazio e permitido aqui; o fallback "Grupo N" e aplicado na leitura. */
export function renameGroup(state: CreativeGroupsState, groupIdx: number, name: string): CreativeGroupsState {
  const names = state.names.map((n, i) => (i === groupIdx ? name : n));
  return { names, byId: state.byId };
}

// ── Import em massa (colar tabela) ──────────────────────────────────────────
// Colagem de Sheets/Excel: "Conjunto \t Anúncio \t ID do conjunto de produtos".
// Cada linha vira um draft DPA (name + product_set_id) já atribuído ao grupo.

export type CreativeTableRow = { group: string; name: string; productSetId: string };

/**
 * Faz o parse do texto colado. Aceita separação por tab (Sheets/Excel) ou por
 * espaços; ignora linhas vazias e a linha de cabeçalho. Linhas inválidas não
 * derrubam o import: viram mensagens em `errors` (com o número da linha) e as
 * válidas seguem.
 */
export function parseCreativeGroupsTable(text: string): { rows: CreativeTableRow[]; errors: string[] } {
  const rows: CreativeTableRow[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = (line.includes('\t') ? line.split('\t') : line.trim().split(/\s+/))
      .map((c) => c.trim())
      .filter((c) => c !== '');
    // Cabeçalho ("Conjunto | Anúncio | ID ...") é reconhecido e pulado em silêncio.
    if (/^conjunto$/i.test(cells[0] ?? '') && /^an[uú]ncio/i.test(cells[1] ?? '')) continue;
    if (cells.length < 3) {
      errors.push(`Linha ${i + 1}: esperado "Conjunto, Anúncio, ID do conjunto de produtos" — recebido ${cells.length} coluna(s).`);
      continue;
    }
    // O ID é sempre a última célula; nome do anúncio pode conter espaços.
    const productSetId = cells[cells.length - 1];
    const group = cells[0];
    const name = cells.slice(1, -1).join(' ');
    if (!/^\d{6,}$/.test(productSetId)) {
      errors.push(`Linha ${i + 1}: "${productSetId}" não parece um ID de conjunto de produtos (esperado só dígitos).`);
      continue;
    }
    rows.push({ group, name, productSetId });
  }
  return { rows, errors };
}

/**
 * Constrói o CreativeGroupsState a partir das linhas importadas: colunas na
 * ordem de primeira aparição do nome do grupo; `draftIds[i]` casa com `rows[i]`.
 */
export function groupsStateFromRows(rows: CreativeTableRow[], draftIds: string[]): CreativeGroupsState {
  const names: string[] = [];
  const idxByName = new Map<string, number>();
  const byId: Record<string, number> = {};
  rows.forEach((row, i) => {
    let g = idxByName.get(row.group);
    if (g === undefined) {
      g = names.length;
      names.push(row.group);
      idxByName.set(row.group, g);
    }
    byId[draftIds[i]] = g;
  });
  if (names.length === 0) return { names: ['Grupo 1'], byId: {} };
  return { names, byId };
}

/**
 * draftIds atribuídos a qualquer um dos grupos em `groupIndices` (índices
 * COMPACTADOS de groupsView). Usado pela exclusão em massa: excluir grupos =
 * remover os criativos deles da lista de ads (o normalizeGroups compacta o
 * resto). Índices inexistentes são ignorados.
 */
export function draftIdsInGroups(state: CreativeGroupsState, groupIndices: number[]): string[] {
  const set = new Set(groupIndices);
  return Object.entries(state.byId)
    .filter(([, g]) => set.has(g))
    .map(([id]) => id);
}

/**
 * Converte para o payload `batch.creative_groups` (BatchCreateInput) na ordem
 * do array de creatives enviado — assignments[i] casa com creatives[i].
 */
export function toCreativeGroupsPayload(
  state: CreativeGroupsState,
  orderedDraftIds: string[]
): { names: string[]; assignments: number[] } {
  return {
    names: state.names,
    assignments: orderedDraftIds.map((id) => state.byId[id] ?? 0),
  };
}
