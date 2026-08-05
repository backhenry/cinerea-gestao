// Testes das regras de segurança do Firestore (rodam no emulador).
// Executar: npm run test:rules
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import test from 'node:test';

let env;
const fs = u => env.authenticatedContext(u).firestore();
// O contexto SEM LOGIN precisa nascer antes de qualquer outro Firestore ser
// usado: criado no meio da corrida, estoura com "Firestore has already been
// started and its settings can no longer be changed".
let semLogin;

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-cinerea',
    firestore: { rules: readFileSync('docs/firestore.rules', 'utf8') },
  });
  semLogin = env.unauthenticatedContext().firestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    await d.doc('empresas/E1').set({ nome: 'Cinérea', dono: 'dono1', dados: {} });
    await d.doc('empresas/E1/membros/dono1').set({ nome: 'Dono' });
    await d.doc('empresas/E1/membros/adm1').set({ nome: 'Admin', papel: 'admin' });
    await d.doc('empresas/E1/membros/soc1').set({ nome: 'Sócia', papel: 'socio' });
    await d.doc('empresas/E1/membros/emp1').set({ nome: 'Empregado', papel: 'empregado' });
    await d.doc('empresas/E1/fin/dados').set({ meta: 1000, fixos: [] });
    await d.doc('convites/CODEMP').set({ empresaId: 'E1', papel: 'empregado' });
    // Peça e vitrine da Ana, para os testes de `vitrines/` no fim do arquivo.
    // Semeado AQUI porque `withSecurityRulesDisabled` no meio da corrida estoura
    // com "Firestore has already been started".
    await d.doc('clientes/ana/pecas/04A2B3C4D5').set({ nome: 'Vela da sala' });
    await d.doc('vitrines/04A2B3C4D5').set({
      dono: 'ana', tipo: 'link', titulo: 'Playlist', dados: 'https://exemplo.com',
    });
  });
});
test.after(async () => { await env.cleanup(); });

test('estranho não lê a empresa', () =>
  assertFails(fs('intruso').doc('empresas/E1').get()));

test('membro lê a empresa', () =>
  assertSucceeds(fs('emp1').doc('empresas/E1').get()));

test('empregado NÃO lê o financeiro', () =>
  assertFails(fs('emp1').doc('empresas/E1/fin/dados').get()));

test('sócio lê o financeiro', () =>
  assertSucceeds(fs('soc1').doc('empresas/E1/fin/dados').get()));

test('admin escreve o financeiro', () =>
  assertSucceeds(fs('adm1').doc('empresas/E1/fin/dados').set({ meta: 2000 })));

test('empregado NÃO escreve o financeiro', () =>
  assertFails(fs('emp1').doc('empresas/E1/fin/dados').set({ meta: 0 })));

test('empregado NÃO se autopromove', () =>
  assertFails(fs('emp1').doc('empresas/E1/membros/emp1').update({ papel: 'admin' })));

test('empregado muda o próprio nome', () =>
  assertSucceeds(fs('emp1').doc('empresas/E1/membros/emp1').update({ nome: 'Novo Nome' })));

test('dono muda papel de outro membro', () =>
  assertSucceeds(fs('dono1').doc('empresas/E1/membros/emp1').update({ papel: 'socio' })));

test('sócio NÃO muda papel de outro membro', () =>
  assertFails(fs('soc1').doc('empresas/E1/membros/emp1').update({ papel: 'admin' })));

test('entrar com convite recebe o papel do convite', () =>
  assertSucceeds(fs('novato1').doc('empresas/E1/membros/novato1').set({ nome: 'N', codigo: 'CODEMP', papel: 'empregado' })));

test('convite NÃO permite papel maior que o do convite', () =>
  assertFails(fs('novato2').doc('empresas/E1/membros/novato2').set({ nome: 'N', codigo: 'CODEMP', papel: 'admin' })));

test('sem convite não entra', () =>
  assertFails(fs('novato3').doc('empresas/E1/membros/novato3').set({ nome: 'N', papel: 'empregado' })));

test('empregado salva os dados operacionais', () =>
  assertSucceeds(fs('emp1').doc('empresas/E1').update({ dados: { insumos: [] }, atualizado: 1 })));

