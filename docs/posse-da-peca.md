# Posse da peça: o contrato entre a gestão, as regras e o app

Este documento existe porque a prova de posse é a única coisa do projeto que
**três lados precisam escrever igual**: a gestão grava, a regra compara e o app
manda. Errar o formato em um dos três não dá erro de compilação em lugar nenhum
— dá um cliente com o cartão certo na mão levando "esta peça não é sua".

## O problema

O id de uma peça é o UID de fábrica do chip NFC embutido nela. O UID **não é
segredo**: sai em qualquer leitura, e ler é encostar o celular. Enquanto ele era
a única credencial, quem encostasse primeiro numa peça **ainda não cadastrada**
registrava-a na própria conta e publicava a vitrine — e o dono de verdade ficava
trancado para fora da própria peça, sem volta: a regra de `vitrines/` já não
deixava publicar por cima.

Um convidado numa festa, um visitante na prateleira do ateliê, alguém na loja
antes da venda. Não é ataque sofisticado, é encostar o celular.

## A escada de posse

Cobre os dois jeitos de uma peça sair da casa:

| estado da peça | quem consegue registrar |
|---|---|
| sem `dono` e sem código | qualquer conta — como sempre foi |
| `pecas/{tagUid}.dono = uid` | só aquele cliente |
| `ativacoes/{tagUid}.codigo` existe | só quem manda o código certo |

Retrocompatível de propósito: **peça sem marca nenhuma continua funcionando como
antes**. Nada do que já foi vendido quebra.

## Os documentos

### `pecas/{tagUid}` — a certidão

Leitura aberta (`get`, nunca `list`), escrita só de quem é da casa.

| campo | tipo | quem escreve |
|---|---|---|
| `modelo` | string | gestão |
| `serie` / `total` | número ou null | gestão |
| `feitaEm` | timestamp | gestão, uma vez |
| `refil` | string ou null | gestão |
| **`dono`** | uid da conta, ou ausente | **gestão** |

`dono` é o campo novo. A gestão o grava na aba **Vender → Tags**, escolhendo a
encomenda: o `clienteUid` que veio da loja do app vira o dono da peça.

### `ativacoes/{tagUid}` — o código do cartão

`read: if false`. **Ninguém lê, nem quem é da casa.** A regra compara o código
do lado do servidor, onde `get()` enxerga o documento mesmo com a leitura
negada. Se fosse legível, bastava pedir o documento para descobrir o código, e o
cartão impresso não valeria nada.

Um campo só: `codigo`, no formato canônico abaixo.

## O formato do código

Gerado por `Core.codigoAtivacao()` e normalizado por `Core.normalizarCodigo()`
(em `core.js`, com testes em `tests/core.test.mjs`).

- alfabeto `ACDEFGHJKLMNPQRTUVWXY34679` — sem B, I, O, S, Z, 0, 1, 2, 5 e 8,
  que se confundem em papel impresso;
- 8 caracteres, escritos `ACDE-FGHJ`;
- normalizar = maiúsculas, jogar fora o que não está no alfabeto, exigir
  exatamente 8, reinserir o hífen no meio. Comprimento diferente vira **vazio**,
  nunca um código pela metade.

São 26^8 combinações, cerca de 2·10^11. Não se adivinha, e tentar em série não
adianta: cada tentativa é uma gravação que a regra recusa.

## O que falta no app do cliente

Hoje `adicionarPeca()` (em `src/dados/pecas.ts` do repositório `cinerea-app`)
grava sem código. Para o caminho de balcão funcionar:

1. na tela de reconhecer uma peça, um campo **opcional** "código do cartão";
2. normalizar exatamente como acima **antes** de mandar;
3. incluir o campo `ativacao` no `setDoc` do primeiro cadastro:

```ts
await setDoc(documento(entrada.tagUid), {
  nome: entrada.nome.trim(),
  capacidade: entrada.capacidade,
  adicionadaEm: serverTimestamp(),
  atualizadaEm: serverTimestamp(),
  conteudoAtual: null,
  historico: [],
  ...(entrada.ativacao ? { ativacao: entrada.ativacao } : {}),
});
```

4. `permission-denied` na criação passa a ter dois motivos, e a mensagem precisa
   dizer qual: *"esta peça já tem dono"* ou *"falta o código do cartão"*. Do
   lado do cliente não dá para distinguir — pergunte pelo código quando a
   gravação sem código falhar.

O código **só é exigido no `create`**. As gravações seguintes não repetem a
prova: a posse já ficou registrada no documento.

## A chave de segurança na gestão

Enquanto o app não mandar `ativacao`, uma tag com código é **impossível de
registrar por qualquer um, inclusive pelo dono** — e não há tela no celular que
desfaça isso. Por isso a aba Tags recusa gravar código até que a chave *"o app
do cliente já pede o código"* seja ligada à mão, abaixo da tabela.

Ligue depois de a versão do app estar publicada, não antes.

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

- regras: `docs/firestore.rules` — **idêntico** em `cinerea-app`, e é de lá que
  se publica (`firebase deploy --only firestore:rules`). Mudou aqui, copie lá;
- gerador e normalizador: `core.js`, testes em `tests/core.test.mjs`;
- tela: aba **Vender → Tags** (`index.html` + `app.js`);
- testes das regras: `tests/rules.test.mjs`, no emulador.
