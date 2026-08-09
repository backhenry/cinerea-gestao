// As coleções que não aparecem na loja, e por quê.
//
// A GESTÃO E A LOJA CONTAM PEÇAS DE FORMAS DIFERENTES, e essa diferença é o que
// fez quatro coleções vazias passarem meses no ar sem ninguém notar:
//
//   a loja recebe só peça marcada como PÚBLICA (`itensDoCatalogo` filtra por
//   `publico`), e pula seção sem peça. Esta tela contava TODAS as peças da
//   coleção. Então uma coleção podia dizer "3 peças" aqui e estar invisível no
//   site, e as duas telas estavam certas, cada uma no seu idioma.
//
// Extraído do `app.js` real, e não copiado: cópia passa a contar uma história
// que a gestão já não conta.
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

/** Roda as funções reais contra um `db` de mentira. */
const montar = (colecoes, produtos) => new Function('db', `
  ${extrair('contarNaColecao')}
  ${extrair('colecoesInvisiveis')}
  function colecoesOrdenadas(){
    return [...(db.colecoes||[])].sort((a,b)=>(Number(a.ordem)||0)-(Number(b.ordem)||0));
  }
  return { contarNaColecao, colecoesInvisiveis };
`)({ colecoes, produtos });

const COL = [
  { id: 'a', nome: 'Esculturas', ordem: 10 },
  { id: 'b', nome: 'Refis de areia', ordem: 20 },
  { id: 'c', nome: 'Difusão', ordem: 30 },
];

test('coleção com peça pública não é invisível', () => {
  const { colecoesInvisiveis } = montar(COL, [{ colecao: 'a', publico: true }]);
  assert.ok(!colecoesInvisiveis().some((x) => x.nome === 'Esculturas'));
});

test('o CASO QUE ENGANA: tem peça no cadastro, mas nenhuma é pública', () => {
  // Aqui a tela antiga mostrava "2" e a loja mostrava nada. É o motivo deste
  // arquivo existir.
  const { contarNaColecao, colecoesInvisiveis } = montar(COL, [
    { colecao: 'a', publico: false },
    { colecao: 'a', publico: false },
  ]);
  assert.deepEqual(contarNaColecao({ id: 'a' }), { total: 2, publicas: 0 });
  const cega = colecoesInvisiveis().find((x) => x.nome === 'Esculturas');
  assert.ok(cega, 'devia estar na lista de invisíveis');
  assert.equal(cega.total, 2, 'e precisa dizer que existem 2 no cadastro');
});

test('coleção sem peça nenhuma também é invisível, e sabe que é zero', () => {
  const { colecoesInvisiveis } = montar(COL, []);
  assert.deepEqual(colecoesInvisiveis().map((x) => [x.nome, x.total]),
    [['Esculturas', 0], ['Refis de areia', 0], ['Difusão', 0]]);
});

test('uma pública entre várias privadas já salva a coleção', () => {
  const { contarNaColecao, colecoesInvisiveis } = montar(COL, [
    { colecao: 'b', publico: false },
    { colecao: 'b', publico: true },
    { colecao: 'b', publico: false },
  ]);
  assert.deepEqual(contarNaColecao({ id: 'b' }), { total: 3, publicas: 1 });
  assert.ok(!colecoesInvisiveis().some((x) => x.nome === 'Refis de areia'));
});

test('a lista de invisíveis sai na ordem da loja, não na do cadastro', () => {
  const embaralhado = [
    { id: 'c', nome: 'Difusão', ordem: 30 },
    { id: 'a', nome: 'Esculturas', ordem: 10 },
    { id: 'b', nome: 'Refis de areia', ordem: 20 },
  ];
  const { colecoesInvisiveis } = montar(embaralhado, []);
  assert.deepEqual(colecoesInvisiveis().map((x) => x.nome),
    ['Esculturas', 'Refis de areia', 'Difusão']);
});

test('peça sem coleção não conta para coleção nenhuma', () => {
  const { contarNaColecao } = montar(COL, [{ publico: true }, { colecao: '', publico: true }]);
  assert.deepEqual(contarNaColecao({ id: 'a' }), { total: 0, publicas: 0 });
});

test('o retrato real de ago/2026: 3 peças públicas, 4 coleções cegas', () => {
  const sete = ['Coleção Areia', 'Ritual & Aura', 'Velas & Bustos', 'Difusão',
                'Esculturas & Objetos', 'Acessórios', 'Refis & Consumíveis']
    .map((nome, i) => ({ id: 'c' + i, nome, ordem: (i + 1) * 10 }));
  const { colecoesInvisiveis } = montar(sete, [
    { colecao: 'c4', publico: true }, { colecao: 'c5', publico: true }, { colecao: 'c6', publico: true },
  ]);
  assert.deepEqual(colecoesInvisiveis().map((x) => x.nome),
    ['Coleção Areia', 'Ritual & Aura', 'Velas & Bustos', 'Difusão']);
});
