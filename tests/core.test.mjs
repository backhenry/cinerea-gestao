// Testes da lógica de cálculo (core.js). Rodam sem emulador: `node --test tests/`
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../core.js';

// cenário base reutilizado
const db = () => ({
  insumos: [
    { id: 'i1', nome: 'Gesso', unidade: 'kg', estoque: 10, minimo: 2, custo: 10 },
    { id: 'i2', nome: 'Pavio', unidade: 'un', estoque: 100, minimo: 20, custo: 0.5 },
  ],
  equip: [{ id: 'e1', nome: 'Impressora', custo: 3000, vidaHoras: 1000 }],
  produtos: [{
    id: 'p1', nome: 'Vela', receita: [{ insumo: 'i1', qtd: 0.5 }, { insumo: 'i2', qtd: 1 }],
    minutos: 30, custohora: 20, perda: 0, markup: 3, preco: 60, taxa: 0,
  }],
  canais: [{ id: 'c1', nome: 'Marketplace', taxa: 12 }],
  pedidos: [], fixos: [], compras: [], producao: [],
});

test('num aceita vírgula decimal e lixo', () => {
  assert.equal(C.num('12,5'), 12.5);
  assert.equal(C.num('abc'), 0);
  assert.equal(C.num(''), 0);
  assert.equal(C.num(null), 0);
});

test('calcCusto soma material, mão de obra, equipamento e perda', () => {
  const d = db();
  const p = { ...d.produtos[0], equip: 'e1' };
  const c = C.calcCusto(p, d);
  assert.equal(c.mat, 5.5);          // 0,5kg × 10 + 1un × 0,5
  assert.equal(c.mo, 10);            // 0,5h × 20
  assert.equal(c.eq, 1.5);           // 0,5h × (3000/1000)
  assert.equal(c.total, 17);
});

test('calcCusto aplica perda percentual', () => {
  const d = db();
  const c = C.calcCusto({ ...d.produtos[0], perda: 10 }, d);
  assert.equal(c.sub, 15.5);
  assert.equal(c.perda, 1.55);
  assert.equal(c.total, 17.05);
});

test('calcCusto usa padrões (custo/hora 25, perda 8%) quando vazio', () => {
  const d = db();
  const c = C.calcCusto({ receita: [], minutos: 60, custohora: '', perda: '' }, d);
  assert.equal(c.mo, 25);
  assert.equal(c.total, 27); // 25 + 8%
});

test('calcCusto ignora insumo inexistente sem quebrar', () => {
  const d = db();
  const c = C.calcCusto({ receita: [{ insumo: 'fantasma', qtd: 99 }], minutos: 0, perda: 0 }, d);
  assert.equal(c.total, 0);
});

test('precoProduto calcula sugerido, margem e lucro por hora', () => {
  const d = db();
  const r = C.precoProduto(d.produtos[0], d);
  assert.equal(r.custo, 15.5);
  assert.equal(r.sugerido, 46.5);      // 15,5 × 3
  assert.equal(r.praticado, 60);
  assert.equal(r.margem, 44.5);
  assert.equal(r.margemPct, 74);
  assert.equal(r.lucroHora, 89);       // 44,5 em 0,5h
});

test('lucroPedido desconta taxa do canal, custo e frete', () => {
  const d = db();
  const p = { produto: 'p1', qtd: 2, valor: 200, canal: 'c1', frete: 10 };
  // 200 × 0,88 = 176 − (15,5×2=31) − 10 = 135
  assert.equal(C.lucroPedido(p, d), 135);
});

test('lucroPedido cai para a taxa do produto sem canal', () => {
  const d = db();
  d.produtos[0].taxa = 10;
  const p = { produto: 'p1', qtd: 1, valor: 100 };
  assert.equal(C.lucroPedido(p, d), 100 * 0.9 - 15.5);
});

test('lucroPedido devolve null para pedido sem produto cadastrado', () => {
  assert.equal(C.lucroPedido({ item: 'avulso', valor: 50 }, db()), null);
});

