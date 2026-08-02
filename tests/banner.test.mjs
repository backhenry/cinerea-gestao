// O banner da loja anuncia um cupom. Este teste garante que a gestão avisa
// quando esse cupom não vai funcionar.
//
// NÃO É ZELO: aconteceu em ago/2026. O banner no ar dizia "Celebre nossa
// inauguração com 15% OFF!" com o código INAUGURA15, e `cupons/INAUGURA15`
// nunca existiu. Como o banner da loja é CLICÁVEL e preenche a sacola sozinho,
// o cliente tocava nele e a loja respondia "não encontrei esse cupom, confira
// as letras" — culpando quem não tinha digitado nada, na página da compra.
//
// A função é extraída do `app.js` real, e não copiada: uma cópia passaria a
// contar uma história que a gestão já não conta. `app.js` não é importável
// (é módulo de navegador, com Firebase no topo), e por isso a extração.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fonte = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

function extrair(nome) {
  const i = fonte.indexOf(`function ${nome}(`);
  assert.notEqual(i, -1, `não achei ${nome} no app.js`);
  let j = fonte.indexOf('{', i), nivel = 0, fim = j;
  for (; fim < fonte.length; fim++) {
    if (fonte[fim] === '{') nivel++;
    else if (fonte[fim] === '}' && --nivel === 0) break;
  }
  return fonte.slice(i, fim + 1);
}

const HOJE = '2026-08-01';

const montar = (cupons) => new Function('db', 'hoje', 'esc', `
  ${extrair('cupomDoBannerFalha')}
  ${extrair('normalizarCupom')}
  return cupomDoBannerFalha;
`)({ cupons }, () => HOJE, (s) => String(s ?? ''));

const CUPOM_BOM = { codigo: 'INAUGURA15', tipo: 'percentual', valor: 15, ativo: 'ativo' };

test('cupom anunciado que NÃO existe: o aviso diz onde criar', () => {
  const falha = montar([]);
  const m = falha({ titulo: 'Inauguração', cupom: 'INAUGURA15' });
  assert.match(m, /Não existe cupom/);
  assert.match(m, /INAUGURA15/);
  assert.match(m, /Vendas → Cupons/);
});

test('o código do banner é normalizado antes de procurar', () => {
  // Quem digita "inaugura 15" no banner e cadastra "INAUGURA15" no cupom tem
  // o mesmo cupom, e não pode ver alarme falso.
  const falha = montar([CUPOM_BOM]);
  assert.equal(falha({ titulo: 'x', cupom: 'inaugura 15' }), '');
});

test('cupom existe e está ativo: nenhum aviso', () => {
  const falha = montar([CUPOM_BOM]);
  assert.equal(falha({ titulo: 'x', cupom: 'INAUGURA15' }), '');
});

test('cupom desligado: o banner anuncia o que a loja recusa', () => {
  const falha = montar([{ ...CUPOM_BOM, ativo: 'desligado' }]);
  assert.match(falha({ titulo: 'x', cupom: 'INAUGURA15' }), /desligado/);
});

test('cupom vencido: avisa mesmo com o banner ainda no ar', () => {
  const falha = montar([{ ...CUPOM_BOM, ate: '2026-07-01' }]);
  assert.match(falha({ titulo: 'x', cupom: 'INAUGURA15' }), /venceu em 2026-07-01/);
});

test('banner dura MAIS que o cupom: o intervalo em que ele mente sozinho', () => {
  // O caso que ninguém percebe: hoje funciona, e em setembro para de
  // funcionar sem ninguém mexer em nada.
  const falha = montar([{ ...CUPOM_BOM, ate: '2026-09-01' }]);
  const m = falha({ titulo: 'x', cupom: 'INAUGURA15', ate: '2026-11-30' });
  assert.match(m, /2026-11-30/);
  assert.match(m, /2026-09-01/);
});

test('banner que acaba ANTES do cupom não é problema', () => {
  const falha = montar([{ ...CUPOM_BOM, ate: '2026-12-31' }]);
  assert.equal(falha({ titulo: 'x', cupom: 'INAUGURA15', ate: '2026-11-30' }), '');
});

test('cupom sem validade cobre qualquer banner', () => {
  const falha = montar([CUPOM_BOM]);
  assert.equal(falha({ titulo: 'x', cupom: 'INAUGURA15', ate: '2030-01-01' }), '');
});

test('banner sem cupom não é problema nenhum', () => {
  const falha = montar([]);
  assert.equal(falha({ titulo: 'Frete grátis acima de R$ 200' }), '');
  assert.equal(falha({ titulo: 'x', cupom: '' }), '');
  assert.equal(falha({ titulo: 'x', cupom: '!!!' }), '');   // normaliza para vazio
  assert.equal(falha(null), '');
});

// O caso real que motivou tudo isto, com os dados que estavam no ar.
test('o banner de inauguração de ago/2026 seria pego', () => {
  const falha = montar([]);   // nenhum cupom cadastrado, como estava
  const m = falha({
    titulo: 'Celebre nossa inauguração com 15% OFF!',
    texto: 'Válido para todas as peças da nossa primeira coleção. Ilumine seu espaço!',
    cupom: 'INAUGURA15', ate: '2026-11-30', cor: 'brasa',
  });
  assert.notEqual(m, '', 'o banner que estava no ar tem de acusar');
  assert.match(m, /INAUGURA15/);
});
