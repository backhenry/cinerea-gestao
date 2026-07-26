# Contexto para o Claude Code — Projeto Cinérea Gestão

Este arquivo orienta o Claude Code ao trabalhar neste repositório.

## O que é
App de gestão de um ateliê de velas e objetos de gesso (marca Cinérea). Um único
`index.html` estático, com Firebase (Auth + Firestore) para login e sincronização
em nuvem. Sem build, sem framework — HTML, CSS e JS puro, com Chart.js via CDN.

## Arquitetura
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

## Pendente / próximo
- Separar index.html em arquivos (css/js) — adiado de propósito: refatorar junto
  com a migração multi-usuário aumentaria o risco. Fazer numa mudança isolada.
- Domínio próprio: passos no README (exige compra do domínio pelo dono).

## Ideias de próximos passos (do dono do projeto)
- Migrar o app para GitHub Pages ou Netlify com deploy automático.
- Possível: separar o `index.html` em arquivos (css/js) se crescer muito.
