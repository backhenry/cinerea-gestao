// ─────────────────────────────────────────────────────────────
// Núcleo de cálculo da Cinérea Gestão.
// Funções PURAS: recebem os dados por parâmetro, não tocam em DOM,
// Firestore nem variáveis globais. É o que os testes cobrem
// (tests/core.test.mjs roda com `node --test`, sem emulador).
// ─────────────────────────────────────────────────────────────

// ---------- formatação ----------
export const brl = n => 'R$ ' + (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uidGen = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const hoje = (d = new Date()) =>
  d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

// número tolerante a vírgula decimal e texto vazio
export const num = v => {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  return isFinite(n) ? n : 0;
};

// ---------- situação de estoque e moldes ----------
export function insumoStatus(i) {
  if (num(i.estoque) <= num(i.minimo)) return 'low';
  if (num(i.estoque) / (num(i.minimo) || 1) < 1.5) return 'warn';
  return 'ok';
}
export function moldeStatus(m) {
  const r = num(m.usos) / (num(m.vida) || 1);
  if (r >= 1) return 'low';
  if (r >= 0.8) return 'warn';
  return 'ok';
}

// ---------- custo de produção de uma peça ----------
// db precisa de { insumos, equip }
export function calcCusto(p, db) {
  let mat = 0;
  (p.receita || []).forEach(l => {
    const ins = (db.insumos || []).find(i => i.id === l.insumo);
    if (ins) mat += num(ins.custo) * num(l.qtd);
  });
  const horas = num(p.minutos) / 60;
  const mo = horas * (p.custohora === undefined || p.custohora === '' ? 25 : num(p.custohora));
  let eq = 0;
  if (p.equip) {
    const e = (db.equip || []).find(x => x.id === p.equip);
    if (e && num(e.vidaHoras) > 0) eq = horas * (num(e.custo) / num(e.vidaHoras));
  }
  const sub = mat + mo + eq;
  const perda = sub * ((p.perda === undefined || p.perda === '' ? 8 : num(p.perda)) / 100);
  return { mat, mo, eq, sub, perda, total: sub + perda };
}

// preço sugerido e margem de um produto
export function precoProduto(p, db) {
  const custo = calcCusto(p, db).total;
  const markup = p.markup === undefined || p.markup === '' ? 3 : num(p.markup);
  const sugerido = custo * markup;
  const praticado = num(p.preco) || sugerido;
  const taxa = praticado * num(p.taxa) / 100;
  const margem = praticado - taxa - custo;
  const horas = num(p.minutos) / 60;
  return {
    custo, markup, sugerido, praticado, taxa, margem,
    margemPct: praticado ? Math.round(margem / praticado * 100) : 0,
    lucroHora: horas > 0 ? margem / horas : 0,
  };
}

// ---------- lucro de um pedido ----------
// usa a taxa do canal quando houver; senão a do produto. Desconta frete.
// Retorna null quando o pedido não está ligado a um produto cadastrado.
export function lucroPedido(p, db) {
  const prod = (db.produtos || []).find(x => x.id === p.produto);
  if (!prod) return null;
  const q = num(p.qtd) || 1;
  const custo = calcCusto(prod, db).total * q;
  const can = (db.canais || []).find(c => c.id === p.canal);
  const taxaPct = can ? num(can.taxa) : num(prod.taxa);
  return num(p.valor) * (1 - taxaPct / 100) - custo - num(p.frete);
}

// quanto ainda falta receber de um pedido
export function saldoPedido(p) {
  const pago = (p.pagamentos || []).reduce((s, x) => s + num(x.v), 0);
  return { pago, falta: Math.max(0, num(p.valor) - pago) };
}

// ---------- custo médio ponderado ao comprar ----------
// estoqueAntes/custoAntes + compra → novo custo unitário
export function custoMedio(estoqueAntes, custoAntes, qtd, valorTotal) {
  const eA = num(estoqueAntes), cA = num(custoAntes), q = num(qtd), v = num(valorTotal);
  const novoEstoque = eA + q;
  if (v <= 0 || novoEstoque <= 0) return { estoque: novoEstoque, custo: cA };
  return { estoque: novoEstoque, custo: Math.round(((eA * cA) + v) / novoEstoque * 100) / 100 };
}

// ---------- consumo de insumos de uma produção ----------
// Quanto cada insumo baixa ao produzir `qtd` peças de `prod` (limitado ao estoque).
export function baixasProducao(prod, qtd, insumos) {
  const q = num(qtd);
  return (prod?.receita || []).map(l => {
    const ins = (insumos || []).find(i => i.id === l.insumo);
    if (!ins) return null;
    const usado = num(l.qtd) * q;
    return { insumo: ins.id, nome: ins.nome, unidade: ins.unidade, pedido: usado, qtd: Math.min(num(ins.estoque), usado) };
  }).filter(Boolean);
}

// ---------- dias de estoque restantes ----------
// Consumo médio dos últimos `janela` dias (a partir das baixas registradas).
export function diasEstoque(insumo, producao, hojeISO, janela = 90) {
  const corte = new Date(hojeISO + 'T12:00:00');
  corte.setDate(corte.getDate() - janela);
  const cISO = hoje(corte);
  let cons = 0;
  (producao || []).filter(p => (p.data || '') >= cISO)
    .forEach(p => (p.baixas || []).forEach(b => { if (b.insumo === insumo.id) cons += num(b.qtd); }));
  if (cons <= 0) return null;
  return Math.round(num(insumo.estoque) / (cons / janela));
}

// ---------- reposição preditiva ----------
// Cruza o consumo diário (dias de estoque) com o prazo de entrega do fornecedor:
// diz ATÉ QUANDO pedir para o material não faltar.
export function previsaoReposicao(insumo, ctx) {
  const { producao = [], cotacoes = [], fornecedores = [], compras = [], hojeISO = hoje(), janela = 90 } = ctx || {};
  const dias = diasEstoque(insumo, producao, hojeISO, janela);
  if (dias === null) return null; // sem consumo registrado: nada a prever

  // prazo do fornecedor: melhor score entre os que já cotaram este insumo;
  // se ninguém cotou, usa o prazo médio geral; se nada disso, assume 7 dias.
  let prazo = null, fornecedor = null;
  const candidatos = (fornecedores || []).map(f => {
    const s = scoreFornecedor(f.id, cotacoes);
    const cotouEste = (cotacoes || []).some(c =>
      (c.respostas || []).some(r => r.fornecedorId === f.id && r.precos && r.precos[insumo.id]));
    return { f, s, cotouEste };
  }).filter(x => x.s.prazoMed !== null);

  const doInsumo = candidatos.filter(x => x.cotouEste);
  const pool = doInsumo.length ? doInsumo : candidatos;
  if (pool.length) {
    // menor prazo entre os candidatos
    const melhor = pool.reduce((a, b) => (a.s.prazoMed <= b.s.prazoMed ? a : b));
    prazo = melhor.s.prazoMed;
    fornecedor = melhor.f.nome;
  }
  // sem histórico de cotação: tenta o último fornecedor que vendeu este insumo
  if (prazo === null) {
    const ult = (compras || []).filter(c => c.insumo === insumo.id && c.fornecedor).sort((a, b) => (a.data || '') < (b.data || '') ? 1 : -1)[0];
    if (ult) fornecedor = ult.fornecedor;
    prazo = 7;
  }

  const base = new Date(hojeISO + 'T12:00:00');
  const acaba = new Date(base); acaba.setDate(acaba.getDate() + dias);
  const pedirAte = new Date(acaba); pedirAte.setDate(pedirAte.getDate() - prazo);
  const diasAtePedir = Math.round((pedirAte - base) / 86400000);

  return {
    dias, prazo, fornecedor,
    acabaEm: hoje(acaba),
    pedirAte: hoje(pedirAte),
    diasAtePedir,
    urgente: diasAtePedir <= 0,      // já passou da hora
    atencao: diasAtePedir > 0 && diasAtePedir <= 7,
  };
}

// ---------- preço defasado ----------
// Compara a margem de hoje com a margem de referência (gravada quando o preço
// foi definido). Sem referência, usa o markup do produto como alvo.
export function precoDefasado(p, db, tolerancia = 5) {
  const atual = precoProduto(p, db);
  if (!num(p.preco)) return null;             // preço automático acompanha o custo
  const refPct = p.margemRef !== undefined && p.margemRef !== ''
    ? num(p.margemRef)
    : (atual.markup > 0 ? Math.round((1 - 1 / atual.markup) * 100) : null);
  if (refPct === null) return null;
  const queda = refPct - atual.margemPct;
  if (queda < tolerancia) return null;
  // preço que devolveria a margem de referência (considerando a taxa)
  const taxaFrac = num(p.taxa) / 100;
  const denom = (1 - refPct / 100 - taxaFrac);
  const sugerido = denom > 0 ? atual.custo / denom : atual.custo * atual.markup;
  return {
    margemAtual: atual.margemPct, margemRef: refPct, queda,
    precoAtual: atual.praticado, sugerido: Math.ceil(sugerido), custo: atual.custo,
  };
}

// ---------- sazonalidade ----------
// Índice por mês (1 = média). Precisa de pelo menos `minMeses` meses com venda.
export function sazonalidade(pedidos, hojeISO = hoje(), minMeses = 12) {
  const porMes = {};
  (pedidos || []).forEach(p => {
    if (p.situacao !== 'Pago' && p.situacao !== 'Entregue') return;
    const m = (p.data || '').slice(0, 7);
    if (!m) return;
    porMes[m] = (porMes[m] || 0) + num(p.valor);
  });
  const meses = Object.keys(porMes);
  if (meses.length < minMeses) return { pronto: false, meses: meses.length, faltam: minMeses - meses.length };

  // média por mês do calendário (1-12), normalizada pela média geral
  const soma = Array(13).fill(0), cont = Array(13).fill(0);
  meses.forEach(m => { const i = Number(m.slice(5, 7)); soma[i] += porMes[m]; cont[i]++; });
  const medias = [];
  for (let i = 1; i <= 12; i++) medias[i] = cont[i] ? soma[i] / cont[i] : null;
  const validos = medias.filter(v => v !== null && v > 0);
  const geral = validos.length ? validos.reduce((a, b) => a + b, 0) / validos.length : 0;
  if (!geral) return { pronto: false, meses: meses.length, faltam: 0 };

  const indices = [];
  for (let i = 1; i <= 12; i++) indices[i] = medias[i] === null ? null : Math.round(medias[i] / geral * 100) / 100;

  // próximos 3 meses e se são de pico (índice ≥ 1,2)
  const mAtual = Number(hojeISO.slice(5, 7));
  const NOMES = ['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const proximos = [1, 2, 3].map(d => {
    const i = ((mAtual - 1 + d) % 12) + 1;
    return { mes: i, nome: NOMES[i], indice: indices[i], pico: indices[i] !== null && indices[i] >= 1.2 };
  });
  const melhor = indices.reduce((best, v, i) => (v !== null && (best === null || v > indices[best]) ? i : best), null);
  return { pronto: true, indices, proximos, melhorMes: melhor, melhorNome: NOMES[melhor], mediaGeral: geral };
}

