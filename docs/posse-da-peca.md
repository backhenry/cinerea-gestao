# Posse da peça: o contrato entre a gestão, as regras e o app

Este documento existe porque a prova de posse é a única coisa do projeto que
**três lados precisam escrever igual**: a gestão grava, a regra compara e o
perfil do site manda. Errar o formato em um dos três não dá erro de compilação
em lugar nenhum: dá um cliente com o cartão certo na mão levando "esta peça não é sua".

## O problema

O id de uma peça é o UID de fábrica do chip NFC embutido nela. O UID **não é
segredo**: sai em qualquer leitura, e ler é encostar o celular. Enquanto ele era
a única credencial, quem encostasse primeiro numa peça **ainda não cadastrada**
registrava-a na própria conta e publicava a vitrine, e o dono de verdade ficava
trancado para fora da própria peça, sem volta: a regra de `vitrines/` já não
deixava publicar por cima.

Um convidado numa festa, um visitante na prateleira do ateliê, alguém na loja
antes da venda. Não é ataque sofisticado, é encostar o celular.

## A escada de posse

Cobre os dois jeitos de uma peça sair da casa:

| estado da peça | quem consegue registrar |
|---|---|
| sem `dono` e sem código | qualquer conta, como sempre foi |
| `pecas/{tagUid}.dono = uid` | só aquele cliente |
| `ativacoes/{tagUid}.codigo` existe | só quem manda o código certo |

Retrocompatível de propósito: **peça sem marca nenhuma continua funcionando como
antes**. Nada do que já foi vendido quebra.

## Os documentos

### `pecas/{tagUid}`: a certidão

Leitura aberta (`get`, nunca `list`), escrita só de quem é da casa.

| campo | tipo | quem escreve |
|---|---|---|
| `modelo` | string | gestão |
| `serie` / `total` | número ou null | gestão |
| `feitaEm` | timestamp | gestão, uma vez |
| `refil` | string ou null | gestão |
| **`dono`** | uid da conta, ou ausente | **gestão** |
| **`cartao`** | `true`, ou ausente | **gestão**, junto com o código |

`dono`: a gestão o grava na aba **Vender → Tags**, escolhendo a encomenda. O
`clienteUid` que veio da loja vira o dono da peça.

`cartao` (nov/2026) é a **marca pública** de que existe código. Ela não prova
nada, quem prova é a regra comparando o código; ela só diz ao perfil do site
QUANDO pedir o código, porque `ativacoes/` não se lê. A regra só aceita
`cartao: true` se `ativacoes/{tagUid}` existir ao fim da mesma gravação: marca
sem código seria um campo que aceita qualquer coisa digitada. Por isso a
gestão grava certidão e código num **lote** (`writeBatch`), e ao soltar tira os
dois no mesmo lote.

### `ativacoes/{tagUid}`: o código do cartão

`read: if false`. **Ninguém lê, nem quem é da casa.** A regra compara o código
do lado do servidor, onde `get()` enxerga o documento mesmo com a leitura
negada. Se fosse legível, bastava pedir o documento para descobrir o código, e o
cartão impresso não valeria nada.

Um campo só: `codigo`, no formato canônico abaixo.

## O formato do código

Gerado por `Core.codigoAtivacao()` e normalizado por `Core.normalizarCodigo()`
(em `core.js`, com testes em `tests/core.test.mjs`).

- alfabeto `ACDEFGHJKLMNPQRTUVWXY34679`, sem B, I, O, S, Z, 0, 1, 2, 5 e 8,
  que se confundem em papel impresso;
- 8 caracteres, escritos `ACDE-FGHJ`;
- normalizar = maiúsculas, jogar fora o que não está no alfabeto, exigir
  exatamente 8, reinserir o hífen no meio. Comprimento diferente vira **vazio**,
  nunca um código pela metade.

São 26^8 combinações, cerca de 2·10^11. Não se adivinha, e tentar em série não
adianta: cada tentativa é uma gravação que a regra recusa.

## Quem pede o código: o perfil do site

Desde nov/2026 quem manda o código é o **perfil do site**
(`cinerea-site/perfil/`), e não o aplicativo. O cliente de iPhone não instala o
aplicativo, e o de Android quase nunca; o perfil abre em qualquer celular.

O caminho do cliente:

1. encosta o celular na peça, e a página do convidado (`/p/`) abre sozinha;
2. toca em "Esta peça é sua? Guarde na sua conta", que leva a
   `/perfil/?guardar={tagUid}`;
3. entra ou cria a conta;
4. o perfil lê a certidão e, com `cartao: true`, pede o código;
5. normaliza **exatamente como acima** (há uma cópia de `normalizarCodigo` no
   perfil, e `tests/guardar-peca.test.mjs`, no repositório do app, passa os
   mesmos textos pelas duas cópias) e grava `ativacao` no registro da peça.

`permission-denied` nesse passo tem um motivo só, porque o perfil não oferece o
campo a peça de outra conta: o código não confere. A tela diz isso.

O aplicativo **não** pede o código. Se alguém tentar guardar pelo aplicativo
uma peça com cartão, ele explica e manda para o site.

O código **só é exigido no `create`**. As gravações seguintes não repetem a
prova: a posse já ficou registrada no documento.

## A chave de segurança na gestão

Uma tag com código só é registrável por quem **manda** o código. Antes de o
perfil pedir, ela não era registrável por ninguém, nem pelo dono. Por isso a
aba Tags recusa gravar código até que a chave *"o perfil do site já pede o
código"* seja ligada à mão, abaixo da tabela.

Ligue depois de o perfil com o campo do código estar no ar, não antes.

## O cartão

A aba Tags imprime o cartão (ícone de impressora ao lado do código), no tamanho
de um cartão de visita. O texto dele repete as palavras da página do convidado
e do perfil, de propósito. Ele **não** diz que o código vale uma vez: a regra
deixa qualquer conta com o código guardar a peça, então o conselho é tratar o
cartão como uma chave.

## Consertar uma peça sequestrada

Para tudo que foi vendido antes desta regra, o conserto não pode ser "não há o
que fazer". A regra deixa quem é da casa **apagar** uma vitrine tomada
(`vitrines/{tagUid}`), e aí o dono publica a dele. Escrever no lugar do cliente
continua proibido: apagar resolve o sequestro, escrever seria a casa falando
pela boca do cliente.

Na aba Tags, o botão **Soltar a peça** tira `dono` e código, devolvendo a peça
ao estado "qualquer conta registra". É a saída para revenda, devolução, e para
quando uma tag foi amarrada na encomenda errada.

## Onde isto mora

- regras: `docs/firestore.rules`, **idêntico** em `cinerea-app`, e é de lá que
  se publica (`firebase deploy --only firestore:rules`). Mudou aqui, copie lá;
- gerador e normalizador: `core.js`, testes em `tests/core.test.mjs`;
- tela: aba **Vender → Tags** (`index.html` + `app.js`);
- o campo do código: `cinerea-site/perfil/index.html`, tela de guardar;
- testes das regras: `tests/rules.test.mjs`, no emulador.