test('empregado NÃO renomeia a empresa', () =>
  assertFails(fs('emp1').doc('empresas/E1').update({ nome: 'Golpe' })));

test('ninguém troca o dono', () =>
  assertFails(fs('adm1').doc('empresas/E1').update({ dono: 'adm1' })));

test('gestor remove membro, mas não o dono', async () => {
  await assertFails(fs('adm1').doc('empresas/E1/membros/dono1').delete());
  await assertSucceeds(fs('adm1').doc('empresas/E1/membros/emp1').delete());
});

test('catálogo é público para leitura', () =>
  assertSucceeds(env.unauthenticatedContext().firestore().doc('catalogo/E1').get()));

// ---------- portal do cliente ----------
test('portal do cliente: qualquer um com o link lê', async () => {
  await env.withSecurityRulesDisabled(async ctx =>
    ctx.firestore().doc('portal/TOK1').set({ empresaId: 'E1', item: 'Vela', valor: 100, etapa: 1 }));
  await assertSucceeds(env.unauthenticatedContext().firestore().doc('portal/TOK1').get());
});

test('portal do cliente: estranho não escreve', () =>
  assertFails(env.unauthenticatedContext().firestore().doc('portal/TOK2').set({ empresaId: 'E1', item: 'x' })));

test('portal do cliente: membro publica o pedido da própria empresa', () =>
  assertSucceeds(fs('dono1').doc('portal/TOK3').set({ empresaId: 'E1', item: 'Vela', valor: 50, etapa: 0 })));

test('portal do cliente: membro não publica em nome de outra empresa', () =>
  assertFails(fs('dono1').doc('portal/TOK4').set({ empresaId: 'EX', item: 'x' })));

// ---------- portal do fornecedor ----------
test('portal do fornecedor: cotação é legível pelo link', async () => {
  await env.withSecurityRulesDisabled(async ctx =>
    ctx.firestore().doc('rfq/RFQ1').set({ empresaId: 'E1', empresa: 'Ateliê', itens: [{ insumo: 'i1', nome: 'Gesso', qtd: 5 }], fechada: false }));
  await assertSucceeds(env.unauthenticatedContext().firestore().doc('rfq/RFQ1').get());
});

test('portal do fornecedor: envia proposta sem login', () =>
  assertSucceeds(env.unauthenticatedContext().firestore()
    .collection('rfq/RFQ1/respostas').add({ fornecedor: 'Casa do Gesso', precos: { i1: { preco: 10 } }, criado: 1 })));

test('portal do fornecedor: proposta com campos estranhos é rejeitada', () =>
  assertFails(env.unauthenticatedContext().firestore()
    .collection('rfq/RFQ1/respostas').add({ fornecedor: 'X', precos: {}, criado: 1, admin: true })));

test('portal do fornecedor: proposta sem nome é rejeitada', () =>
  assertFails(env.unauthenticatedContext().firestore()
    .collection('rfq/RFQ1/respostas').add({ fornecedor: '', precos: { i1: { preco: 1 } }, criado: 1 })));

test('portal do fornecedor: fornecedor NÃO lê as propostas dos concorrentes', () =>
  assertFails(env.unauthenticatedContext().firestore().collection('rfq/RFQ1/respostas').get()));

// dono1, e não emp1: o teste de remoção acima tira emp1 da empresa
test('portal do fornecedor: a empresa lê as propostas recebidas', () =>
  assertSucceeds(fs('dono1').collection('rfq/RFQ1/respostas').get()));

test('portal do fornecedor: ex-membro perde acesso às propostas', () =>
  assertFails(fs('emp1').collection('rfq/RFQ1/respostas').get()));

test('portal do fornecedor: proposta enviada não pode ser alterada nem apagada', async () => {
  let id;
  await env.withSecurityRulesDisabled(async ctx => {
    const ref = await ctx.firestore().collection('rfq/RFQ1/respostas').add({ fornecedor: 'A', precos: { i1: { preco: 9 } }, criado: 1 });
    id = ref.id;
  });
  const anon = env.unauthenticatedContext().firestore();
  await assertFails(anon.doc('rfq/RFQ1/respostas/' + id).update({ 'precos.i1.preco': 1 }));
  await assertFails(anon.doc('rfq/RFQ1/respostas/' + id).delete());
});

