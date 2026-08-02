// O rateio do desconto entre os pedidos.
//
// Aceitar uma encomenda cria UM PEDIDO POR ITEM, e o desconto do cupom tem de
// se repartir entre eles na proporção do valor de cada um. Se não repartir, a
// margem de um item mente e a comissão sai certa por acaso.
//
// A INVARIANTE QUE IMPORTA: a soma dos pedidos tem de ser exatamente
// `bruto - desconto`. É o número que o cliente viu e vai pagar. Um centavo de
// diferença aqui não é arredondamento inofensivo: é a receita divergindo do que
// foi cobrado, todo mês, sem ninguém achar de onde vem.
//
// Achado em ago/2026 medindo a fórmula antiga: 3 de 7 cenários realistas não
// fechavam. Sete peças de R$ 19,99 com R$ 20 de desconto somavam R$ 119,91
// contra R$ 119,93 combinados.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fonte = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

function extrair(nome) {
  let i = fonte.indexOf(`function ${nome}(`);
  assert.notEqual(i, -1, `não achei ${nome} no app.js`);
  if (fonte.slice(Math.max(0, i - 6), i) === 'async ') i -= 6;
  let j = fonte.indexOf('{', i), nivel = 0, fim = j;
  for (; fim < fonte.length; fim++) {
    if (fonte[fim] === '{') nivel++;
    else if (fonte[fim] === '}' && --nivel === 0) break;
  }
  return fonte.slice(i, fim + 1);
}

const ratear = new Function(`${extrair('ratearDesconto')} return ratearDesconto;`)();
const cent = v => Math.round(v * 100) / 100;
const soma = a => cent(a.reduce((s, x) => s + x, 0));

const CENARIOS = [
  ['três iguais que não dividem', [33.33, 33.33, 33.34], 10],
  ['dois itens, 15%',             [219.90, 60.00], 41.99],
  ['três preços do catálogo',     [280, 250, 200], 109.50],
  ['sete peças pequenas',         Array(7).fill(19.99), 20],
  ['um item só',                  [200], 30],
  ['centavos feios',              [0.07, 0.07, 0.07], 0.02],
  ['o catálogo inteiro',          [280, 250, 200, 60], 118.50],
  ['item minúsculo junto de um grande', [500, 0.01], 50],
  ['dez itens variados',          [19.9, 250, 33.33, 7.77, 199.99, 60, 12.5, 88.88, 5, 140], 77.77],
];

for (const [nome, cheios, desconto] of CENARIOS) {
  test(`a soma dos pedidos fecha: ${nome}`, () => {
    const bruto = soma(cheios);
    const valores = ratear(cheios, desconto);
    assert.equal(valores.length, cheios.length, 'um pedido por item');
    assert.equal(soma(valores), cent(bruto - desconto),
      `soma ${soma(valores)} contra ${cent(bruto - desconto)} combinados`);
    assert.ok(valores.every(v => v >= 0), 'nenhum pedido pode ficar negativo');
  });
}

test('sem desconto, cada pedido vale o preço cheio', () => {
  assert.deepEqual(ratear([280, 250, 200], 0), [280, 250, 200]);
  assert.deepEqual(ratear([280, 250], null), [280, 250]);
});

test('proporcional de verdade: o item maior perde mais', () => {
  // O desconto não pode cair igual em todo mundo, senão a margem do item
  // barato afunda e a do caro não sente.
  const [a, b] = ratear([300, 100], 40);
  assert.equal(cent(300 - a), 30);
  assert.equal(cent(100 - b), 10);
});

test('desconto igual ao bruto zera tudo, sem negativo', () => {
  const v = ratear([60, 40], 100);
  assert.equal(soma(v), 0);
  assert.ok(v.every(x => x >= 0));
});

test('lista vazia não quebra', () => {
  assert.deepEqual(ratear([], 10), []);
  assert.deepEqual(ratear(null, 10), []);
});

test('a sobra vai no MAIOR, e não no último', () => {
  // O último pode ser um item de um centavo, que não tem de onde tirar. Com a
  // sobra no maior, o pequeno nunca fica negativo.
  const v = ratear([500, 0.01], 50);
  assert.ok(v[1] >= 0, 'o item de um centavo não pode ficar negativo');
  assert.equal(soma(v), cent(500.01 - 50));
});

test('a fórmula ANTIGA não fechava, e é por isso que esta existe', () => {
  // Guarda o motivo: se alguém "simplificar" de volta, este teste explica.
  const antiga = (cheios, desconto) => {
    const bruto = cheios.reduce((s, x) => s + x, 0);
    return cheios.map(c => cent(c - (desconto > 0 && bruto > 0 ? desconto * (c / bruto) : 0)));
  };
  const itens = Array(7).fill(19.99), desconto = 20;
  const alvo = cent(soma(itens) - desconto);
  assert.notEqual(soma(antiga(itens, desconto)), alvo, 'a antiga errava por centavos');
  assert.equal(soma(ratear(itens, desconto)), alvo, 'a nova fecha');
});
