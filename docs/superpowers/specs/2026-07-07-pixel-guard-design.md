# Trava de pixel no campaign builder (duas camadas)

**Data:** 2026-07-07
**Status:** Aprovado

## Problema

Campanhas de vendas estão sendo publicadas com um `pixel_id` ao qual a conta de
anúncios não tem acesso. Sintoma observado (job #110, P252): a UI não mostrava
nenhum pixel selecionado, mas o payload carregava um pixel de outra conta; o
worker criou campanha ✓ e conjunto ✓ e falhou só no anúncio (Meta code 200,
subcode 1815045 — "A conta não tem acesso ao pixel"), deixando uma campanha
semi-criada sem anúncios na conta.

## Causa raiz

O estado `pixelId` do builder nunca é revalidado quando a conta muda:

1. Conta A selecionada → pixels da A carregam → auto-select preenche `pixelId`
   (`ClientCampaignBuilder.tsx:2140`, só dispara com `pixelId` vazio).
2. Usuário troca para a conta B → lista de pixels recarrega, mas o `pixelId`
   da conta A permanece no estado.
3. O `SearchableSelect` recebe um `value` que não existe nas `options` e
   renderiza como vazio (placeholder) — a UI mostra "nenhum pixel", mas o
   estado guarda o ID velho.
4. A validação de submit só checa presença (`!pixelId` — linha 2504), não
   pertencimento à conta. Publica com o pixel errado.

Caminhos irmãos com o mesmo buraco: broadcast multi-conta (o pixel da conta
primária vai literal para as demais contas) e re-enfileiramento/reabrir da
fila (payload antigo pode carregar pixel que a conta perdeu).

## Design

### Camada 1 — Builder (conserta a causa raiz, feedback imediato)

Arquivo: `app/campaigns/ClientCampaignBuilder.tsx`.

1. **Reset de pixel órfão.** Novo efeito: quando a lista de pixels da conta
   terminar de carregar com sucesso (`!pixelsRes.loading && !pixelsRes.error`)
   e `pixelId` estiver preenchido mas ausente de `pixels[]` → `setPixelId('')`.
   O auto-select existente (linha 2140) então escolhe o primeiro pixel da
   conta nova; se a conta não tem pixels, o campo fica vazio e a trava
   existente ("Selecione um pixel.") bloqueia o botão de publicar.
   - Não resetar durante loading nem sob erro de fetch (a lista pode estar
     vazia por falha transitória, não por falta de acesso).
   - Não conflita com o reopen-snapshot (estágio 3): o snapshot já aplica
     pixel apenas se estiver na lista (`apply-if-valid-else-skip`), então um
     pixel aplicado pelo snapshot nunca é órfão.

2. **Validação de pertencimento.** Na lista de erros de submit, além do check
   de presença: se `!isEngagement && pixelId && !pixels.some(p => p.id ===
   pixelId)` → erro "O pixel selecionado não pertence a esta conta." (cinto e
   suspensório — com o item 1 esse estado não deveria ocorrer, mas se ocorrer
   o botão trava em vez de publicar errado).

### Camada 2 — Worker pre-flight (trava de verdade; cobre broadcast e fila)

Arquivo: `lib/meta-campaigns.ts`, início de `createCampaignBatch` (linha
~1966), **antes de criar qualquer entidade**:

1. **Vendas sem pixel → falha imediata.** Se
   `campaign.objective !== 'OUTCOME_ENGAGEMENT'` e
   `adset.promoted_object?.pixel_id` estiver ausente → o job falha na hora com
   mensagem clara ("Campanha de vendas sem pixel — selecione um pixel no
   builder."). Nada é criado.

2. **Pixel presente → verificação de acesso.** GET
   `act_{account_id}/adspixels?fields=id` (paginado) com o token do job; se o
   `pixel_id` não estiver na lista → o job falha com "A conta {conta} não tem
   acesso ao pixel {pixel} — selecione um pixel desta conta." Nada é criado.
   Custo: 1 chamada Graph por job (contas têm poucos pixels; paginação
   raramente necessária).

3. **Fail-open em erro transitório do check.** Se a própria chamada
   `adspixels` falhar (rate limit #4/#17, erro de rede), o pre-flight loga um
   evento de aviso e **prossegue** — o objetivo é falhar cedo e limpo, não
   criar um novo ponto de indisponibilidade. Nesse caso a Meta ainda rejeita
   na criação, como hoje.

4. Engagement (`OUTCOME_ENGAGEMENT`) pula o pre-flight inteiro (não usa
   pixel).

A falha do pre-flight usa o mesmo mecanismo de erro/evento que as falhas de
fase existentes (evento `Falhou` na fila com a mensagem acima), mantendo o
botão "Reabrir no builder" funcional para corrigir e reenviar.

## Fluxo de erro resultante

- Caso comum (pixel órfão após troca de conta): resolvido silenciosamente no
  builder (reset + auto-select) ou bloqueado no botão com mensagem clara.
- Broadcast multi-conta / re-enfileiramento com pixel inacessível: job falha
  em segundos na fila, com mensagem acionável, **sem criar campanha nem
  conjunto** — fim das campanhas semi-criadas.

## Testes

- **Unit (vitest, `lib/__tests__/`)** para o pre-flight com Graph mockado:
  1. vendas sem `pixel_id` → falha antes de qualquer criação;
  2. `pixel_id` fora da lista de `adspixels` → falha antes de qualquer criação;
  3. `pixel_id` presente na lista → prossegue normalmente;
  4. objetivo engagement → pre-flight pulado;
  5. erro na chamada `adspixels` → aviso + prossegue (fail-open).
- **Builder:** teste da lógica de reset (função pura extraída ou teste de
  efeito, seguindo o padrão existente); validação de pertencimento coberta
  junto.
- Suite completa (`vitest`), `tsc` e `next build` verdes antes de concluir.

## Fora de escopo

- Validar públicos/catálogos órfãos na troca de conta (mesma classe de bug,
  outra feature — registrar como follow-up se desejado).
- Mudanças na rota `/api/campaigns/create` (o pre-flight no worker cobre
  todos os caminhos de entrada da fila).