test('saldoPedido soma pagamentos parciais', () => {
  const p = { valor: 300, pagamentos: [{ v: 150 }, { v: 50 }] };
  assert.deepEqual(C.saldoPedido(p), { pago: 200, falta: 100 });
});

test('saldoPedido nunca fica negativo', () => {
  assert.equal(C.saldoPedido({ valor: 100, pagamentos: [{ v: 150 }] }).falta, 0);
});

test('custoMedio pondera estoque antigo com a compra nova', () => {
  // 10 un a R$10 + 10 un por R$150 (R$15/un) → R$12,50
  assert.deepEqual(C.custoMedio(10, 10, 10, 150), { estoque: 20, custo: 12.5 });
});

test('custoMedio sem valor pago só soma estoque', () => {
  assert.deepEqual(C.custoMedio(5, 20, 5, 0), { estoque: 10, custo: 20 });
});

test('custoMedio parte do zero quando não havia estoque', () => {
  assert.deepEqual(C.custoMedio(0, 0, 4, 100), { estoque: 4, custo: 25 });
});

test('baixasProducao limita a baixa ao estoque disponível', () => {
  const d = db();
  d.insumos[0].estoque = 1; // só 1kg em casa
  const b = C.baixasProducao(d.produtos[0], 10, d.insumos); // pediria 5kg
  assert.equal(b[0].pedido, 5);
  assert.equal(b[0].qtd, 1);
});

test('insumoStatus classifica reposição', () => {
  assert.equal(C.insumoStatus({ estoque: 1, minimo: 2 }), 'low');
  assert.equal(C.insumoStatus({ estoque: 2, minimo: 2 }), 'low');
  assert.equal(C.insumoStatus({ estoque: 2.5, minimo: 2 }), 'warn');
  assert.equal(C.insumoStatus({ estoque: 10, minimo: 2 }), 'ok');
});

test('moldeStatus avisa perto do fim da vida', () => {
  assert.equal(C.moldeStatus({ usos: 40, vida: 40 }), 'low');
  assert.equal(C.moldeStatus({ usos: 33, vida: 40 }), 'warn');
  assert.equal(C.moldeStatus({ usos: 5, vida: 40 }), 'ok');
});

test('diasEstoque projeta pelo consumo da janela', () => {
  const ins = { id: 'i1', estoque: 30 };
  // 90 kg consumidos em 90 dias = 1/dia → 30 dias restantes
  const prod = [{ data: '2026-07-20', baixas: [{ insumo: 'i1', qtd: 90 }] }];
  assert.equal(C.diasEstoque(ins, prod, '2026-07-27'), 30);
});

test('diasEstoque devolve null sem consumo registrado', () => {
  assert.equal(C.diasEstoque({ id: 'i1', estoque: 30 }, [], '2026-07-27'), null);
});

test('pontoEquilibrio divide custos fixos pela margem média', () => {
  const d = db();
  // margem 44,5 · fixos 445 → 10 peças
  assert.equal(C.pontoEquilibrio(d.produtos, [{ valor: 445 }], d), 10);
});

test('pontoEquilibrio é zero sem custos fixos', () => {
  const d = db();
  assert.equal(C.pontoEquilibrio(d.produtos, [], d), 0);
});

test('scoreFornecedor conta vitórias e prazo médio', () => {
  const cots = [{
    itens: [{ insumo: 'i1', qtd: 1 }, { insumo: 'i2', qtd: 1 }],
    respostas: [
      { fornecedorId: 'f1', precos: { i1: { preco: 9, prazo: 5 }, i2: { preco: 1, prazo: 5 } } },
      { fornecedorId: 'f2', precos: { i1: { preco: 11, prazo: 3 }, i2: { preco: 0.5, prazo: 3 } } },
    ],
  }];
  const s1 = C.scoreFornecedor('f1', cots);
  assert.equal(s1.resp, 1);
  assert.equal(s1.winPct, 50);   // ganhou i1, perdeu i2
  assert.equal(s1.prazoMed, 5);
});

