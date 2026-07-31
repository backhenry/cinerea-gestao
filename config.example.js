// ─────────────────────────────────────────────────────────────
// EXEMPLO de configuração. Para usar:
// 1. Copie este arquivo para  config.js  (sem o ".example")
// 2. Preencha com as chaves do SEU projeto Firebase
// 3. config.js está no .gitignore — ele NUNCA vai para o GitHub
// ─────────────────────────────────────────────────────────────
window.CINEREA_CONFIG = {
  apiKey: "sua-api-key-aqui",
  authDomain: "seu-projeto.firebaseapp.com",
  projectId: "seu-projeto",
  storageBucket: "seu-projeto.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:abc123",

  // Chave de SITE do reCAPTCHA v3, usada pelo App Check.
  // Pegue em: Firebase Console -> App Check -> seu app web.
  // É pública (vai no HTML de qualquer página que use reCAPTCHA) — o que NUNCA
  // se põe aqui é a chave SECRETA do reCAPTCHA, que fica só no Console.
  // Sem esta linha, o App Check simplesmente não inicia e nada quebra.
  recaptchaSiteKey: ""
};
