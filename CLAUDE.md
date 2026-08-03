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
- O arquivo de regras é **um só para o projeto Firebase inteiro**, e o projeto é
  dividido com o app dos clientes (`backhenry/cinerea-app`, privado): as regras
  de `clientes/` moram no mesmo arquivo. Publicar só a metade daqui apaga a de
  lá. O arquivo é idêntico nos dois repos — mudou em um, copie no outro. Publica-
  se a partir do `cinerea-app`.
- Criar empresa exige um documento em `gestores/{uid}`. Sem isso, qualquer conta
  autenticada abria empresa — inclusive um cliente do app, que usa o mesmo Auth.
  A coleção é `read, write: if false`: invisível para os dois apps, só o Console
  escreve. O `exists()` das regras roda no servidor e não passa pelas regras.

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

## Revisão de interface (ago/2026)

Três passadas na camada que vale para as 15 telas, em vez de redesenhar uma a
uma. O que ficou como regra:

**O rótulo das células no celular vem do `<thead>`, sozinho.** No celular a
tabela vira cartão e o cabeçalho some; quem diz o que é cada valor é o `data-l`
da célula, desenhado por `td::before{content:attr(data-l)}`. O mecanismo existia
desde sempre e estava praticamente sem uso: **5 células tinham `data-l` e 136
não** — a tabela de peças saía como sete números empilhados sem dizer qual é
custo, qual é preço e qual é margem.

Sair escrevendo `data-l` em 136 lugares consertaria hoje e voltaria a quebrar na
próxima coluna, sem erro nenhum para avisar: foi assim que se chegou a 136. Um
`MutationObserver` chama `rotularCelulas`, que lê o cabeçalho — as tabelas são
preenchidas em dezenas de funções, e qualquer lista de chamadas fica incompleta
do mesmo jeito. **Coluna nova nasce rotulada.**

Qual coluna titula o cartão é decisão de cada tabela, no `<th data-titulo>`:
Pedidos, Produção e Compras começam pela data, e um cartão intitulado "12/07"
não diz de quem é o pedido. Quem não declara cai na primeira coluna.

**Nada de emoji na interface.** Eram 18, entre botões e avisos. Quem desenha
emoji é o sistema operacional — lixeira cinza no macOS, verde no Android — e a
cor da marca não alcança, nem o tema escuro. Pior: `✎ ◈ ⟳ ▶ ◀ ✕ ✉` nem são
emoji, são símbolos de texto, e viram retângulo vazio onde o glifo não existe.
São 21 ícones em `ICONES`, desenhados no mesmo grid de 24 e herdando
`currentColor` — é isso que os faz acompanhar hover e tema escuro de graça.
`tests/tabelas.test.mjs` falha se algum voltar.

Ficaram de propósito os dois que são CONTEÚDO e não interface: a vela na
mensagem de WhatsApp e no rodapé do recibo, que é voz da marca indo para o
cliente.

**Números alinham à direita, com `tabular-nums`.** Sem isso o "1" é estreito e o
"0" é largo, as casas decimais dançam de linha em linha, e comparar R$ 112,00
com R$ 19,50 vira leitura caractere a caractere. Quem decide se a coluna é
numérica é o CONTEÚDO (`alinharColunasNumericas` olha a classe `.money`), e não
uma lista de nomes de coluna — que ficaria desatualizada como os `data-l`
ficaram.

**Os avisos do painel têm nível, e o nível vem escrito.** Iam todos para uma
caixa cinza única separada por `<br>`: "peça hoje ou a produção para" do lado de
"esse insumo ficou 14% mais caro". Quando tudo tem a mesma urgência, nada tem.
A palavra ao lado do ícone não é enfeite: vermelho e âmbar são o par que mais
gente confunde, e é exatamente o par que separa "peça hoje" de "vale cotar".

**Dois níveis de aba não podem se parecer.** Grupo com fio embaixo, subgrupo em
pastilha preenchida. E a barra avisa quando há mais à direita, e traz a aba
ativa para dentro do campo de visão — no celular cabem 5 dos 6 grupos, e abrir
em Ajustes deixava a barra parecendo sem seleção.

**`.hint` vale pela classe, não só dentro de `.field`.** Toda dica fora de um
campo saía em 14px na cor do texto, do tamanho do conteúdo.

**O ícone é inline por padrão.** Como bloco, todo uso ao lado de texto quebrava
a linha. Dentro de botão só de ícone o bloco é a exceção declarada.

Armadilhas que apareceram no caminho, e que voltam:

- **`:first-of-type` conta por TIPO de elemento, não por classe.** Usei para
  separar seções e a regra pegou o cabeçalho do painel também. O que se quer
  dizer é `.panel-head ~ .panel-head`.
- **`position:sticky` não funciona dentro de `overflow:hidden`**, que era como o
  canto arredondado da tabela era feito. Tirando o recorte, o arredondado tem de
  vir das células dos cantos.
- **O service worker serve o CSS velho.** Ele me enganou três vezes durante a
  revisão, do mesmo jeito que já enganou ~10 deploys. Medir num `?v=` só troca o
  HTML: o `styles.css` continua vindo do cache.
- **Aba escondida congela `requestAnimationFrame`.** Esperar por quadro no painel
  do navegador trava sem erro. Medir direto, ou buscar o instante.

## Pendente / próximo
- Domínio próprio: passos no README (exige compra do domínio pelo dono).
- Push com app fechado (FCM + backend) se a equipe sentir falta.

## Ideias de próximos passos (do dono do projeto)
- Migrar o app para GitHub Pages ou Netlify com deploy automático.
- Possível: separar o `index.html` em arquivos (css/js) se crescer muito.