test('cestaOtima soma o melhor preço de cada item e a economia', () => {
  const d = db();
  const cot = {
    itens: [{ insumo: 'i1', qtd: 2 }],
    respostas: [
      { fornecedorId: 'f1', precos: { i1: { preco: 8 } } },
      { fornecedorId: 'f2', precos: { i1: { preco: 9 } } },
    ],
  };
  const r = C.cestaOtima(cot, d);
  assert.equal(r.otima, 16);      // 2 × 8
  assert.equal(r.atual, 20);      // 2 × 10 (custo médio atual)
  assert.equal(r.economia, 4);
});

test('curvaABC classifica por concentração de receita', () => {
  const r = C.curvaABC([
    { nome: 'A', valor: 800 }, { nome: 'B', valor: 150 }, { nome: 'C', valor: 50 },
  ]);
  assert.equal(r[0].classe, 'A');
  assert.equal(r[0].pct, 80);
  assert.equal(r[1].classe, 'B');
  assert.equal(r[2].classe, 'C');
});

test('fechamentoMes fecha a conta do mês', () => {
  const d = db();
  d.pedidos = [
    { data: '2026-07-05', situacao: 'Pago', produto: 'p1', qtd: 2, valor: 200, canal: 'c1', frete: 10 },
    { data: '2026-06-30', situacao: 'Pago', produto: 'p1', qtd: 1, valor: 100 }, // outro mês
    { data: '2026-07-10', situacao: 'Pendente', produto: 'p1', qtd: 1, valor: 100 }, // não conta
  ];
  d.fixos = [{ valor: 50 }];
  const f = C.fechamentoMes('2026-07', d);
  assert.equal(f.n, 1);
  assert.equal(f.receita, 200);
  assert.equal(f.taxas, 24);        // 12% de 200
  assert.equal(f.frete, 10);
  assert.equal(f.custoPecas, 31);   // 15,5 × 2
  assert.equal(f.liq, 200 - 24 - 10 - 31 - 50);
});

test('validar rejeita entradas impossíveis', () => {
  assert.match(C.validar('producao', { qtd: 0, data: '2026-07-27' }), /maior que zero/);
  assert.match(C.validar('producao', { qtd: 1, data: '1908-01-01' }), /Confira a data/);
  assert.match(C.validar('insumo', { nome: '', estoque: 1 }), /nome/);
  assert.match(C.validar('insumo', { nome: 'X', estoque: -5 }), /negativo/);
  assert.match(C.validar('pedido', { valor: -1, data: '' }), /negativo/);
  assert.match(C.validar('canal', { nome: 'X', taxa: 150 }), /entre 0 e 100/);
});

test('validar aceita entradas boas', () => {
  assert.equal(C.validar('producao', { qtd: 3, minutos: 20, data: '2026-07-27' }), null);
  assert.equal(C.validar('insumo', { nome: 'Gesso', estoque: 5, minimo: 1, custo: 10 }), null);
  assert.equal(C.validar('pedido', { valor: 100, qtd: 1, frete: 0, data: '2026-07-27' }), null);
});

test('esc neutraliza HTML nos nomes', () => {
  assert.equal(C.esc('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;');
  assert.equal(C.esc(`Ana "A" & O'Brien`), 'Ana &quot;A&quot; &amp; O&#39;Brien');
});

test('sementeRamo entrega insumos do ramo escolhido', () => {
  let n = 0;
  const s = C.sementeRamo('confeitaria', () => 'id' + (++n));
  assert.ok(s.insumos.some(i => i.nome === 'Chocolate'));
  assert.equal(s.rotulos.moldes, 'Formas');
  assert.equal(s.insumos[0].id, 'id1');
});

test('sementeRamo vazio não cria nada', () => {
  const s = C.sementeRamo('vazio');
  assert.equal(s.insumos.length, 0);
  assert.equal(s.moldes.length, 0);
});

test('brl formata em real brasileiro', () => {
  assert.equal(C.brl(1234.5), 'R$ 1.234,50');
  assert.equal(C.brl(0), 'R$ 0,00');
  assert.equal(C.brl('abc'), 'R$ 0,00');
});
