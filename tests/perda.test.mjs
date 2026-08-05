// A peça que sumia sozinha.
//
// Aconteceu DUAS VEZES com o mesmo produto antes de a causa aparecer, e o
// sintoma enganava: parecia exclusão acidental, porque exclusão é a única
// coisa que a cabeça associa a "sumiu".
//
// A CAUSA. `cloudSave` espera 400 ms antes de gravar. Qualquer `onSnapshot`
// que chegasse nessa janela executava `rebuildDb()`, que faz
// `db = {...padrões, ...rawOp}` — substitui a memória INTEIRA pelo documento
// do servidor, que ainda não tinha a edição. A gravação agendada disparava em
// seguida e escrevia esse estado por cima. A peça sumia do cadastro e do
// servidor, sem clique nenhum.
//
// Duas abas abertas tornam isso rotina, porque o save de uma vira snapshot na
// outra e `persistentMultipleTabManager` está ligado.
//
// Este arquivo guarda as DUAS defesas, porque numa arquitetura que grava o
// documento inteiro um guarda só não basta: qualquer estado de memória
// defeituoso vira perda permanente na primeira gravação.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('o snapshot não remonta o db com gravação pendente', () => {
  // Sem esta guarda, o que a pessoa acabou de digitar é descartado antes de
  // chegar ao servidor.
  const i = js.indexOf("unsubData=onSnapshot");
  assert.notEqual(i, -1, 'sumiu o listener do documento da empresa');
  const bloco = js.slice(i, js.indexOf('unsubFin', i));
  assert.match(bloco, /if\(gravacaoPendente\)\{/,
    'o snapshot voltou a remontar o db sem checar gravação pendente');
  // E a saída tem de ser ANTES do rebuild.
  assert.ok(bloco.indexOf('if(gravacaoPendente)') < bloco.indexOf('rebuildDb()'),
    'a checagem ficou depois do rebuild, o que não protege nada');
});

test('o snapshot financeiro tem a mesma trava', () => {
  // `rebuildDb` remonta o db INTEIRO, então o documento financeiro chegando no
  // meio de uma edição levaria junto o que ainda não foi gravado no operacional.
  const i = js.indexOf("unsubFin=onSnapshot");
  const bloco = js.slice(i, i + 600);
  assert.match(bloco, /!gravacaoPendente/, 'o listener financeiro voltou a remontar sem trava');
});

test('a pendência sobe ANTES do debounce', () => {
  // A janela perigosa começa na edição, não na gravação. Subir a trava dentro
  // do `setTimeout` deixaria os 400 ms descobertos, que é exatamente o buraco.
  const i = js.indexOf('function cloudSave');
  const bloco = js.slice(i, i + 400);
  assert.ok(bloco.indexOf('gravacaoPendente++') < bloco.indexOf('setTimeout'),
    'a trava voltou para dentro do debounce e a janela reabriu');
});

test('a pendência é solta no sucesso, no erro e offline', () => {
  // Uma trava que não desce trava o app inteiro: nenhum snapshot volta a
  // entrar, e a tela para de refletir o servidor para sempre.
  const i = js.indexOf('function cloudSave');
  const bloco = js.slice(i, js.indexOf('function flashSync'));
  const quedas = (bloco.match(/gravacaoPendente=Math\.max\(0,gravacaoPendente-1\)|solta\(\)/g) || []).length;
  assert.ok(quedas >= 4, `só achei ${quedas} pontos que soltam a trava`);
  assert.match(bloco, /catch\(e=>\{solta\(\)/, 'o erro de rede não solta a trava');
});

test('gravar uma lista que encolheu sem exclusão é RECUSADO', () => {
  // A rede embaixo da primeira: se a lista encolheu e ninguém apagou nada de
  // propósito, não é edição, é estado corrompido.
  const i = js.indexOf('const encolheu=[]');
  assert.notEqual(i, -1, 'sumiu o guarda da lista que encolhe');
  const bloco = js.slice(i, i + 1200);
  assert.match(bloco, /apagouDeProposito/);
  assert.match(bloco, /agora<antes/);
  assert.match(bloco, /return;/, 'o guarda detecta e grava assim mesmo');
  // E ele roda ANTES do updateDoc, senão não impede nada.
  assert.ok(js.indexOf('const encolheu=[]') < js.indexOf("updateDoc(doc(fdb,'empresas',eid),{dados:payloadOp"),
    'o guarda ficou depois da gravação');
});

test('apagar de propósito continua funcionando', () => {
  // O guarda não pode transformar exclusão em bug: `del` marca a intenção.
  const i = js.indexOf('function del(type,id)');
  const bloco = js.slice(i, i + 2000);
  assert.match(bloco, /apagouDeProposito=true/, 'del deixou de marcar a intenção');
  // E a marca zera quando a memória volta a ser o servidor.
  const r = js.slice(js.indexOf('function rebuildDb'), js.indexOf('function splitDb'));
  assert.match(r, /apagouDeProposito=false/, 'a marca não zera no rebuild e trava a próxima exclusão');
});

test('o guarda vale para todas as listas, não só peças', () => {
  // Cliente, insumo e pedido somem do mesmo jeito e doem igual.
  const bloco = js.slice(js.indexOf('const encolheu=[]'), js.indexOf('const encolheu=[]') + 700);
  assert.match(bloco, /Object\.keys\(payloadOp/, 'o guarda voltou a olhar uma lista só');
});