test('portal do fornecedor: cotação encerrada não aceita mais propostas', async () => {
  await env.withSecurityRulesDisabled(async ctx =>
    ctx.firestore().doc('rfq/RFQFECH').set({ empresaId: 'E1', itens: [], fechada: true }));
  await assertFails(env.unauthenticatedContext().firestore()
    .collection('rfq/RFQFECH/respostas').add({ fornecedor: 'Tarde', precos: { i1: { preco: 5 } }, criado: 1 }));
});

test('portal do fornecedor: estranho não publica cotação', () =>
  assertFails(env.unauthenticatedContext().firestore().doc('rfq/RFQ9').set({ empresaId: 'E1', itens: [] })));

// ---------------------------------------------------------------------------
// Quem pode abrir empresa (coleção `gestores`, fechada na Fase 2.5 do app)
// ---------------------------------------------------------------------------

test('conta comum NÃO cria empresa', () =>
  assertFails(fs('forasteiro').doc('empresas/NOVA').set({ nome: 'Golpe', dono: 'forasteiro', dados: {} })));

test('quem está em gestores cria empresa', async () => {
  await env.withSecurityRulesDisabled(async ctx =>
    ctx.firestore().doc('gestores/dacasa').set({ nome: 'Da Casa' }));
  await assertSucceeds(fs('dacasa').doc('empresas/NOVA2').set({ nome: 'Cinérea', dono: 'dacasa', dados: {} }));
});

test('gestor NÃO cria empresa em nome de outra pessoa', () =>
  assertFails(fs('dacasa').doc('empresas/NOVA3').set({ nome: 'Laranja', dono: 'forasteiro', dados: {} })));

test('cada um lê só o próprio gestores; escrita é só pelo Console', async () => {
  // é isto que faz o app mostrar "registrar peça" só para quem é da casa
  await assertSucceeds(fs('dacasa').doc('gestores/dacasa').get());
  await assertFails(fs('forasteiro').doc('gestores/dacasa').get());
  await assertFails(fs('dacasa').doc('gestores/dacasa').set({ nome: 'X' }));
});

// ---------------------------------------------------------------------------
// Certidão da peça: registro de fábrica em `pecas/{tagUid}`
// ---------------------------------------------------------------------------

test('qualquer um lê a certidão de uma peça, até sem login', async () => {
  await env.withSecurityRulesDisabled(async ctx =>
    ctx.firestore().doc('pecas/04A2B3').set({ modelo: 'Ondina', serie: 12, total: 40 }));
  await assertSucceeds(env.unauthenticatedContext().firestore().doc('pecas/04A2B3').get());
  await assertSucceeds(fs('ana').doc('pecas/04A2B3').get());
});

test('cliente NÃO forja procedência de peça', async () => {
  await assertFails(fs('ana').doc('pecas/FALSA').set({ modelo: 'Ondina', serie: 1 }));
  await assertFails(fs('ana').doc('pecas/04A2B3').set({ modelo: 'Ondina', serie: 999 }));
});

test('quem é da casa registra peça na produção', async () => {
  await assertSucceeds(fs('dacasa').doc('pecas/04NOVA').set({ modelo: 'Ondina', serie: 13 }));
});

test('peça registrada não se apaga, nem por quem é da casa', async () => {
  await assertFails(fs('dacasa').doc('pecas/04A2B3').delete());
});

// ---------------------------------------------------------------------------
// App dos clientes (cinerea-app): mora no mesmo projeto, isolado da gestão
// ---------------------------------------------------------------------------

test('cliente escreve e lê a própria peça', async () => {
  await assertSucceeds(fs('ana').doc('clientes/ana').set({ nome: 'Ana' }));
  await assertSucceeds(fs('ana').doc('clientes/ana/pecas/04A2B3').set({ nome: 'Vela da sala' }));
});

test('cliente NÃO alcança as peças de outro cliente', async () => {
  await assertFails(fs('bruno').doc('clientes/ana/pecas/04A2B3').get());
  await assertFails(fs('bruno').doc('clientes/ana/pecas/04A2B3').set({ nome: 'roubada' }));
});

