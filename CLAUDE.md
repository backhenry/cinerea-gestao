# Contexto para o Claude Code — Projeto Cinérea Gestão

Este arquivo orienta o Claude Code ao trabalhar neste repositório.

## O que é
App de gestão de um ateliê de velas e objetos de gesso (marca Cinérea). Um único
`index.html` estático, com Firebase (Auth + Firestore) para login e sincronização
em nuvem. Sem build, sem framework — HTML, CSS e JS puro, com Chart.js via CDN.

## Arquitetura
- `core.js` — NÚCLEO PURO (sem DOM/Firestore): calcCusto, precoProduto, lucroPedido,
  saldoPedido, custoMedio, baixasProducao, diasEstoque, pontoEquilibrio,
  scoreFornecedor, cestaOtima, curvaABC, fechamentoMes, validar() e RAMOS/sementeRamo.
  É o que `tests/core.test.mjs` cobre (31 testes, `npm test`, sem emulador).
  `app.js` importa e injeta `db` via wrappers; calcCusto é memoizado (limparMemo()
  em rebuildDb/cloudSave).
- Renderização por aba: RENDER_ABA + abaAtiva() — só a aba visível é redesenhada.
  Paginação de 50 em 50 (PAG/maisLinhas/linhaMais) em produção, pedidos e compras.
- `index.html` — todo o app (estilos no `<style>`, lógica num `<script type="module">`)
- `config.js` — chaves do Firebase, carregado antes do módulo. FICA FORA DO GIT.
- MULTI-USUÁRIO: dados ficam em `empresas/{eid}`, campo `dados`, estrutura
  `{equip, moldes, insumos, produtos, producao, pedidos, compras, fixos, clientes,
  canais, tarefas, meta, meiTeto, catWhats, conviteAtual, ultimoBackup, checks}`.
  Doc da empresa tem também `{nome, dono}`. Membros: subcoleção
  `empresas/{eid}/membros/{uid}` ({nome, codigo?, entrou}). Backups mensais em
  `empresas/{eid}/backups/{AAAA-MM}` (mantém ~6). Convites: `convites/{codigo}`
  → {empresaId} (o código é o segredo). `usuarios/{uid}` guarda o ponteiro
  `{empresaId}` + `dados` legados (migração automática em carregarConta()).
- Catálogo público: doc `catalogo/{eid}` (leitura aberta, escrita de membros),
  renderizado por `catalogo.html?u={eid}`.
- Concorrência: o doc da empresa é salvo inteiro (last-write-wins). Para equipes
  pequenas ok; se crescer, dividir `dados` em docs por coleção.
- Salvamento é debounced (400ms) e a UI ouve mudanças via `onSnapshot` (tempo real).

## Convenções
- Paleta da marca (variáveis CSS `:root`): papel #F2EFEA, carvão #1C1A17,
  brasa #B5462A (acento, uso <10%), mais tons neutros. Tipografia Fraunces + Inter.
- Texto e comentários em português.
- Nada de dependência pesada: manter o app como um HTML que abre sozinho.

## Segurança
- NUNCA commitar `config.js` nem chaves. Já está no `.gitignore`.
- As regras do Firestore (em `docs/firestore.rules`) restringem cada usuário aos
  próprios dados — não afrouxar.

## Já implementado (julho/2026)
- Baixa de estoque reversível (produção guarda snapshot `baixas`/`usosMolde`).
- Estoque de peças prontas (`produto.pronto`): produção soma, pedido Entregue baixa.
- Pedidos ligados a produtos (campo `produto` + `qtd`) com lucro por venda.
- Depreciação de equipamento no custo (`equip.vidaHoras`, `produto.equip`).
- Variação/fragrância e lote automático na produção; botão Comprei na lista de compras.
- Escape de HTML (`esc()`) em todos os renders; backup/restauração JSON.
- PWA (sw.js + manifest.webmanifest + icon.svg) e cache offline do Firestore.
- Histórico de compras (`db.compras`) com custo médio ponderado do insumo
  (snapshot `estoqueAntes`/`custoAntes` para reverter em edição/exclusão).
- Custos fixos mensais (`db.fixos`, na aba Orçamento) e ponto de equilíbrio no Painel.
- Meta mensal de receita (`db.meta`) com barra de progresso no Painel.
- Clientes (`db.clientes`) e canais de venda com taxa (`db.canais`); `lucroPedido()`
  usa a taxa do canal. Prazo de entrega no pedido + bloco de encomendas no Painel.
- Filtros de busca/mês (`fP`/`fV`), undo na exclusão (`toastUndo`/`doUndo`),
  tabelas viram cartões no mobile via `labelize()` + CSS `data-l`.
- Catálogo público (`publicarCatalogo()` → doc `catalogo/{eid}` + `catalogo.html`,
  com CTA de WhatsApp por peça); foto por URL no produto (`foto`, `publico`).
  Teto MEI (`db.meiTeto`) no Painel.