// ---------- ponto de equilíbrio ----------
export function pontoEquilibrio(produtos, fixos, db) {
  const margens = (produtos || []).map(p => precoProduto(p, db).margem).filter(m => m > 0);
  const media = margens.length ? margens.reduce((a, b) => a + b, 0) / margens.length : 0;
  const total = (fixos || []).reduce((s, f) => s + num(f.valor), 0);
  return media > 0 && total > 0 ? Math.ceil(total / media) : 0;
}

// ---------- score de fornecedor ----------
export function scoreFornecedor(fid, cotacoes) {
  let resp = 0, wins = 0, itensTot = 0;
  const prazos = [];
  (cotacoes || []).forEach(c => {
    const r = (c.respostas || []).find(x => x.fornecedorId === fid);
    if (!r) return;
    resp++;
    (c.itens || []).forEach(it => {
      const meu = r.precos[it.insumo];
      if (!meu) return;
      itensTot++;
      const todos = (c.respostas || []).map(x => x.precos[it.insumo] ? x.precos[it.insumo].preco : null).filter(p => p !== null);
      if (todos.length && meu.preco === Math.min(...todos)) wins++;
      const pz = num(meu.prazo);
      if (pz > 0) prazos.push(pz);
    });
  });
  return {
    resp,
    winPct: itensTot ? Math.round(wins / itensTot * 100) : null,
    prazoMed: prazos.length ? Math.round(prazos.reduce((a, b) => a + b, 0) / prazos.length) : null,
  };
}

