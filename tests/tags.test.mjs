// A aba Tags amarra três arquivos que ninguém compila junto: `index.html` diz
// os ids e os `onclick`, `app.js` lê esses ids e define essas funções, e
// `core.js` gera o código que a REGRA vai comparar como texto exato.
//
// Errar a ligação não dá erro em lugar nenhum. Um id renomeado num lado só
// aparece como um campo que não preenche; uma função fora do `window` só
// aparece como um botão que não faz nada — no computador de quem está
// embalando uma caixa, não no de quem escreveu. Por isso o teste guarda as
// LIGAÇÕES, e não o desenho da tela.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as C from '../core.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const doc = readFileSync(new URL('../docs/posse-da-peca.md', import.meta.url), 'utf8');
const regras = readFileSync(new URL('../docs/firestore.rules', import.meta.url), 'utf8');

const painel = html.slice(html.indexOf('id="s-tags"'), html.indexOf('id="s-vendedores"'));

test('a aba existe e é alcançável pelo botão', () => {
  assert.ok(painel.length > 500, 'painel s-tags não achado');
  assert.match(html, /data-sub="tags" onclick="subAba\('tags'\)/);
});

test('todo id que o app lê existe no html, e todo campo do html é lido', () => {
  const noHtml = new Set([...painel.matchAll(/id="(tg_[a-zA-Z]+)"/g)].map(m => m[1]));
  const noJs = new Set([...js.matchAll(/(?:getElementById|val)\('(tg_[a-zA-Z]+)'\)/g)].map(m => m[1]));
  for (const id of noJs) assert.ok(noHtml.has(id), `app.js lê #${id}, que não existe no html`);
  // O caminho contrário é o que apodrece calado: um campo que ninguém lê
  // parece funcionar, aceita digitação, e some no salvar.
  for (const id of noHtml) assert.ok(noJs.has(id), `#${id} está na tela e ninguém lê`);
});

test('toda função chamada por onclick na aba está no window', () => {
  const expostas = new Set(
    [...js.matchAll(/Object\.assign\(window,\{([^}]*)\}\)/g)]
      .flatMap(m => m[1].split(',').map(s => s.trim().split(':')[0]))
  );
  const chamadas = [...painel.matchAll(/on(?:click|change|input)="([a-zA-Z]+)\(/g)].map(m => m[1]);
  assert.ok(chamadas.length >= 5, 'a aba ficou sem botão nenhum?');
  for (const f of new Set(chamadas)) {
    assert.ok(expostas.has(f), `${f}() é chamada pelo html e não está no window`);
  }
});

test('renderTags entra no ciclo da aba Vender, senão a tela nasce vazia', () => {
  const vender = js.slice(js.indexOf('vender:()=>'), js.indexOf('produzir:()=>'));
  assert.match(vender, /renderTags\(\)/);
});

test('db.tags nasce nos dois lugares que montam o db', () => {
  // Um só não basta: `rebuildDb` remonta a cada snapshot, e o inicializador
  // vale antes do primeiro. Faltando um, a lista some quando o servidor fala.
  const ocorrencias = [...js.matchAll(/db\s*=\s*\{tags:\[\]/g)].length;
  assert.equal(ocorrencias, 2, `db.tags inicializado em ${ocorrencias} lugar(es), esperava 2`);
});

test('o código sorteado sobrevive à normalização do outro lado', () => {
  // É ISTO que quebra em produção: a regra compara texto exato, então gerar e
  // normalizar têm de ser a mesma função vista de dois lados.
  for (let i = 0; i < 200; i++) {
    const c = C.codigoAtivacao();
    assert.equal(C.normalizarCodigo(c), c);
    assert.equal(C.normalizarCodigo(c.toLowerCase().replace('-', ' ')), c);
  }
});

test('o contrato escrito bate com o alfabeto que o código usa', () => {
  // O app vai ser escrito a partir do documento, não do core.js. Os dois
  // divergindo, o cliente digita o código certo e leva "não é sua".
  const doDoc = doc.match(/`([A-Z0-9]{20,})`/)[1];
  const gerado = new Set();
  for (let i = 0; i < 2000; i++) for (const ch of C.codigoAtivacao().replace('-', '')) gerado.add(ch);
  for (const ch of gerado) assert.ok(doDoc.includes(ch), `o gerador usa ${ch}, que não está no documento`);
  assert.equal(doDoc.length, gerado.size, 'documento e gerador têm alfabetos de tamanhos diferentes');
});

test('a tela não pode listar o que a regra proíbe listar', () => {
  // `pecas` tem `list: if false` de propósito: com a lista aberta, qualquer um
  // enumera os UIDs de todas as peças vendidas e o UID deixa de significar
  // "encostei nesta peça". A tabela sai do espelho local, `db.tags`.
  assert.match(regras, /match \/pecas\/\{tagUid\} \{[\s\S]*?allow list: if false;/);
  const bloco = js.slice(js.indexOf('function renderTags()'), js.indexOf('function porQueFalhouTag'));
  assert.equal(/getDocs\s*\(/.test(bloco), false, 'a aba Tags está listando coleção');
});