- Ícones PNG 192/512 gerados da marca (também `purpose: maskable`).
- Equipe (aba nova): kanban de tarefas (`db.tarefas`, status aberta/fazendo/feita,
  responsável = uid de membro), convite por código, remover membro (só dono).
- PAPÉIS/governança: membros/{uid}.papel ∈ {admin, socio, empregado}; dono = empresa.dono.
  meuPapel()/pode(cap): 'gerir' = dono/admin (convites, papéis, remover, nome da
  empresa, restaurar backup); 'fin' = dono/admin/socio (orçamento, lucro, fechamento,
  metas, MEI, exports, catálogo). Empregado: só operação — aplicarPapel() esconde
  aba Orçamento, cartões/gráficos financeiros e colunas Valor/Lucro (classe .no-fin).
  Convites carregam papel (db.convitesPorPapel). Regras do Firestore validam:
  papel do membro = papel do convite, self-update só do nome, update da empresa
  por não-gestor limitado a dados/atualizado, dono imutável.
  LIMITAÇÃO: dados ficam num doc único — a ocultação financeira é de interface;
  um empregado tecnicamente hábil lê o doc via console. Enforcement real exige
  dividir os dados em docs separados por sensibilidade (próximo passo se necessário).
- Perfil (openPerfil/salvarPerfil): nome no time, e-mail (updateEmail com reauth,
  fallback verifyBeforeUpdateEmail), senha, nome da empresa (dono), tema
  claro/escuro/auto e cor de destaque (prefs em usuarios/{uid}.prefs + localStorage;
  tema via :root[data-tema], acento via --ember; gráficos leem cores das CSS vars).
  "Esqueci a senha" no login; sair da empresa (não-dono); badge de tarefas minhas
  na aba Equipe + filtro "Só minhas".
- Cronômetro no form de produção (toggleTimer), botão ⟳ repetir em produção/pedidos,
  frete por pedido (entra no lucroPedido), cartão "A receber", plano de produção
  no Painel, fechamento mensal DRE (exportDRE), backup automático mensal
  (checkBackup), aviso de atualização do PWA (SKIP_WAITING) e CI de sintaxe no deploy.

- ARQUIVOS SEPARADOS: index.html (estrutura) + styles.css + app.js (módulo).
- FINANCEIRO SEPARADO: doc empresas/{eid}/fin/dados guarda FIN_KEYS
  (fixos, meta, meiTeto, ultimoBackup) e prodFin (preco/markup/taxa/custohora/
  perda/equip por produto). rebuildDb() mescla em `db`; splitDb() divide no save
  (cloudSave usa updateDoc p/ substituir `dados` inteiro). Migração automática
  (migrarFinSePreciso) no primeiro login de quem tem acesso fin. Regras: ehFin =
  dono/admin/sócio; empregado é NEGADO no servidor (fin e backups).
- Equipe: atividade (db.atividade, logAtv, cap 60, sem valores), autoria (obj.por),
  comentários em tarefas (t.coments), drag-and-drop no kanban, calendário de
  entregas no Painel (renderCal), slider de markup no produto, múltiplas empresas
  por conta (usuarios/{uid}.minhasEmpresas + troca no perfil).
- SOURCING: db.cotacoes — gerarCotacao() cria .xlsx (SheetJS via CDN) da lista de
  compras com colunas ocultas (H1 = 'CINEREA-RFQ:{id}', col H = id do insumo);
  fornecedor preenche D/E/F; importarCotacao() lê o arquivo, casa pelo marcador e
  guarda resposta por fornecedor; verCotacao() compara preços (melhor em verde).
- TESTES: tests/rules.test.mjs + tests/flows.test.mjs rodam no emulador
  (npm run test:rules; job test-rules no CI). Local exige Java; no CI já funciona.
- SOURCING v2: gerarCotacao() abre seleção de itens/quantidades (cotacaoSel);
  importar cria/liga fornecedor (db.fornecedores) automaticamente; 🛒 na
  comparação pré-preenche a compra; 📈 no insumo mostra histórico de preços
  (compras × cotações). Fornecedores têm CRUD próprio (selectFornecedor + quick-add).
- Pedidos: pagamentos parciais (p.pagamentos, addPagamento; Pendente vira Pago ao
  quitar; A receber desconta sinais). Plano de produção → botão "criar tarefa".
- Arquivamento: arquivarAno() (gestor) move produção/pedidos concluídos/compras do
  ano para empresas/{eid}/arquivo/{ano}; aviso no Painel quando dados >700 KB.
- Diagnóstico: window.onerror/unhandledrejection → empresas/{eid}/diag/erros.
- Notificações locais: pedirNotifs() no Perfil; checarNotifs() avisa tarefas novas
  atribuídas a mim e entregas do dia (sem FCM — push real com servidor fica p/ depois).

- Fornecedor completo: categoria, risco (Baixo/Médio/Alto), endereço e contatos
  internos (lista nome/cargo/whats em f.contatos, editados via currentForm.contatos).
