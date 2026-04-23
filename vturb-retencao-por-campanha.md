# Retenção por campanha FB usando dados Vturb

Explicação didática do fluxo: como cruzar cliques do Facebook Ads com
eventos do Vturb (play, pitch, click) para trazer retenção **por
campanha FB**.

## O problema a resolver

O Facebook sabe quantas pessoas **clicaram** no anúncio.
O Vturb sabe quantas pessoas **assistiram o vídeo**, **passaram do
pitch**, **clicaram no botão de compra**.

Entre o clique no anúncio e a compra existe uma etapa que o FB não
enxerga: **o vídeo de vendas (VSL)**. A retenção mostra onde está
vazando: o ad atrai bem mas o vídeo não retém? O vídeo retém mas
ninguém clica no botão?

Para conectar os dois lados, o truque é simples: **marca-se o link do
ad com um identificador da campanha e o Vturb grava esse identificador
nas sessões dele.** Quando busca depois, cruza por esse identificador.

## Passo 1 — Marcar o link do ad com UTM

Na hora de criar a campanha no FB, o link que vai no ad precisa ter um
parâmetro `utm_campaign` contendo o `campaign_id` do Facebook. Padrão
usado:

```
https://landing.com/?utm_campaign=Nome+da+campanha|{{campaign.id}}
```

O FB substitui `{{campaign.id}}` pelo ID numérico real da campanha no
momento do clique. A página do VSL abre, o Vturb carrega e
automaticamente captura as query strings — incluindo esse
`utm_campaign`.

**Formato: `nome|campaign_id`** (separados por pipe `|`). É isso que
depois vai ser extraído.

## Passo 2 — Agregação interna do Vturb

Quando uma pessoa entra no VSL, o Vturb cria uma sessão e registra os
eventos dela:

- `viewed` — carregou o player
- `started` — apertou play
- `over_pitch` — passou do ponto do pitch
- `clicked` — clicou no botão de compra

Cada evento fica associado à sessão, e a sessão mantém o `utm_campaign`
capturado na URL. O Vturb guarda tudo agrupado por dia + por player +
pelas UTMs.

## Passo 3 — Busca na API Vturb

A API Vturb Analytics (`analytics.vturb.net` v1) tem 3 endpoints
relevantes. Autenticação via header `X-Api-Token` + `X-Api-Version: v1`.

### (a) `GET /players/list`
Lista todos os players da conta. Retorna um array com
`{ id, name, duration, pitch_time, ... }`.

### (b) `POST /events/total_by_company_players`
Filtra só os players que tiveram `viewed > 0` no período. Evita queries
desnecessárias em VSLs inativos.

Body:
```json
{
  "events": ["viewed"],
  "start_date": "2026-04-14",
  "end_date": "2026-04-20",
  "players_start_date": [
    {"player_id": "abc", "start_date": "2026-04-14"},
    ...
  ]
}
```

### (c) `POST /traffic_origin/stats`  ← **principal**
Para cada player ativo, pede estatísticas agrupadas por `utm_campaign`.

Body:
```json
{
  "player_id": "abc",
  "start_date": "2026-04-14 00:00:00",
  "end_date": "2026-04-20 23:59:59",
  "query_key": "utm_campaign",
  "video_duration": 900,
  "pitch_time": 600,
  "timezone": "America/Sao_Paulo"
}
```

Resposta:
```json
[
  {
    "grouped_field": "Nome da campanha|120244590029080215",
    "total_viewed": 250,
    "total_started": 180,
    "total_over_pitch": 90,
    "total_clicked": 35,
    "total_clicked_device_uniq": 30
  },
  ...
]
```

Cada linha é um `utm_campaign` distinto. O **`grouped_field`** vem no
formato `nome|campaign_id` porque é isso que foi colocado na UTM.

## Passo 4 — Extrair o campaign_id

```js
function extractCampaignId(groupedField) {
  if (!groupedField) return null;
  const parts = groupedField.split('|');
  return parts.length > 1 ? parts[parts.length - 1].trim() : null;
}
```

Pega a última parte depois do pipe. Resultado:
`"120244590029080215"` — o ID da campanha FB.

## Passo 5 — Agregar por campanha

Um mesmo `campaign_id` pode aparecer em **múltiplos players** (quando
um criativo manda tráfego para mais de um VSL, ou quando existem
variações A/B do player). Soma tudo num `vturbMap`:

```js
const vturbMap = {};

for (const entry of response) {
  const campId = extractCampaignId(entry.grouped_field);
  if (!campId) continue;

  if (!vturbMap[campId]) {
    vturbMap[campId] = {
      total_viewed: 0, total_started: 0,
      total_over_pitch: 0, total_clicked: 0,
      total_clicked_uniq: 0,
      players: []
    };
  }

  vturbMap[campId].total_viewed     += entry.total_viewed || 0;
  vturbMap[campId].total_started    += entry.total_started || 0;
  vturbMap[campId].total_over_pitch += entry.total_over_pitch || 0;
  vturbMap[campId].total_clicked    += entry.total_clicked || 0;
  vturbMap[campId].total_clicked_uniq += entry.total_clicked_device_uniq || 0;
  vturbMap[campId].players.push({ /* detalhe por player se quiser drill-down */ });
}
```

## Passo 6 — Calcular as taxas de retenção

A partir dos totais agregados:

