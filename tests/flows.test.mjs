// Testes de fluxo: caminhos completos que o app percorre, contra as regras reais.
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
});
test.after(async () => { await env.cleanup(); });

test('fluxo completo: criar empresa → convidar → entrar → operar', async () => {
  const dono = fs('f_dono');
  // dono cria empresa e o próprio membro
  await assertSucceeds(dono.doc('empresas/F1').set({ nome: 'Ateliê', dono: 'f_dono', dados: {} }));
  await assertSucceeds(dono.doc('empresas/F1/membros/f_dono').set({ nome: 'Dona' }));
  // dono cria convite de empregado
  await assertSucceeds(dono.doc('convites/FLX1').set({ empresaId: 'F1', papel: 'empregado' }));
  // convidado entra com o papel do convite e trabalha
  const emp = fs('f_emp');
  await assertSucceeds(emp.doc('empresas/F1/membros/f_emp').set({ nome: 'Ajudante', codigo: 'FLX1', papel: 'empregado' }));
  await assertSucceeds(emp.doc('empresas/F1').update({ dados: { producao: [{ id: 'p1', qtd: 2 }] }, atualizado: 1 }));
  // mas não alcança o financeiro nem os backups
  await assertFails(emp.doc('empresas/F1/fin/dados').set({ meta: 1 }));
  await assertFails(emp.doc('empresas/F1/backups/2026-07').get());
  // dono escreve o financeiro (migração) e o arquivo
  await assertSucceeds(dono.doc('empresas/F1/fin/dados').set({ meta: 500, prodFin: {} }));
  await assertSucceeds(dono.doc('empresas/F1/arquivo/2025').set({ producao: [], pedidos: [], compras: [] }));
  // qualquer membro registra diagnóstico de erro
  await assertSucceeds(emp.doc('empresas/F1/diag/erros').set({ ultimo: { t: 1, m: 'x' } }));
});

test('empregado promovido a sócio passa a ler o financeiro', async () => {
  const dono = fs('g_dono');
  await dono.doc('empresas/G1').set({ nome: 'A', dono: 'g_dono', dados: {} });
  await dono.doc('empresas/G1/membros/g_dono').set({ nome: 'D' });
  await dono.doc('empresas/G1/membros/g_emp').set({ nome: 'E', papel: 'empregado' });
  await dono.doc('empresas/G1/fin/dados').set({ meta: 100 });
  await assertFails(fs('g_emp').doc('empresas/G1/fin/dados').get());
  await assertSucceeds(dono.doc('empresas/G1/membros/g_emp').update({ papel: 'socio' }));
  await assertSucceeds(fs('g_emp').doc('empresas/G1/fin/dados').get());
});