- Planilha de cotação v2 (ExcelJS via CDN, só para GERAR; SheetJS segue lendo):
  logo da marca (icon-192 via fetch→base64), cores da paleta, células D/E/F
  destacadas e desbloqueadas, resto protegido (senha 'cinerea'), aba "Contato"
  (empresa, responsável, WhatsApp=catWhats, e-mail, endereço=db.endereco definido
  no Perfil). Layout: marcador em H1, header linha 4, itens da linha 5, ids na
  col H oculta — o importador continua compatível.
- SOURCING v3: cotação com validade, condições de pagamento e fornecedores-alvo
  (status parcial/completa/vencida; 💬 envia/cobra via WhatsApp com fila em
  c.enviados); comparação com coluna "Seu custo" + savings %, linha Cesta ótima,
  🖨 impressão; scoreFornecedor() (respostas, % melhor preço, prazo médio) no
  cadastro; gráfico de gasto de compras por mês (chCompras).
- ANÁLISES: seletor de período no Painel (periodoDash/corteMes, afeta chProd,
  chMes, chSemana, ABC, top clientes); tendência mês vs anterior e projeção no
  cartão Receita; curva ABC de produtos; top 5 clientes; receita por dia da
  semana; diasEstoque() (consumo 90d via baixas) na tabela de insumos; alerta de
  inflação de insumo (última compra vs custoAntes +10%); totais do filtro em
  Pedidos; DRE comparativa (mês vs anterior).
- Acabamento: recibo imprimível (🧾) e cobrança via WhatsApp (💬) no pedido,
  duplicar produto (⧉), Ver arquivo (consulta/baixa anos arquivados),
  produção do mês por membro (Equipe), busca global (🔍 no topo, atalho "/",
  abre o registro direto), Guia reescrito para o app atual.

## Consolidação (jul/2026)
- Onboarding pergunta o RAMO (velas/confeitaria/costura/marcenaria/vazio) e semeia
  conforme — antes toda empresa nova nascia com insumos e moldes da Cinérea.
  Rótulos por ramo (db.rotulos + rot()/aplicarRotulos): "Moldes" vira "Formas"
  ou "Gabaritos". seedIfEmpty agora só garante os canais de venda.
- Nome real da empresa gravado em usuarios/{uid}.minhasEmpresas no primeiro
  snapshot (quem entrava por convite via o placeholder "Empresa").
- Validação de entrada centralizada em Core.validar() (quantidade ≤ 0, valores
  negativos, taxa fora de 0-100, data fora de 2000-2100); erros via toast.
- Acessibilidade: role=tablist/aria-selected nas abas, aria-modal + foco que entra,
  circula (trap de Tab) e volta ao fechar, toast com aria-live, :focus-visible,
  alvos de 32px. Tema escuro recalibrado — texto secundário 7,4:1 (WCAG AA).
- Aba Compras dividida em sub-abas (lista/histórico/cotações/fornecedores).

## Expansões (jul/2026)
- REPOSIÇÃO PREDITIVA: Core.previsaoReposicao() cruza diasEstoque (consumo 90d)
  com o prazo do fornecedor (scoreFornecedor.prazoMed, preferindo quem já cotou
  aquele insumo; 7d de padrão). Diz "pedir até DD/MM"; alerta no Painel e dica
  na tabela de Insumos.
- PREÇO DEFASADO: Core.precoDefasado() compara a margem de hoje com `margemRef`
  (gravada no produto sempre que um preço manual é salvo; sem ela, usa o markup).
  Alerta no Painel + marca na tabela de Orçamento, com preço sugerido.
- SAZONALIDADE: Core.sazonalidade() → índice por mês do calendário (1 = média),
  exige 12 meses com venda; gráfico chSaz + nota sobre os próximos picos.
- PORTAL DO CLIENTE (`pedido.html?p={token}`): doc `portal/{token}` com o mínimo
  (item, valor, pago, prazo, etapa 0-3, whats). Botão 🔗 no pedido publica e manda
  pelo WhatsApp; syncPortal() reescreve ao editar o pedido ou registrar pagamento
  (onSnapshot no portal = cliente vê mudar ao vivo). Status novo "Em produção".
- PORTAL DO FORNECEDOR (`cotacao.html?c={token}`): doc `rfq/{token}` público com
  os itens; fornecedor envia proposta SEM login em `rfq/{token}/respostas` (create
  restrito por regra: só 3 campos, nome ≤120, ≤100 preços, bloqueado se `fechada`;
  sem read/update/delete para anônimos). No app: 🌐 publica/copia link, ⬇ importa
  respostas novas (dedupe por `rfqLidas`, cria fornecedor se preciso), 🔒 encerra.
  O Excel continua valendo — os dois caminhos caem na mesma lista de respostas.
  Campos de preço são type=text + inputmode=decimal (aceitam vírgula e ponto).

## Pendente / próximo
- Domínio próprio: passos no README (exige compra do domínio pelo dono).
- Push com app fechado (FCM + backend) se a equipe sentir falta.

## Ideias de próximos passos (do dono do projeto)
- Migrar o app para GitHub Pages ou Netlify com deploy automático.
- Possível: separar o `index.html` em arquivos (css/js) se crescer muito.
