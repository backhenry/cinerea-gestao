// `${...}` só interpola dentro de crase.
//
// Achado no ar em ago/2026, na aba Equipe: onde devia haver um lápis de editar
// aparecia, escrito na tela, `${ico("lapis","Editar")}`.
//
// A causa foi a troca dos emoji por chamadas de função. `>✎</button>` virou
// `>${ico("lapis","Editar")}</button>` em trinta lugares, e quase todos eram
// template literal, mas quatro eram string de ASPAS SIMPLES, onde `${}` é
// texto comum. O código roda, nada estoura, e o defeito só existe na tela: é o
// mesmo padrão de todos os bugs deste projeto, que passam por sintaxe, por
// bundle e por log.
//
// POR QUE ESTE TESTE FIXA QUATRO LUGARES EM VEZ DE VARRER O ARQUIVO.
// Tentei duas vezes um verificador geral e as duas custaram mais do que
// entregam. Por expressão regular, ele acusa `onclick="del('${id}')"` dentro de
// um template, que é o uso CERTO e o mais comum do arquivo. Por varredura de
// estado, é preciso acompanhar crase, aspas, `${}` aninhado, contagem de
// chaves, comentário e literal de expressão regular, e ao primeiro
// dessincronismo ele passa a acusar tudo o que vem depois, sem dizer onde
// errou. Um verificador que dá alarme falso em massa não é usado: é desligado.
//
// Estes quatro são os que quebraram de verdade. Se aparecer um quinto, ele vem
// pelo mesmo caminho, alguém trocando um símbolo por uma chamada, e o lugar
// de pegá-lo é a tela, como este foi pego.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

/** Os quatro trechos, com a crase que os faz interpolar. */
const SITIOS = [
  {
    onde: 'selo de "no catálogo" na tabela de peças',
    certo: '` <span class="selo-loja" title="no catálogo">${ico("loja","no catálogo")}</span>`',
  },
  {
    onde: 'lápis de editar o próprio nome, na aba Equipe',
    certo: '` <button class="icon-btn" title="Editar meu nome" onclick="renomearMe()">${ico("lapis","Editar")}</button>`',
  },
  {
    onde: 'aviso de portal de cotação encerrado',
    certo: '`<div style="font-size:11px;color:var(--warm)">${ico("globo")} portal encerrado</div>`',
  },
  {
    onde: 'aviso de portal de cotação aberto',
    certo: '`<div style="font-size:11px;color:var(--ok)">${ico("globo")} aberto no portal</div>`',
  },
];

for (const { onde, certo } of SITIOS) {
  test(`interpola de verdade: ${onde}`, () => {
    assert.ok(js.includes(certo), `sumiu ou mudou o trecho de ${onde}`);
    // E a versão de aspas, que é a quebrada, não pode voltar.
    const quebrado = "'" + certo.slice(1, -1) + "'";
    assert.ok(!js.includes(quebrado), `voltou a ser string de aspas: ${onde}`);
  });
}

test('nenhum ${ico( sobrou dentro de aspas simples de uma linha só', () => {
  // Recorte estreito do problema, e por isso confiável: uma string de aspas
  // simples que ABRE logo depois de `?` ou `:` (o operador ternário, que é como
  // esses quatro nasceram) e contém `${ico(`. Não pega todo caso possível, // pega exatamente a forma que já quebrou, sem alarme falso.
  const suspeitos = [...js.matchAll(/[?:]\s*'([^'\n]*\$\{ico\([^'\n]*)'/g)].map(m => m[0]);
  assert.deepEqual(suspeitos, [], 'saem com o ${...} escrito na tela');
});