// ---------- cesta ótima de uma cotação ----------
export function cestaOtima(cot, db) {
  let otima = 0, atual = 0, temAtual = false;
  (cot.itens || []).forEach(it => {
    const precos = (cot.respostas || []).map(f => f.precos[it.insumo] ? f.precos[it.insumo].preco : null).filter(p => p !== null);
    if (precos.length) otima += Math.min(...precos) * num(it.qtd);
    const ins = (db.insumos || []).find(x => x.id === it.insumo);
    if (ins && num(ins.custo) > 0) { atual += num(ins.custo) * num(it.qtd); temAtual = true; }
  });
  return { otima, atual, temAtual, economia: temAtual ? Math.max(0, atual - otima) : 0 };
}

// ---------- curva ABC ----------
// Ordena por valor e classifica: A até 80% acumulados, B até 95%, C o resto.
export function curvaABC(itens) {
  const ord = [...(itens || [])].sort((a, b) => b.valor - a.valor);
  const total = ord.reduce((s, x) => s + x.valor, 0);
  let acum = 0;
  return ord.map(x => {
    acum += x.valor;
    const pctAcum = total ? acum / total * 100 : 0;
    return { ...x, pct: total ? Math.round(x.valor / total * 100) : 0, classe: pctAcum <= 80 ? 'A' : pctAcum <= 95 ? 'B' : 'C' };
  });
}

