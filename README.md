# Cinérea · Gestão

Sistema de gestão do ateliê Cinérea, equipamentos, moldes, insumos, orçamento,
produção e pedidos, com sincronização em nuvem (Firebase) e login.

**Multi-usuário:** os dados pertencem a uma **empresa**, e várias contas podem
entrar nela. O dono gera um **código de convite** (aba Equipe → Convidar) e cada
pessoa cria a própria conta e entra com o código. A aba **Equipe** tem um kanban
de tarefas (A fazer / Fazendo / Feito) com responsável e prazo.

**Papéis e governança**, o convite já define o papel; gestores trocam papéis
tocando no selo do membro na aba Equipe:

| | Dono | Admin | Sócio | Empregado |
|---|:-:|:-:|:-:|:-:|
| Operação (produção, insumos, pedidos, tarefas) | ✓ | ✓ | ✓ | ✓ |
| Financeiro (orçamento, lucro, fechamento, metas, exportações) | ✓ | ✓ | ✓ |, |
| Equipe (convidar, papéis, remover, nome da empresa, restaurar backup) | ✓ | ✓ |, |, |

O empregado vê o painel operacional (estoque, moldes, produção, prazos, plano de
produção) sem valores de venda, lucro ou metas.

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
  com foto, preço e botão de encomenda pelo WhatsApp, link para a bio do Instagram
- **Portal do cliente** (`pedido.html?p=...`): link onde ele acompanha a encomenda
  (etapa, prazo, saldo) e que se atualiza sozinho quando você muda o pedido
- **Portal do fornecedor** (`cotacao.html?c=...`): ele preenche a cotação online,
  sem login e sem Excel, e você importa as propostas com um clique
- **Reposição preditiva**: cruza seu consumo diário com o prazo do fornecedor
  ("peça o gesso até 12/08, acaba dia 20 e a entrega leva 6 dias")
- **Alerta de preço defasado**: avisa quando o custo subiu e o preço ficou para trás
- **Sazonalidade**: com um ano de histórico, mostra os meses fortes e antecipa os picos
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
- Publicar as **regras de segurança** (em `docs/firestore.rules`), essenciais:
  garantem que cada usuário só acessa os próprios dados.

## Domínio próprio (opcional)

Para usar `www.suamarca.com.br` em vez de `*.github.io`:
1. Compre o domínio (Registro.br, ~R$ 40/ano).
2. No GitHub: Settings → Pages → Custom domain → digite o domínio (isso cria um
   arquivo `CNAME` no repositório).
3. No painel DNS do registrador, crie um registro `CNAME` de `www` apontando para
   `backhenry.github.io` (e registros `A` do apex para os IPs do GitHub Pages).
4. Marque **Enforce HTTPS** quando o certificado for emitido (alguns minutos).

## Publicar

Com GitHub Pages ou Netlify. Lembre: `config.js` fica fora do Git, então no
ambiente publicado você adiciona as chaves conforme o serviço (ou, para um site
pessoal de uso próprio, sobe um `config.js` só naquele ambiente).

## Testes

```bash
npm test
```

Roda os 31 testes da lógica de cálculo (`core.js`), custo, margem, lucro por
pedido, custo médio, ponto de equilíbrio, curva ABC, fechamento e validações.
Não precisa de emulador nem de internet.

Para os testes das regras de segurança do Firestore (precisam de Java):

```bash
npm run test:rules
```

## Estrutura

```
index.html            estrutura da página
styles.css            estilos
app.js                interface, dados e sincronização
core.js               cálculo puro (custo, lucro, validações), testado
tests/                testes de cálculo e das regras de segurança
sw.js                 service worker (funcionamento offline)
manifest.webmanifest  manifesto PWA (instalar no celular)
icon.svg              ícone do app
config.example.js     modelo das chaves (copie para config.js)
config.js             suas chaves, NÃO versionado
docs/
  firebase-setup.md   passo a passo do Firebase
  firestore.rules     regras de segurança do banco
```

---
Feito para o ateliê Cinérea.