test('cliente do app não enxerga a gestão, e a gestão não enxerga as peças', async () => {
  await assertFails(fs('ana').doc('empresas/E1').get());
  await assertFails(fs('dono1').doc('clientes/ana/pecas/04A2B3').get());
});

test('subcoleção não declarada em clientes/ falha fechado', () =>
  assertFails(fs('ana').doc('clientes/ana/rascunhos/x').set({ a: 1 })));

// ── vitrines/ ─────────────────────────────────────────────────────────────
// A página que o convidado vê ao encostar o celular na peça. Estes testes
// vieram do repo do app (tests/regras.test.mjs) quando as duas cópias das
// regras divergiram: o bloco de `vitrines` estava publicado em produção e o CI
// daqui não o conhecia, ou seja, guardava uma regra que não estava no ar.
const TAG = '04A2B3C4D5';

test('NINGUÉM lista portal nem rfq, dados de cliente e de fornecedor', async () => {
  // Mesma falha das peças, em coleções mais sensíveis: o token no id é o
  // segredo, e listar entregava todos os portais (dados de pedido de cada
  // cliente) e todas as cotações (com quem a casa negocia e o que pediu).
  for (const quem of [semLogin, fs('bruno')]) {
    await assertFails(quem.collection('portal').get());
    await assertFails(quem.collection('rfq').get());
  }
});

test('vitrine recusa campo estranho e texto gigante', async () => {
  // Sem limite, quem tem uma peça gravava 1 MB de lixo numa coleção de leitura
  // pública, e a conta chega para o dono, porque o Blaze não tem teto.
  await assertFails(fs('ana').doc(`vitrines/${TAG}`).set({
    dono: 'ana', tipo: 'recado', titulo: 'Recado', dados: 'oi', invadido: 'campo que ninguém previu',
  }));
  await assertFails(fs('ana').doc(`vitrines/${TAG}`).set({
    dono: 'ana', tipo: 'recado', titulo: 'Recado', dados: 'x'.repeat(5000),
  }));
  await assertSucceeds(fs('ana').doc(`vitrines/${TAG}`).set({
    dono: 'ana', tipo: 'recado', titulo: 'Recado', dados: 'no tamanho certo',
  }));
});

test('encomenda recusa endereço e recado gigantes, e campo estranho', async () => {
  const base = {
    clienteUid: 'ana', clienteNome: 'Ana', clienteEmail: 'a@b.c',
    clienteTelefone: '11999999999', endereco: 'Rua X, 1', recado: '',
    itens: [{ id: 'p1', nome: 'Apolo', preco: 200, qtd: 1 }],
    totalVisto: 200, situacao: 'nova',
  };
  await assertSucceeds(fs('ana').collection('encomendas').doc('e1').set(base));
  await assertFails(fs('ana').collection('encomendas').doc('e2')
    .set({ ...base, endereco: 'x'.repeat(2000) }));
  await assertFails(fs('ana').collection('encomendas').doc('e3')
    .set({ ...base, recado: 'x'.repeat(2000) }));
  await assertFails(fs('ana').collection('encomendas').doc('e4')
    .set({ ...base, contrabando: 'campo que ninguém previu' }));
});

test('NINGUÉM lista peças nem vitrines, só lê por id', async () => {
  // Era a corrente inteira: enumerar os tagUid sem login, criar uma conta
  // comum, registrar as peças alheias na própria conta e assim ganhar
  // permissão de reescrever a vitrine pública de cada peça vendida.
  for (const quem of [semLogin, fs('bruno')]) {
    await assertFails(quem.collection('pecas').get());
    await assertFails(quem.collection('vitrines').get());
  }
  await assertSucceeds(semLogin.doc(`pecas/${TAG}`).get());
});

test('qualquer um lê a vitrine de uma peça, até sem login', () =>
  assertSucceeds(semLogin.doc(`vitrines/${TAG}`).get()));

test('o dono da peça publica a vitrine dela', () =>
  assertSucceeds(fs('ana').doc(`vitrines/${TAG}`).set({
    dono: 'ana', tipo: 'recado', titulo: 'Recado', dados: 'bem-vindo',
  })));