// ---------- fechamento do mês (DRE) ----------
export function fechamentoMes(mes, db) {
  const peds = (db.pedidos || []).filter(p => (p.situacao === 'Pago' || p.situacao === 'Entregue') && (p.data || '').slice(0, 7) === mes);
  let receita = 0, taxas = 0, frete = 0, custoPecas = 0;
  peds.forEach(p => {
    receita += num(p.valor);
    const can = (db.canais || []).find(c => c.id === p.canal);
    const prod = (db.produtos || []).find(x => x.id === p.produto);
    const tp = can ? num(can.taxa) : (prod ? num(prod.taxa) : 0);
    taxas += num(p.valor) * tp / 100;
    frete += num(p.frete);
    if (prod) custoPecas += calcCusto(prod, db).total * (num(p.qtd) || 1);
  });
  const fixos = (db.fixos || []).reduce((s, f) => s + num(f.valor), 0);
  return { n: peds.length, receita, taxas, frete, custoPecas, fixos, liq: receita - taxas - frete - custoPecas - fixos };
}

// ---------- validação de formulários ----------
// Regras por tipo; devolve a primeira mensagem de erro ou null.
const REGRAS = {
  insumo: [
    ['nome', v => !String(v || '').trim() && 'Dê um nome ao insumo.'],
    ['estoque', v => num(v) < 0 && 'Estoque não pode ser negativo.'],
    ['minimo', v => num(v) < 0 && 'Estoque mínimo não pode ser negativo.'],
    ['custo', v => num(v) < 0 && 'Custo não pode ser negativo.'],
  ],
  producao: [
    ['qtd', v => num(v) <= 0 && 'Quantidade precisa ser maior que zero.'],
    ['minutos', v => num(v) < 0 && 'Tempo não pode ser negativo.'],
    ['data', v => dataAbsurda(v) && 'Confira a data.'],
  ],
  pedido: [
    ['valor', v => num(v) < 0 && 'Valor não pode ser negativo.'],
    ['qtd', v => v !== '' && num(v) <= 0 && 'Quantidade precisa ser maior que zero.'],
    ['frete', v => num(v) < 0 && 'Frete não pode ser negativo.'],
    ['data', v => dataAbsurda(v) && 'Confira a data.'],
  ],
  compra: [
    ['qtd', v => num(v) <= 0 && 'Quantidade precisa ser maior que zero.'],
    ['valor', v => num(v) < 0 && 'Valor não pode ser negativo.'],
    ['data', v => dataAbsurda(v) && 'Confira a data.'],
  ],
  produto: [['nome', v => !String(v || '').trim() && 'Dê um nome ao produto.']],
  molde: [
    ['nome', v => !String(v || '').trim() && 'Dê um nome ao molde.'],
    ['usos', v => num(v) < 0 && 'Usos não podem ser negativos.'],
    ['vida', v => v !== '' && num(v) <= 0 && 'Vida útil precisa ser maior que zero.'],
  ],
  fixo: [
    ['nome', v => !String(v || '').trim() && 'Dê um nome ao custo fixo.'],
    ['valor', v => num(v) < 0 && 'Valor não pode ser negativo.'],
  ],
  canal: [
    ['nome', v => !String(v || '').trim() && 'Dê um nome ao canal.'],
    ['taxa', v => (num(v) < 0 || num(v) > 100) && 'Taxa precisa ficar entre 0 e 100%.'],
  ],
  equip: [
    ['nome', v => !String(v || '').trim() && 'Dê um nome ao equipamento.'],
    ['custo', v => num(v) < 0 && 'Custo não pode ser negativo.'],
    ['vidaHoras', v => num(v) < 0 && 'Vida útil não pode ser negativa.'],
  ],
};
function dataAbsurda(v) {
  if (!v) return false;
  const a = Number(String(v).slice(0, 4));
  return !(a >= 2000 && a <= 2100);
}
export function validar(tipo, obj) {
  for (const [campo, teste] of (REGRAS[tipo] || [])) {
    const msg = teste(obj[campo]);
    if (msg) return msg;
  }
  return null;
}

