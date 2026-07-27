// Testes das regras de segurança do Firestore (rodam no emulador).
// Executar: npm run test:rules
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import test from 'node:test';

let env;
const fs = u => env.authenticatedContext(u).firestore();

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-cinerea',
    firestore: { rules: readFileSync('docs/firestore.rules', 'utf8') },
  });
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    await d.doc('empresas/E1').set({ nome: 'Cinérea', dono: 'dono1', dados: {} });
    await d.doc('empresas/E1/membros/dono1').set({ nome: 'Dono' });
    await d.doc('empresas/E1/membros/adm1').set({ nome: 'Admin', papel: 'admin' });
    await d.doc('empresas/E1/membros/soc1').set({ nome: 'Sócia', papel: 'socio' });
    await d.doc('empresas/E1/membros/emp1').set({ nome: 'Empregado', papel: 'empregado' });
    await d.doc('empresas/E1/fin/dados').set({ meta: 1000, fixos: [] });
    await d.doc('convites/CODEMP').set({ empresaId: 'E1', papel: 'empregado' });
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

test('portal do fornecedor: a empresa lê as propostas recebidas', () =>
  assertSucceeds(fs('emp1').collection('rfq/RFQ1/respostas').get()));

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
