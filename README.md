# Cinérea · Gestão

Sistema de gestão do ateliê Cinérea — equipamentos, moldes, insumos, orçamento,
produção e pedidos, com sincronização em nuvem (Firebase) e login.

## O que faz

- **Insumos** com estoque, alerta de reposição e **baixa automática** ao registrar produção
  (editar/excluir uma produção **devolve** o estoque e os usos do molde)
- **Moldes** com controle de vida útil (gesso ~40 usos, cera ~120)
- **Orçamento** por peça: receita de insumos + mão de obra + **depreciação de equipamento**,
  com custo, preço sugerido e margem
- **Produção** com tempo por peça, **variação/fragrância** e **lote automático**;
  soma ao estoque de **peças prontas**
- **Pedidos** ligados aos produtos: **lucro por venda** (com a taxa do **canal de venda**),
  **prazo de entrega** com alerta de atraso no painel, e baixa de peças prontas ao entregar
- **Clientes** com WhatsApp clicável e histórico de compras
- **Catálogo público** (`catalogo.html?u=...`): vitrine das peças marcadas como públicas,
  com foto, preço e botão de encomenda pelo WhatsApp — link para a bio do Instagram
- **Busca e filtro por mês** em produção e pedidos; **desfazer** ao excluir
- **Lucro por hora de trabalho** por produto (tabela e gráfico) e **acompanhamento do teto MEI**
- No celular, as tabelas viram **cartões** legíveis
- **Painel** com gráficos, alertas e visão **mês a mês** (receita e lucro)
- **Lista de compras** automática, com botão **✓ Comprei** que registra a compra
- **Histórico de compras** com **custo médio ponderado**: pagou mais caro, o custo
  do insumo (e o preço sugerido das peças) se atualiza sozinho
- **Custos fixos mensais** e **ponto de equilíbrio** ("quantas peças vender para empatar")
- **Meta de receita do mês** com barra de progresso no painel
- Exportação para **planilha (CSV)** e **PDF**, além de **backup/restauração** completos (JSON)
- **Funciona offline** (PWA): instala no celular e sincroniza quando a internet volta

## Como rodar localmente

Este é um app estático (um HTML). Para rodar:

1. Copie `config.example.js` para `config.js` e preencha com as chaves do seu
   projeto Firebase (Console do Firebase → Configurações do projeto → Seus apps).
2. Abra `index.html` num servidor local. O jeito mais simples:
   ```
   npx serve .
   ```
   ou, com Python:
   ```
   python3 -m http.server
   ```
3. Acesse o endereço que aparecer (ex.: http://localhost:3000).

> Abrir o `index.html` com dois cliques também funciona, mas rodar num servidor
> local evita bloqueios do navegador com módulos.

## Configuração do Firebase

Veja o guia completo em `docs/firebase-setup.md`. Resumo:
- Ativar **Authentication → E-mail/senha**
- Criar **Firestore Database**
- Publicar as **regras de segurança** (em `docs/firestore.rules`) — essenciais:
  garantem que cada usuário só acessa os próprios dados.

## Publicar

Com GitHub Pages ou Netlify. Lembre: `config.js` fica fora do Git, então no
ambiente publicado você adiciona as chaves conforme o serviço (ou, para um site
pessoal de uso próprio, sobe um `config.js` só naquele ambiente).

## Estrutura

```
index.html            o app inteiro
sw.js                 service worker (funcionamento offline)
manifest.webmanifest  manifesto PWA (instalar no celular)
icon.svg              ícone do app
config.example.js     modelo das chaves (copie para config.js)
config.js             suas chaves — NÃO versionado
docs/
  firebase-setup.md   passo a passo do Firebase
  firestore.rules     regras de segurança do banco
```

---
Feito para o ateliê Cinérea.
