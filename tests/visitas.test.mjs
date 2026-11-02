// O resumo do contador de visitas do site.
//
// A distinção que importa: a ORIGEM só é contada na primeira página de cada
// visita, então a soma das origens é o número de visitas, e a soma das páginas
// é o número de páginas abertas. Misturar as duas faria parecer que o site tem
// cinco vezes mais gente do que tem.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../core.js';

const D = (id, n) => ({ id, n });

test('separa visitas (origens) de páginas abertas', () => {
  const r = C.resumirVisitas([
    D('2026-11-05_loja', 6), D('2026-11-05_aromas', 3), D('2026-11-05_home', 4),
    D('2026-11-05_o-instagram', 4), D('2026-11-05_o-direto', 1),
  ]);
  assert.equal(r.visitas, 5);
  assert.equal(r.paginasAbertas, 13);
});

test('ordena do mais para o menos aberto, e soma os dias', () => {
  const r = C.resumirVisitas([
    D('2026-11-05_loja', 2), D('2026-11-06_loja', 3), D('2026-11-06_aromas', 4),
    D('2026-11-05_o-instagram', 1), D('2026-11-06_o-instagram', 2), D('2026-11-06_o-google', 5),
  ]);
  assert.deepEqual(r.paginas, [['loja', 5], ['aromas', 4]]);
  assert.deepEqual(r.origens, [['google', 5], ['instagram', 3]]);
  assert.deepEqual(r.dias, { '2026-11-05': 1, '2026-11-06': 7 });
});

test('corta pelo período pedido', () => {
  const r = C.resumirVisitas([D('2026-10-01_loja', 9), D('2026-11-05_loja', 1)], '2026-11-01');
  assert.equal(r.paginasAbertas, 1);
});

test('ignora documento malformado em vez de quebrar o painel', () => {
  // A escrita é anônima: a regra recusa campo a mais, mas um painel que trava
  // num documento estranho é pior que um painel que o ignora.
  const r = C.resumirVisitas([D('lixo', 5), D('2026-11-05_loja', 'x'), D('2026-11-05_loja', -3), null, D('2026-11-05_loja', 2)]);
  assert.equal(r.paginasAbertas, 2);
  assert.deepEqual(C.resumirVisitas(undefined).paginas, []);
});