test('quem NÃO tem a peça não mexe na vitrine dela', async () => {
  // Bruno sabe o UID do chip, basta encostar o celular. Só isso não basta.
  await assertFails(fs('bruno').doc(`vitrines/${TAG}`).set({
    tipo: 'link', titulo: 'Sequestrada', dados: 'https://golpe.com',
  }));
  await assertFails(semLogin.doc(`vitrines/${TAG}`).set({
    tipo: 'link', titulo: 'Sequestrada', dados: 'https://golpe.com',
  }));
});

test('senha de wi-fi ENTRA na vitrine, decisão do dono', async () => {
  // A regra anterior a proibia. A Apple não implementa o registro de wi-fi do
  // NFC, então sem a senha na página um convidado de iPhone não conecta de
  // jeito nenhum. O dono escolheu funcionar, sabendo que quem tem o link vê a
  // senha sem ter tocado na peça (jul/2026).
  await assertSucceeds(fs('ana').doc(`vitrines/${TAG}`).set({
    dono: 'ana', tipo: 'wifi', titulo: 'Rede de wi-fi', dados: 'CasaDaAna', senha: 'segredo123',
  }));
  // e continua valendo que só o dono da peça publica
  await assertFails(fs('bruno').doc(`vitrines/${TAG}`).set({
    tipo: 'wifi', titulo: 'Rede de wi-fi', dados: 'CasaDoBruno', senha: 'x',
  }));
});

test('sem a peça na conta, nem o dono anterior apaga a vitrine', async () => {
  // É ISTO que obriga `passarAdiante` a apagar a vitrine ANTES do registro:
  // invertendo a ordem, quem dá a peça de presente perde para sempre a
  // permissão de limpar a própria página, que continua no ar com o que ele
  // deixou ali, hoje inclusive a senha do wi-fi de casa.
  await assertFails(fs('ana').doc('vitrines/SEMDONO01').delete());
});

test('vitrine aceita a lista de endereços, com teto de 12', async () => {
  const link = (i) => ({ rotulo: 'r' + i, url: 'https://exemplo.com/' + i, icone: 'site' });
  await assertSucceeds(fs('ana').doc(`vitrines/${TAG}`).set({
    dono: 'ana', tipo: 'links', titulo: 'Meus links', dados: '4 endereços',
    itens: [1, 2, 3, 4].map(link),
  }));
  // A regra não consegue percorrer a lista, regra não itera. O que ela segura
  // é a QUANTIDADE; o resto fica com o teto de 1 MB por documento.
  await assertFails(fs('ana').doc(`vitrines/${TAG}`).set({
    dono: 'ana', tipo: 'links', titulo: 'Meus links', dados: 'demais',
    itens: Array.from({ length: 13 }, (_, i) => link(i)),
  }));
});

test('quem publicou primeiro manda: outro nao sobrescreve nem apaga', async () => {
  // Conhecer o UID do chip basta para registrar a peca na propria conta, e
  // conhecer o UID e so ter encostado o celular na peca uma vez, numa festa.
  // Sem esta trava, o convidado de ontem reescrevia hoje a pagina da peca.
  await env.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().doc(`clientes/bruno/pecas/${TAG}`).set({ nome: 'roubada' });
  });
  await assertFails(fs('bruno').doc(`vitrines/${TAG}`).set({
    dono: 'bruno', tipo: 'link', titulo: 'Link', dados: 'https://golpe.com',
  }));
  // nem apagando para publicar por cima
  await assertFails(fs('bruno').doc(`vitrines/${TAG}`).delete());
  // e quem publicou continua podendo trocar
  await assertSucceeds(fs('ana').doc(`vitrines/${TAG}`).set({
    dono: 'ana', tipo: 'recado', titulo: 'Recado', dados: 'trocado por quem publicou',
  }));
});

test('ninguem publica em nome de outro', () =>
  assertFails(fs('ana').doc(`vitrines/${TAG}`).set({
    dono: 'bruno', tipo: 'recado', titulo: 'Recado', dados: 'assinado por outro',
  })));

test('o dono apaga a própria vitrine; estranho não', async () => {
  await assertFails(fs('bruno').doc(`vitrines/${TAG}`).delete());
  await assertSucceeds(fs('ana').doc(`vitrines/${TAG}`).delete());
});
