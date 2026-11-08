// Cadastrar peças novas em sequência apagava o preço de uma sim, outra não.
//
// Em 08/11/2026, cinco peças cadastradas com dez segundos entre elas, UMA aba
// só: a 2ª e a 4ª voltaram do recarregamento com o preço vazio. Antes disso o
// mesmo aconteceu com treze peças, e a culpa caiu nas duas abas abertas.
//
// O mecanismo, reproduzido aqui com o `subscribe` e o `cloudSave` reais:
//
//   1. `cloudSave` grava o operacional (`updateDoc`) e, logo depois, o
//      financeiro (`setDoc` em `fin/dados`).
//   2. O Firestore devolve o eco local de cada escrita na ordem em que foram
//      feitas. O do operacional chega PRIMEIRO, com `hasPendingWrites`, e o
//      ouvinte remonta o `db` com `rebuildDb()`.
//   3. Nesse instante `rawFin` ainda é o financeiro de ANTES: o preço da peça
//      recém-digitada some da memória.
//   4. O eco do financeiro chega em seguida, mas `gravacaoPendente` ainda está
//      de pé e o ouvinte não remonta. A memória fica sem o preço.
//   5. Na peça seguinte, `splitDb()` monta `fin/dados` a partir dessa memória
//      e o `setDoc` (que substitui o doc inteiro) apaga o preço no servidor.
//
// Por isso alterna: a remontagem do passo 3 usa o financeiro da gravação
// ANTERIOR, que tinha a peça de duas gravações atrás e não a de uma.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

function trecho(de, ate) {
  const i = js.indexOf(de), f = js.indexOf(ate, i);
  assert.ok(i >= 0 && f > i, `trecho não encontrado no app.js: ${de}`);
  return js.slice(i, f);
}

/**
 * Um Firestore de mentira, do tamanho do que o bug precisa.
 *
 * Imita a compensação de latência do SDK: a escrita entra na visão local na
 * hora, o ouvinte recebe o eco com `hasPendingWrites: true` (na ordem das
 * escritas), e a confirmação do servidor chega depois, sem novo snapshot,
 * porque o dado não mudou e ninguém pediu `includeMetadataChanges`.
 *
 * `ordem` troca a ordem dos ecos. A correção tem de valer nas duas.
 */
function firestoreFalso(ordem = 'op-primeiro') {
  const servidor = new Map();
  const ouvintes = new Map();
  const fila = [];
  const chave = (ref) => ref.path;
  const snap = (ref, pendente) => ({
    exists: () => servidor.has(chave(ref)),
    data: () => structuredClone(servidor.get(chave(ref))),
    metadata: { hasPendingWrites: pendente },
  });
  const eco = (ref) => () => { const cb = ouvintes.get(chave(ref)); if (cb) cb(snap(ref, true)); };
  const agendarEco = (ref, ehFin) => {
    if (ordem === 'fin-primeiro' && ehFin) fila.unshift(eco(ref)); else fila.push(eco(ref));
  };
  const api = {
    servidor,
    doc: (_db, ...partes) => ({ path: partes.join('/') }),
    collection: (_db, ...partes) => ({ path: partes.join('/') }),
    onSnapshot(ref, cb) {
      ouvintes.set(chave(ref), cb);
      cb(snap(ref, false));
      return () => ouvintes.delete(chave(ref));
    },
    updateDoc(ref, dados) {
      servidor.set(chave(ref), { ...(servidor.get(chave(ref)) || {}), ...structuredClone(dados) });
      agendarEco(ref, false);
      return new Promise((ok) => setImmediate(ok));
    },
    setDoc(ref, dados, opc) {
      const antes = opc && opc.merge ? servidor.get(chave(ref)) || {} : {};
      servidor.set(chave(ref), { ...antes, ...structuredClone(dados) });
      agendarEco(ref, ref.path.endsWith('fin/dados'));
      return new Promise((ok) => setImmediate(ok));
    },
    /** Entrega os ecos locais, como o SDK faz logo depois das escritas. */
    entregarEcos() { while (fila.length) fila.shift()(); },
  };
  return api;
}

/** Monta o estado do app.js e o `subscribe`/`cloudSave` reais sobre o falso. */
function montarApp(fs) {
  const timers = [];
  const fabrica = new Function('fs', 'timers', `
    const {doc,collection,onSnapshot,updateDoc,setDoc}=fs;
    const console={warn(){},error(){},log(){}};
    const navigator={onLine:true};
    const document={getElementById:()=>null};
    const setTimeout=(cb)=>{timers.push(cb);return timers.length;};
    const clearTimeout=()=>{timers.length=0;};
    let memoCusto;function limparMemo(){}
    function flashSync(){} function flashErro(){} function toast(){}
    function esc(s){return String(s);}
    function pode(){return true;}
    function renderAll(){} function seedIfEmpty(){} function checkBackup(){}
    function checarNotifs(){} function mostrarOnboarding(){}
    function uidGen(){return Math.random().toString(36).slice(2);}
    ${trecho('let app,auth,fdb', 'let undoState=null')}
    ${trecho('function subscribe(){', '/** O aviso do cabeçalho quando a gravação FALHA')}
    return {
      entrar(u,e){uid=u;eid=e;fdb={};subscribe();},
      get db(){return db;},
      set db(v){db=v;},
      set rawFin(v){rawFin=v;},
      cloudSave,splitDb,
    };
  `);
  const app = fabrica(fs, timers);
  return {
    app,
    /** O debounce de 400 ms vence: roda a gravação agendada. */
    vencerDebounce() { const cb = timers.pop(); timers.length = 0; if (cb) cb(); },
  };
}

