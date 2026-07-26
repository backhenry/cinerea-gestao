# Cinérea Gestão Online — Guia de Configuração

O app `Cinerea_Gestao_Online.html` guarda seus dados na nuvem e sincroniza entre
todos os aparelhos, com login. Para funcionar, ele precisa se conectar à SUA conta
Firebase (gratuita). São dois blocos de trabalho, feitos uma única vez: **configurar
o Firebase** e **publicar o app num link**. Reserve ~20 minutos.

> Firebase é o serviço de nuvem do próprio Google. A faixa gratuita (plano Spark)
> cobre com folga o uso de uma marca começando — você não vai pagar nada.

---

## PARTE 1 — Criar o projeto no Firebase (~10 min)

### 1. Criar o projeto
1. Acesse **console.firebase.google.com** e entre com sua conta Google.
2. Clique em **Adicionar projeto** (ou "Create a project").
3. Nome: `cinerea-gestao`. Avance.
4. Pode **desativar** o Google Analytics (não precisa). Criar projeto.

### 2. Registrar o app web
1. No painel do projeto, clique no ícone **`</>`** (Web).
2. Apelido do app: `cinerea`. **Não** marque Firebase Hosting agora. Registrar.
3. A tela vai mostrar um trecho `const firebaseConfig = { ... }` com várias chaves.
   **É isso que você precisa copiar.** Deixe essa aba aberta.

### 3. Colar as chaves no app
1. Abra o arquivo `Cinerea_Gestao_Online.html` num editor de texto (Bloco de Notas,
   VS Code, qualquer um).
2. Procure por `firebaseConfig` (perto do fim, dentro do `<script>`).
3. Substitua cada `"COLE_AQUI"` pelo valor correspondente da tela do Firebase —
   apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId.
4. Salve o arquivo.

### 4. Ativar o login por e-mail
1. No menu esquerdo do Firebase: **Criação → Authentication → Comece agora**.
2. Aba **Sign-in method** → clique em **E-mail/senha** → ative a primeira opção →
   Salvar.

### 5. Criar o banco de dados
1. No menu: **Criação → Firestore Database → Criar banco de dados**.
2. Local: pode deixar o sugerido (ou `southamerica-east1`, São Paulo).
3. Comece em **modo de produção**. Criar.
4. Aba **Regras (Rules)** — apague o que estiver lá e cole exatamente isto, para que
   cada usuário só acesse os próprios dados:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /usuarios/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

5. Clique em **Publicar**.

Pronto — o Firebase está configurado. Se você abrir o HTML agora (mesmo dando dois
cliques nele), ele vai mostrar a tela de login em vez da tela de configuração. Crie
sua conta com e-mail e senha, e comece a usar.

---

## PARTE 2 — Publicar o app num link (~10 min)

Abrir o arquivo local já funciona, mas para acessar **da rua, no celular**, ele
precisa estar num endereço na web. O jeito mais fácil e grátis:

### Opção A — Netlify Drop (a mais simples)
1. Acesse **app.netlify.com/drop**.
2. Arraste o arquivo `Cinerea_Gestao_Online.html` para a área indicada.
   (Renomeie antes para `index.html` — assim o link fica limpo.)
3. Em segundos, o Netlify te dá um endereço tipo `algo-aleatorio.netlify.app`.
4. Abra esse link no celular e no computador — o mesmo login, os mesmos dados.
5. Crie conta grátis no Netlify para o link não expirar e poder renomeá-lo.

### Opção B — Firebase Hosting (tudo no mesmo lugar)
Se quiser manter tudo no Google, o próprio Firebase hospeda. Exige instalar uma
ferramenta de linha de comando — mais passos que o Netlify. Só vale se você preferir
não usar dois serviços. O guia do Netlify acima é mais rápido para começar.

### No celular, vira "app"
Abra o link no navegador do celular → menu → **Adicionar à tela de início**. Ele
passa a abrir como um aplicativo, em tela cheia.

---

## Como funciona no dia a dia

- **Login único:** você entra com e-mail e senha. O mesmo login no celular e no PC
  mostra os mesmos dados.
- **Salva sozinho:** cada mudança sincroniza na nuvem automaticamente (o indicador
  "sincronizado" no topo confirma). Não existe botão salvar.
- **Funciona junto:** se você editar no PC, o celular atualiza sozinho em segundos.

---

## Segurança e privacidade

- Suas chaves do Firebase **podem** ficar visíveis no código do site — isso é normal
  e esperado para apps web. A proteção real são as **regras do Firestore** (Parte 1,
  passo 5), que garantem que só você, logado, acessa seus dados. Não pule esse passo.
- Use uma senha que você não usa em outro lugar.
- O Firebase tem backup próprio, mas se quiser dormir tranquilo, dá para exportar os
  dados pelo painel do Firestore de tempos em tempos.

---

## Se algo der errado

- **App mostra "falta configurar":** alguma chave ainda está como `COLE_AQUI`, ou
  faltou salvar o arquivo. Revise a Parte 1, passo 3.
- **"Erro: auth/..." ao entrar:** login não ativado (Parte 1, passo 4) ou senha
  curta (mínimo 6 caracteres).
- **Entra mas não salva:** as regras do Firestore não foram publicadas (Parte 1,
  passo 5).
- **Quer recomeçar do zero:** no Firestore, apague o documento em
  `usuarios / [seu-id]`.

---

## Custo

Faixa gratuita do Firebase (Spark): 1 GB de dados e 50 mil leituras por dia. Uma
marca de velas com uma pessoa usa uma fração ínfima disso. Você não precisa colocar
cartão nem migrar de plano para usar. Se um dia a operação crescer muito, o Firebase
avisa antes de qualquer cobrança.
