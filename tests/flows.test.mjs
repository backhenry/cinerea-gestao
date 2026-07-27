// Testes de fluxo: caminhos que o app percorre no dia a dia, contra as regras reais.
// A empresa e o dono são semeados (como no seed do rules.test); o resto é via cliente.
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import test from 'node:test';

let env;
const fs = u => env.authenticatedContext(u).firestore();

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-cinerea-flows',
    firestore: { rules: readFileSync('docs/firestore.rules', 'utf8') },
  });
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    await d.doc('empresas/F1').set({ nome: 'Ateliê', dono: 'f_dono', dados: {} });
    await d.doc('empresas/F1/membros/f_dono').set({ nome: 'Dona' });
    await d.doc('empresas/G1').set({ nome: 'A', dono: 'g_dono', dados: {} });
    await d.doc('empresas/G1/membros/g_dono').set({ nome: 'D' });
    await d.doc('empresas/G1/membros/g_emp').set({ nome: 'E', papel: 'empregado' });
    await d.doc('empresas/G1/fin/dados').set({ meta: 100 });
  });
});
test.after(async () => { await env.cleanup(); });

test('fluxo: convidar → entrar → operar, sem alcançar o financeiro', async () => {
  const dono = fs('f_dono');
  // dono (gestor) cria o convite de empregado
  await assertSucceeds(dono.doc('convites/FLX1').set({ empresaId: 'F1', papel: 'empregado' }));
  // convidado entra com o papel do convite e trabalha
  const emp = fs('f_emp');
  await assertSucceeds(emp.doc('empresas/F1/membros/f_emp').set({ nome: 'Ajudante', codigo: 'FLX1', papel: 'empregado' }));
  await assertSucceeds(emp.doc('empresas/F1').update({ dados: { producao: [{ id: 'p1', qtd: 2 }] }, atualizado: 1 }));
  // mas não alcança o financeiro nem os backups
  await assertFails(emp.doc('empresas/F1/fin/dados').set({ meta: 1 }));
  await assertFails(emp.doc('empresas/F1/backups/2026-07').get());
  // dono escreve financeiro (migração), arquivo e qualquer membro registra diagnóstico
  await assertSucceeds(dono.doc('empresas/F1/fin/dados').set({ meta: 500, prodFin: {} }));
  await assertSucceeds(dono.doc('empresas/F1/arquivo/2025').set({ producao: [], pedidos: [], compras: [] }));
  await assertSucceeds(emp.doc('empresas/F1/diag/erros').set({ ultimo: { t: 1, m: 'x' } }));
});

test('empregado promovido a sócio passa a ler o financeiro', async () => {
  await assertFails(fs('g_emp').doc('empresas/G1/fin/dados').get());
  await assertSucceeds(fs('g_dono').doc('empresas/G1/membros/g_emp').update({ papel: 'socio' }));
  await assertSucceeds(fs('g_emp').doc('empresas/G1/fin/dados').get());
});

test('empregado rebaixado de sócio perde o financeiro', async () => {
  await assertSucceeds(fs('g_dono').doc('empresas/G1/membros/g_emp').update({ papel: 'empregado' }));
  await assertFails(fs('g_emp').doc('empresas/G1/fin/dados').get());
});
