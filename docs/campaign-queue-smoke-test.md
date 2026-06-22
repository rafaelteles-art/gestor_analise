# Smoke test — Campaign Queue + 8 features (produção)

> 🔒 **REGRA DE OURO — segurança contra gasto real**
> 1. Em **toda** campanha, marque **"Publicar pausado"** (status PAUSED). Pausada não gasta.
> 2. Use **1 conta de teste** + orçamento diário **mínimo** (rede de segurança extra).
> 3. Catálogo/product set/pixel reais, mas página/conta de teste.
> 4. No fim: deixe pausado ou **exclua** as campanhas de teste no Ads Manager.
> Só remova o PAUSED depois que TODOS os cenários abaixo passarem.

## Pré-setup (F3 nicknames, F2 busca)
- [ ] Em **Status de contas**, defina um **apelido** na conta de teste — ex.: `TESTE-QA` (lápis ao lado do nome). → confirma F3.
- [ ] No **builder de campanhas**, abra os dropdowns de Conta/Página/Pixel/Catálogo: digite pra **filtrar** e confirme que a busca funciona. → confirma F2.
- [ ] Confirme que a conta aparece como **`TESTE-QA`** (apelido) no seletor, com o nome real embaixo.

---

## Cenário 1 — Núcleo: fila + Drive + nome default + separação por Conjunto (não-DPA)
Cobre **F1 (fila), F2, F4 (Drive), F5 (nome default não-DPA), F7 (adset), nicknames no nome.**
- [ ] Conta: só a de teste. Página + pixel via combobox.
- [ ] Template de nome da campanha: deixe `[{{conta}}] {{orcamento}} {{estrutura}} - {{criativo}} - {{data}}`.
- [ ] 2 criativos:
  - Criativo A: **"Importar do Google Drive"** → escolha um vídeo/imagem no Picker. → F4
  - Criativo B: upload normal **com o nome em branco**. → F5 (espera: nome = nome do arquivo sem extensão)
- [ ] Separação = **Conjunto (adset)**; counters 1×1×1.
- [ ] **Publicar pausado** ✔ → **Criar/Enfileirar**.
- [ ] **Verificar na hora:** o **QueueWidget** aparece com o job; em `/campaigns/fila` o job vai `pendente → rodando → concluído` (começa em <~5s pelo kick). Abra o detalhe: eventos por entidade (created) e counts. → F1
- [ ] **Verificar no Meta (Ads Manager):**
  - **1 campanha** (compartilhada), **2 conjuntos** (um por criativo). → F7 adset
  - Nome da campanha começa com **`[TESTE-QA]`** (apelido), não o nome cru. → F3
  - Criativo A: a mídia veio do Drive (imagem/vídeo presente). → F4
  - Criativo B: nome do anúncio = nome do arquivo sem extensão. → F5

## Cenário 2 — DPA: nome default do product set + mídia dinâmica/priorizar vídeos + separação por Anúncio
Cobre **F5 (DPA), F7 (ad), F8 (flags DPA).**
- [ ] Ative DPA, selecione **catálogo** + **product set** (idealmente um com data no nome, ex. `LT1100.5 - 06/06`).
- [ ] Criativo com **nome em branco**. → espera: nome = product set **sem a data** (`LT1100.5`). → F5 DPA
- [ ] Separação = **Anúncio (ad)**; ≥2 criativos pra ver o agrupamento (1 campanha, 1 conjunto, N anúncios).
- [ ] **Pausado** ✔ → Enfileirar → fila conclui.
- [ ] **Meta:** 1 campanha / 1 conjunto / N anúncios. → F7 ad
- [ ] F8 (mídia dinâmica + priorizar vídeos): difícil ver no Ads Manager; o sucesso da criação DPA já valida o payload (testado em código). **Me avise que eu confirmo os flags via API se quiser certeza.**

## Cenário 3 — Templates expandidos + aplicar em outra conta
Cobre **F6 (apply-if-valid-else-skip).**
- [ ] No cenário 1 ou 2, **Salvar template** (captura pixel, audiences, catálogo, product set, textos, template de nome, separação).
- [ ] Troque para **outra conta** e **Aplicar template**.
- [ ] Espera: estrutura/textos/nome aplicam; IDs específicos de conta (pixel/catálogo/product set/audiência) aplicam **se existirem** na nova conta, senão são **pulados com aviso** ("ignorados: …"). → F6

## Cenário 4 — Broadcast por conta (fix d1a761a)
Cobre **broadcast multi-conta + naming por conta.**
- [ ] Defina apelidos **diferentes** em 2 contas de teste (ex. `QA-1`, `QA-2`).
- [ ] Selecione as **2 contas**, mesmo payload, **pausado** → Enfileirar.
- [ ] Espera em `/campaigns/fila`: **um job por conta** (mesmo broadcast group).
- [ ] **Meta:** as campanhas da conta 1 levam **`[QA-1]`** e as da conta 2 **`[QA-2]`** — cada uma com a SUA identidade (não clonando a primeira). → fix d1a761a

## Cenário 5 — Controles da fila (cancelar + re-enfileirar)
Cobre **F1 (cancelar, re-enqueue).**
- [ ] Enfileire um job maior (ex. 3 criativos × 2 conjuntos), **pausado**.
- [ ] **Cancele** com ele rodando → para na próxima entidade; status `cancelado`; entidades já criadas permanecem.
- [ ] No histórico, **Re-enfileirar** um job concluído → novo job roda; `{{data}}` reflete a hora do **re-enqueue** (não a original).

---

## Matriz de cobertura
| Feature | Cenário |
|---|---|
| F1 fila (enqueue/kick/poll/histórico) | 1, 5 |
| F1 cancelar + re-enfileirar | 5 |
| F2 dropdowns com busca | pré-setup, 1 |
| F3 apelido de conta + `{{conta}}` | pré-setup, 1, 4 |
| F4 Google Drive Picker + download no worker | 1 |
| F5 nome default (arquivo / product set sem data) | 1, 2 |
| F6 templates expandidos + apply-if-valid-else-skip | 3 |
| F7 separação (campaign/adset/ad) | 1 (adset), 2 (ad) |
| F8 DPA mídia dinâmica + priorizar vídeos | 2 (via API, sob demanda) |
| broadcast por conta (d1a761a) | 4 |

## Quem verifica o quê
- **Você (UI/Ads Manager):** fluxo da fila, estrutura/nomes/mídia das entidades no Meta.
- **Eu (backend, sob demanda):** posso consultar a tabela `campaign_jobs` em prod pra confirmar transições de status, eventos por entidade, `run_state` (checkpoints/resume) e counts — verificação independente da UI. Posso também checar os flags DPA (F8) via Graph API. É só pedir.
