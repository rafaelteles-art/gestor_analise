/**
 * Diff puro entre a lista antiga e a nova de perfis Meta (nome + token).
 *
 * O nome do perfil é a chave que liga páginas, contas e catálogos ao token
 * (coluna `accessible_profiles` em meta_pages / meta_ad_accounts / meta_catalogs).
 * Renomear um perfil sem migrar esses arrays deixa tudo órfão — foi o que
 * derrubou a publicação em 09/2026 ("P154" → "P154 LABEL").
 *
 * `identity` mapeia token → identidade estável (id do System User via /me).
 * Quando ausente, o próprio token é a identidade. Assim detectamos rename
 * mesmo quando nome E token mudaram juntos, desde que seja o mesmo System User.
 */
export interface MetaProfile {
  name: string;
  token: string;
}

export interface ProfileDiff {
  /** Perfil existente que mudou de nome (mesmo token ou mesmo System User). */
  renamed: { from: string; to: string }[];
  /** Perfil existente (mesmo nome) que trocou de token. */
  changedToken: string[];
  /** Perfil realmente novo — nenhuma identidade em comum com a lista antiga. */
  added: string[];
}

export function diffProfiles(
  oldList: MetaProfile[],
  newList: MetaProfile[],
  identity: Map<string, string> = new Map(),
): ProfileDiff {
  const idOf = (p: MetaProfile) => identity.get(p.token) ?? p.token;
  const oldByName = new Map(oldList.map((p) => [p.name, p]));
  const newNames = new Set(newList.map((p) => p.name));

  const renamed: ProfileDiff['renamed'] = [];
  const changedToken: string[] = [];
  const added: string[] = [];
  const consumedOld = new Set<string>();

  for (const p of newList) {
    const prev = oldByName.get(p.name);
    if (prev) {
      if (prev.token !== p.token) changedToken.push(p.name);
      continue;
    }
    // Nome novo: procura um perfil antigo com a mesma identidade cujo nome sumiu.
    const match = oldList.find(
      (q) => !newNames.has(q.name) && !consumedOld.has(q.name) && idOf(q) === idOf(p),
    );
    if (match) {
      consumedOld.add(match.name);
      renamed.push({ from: match.name, to: p.name });
    } else {
      added.push(p.name);
    }
  }

  return { renamed, changedToken, added };
}
