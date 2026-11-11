// Peça sob encomenda (nov/2026): a loja promete "envio em N dias", e o pedido
// nasce com essa data em `prazo`. Se a conta escorregar um dia, o painel avisa
// "vence hoje" no dia errado, e o cliente que leu 15 dias recebe em 16.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prazoDeEnvio } from '../core.js';

test('15 dias a partir de 10/11 é 25/11', () => {
  assert.equal(prazoDeEnvio(15, new Date(2026, 10, 10)), '2026-11-25');
});

test('vira o mês e o ano sem perder dia', () => {
  assert.equal(prazoDeEnvio(15, new Date(2026, 11, 20)), '2027-01-04');
  assert.equal(prazoDeEnvio(1, new Date(2028, 1, 28)), '2028-02-29');
});

test('a hora do aceite não muda o dia', () => {
  // aceitar às 23h59 não pode empurrar o prazo um dia para a frente
  assert.equal(prazoDeEnvio(15, new Date(2026, 10, 10, 23, 59)), '2026-11-25');
});

test('sem prazo, sem data: peça pronta não ganha prazo inventado', () => {
  for (const v of [0, '', null, undefined, -3, 'abc']) assert.equal(prazoDeEnvio(v, new Date(2026, 10, 10)), '');
});

test('o campo atravessa os três lugares: formulário, gravação e catálogo', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /id="f_envioDias"/, 'o formulário da peça tem o campo');
  assert.match(app, /envioDias:Math\.max\(0,Math\.round\(Number\(val\('f_envioDias'\)\)/, 'a gravação lê o campo');
  assert.match(app, /envioDias:Math\.max\(0,Math\.round\(Number\(p\.envioDias\)/, 'o catálogo publica o campo');
  assert.match(app, /prazo:Core\.prazoDeEnvio\(p\.envioDias\)/, 'o pedido nasce com o prazo');
});
