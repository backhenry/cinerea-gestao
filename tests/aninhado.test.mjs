// O array dentro de array que apagou a mesma peça quatro vezes.
//
// O Firestore recusa o DOCUMENTO INTEIRO quando encontra um array cujos
// elementos são arrays:
//
//     Function updateDoc() called with invalid data.
//     Nested arrays are not supported
//
// A ficha técnica era `[[rótulo, valor], …]` e `db.produtos` já é um array, o
// que dá `produtos[].ficha[][]`. Como a gestão grava o documento inteiro, a
// recusa derrubava a gravação de TUDO — não só da ficha.
//
// O estrago foi silencioso porque a etiqueta ficava em "salvando…" e o erro só
// ia para o console. A única peça com ficha técnica era o David, então parecia
// que alguém apagava o David. Ele nunca chegava a ser salvo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

/** A `parseFicha` real, extraída do arquivo. */
const parseFicha = new Function(`
  ${js.slice(js.indexOf('function parseFicha'), js.indexOf('/** A ficha em texto'))}
  return parseFicha;
`)();

const fichaEmTexto = new Function(`
  ${js.slice(js.indexOf('function fichaEmTexto'), js.indexOf('\n}', js.indexOf('function fichaEmTexto')) + 2)}
  return fichaEmTexto;
`)();

/** O achatador real, que é a rede contra a classe inteira do problema. */
const achatar = new Function(`
  const console={warn(){},error(){}};
  ${js.slice(js.indexOf('const achatarAninhados='), js.indexOf('payloadOp=achatarAninhados'))}
  return achatarAninhados;
`)();

/** Existe algum array cujos elementos sejam arrays? É o que o Firestore recusa. */
function temAninhado(no) {
  if (Array.isArray(no)) return no.some((x) => Array.isArray(x) || temAninhado(x));
  if (no && typeof no === 'object') return Object.values(no).some(temAninhado);
  return false;
}

// ─── a ficha ─────────────────────────────────────────────────────────────────

test('a ficha vira lista de LINHAS, e não de pares', () => {
  const f = parseFicha('Material: Gesso\nOrigem: Feito à mão');
  assert.deepEqual(f, ['Material: Gesso', 'Origem: Feito à mão']);
  assert.equal(temAninhado({ produtos: [{ ficha: f }] }), false,
    'a ficha voltou a ser uma lista de listas e derruba a gravação inteira');
});

test('linha sem valor é descartada, como antes', () => {
  assert.deepEqual(parseFicha('Material:\n\nOrigem: Ateliê'), ['Origem: Ateliê']);
});

test('linha sem dois-pontos continua valendo', () => {
  assert.deepEqual(parseFicha('Peça única'), ['Peça única']);
});

test('o texto de volta bate com o que foi digitado', () => {
  // O formulário mostra a ficha em texto; ida e volta não pode perder nada.
  const texto = 'Material: Gesso de alta densidade\nUso: Peça decorativa';
  assert.equal(fichaEmTexto(parseFicha(texto)), texto);
});

test('cadastro ANTIGO, com pares, continua sendo lido', () => {
  // Quem já tem a ficha em pares no Firestore não pode ver a tela vazia.
  assert.equal(fichaEmTexto([['Material', 'Gesso'], ['Origem', 'Ateliê']]),
    'Material: Gesso\nOrigem: Ateliê');
});

// ─── a rede contra a classe toda ─────────────────────────────────────────────

test('o achatador tira qualquer array aninhado antes de gravar', () => {
  const sujo = { produtos: [{ nome: 'David', ficha: [['Material', 'Gesso']] }] };
  assert.equal(temAninhado(sujo), true, 'o caso de teste não reproduz o problema');
  const limpo = achatar(sujo);
  assert.equal(temAninhado(limpo), false);
  assert.deepEqual(limpo.produtos[0].ficha, ['Material: Gesso']);
});

test('o achatador não estraga o que já está certo', () => {
  const bom = {
    produtos: [{ nome: 'David', ficha: ['Material: Gesso'], preco: 300, publico: true }],
    colecoes: [{ id: 'a', nome: 'Velas' }],
    meta: 0, checks: {},
  };
  assert.deepEqual(achatar(bom), bom);
});

test('o achatador desce em objetos dentro de arrays', () => {
  // O caso real tinha três níveis: produtos[] → objeto → ficha[] → par[].
  const fundo = { a: [{ b: [{ c: [['x', 'y']] }] }] };
  assert.equal(temAninhado(achatar(fundo)), false);
});

test('o achatador roda ANTES da gravação', () => {
  assert.ok(js.indexOf('payloadOp=achatarAninhados') <
            js.indexOf("updateDoc(doc(fdb,'empresas',eid),{dados:payloadOp"),
    'o achatador ficou depois do updateDoc e não protege nada');
});
