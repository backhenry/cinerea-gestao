// Lista de espera (nov/2026): quem pediu, na loja, para ser avisado de uma
// peça esgotada. A tela agrupa por peça e o botão "Avisar" abre o WhatsApp com
// a mensagem pronta. Errar o número é mandar o aviso para um estranho; errar o
// link é mandar a pessoa para a loja inteira atrás da peça que ela esperava.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { agruparEspera, linkDoAviso } from '../core.js';

const em = ms => ({ toMillis: () => ms });
const produtos = [{ id: 'david', nome: 'David' }, { id: 'refil', nome: 'Refil de Areia de Vela (180 g)' }];

test('agrupa por peça, a mais esperada primeiro, e dentro dela quem pediu antes', () => {
  const g = agruparEspera([
    { id: '1', peca: 'refil', nome: 'Ana', em: em(30) },
    { id: '2', peca: 'david', nome: 'Bia', em: em(20) },
    { id: '3', peca: 'david', nome: 'Caio', em: em(10) },
  ], produtos);
  assert.deepEqual(g.map(x => [x.nome, x.gente.map(e => e.nome)]),
    [['David', ['Caio', 'Bia']], ['Refil de Areia de Vela (180 g)', ['Ana']]]);
});

test('peça que saiu do cadastro continua aparecendo, com aviso no nome', () => {
  const g = agruparEspera([{ id: '1', peca: 'sumiu', nome: 'Ana', em: em(1) }], produtos);
  assert.equal(g[0].nome, 'peça fora do cadastro');
});

test('número com DDD ganha o 55; com o 55, fica como está', () => {
  assert.match(linkDoAviso({ nome: 'Ana', whats: '12999998888' }, 'David', 'david'), /^https:\/\/wa\.me\/5512999998888\?text=/);
  assert.match(linkDoAviso({ nome: 'Ana', whats: '5512999998888' }, 'David', 'david'), /^https:\/\/wa\.me\/5512999998888\?text=/);
  assert.match(linkDoAviso({ nome: 'Ana', whats: '1233334444' }, 'David', 'david'), /wa\.me\/551233334444\?/);
});

test('número fora do formato não vira link: melhor sem botão que aviso para um estranho', () => {
  assert.equal(linkDoAviso({ nome: 'Ana', whats: '123' }, 'David', 'david'), '');
  assert.equal(linkDoAviso({ nome: 'Ana', whats: '' }, 'David', 'david'), '');
});

test('a mensagem chama pelo primeiro nome e leva o link da PRÓPRIA peça', () => {
  const texto = decodeURIComponent(linkDoAviso({ nome: '  Ana Clara Souza ', whats: '12999998888' }, 'David', 'msfkfkc56u43').split('text=')[1]);
  assert.match(texto, /^Oi, Ana! Aqui é da Cinérea\./);
  assert.match(texto, /David voltou: https:\/\/cinerea\.com\.br\/loja\/\?peca=msfkfkc56u43$/);
  assert.doesNotMatch(texto, /\u2014/);
});

test('a aba está ligada: botão, painel e funções no window', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(html, /data-sub="espera" onclick="subAba\('espera'\);carregarEspera\(\)"/);
  assert.match(html, /id="s-espera"/);
  assert.match(html, /id="esperaList"/);
  assert.match(app, /Object\.assign\(window,\{[^}]*carregarEspera,tirarDaEspera/);
});