const esperarConfirmacao = () => new Promise((ok) => setImmediate(() => setImmediate(ok)));

/** O que `saveForm('produto')` faz com o `db`: empurra a peça e chama `save`. */
async function cadastrarPecas(fs, n) {
  fs.servidor.set('empresas/e1', { nome: 'Teste', dono: 'u1', dados: { produtos: [] } });
  fs.servidor.set('empresas/e1/fin/dados', { prodFin: {} });
  const { app, vencerDebounce } = montarApp(fs);
  app.entrar('u1', 'e1');
  for (let i = 1; i <= n; i++) {
    app.db.produtos.push({ id: 'p' + i, nome: 'Peça ' + i, preco: String(10 * i), markup: '2', taxa: '', custohora: '', perda: '', equip: '' });
    app.cloudSave();
    vencerDebounce();
    fs.entregarEcos();
    await esperarConfirmacao();
  }
  return app;
}

for (const ordem of ['op-primeiro', 'fin-primeiro']) {
  test(`cinco peças seguidas: todas chegam ao servidor com preço (eco ${ordem})`, async () => {
    const fs = firestoreFalso(ordem);
    await cadastrarPecas(fs, 5);
    const pf = fs.servidor.get('empresas/e1/fin/dados').prodFin;
    const semPreco = [1, 2, 3, 4, 5].filter((i) => !(pf['p' + i] && pf['p' + i].preco));
    assert.deepEqual(semPreco, [], `peças sem preço no servidor: ${semPreco.join(', ')}`);
    for (let i = 1; i <= 5; i++) assert.equal(pf['p' + i].preco, String(10 * i));
  });

  test(`cinco peças seguidas: a memória não perde o preço digitado (eco ${ordem})`, async () => {
    const fs = firestoreFalso(ordem);
    const app = await cadastrarPecas(fs, 5);
    const semPreco = app.db.produtos.filter((p) => !p.preco).map((p) => p.id);
    assert.deepEqual(semPreco, [], `peças sem preço na tela: ${semPreco.join(', ')}`);
  });
}

test('treze peças, o caso que foi culpa das duas abas, também passa', async () => {
  const fs = firestoreFalso('op-primeiro');
  await cadastrarPecas(fs, 13);
  const pf = fs.servidor.get('empresas/e1/fin/dados').prodFin;
  assert.equal(Object.values(pf).filter((f) => f.preco).length, 13);
});

test('o mesmo depois de recarregar: o servidor tem o preço que a tela mostrava', async () => {
  const fs = firestoreFalso('op-primeiro');
  await cadastrarPecas(fs, 5);
  // Recarregar = um app novo lendo o mesmo servidor.
  const { app } = montarApp(fs);
  app.entrar('u1', 'e1');
  assert.deepEqual(app.db.produtos.map((p) => p.preco), ['10', '20', '30', '40', '50']);
});

test('a meta do mês, que é financeira de topo, não volta ao valor antigo', async () => {
  // Mesma corrida, outro campo: o eco do operacional remontava `db.meta` com o
  // `rawFin` velho, e a gravação seguinte regravava a meta antiga.
  const fs = firestoreFalso('op-primeiro');
  fs.servidor.set('empresas/e1', { nome: 'Teste', dono: 'u1', dados: { produtos: [] } });
  fs.servidor.set('empresas/e1/fin/dados', { prodFin: {}, meta: 1000 });
  const { app, vencerDebounce } = montarApp(fs);
  app.entrar('u1', 'e1');
  const gravar = async () => { app.cloudSave(); vencerDebounce(); fs.entregarEcos(); await esperarConfirmacao(); };
  app.db.meta = 5000;
  await gravar();
  app.db.produtos.push({ id: 'p1', nome: 'Peça 1', preco: '10' });
  await gravar();
  assert.equal(app.db.meta, 5000, 'a tela voltou para a meta antiga');
  assert.equal(fs.servidor.get('empresas/e1/fin/dados').meta, 5000, 'o servidor voltou para a meta antiga');
});

test('splitDb: campo financeiro AUSENTE na memória não apaga o do servidor', () => {
  // A segunda rede, sozinha. Se a memória perder o preço por outro caminho, o
  // `setDoc` (que substitui o doc inteiro) não pode levar o preço junto.
  const { app } = montarApp(firestoreFalso());
  app.rawFin = { prodFin: { p1: { preco: '10', markup: '2' }, p9: { preco: '99' } } };
  app.db = { produtos: [{ id: 'p1', nome: 'Peça 1' }, { id: 'p2', nome: 'Peça 2', preco: '20' }] };
  const { op, fin } = app.splitDb();
  assert.deepEqual(fin.prodFin.p1, { preco: '10', markup: '2' });
  assert.deepEqual(fin.prodFin.p2, { preco: '20' });
  assert.equal(fin.prodFin.p9, undefined, 'peça excluída não pode voltar pelo financeiro');
  assert.equal(op.produtos[1].preco, undefined, 'preço vazou para o doc operacional');
});

test('splitDb: valor apagado pela pessoa (vazio) continua apagado', () => {
  // O formulário grava '' quando o campo fica em branco. Isso é intenção, e
  // não pode ser trocado pelo valor antigo.
  const { app } = montarApp(firestoreFalso());
  app.rawFin = { prodFin: { p1: { preco: '10' } } };
  app.db = { produtos: [{ id: 'p1', nome: 'Peça 1', preco: '' }] };
  assert.equal(app.splitDb().fin.prodFin.p1.preco, '');
});
