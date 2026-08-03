// O rótulo das células no celular.
//
// No celular a tabela vira cartão e o cabeçalho some; quem diz o que é cada
// valor é o `data-l`, desenhado pelo CSS com `td::before{content:attr(data-l)}`.
//
// O mecanismo existia e estava sem uso: 5 células tinham `data-l` e 136 não.
// A tabela de peças aparecia como sete números empilhados sem dizer qual é
// custo, qual é preço e qual é margem — no aparelho em que o dono mais abre
// isto. Escrever `data-l` em 136 lugares consertaria hoje e voltaria a quebrar
// na próxima coluna, sem erro nenhum para avisar: foi assim que se chegou a 136.
//
// Por isso o rótulo passou a vir do `<thead>`, e por isso este teste guarda as
// CONDIÇÕES de que ele depende, e não a formatação da linha.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

/** As tabelas do sistema: cada `<tbody id>` com o `<thead>` que o precede. */
function tabelas() {
  const achadas = [];
  for (const m of html.matchAll(/<tbody id="([^"]+)"/g)) {
    const ini = html.lastIndexOf('<thead>', m.index);
    const bloco = html.slice(ini, m.index);
    const ths = [...bloco.matchAll(/<th([^>]*)>(.*?)<\/th>/gs)]
      .map(t => ({ attrs: t[1], texto: t[2].replace(/<[^>]+>/g, '').trim() }));
    achadas.push({ id: m[1], ths });
  }
  return achadas;
}

test('toda tabela tem cabeçalho — é dele que sai o rótulo', () => {
  const todas = tabelas();
  assert.ok(todas.length >= 15, `achei só ${todas.length} tabelas`);
  for (const t of todas) {
    assert.ok(t.ths.length > 0, `${t.id} não tem <thead>`);
    // A última coluna é a das ações e é vazia de propósito. As outras não podem
    // ser: cabeçalho vazio vira rótulo vazio, e o cartão volta a ser uma pilha
    // de valores mudos.
    const semNome = t.ths.slice(0, -1).filter(th => !th.texto);
    assert.deepEqual(semNome, [], `${t.id} tem coluna sem nome`);
  }
});

test('tabela que começa pela data diz qual coluna titula o cartão', () => {
  // "12/07" como título não diz de quem é o pedido, que é o que se procura ao
  // correr o olho pela lista. Quem não declara cai na primeira coluna, que é o
  // certo nas outras doze.
  const porData = tabelas().filter(t => t.ths[0]?.texto === 'Data');
  assert.ok(porData.length >= 3, 'esperava Pedidos, Produção e Compras');
  for (const t of porData) {
    assert.ok(t.ths.some(th => th.attrs.includes('data-titulo')),
      `${t.id} começa pela data e não diz qual coluna é o título`);
  }
});

test('o título declarado nunca é a própria data', () => {
  for (const t of tabelas()) {
    const i = t.ths.findIndex(th => th.attrs.includes('data-titulo'));
    if (i >= 0) assert.notEqual(t.ths[i].texto, 'Data', `${t.id} titula pela data`);
  }
});

test('a rotulagem é automática, e não uma lista de chamadas', () => {
  // Um `MutationObserver` porque as tabelas são preenchidas em dezenas de
  // funções diferentes: qualquer lista de chamadas fica incompleta do mesmo
  // jeito que a lista de `data-l` ficou.
  assert.match(js, /new MutationObserver/, 'sumiu o observador das tabelas');
  assert.match(js, /function rotularCelulas/, 'sumiu a rotulagem');
  assert.match(js, /rotularCelulas\(t\)|forEach\(rotularCelulas\)/,
    'o observador não chama mais a rotulagem');
});

test('ninguém voltou a usar emoji como ícone', () => {
  // Emoji é desenhado pelo sistema operacional: sai cinza no macOS, verde no
  // Android, e não aceita a cor da marca nem o tema escuro. `✎` e `◈` são pior
  // ainda — símbolos de texto, que viram retângulo vazio onde não há o glifo.
  // A flag `u` é obrigatória: sem ela a classe de caracteres quebra os pares
  // substitutos do UTF-16 e passa a casar METADE de cada emoji, o que dá falha
  // num arquivo limpo e não diz onde.
  // A lista cresceu junto com o conserto: os seis primeiros saíram na primeira
  // passada e os outros na segunda, espalhados por botões que ninguém tinha
  // olhado. `⟳ ▶ ◀ ✕ ✉` não são emoji, são símbolos de texto — pior ainda,
  // porque caem para a fonte do aparelho e viram retângulo onde não existem.
  const proibidos = /[🗑✎⧉🔍💰◈🛒📈🔗🧾💬🔔🌐👤🖨🔒⚠⟳▶◀✕✉]/gu;
  const semComentarios = js.replace(/\/\*[\s\S]*?\*\//g, '');
  const achados = semComentarios.match(proibidos) || [];
  assert.deepEqual(achados, [], `emoji de volta na interface: ${achados.join(' ')}`);
  assert.deepEqual(html.match(proibidos) || [], []);
});

test('os ícones existem e são de traço', () => {
  for (const nome of ['lapis', 'lixeira', 'copiar', 'lupa', 'grafico', 'carrinho',
                      'elo', 'recibo', 'balao', 'fechar', 'cadeado', 'impressora',
                      'envelope', 'sino', 'globo', 'pessoa', 'info', 'repetir',
                      'play', 'antes', 'depois']) {
    assert.match(js, new RegExp(`${nome}:'<`), `falta o ícone ${nome}`);
  }
  // `currentColor` é o ponto todo: o ícone herda a cor do botão, e com isso
  // acompanha hover e tema escuro sem nenhuma regra a mais.
  assert.match(js, /stroke="currentColor"/);
});
