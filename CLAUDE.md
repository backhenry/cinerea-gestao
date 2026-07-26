# Contexto para o Claude Code — Projeto Cinérea Gestão

Este arquivo orienta o Claude Code ao trabalhar neste repositório.

## O que é
App de gestão de um ateliê de velas e objetos de gesso (marca Cinérea). Um único
`index.html` estático, com Firebase (Auth + Firestore) para login e sincronização
em nuvem. Sem build, sem framework — HTML, CSS e JS puro, com Chart.js via CDN.

## Arquitetura
- `index.html` — todo o app (estilos no `<style>`, lógica num `<script type="module">`)
- `config.js` — chaves do Firebase, carregado antes do módulo. FICA FORA DO GIT.
- Dados ficam em Firestore no documento `usuarios/{uid}`, campo `dados`, com a
  estrutura `{equip, moldes, insumos, produtos, producao, pedidos, compras, fixos,
  clientes, canais, meta, meiTeto, catWhats, checks}`.
- Catálogo público: doc `catalogo/{uid}` (leitura aberta, escrita só do dono),
  renderizado por `catalogo.html?u={uid}`.
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
- Catálogo público (`publicarCatalogo()` → doc `catalogo/{uid}` + `catalogo.html`);
  foto por URL no produto (`foto`, `publico`). Teto MEI (`db.meiTeto`) no Painel.
- Ícones PNG 192/512 gerados da marca (também `purpose: maskable`).

## Ideias de próximos passos (do dono do projeto)
- Migrar o app para GitHub Pages ou Netlify com deploy automático.
- Possível: separar o `index.html` em arquivos (css/js) se crescer muito.
