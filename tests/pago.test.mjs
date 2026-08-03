// Encomenda JÁ PAGA: o valor está fechado e não se recalcula.
//
// Achado em ago/2026, no dia em que o pagamento online passou a funcionar. O
// `aceitarEncomenda` sempre recalculou o desconto pelo cadastro da casa — o que
// é certo enquanto ninguém pagou, e é dinheiro errado depois que alguém pagou.
//
// O caso concreto: cliente paga R$ 170 com 15% de cupom. Dois dias depois o
// cupom vence. A casa aceita a encomenda, o código recalcula, acha que não há
// desconto, e registra R$ 200 de pedido. A pessoa pagou 170, a receita diz 200,
// e a comissão do vendedor sai de um número que nunca existiu.
//
// A regra em uma frase: **o número fecha no instante em que o dinheiro se move.**
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fonte = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

/**
 * A decisão extraída do `aceitarEncomenda` real.
 *
 * O `aceitarEncomenda` inteiro não se extrai: é assíncrono, mexe no Firestore e
 * toca a interface. O que se extrai é a DECISÃO, que é a linha onde o dinheiro
 * se decide — e é a única parte que precisa de teste.
 */
function decisao(e, descontoDoCadastro) {
  const linhas = fonte.slice(fonte.indexOf('const jaPago ='),
                             fonte.indexOf('const valores=ratearDesconto'));
  assert.ok(linhas.includes('jaPago'), 'a decisão saiu do app.js');
  const fn = new Function('e', 'cod', 'bruto', 'descontoDoCupom', 'Math_', `
    ${linhas}
    return { jaPago, desconto };
  `);
  return fn(e, e.cupom || '', 200, () => ({ desconto: descontoDoCadastro }));
}

test('paga: usa o desconto que foi COBRADO, e não o que o cupom daria hoje', () => {
  const r = decisao(
    { situacao: 'paga', totalFechado: 170, descontoAplicado: 30, cupom: 'MARIA15' },
    0   // o cupom venceu: o cadastro hoje daria zero
  );
  assert.equal(r.jaPago, true);
  assert.equal(r.desconto, 30, 'recalculou por cima do que a pessoa pagou');
});

test('paga: o cupom valer MAIS hoje também não muda o que já foi pago', () => {
  // O dono pode ter aumentado o cupom depois. Quem pagou 30 pagou 30.
  const r = decisao(
    { situacao: 'paga', totalFechado: 170, descontoAplicado: 30, cupom: 'MARIA15' },
    80
  );
  assert.equal(r.desconto, 30);
});

test('paga sem desconto nenhum continua sem desconto', () => {
  const r = decisao({ situacao: 'paga', totalFechado: 200, descontoAplicado: 0, cupom: 'MARIA15' }, 45);
  assert.equal(r.jaPago, true);
  assert.equal(r.desconto, 0);
});

test('NÃO paga: vale a conta da casa, como sempre foi', () => {
  const r = decisao({ situacao: 'nova', cupom: 'MARIA15' }, 30);
  assert.equal(r.jaPago, false);
  assert.equal(r.desconto, 30);
});

test('aguardando pagamento ainda NÃO é paga', () => {
  // A cobrança foi criada e ninguém pagou. Aqui o valor ainda é da casa.
  const r = decisao({ situacao: 'aguardando pagamento', cupom: 'MARIA15' }, 30);
  assert.equal(r.jaPago, false);
  assert.equal(r.desconto, 30);
});

test('marcada como paga mas sem totalFechado NÃO é tratada como paga', () => {
  // Estado impossível pelo caminho normal, mas se aparecer, confiar nele seria
  // criar pedidos de valor zero. Melhor cair na conta da casa.
  const r = decisao({ situacao: 'paga', totalFechado: 0, descontoAplicado: 99, cupom: 'MARIA15' }, 30);
  assert.equal(r.jaPago, false);
  assert.equal(r.desconto, 30);
});

// ---------------------------------------------------------------------------
// A caixa de entrada
// ---------------------------------------------------------------------------

test('encomenda PAGA aparece na caixa de entrada', () => {
  // O filtro pegava só `nova`. A paga sumia: dinheiro entrava e a casa não
  // ficava sabendo — o pior defeito possível numa caixa de entrada de vendas.
  const i = fonte.indexOf('const esperando =');
  assert.notEqual(i, -1, 'não achei o filtro da caixa de entrada');
  const esperando = new Function(`${fonte.slice(i, fonte.indexOf('\n', i))} return esperando;`)();
  assert.equal(esperando({ situacao: 'paga' }), true);
  assert.equal(esperando({ situacao: 'nova' }), true);
  assert.equal(esperando({ situacao: 'aceita' }), false);
  assert.equal(esperando({ situacao: 'recusada' }), false);
  assert.equal(esperando({ situacao: 'aguardando pagamento' }), false);
});

// ---------------------------------------------------------------------------
// O pedido que nasce
// ---------------------------------------------------------------------------

test('pedido de encomenda paga nasce PAGO, e não pendente', () => {
  // "Pendente" num pedido já pago manda a casa cobrar de novo quem já pagou, e
  // some do que o painel conta como recebido. A situação "Pago" já existia na
  // lista do formulário; faltava usá-la.
  const i = fonte.indexOf("situacao:jaPago?'Pago':'Pendente'");
  assert.notEqual(i, -1, 'o pedido não olha mais se a encomenda foi paga');
  const decidir = new Function('jaPago', `return ${fonte.slice(i + 9, fonte.indexOf(',', i))};`);
  assert.equal(decidir(true), 'Pago');
  assert.equal(decidir(false), 'Pendente');
});

test('a aba de Encomendas vem antes da de Pedidos', () => {
  // É a ordem de uso: a encomenda chega, você confere, e só então vira pedido.
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const enc = html.indexOf('data-sub="encomendas"');
  const ped = html.indexOf('data-sub="pedidos"');
  assert.ok(enc !== -1 && ped !== -1, 'não achei as duas abas');
  assert.ok(enc < ped, 'Pedidos voltou para a frente de Encomendas');
  // E é ela que abre.
  assert.ok(/<div class="subpanel active" id="s-encomendas">/.test(html),
            'o painel que abre não é o de encomendas');
});
