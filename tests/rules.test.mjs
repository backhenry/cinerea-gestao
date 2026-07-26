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
