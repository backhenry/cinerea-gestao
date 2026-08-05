// A peça que sumia sozinha.
//
// Aconteceu DUAS VEZES com o mesmo produto antes de a causa aparecer, e o
// sintoma enganava: parecia exclusão acidental, porque exclusão é a única
// coisa que a cabeça associa a "sumiu".
//
// A CAUSA. `cloudSave` espera 400 ms antes de gravar. Qualquer `onSnapshot`
// que chegasse nessa janela executava `rebuildDb()`, que faz
// `db = {...padrões, ...rawOp}`, substitui a memória INTEIRA pelo documento
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

test('a pendência é BOOLEANA, e não contador', () => {
  // Como contador ela vazava: `cloudSave` faz `clearTimeout`, então N chamadas
  // viram UMA execução, N incrementos e um decremento. Depois de duas edições
  // seguidas ela nunca voltava a zero e o app parava de aceitar snapshot para
  // sempre, inclusive o próprio eco da gravação.
  assert.match(js, /let gravacaoPendente=false;/);
  assert.doesNotMatch(js, /gravacaoPendente\+\+/, 'voltou a ser contador');
  assert.doesNotMatch(js, /gravacaoPendente-1/, 'voltou a ser contador');
});

test('o eco da própria gravação NÃO é ignorado', () => {
  // Ignorar tudo enquanto há pendência faria a tela nunca mais refletir o
  // servidor. `hasPendingWrites` distingue o eco da escrita local.
  const i = js.indexOf('if(gravacaoPendente){');
  const bloco = js.slice(i, i + 700);
  assert.match(bloco, /hasPendingWrites/, 'a trava voltou a ignorar o próprio eco');
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
  const quedas = (bloco.match(/gravacaoPendente=false|solta\(\)/g) || []).length;
  assert.ok(quedas >= 4, `só achei ${quedas} pontos que soltam a trava`);
  // O catch de rede tem de soltar a trava: sem isso, um erro deixa o app sem
  // aceitar snapshot para sempre.
  const catchDeRede = bloco.slice(bloco.indexOf('.catch(e=>'));
  assert.match(catchDeRede.slice(0, 300), /solta\(\)/, 'o erro de rede não solta a trava');
});

test('o guarda da lista que encolhe AVISA, e não bloqueia', () => {
  // A primeira versão recusava a gravação e chamava `rebuildDb()`: apagava da
  // tela exatamente o que devia proteger. Um guarda contra perda de dados que
  // reage descartando o estado mais novo não é guarda, é a perda com outro
  // nome. Na dúvida, gravar, o histórico de 7 dias recupera. Não gravar não
  // deixa rastro nenhum.
  const i = js.indexOf('const IGNORAR_NO_GUARDA');
  assert.notEqual(i, -1, 'sumiu o guarda da lista que encolhe');
  // A fatia vai só até a conferência de tamanho, que é outro assunto e tem o
  // próprio `return` legítimo.
  const bloco = js.slice(i, js.indexOf('const tamanho=', i));
  assert.match(bloco, /console\.error/, 'o guarda deixou de avisar');
  assert.doesNotMatch(bloco, /rebuildDb\(\)/,
    'o guarda voltou a remontar o db, que é o que apagava o trabalho');
  assert.doesNotMatch(bloco, /return;/,
    'o guarda voltou a bloquear a gravação');
});

test('a atividade fica de fora do guarda', () => {
  // `logAtv` limita a 60 por desenho. Sem a exceção, toda gravação disparava
  // o alarme em falso, e, na versão que bloqueava, toda peça nova sumia.
  assert.match(js, /IGNORAR_NO_GUARDA=new Set\(\['atividade'\]\)/);
  assert.match(js, /db\.atividade=db\.atividade\.slice\(0,60\)/,
    'o limite da atividade mudou, reveja a exceção do guarda');
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


// ─── a gravação que falhava calada ───────────────────────────────────────────

test('falha de gravação NUNCA fica calada', () => {
  // O sintoma que custou quatro perdas da mesma peça: a etiqueta ficava em
  // "salvando…" para sempre, o erro ia só para o console, e o trabalho morria
  // no recarregamento seguinte. Mentir sobre o estado de uma gravação é o pior
  // que uma tela pode fazer.
  const i = js.indexOf('function cloudSave');
  const bloco = js.slice(i, js.indexOf('function flashErro'));
  assert.match(bloco, /flashErro\(/, 'o erro voltou a não mudar a etiqueta');
  assert.match(bloco, /catch\(e=>\{[\s\S]{0,400}?toast\(/,
    'o erro de gravação voltou a não avisar a pessoa');
  assert.doesNotMatch(bloco, /\.catch\(e=>\{solta\(\);console\.error\(e\);\}\)/,
    'voltou o catch que só logava');
});

test('o limite de 1 MB é conferido ANTES de tentar gravar', () => {
  // Um documento do Firestore não passa de 1.048.576 bytes, e a recusa chegava
  // só no console. Conferir antes troca uma falha muda por uma frase que diz o
  // que fazer, e mostra o número, porque "arquive" sem tamanho não é conselho.
  const i = js.indexOf('const LIMITE=1048576');
  assert.notEqual(i, -1, 'sumiu a conferência do limite');
  assert.ok(i < js.indexOf("updateDoc(doc(fdb,'empresas',eid),{dados:payloadOp"),
    'a conferência ficou depois da gravação');
  const bloco = js.slice(i - 400, i + 700);
  assert.match(bloco, /Arquivar ano/, 'a mensagem não diz o que fazer');
});

test('o erro do documento financeiro também avisa', () => {
  // Ele é gravado separado: falhar só ali significa perder custo, preço e
  // markup enquanto o resto salva, a divergência mais difícil de perceber.
  const i = js.indexOf("setDoc(doc(fdb,'empresas',eid,'fin','dados'),finToWrite)");
  const bloco = js.slice(i, i + 400);
  assert.match(bloco, /toast\(/, 'a falha do financeiro voltou a ser só console');
});

test('o tamanho fica à vista no indicador de sincronia', () => {
  const bloco = js.slice(js.indexOf('function flashSync'), js.indexOf('function flashSync') + 900);
  assert.match(bloco, /KB de 1024/, 'o tamanho saiu do indicador');
});