// ---------- ramos de negócio (semente do onboarding) ----------
export const RAMOS = {
  velas: {
    nome: 'Velas e objetos de gesso',
    rotulos: { molde: 'Molde', moldes: 'Moldes', peca: 'peça', pecas: 'peças' },
    insumos: [
      { nome: 'Gesso alfa', unidade: 'kg', estoque: 5, minimo: 2, custo: 12 },
      { nome: 'Silicone (estanho)', unidade: 'kg', estoque: 2, minimo: 1, custo: 110 },
      { nome: 'Parafina 58-62°C', unidade: 'kg', estoque: 2, minimo: 1, custo: 32 },
      { nome: 'Essência', unidade: 'kg', estoque: 0.25, minimo: 0.2, custo: 160 },
      { nome: 'Pavio', unidade: 'un', estoque: 50, minimo: 20, custo: 0.6 },
      { nome: 'Embalagem', unidade: 'un', estoque: 15, minimo: 10, custo: 12 },
    ],
    moldes: [{ nome: 'Molde exemplo', material: 'gesso', usos: 0, vida: 40 }],
  },
  confeitaria: {
    nome: 'Confeitaria e alimentos',
    rotulos: { molde: 'Forma', moldes: 'Formas', peca: 'unidade', pecas: 'unidades' },
    insumos: [
      { nome: 'Farinha de trigo', unidade: 'kg', estoque: 5, minimo: 2, custo: 6 },
      { nome: 'Açúcar', unidade: 'kg', estoque: 5, minimo: 2, custo: 5 },
      { nome: 'Chocolate', unidade: 'kg', estoque: 2, minimo: 1, custo: 45 },
      { nome: 'Embalagem', unidade: 'un', estoque: 30, minimo: 15, custo: 2 },
    ],
    moldes: [{ nome: 'Forma exemplo', material: 'metal', usos: 0, vida: 500 }],
  },
  costura: {
    nome: 'Costura e artesanato têxtil',
    rotulos: { molde: 'Molde', moldes: 'Moldes', peca: 'peça', pecas: 'peças' },
    insumos: [
      { nome: 'Tecido algodão', unidade: 'm', estoque: 10, minimo: 5, custo: 25 },
      { nome: 'Linha', unidade: 'un', estoque: 10, minimo: 4, custo: 6 },
      { nome: 'Zíper', unidade: 'un', estoque: 20, minimo: 10, custo: 3 },
      { nome: 'Etiqueta da marca', unidade: 'un', estoque: 50, minimo: 20, custo: 0.8 },
    ],
    moldes: [{ nome: 'Molde exemplo', material: 'papel', usos: 0, vida: 100 }],
  },
  marcenaria: {
    nome: 'Marcenaria e decoração',
    rotulos: { molde: 'Gabarito', moldes: 'Gabaritos', peca: 'peça', pecas: 'peças' },
    insumos: [
      { nome: 'MDF 15mm', unidade: 'm²', estoque: 5, minimo: 2, custo: 90 },
      { nome: 'Verniz', unidade: 'L', estoque: 2, minimo: 1, custo: 60 },
      { nome: 'Parafusos', unidade: 'un', estoque: 200, minimo: 100, custo: 0.3 },
      { nome: 'Lixa', unidade: 'un', estoque: 20, minimo: 10, custo: 2.5 },
    ],
    moldes: [{ nome: 'Gabarito exemplo', material: 'madeira', usos: 0, vida: 200 }],
  },
  vazio: { nome: 'Começar do zero', rotulos: { molde: 'Molde', moldes: 'Moldes', peca: 'peça', pecas: 'peças' }, insumos: [], moldes: [] },
};
export function sementeRamo(ramo, novoId = uidGen) {
  const r = RAMOS[ramo] || RAMOS.vazio;
  return {
    insumos: r.insumos.map(i => ({ ...i, id: novoId() })),
    moldes: r.moldes.map(m => ({ ...m, id: novoId() })),
    rotulos: r.rotulos,
  };
}