```js
for (const cid of Object.keys(vturbMap)) {
  const a = vturbMap[cid];
  a.play_rate       = a.total_viewed     > 0 ? a.total_started    / a.total_viewed     * 100 : 0;
  a.over_pitch_rate = a.total_started    > 0 ? a.total_over_pitch / a.total_started    * 100 : 0;
  a.click_rate      = a.total_over_pitch > 0 ? a.total_clicked    / a.total_over_pitch * 100 : 0;
}
```

Três pontos de vazamento possíveis:

- **play_rate baixo** → thumbnail / primeiros 3s do vídeo não seguram atenção
- **over_pitch_rate baixo** → o meio do vídeo é chato, gente desiste antes da oferta
- **click_rate baixo** → chegou na oferta mas não convenceu

## Passo 7 — Juntar com os dados FB no frontend

A resposta da API tem duas estruturas paralelas:

- `facebook.rows` → lista de campanhas com spend, CTR, CPC, purchases, etc. (uma linha por `campaign_id`)
- `vturb` → o `vturbMap` (chaveado por `campaign_id`)

O **frontend** faz o join: ao renderizar a linha da campanha, busca
`vturb[campaign_id]` e exibe `play_rate`, `over_pitch_rate`,
`click_rate` ao lado das métricas FB.

**A junção é feita no front por lookup de chave**, não via SQL ou JOIN
no backend.

```jsx
{rows.map(row => {
  const vt = vturbMap[row.campaign_id];
  return (
    <tr key={row.campaign_id}>
      <td>{row.name}</td>
      <td>{row.spend}</td>
      <td>{row.ctr}</td>
      <td>{vt ? `${vt.play_rate.toFixed(1)}%` : '—'}</td>
      <td>{vt ? `${vt.over_pitch_rate.toFixed(1)}%` : '—'}</td>
      <td>{vt ? `${vt.click_rate.toFixed(1)}%` : '—'}</td>
    </tr>
  );
})}
```

## Resumo do fluxo

```
FB Ad (URL com utm_campaign=nome|{{campaign.id}})
         ↓
    Usuário clica
         ↓
    Landing/VSL carrega (Vturb captura utm_campaign)
         ↓
    Vturb registra eventos (viewed, started, over_pitch, clicked)
         ↓
    [Backend]
    1. GET /players/list              → lista players
    2. POST /events/...                → filtra players ativos
    3. POST /traffic_origin/stats      → 1 chamada por player, agrupado por utm_campaign
    4. Extrair campaign_id de "nome|campaign_id"
    5. Agregar se mesmo campaign_id aparece em vários players
    6. Calcular play_rate, over_pitch_rate, click_rate
         ↓
    Frontend: row_fb.campaign_id → vturbMap[campaign_id]
         ↓
    Renderiza retenção por campanha na tabela
```

## Pegadinhas comuns

### 1. UTM não está sendo passada
O `{{campaign.id}}` do FB precisa estar exatamente assim, com chaves
duplas. Se o ad usa URL custom (pixel tracking ou redirect), confirmar
que a UTM sobrevive ao redirect.

### 2. Formato do `grouped_field` diferente do esperado
Se o tracking padrão for `campaign_id|nome` em vez de
`nome|campaign_id`, ajustar a função extratora para pegar a primeira
parte em vez da última.

### 3. Rate limit da Vturb
Chamar `traffic_origin/stats` uma vez por player em paralelo é
agressivo. Se houver 30+ players, usar `Promise.allSettled` com
timeout individual (ex: 8s por chamada).

### 4. Token Vturb Analytics ≠ token do player embed
`analytics.vturb.net` usa `X-Api-Token` no header.
**Não é o mesmo token** do player embed. Confundir os dois gera 401.

### 5. `campaign_id` pode não existir no Vturb
Nem toda campanha FB manda tráfego para VSL Vturb. No frontend,
fallback para "—" quando `vturbMap[campaign_id]` for undefined.

### 6. Mais de um produto na conta Vturb
Se a conta Vturb tem players de produtos diferentes, o
`traffic_origin/stats` devolve tudo junto. Filtrar no front por nome
do player ou product_id se precisar segmentar.

### 7. Timezone
Os endpoints Vturb aceitam `timezone` no body. Usar sempre o mesmo
timezone do dashboard do usuário (ex: `America/Sao_Paulo`) para
evitar desalinhamento entre "dia no FB" e "dia no Vturb".

### 8. Players sem `duration`
`duration: 0` costuma ser player de teste/placeholder. Filtrar
(`p.duration > 0`) antes de chamar `traffic_origin/stats` — evita
chamadas desnecessárias e divisões por zero no cálculo de taxas.

## Caching

Se for construir em produção:

- Cache no Redis por ~10 minutos por (dashboard, dia, since, until)
- Invalida quando troca o range de data selecionado
- TTL curto porque `viewed` e `clicked` continuam chegando ao longo do
  dia, mas a volatilidade já é baixa (uma chamada a cada 10min serve)

## Verificação rápida

Para testar se o cruzamento está funcionando:

1. Pegue um `campaign_id` que você sabe que mandou tráfego hoje
2. No painel Vturb, abra o player e veja se aparece `utm_campaign`
   contendo esse ID
3. Chame o endpoint `/traffic_origin/stats` e confira se o
   `grouped_field` retornado tem esse ID no final
4. No front, veja se `vturbMap[campaign_id]` tem dados para aquela
   linha da tabela
