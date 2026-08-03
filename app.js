import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updateEmail, updatePassword, reauthenticateWithCredential, EmailAuthProvider, sendPasswordResetEmail, verifyBeforeUpdateEmail, sendEmailVerification, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, deleteField, arrayUnion, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, ref as sRef, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";
import * as Core from "./core.js";

// ============================================================
// COLE AQUI AS SUAS CHAVES DO FIREBASE (as mesmas do app anterior)
// As chaves vêm de config.js (que fica fora do Git — veja config.example.js)
const firebaseConfig = window.CINEREA_CONFIG || {
  apiKey: "COLE_AQUI", authDomain: "COLE_AQUI", projectId: "COLE_AQUI",
  storageBucket: "COLE_AQUI", messagingSenderId: "COLE_AQUI", appId: "COLE_AQUI"
};
// ============================================================

const isConfigured = firebaseConfig.apiKey !== "COLE_AQUI";
let app,auth,fdb,fstore,uid=null,saveTimer=null;
let eid=null,empresaNome='',empresaDono='',membros={},unsubData=null,unsubMembros=null,unsubFin=null,backupChecado=false;
let rawOp=null,rawFin=null,dbFinLoaded=false,migrouFin=false,minhasEmpresas={};
let db={acessos:[],equip:[],moldes:[],insumos:[],produtos:[],producao:[],pedidos:[],compras:[],fixos:[],clientes:[],canais:[],tarefas:[],cotacoes:[],fornecedores:[],atividade:[],vendedores:[],cupons:[],colecoes:[],meta:0,checks:{}};
// dados financeiros vivem num doc separado (empresas/{eid}/fin/dados) — só dono/admin/sócio leem
const FIN_KEYS=['fixos','meta','meiTeto','ultimoBackup'];
const PROD_FIN=['preco','markup','taxa','custohora','perda','equip'];
function rebuildDb(){
  limparMemo();
  const base=JSON.parse(JSON.stringify(rawOp||{}));
  db={acessos:[],equip:[],moldes:[],insumos:[],produtos:[],producao:[],pedidos:[],compras:[],fixos:[],clientes:[],canais:[],tarefas:[],cotacoes:[],fornecedores:[],atividade:[],vendedores:[],cupons:[],meta:0,checks:{},...base};
  if(rawFin){
    FIN_KEYS.forEach(k=>{if(rawFin[k]!==undefined)db[k]=rawFin[k];});
    const pf=rawFin.prodFin||{};db.produtos.forEach(p=>Object.assign(p,pf[p.id]||{}));
  }
}
function splitDb(){
  const op=JSON.parse(JSON.stringify(db));
  const fin={prodFin:{}};
  FIN_KEYS.forEach(k=>{if(op[k]!==undefined){fin[k]=op[k];delete op[k];}});
  (op.produtos||[]).forEach(p=>{const f={};PROD_FIN.forEach(k=>{if(p[k]!==undefined){f[k]=p[k];delete p[k];}});fin.prodFin[p.id]=f;});
  return{op,fin};
}
function migrarFinSePreciso(){
  if(migrouFin||!dbFinLoaded||!rawOp||!pode('fin'))return;
  const temFinNoOp=FIN_KEYS.some(k=>rawOp[k]!==undefined)||(rawOp.produtos||[]).some(p=>PROD_FIN.some(k=>p[k]!==undefined));
  if(!temFinNoOp)return;
  migrouFin=true;cloudSave(); // db já está mesclado; o save divide e limpa o doc operacional
}
let undoState=null,toastTimer=null,timerT0=null,timerInt=null,filtroMinhas=false,periodoDash=0;
const fP={q:'',m:''},fV={q:'',m:''};
function setPeriodoDash(v){periodoDash=Number(v)||0;renderAll();}
// corte de período para as análises do Painel (AAAA-MM mínimo; '' = sem corte)
function corteMes(){if(!periodoDash)return'';const d=new Date();d.setMonth(d.getMonth()-periodoDash+1);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');}
function pedidosPeriodo(){const c=corteMes();return db.pedidos.filter(p=>(p.situacao==='Pago'||p.situacao==='Entregue')&&(!c||(p.data||'').slice(0,7)>=c));}

// ---------- preferências de interface (tema + cor de destaque) ----------
const ACENTOS={'Brasa':'#B5462A','Verde':'#3F7D5B','Azul':'#33628C','Violeta':'#6D4E8C','Âmbar':'#C08A2E'};
function aplicarPrefs(p){
  p=p||{};window.__prefs=p;
  const escuro=p.tema==='escuro'||(p.tema==='auto'&&matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.tema=escuro?'escuro':'claro';
  document.documentElement.style.setProperty('--ember',p.acento||'#B5462A');
  const mt=document.querySelector('meta[name="theme-color"]');if(mt)mt.content=escuro?'#201D19':'#F2EFEA';
  if(uid&&typeof renderCharts==='function')try{renderCharts();}catch(e){}
}
try{aplicarPrefs(JSON.parse(localStorage.getItem('cinereaPrefs')||'{}'));}catch(e){}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if((window.__prefs||{}).tema==='auto')aplicarPrefs(window.__prefs);});
let charts={};

Object.assign(window,{escolherImagem,doAuth,toggleAuth,doLogout,openForm,closeModal,saveForm,del,addRecipeLine,rmRecipeLine,updateCost,exportCSV,exportPDF,exportCompras,saveCheck,buyDone,exportJSON,importJSON,setMeta,setMeiTeto,quickCliente,publicarCatalogo,doUndo,renderProducao,renderPedidos,fP,fV,criarEmpresaUI,entrarEmpresaUI,gerarConvite,removerMembro,renomearMe,moveTarefa,repetir,toggleTimer,exportDRE,openPerfil,sairEmpresa,esqueciSenha,toggleMinhas,mudarPapel,dragTarefa,dropTarefa,addComent,gerarCotacao,importarCotacao,verCotacao,usarPrecoCotacao,verPrecos,criarTarefaProducao,addPagamento,arquivarAno,pedirNotifs,quickFornecedor,reciboPedido,cobrarPedido,duplicarProduto,verArquivo,abrirBusca,renderBusca,addContatoForn,rmContatoForn,setPeriodoDash,enviarCotacaoWhats,imprimirCotacao,subAba,maisLinhas,compartilharPedido,linkCotacao,buscarRespostasOnline,fecharRfq});

if(!isConfigured){document.getElementById('gateSetup').style.display='block';}
else{
  app=initializeApp(firebaseConfig);

  // APP CHECK — prova ao Firebase que a requisicao veio DESTE site, e nao de um
  // script qualquer com a chave web (que e publica e vai em todo HTML).
  //
  // Vem logo depois do initializeApp e ANTES dos servicos: o token precisa
  // existir quando a primeira chamada sair.
  //
  // A chave do reCAPTCHA fica no config.js, que esta fora do Git — nao porque
  // seja segredo (chave de SITE do reCAPTCHA e publica por natureza), e sim
  // para o repositorio publico nao carregar configuracao de ambiente.
  //
  // Sem a chave, o bloco nao roda e nada quebra: App Check so barra alguma
  // coisa quando a IMPOSICAO e ligada no Console, e ela comeca desligada. E o
  // primeiro servico a impor deve ser o Cloud Storage — e o unico que a gestao
  // usa, e a lacuna que a regra do Storage nao consegue fechar sozinha, porque
  // ela nao tem como saber quem e da casa sem consultar o Firestore.
  const chaveRecaptcha=(window.CINEREA_CONFIG||{}).recaptchaSiteKey;
  if(chaveRecaptcha){
    try{
      initializeAppCheck(app,{
        provider:new ReCaptchaV3Provider(chaveRecaptcha),
        isTokenAutoRefreshEnabled:true,
      });
    }catch(e){
      // Falhar aqui nao pode derrubar a gestao: sem imposicao ligada, o app
      // funciona igual — so nao envia o atestado.
      console.warn('App Check nao iniciou:',e);
    }
  }

  auth=getAuth(app);
  // cache local persistente: o app funciona offline e sincroniza ao reconectar
  fdb=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})});
  fstore=getStorage(app);
  document.getElementById('gateLogin').style.display='block';
  // Se a pessoa chegou clicando no convite, autentica ANTES de o observador
  // decidir a tela: senão ela vê a tela de entrar por um instante e acha que o
  // link não funcionou.
  entrarPorLink().catch(e=>console.error(e));
  onAuthStateChanged(auth,user=>{
    if(user){uid=user.uid;carregarConta();}
    else{uid=null;eid=null;if(unsubData)unsubData();if(unsubMembros)unsubMembros();
      document.getElementById('gateEmpresa').style.display='none';
      document.getElementById('gateLogin').style.display='block';
      document.getElementById('gate').style.display='flex';}
  });
}
// ---------- conta → empresa (multi-usuário) ----------
async function carregarConta(){
  try{
    const ps=await getDoc(doc(fdb,'usuarios',uid));
    const pdata=ps.exists()?ps.data():{};
    if(pdata.prefs){aplicarPrefs(pdata.prefs);try{localStorage.setItem('cinereaPrefs',JSON.stringify(pdata.prefs));}catch(e){}}
    minhasEmpresas=pdata.minhasEmpresas||{};
    if(pdata.empresaId){eid=pdata.empresaId;iniciarEmpresa();}
    else if(pdata.dados&&pdata.dados.insumos){await criarEmpresa('Cinérea',pdata.dados);} // migração automática do modelo antigo
    else if(await entrarPorEmail()){/* entrou pela autorização do e-mail */}
    else{mostrarOnboarding('');}
  }catch(e){console.error(e);mostrarOnboarding('Erro ao carregar sua conta. Publique as novas regras do Firestore (docs/firestore.rules) e recarregue.');}
}
/**
 * Entrar pela AUTORIZAÇÃO DE E-MAIL, sem código nenhum.
 *
 * A casa cadastrou o e-mail em Usuários; aqui a pessoa apenas cria a conta com
 * esse endereço e cai dentro da empresa, com o papel definido lá.
 *
 * O e-mail precisa estar CONFIRMADO, e a regra do servidor exige o mesmo. Sem
 * isso, quem soubesse o endereço convidado criava uma conta com ele e entrava
 * no lugar da pessoa. Quando falta confirmar, esta função não trava em silêncio:
 * ela oferece reenviar o link.
 */
async function entrarPorEmail(){
  const u = auth.currentUser;
  const email = (u && u.email || '').trim().toLowerCase();
  if(!email) return false;
  let a;
  try{ a = await getDoc(doc(fdb,'acessos',email)); }
  catch(e){ console.error(e); return false; }
  if(!a.exists()) return false;

  if(!u.emailVerified){
    mostrarOnboarding('');
    const box = document.getElementById('gateEmpErr');
    box.innerHTML = 'Falta <b>confirmar seu e-mail</b>. Abra o link que enviamos para '
      + esc(email) + ' e recarregue esta página. '
      + '<button class="swap" id="reenviar" style="margin-top:8px">Reenviar o link</button>';
    const bt = document.getElementById('reenviar');
    if(bt) bt.onclick = async () => {
      bt.disabled = true;
      try{ await sendEmailVerification(u); bt.textContent = 'Enviado — confira sua caixa'; }
      catch(e){ console.error(e); bt.textContent = 'Não consegui enviar agora'; }
    };
    return true;   // tratado: não cai no onboarding genérico
  }

  const e2 = a.data().empresaId;
  try{
    await setDoc(doc(fdb,'empresas',e2,'membros',uid), {
      nome: nomePadrao(), papel: a.data().papel || 'empregado',
      // O e-mail fica no documento de membro para a tela de Usuários conseguir
      // casar "quem foi autorizado" com "quem já entrou".
      email, entrou: Date.now(),
    });
    minhasEmpresas[e2] = 'Empresa';
    await setDoc(doc(fdb,'usuarios',uid), {empresaId:e2, minhasEmpresas:{[e2]:'Empresa'}}, {merge:true});
    eid = e2; iniciarEmpresa();
    return true;
  }catch(e){
    console.error(e);
    mostrarOnboarding('Seu e-mail está autorizado, mas não consegui concluir a entrada. Avise quem administra.');
    return true;
  }
}

function mostrarOnboarding(msg){
  document.getElementById('gate').style.display='flex';
  document.getElementById('gateLogin').style.display='none';
  document.getElementById('gateEmpresa').style.display='block';
  document.getElementById('gateEmpErr').textContent=msg||'';
}
function nomePadrao(){return ((auth.currentUser&&auth.currentUser.email)||'membro').split('@')[0];}
async function criarEmpresa(nome,dadosLegado,ramo){
  const ref=doc(collection(fdb,'empresas'));
  let dados=dadosLegado||{};
  if(!dadosLegado){ // empresa nova: semeia conforme o ramo escolhido (não mais dados fixos de velas)
    const s=sementeRamo(ramo||'vazio',uidGen);
    dados={insumos:s.insumos,moldes:s.moldes,rotulos:s.rotulos,ramo:ramo||'vazio',
      canais:[{id:uidGen(),nome:'Direto / Pix',taxa:0},{id:uidGen(),nome:'Feira',taxa:0},{id:uidGen(),nome:'Instagram',taxa:0},{id:uidGen(),nome:'Marketplace',taxa:12}]};
  }
  await setDoc(ref,{nome,dono:uid,dados,atualizado:Date.now()});
  await setDoc(doc(fdb,'empresas',ref.id,'membros',uid),{nome:nomePadrao(),entrou:Date.now()});
  minhasEmpresas[ref.id]=nome;
  await setDoc(doc(fdb,'usuarios',uid),{empresaId:ref.id,minhasEmpresas:{[ref.id]:nome}},{merge:true});
  eid=ref.id;iniciarEmpresa();
}
async function criarEmpresaUI(){
  const nome=document.getElementById('gEmpNome').value.trim();
  if(!nome){document.getElementById('gateEmpErr').textContent='Dê um nome à empresa.';return;}
  const ramo=(document.getElementById('gEmpRamo')||{}).value||'vazio';
  try{await criarEmpresa(nome,null,ramo);}catch(e){console.error(e);document.getElementById('gateEmpErr').textContent='Erro ao criar. Confira as regras do Firestore.';}
}
async function entrarEmpresaUI(){
  const cod=document.getElementById('gEmpCod').value.trim().toUpperCase();
  const err=document.getElementById('gateEmpErr');
  if(!cod){err.textContent='Digite o código de convite.';return;}
  try{
    const cs=await getDoc(doc(fdb,'convites',cod));
    if(!cs.exists()){err.textContent='Código inválido ou expirado.';return;}
    const e2=cs.data().empresaId;
    await setDoc(doc(fdb,'empresas',e2,'membros',uid),{nome:nomePadrao(),codigo:cod,papel:cs.data().papel||'empregado',entrou:Date.now()});
    minhasEmpresas[e2]='Empresa'; // provisório: o nome real chega no primeiro snapshot
    await setDoc(doc(fdb,'usuarios',uid),{empresaId:e2,minhasEmpresas:{[e2]:'Empresa'}},{merge:true});
    eid=e2;iniciarEmpresa();
  }catch(e){console.error(e);err.textContent='Não foi possível entrar. Confira o código e as regras do Firestore.';}
}
function iniciarEmpresa(){
  document.getElementById('gate').style.display='none';
  backupChecado=false;subscribe();subscribeMembros();
}
async function gerarConvite(){
  if(!pode('gerir')){toast('Só dono e admin podem convidar');return;}
  let papel=prompt('Papel do convidado — digite: empregado, socio ou admin','empregado');
  if(papel===null)return;
  papel=papel.trim().toLowerCase().replace('ó','o');
  if(!PAPEIS.includes(papel)){toast('Papel inválido — use empregado, socio ou admin');return;}
  try{
    db.convitesPorPapel=db.convitesPorPapel||{};
    let c=db.convitesPorPapel[papel];
    if(!c){c=Math.random().toString(36).slice(2,8).toUpperCase();
      await setDoc(doc(fdb,'convites',c),{empresaId:eid,papel,criado:Date.now()});
      db.convitesPorPapel[papel]=c;cloudSave();}
    if(navigator.clipboard)navigator.clipboard.writeText(c).catch(()=>{});
    toast('Convite de <b>'+PAPEL_LABEL[papel]+'</b>: <b>'+c+'</b> — copiado');
  }catch(e){console.error(e);toast('Erro ao gerar convite — confira as regras do Firestore');}
}
async function removerMembro(mUid){
  if(!pode('gerir')||mUid===empresaDono){toast('Sem permissão');return;}
  if(!confirm('Remover este membro da empresa?'))return;
  try{await deleteDoc(doc(fdb,'empresas',eid,'membros',mUid));toast('Membro removido');}
  catch(e){console.error(e);toast('Erro ao remover membro');}
}
async function renomearMe(){
  const atual=(membros[uid]||{}).nome||nomePadrao();
  const n=prompt('Seu nome (aparece nas tarefas):',atual);
  if(!n)return;
  try{await setDoc(doc(fdb,'empresas',eid,'membros',uid),{nome:n.trim()},{merge:true});}catch(e){console.error(e);}
}
// ---------- papéis e governança ----------
// dono: tudo · admin: tudo menos mexer no dono · sócio: vê financeiro, não gere equipe · empregado: só operação
const PAPEIS=['empregado','socio','admin'];
const PAPEL_LABEL={dono:'dono',admin:'admin',socio:'sócio',empregado:'empregado'};
function meuPapel(){if(!uid)return'empregado';if(uid===empresaDono)return'dono';return (membros[uid]&&membros[uid].papel)||'empregado';}
function pode(cap){const p=meuPapel();if(cap==='gerir')return p==='dono'||p==='admin';if(cap==='fin')return p!=='empregado';return true;}
function aplicarPapel(){
  const fin=pode('fin'),ger=pode('gerir');
  const tabOrc=document.querySelector('[data-tab="numeros"]');if(tabOrc)tabOrc.style.display=fin?'':'none';
  ['chCusto','chMargem','chRec','chMes','chLph','chSemana','abcBox','topCliBox','chSaz'].forEach(id=>{const el=document.getElementById(id);if(el){const card=el.closest('.chartcard');if(card)card.style.display=fin?'':'none';}});
  const per=document.getElementById('perDash');if(per)per.style.display=fin?'':'none';
  document.querySelectorAll('#p-dashboard .head-btns .btn2').forEach(b=>b.style.display=fin?'':'none');
  const conv=document.querySelector('[onclick="gerarConvite()"]');if(conv)conv.style.display=ger?'':'none';
  const pt=document.querySelector('#p-pedidos table');if(pt)pt.classList.toggle('no-fin',!fin);
  const pOrc=document.getElementById('p-numeros');
  if(!fin&&pOrc&&pOrc.classList.contains('active')){const d=document.querySelector('[data-tab="dashboard"]');if(d)d.click();}
}
async function mudarPapel(mUid){
  if(!pode('gerir')||mUid===empresaDono)return;
  const atual=(membros[mUid]||{}).papel||'empregado';
  const prox=PAPEIS[(PAPEIS.indexOf(atual)+1)%PAPEIS.length];
  try{await setDoc(doc(fdb,'empresas',eid,'membros',mUid),{papel:prox},{merge:true});toast('Papel de <b>'+esc((membros[mUid]||{}).nome||'membro')+'</b> agora é <b>'+PAPEL_LABEL[prox]+'</b>');}
  catch(e){console.error(e);toast('Erro ao mudar papel — confira as regras do Firestore');}
}
// ---------- perfil ----------
function openPerfil(){
  if(!uid)return;
  currentForm={type:'perfil',id:null,recipe:[]};window.currentForm=currentForm;
  document.getElementById('modalTitle').textContent='Meu perfil';
  const m=membros[uid]||{};const p=window.__prefs||{};
  document.getElementById('modalBody').innerHTML=`
    <div class="field"><label>Meu nome (aparece no time)</label><input id="f_pnome" value="${esc(m.nome||'')}"></div>
    <div class="field"><label>E-mail de login</label><input id="f_pemail" type="email" value="${esc((auth.currentUser&&auth.currentUser.email)||'')}"><div class="hint">Alterar pode pedir sua senha atual ou confirmação por link no novo e-mail</div></div>
    <div class="field"><label>Nova senha</label><input id="f_psenha" type="password" placeholder="deixe vazio para manter a atual"></div>
    ${pode('gerir')?`<div class="field"><label>Nome da empresa</label><input id="f_pempresa" value="${esc(empresaNome)}"></div><div class="field"><label>Endereço da empresa</label><input id="f_pendereco" value="${esc(db.endereco||'')}"><div class="hint">Aparece na aba Contato da planilha de cotação</div></div>`:''}
    <div class="field"><label>Meu papel</label><div style="padding:6px 0"><span class="papel ${meuPapel()}">${PAPEL_LABEL[meuPapel()]}</span> <span class="hint" style="display:inline">— define o que você vê e gerencia</span></div></div>
    <div class="field-row">
      <div class="field"><label>Tema</label><select id="f_ptema">${['claro','escuro','auto'].map(t=>`<option ${p.tema===t?'selected':''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>Cor de destaque</label><select id="f_pacento">${Object.entries(ACENTOS).map(([n,c])=>`<option value="${c}" ${(p.acento||'#B5462A')===c?'selected':''}>${n}</option>`).join('')}</select></div>
    </div>
    ${('Notification' in window)&&Notification.permission!=='granted'?`<button type="button" class="btn2" style="width:100%;margin-bottom:12px" onclick="pedirNotifs()">🔔 Ativar notificações neste aparelho</button>`:''}
    ${Object.keys(minhasEmpresas).length>1?`<div class="field"><label>Trocar de empresa</label><select id="f_ptrocar">${Object.entries(minhasEmpresas).map(([k,n])=>`<option value="${k}" ${k===eid?'selected':''}>${esc(n)}</option>`).join('')}</select></div>`:''}
    ${eid&&uid!==empresaDono?`<button class="btn2" style="color:var(--ember);border-color:var(--ember);width:100%" onclick="sairEmpresa()">Sair desta empresa</button>`:''}`;
  document.getElementById('overlay').classList.add('open');
}
async function comReauth(cur,fn){
  try{await fn();}
  catch(e){
    if(e.code==='auth/requires-recent-login'){
      const pw=prompt('Por segurança, confirme sua senha atual:');if(!pw)throw e;
      await reauthenticateWithCredential(cur,EmailAuthProvider.credential(cur.email,pw));
      await fn();
    }else throw e;
  }
}
async function salvarPerfil(){
  const nome=val('f_pnome').trim(),email=val('f_pemail').trim(),senha=val('f_psenha');
  const prefs={tema:val('f_ptema')||'claro',acento:val('f_pacento')||'#B5462A'};
  aplicarPrefs(prefs);try{localStorage.setItem('cinereaPrefs',JSON.stringify(prefs));}catch(e){}
  setDoc(doc(fdb,'usuarios',uid),{prefs},{merge:true}).catch(()=>{});
  if(nome&&eid&&nome!==(membros[uid]||{}).nome)setDoc(doc(fdb,'empresas',eid,'membros',uid),{nome},{merge:true}).catch(()=>{});
  if(pode('gerir')&&eid){const en=(val('f_pempresa')||'').trim();if(en&&en!==empresaNome)setDoc(doc(fdb,'empresas',eid),{nome:en},{merge:true}).catch(()=>{});
    const end=val('f_pendereco');if(end!==undefined&&end!==(db.endereco||'')){db.endereco=end;cloudSave();}}
  const cur=auth.currentUser;
  try{
    if(email&&cur&&email!==cur.email){
      try{await comReauth(cur,()=>updateEmail(cur,email));toast('E-mail alterado para '+esc(email));}
      catch(e){if(e.code==='auth/operation-not-allowed'){await comReauth(cur,()=>verifyBeforeUpdateEmail(cur,email));toast('Enviamos um link de confirmação para '+esc(email)+' — o e-mail muda após confirmar');}else throw e;}
    }
    if(senha){if(senha.length<6){toast('Senha nova muito curta (mínimo 6)');return;}await comReauth(cur,()=>updatePassword(cur,senha));toast('Senha alterada ✓');}
  }catch(e){console.error(e);const msgs={'auth/invalid-email':'E-mail inválido.','auth/email-already-in-use':'Este e-mail já está em uso.','auth/wrong-password':'Senha atual incorreta.','auth/invalid-credential':'Senha atual incorreta.'};toast(msgs[e.code]||'Erro ao atualizar a conta: '+e.code);return;}
  const trocar=val('f_ptrocar');
  if(trocar&&trocar!==eid){await setDoc(doc(fdb,'usuarios',uid),{empresaId:trocar},{merge:true});eid=trocar;backupChecado=false;iniciarEmpresa();subscribeMembros();closeModal();toast('Empresa trocada');return;}
  closeModal();toast('Perfil salvo ✓');
}
async function sairEmpresa(){
  if(uid===empresaDono){toast('O dono não pode sair da própria empresa');return;}
  if(!confirm('Sair desta empresa? Você perderá o acesso aos dados dela até ser convidado de novo.'))return;
  try{
    await deleteDoc(doc(fdb,'empresas',eid,'membros',uid));
    delete minhasEmpresas[eid];
    await setDoc(doc(fdb,'usuarios',uid),{empresaId:null,minhasEmpresas:{[eid]:deleteField()}},{merge:true});
    if(unsubData)unsubData();if(unsubMembros)unsubMembros();if(unsubFin)unsubFin();eid=null;closeModal();
    mostrarOnboarding('Você saiu da empresa. Crie uma nova ou entre com um convite.');
  }catch(e){console.error(e);toast('Erro ao sair da empresa');}
}
async function esqueciSenha(){
  const em=document.getElementById('gEmail').value.trim();
  const err=document.getElementById('gateErr');
  if(!em){err.textContent='Digite seu e-mail acima e toque de novo em "Esqueci a senha".';return;}
  try{await sendPasswordResetEmail(auth,em);err.textContent='';toast('Enviamos um link de redefinição para '+esc(em));}
  catch(e){err.textContent='Não foi possível enviar: '+(e.code==='auth/invalid-email'?'e-mail inválido.':e.code);}
}
function toggleMinhas(){filtroMinhas=!filtroMinhas;const b=document.getElementById('btnMinhas');if(b){b.textContent=filtroMinhas?'✓ Só minhas':'Só minhas';b.style.borderColor=filtroMinhas?'var(--ember)':'';b.style.color=filtroMinhas?'var(--ember)':'';}renderEquipe();}
async function arquivarAno(){
  if(!pode('gerir')){toast('Só dono e admin arquivam');return;}
  const ano=prompt('Arquivar registros de qual ano? (produção, pedidos concluídos e compras saem das telas e ficam no arquivo)',String(Number(hoje().slice(0,4))-1));
  if(!ano||!/^\d{4}$/.test(ano.trim()))return;
  const a=ano.trim();const pred=d=>(d||'').slice(0,4)===a;
  const concl=p=>p.situacao==='Entregue'||p.situacao==='Cancelado'||p.situacao==='Pago';
  const movP=db.producao.filter(p=>pred(p.data));
  const movV=db.pedidos.filter(p=>pred(p.data)&&concl(p));
  const movC=(db.compras||[]).filter(c=>pred(c.data));
  const total=movP.length+movV.length+movC.length;
  if(!total){toast('Nada de '+a+' para arquivar');return;}
  if(!confirm('Arquivar '+total+' registro(s) de '+a+'?'))return;
  try{
    const ref=doc(fdb,'empresas',eid,'arquivo',a);
    const cur=await getDoc(ref);const base=cur.exists()?cur.data():{};
    await setDoc(ref,{producao:[...(base.producao||[]),...movP],pedidos:[...(base.pedidos||[]),...movV],compras:[...(base.compras||[]),...movC],atualizado:Date.now()});
    db.producao=db.producao.filter(p=>!pred(p.data));
    db.pedidos=db.pedidos.filter(p=>!(pred(p.data)&&concl(p)));
    db.compras=(db.compras||[]).filter(c=>!pred(c.data));
    db.atividade=(db.atividade||[]).slice(0,20);
    logAtv('arquivou '+total+' registro(s) de '+a);
    cloudSave();renderAll();toast(total+' registro(s) arquivados — ficam em empresas/arquivo/'+a);
  }catch(e){console.error(e);toast('Erro ao arquivar — confira as regras do Firestore');}
}
// ---------- captura de erros (diagnóstico) ----------
function regErro(msg){try{if(!uid||!eid||!fdb)return;setDoc(doc(fdb,'empresas',eid,'diag','erros'),{ultimo:{t:Date.now(),u:uid,m:String(msg).slice(0,300)},lista:arrayUnion({t:Date.now(),m:String(msg).slice(0,300)})},{merge:true}).catch(()=>{});}catch(e){}}
window.addEventListener('error',e=>regErro((e.message||'erro')+' @'+String(e.filename||'').split('/').pop()+':'+e.lineno));
window.addEventListener('unhandledrejection',e=>regErro('promise: '+((e.reason&&e.reason.message)||e.reason)));
// ---------- notificações locais (tarefas novas e prazos de hoje) ----------
async function notificar(titulo,corpo){try{if(!('Notification' in window)||Notification.permission!=='granted')return;const reg=await navigator.serviceWorker.getRegistration();if(reg)reg.showNotification(titulo,{body:corpo,icon:'icon-192.png',badge:'icon-192.png'});else new Notification(titulo,{body:corpo,icon:'icon-192.png'});}catch(e){}}
function pedirNotifs(){if(!('Notification' in window)){toast('Este navegador não suporta notificações');return;}Notification.requestPermission().then(p=>toast(p==='granted'?'Notificações ativadas neste aparelho ✓':'Permissão negada'));}
function checarNotifs(){try{
  const key='cinereaTarefasVistas';const primeira=!localStorage.getItem(key);
  const vistas=JSON.parse(localStorage.getItem(key)||'[]');
  const minhas=(db.tarefas||[]).filter(t=>t.resp===uid&&(t.status||'aberta')!=='feita');
  if(!primeira)minhas.filter(t=>!vistas.includes(t.id)).forEach(t=>notificar('Nova tarefa para você',t.titulo));
  localStorage.setItem(key,JSON.stringify(minhas.map(t=>t.id)));
  const kd='cinereaPrazoAviso';
  if(localStorage.getItem(kd)!==hoje()){
    const venc=db.pedidos.filter(p=>p.prazo===hoje()&&p.situacao!=='Entregue'&&p.situacao!=='Cancelado');
    if(venc.length){notificar('Entregas para hoje','Você tem '+venc.length+' encomenda(s) vencendo hoje');localStorage.setItem(kd,hoje());}
  }
}catch(e){}}
async function checkBackup(){
  if(backupChecado||!eid||!dbFinLoaded||!pode('fin'))return;backupChecado=true;
  const mes=hoje().slice(0,7);
  if(db.ultimoBackup===mes)return;
  try{
    await setDoc(doc(fdb,'empresas',eid,'backups',mes),{dados:JSON.parse(JSON.stringify(db)),criado:Date.now()});
    const d=new Date();d.setMonth(d.getMonth()-7);
    const velho=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    deleteDoc(doc(fdb,'empresas',eid,'backups',velho)).catch(()=>{});
    db.ultimoBackup=mes;cloudSave();
  }catch(e){console.error(e);}
}
let authMode='login';
function toggleAuth(){authMode=authMode==='login'?'signup':'login';document.getElementById('gBtn').textContent=authMode==='login'?'Entrar':'Criar conta';document.getElementById('swapLbl').textContent=authMode==='login'?'Criar agora':'Já tenho conta';document.getElementById('gateErr').textContent='';}
async function doAuth(){const em=document.getElementById('gEmail').value,pw=document.getElementById('gPass').value,err=document.getElementById('gateErr');try{if(authMode==='signup'){const c=await createUserWithEmailAndPassword(auth,em,pw);try{await sendEmailVerification(c.user);}catch(e){console.error(e);}}else await signInWithEmailAndPassword(auth,em,pw);}catch(e){const m={'auth/invalid-email':'E-mail inválido.','auth/weak-password':'Senha curta (mín. 6).','auth/email-already-in-use':'E-mail já cadastrado — entre.','auth/invalid-credential':'E-mail ou senha incorretos.'};err.textContent=m[e.code]||'Erro: '+e.code;}}
function doLogout(){if(auth)signOut(auth);}
function subscribe(){
  if(unsubData)unsubData();if(unsubFin)unsubFin();
  rawOp=null;rawFin=null;dbFinLoaded=false;migrouFin=false;
  unsubData=onSnapshot(doc(fdb,'empresas',eid),snap=>{
    if(snap.exists()){const d=snap.data();empresaNome=d.nome||'';empresaDono=d.dono||'';rawOp=d.dados||{};}
    else{rawOp={};}
    rebuildDb();seedIfEmpty(false);
    const bn=document.getElementById('brandName');if(bn)bn.textContent=(empresaNome||'Cinérea')+' · Gestão';
    // guarda o nome real da empresa no perfil (o convite entra com placeholder)
    if(empresaNome&&minhasEmpresas[eid]!==empresaNome){minhasEmpresas[eid]=empresaNome;setDoc(doc(fdb,'usuarios',uid),{minhasEmpresas:{[eid]:empresaNome}},{merge:true}).catch(()=>{});}
    renderAll();flashSync(true);migrarFinSePreciso();checkBackup();checarNotifs();
  },err=>{console.error(err);eid=null;mostrarOnboarding('Você não tem mais acesso a esta empresa — crie outra ou peça um novo convite.');setDoc(doc(fdb,'usuarios',uid),{empresaId:null},{merge:true}).catch(()=>{});});
  unsubFin=onSnapshot(doc(fdb,'empresas',eid,'fin','dados'),snap=>{
    rawFin=snap.exists()?snap.data():{};dbFinLoaded=true;
    if(rawOp!==null){rebuildDb();renderAll();}
    migrarFinSePreciso();checkBackup();
  },err=>{dbFinLoaded=false;}); // empregado: sem acesso ao financeiro — segue só com o operacional
}
function subscribeMembros(){
  if(unsubMembros)unsubMembros();
  unsubMembros=onSnapshot(collection(fdb,'empresas',eid,'membros'),qs=>{membros={};qs.forEach(d=>membros[d.id]=d.data());renderAll();},err=>console.error(err));
}
function cloudSave(){if(!uid||!eid)return;limparMemo();flashSync(false);clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{
  let payloadOp,finToWrite=null;
  if(dbFinLoaded&&pode('fin')){const s=splitDb();payloadOp=s.op;finToWrite=s.fin;}
  else if(!pode('fin')){payloadOp=splitDb().op;} // empregado nunca grava campos financeiros
  else{payloadOp=JSON.parse(JSON.stringify(db));} // fin ainda não carregou: mantém tudo no operacional (a migração divide depois)
  const p=updateDoc(doc(fdb,'empresas',eid),{dados:payloadOp,atualizado:Date.now()});
  if(finToWrite)setDoc(doc(fdb,'empresas',eid,'fin','dados'),finToWrite).catch(e=>console.error(e));
  if(navigator.onLine){p.then(()=>flashSync(true)).catch(e=>console.error(e));}else{flashSync(true);}
}catch(e){console.error(e);}},400);}
function flashSync(ok){const el=document.getElementById('syncState');if(!ok){el.innerHTML='<span class="dot off"></span> salvando…';return;}el.innerHTML=navigator.onLine?'<span class="dot"></span> sincronizado':'<span class="dot off"></span> offline · salvo no aparelho';}

// helpers e cálculo vêm de core.js (puro e coberto por testes)
const {uidGen,brl,esc,num,insumoStatus,moldeStatus,validar,saldoPedido,custoMedio,curvaABC,cestaOtima,precoProduto,baixasProducao,pontoEquilibrio,RAMOS,sementeRamo}=Core;
const hoje=()=>Core.hoje();
function toast(msg){const t=document.getElementById('toast');t.innerHTML=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2600);}
function toastUndo(msg,snap){undoState=snap;const t=document.getElementById('toast');t.innerHTML=msg+' <button onclick="doUndo()" style="background:none;border:none;color:#e8a;text-decoration:underline;cursor:pointer;font-size:13px;margin-left:6px">Desfazer</button>';t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),7000);}
// Desfazer a exclusão de um cupom traz o cadastro de volta, mas o documento
// já saiu do ar: restaurar aqui sem repor lá deixaria o cupom "existindo" na
// gestão e morto na loja, que é a mesma discordância pela outra ponta.
let cupomApagadoNoUndo=null;
function doUndo(){
  if(!undoState)return;
  db=undoState;undoState=null;cloudSave();renderAll();
  const voltou=cupomApagadoNoUndo;cupomApagadoNoUndo=null;
  if(voltou){
    const c=(db.cupons||[]).find(x=>x.codigo===voltou);
    if(c) sincronizarCupom(c,null)
      .catch(e=>{console.error(e);toast('Desfeito aqui, mas o cupom <b>continua fora do ar</b>. Use "Conferir o que está no ar".');});
  }
  toast('Desfeito ✓');
}

// A semente agora vem do ramo escolhido no onboarding (criarEmpresa).
// Aqui só garantimos os canais de venda, que servem a qualquer negócio.
function seedIfEmpty(){
  if(db.canais&&db.canais.length)return;
  db.canais=[{id:uidGen(),nome:'Direto / Pix',taxa:0},{id:uidGen(),nome:'Feira',taxa:0},{id:uidGen(),nome:'Instagram',taxa:0},{id:uidGen(),nome:'Marketplace',taxa:12}];
  cloudSave();
}
// rótulos por ramo: "Moldes" vira "Formas" numa confeitaria, "Gabaritos" numa marcenaria
function rot(chave,fallback){return (db.rotulos&&db.rotulos[chave])||fallback;}
function aplicarRotulos(){
  const t=document.querySelector('[data-sub="moldes"]');if(t)t.textContent=rot('moldes','Moldes');
  const h=document.querySelector('#p-moldes h2');if(h)h.textContent=rot('moldes','Moldes');
  document.querySelectorAll('[data-rot-molde]').forEach(el=>el.textContent=rot('molde','Molde'));
}

document.querySelectorAll('#tabs button').forEach(b=>b.onclick=()=>{document.querySelectorAll('#tabs button').forEach(x=>{x.classList.remove('active');x.setAttribute('aria-selected','false');});b.classList.add('active');b.setAttribute('aria-selected','true');document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));document.getElementById('p-'+b.dataset.tab).classList.add('active');// no celular a barra rola: sem isto, tocar num grupo do fim deixa
  // o selecionado fora de vista
  b.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});renderAll();
  // Encomendas agora ABRE por padrão no grupo Vender, e a lista dela vem do
  // Firestore, não do cadastro local. Sem esta linha ela apareceria vazia até
  // alguém clicar na aba que já estava selecionada -- que é o tipo de tela que
  // faz parecer que não chegou encomenda nenhuma.
  if(b.dataset.tab==='vender'&&document.getElementById('s-encomendas')?.classList.contains('active')) carregarEncomendas();
});
// paginação: tabelas longas renderizam por blocos (evita centenas de linhas no DOM)
const PAG={producao:50,pedidos:50,compras:50};
function maisLinhas(k){
  PAG[k]=(PAG[k]||50)+50;
  const f={producao:()=>renderProducao(),pedidos:()=>renderPedidos(),compras:()=>renderComprasHist()}[k];
  if(f)f();labelize();
}
function linhaMais(k,total,mostrando,cols){
  if(mostrando>=total)return'';
  return `<tr><td colspan="${cols}" style="text-align:center;padding:14px"><button class="btn2" onclick="maisLinhas('${k}')">Mostrar mais ${Math.min(50,total-mostrando)} de ${total-mostrando} restantes</button></td></tr>`;
}

function rowActions(t,id,rep){return `<div class="row-actions">${rep?`<button class="icon-btn" title="Repetir" onclick="repetir('${t}','${id}')">⟳</button>`:''}<button class="icon-btn" onclick="openForm('${t}','${id}')">${ico("lapis","Editar")}</button><button class="icon-btn" onclick="del('${t}','${id}')">${ico("lixeira","Apagar")}</button></div>`;}
function repetir(type,id){const src=db[plural(type)].find(x=>x.id===id);if(!src)return;openForm(type);FORMS[type].fields.forEach(f=>{const el=document.getElementById('f_'+f.k);if(!el)return;if(f.t==='date'){el.value=f.k==='data'?hoje():'';}else if(src[f.k]!==undefined&&src[f.k]!==null)el.value=src[f.k];});}
function toggleTimer(){const b=document.getElementById('timerBtn'),v=document.getElementById('timerView');if(!b)return;
  if(timerT0){clearInterval(timerInt);timerInt=null;const min=(Date.now()-timerT0)/60000;timerT0=null;const f=document.getElementById('f_minutos');if(f)f.value=Math.max(1,Math.round(min));b.textContent='▶ Cronometrar uma peça';if(v)v.textContent='tempo registrado ✓';}
  else{timerT0=Date.now();b.textContent='⏹ Parar e registrar';timerInt=setInterval(()=>{if(!v)return;const s=Math.floor((Date.now()-timerT0)/1000);v.textContent=Math.floor(s/60)+':'+String(s%60).padStart(2,'0');},1000);}}
// wrappers: injetam `db` no núcleo. calcCusto é memoizado — era recalculado
// em loops aninhados (produtos × pedidos × gráficos) a cada render.
let memoCusto=new Map();
function limparMemo(){memoCusto=new Map();}
/** Ficha técnica: uma linha por item, "rótulo: valor". Linha sem ":" vira só valor. */
function parseFicha(txt){
  return String(txt||'').split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{
    const i=l.indexOf(':');
    return i>0 ? [l.slice(0,i).trim(), l.slice(i+1).trim()] : ['', l];
  }).filter(par=>par[1]);
}

function calcCusto(p){
  if(!p||!p.id)return Core.calcCusto(p||{},db); // produto em edição (sem id): sempre fresco
  const hit=memoCusto.get(p.id);
  if(hit)return hit;
  const r=Core.calcCusto(p,db);memoCusto.set(p.id,r);return r;
}
function lucroPedido(p){return Core.lucroPedido(p,db);}
function diasEstoque(i){return Core.diasEstoque(i,db.producao,hoje());}
function scoreFornecedor(fid){return Core.scoreFornecedor(fid,db.cotacoes);}
function previsao(i){return Core.previsaoReposicao(i,{producao:db.producao,cotacoes:db.cotacoes,fornecedores:db.fornecedores,compras:db.compras,hojeISO:hoje()});}
function precoDefasado(p){return Core.precoDefasado(p,db);}
function labelize(){document.querySelectorAll('.tablewrap table').forEach(t=>{const hs=[...t.querySelectorAll('thead th')].map(h=>h.textContent.trim());t.querySelectorAll('tbody tr').forEach(tr=>{[...tr.children].forEach((td,i)=>td.setAttribute('data-l',td.hasAttribute('colspan')?'':(hs[i]||'')));});});}
function fillMeses(selId,rows,cur){const sel=document.getElementById(selId);if(!sel)return;const ms=[...new Set(rows.map(r=>(r.data||'').slice(0,7)).filter(Boolean))].sort().reverse();sel.innerHTML='<option value="">todos os meses</option>'+ms.map(m=>`<option ${m===cur?'selected':''}>${m}</option>`).join('');}

function renderDash(){
  const lowIns=db.insumos.filter(i=>insumoStatus(i)!=='ok');
  const lowMold=db.moldes.filter(m=>moldeStatus(m)!=='ok');
  const totalProd=db.producao.reduce((s,p)=>s+Number(p.qtd||0),0);
  const receita=db.pedidos.filter(p=>p.situacao==='Pago'||p.situacao==='Entregue').reduce((s,p)=>s+Number(p.valor||0),0);
  // ponto de equilíbrio: custos fixos ÷ margem média das peças
  const margens=db.produtos.map(p=>{const c=calcCusto(p).total;const sug=c*Number(p.markup||3);const prat=Number(p.preco||sug);const taxa=prat*Number(p.taxa||0)/100;return prat-taxa-c;}).filter(m=>m>0);
  const mMed=margens.length?margens.reduce((a,b)=>a+b,0)/margens.length:0;
  const fixosTot=(db.fixos||[]).reduce((s,f)=>s+Number(f.valor||0),0);
  const pe=mMed>0&&fixosTot>0?Math.ceil(fixosTot/mMed):0;
  // meta do mês corrente
  const mesAtual=hoje().slice(0,7);
  const recMes=db.pedidos.filter(p=>(p.situacao==='Pago'||p.situacao==='Entregue')&&(p.data||'').slice(0,7)===mesAtual).reduce((s,p)=>s+Number(p.valor||0),0);
  // tendência vs mês anterior + projeção do ritmo atual
  const dAnt=new Date();dAnt.setMonth(dAnt.getMonth()-1);
  const mesAnt=dAnt.getFullYear()+'-'+String(dAnt.getMonth()+1).padStart(2,'0');
  const recAnt=db.pedidos.filter(p=>(p.situacao==='Pago'||p.situacao==='Entregue')&&(p.data||'').slice(0,7)===mesAnt).reduce((s,p)=>s+Number(p.valor||0),0);
  const trendRec=recAnt>0?Math.round((recMes/recAnt-1)*100):null;
  const trendHtml=trendRec===null?'':` <span style="font-size:12px;color:${trendRec>=0?'var(--ok)':'var(--ember)'}">${trendRec>=0?'↑':'↓'}${Math.abs(trendRec)}%</span>`;
  const diaHoje=Number(hoje().slice(8,10));
  const diasMes=new Date(Number(hoje().slice(0,4)),Number(hoje().slice(5,7)),0).getDate();
  const projMes=diaHoje>=3?recMes/diaHoje*diasMes:0;
  const meta=Number(db.meta||0);
  const pctMeta=meta>0?Math.min(100,Math.round(recMes/meta*100)):0;
  // teto MEI: receita do ano vs limite anual
  const ano=hoje().slice(0,4);
  const recAno=db.pedidos.filter(p=>(p.situacao==='Pago'||p.situacao==='Entregue')&&(p.data||'').slice(0,4)===ano).reduce((s,p)=>s+Number(p.valor||0),0);
  const teto=Number(db.meiTeto||81000);
  const pctMei=Math.min(100,Math.round(recAno/teto*100));
  const fin=pode('fin');
  document.getElementById('dashStats').innerHTML=`
    <div class="stat ${lowIns.length?'alert':''}"><div class="k">Insumos p/ repor</div><div class="v">${lowIns.length}</div><div class="s">de ${db.insumos.length}</div></div>
    <div class="stat ${lowMold.length?'alert':''}"><div class="k">Moldes no limite</div><div class="v">${lowMold.length}</div><div class="s">de ${db.moldes.length}</div></div>
    <div class="stat"><div class="k">Peças produzidas</div><div class="v">${totalProd}</div><div class="s">${db.producao.length} registros</div></div>`+(fin?`
    <div class="stat"><div class="k">Receita</div><div class="v" style="font-size:22px">${brl(receita)}</div><div class="s">mês: ${brl(recMes)}${trendHtml}${projMes>recMes?' · proj. '+brl(projMes):''}</div></div>
    <div class="stat"><div class="k">Custos fixos / mês</div><div class="v" style="font-size:22px">${brl(fixosTot)}</div><div class="s">${(db.fixos||[]).length?(db.fixos.length+' lançamentos'):'cadastre no Orçamento'}</div></div>
    <div class="stat"><div class="k">Ponto de equilíbrio</div><div class="v">${pe||'—'}</div><div class="s">${pe?'peças/mês para empatar':'precisa de custos fixos e produtos'}</div></div>
    <div class="stat" style="cursor:pointer" onclick="setMeta()" title="Toque para definir a meta"><div class="k">Meta do mês</div><div class="v">${meta?pctMeta+'%':'—'}</div><div class="s">${meta?brl(recMes)+' de '+brl(meta):'toque para definir'}</div>${meta?`<div class="bar" style="margin-top:8px"><span class="${pctMeta>=100?'':'warn'}" style="width:${pctMeta}%"></span></div>`:''}</div>
    <div class="stat ${pctMei>=80?'alert':''}" style="cursor:pointer" onclick="setMeiTeto()" title="Toque para ajustar o teto"><div class="k">Teto MEI (${ano})</div><div class="v">${pctMei}%</div><div class="s">${brl(recAno)} de ${brl(teto)}</div><div class="bar" style="margin-top:8px"><span class="${pctMei>=80?'low':pctMei>=50?'warn':''}" style="width:${pctMei}%"></span></div></div>
    <div class="stat"><div class="k">A receber</div><div class="v" style="font-size:22px">${brl(db.pedidos.filter(p=>p.situacao==='Pendente').reduce((s,p)=>s+Math.max(0,Number(p.valor||0)-(p.pagamentos||[]).reduce((a,x)=>a+Number(x.v||0),0)),0))}</div><div class="s">${db.pedidos.filter(p=>p.situacao==='Pendente').length} pedido(s) pendente(s), já descontando sinais</div></div>`:'');
  renderPrazos();
  let a=[];lowIns.forEach(i=>a.push(`Repor <b>${esc(i.nome)}</b> — restam ${i.estoque} ${esc(i.unidade)}`));lowMold.forEach(m=>a.push(`Molde <b>${esc(m.nome)}</b> — ${m.usos}/${m.vida}`));
  const tamKB=Math.round(JSON.stringify(db).length/1024);
  if(tamKB>700)a.push(`⚠ Os dados estão com <b>${tamKB} KB</b> (limite ~1000). Use o botão <b>Arquivar ano</b> para mover registros antigos.`);
  // reposição preditiva: cruza consumo diário com o prazo do fornecedor
  db.insumos.forEach(i=>{
    const p=previsao(i);
    if(!p||(!p.urgente&&!p.atencao))return;
    const quem=p.fornecedor?` (${esc(p.fornecedor)}, ~${p.prazo}d)`:` (prazo ~${p.prazo}d)`;
    a.push(p.urgente
      ?`🛒 <b>${esc(i.nome)}</b>: peça <b>hoje</b> — acaba em ${p.dias} dia(s) e a entrega leva ${p.prazo}${quem.replace(`, ~${p.prazo}d`,'')}`
      :`🛒 <b>${esc(i.nome)}</b>: peça até <b>${p.pedirAte.split('-').reverse().join('/')}</b> — acaba em ${p.acabaEm.split('-').reverse().join('/')}${quem}`);
  });
  // preço defasado: custo subiu e o preço praticado ficou para trás
  if(pode('fin'))db.produtos.forEach(p=>{
    const d=precoDefasado(p);
    if(!d)return;
    a.push(`${ico("alerta")} <b>${esc(p.nome)}</b>: margem caiu de ${d.margemRef}% para <b>${d.margemAtual}%</b> — preço sugerido ${brl(d.sugerido)} (hoje ${brl(d.precoAtual)})`);
  });
  // alerta de inflação: última compra bem acima do custo médio anterior
  db.insumos.forEach(i=>{
    const comprasIns=(db.compras||[]).filter(c=>c.insumo===i.id&&Number(c.qtd)>0&&Number(c.valor)>0).sort((x,y)=>(x.data||'')<(y.data||'')?-1:1);
    const ult=comprasIns[comprasIns.length-1];if(!ult||!Number(ult.custoAntes))return;
    const unit=Number(ult.valor)/Number(ult.qtd);const varPct=Math.round((unit/Number(ult.custoAntes)-1)*100);
    if(varPct>=10)a.push(`📈 <b>${esc(i.nome)}</b> subiu <b>${varPct}%</b> na última compra (${brl(unit)}/${esc(i.unidade)}) — vale cotar de novo.`);
  });
  document.getElementById('dashAlerts').innerHTML=a.length?('<b>Atenção:</b><br>'+a.join('<br>')):'Tudo em ordem.';
  renderCharts();
}
function mkChart(id,cfg){if(charts[id])charts[id].destroy();const el=document.getElementById(id);if(el)charts[id]=new Chart(el,cfg);}
function renderCharts(){
  if(typeof Chart==='undefined')return;
  // cores lidas das variáveis CSS para respeitar tema e cor de destaque
  const css=getComputedStyle(document.documentElement);
  const cv=(n,fb)=>((css.getPropertyValue(n)||'').trim()||fb);
  const C={char:cv('--char','#1C1A17'),ember:cv('--ember','#B5462A'),smoke:cv('--smoke','#6E6862'),line:cv('--line','#D8D2C8'),ok:'#3F7D5B',warn:'#C08A2E'};
  const F={font:{family:'Inter'}};const grid={color:C.line};const tick={color:C.smoke,font:{family:'Inter',size:11}};
  const prods=db.produtos.map(p=>{const c=calcCusto(p).total;const sug=c*Number(p.markup||3);const prat=Number(p.preco||sug);const taxa=prat*Number(p.taxa||0)/100;const marg=prat-taxa-c;const h=Number(p.minutos||0)/60;return{nome:p.nome,c,m:prat?Math.round(marg/prat*100):0,lph:h>0?marg/h:0};});
  mkChart('chCusto',{type:'bar',data:{labels:prods.map(p=>p.nome),datasets:[{data:prods.map(p=>p.c.toFixed(2)),backgroundColor:C.ember,borderRadius:4}]},options:{plugins:{legend:{display:false}},scales:{y:{grid,ticks:tick},x:{grid:{display:false},ticks:tick}}}});
  mkChart('chMargem',{type:'bar',data:{labels:prods.map(p=>p.nome),datasets:[{data:prods.map(p=>p.m),backgroundColor:prods.map(p=>p.m>50?C.ok:p.m>30?C.warn:C.ember),borderRadius:4}]},options:{plugins:{legend:{display:false}},scales:{y:{grid,ticks:tick},x:{grid:{display:false},ticks:tick}}}});
  const cM=corteMes();
  const byDay={};db.producao.filter(p=>!cM||(p.data||'').slice(0,7)>=cM).forEach(p=>{const d=p.data||'?';byDay[d]=(byDay[d]||0)+Number(p.qtd||0);});const days=Object.keys(byDay).sort();
  mkChart('chProd',{type:'line',data:{labels:days,datasets:[{data:days.map(d=>byDay[d]),borderColor:C.char,backgroundColor:'rgba(181,70,42,.1)',fill:true,tension:.3,pointBackgroundColor:C.ember}]},options:{plugins:{legend:{display:false}},scales:{y:{grid,ticks:tick},x:{grid:{display:false},ticks:tick}}}});
  const sit={};db.pedidos.forEach(p=>{const s=p.situacao||'Pendente';sit[s]=(sit[s]||0)+Number(p.valor||0);});
  mkChart('chRec',{type:'doughnut',data:{labels:Object.keys(sit),datasets:[{data:Object.values(sit),backgroundColor:[C.warn,C.ok,C.char,C.ember]}]},options:{plugins:{legend:{position:'bottom',labels:{...F,color:C.smoke,boxWidth:12}}}}});
  // mês a mês: receita (pedidos pagos/entregues) e lucro (só dos pedidos ligados a produto)
  const byMes={};db.pedidos.forEach(p=>{if(p.situacao!=='Pago'&&p.situacao!=='Entregue')return;const m=(p.data||'').slice(0,7);if(!m||(cM&&m<cM))return;byMes[m]=byMes[m]||{rec:0,luc:0};byMes[m].rec+=Number(p.valor||0);const l=lucroPedido(p);if(l!==null)byMes[m].luc+=l;});
  const meses=Object.keys(byMes).sort();
  mkChart('chMes',{type:'bar',data:{labels:meses,datasets:[{label:'Receita',data:meses.map(m=>byMes[m].rec.toFixed(2)),backgroundColor:C.char,borderRadius:4},{label:'Lucro',data:meses.map(m=>byMes[m].luc.toFixed(2)),backgroundColor:C.ok,borderRadius:4}]},options:{plugins:{legend:{position:'bottom',labels:{color:C.smoke,boxWidth:12,font:{family:'Inter',size:11}}}},scales:{y:{grid,ticks:tick},x:{grid:{display:false},ticks:tick}}}});
  mkChart('chLph',{type:'bar',data:{labels:prods.map(p=>p.nome),datasets:[{data:prods.map(p=>p.lph.toFixed(2)),backgroundColor:prods.map(p=>p.lph>40?C.ok:p.lph>20?C.warn:C.ember),borderRadius:4}]},options:{plugins:{legend:{display:false}},scales:{y:{grid,ticks:tick},x:{grid:{display:false},ticks:tick}}}});
  // receita por dia da semana (período selecionado)
  const dias=['dom','seg','ter','qua','qui','sex','sáb'];const porDia=[0,0,0,0,0,0,0];
  pedidosPeriodo().forEach(p=>{if(!p.data)return;const d=new Date(p.data+'T12:00:00');porDia[d.getDay()]+=Number(p.valor||0);});
  mkChart('chSemana',{type:'bar',data:{labels:dias,datasets:[{data:porDia.map(v=>v.toFixed(2)),backgroundColor:porDia.map((v,i)=>v===Math.max(...porDia)&&v>0?C.ember:C.line),borderRadius:4}]},options:{plugins:{legend:{display:false}},scales:{y:{grid,ticks:tick},x:{grid:{display:false},ticks:tick}}}});
  // curva ABC de produtos e top clientes
  const recProd={};pedidosPeriodo().forEach(p=>{if(!p.produto)return;recProd[p.produto]=(recProd[p.produto]||0)+Number(p.valor||0);});
  const abc=Object.entries(recProd).map(([pid,v])=>({nome:(db.produtos.find(x=>x.id===pid)||{}).nome||'—',v})).sort((a,b)=>b.v-a.v);
  const totAbc=abc.reduce((s,x)=>s+x.v,0);let acum=0;
  const abcBox=document.getElementById('abcBox');
  if(abcBox)abcBox.innerHTML=abc.length?abc.slice(0,8).map(x=>{acum+=x.v;const pct=totAbc?acum/totAbc*100:0;const cl=pct<=80?'A':pct<=95?'B':'C';return `<div class="prazo-item"><span><span class="pill ${cl==='A'?'ok':cl==='B'?'warn':'low'}">${cl}</span> ${esc(x.nome)}</span><b>${brl(x.v)} · ${totAbc?Math.round(x.v/totAbc*100):0}%</b></div>`;}).join(''):'<div class="empty-t" style="padding:16px">Sem vendas no período.</div>';
  // sazonalidade: usa TODO o histórico (não o período) e sugere produzir antes do pico
  const saz=Core.sazonalidade(db.pedidos,hoje());
  const nota=document.getElementById('sazNota');
  if(saz.pronto){
    const MES=['','jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
    const labels=MES.slice(1);
    const vals=[];for(let i=1;i<=12;i++)vals.push(saz.indices[i]===null?0:saz.indices[i]);
    mkChart('chSaz',{type:'bar',data:{labels,datasets:[{data:vals,backgroundColor:vals.map(v=>v>=1.2?C.ember:v>=1?C.warn:C.line),borderRadius:4}]},options:{plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>(c.raw?c.raw.toFixed(2)+'× a média':'sem dados')}}},scales:{y:{grid,ticks:{...tick,callback:v=>v+'×'}},x:{grid:{display:false},ticks:tick}}}});
    const picos=saz.proximos.filter(x=>x.pico);
    if(nota)nota.innerHTML=picos.length
      ?`📈 <b>${esc(picos.map(x=>x.nome).join(' e '))}</b> costuma${picos.length>1?'m':''} vender ${picos.map(x=>x.indice.toFixed(1)+'×').join(' e ')} a média — comece a produzir com antecedência.`
      :`Mês mais forte do ano: <b>${esc(saz.melhorNome)}</b> (${saz.indices[saz.melhorMes].toFixed(1)}× a média).`;
  }else{
    if(charts.chSaz){charts.chSaz.destroy();delete charts.chSaz;}
    const cv2=document.getElementById('chSaz');if(cv2)cv2.getContext('2d').clearRect(0,0,cv2.width,cv2.height);
    if(nota)nota.innerHTML=`Ainda não dá para prever a sazonalidade: você tem <b>${saz.meses} mês(es)</b> com vendas registradas${saz.faltam?` — faltam ${saz.faltam} para o primeiro retrato do ano`:''}.`;
  }
  const recCli={};pedidosPeriodo().forEach(p=>{const cli=(db.clientes||[]).find(c=>c.id===p.clienteId);const k=cli?cli.nome:(p.cliente||'');if(!k)return;recCli[k]=(recCli[k]||0)+Number(p.valor||0);});
  const topCli=Object.entries(recCli).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const cliBox=document.getElementById('topCliBox');
  if(cliBox)cliBox.innerHTML=topCli.length?topCli.map(([n,v],i)=>`<div class="prazo-item"><span>${i+1}º <b>${esc(n)}</b></span><b>${brl(v)}</b></div>`).join(''):'<div class="empty-t" style="padding:16px">Sem clientes no período.</div>';
}
function renderEquip(){document.getElementById('tbEquip').innerHTML=db.equip.length?db.equip.map(e=>`<tr><td>${esc(e.nome)}</td><td>${esc(e.tipo)||'—'}</td><td>${esc(e.compra)||'—'}</td><td class="money">${brl(e.custo)}</td><td><span class="pill ok">${esc(e.situacao||'Ativo')}</span></td><td>${rowActions('equip',e.id)}</td></tr>`).join(''):`<tr><td colspan=6><div class="empty-t">Nenhum equipamento.</div></td></tr>`;}
function renderMoldes(){document.getElementById('tbMoldes').innerHTML=db.moldes.length?db.moldes.map(m=>{const st=moldeStatus(m);const pct=Math.min(100,Math.round(m.usos/(m.vida||1)*100));const l=st==='low'?'Trocar':st==='warn'?'Quase no fim':'Bom';return `<tr><td>${esc(m.nome)}</td><td>${esc(m.material)}</td><td>${m.usos} / ${m.vida}</td><td><div class="bar"><span class="${st}" style="width:${pct}%"></span></div></td><td><span class="pill ${st}">${l}</span></td><td>${rowActions('molde',m.id)}</td></tr>`;}).join(''):`<tr><td colspan=6><div class="empty-t">Nenhum molde.</div></td></tr>`;}
function renderInsumos(){document.getElementById('tbInsumos').innerHTML=db.insumos.length?db.insumos.map(i=>{const st=insumoStatus(i);const l=st==='low'?'Repor':st==='warn'?'Baixo':'OK';const pct=Math.min(100,Math.round(i.estoque/((i.minimo||1)*2)*100));const dias=diasEstoque(i);return `<tr><td>${esc(i.nome)}</td><td>${i.estoque} ${esc(i.unidade)}</td><td><div class="bar"><span class="${st}" style="width:${pct}%"></span></div><div style="font-size:11px;color:var(--warm);margin-top:3px">mín. ${i.minimo}${dias!==null&&dias<365?` · acaba em ~<b style="color:${dias<15?'var(--ember)':'inherit'}">${dias}d</b>`:''}</div></td><td class="money">${brl(i.custo)}/${esc(i.unidade)}</td><td><span class="pill ${st}">${l}</span>${(()=>{const pv=previsao(i);return pv&&(pv.urgente||pv.atencao)?`<div style="font-size:11px;color:var(--ember);margin-top:3px">🛒 pedir ${pv.urgente?'hoje':'até '+pv.pedirAte.slice(8,10)+'/'+pv.pedirAte.slice(5,7)}</div>`:'';})()}</td><td><div class="row-actions"><button class="icon-btn" title="Histórico de preços" onclick="verPrecos('${i.id}')">📈</button><button class="icon-btn" onclick="openForm('insumo','${i.id}')">${ico("lapis","Editar")}</button><button class="icon-btn" onclick="del('insumo','${i.id}')">${ico("lixeira","Apagar")}</button></div></td></tr>`;}).join(''):`<tr><td colspan=6><div class="empty-t">Nenhum insumo.</div></td></tr>`;}
function renderProdutos(){document.getElementById('tbProdutos').innerHTML=db.produtos.length?db.produtos.map(p=>{const c=calcCusto(p);const sug=c.total*Number(p.markup||3);const prat=Number(p.preco||sug);const taxa=prat*Number(p.taxa||0)/100;const margem=prat-taxa-c.total;const mpct=prat?Math.round(margem/prat*100):0;const h=Number(p.minutos||0)/60;const lph=h>0?margem/h:0;const def=precoDefasado(p);return `<tr><td>${esc(p.nome)}${p.publico?' <span class="selo-loja" title="no catálogo">${ico("loja","no catálogo")}</span>':''}${def?`<div style="font-size:11px;color:var(--ember)">${ico("alerta")} defasado · sugerido ${brl(def.sugerido)}</div>`:''}</td><td class="money">${brl(c.total)}</td><td class="money" style="color:var(--smoke)">${brl(sug)}</td><td class="money">${brl(prat)}</td><td><span class="pill ${mpct>50?'ok':mpct>30?'warn':'low'}">${mpct}%</span></td><td class="money">${h>0?brl(lph):'—'}</td><td>${Number(p.pronto||0)}</td><td><div class="row-actions"><button class="icon-btn" title="Duplicar" onclick="duplicarProduto('${p.id}')">${ico("copiar","Duplicar")}</button><button class="icon-btn" onclick="openForm('produto','${p.id}')">${ico("lapis","Editar")}</button><button class="icon-btn" onclick="del('produto','${p.id}')">${ico("lixeira","Apagar")}</button></div></td></tr>`;}).join(''):`<tr><td colspan=8><div class="empty-t">Nenhum produto.</div></td></tr>`;}
function renderProducao(){
  fillMeses('mesPro',db.producao,fP.m);
  const todas=[...db.producao].reverse().filter(p=>{const prod=db.produtos.find(x=>x.id===p.produto);const txt=((prod?prod.nome:'')+' '+(p.variacao||'')+' '+(p.lote||'')).toLowerCase();return(!fP.q||txt.includes(fP.q.toLowerCase()))&&(!fP.m||(p.data||'').slice(0,7)===fP.m);});
  const rows=todas.slice(0,PAG.producao);
  document.getElementById('tbProducao').innerHTML=(rows.length?rows.map(p=>{const prod=db.produtos.find(x=>x.id===p.produto);const mold=db.moldes.find(x=>x.id===p.molde);const nome=prod?esc(prod.nome)+(p.variacao?' · '+esc(p.variacao):''):'—';return `<tr><td>${esc(p.data)||'—'}</td><td>${nome}</td><td>${esc(p.qtd)}</td><td>${p.minutos?esc(p.minutos)+' min':'—'}</td><td>${mold?esc(mold.nome):'—'}</td><td style="color:var(--warm);font-size:12px">${esc(p.lote)||'—'}</td><td>${rowActions('producao',p.id,1)}</td></tr>`;}).join(''):`<tr><td colspan=7><div class="empty-t">${db.producao.length?'Nada encontrado com esse filtro.':'Nenhuma produção.'}</div></td></tr>`)+linhaMais('producao',todas.length,rows.length,7);
  labelize();
}
function renderPedidos(){
  const sc={'Pendente':'warn','Pago':'ok','Entregue':'ok','Cancelado':'low'};const hj=hoje();
  fillMeses('mesPed',db.pedidos,fV.m);
  const todos=[...db.pedidos].reverse().filter(p=>{const prod=db.produtos.find(x=>x.id===p.produto);const cli=(db.clientes||[]).find(c=>c.id===p.clienteId);const txt=((cli?cli.nome:p.cliente||'')+' '+(prod?prod.nome:'')+' '+(p.item||'')+' '+(p.variacao||'')).toLowerCase();return(!fV.q||txt.includes(fV.q.toLowerCase()))&&(!fV.m||(p.data||'').slice(0,7)===fV.m);});
  const rows=todos.slice(0,PAG.pedidos);
  document.getElementById('tbPedidos').innerHTML=(rows.length?rows.map(p=>{
    const prod=db.produtos.find(x=>x.id===p.produto);const cli=(db.clientes||[]).find(c=>c.id===p.clienteId);
    const q=Number(p.qtd||1);const can=(db.canais||[]).find(c=>c.id===p.canal);
    const nome=(prod?esc(prod.nome)+(q>1?' ×'+q:'')+(p.variacao?' · '+esc(p.variacao):''):esc(p.item)||'—')+(can?`<div style="font-size:11px;color:var(--warm)">via ${esc(can.nome)}</div>`:'');
    const l=lucroPedido(p);
    const lucro=l===null||p.situacao==='Cancelado'?'—':`<span class="money" style="color:${l>=0?'var(--ok)':'var(--ember)'}">${brl(l)}</span>`;
    const aberto=p.situacao!=='Entregue'&&p.situacao!=='Cancelado';
    const prazo=p.prazo?(aberto&&p.prazo<hj?`<span class="pill low">${esc(p.prazo)}</span>`:esc(p.prazo)):'—';
    const acts=`<div class="row-actions"><button class="icon-btn" title="${p.portalToken?'Reenviar link de acompanhamento':'Compartilhar acompanhamento com o cliente'}" onclick="compartilharPedido('${p.id}')">${p.portalToken?'🔗':'🔗'}</button><button class="icon-btn" title="Recibo" onclick="reciboPedido('${p.id}')">🧾</button>${aberto&&cli?`<button class="icon-btn" title="Cobrar no WhatsApp" onclick="cobrarPedido('${p.id}')">💬</button>`:''}<button class="icon-btn" title="Repetir" onclick="repetir('pedido','${p.id}')">⟳</button><button class="icon-btn" onclick="openForm('pedido','${p.id}')">${ico("lapis","Editar")}</button><button class="icon-btn" onclick="del('pedido','${p.id}')">${ico("lixeira","Apagar")}</button></div>`;
    return `<tr><td>${esc(p.data)||'—'}</td><td>${cli?esc(cli.nome):esc(p.cliente)||'—'}</td><td>${nome}</td><td>${prazo}</td><td class="money">${brl(p.valor)}</td><td>${lucro}</td><td><span class="pill ${sc[p.situacao]||'warn'}">${esc(p.situacao||'Pendente')}</span></td><td>${acts}</td></tr>`;
  }).join(''):`<tr><td colspan=8><div class="empty-t">${db.pedidos.length?'Nada encontrado com esse filtro.':'Nenhum pedido.'}</div></td></tr>`)+linhaMais('pedidos',todos.length,rows.length,8);
  // totais do filtro atual (soma TODOS os filtrados, não só a página visível)
  if(todos.length){
    const somaV=todos.reduce((s,p)=>s+Number(p.valor||0),0);
    const somaL=todos.reduce((s,p)=>{const l=lucroPedido(p);return l===null||p.situacao==='Cancelado'?s:s+l;},0);
    document.getElementById('tbPedidos').innerHTML+=`<tr><td style="font-weight:600">Totais</td><td></td><td style="color:var(--warm);font-size:12px">${todos.length} pedido(s)</td><td></td><td class="money" style="font-weight:600">${brl(somaV)}</td><td class="money" style="font-weight:600;color:var(--ok)">${brl(somaL)}</td><td></td><td></td></tr>`;
  }
  labelize();
}
function renderClientes(){const rows=db.clientes||[];document.getElementById('tbClientes').innerHTML=rows.length?rows.map(c=>{const peds=db.pedidos.filter(p=>p.clienteId===c.id&&p.situacao!=='Cancelado');const tot=peds.reduce((s,p)=>s+Number(p.valor||0),0);const dg=String(c.whats||'').replace(/\D/g,'');const wa=dg.length>=10?`<a href="https://wa.me/${dg.length>=12?dg:'55'+dg}" target="_blank" rel="noopener" style="color:var(--ember)">${esc(c.whats)}</a>`:(esc(c.whats)||'—');return `<tr><td>${esc(c.nome)}${c.obs?`<div style="font-size:11px;color:var(--warm)">${esc(c.obs)}</div>`:''}</td><td>${wa}</td><td>${peds.length}</td><td class="money">${brl(tot)}</td><td>${rowActions('cliente',c.id)}</td></tr>`;}).join(''):`<tr><td colspan=5><div class="empty-t">Nenhum cliente cadastrado.</div></td></tr>`;}
function renderCanais(){const rows=db.canais||[];document.getElementById('tbCanais').innerHTML=rows.length?rows.map(c=>`<tr><td>${esc(c.nome)}</td><td>${Number(c.taxa||0)}%</td><td>${rowActions('canal',c.id)}</td></tr>`).join(''):`<tr><td colspan=3><div class="empty-t">Nenhum canal — ex.: Feira 0%, Marketplace 12%.</div></td></tr>`;}
function renderEquipe(){
  const box=document.getElementById('membrosBox');if(!box)return;
  const ger=pode('gerir');
  document.getElementById('equipeDesc').textContent=(empresaNome?empresaNome+' — ':'')+'você é '+PAPEL_LABEL[meuPapel()]+(ger?' · toque no papel de alguém para trocá-lo':'');
  box.innerHTML=Object.entries(membros).map(([id,m])=>{
    const papel=id===empresaDono?'dono':(m.papel||'empregado');
    const badge=`<span class="papel ${papel}" ${ger&&id!==empresaDono?`style="cursor:pointer" title="Trocar papel" onclick="mudarPapel('${id}')"`:''}>${PAPEL_LABEL[papel]}</span>`;
    return `<div class="membro-chip">${esc(m.nome||'membro')} ${badge}${id===uid?' <button class="icon-btn" title="Editar meu nome" onclick="renomearMe()">${ico("lapis","Editar")}</button>':(ger&&id!==empresaDono?` <button class="icon-btn" title="Remover" onclick="removerMembro('${id}')">✕</button>`:'')}</div>`;
  }).join('')||'<span style="color:var(--smoke);font-size:13px">Carregando membros…</span>';
  const cols=['aberta','fazendo','feita'];const hj=hoje();
  cols.forEach((st,i)=>{
    const cards=(db.tarefas||[]).filter(t=>((t.status||'aberta')===st)&&(!filtroMinhas||t.resp===uid));
    document.getElementById('kbN'+i).textContent=cards.length?'· '+cards.length:'';
    document.getElementById('kb'+i).innerHTML=cards.map(t=>{
      const resp=membros[t.resp]?esc(membros[t.resp].nome):'';
      const atrasada=t.prazo&&st!=='feita'&&t.prazo<hj;
      return `<div class="kb-card ${st==='feita'?'done':''}" draggable="true" ondragstart="dragTarefa(event,'${t.id}')"><div class="t">${esc(t.titulo)}</div>${t.desc?`<div class="m">${esc(t.desc)}</div>`:''}<div class="m ${atrasada?'late':''}">${resp?'👤 '+resp:''}${t.prazo?(resp?' · ':'')+(atrasada?'⚠ ':'')+esc(t.prazo):''}${(t.coments||[]).length?` · 💬 ${t.coments.length}`:''}</div><div class="acts">${i>0?`<button class="icon-btn" title="Voltar" onclick="moveTarefa('${t.id}',-1)">◀</button>`:''}${i<2?`<button class="icon-btn" title="Avançar" onclick="moveTarefa('${t.id}',1)">▶</button>`:''}<button class="icon-btn" onclick="openForm('tarefa','${t.id}')">${ico("lapis","Editar")}</button><button class="icon-btn" onclick="del('tarefa','${t.id}')">${ico("lixeira","Apagar")}</button></div></div>`;
    }).join('')||'<div style="color:var(--warm);font-size:12px;font-style:italic">vazio</div>';
  });
}
function criarTarefaProducao(pid,falta){
  const prod=db.produtos.find(x=>x.id===pid);if(!prod)return;
  const titulo='Produzir '+falta+' × '+prod.nome;
  if((db.tarefas||[]).some(t=>t.titulo===titulo&&(t.status||'aberta')!=='feita')){toast('Já existe uma tarefa aberta para isso');return;}
  db.tarefas=db.tarefas||[];db.tarefas.push({id:uidGen(),titulo,status:'aberta',por:uid});
  logAtv('criou a tarefa "'+titulo+'" a partir do plano de produção');
  cloudSave();renderAll();toast('Tarefa criada no kanban: <b>'+esc(titulo)+'</b>');
}
function moveTarefa(id,dir){const t=(db.tarefas||[]).find(x=>x.id===id);if(!t)return;const ordem=['aberta','fazendo','feita'];const i=Math.max(0,Math.min(2,ordem.indexOf(t.status||'aberta')+dir));t.status=ordem[i];logAtv('moveu a tarefa "'+t.titulo+'" para '+ordem[i]);cloudSave();renderEquipe();}
function dragTarefa(ev,id){ev.dataTransfer.setData('text/plain',id);}
function dropTarefa(ev,i){ev.preventDefault();const id=ev.dataTransfer.getData('text/plain');const t=(db.tarefas||[]).find(x=>x.id===id);if(!t)return;const st=['aberta','fazendo','feita'][i];if(t.status===st)return;t.status=st;logAtv('moveu a tarefa "'+t.titulo+'" para '+st);cloudSave();renderEquipe();}
// ---------- atividade (quem fez o quê) ----------
function logAtv(txt){db.atividade=db.atividade||[];db.atividade.unshift({t:Date.now(),u:uid,x:String(txt).slice(0,140)});db.atividade=db.atividade.slice(0,60);}
function tempoRel(t){const s=(Date.now()-t)/1000;if(s<60)return'agora';if(s<3600)return Math.floor(s/60)+' min';if(s<86400)return Math.floor(s/3600)+' h';return Math.floor(s/86400)+' d';}
// ---------- recibo e cobrança ----------
function reciboPedido(id){
  const p=db.pedidos.find(x=>x.id===id);if(!p)return;
  const prod=db.produtos.find(x=>x.id===p.produto);
  const cli=(db.clientes||[]).find(c=>c.id===p.clienteId);
  const pago=(p.pagamentos||[]).reduce((s,x)=>s+Number(x.v||0),0);
  const falta=Math.max(0,Number(p.valor||0)-pago);
  const item=(prod?prod.nome:(p.item||'Pedido'))+(Number(p.qtd||1)>1?' ×'+p.qtd:'')+(p.variacao?' · '+p.variacao:'');
  const win=window.open('','_blank');
  win.document.write(`<html><head><title>Recibo — ${esc(empresaNome||'Cinérea')}</title><style>body{font-family:Georgia,serif;color:#1C1A17;background:#F2EFEA;padding:40px;max-width:480px;margin:auto}h1{font-size:26px;font-weight:400}.l{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #D8D2C8;font-size:15px}.t{font-size:20px;font-weight:bold;border-bottom:none;margin-top:8px}.ok{color:#3F7D5B}.pend{color:#B5462A}.foot{margin-top:36px;color:#8A7E70;font-size:12px;text-align:center;font-style:italic}</style></head><body>
  <h1>${esc(empresaNome||'Cinérea')}</h1><p style="color:#6E6862;margin-bottom:24px">Recibo · ${esc(p.data||hoje())}</p>
  <div class="l"><span>Cliente</span><b>${esc(cli?cli.nome:(p.cliente||'—'))}</b></div>
  <div class="l"><span>Item</span><b>${esc(item)}</b></div>
  ${p.prazo?`<div class="l"><span>Entrega</span><b>${esc(p.prazo)}</b></div>`:''}
  <div class="l t"><span>Valor</span><span>${brl(p.valor)}</span></div>
  ${pago?`<div class="l"><span>Recebido</span><b class="ok">${brl(pago)}</b></div><div class="l"><span>Saldo</span><b class="${falta?'pend':'ok'}">${falta?brl(falta):'quitado ✓'}</b></div>`:''}
  <div class="foot">feito à mão com carinho 🕯️</div>
  </body></html>`);
  win.document.close();setTimeout(()=>win.print(),400);
}
// ---------- portal do cliente ----------
const ETAPA_PEDIDO={'Pendente':0,'Pago':1,'Em produção':2,'Entregue':3};
function dadosPortal(p){
  const prod=db.produtos.find(x=>x.id===p.produto);
  const {pago}=saldoPedido(p);
  const item=(prod?prod.nome:(p.item||'Encomenda'))+(p.variacao?' · '+p.variacao:'');
  return{empresa:empresaNome||'Cinérea',item,qtd:num(p.qtd)||1,valor:num(p.valor),pago,
    prazo:p.prazo||'',etapa:ETAPA_PEDIDO[p.situacao]!==undefined?ETAPA_PEDIDO[p.situacao]:0,
    cancelado:p.situacao==='Cancelado',whats:String(db.catWhats||'').replace(/\D/g,''),atualizado:Date.now()};
}
// publica/atualiza o doc público do pedido (só os campos que o cliente pode ver)
async function syncPortal(p,silencioso){
  if(!p||!p.portalToken||!eid)return;
  try{await setDoc(doc(fdb,'portal',p.portalToken),{...dadosPortal(p),empresaId:eid});}
  catch(e){if(!silencioso)console.error(e);}
}
async function compartilharPedido(id){
  const p=db.pedidos.find(x=>x.id===id);if(!p)return;
  try{
    if(!p.portalToken){p.portalToken=uidGen()+uidGen().slice(0,4);cloudSave();}
    await setDoc(doc(fdb,'portal',p.portalToken),{...dadosPortal(p),empresaId:eid});
    const url=location.origin+location.pathname.replace(/index\.html$/,'')+'pedido.html?p='+p.portalToken;
    const cli=(db.clientes||[]).find(c=>c.id===p.clienteId);
    const dg=String((cli&&cli.whats)||'').replace(/\D/g,'');
    if(dg.length>=10){
      const prod=db.produtos.find(x=>x.id===p.produto);
      const msg=`Oi${cli.nome?', '+cli.nome.split(' ')[0]:''}! Acompanhe sua encomenda (${prod?prod.nome:(p.item||'pedido')}) por aqui: ${url}`;
      window.open('https://wa.me/'+(dg.length>=12?dg:'55'+dg)+'?text='+encodeURIComponent(msg),'_blank');
      toast('Link do portal aberto no WhatsApp');
    }else{
      if(navigator.clipboard)navigator.clipboard.writeText(url).catch(()=>{});
      toast('Link copiado — envie ao cliente');
    }
    renderPedidos();
  }catch(e){console.error(e);toast('Erro ao publicar — confira as regras do Firestore');}
}
function cobrarPedido(id){
  const p=db.pedidos.find(x=>x.id===id);if(!p)return;
  const cli=(db.clientes||[]).find(c=>c.id===p.clienteId);
  const dg=String((cli&&cli.whats)||'').replace(/\D/g,'');
  if(dg.length<10){toast('Cadastre o WhatsApp do cliente para cobrar por aqui');return;}
  const prod=db.produtos.find(x=>x.id===p.produto);
  const pago=(p.pagamentos||[]).reduce((s,x)=>s+Number(x.v||0),0);
  const falta=Math.max(0,Number(p.valor||0)-pago);
  const item=prod?prod.nome:(p.item||'sua encomenda');
  const msg=`Oi, ${cli.nome.split(' ')[0]}! Sobre ${item}${Number(p.qtd||1)>1?' (×'+p.qtd+')':''}: valor ${brl(p.valor)}${pago?`, já recebi ${brl(pago)} — falta ${brl(falta)}`:''}${p.prazo?`. Entrega prevista: ${p.prazo}`:''}. Qualquer coisa me chama! 🕯️`;
  window.open('https://wa.me/'+(dg.length>=12?dg:'55'+dg)+'?text='+encodeURIComponent(msg),'_blank');
}
function duplicarProduto(id){
  const p=db.produtos.find(x=>x.id===id);if(!p)return;
  const novo=JSON.parse(JSON.stringify(p));novo.id=uidGen();novo.nome=p.nome+' (cópia)';novo.pronto=0;novo.publico=false;novo.por=uid;
  db.produtos.push(novo);logAtv('duplicou o produto "'+p.nome+'"');cloudSave();renderAll();
  openForm('produto',novo.id);toast('Produto duplicado — ajuste o nome e a receita');
}
// ---------- consulta ao arquivo ----------
async function verArquivo(){
  const ano=prompt('Ver arquivo de qual ano?',String(Number(hoje().slice(0,4))-1));
  if(!ano||!/^\d{4}$/.test(ano.trim()))return;
  try{
    const snap=await getDoc(doc(fdb,'empresas',eid,'arquivo',ano.trim()));
    if(!snap.exists()){toast('Não há arquivo de '+ano.trim());return;}
    const d=snap.data();
    currentForm={type:'cotacaoView',id:null,recipe:[]};window.currentForm=currentForm;
    document.getElementById('modalTitle').textContent='Arquivo de '+ano.trim();
    const recArq=(d.pedidos||[]).reduce((s,p)=>s+Number(p.valor||0),0);
    document.getElementById('modalBody').innerHTML=`
      <div class="prazo-item"><span>Produções arquivadas</span><b>${(d.producao||[]).length}</b></div>
      <div class="prazo-item"><span>Pedidos arquivados</span><b>${(d.pedidos||[]).length}</b></div>
      <div class="prazo-item"><span>Compras arquivadas</span><b>${(d.compras||[]).length}</b></div>
      <div class="prazo-item"><span>Receita registrada no ano</span><b>${brl(recArq)}</b></div>
      <button class="btn2" style="width:100%;margin-top:14px" id="btnBaixarArq">↓ Baixar arquivo completo (JSON)</button>`;
    document.getElementById('overlay').classList.add('open');
    document.getElementById('btnBaixarArq').onclick=()=>dl('cinerea-arquivo-'+ano.trim()+'.json',JSON.stringify(d,null,2),'application/json');
  }catch(e){console.error(e);toast('Erro ao ler o arquivo');}
}
// ---------- produtividade por membro ----------
function renderProdMembro(){
  const box=document.getElementById('prodMembroBox');if(!box)return;
  const mes=hoje().slice(0,7);
  const por={};
  db.producao.filter(p=>(p.data||'').slice(0,7)===mes).forEach(p=>{const u=p.por||'';por[u]=por[u]||{q:0,min:0};por[u].q+=Number(p.qtd||0);por[u].min+=Number(p.minutos||0)*Number(p.qtd||0);});
  const rows=Object.entries(por).sort((a,b)=>b[1].q-a[1].q);
  if(!rows.length){box.innerHTML='<div class="empty-t" style="padding:20px">Nenhuma produção registrada neste mês.</div>';return;}
  const max=Math.max(...rows.map(([,v])=>v.q));
  box.innerHTML=rows.map(([u,v])=>`<div class="prazo-item"><span style="flex:1"><b>${esc((membros[u]||{}).nome||'—')}</b><div class="bar" style="margin-top:6px;max-width:260px"><span style="width:${Math.round(v.q/max*100)}%"></span></div></span><b>${v.q} peça${v.q>1?'s':''} · ${(v.min/60).toFixed(1)}h</b></div>`).join('');
}
// ---------- busca global ----------
function abrirBusca(){
  if(!uid)return;
  currentForm={type:'cotacaoView',id:null,recipe:[]};window.currentForm=currentForm;
  document.getElementById('modalTitle').textContent='Buscar em tudo';
  document.getElementById('modalBody').innerHTML='<input id="buscaTxt" placeholder="cliente, produto, pedido, insumo, tarefa…" style="width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:8px;background:var(--paper)" oninput="renderBusca()" autocomplete="off"><div id="buscaRes" style="margin-top:12px"></div>';
  document.getElementById('overlay').classList.add('open');
  setTimeout(()=>{const i=document.getElementById('buscaTxt');if(i)i.focus();},50);
}
function renderBusca(){
  const q=(document.getElementById('buscaTxt')||{}).value.trim().toLowerCase();
  const res=document.getElementById('buscaRes');if(!res)return;
  if(q.length<2){res.innerHTML='<div class="hint">Digite pelo menos 2 letras…</div>';return;}
  const hits=[];const add=(tipo,id,rot,sub)=>hits.push({tipo,id,rot,sub});
  (db.clientes||[]).filter(c=>c.nome.toLowerCase().includes(q)).forEach(c=>add('cliente',c.id,c.nome,'cliente'));
  (db.fornecedores||[]).filter(f=>f.nome.toLowerCase().includes(q)).forEach(f=>add('fornecedor',f.id,f.nome,'fornecedor'));
  db.produtos.filter(p=>p.nome.toLowerCase().includes(q)).forEach(p=>add('produto',p.id,p.nome,'produto'));
  db.insumos.filter(i=>i.nome.toLowerCase().includes(q)).forEach(i=>add('insumo',i.id,i.nome,'insumo · '+i.estoque+' '+i.unidade));
  (db.tarefas||[]).filter(t=>t.titulo.toLowerCase().includes(q)).forEach(t=>add('tarefa',t.id,t.titulo,'tarefa · '+(t.status||'aberta')));
  db.pedidos.filter(p=>{const cli=(db.clientes||[]).find(c=>c.id===p.clienteId);const prod=db.produtos.find(x=>x.id===p.produto);return ((cli?cli.nome:p.cliente||'')+' '+(prod?prod.nome:'')+' '+(p.item||'')).toLowerCase().includes(q);}).slice(0,8).forEach(p=>{const cli=(db.clientes||[]).find(c=>c.id===p.clienteId);add('pedido',p.id,(cli?cli.nome:p.cliente||'—')+' · '+(p.data||''),'pedido · '+(p.situacao||'Pendente'));});
  db.producao.filter(p=>(p.lote||'').toLowerCase().includes(q)).slice(0,5).forEach(p=>add('producao',p.id,p.lote,'produção · '+(p.data||'')));
  res.innerHTML=hits.length?hits.slice(0,15).map(h=>`<div class="prazo-item" style="cursor:pointer" onclick="closeModal();openForm('${h.tipo}','${h.id}')"><span>${esc(h.rot)}</span><b style="color:var(--warm);font-weight:400">${esc(h.sub)}</b></div>`).join(''):'<div class="hint">Nada encontrado.</div>';
}
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){closeModal();return;}
  const tag=(e.target&&e.target.tagName)||'';
  if(e.key==='/'&&tag!=='INPUT'&&tag!=='TEXTAREA'&&tag!=='SELECT'){e.preventDefault();abrirBusca();}
});
function renderAtividade(){const box=document.getElementById('atvBox');if(!box)return;const rows=(db.atividade||[]).slice(0,20);box.innerHTML=rows.length?rows.map(a=>`<div class="prazo-item"><span><b>${esc((membros[a.u]||{}).nome||'alguém')}</b> ${esc(a.x)}</span><b style="color:var(--warm);font-weight:400">${tempoRel(a.t)}</b></div>`).join(''):'<div class="empty-t" style="padding:20px">Nenhuma atividade ainda.</div>';}
function addPagamento(id){
  const p=db.pedidos.find(x=>x.id===id);const inp=document.getElementById('pagVal');
  if(!p||!inp)return;
  const v=Number(String(inp.value).replace(',','.'));
  if(!isFinite(v)||v<=0){toast('Valor inválido');return;}
  p.pagamentos=p.pagamentos||[];p.pagamentos.push({t:hoje(),v:Math.round(v*100)/100});
  const pago=p.pagamentos.reduce((s,x)=>s+Number(x.v||0),0);
  if(pago>=Number(p.valor||0)&&p.situacao==='Pendente')p.situacao='Pago';
  logAtv('registrou pagamento no pedido');
  syncPortal(p,true); // o cliente vê o saldo novo na hora
  cloudSave();closeModal();openForm('pedido',id);renderAll();
  toast('Pagamento registrado — recebido '+brl(pago)+' de '+brl(p.valor));
}
function addComent(id){const t=(db.tarefas||[]).find(x=>x.id===id);const inp=document.getElementById('comentTxt');if(!t||!inp||!inp.value.trim())return;t.coments=t.coments||[];t.coments.push({u:uid,t:Date.now(),x:inp.value.trim()});inp.value='';logAtv('comentou na tarefa "'+t.titulo+'"');cloudSave();
  const list=document.getElementById('comentList');if(list)list.innerHTML=t.coments.map(c=>`<div class="prazo-item"><span><b>${esc((membros[c.u]||{}).nome||'membro')}:</b> ${esc(c.x)}</span><b style="color:var(--warm);font-weight:400">${tempoRel(c.t)}</b></div>`).join('');}
// ---------- calendário de entregas ----------
function renderCal(){const box=document.getElementById('dashCal');if(!box)return;const hj=hoje();const Y=Number(hj.slice(0,4)),M=Number(hj.slice(5,7));
  const nd=new Date(Y,M,0).getDate();const first=new Date(Y,M-1,1).getDay();
  const ent={};db.pedidos.forEach(p=>{if(!p.prazo||p.situacao==='Entregue'||p.situacao==='Cancelado')return;if(p.prazo.slice(0,7)!==hj.slice(0,7))return;const d=Number(p.prazo.slice(8,10));ent[d]=(ent[d]||0)+1;});
  if(!Object.keys(ent).length){box.innerHTML='';return;}
  const hjD=Number(hj.slice(8,10));
  let cells='';for(let i=0;i<first;i++)cells+='<div></div>';
  for(let d=1;d<=nd;d++){const n=ent[d]||0;cells+=`<div class="cal-d ${n?'has':''} ${n&&d<hjD?'late':''} ${d===hjD?'hoje':''}">${d}${n?`<span>${n} entrega${n>1?'s':''}</span>`:''}</div>`;}
  box.innerHTML=`<div class="chartcard"><h3>Calendário de entregas — ${hj.slice(0,7)}</h3><div class="cal-grid">${['D','S','T','Q','Q','S','S'].map(x=>`<div class="cal-h">${x}</div>`).join('')}${cells}</div></div>`;}
function renderCompras(){
  const low=db.insumos.filter(i=>insumoStatus(i)!=='ok');
  const box=document.getElementById('shopList');
  if(!low.length){box.innerHTML='<div class="empty-t" style="border:1px solid var(--line);border-radius:10px">Nada para comprar — estoque saudável.</div>';return;}
  box.innerHTML=low.map(i=>{const alvo=(i.minimo||0)*2;const comprar=Math.max(0,(alvo-i.estoque));const custo=comprar*Number(i.custo||0);return `<div class="shop-item"><div class="si-l"><div class="n">${esc(i.nome)}</div><div class="s">tem ${i.estoque} ${esc(i.unidade)} · mínimo ${i.minimo}</div></div><div class="si-r"><div class="si-q"><div class="q">+${comprar.toFixed(comprar%1?2:0)} ${esc(i.unidade)}</div><div class="c">≈ ${brl(custo)}</div></div><button class="btn2" onclick="buyDone('${i.id}',${comprar})">✓ Comprei</button></div></div>`;}).join('');
}
function renderComprasHist(){const todas=[...(db.compras||[])].reverse();const rows=todas.slice(0,PAG.compras);document.getElementById('tbCompras').innerHTML=(rows.length?rows.map(c=>{const ins=db.insumos.find(i=>i.id===c.insumo);const q=Number(c.qtd||0),v=Number(c.valor||0);return `<tr><td>${esc(c.data)||'—'}</td><td>${ins?esc(ins.nome):'—'}</td><td>${q} ${ins?esc(ins.unidade):''}</td><td class="money">${brl(v)}</td><td class="money" style="color:var(--smoke)">${q&&v?brl(v/q):'—'}</td><td>${esc(c.fornecedor)||'—'}</td><td>${rowActions('compra',c.id)}</td></tr>`;}).join(''):`<tr><td colspan=7><div class="empty-t">Nenhuma compra registrada.</div></td></tr>`)+linhaMais('compras',todas.length,rows.length,7);}
function renderFixos(){const rows=db.fixos||[];const tot=rows.reduce((s,f)=>s+Number(f.valor||0),0);document.getElementById('tbFixos').innerHTML=rows.length?rows.map(f=>`<tr><td>${esc(f.nome)}</td><td class="money">${brl(f.valor)}</td><td>${rowActions('fixo',f.id)}</td></tr>`).join('')+`<tr><td style="font-weight:600">Total</td><td class="money" style="color:var(--ember)">${brl(tot)}</td><td></td></tr>`:`<tr><td colspan=3><div class="empty-t">Nenhum custo fixo — cadastre aluguel, energia, assinaturas…</div></td></tr>`;}
function setMeta(){const cur=Number(db.meta||0);const q=prompt('Meta de receita do mês (R$). Vazio ou 0 remove a meta:',cur||'');if(q===null)return;const n=Number(String(q).trim().replace(',','.'));if(!isFinite(n)||n<0){toast('Valor inválido');return;}db.meta=n;cloudSave();renderAll();toast(n?'Meta definida: '+brl(n)+'/mês':'Meta removida');}
function setMeiTeto(){const cur=Number(db.meiTeto||81000);const q=prompt('Teto anual de faturamento (R$). O padrão do MEI é 81000:',cur);if(q===null)return;const n=Number(String(q).trim().replace(',','.'));if(!isFinite(n)||n<=0){toast('Valor inválido');return;}db.meiTeto=n;cloudSave();renderAll();toast('Teto anual: '+brl(n));}
function renderPrazos(){
  const box=document.getElementById('dashPrazos');const hj=hoje();
  const d7=new Date();d7.setDate(d7.getDate()+7);
  const em7=d7.getFullYear()+'-'+String(d7.getMonth()+1).padStart(2,'0')+'-'+String(d7.getDate()).padStart(2,'0');
  const abertos=db.pedidos.filter(p=>p.prazo&&p.situacao!=='Entregue'&&p.situacao!=='Cancelado');
  const atras=abertos.filter(p=>p.prazo<hj).sort((a,b)=>a.prazo<b.prazo?-1:1);
  const prox=abertos.filter(p=>p.prazo>=hj&&p.prazo<=em7).sort((a,b)=>a.prazo<b.prazo?-1:1);
  const li=(p,late)=>{const prod=db.produtos.find(x=>x.id===p.produto);const cli=(db.clientes||[]).find(c=>c.id===p.clienteId);const nome=cli?cli.nome:(p.cliente||'—');return `<div class="prazo-item ${late?'late':''}"><span>${late?'⚠ ':''}${esc(nome)} — ${prod?esc(prod.nome):esc(p.item||'pedido')}${Number(p.qtd||1)>1?' ×'+p.qtd:''}</span><b>${esc(p.prazo)}</b></div>`;};
  // plano de produção: encomendas abertas menos peças prontas
  const porProd={};db.pedidos.filter(p=>p.situacao!=='Entregue'&&p.situacao!=='Cancelado'&&p.produto).forEach(p=>{porProd[p.produto]=(porProd[p.produto]||0)+Number(p.qtd||1);});
  const plano=Object.entries(porProd).map(([pid,q])=>{const prod=db.produtos.find(x=>x.id===pid);if(!prod)return null;const falta=q-Number(prod.pronto||0);return falta>0?{pid,nome:prod.nome,falta}:null;}).filter(Boolean);
  let html='';
  if(atras.length||prox.length)html+=`<div class="chartcard"><h3>Encomendas com prazo${atras.length?` · <span style="color:var(--ember)">${atras.length} atrasada${atras.length>1?'s':''}</span>`:''}</h3>${atras.map(p=>li(p,1)).join('')}${prox.map(p=>li(p,0)).join('')}</div>`;
  if(plano.length)html+=`<div class="chartcard" style="margin-top:14px"><h3>Plano de produção — para cobrir as encomendas abertas</h3>${plano.map(x=>`<div class="prazo-item"><span>Produzir <b>${x.falta} × ${esc(x.nome)}</b></span><button class="btn2" style="padding:4px 12px;font-size:12px" onclick="criarTarefaProducao('${x.pid}',${x.falta})">criar tarefa</button></div>`).join('')}</div>`;
  box.innerHTML=html;
  renderCal();
}
function exportDRE(){
  if(!pode('fin')){toast('Sem permissão para dados financeiros');return;}
  const mes=prompt('Fechamento de qual mês? (AAAA-MM)',hoje().slice(0,7));
  if(!mes||!/^\d{4}-\d{2}$/.test(mes.trim())){if(mes!==null)toast('Use o formato AAAA-MM');return;}
  const m=mes.trim();
  const calcMes=mm=>{
    const peds=db.pedidos.filter(p=>(p.situacao==='Pago'||p.situacao==='Entregue')&&(p.data||'').slice(0,7)===mm);
    let receita=0,taxas=0,frete=0,custoPecas=0;
    peds.forEach(p=>{receita+=Number(p.valor||0);const can=(db.canais||[]).find(c=>c.id===p.canal);const prod=db.produtos.find(x=>x.id===p.produto);const tp=can?Number(can.taxa||0):(prod?Number(prod.taxa||0):0);taxas+=Number(p.valor||0)*tp/100;frete+=Number(p.frete||0);if(prod)custoPecas+=calcCusto(prod).total*Number(p.qtd||1);});
    const fixos=(db.fixos||[]).reduce((s,f)=>s+Number(f.valor||0),0);
    return{n:peds.length,receita,taxas,frete,custoPecas,fixos,liq:receita-taxas-frete-custoPecas-fixos};
  };
  const dAnt=new Date(Number(m.slice(0,4)),Number(m.slice(5,7))-2,1);
  const mAnt=dAnt.getFullYear()+'-'+String(dAnt.getMonth()+1).padStart(2,'0');
  const A=calcMes(m),B=calcMes(mAnt);
  const dLiq=B.liq!==0?Math.round((A.liq/B.liq-1)*100):null;
  const win=window.open('','_blank');
  const ln=(l,v,vb,neg)=>`<tr><td>${l}</td><td style="text-align:right;${neg?'color:#B5462A':''}">${neg?'− ':''}${brl(v)}</td><td style="text-align:right;color:#8A7E70">${brl(vb)}</td></tr>`;
  win.document.write(`<html><head><title>Fechamento ${m} — ${esc(empresaNome||'Cinérea')}</title><style>body{font-family:Georgia,serif;color:#1C1A17;padding:40px;max-width:620px;margin:auto}h1{font-size:26px}table{width:100%;border-collapse:collapse;margin-top:20px;font-size:15px}td,th{padding:9px 4px;border-bottom:1px solid #ddd}th{font-size:11px;text-transform:uppercase;color:#8A7E70;text-align:right}th:first-child{text-align:left}.tot td{border-top:2px solid #1C1A17;border-bottom:none;font-size:19px;font-weight:bold;${A.liq>=0?'':'color:#B5462A'}}</style></head><body>
  <h1>Fechamento — ${m}</h1><p>${esc(empresaNome||'Cinérea')} · ${A.n} venda(s)${dLiq!==null?` · lucro ${dLiq>=0?'↑':'↓'}${Math.abs(dLiq)}% vs ${mAnt}`:''}</p>
  <table><tr><th>Linha</th><th>${m}</th><th>${mAnt}</th></tr>
  ${ln('Receita (pedidos pagos/entregues)',A.receita,B.receita)}${ln('Taxas de canal',A.taxas,B.taxas,1)}${ln('Frete / embalagem',A.frete,B.frete,1)}${ln('Custo das peças vendidas',A.custoPecas,B.custoPecas,1)}${ln('Custos fixos do mês',A.fixos,B.fixos,1)}
  <tr class="tot"><td>Lucro líquido</td><td style="text-align:right">${brl(A.liq)}</td><td style="text-align:right;font-size:14px;color:#8A7E70">${brl(B.liq)}</td></tr></table>
  <p style="margin-top:36px;color:#999;font-size:11px">Gerado pelo sistema de gestão — ${new Date().toLocaleDateString('pt-BR')}</p>
  </body></html>`);
  win.document.close();setTimeout(()=>win.print(),400);
}
function renderChecks(){document.querySelectorAll('.checklist input').forEach(c=>{c.checked=!!(db.checks&&db.checks[c.dataset.c]);});}
function saveCheck(){db.checks=db.checks||{};document.querySelectorAll('.checklist input').forEach(c=>db.checks[c.dataset.c]=c.checked);cloudSave();}
window.saveCheck=saveCheck;
// Renderiza apenas a aba visível: antes, cada mudança reconstruía 13 tabelas
// e 8 gráficos. O badge da Equipe e os rótulos seguem sempre atualizados.
const RENDER_ABA={
  dashboard:()=>renderDash(),
  vender:()=>{renderPedidos();renderClientes();renderCanais();renderPostProdutos();renderVendedores();renderCupons();renderComissoes();},
  produzir:()=>{renderProducao();renderMoldes();renderEquip();},
  comprar:()=>{renderCompras();renderComprasHist();renderCotacoes();renderFornecedores();renderInsumos();},
  numeros:()=>{renderProdutos();renderFixos();renderColecoes();renderBanner();avisoCatalogo();},
  // Encomendas nao entra aqui: e busca de rede, e renderAll roda a cada
  // salvamento. Ela carrega quando a sub-aba e aberta.
  ajustes:()=>{renderEquipe();renderProdMembro();renderAtividade();renderAcessos();},
};
function abaAtiva(){const b=document.querySelector('#tabs button.active');return (b&&b.dataset.tab)||'dashboard';}
/**
 * Troca a sub-aba DENTRO do grupo aberto.
 *
 * Antes isto varria a página inteira, o que funcionava porque só Compras tinha
 * sub-abas. Com vários grupos usando o mesmo mecanismo, trocar de sub-aba num
 * apagaria a seleção dos outros.
 */
function subAba(id){
  const grupo=document.querySelector('.panel.active');
  if(!grupo)return;
  grupo.querySelectorAll('.subtabs button').forEach(b=>{const on=b.dataset.sub===id;b.classList.toggle('active',on);b.setAttribute('aria-selected',on?'true':'false');});
  grupo.querySelectorAll('.subpanel').forEach(p=>p.classList.toggle('active',p.id==='s-'+id));
  renderAll();
}
function badgeEquipe(){
  const n=(db.tarefas||[]).filter(t=>t.resp===uid&&(t.status||'aberta')!=='feita').length;
  const b=document.querySelector('[data-sub="equipe"]');if(b)b.textContent='Equipe'+(n?' ('+n+')':'');
}
function renderAll(){
  if(!uid)return;
  aplicarPapel();aplicarRotulos();badgeEquipe();
  const f=RENDER_ABA[abaAtiva()];
  if(f)try{f();}catch(e){console.error(e);}
  labelize();
}

// formulários (igual antes + baixa de estoque)
let currentForm={type:null,id:null,recipe:[]};
const FORMS={
  colecao:{title:'Coleção',fem:true,fields:[
    {k:'nome',l:'Nome da coleção',t:'text'},
    {k:'desc',l:'Como ela aparece na loja',t:'text',hint:'A frase que explica a coleção no site e no app, acima das peças'},
    {k:'ordem',l:'Ordem',t:'number',def:10,hint:'Menor vem primeiro. Deixe espaço entre os números (10, 20, 30) para encaixar coleções novas sem renumerar tudo.'},
  ]},
  equip:{title:'Equipamento',fields:[{k:'nome',l:'Nome',t:'text'},{k:'tipo',l:'Tipo',t:'text'},{k:'compra',l:'Data de compra',t:'date'},{k:'custo',l:'Custo (R$)',t:'number'},{k:'vidaHoras',l:'Vida útil estimada (horas)',t:'number',hint:'Usada para ratear a depreciação no orçamento'},{k:'situacao',l:'Situação',t:'select',opts:['Ativo','Em manutenção','Inativo']}]},
  molde:{title:'Molde',fields:[{k:'nome',l:'Nome',t:'text'},{k:'material',l:'Material',t:'select',opts:['gesso','cera']},{k:'usos',l:'Usos já feitos',t:'number'},{k:'vida',l:'Vida útil (peças)',t:'number',hint:'Gesso ≈40, cera ≈120'}]},
  insumo:{title:'Insumo',fields:[{k:'nome',l:'Nome',t:'text'},{k:'unidade',l:'Unidade',t:'select',opts:['kg','g','L','ml','un']},{k:'estoque',l:'Estoque atual',t:'number'},{k:'minimo',l:'Estoque mínimo',t:'number'},{k:'custo',l:'Custo por unidade (R$)',t:'number'}]},
  producao:{title:'Produção',fields:[{k:'data',l:'Data',t:'date'},{k:'produto',l:'Produto',t:'selectProd'},{k:'qtd',l:'Quantidade',t:'number',def:1},{k:'minutos',l:'Tempo por peça (min)',t:'number',hint:'Sua maior linha de custo'},{k:'variacao',l:'Variação / fragrância',t:'text',hint:'Opcional — ex.: lavanda'},{k:'molde',l:'Molde usado',t:'selectMolde'}]},
  pedido:{title:'Pedido',fields:[{k:'data',l:'Data',t:'date'},{k:'clienteId',l:'Cliente',t:'selectCliente'},{k:'produto',l:'Produto',t:'selectProd',hint:'Ligue ao produto para ver o lucro e baixar o estoque pronto'},{k:'qtd',l:'Quantidade',t:'number',def:1},{k:'variacao',l:'Variação / fragrância',t:'text'},{k:'item',l:'Descrição livre',t:'text',hint:'Use se não for um produto cadastrado'},{k:'canal',l:'Canal de venda',t:'selectCanal',hint:'Define a taxa usada no lucro'},{k:'prazo',l:'Entregar até',t:'date',def:'',hint:'Opcional — aparece no Painel'},{k:'valor',l:'Valor (R$)',t:'number',hint:'Vazio = preço praticado × quantidade'},{k:'frete',l:'Frete/embalagem (R$)',t:'number',def:'',hint:'Custo de envio — desconta do lucro'},{k:'cupom',l:'Cupom usado',t:'text',hint:'O código que o cliente informou. É por ele que a comissão do vendedor é calculada'},{k:'situacao',l:'Situação',t:'select',opts:['Pendente','Pago','Em produção','Entregue','Cancelado']}]},
  cliente:{title:'Cliente',fields:[{k:'nome',l:'Nome',t:'text'},{k:'whats',l:'WhatsApp',t:'text',hint:'Só números com DDD — vira link para conversar'},{k:'obs',l:'Observações',t:'text',hint:'Preferências, endereço…'}]},
  canal:{title:'Canal de venda',fields:[{k:'nome',l:'Nome',t:'text'},{k:'taxa',l:'Taxa (%)',t:'number',def:0,hint:'Ex.: marketplace 12, Pix 0'}]},
  tarefa:{title:'Tarefa',fem:true,fields:[{k:'titulo',l:'Tarefa',t:'text'},{k:'desc',l:'Detalhes',t:'text',hint:'Opcional'},{k:'resp',l:'Responsável',t:'selectMembro'},{k:'prazo',l:'Prazo',t:'date',def:''},{k:'status',l:'Situação',t:'select',opts:['aberta','fazendo','feita']}]},
  compra:{title:'Compra',fem:true,fields:[{k:'data',l:'Data',t:'date'},{k:'insumo',l:'Insumo',t:'selectIns'},{k:'qtd',l:'Quantidade comprada',t:'number'},{k:'valor',l:'Valor total pago (R$)',t:'number',hint:'Recalcula o custo médio do insumo. Vazio = só dá entrada no estoque'},{k:'fornecedorId',l:'Fornecedor',t:'selectFornecedor'}]},
  fornecedor:{title:'Fornecedor',fields:[{k:'nome',l:'Nome',t:'text'},{k:'categoria',l:'Categoria de material',t:'text',hint:'Ex.: gesso, essências, embalagens'},{k:'risco',l:'Risco',t:'select',opts:['Baixo','Médio','Alto']},{k:'whats',l:'WhatsApp principal',t:'text',hint:'Só números com DDD — vira link'},{k:'endereco',l:'Endereço',t:'text'},{k:'obs',l:'Observações',t:'text',hint:'Prazo típico, condições, mínimos…'}]},
  fixo:{title:'Custo fixo',fields:[{k:'nome',l:'Nome',t:'text'},{k:'valor',l:'Valor mensal (R$)',t:'number'}]},
  acesso:{title:'Usuário',fields:[
    {k:'email',l:'E-mail',t:'text',hint:'O mesmo que a pessoa vai usar para entrar. Ela cria a própria senha'},
    {k:'nome',l:'Nome',t:'text',hint:'Só para você saber de quem é — a pessoa pode trocar depois'},
    {k:'papel',l:'Papel',t:'select',opts:['empregado','socio','admin']},
    {k:'obs',l:'Observação',t:'text',hint:'Opcional'},
  ]},
  banner:{title:'Banner da loja',fields:[
    {k:'ativo',l:'Situação',t:'select',opts:['ligado','desligado']},
    {k:'imagem',l:'Arte de fundo (opcional)',t:'imagem',pasta:'banners',lado:1600,teto:400,
     hint:'<b>1600 × 500 px</b>, JPG, PNG ou WebP, até 400 KB. Encolhemos antes de enviar, então pode mandar maior.<br><b>O que sobrevive é o MEIO.</b> A faixa da loja é bem baixa: no computador some o terço de cima e o de baixo da arte; no celular somem as bordas laterais. Ponha o assunto na faixa central e não conte com cantos.<br><b>O texto vai por cima</b>, centralizado e com um véu escuro. Arte muito detalhada no centro atrapalha a leitura — luz e superfície ali funcionam melhor que objeto.'},
    {k:'titulo',l:'Chamada',t:'text',hint:'Até 90 caracteres, mas mire em 40: no celular a faixa tem uma linha e meia. Ex.: "Frete grátis até domingo"'},
    {k:'texto',l:'Detalhe',t:'text',hint:'Opcional, até 140 caracteres. A condição em uma linha — "Para todo o estado de São Paulo"'},
    {k:'cupom',l:'Cupom para divulgar',t:'text',hint:'Opcional, até 24 caracteres. Vira maiúscula e sem acento sozinho. Aparece destacado, e quem tocar já entra com ele na sacola'},
    {k:'ate',l:'Até',t:'date',def:'',hint:'Opcional. Passou a data, o banner some sozinho da loja'},
    {k:'cor',l:'Cor do banner',t:'select',opts:['brasa','carvão','areia']},
  ]},
  vendedor:{title:'Vendedor',fields:[
    {k:'nome',l:'Nome',t:'text'},
    {k:'whats',l:'WhatsApp',t:'text',hint:'Só números com DDD — vira link para combinar o pagamento'},
    {k:'comissao',l:'Comissão (%)',t:'number',def:10,hint:'Sobre o valor efetivamente cobrado, já com o desconto do cupom aplicado'},
    {k:'chavePix',l:'Chave Pix',t:'text',hint:'Para onde a comissão vai'},
    {k:'obs',l:'Observações',t:'text',hint:'Onde divulga, o que foi combinado…'},
  ]},
  cupom:{title:'Cupom',fields:[
    {k:'codigo',l:'Código',t:'text',hint:'O que o cliente digita. Vira maiúscula e sem acento sozinho — MARIA10, FEIRA-2026'},
    {k:'vendedorId',l:'Vendedor',t:'selectVendedor',hint:'De quem é a comissão desta venda'},
    {k:'tipo',l:'Tipo de desconto',t:'select',opts:['percentual','valor']},
    {k:'valor',l:'Valor do desconto',t:'number',hint:'10 = 10% se for percentual, ou R$ 10 se for valor fixo'},
    {k:'minimo',l:'Valor mínimo do pedido (R$)',t:'number',def:'',hint:'Opcional — abaixo disso o cupom não vale'},
    {k:'ate',l:'Vale até',t:'date',def:'',hint:'Opcional — vazio não vence'},
    {k:'ativo',l:'Situação',t:'select',opts:['ativo','desligado']},
  ]},
};
function plural(t){return{equip:'equip',molde:'moldes',insumo:'insumos',produto:'produtos',producao:'producao',pedido:'pedidos',compra:'compras',fixo:'fixos',cliente:'clientes',canal:'canais',tarefa:'tarefas',cotacao:'cotacoes',fornecedor:'fornecedores',colecao:'colecoes',vendedor:'vendedores',cupom:'cupons',acesso:'acessos'}[t];}
const NOMES_TIPO={equip:'equipamento',molde:'molde',insumo:'insumo',produto:'produto',producao:'produção',pedido:'pedido',compra:'compra',fixo:'custo fixo',cliente:'cliente',canal:'canal',tarefa:'tarefa',cotacao:'cotação',fornecedor:'fornecedor',colecao:'coleção',vendedor:'vendedor',cupom:'cupom',acesso:'usuário'};
function val(id){const el=document.getElementById(id);return el?el.value:'';}
function openForm(type,id){
  const rodape=document.querySelector('.modal-foot');
  if(rodape)rodape.style.display='';   // a revisão de publicação o esconde
  currentForm={type,id:id||null,recipe:[]};window.currentForm=currentForm;const isP=type==='produto';
  // "Novo compra" e "Novo coleção" saíam errados desde sempre: o artigo era
  // fixo. Cada formulário diz o próprio gênero.
  const fem=!isP && !!FORMS[type].fem;
  document.getElementById('modalTitle').textContent=(id?'Editar ':(fem?'Nova ':'Novo '))+(isP?'produto':FORMS[type].title.toLowerCase());
  const body=document.getElementById('modalBody');let ex=id?db[plural(type)].find(x=>x.id===id):{};
  if(isP){currentForm.recipe=ex.receita?JSON.parse(JSON.stringify(ex.receita)):[];
    body.innerHTML=`<div class="field"><label>Nome do produto</label><input id="f_nome" value="${esc(ex.nome||'')}"></div><div class="field-row"><div class="field"><label>Equipamento usado</label><select id="f_equip" onchange="updateCost()"><option value="">— nenhum —</option>${db.equip.map(e=>`<option value="${e.id}" ${ex.equip===e.id?'selected':''}>${esc(e.nome)}</option>`).join('')}</select><div class="hint">Rateia a depreciação no custo</div></div><div class="field"><label>Peças prontas</label><input id="f_pronto" type="number" value="${ex.pronto||0}"><div class="hint">Estoque acabado (ajuste manual)</div></div></div><div class="field-row"><div class="field"><label>Foto da peça</label><label class="fotoup">Escolher imagem do computador<input type="file" accept="image/*" onchange="escolherFoto(this)" hidden></label><img id="f_fotoPrev" class="fotoprev" src="${esc(ex.foto||'')}" style="display:${ex.foto?'block':'none'}" alt=""><div class="hint" id="f_fotoStatus">Reduzimos a imagem antes de enviar — foto crua de celular pesa demais para quem vai abrir a loja.</div><input id="f_foto" value="${esc(ex.foto||'')}" placeholder="ou cole o endereço de uma imagem" style="margin-top:8px"></div><div class="field"><label>Segunda foto</label><label class="fotoup">Escolher imagem<input type="file" accept="image/jpeg,image/png,image/webp" onchange="escolherImagem(this,'foto2','produtos',1200,600)" hidden></label><img id="f_foto2Prev" class="fotoprev" src="${esc(ex.foto2||'')}" style="display:${ex.foto2?'block':'none'}" alt=""><div class="hint" id="f_foto2Status">Aparece quando o cliente passa o mouse sobre a peça, no lugar da primeira. Use outro ângulo, um detalhe ou a peça em uso — não uma variação da mesma foto, que ninguém percebe.</div><input id="f_foto2" value="${esc(ex.foto2||'')}" placeholder="ou cole o endereço" style="margin-top:8px"></div><div class="field"><label>Catálogo público</label><label style="display:flex;gap:8px;align-items:center;padding:11px 0;font-size:13px;color:var(--smoke);cursor:pointer;text-transform:none;letter-spacing:0"><input type="checkbox" id="f_publico" ${ex.publico?'checked':''} style="width:auto"> mostrar no catálogo</label></div></div><div class="loja-bloco"><div class="loja-tit">Loja — o que aparece para quem compra</div><div class="field-row"><div class="field"><label>Coleção</label><select id="f_colecao">${['<option value="">— sem coleção —</option>'].concat(colecoesOrdenadas().map(c=>`<option value="${c.id}" ${ex.colecao===c.id?'selected':''}>${esc(c.nome)}</option>`)).join('')}</select><div class="hint">A seção onde a peça aparece no site e no app</div></div><div class="field"><label>Posição na coleção</label><input id="f_posicao" type="number" value="${ex.posicao||10}"><div class="hint">Menor aparece antes</div></div><div class="field"><label>Situação</label><select id="f_situacao"><option value="disponivel" ${ex.situacao!=='embreve'?'selected':''}>À venda</option><option value="embreve" ${ex.situacao==='embreve'?'selected':''}>Em breve</option></select><div class="hint">"Em breve" entra na lista de espera, sem sacola</div></div></div><div class="field"><label>Frase curta</label><input id="f_desc" value="${esc(ex.desc||'')}" maxlength="120" placeholder="Duas mãos em concha sustentam uma taça de areia perfumada."><div class="hint">Aparece embaixo do nome, no cartão</div></div><div class="field"><label>Descrição</label><textarea id="f_longa" rows="4" placeholder="O texto que convence, na tela da peça.">${esc(ex.longa||'')}</textarea></div><div class="field"><label>Ficha técnica</label><textarea id="f_ficha" rows="4" placeholder="Escultura: Gesso · duas mãos&#10;Altura: 22 cm&#10;Repõe-se com: Aura-Sand + pavios">${esc((ex.ficha||[]).map(l=>l.join(': ')).join('\n'))}</textarea><div class="hint">Uma linha por item, no formato <code>rótulo: valor</code></div></div><div class="field"><label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-size:13px;color:var(--smoke);cursor:pointer"><input type="checkbox" id="f_destaque" ${ex.destaque?'checked':''} style="width:auto"> peça de destaque na vitrine</label></div></div><div class="field"><label>Receita — insumos consumidos</label><div id="recipeLines"></div><button class="add-line" onclick="addRecipeLine()">+ insumo</button></div><div class="field-row"><div class="field"><label>Tempo (min)</label><input id="f_minutos" type="number" value="${ex.minutos||''}" oninput="updateCost()"></div><div class="field"><label>Custo/hora</label><input id="f_custohora" type="number" value="${ex.custohora||25}" oninput="updateCost()"></div></div><div class="field-row"><div class="field"><label>Perda (%)</label><input id="f_perda" type="number" value="${ex.perda||8}" oninput="updateCost()"></div><div class="field"><label>Markup (×)</label><input id="f_markup" type="number" step="0.1" value="${ex.markup||3}" oninput="updateCost();document.getElementById('f_markupR').value=this.value"><input id="f_markupR" type="range" min="1" max="6" step="0.1" value="${ex.markup||3}" style="width:100%;margin-top:6px" oninput="document.getElementById('f_markup').value=this.value;updateCost()"><div class="hint">Arraste para simular o preço</div></div></div><div class="field-row"><div class="field"><label>Preço praticado</label><input id="f_preco" type="number" value="${ex.preco||''}" oninput="updateCost()" placeholder="vazio = sugerido"></div><div class="field"><label>Taxa (%)</label><input id="f_taxa" type="number" value="${ex.taxa||0}" oninput="updateCost()"></div></div><div class="cost-summary" id="costSummary"></div>`;
    renderRecipe();
  } else {
    if(type==='banner') ex = db.banner || {};
    body.innerHTML=FORMS[type].fields.map(f=>{let inp;const cur=ex[f.k]!==undefined?ex[f.k]:(id?'':(f.def!==undefined?f.def:(f.t==='date'?hoje():'')));if(f.t==='select')inp=`<select id="f_${f.k}">${f.opts.map(o=>`<option ${ex[f.k]===o?'selected':''}>${o}</option>`).join('')}</select>`;else if(f.t==='selectProd')inp=`<select id="f_${f.k}"><option value="">—</option>${db.produtos.map(p=>`<option value="${p.id}" ${ex[f.k]===p.id?'selected':''}>${esc(p.nome)}</option>`).join('')}</select>`;else if(f.t==='selectMolde')inp=`<select id="f_${f.k}"><option value="">— nenhum —</option>${db.moldes.map(m=>`<option value="${m.id}" ${ex[f.k]===m.id?'selected':''}>${esc(m.nome)}</option>`).join('')}</select>`;else if(f.t==='selectIns')inp=`<select id="f_${f.k}"><option value="">—</option>${db.insumos.map(x=>`<option value="${x.id}" ${ex[f.k]===x.id?'selected':''}>${esc(x.nome)}</option>`).join('')}</select>`;else if(f.t==='selectCliente')inp=`<select id="f_${f.k}" onchange="if(this.value==='__new')quickCliente(this)"><option value="">—</option>${(db.clientes||[]).map(c=>`<option value="${c.id}" ${ex[f.k]===c.id?'selected':''}>${esc(c.nome)}</option>`).join('')}<option value="__new">➕ Novo cliente…</option></select>`;else if(f.t==='selectCanal')inp=`<select id="f_${f.k}"><option value="">— taxa do produto —</option>${(db.canais||[]).map(c=>`<option value="${c.id}" ${ex[f.k]===c.id?'selected':''}>${esc(c.nome)} (${Number(c.taxa||0)}%)</option>`).join('')}</select>`;else if(f.t==='selectMembro')inp=`<select id="f_${f.k}"><option value="">—</option>${Object.entries(membros).map(([id,m])=>`<option value="${id}" ${ex[f.k]===id?'selected':''}>${esc(m.nome||'membro')}</option>`).join('')}</select>`;else if(f.t==='selectVendedor')inp=`<select id="f_${f.k}"><option value="">—</option>${(db.vendedores||[]).map(x=>`<option value="${x.id}" ${ex[f.k]===x.id?'selected':''}>${esc(x.nome)}</option>`).join('')}</select>`;else if(f.t==='selectFornecedor')inp=`<select id="f_${f.k}" onchange="if(this.value==='__new')quickFornecedor(this)"><option value="">—</option>${(db.fornecedores||[]).map(x=>`<option value="${x.id}" ${ex[f.k]===x.id?'selected':''}>${esc(x.nome)}</option>`).join('')}<option value="__new">➕ Novo fornecedor…</option></select>`;else if(f.t==='imagem')inp=`<label class="fotoup">Escolher imagem<input type="file" accept="image/jpeg,image/png,image/webp" onchange="escolherImagem(this,'${f.k}','${f.pasta||'banners'}',${f.lado||1600},${f.teto||400})" hidden></label><img id="f_${f.k}Prev" class="fotoprev" src="${esc(cur||'')}" style="display:${cur?'block':'none'}" alt=""><div class="hint" id="f_${f.k}Status"></div><input id="f_${f.k}" value="${esc(cur||'')}" placeholder="ou cole o endereço de uma imagem" style="margin-top:8px">`;else inp=`<input id="f_${f.k}" type="${f.t}" value="${esc(cur)}">`;return `<div class="field"><label>${f.l}</label>${inp}${f.hint?`<div class="hint">${f.hint}</div>`:''}</div>`;}).join('');
  }
  if(type==='producao'){const mf=document.getElementById('f_minutos');if(mf){const w=document.createElement('div');w.style.marginTop='6px';w.innerHTML='<button type="button" class="btn2" id="timerBtn" onclick="toggleTimer()">▶ Cronometrar uma peça</button> <span id="timerView" style="font-size:12px;color:var(--warm)"></span>';mf.parentElement.appendChild(w);}}
  if(type==='fornecedor'){currentForm.contatos=ex.contatos?JSON.parse(JSON.stringify(ex.contatos)):[];const box=document.createElement('div');box.className='field';box.innerHTML='<label>Contatos no fornecedor</label><div id="contatosLines"></div><button type="button" class="add-line" onclick="addContatoForn()">+ contato (vendedor, financeiro…)</button>';document.getElementById('modalBody').appendChild(box);renderContatosForn();}
  if(type==='pedido'&&id){const p=db.pedidos.find(x=>x.id===id);if(p){const pago=(p.pagamentos||[]).reduce((s,x)=>s+Number(x.v||0),0);const box=document.createElement('div');box.className='field';box.innerHTML=`<label>Pagamentos (sinal / parcelas)</label><div id="pagList">${(p.pagamentos||[]).map(x=>`<div class="prazo-item"><span>${esc(x.t)}</span><b>${brl(x.v)}</b></div>`).join('')||'<div class="hint">nenhum pagamento registrado</div>'}</div><div style="display:flex;gap:8px;margin-top:8px"><input id="pagVal" type="number" step="0.01" placeholder="valor recebido (R$)" style="flex:1"><button type="button" class="btn2" onclick="addPagamento('${id}')">Registrar</button></div><div class="hint">Recebido: ${brl(pago)} · Falta: ${brl(Math.max(0,Number(p.valor||0)-pago))}</div>`;document.getElementById('modalBody').appendChild(box);}}
  if(type==='tarefa'&&id){const t=db.tarefas.find(x=>x.id===id);if(t){const box=document.createElement('div');box.className='field';box.innerHTML='<label>Comentários</label><div id="comentList">'+((t.coments||[]).map(c=>`<div class="prazo-item"><span><b>${esc((membros[c.u]||{}).nome||'membro')}:</b> ${esc(c.x)}</span><b style="color:var(--warm);font-weight:400">${tempoRel(c.t)}</b></div>`).join('')||'<div class="hint">nenhum comentário ainda</div>')+'</div><div style="display:flex;gap:8px;margin-top:8px"><input id="comentTxt" placeholder="escreva um comentário…" style="flex:1"><button type="button" class="btn2" onclick="addComent(\''+id+'\')">Enviar</button></div>';document.getElementById('modalBody').appendChild(box);}}
  document.getElementById('overlay').classList.add('open');
}
function addRecipeLine(){currentForm.recipe.push({insumo:'',qtd:''});renderRecipe();}
function rmRecipeLine(i){currentForm.recipe.splice(i,1);renderRecipe();}
window.currentForm=currentForm;
function renderRecipe(){const box=document.getElementById('recipeLines');if(!box)return;box.innerHTML=currentForm.recipe.map((l,i)=>`<div class="recipe-line"><select onchange="currentForm.recipe[${i}].insumo=this.value;updateCost()"><option value="">insumo…</option>${db.insumos.map(ins=>`<option value="${ins.id}" ${l.insumo===ins.id?'selected':''}>${esc(ins.nome)}</option>`).join('')}</select><input type="number" step="0.001" placeholder="qtd" value="${esc(l.qtd)}" oninput="currentForm.recipe[${i}].qtd=this.value;updateCost()"><span style="font-size:11px;color:var(--warm)">${esc((db.insumos.find(x=>x.id===l.insumo)||{}).unidade||'')}</span><button class="icon-btn" onclick="rmRecipeLine(${i})">×</button></div>`).join('');updateCost();}
function updateCost(){const s=document.getElementById('costSummary');if(!s)return;const p={receita:currentForm.recipe,minutos:val('f_minutos'),custohora:val('f_custohora'),perda:val('f_perda'),equip:val('f_equip')};const c=calcCusto(p);const mk=Number(val('f_markup')||3);const sug=c.total*mk;const pin=val('f_preco');const prat=pin?Number(pin):sug;const taxa=prat*Number(val('f_taxa')||0)/100;const margem=prat-taxa-c.total;const mpct=prat?Math.round(margem/prat*100):0;s.innerHTML=`<div class="cl"><span>Material</span><span>${brl(c.mat)}</span></div><div class="cl"><span>Mão de obra</span><span>${brl(c.mo)}</span></div><div class="cl"><span>Equipamento</span><span>${brl(c.eq)}</span></div><div class="cl"><span>Perda</span><span>${brl(c.perda)}</span></div><div class="cl total"><span>Custo</span><span>${brl(c.total)}</span></div><div class="cl" style="margin-top:8px"><span>Sugerido (${mk}×)</span><span>${brl(sug)}</span></div><div class="cl"><span>Margem</span><span class="ember">${brl(margem)} · ${mpct}%</span></div>`;}
// ---------- efeitos de produção e pedido (aplicar/reverter) ----------
function gerarLote(data){const d=data||hoje();const n=db.producao.filter(p=>p.data===d).length+1;return 'L'+d.replace(/-/g,'')+'-'+n;}
function applyProducao(o){
  const q=Number(o.qtd||0);
  if(o.molde){const m=db.moldes.find(x=>x.id===o.molde);if(m){m.usos=Number(m.usos||0)+q;o.usosMolde=q;}}
  const prod=db.produtos.find(x=>x.id===o.produto);
  if(!prod)return;
  prod.pronto=Number(prod.pronto||0)+q;
  if(prod.receita){const baixas=[],msg=[];
    prod.receita.forEach(l=>{const ins=db.insumos.find(i=>i.id===l.insumo);if(ins){const usado=Number(l.qtd||0)*q;const real=Math.min(Number(ins.estoque||0),usado);ins.estoque=Number(ins.estoque||0)-real;baixas.push({insumo:ins.id,qtd:real});msg.push(`${esc(ins.nome)} −${usado.toFixed(usado%1?2:0)}${esc(ins.unidade)}`);}});
    o.baixas=baixas; // guarda o que foi baixado, para poder reverter depois
    if(msg.length)setTimeout(()=>toast('Estoque baixado: <b>'+msg.join(' · ')+'</b>'),200);
  }
}
function revertProducao(o){
  const q=Number(o.qtd||0);
  if(o.molde){const m=db.moldes.find(x=>x.id===o.molde);if(m)m.usos=Math.max(0,Number(m.usos||0)-Number(o.usosMolde!==undefined?o.usosMolde:q));}
  const prod=db.produtos.find(x=>x.id===o.produto);
  if(prod)prod.pronto=Math.max(0,Number(prod.pronto||0)-q);
  let baixas=o.baixas;
  if(!baixas&&prod&&prod.receita)baixas=prod.receita.map(l=>({insumo:l.insumo,qtd:Number(l.qtd||0)*q})); // registros antigos, sem snapshot
  (baixas||[]).forEach(b=>{const ins=db.insumos.find(i=>i.id===b.insumo);if(ins)ins.estoque=Number(ins.estoque||0)+Number(b.qtd||0);});
}
function applyPedido(o){
  if(o.situacao!=='Entregue'||!o.produto)return;
  const prod=db.produtos.find(x=>x.id===o.produto);if(!prod)return;
  const q=Number(o.qtd||1);const real=Math.min(Number(prod.pronto||0),q);
  prod.pronto=Number(prod.pronto||0)-real;o.baixaPronto=real;o.baixado=true;
}
function revertPedido(o){
  if(!o.baixado)return;
  const prod=db.produtos.find(x=>x.id===o.produto);
  if(prod)prod.pronto=Number(prod.pronto||0)+Number(o.baixaPronto||0);
  o.baixado=false;o.baixaPronto=0;
}
function applyCompra(o){
  const ins=db.insumos.find(i=>i.id===o.insumo);if(!ins)return;
  o.estoqueAntes=num(ins.estoque);o.custoAntes=num(ins.custo); // snapshot p/ reverter
  const r=custoMedio(o.estoqueAntes,o.custoAntes,o.qtd,o.valor);
  ins.estoque=r.estoque;
  if(r.custo!==o.custoAntes){
    ins.custo=r.custo;
    setTimeout(()=>toast(`Custo médio de <b>${esc(ins.nome)}</b> atualizado: ${brl(ins.custo)}/${esc(ins.unidade)}`),200);
  }
}
function revertCompra(o){
  const ins=db.insumos.find(i=>i.id===o.insumo);if(!ins)return;
  ins.estoque=Math.max(0,Number(ins.estoque||0)-Number(o.qtd||0));
  if(o.custoAntes!==undefined)ins.custo=o.custoAntes;
}
function saveForm(){
  const type=currentForm.type,id=currentForm.id;let obj={};
  if(type==='perfil'){salvarPerfil();return;}
  if(type==='cotacaoView'||type==='publicar'){closeModal();return;}
  if(type==='cotacaoSel'){
    const itens=[];document.querySelectorAll('[data-cot]').forEach(ch=>{if(!ch.checked)return;const iid=ch.getAttribute('data-cot');const q=Number((document.getElementById('cotq_'+iid)||{}).value||0);if(q>0)itens.push({insumo:iid,qtd:Math.round(q*100)/100});});
    if(!itens.length){toast('Marque ao menos um item e informe a quantidade.');return;}
    const alvos=[];document.querySelectorAll('[data-alvo]').forEach(ch=>{if(ch.checked)alvos.push(ch.getAttribute('data-alvo'));});
    gerarCotacaoXlsx(itens,{validade:val('cotValidade')||'',cond:val('cotCond')||'',alvos});
    closeModal();return;
  }
  // O banner é UM só, então não vira lista: mora direto no `db`. Uma loja com
  // cinco promoções competindo no alto não é promoção, é ruído.
  if(type==='banner'){
    db.banner={
      ativo:val('f_ativo')||'ligado', titulo:val('f_titulo').trim(),
      texto:val('f_texto').trim(), cupom:normalizarCupom(val('f_cupom')), imagem:val('f_imagem').trim(),
      ate:val('f_ate')||'', cor:val('f_cor')||'brasa',
    };
    if(!db.banner.titulo){toast('Escreva a chamada do banner.');return;}
    logAtv('editou o banner da loja');
    cloudSave();closeModal();renderAll();
    toast('Banner salvo. <b>Publique a loja</b> para ele entrar no ar.');
    return;
  }
  if(type==='colecao'){obj={nome:val('f_nome'),desc:val('f_desc'),ordem:Number(val('f_ordem'))||10};}
  if(type==='produto'){obj={nome:val('f_nome'),receita:currentForm.recipe.filter(l=>l.insumo&&l.qtd),minutos:val('f_minutos'),custohora:val('f_custohora'),perda:val('f_perda'),markup:val('f_markup'),preco:val('f_preco'),taxa:val('f_taxa'),equip:val('f_equip'),pronto:Number(val('f_pronto')||0),foto:val('f_foto'),foto2:val('f_foto2'),publico:!!(document.getElementById('f_publico')||{}).checked,colecao:val('f_colecao'),posicao:Number(val('f_posicao'))||10,situacao:val('f_situacao')||'disponivel',desc:val('f_desc'),longa:val('f_longa'),ficha:parseFicha(val('f_ficha')),destaque:!!(document.getElementById('f_destaque')||{}).checked};
    // grava a margem de referência do momento em que o preço foi definido —
    // é contra ela que o alerta de "preço defasado" compara depois
    if(num(obj.preco)>0){const ref=precoProduto({...obj,id:id||'tmp'},db);obj.margemRef=ref.margemPct;}
    else delete obj.margemRef;}
  else{FORMS[type].fields.forEach(f=>obj[f.k]=val('f_'+f.k));if(type==='fornecedor')obj.contatos=(currentForm.contatos||[]).filter(c=>c.nome&&c.nome.trim());if(!obj[FORMS[type].fields[0].k]){toast('Preencha o primeiro campo.');return;}}
  if(type==='acesso'){
    currentForm.emailAntigo = id ? ((db.acessos||[]).find(x=>x.id===id)||{}).email : null;
  }
  if(type==='cupom'){
    // O código é o ID do documento no Firestore, e id do Firestore diferencia
    // maiúscula de minúscula. Normalizar aqui é o que faz o cupom impresso num
    // story funcionar quando o cliente digita em minúscula no celular.
    obj.codigo=normalizarCupom(obj.codigo);
    if(!obj.codigo){toast('O código só pode ter letras, números e hífen.');return;}
    // Guardado antes de o cadastro ser sobrescrito: se o código mudou, o
    // documento velho precisa sair do ar, senão o código antigo continua
    // valendo e ainda paga comissão.
    currentForm.codigoAntigo = id ? ((db.cupons||[]).find(x=>x.id===id)||{}).codigo : null;
    const rep=(db.cupons||[]).find(c=>c.codigo===obj.codigo&&c.id!==id);
    if(rep){toast('Já existe um cupom <b>'+esc(obj.codigo)+'</b>.');return;}
    if(!obj.vendedorId){toast('Escolha de quem é a comissão deste cupom.');return;}
    const v=Number(obj.valor)||0;
    if(v<=0){toast('O desconto precisa ser maior que zero.');return;}
    if(obj.tipo==='percentual'&&v>100){toast('Desconto percentual acima de 100% deixaria o total negativo.');return;}
  }
  if(type==='acesso'){
    obj.email = String(obj.email||'').trim().toLowerCase();
    // O e-mail é o ID do documento no Firestore, então normalizar não é enfeite:
    // "Maria@X.com" e "maria@x.com" virariam duas autorizações, e a regra
    // procura pela minúscula.
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(obj.email)){toast('E-mail inválido.');return;}
    const rep=(db.acessos||[]).find(a=>a.email===obj.email && a.id!==id);
    if(rep){toast('Esse e-mail já está cadastrado.');return;}
    if(!PAPEIS.includes(obj.papel)){obj.papel='empregado';}
  }
  if(type==='vendedor'){
    const c=Number(obj.comissao)||0;
    if(c<0||c>100){toast('A comissão precisa ficar entre 0 e 100%.');return;}
  }
  // validação de domínio (core.js): impede quantidade negativa, data absurda, taxa fora de 0-100…
  const erro=validar(type,obj);
  if(erro){toast('<b>'+esc(erro)+'</b>');return;}
  const list=plural(type);
  if(type==='producao'){
    if(id){const i=db[list].findIndex(x=>x.id===id);const old=db[list][i];revertProducao(old);obj={...old,...obj};delete obj.baixas;delete obj.usosMolde;applyProducao(obj);db[list][i]=obj;}
    else{obj.id=uidGen();obj.por=uid;obj.lote=gerarLote(obj.data);applyProducao(obj);db[list].push(obj);}
  } else if(type==='pedido'){
    if(!obj.qtd)obj.qtd=1;
    if(obj.clienteId==='__new')obj.clienteId='';
    if(!obj.valor&&obj.produto){const pr=db.produtos.find(x=>x.id===obj.produto);if(pr){const c=calcCusto(pr).total;obj.valor=Math.round((Number(pr.preco)||c*Number(pr.markup||3))*Number(obj.qtd||1)*100)/100;}}
    if(id){const i=db[list].findIndex(x=>x.id===id);const old=db[list][i];revertPedido(old);obj={...old,...obj};delete obj.baixaPronto;obj.baixado=false;applyPedido(obj);db[list][i]=obj;syncPortal(obj,true);}
    else{obj.id=uidGen();obj.por=uid;applyPedido(obj);db[list].push(obj);}
  } else if(type==='compra'){
    if(!obj.insumo){toast('Escolha o insumo.');return;}
    if(obj.fornecedorId==='__new')obj.fornecedorId='';
    if(obj.fornecedorId){const f=(db.fornecedores||[]).find(x=>x.id===obj.fornecedorId);if(f)obj.fornecedor=f.nome;}
    if(id){const i=db[list].findIndex(x=>x.id===id);const old=db[list][i];revertCompra(old);obj={...old,...obj};delete obj.estoqueAntes;delete obj.custoAntes;applyCompra(obj);db[list][i]=obj;}
    else{obj.id=uidGen();obj.por=uid;applyCompra(obj);db[list].push(obj);}
  } else {
    if(id){const i=db[list].findIndex(x=>x.id===id);db[list][i]={...db[list][i],...obj};}
    else{obj.id=uidGen();obj.por=uid;db[list].push(obj);}
  }
  // O cupom vai para o ar NA HORA. Sem isto, salvar aqui e a loja continuar com
  // o valor velho é o mesmo problema de apagar e continuar valendo.
  if(type==='acesso'){
    const salvo=(db.acessos||[]).find(x=>x.email===obj.email)||obj;
    const novo = !id;
    sincronizarAcesso(salvo,currentForm.emailAntigo)
      .then(()=>{
        // Oferecer na hora, e não só deixar o botão na linha: cadastrar sem
        // avisar a pessoa foi exatamente o buraco da primeira versão.
        if(novo && confirm('Autorização criada. Enviar o convite por e-mail para '+salvo.email+' agora?')){
          convidarPorEmail(salvo.email);
        } else {
          toast('<b>'+esc(salvo.email)+'</b> autorizado. Toque no ✉ para convidar.');
        }
      })
      .catch(e=>{console.error(e);toast('Salvei aqui, mas <b>não consegui liberar o acesso</b>. Use "Conferir o que está no ar".');});
  }
  if(type==='cupom'){
    const salvo=(db.cupons||[]).find(x=>x.codigo===obj.codigo)||obj;
    const antigo=currentForm.codigoAntigo;
    sincronizarCupom(salvo,antigo)
      .then(()=>toast('Cupom <b>'+esc(salvo.codigo)+'</b> no ar'))
      .catch(e=>{console.error(e);toast('Salvei aqui, mas <b>não consegui atualizar a loja</b>. Use "Conferir o que está no ar".');});
  }
  // registro de atividade (sem valores — visível a todos os papéis)
  if(type==='producao'&&!id){const pr=db.produtos.find(x=>x.id===obj.produto);logAtv('registrou produção de '+(obj.qtd||'?')+' × '+(pr?pr.nome:'peça'));}
  else logAtv((id?'editou ':'criou ')+(NOMES_TIPO[type]||type)+(obj.nome?' "'+obj.nome+'"':obj.titulo?' "'+obj.titulo+'"':''));
  cloudSave();closeModal();renderAll();
}
function del(type,id){
  // Chamar del() com o tipo no plural (o erro natural, porque a lista é
  // plural) fazia `db[undefined]` estourar sem dizer nada, e o botão parecia
  // morto. Falhar aqui é feio, mas é visível.
  if(!plural(type)){console.error('del: tipo desconhecido',type);toast('Não sei remover isso — avise o desenvolvedor');return;}
  // Remover a coleção deixaria as peças dela apontando para o nada, e elas
  // sumiriam da loja sem explicação. Melhor avisar antes.
  if(type==='colecao'){
    const usadas=(db.produtos||[]).filter(p=>p.colecao===id);
    if(usadas.length && !confirm(`${usadas.length} peça(s) estão nesta coleção e ficariam sem seção na loja. Remover mesmo assim?`))return;
    (db.produtos||[]).forEach(p=>{ if(p.colecao===id) p.colecao=''; });
  }
  const snap=JSON.parse(JSON.stringify(db)); // p/ desfazer
  cupomApagadoNoUndo=null;   // a marca é do desfazer DESTA exclusão, não da anterior
  const list=plural(type);const o=db[list].find(x=>x.id===id);
  if(type==='producao'&&o)revertProducao(o);
  if(type==='pedido'&&o)revertPedido(o);
  if(type==='compra'&&o)revertCompra(o);
  // Apagar aqui TEM de apagar no ar. Enquanto isto não existia, o cupom
  // apagado continuava dando desconto na loja, para sempre.
  if(type==='acesso'&&o&&o.email){
    // Retirar o acesso aqui TEM de retirar no servidor, senão a pessoa continua
    // podendo entrar — e o cadastro diria que não.
    deleteDoc(doc(fdb,'acessos',o.email))
      .catch(e=>{console.error(e);toast('Removido daqui, mas <b>a autorização continua no ar</b>. Use "Conferir o que está no ar".');});
  }
  if(type==='cupom'&&o&&o.codigo){
    cupomApagadoNoUndo=o.codigo;
    apagarCupomDoAr(o.codigo)
      .catch(e=>{console.error(e);toast('Removido daqui, mas <b>ainda está no ar</b>. Use "Conferir o que está no ar".');});
  }
  db[list]=db[list].filter(x=>x.id!==id);
  logAtv('excluiu '+(NOMES_TIPO[type]||type)+(o&&(o.nome||o.titulo)?' "'+(o.nome||o.titulo)+'"':''));
  cloudSave();renderAll();
  toastUndo({producao:'Produção excluída — estoque e molde restaurados.',compra:'Compra excluída — estoque e custo revertidos.'}[type]||'Excluído.',snap);
}
function renderContatosForn(){const box=document.getElementById('contatosLines');if(!box)return;box.innerHTML=(currentForm.contatos||[]).map((c,i)=>`<div class="recipe-line" style="grid-template-columns:1fr 1fr 1fr 30px"><input placeholder="nome" value="${esc(c.nome||'')}" oninput="currentForm.contatos[${i}].nome=this.value"><input placeholder="cargo" value="${esc(c.cargo||'')}" oninput="currentForm.contatos[${i}].cargo=this.value"><input placeholder="WhatsApp" value="${esc(c.whats||'')}" oninput="currentForm.contatos[${i}].whats=this.value"><button class="icon-btn" onclick="rmContatoForn(${i})">×</button></div>`).join('')||'<div class="hint">nenhum contato — adicione o vendedor que te atende</div>';}
function addContatoForn(){currentForm.contatos=currentForm.contatos||[];currentForm.contatos.push({nome:'',cargo:'',whats:''});renderContatosForn();}
function rmContatoForn(i){currentForm.contatos.splice(i,1);renderContatosForn();}
function quickFornecedor(sel){const nome=prompt('Nome do fornecedor:');if(!nome){sel.value='';return;}const whats=prompt('WhatsApp (opcional):')||'';const f={id:uidGen(),nome:nome.trim(),whats,obs:''};db.fornecedores=db.fornecedores||[];db.fornecedores.push(f);cloudSave();const o=document.createElement('option');o.value=f.id;o.textContent=f.nome;sel.insertBefore(o,sel.querySelector('option[value="__new"]'));sel.value=f.id;toast('Fornecedor <b>'+esc(f.nome)+'</b> cadastrado');}
function renderFornecedores(){const tb=document.getElementById('tbFornecedores');if(!tb)return;const rows=db.fornecedores||[];
  const rc={'Baixo':'ok','Médio':'warn','Alto':'low'};
  tb.innerHTML=rows.length?rows.map(f=>{
    const compras=(db.compras||[]).filter(c=>c.fornecedorId===f.id||(c.fornecedor&&c.fornecedor.toLowerCase()===f.nome.toLowerCase()));
    const tot=compras.reduce((s,c)=>s+Number(c.valor||0),0);
    const dg=String(f.whats||'').replace(/\D/g,'');
    const wa=dg.length>=10?`<a href="https://wa.me/${dg.length>=12?dg:'55'+dg}" target="_blank" rel="noopener" style="color:var(--ember)">${esc(f.whats)}</a>`:(esc(f.whats)||'—');
    const cont=(f.contatos||[]);
    const contHtml=cont.length?`<div style="font-size:11px;color:var(--warm)">👤 ${esc(cont[0].nome)}${cont[0].cargo?' ('+esc(cont[0].cargo)+')':''}${cont.length>1?' +'+(cont.length-1):''}</div>`:'';
    const sc=scoreFornecedor(f.id);
    const scHtml=sc.resp?`<div style="font-size:11px;color:var(--warm)">📊 ${sc.resp} cotação(ões)${sc.winPct!==null?' · melhor preço em '+sc.winPct+'%':''}${sc.prazoMed!==null?' · prazo ~'+sc.prazoMed+'d':''}</div>`:'';
    return `<tr><td>${esc(f.nome)}${contHtml}${scHtml}${f.endereco?`<div style="font-size:11px;color:var(--warm)">📍 ${esc(f.endereco)}</div>`:''}${f.obs?`<div style="font-size:11px;color:var(--warm)">${esc(f.obs)}</div>`:''}</td><td>${esc(f.categoria)||'—'}</td><td>${f.risco?`<span class="pill ${rc[f.risco]||'warn'}">${esc(f.risco)}</span>`:'—'}</td><td>${wa}</td><td>${compras.length}</td><td class="money">${brl(tot)}</td><td>${rowActions('fornecedor',f.id)}</td></tr>`;
  }).join(''):`<tr><td colspan=7><div class="empty-t">Nenhum fornecedor — importe uma cotação ou cadastre.</div></td></tr>`;}
function quickCliente(sel){const nome=prompt('Nome do cliente:');if(!nome){sel.value='';return;}const whats=prompt('WhatsApp (opcional, só números com DDD):')||'';const c={id:uidGen(),nome,whats,obs:''};db.clientes=db.clientes||[];db.clientes.push(c);cloudSave();const o=document.createElement('option');o.value=c.id;o.textContent=nome;sel.insertBefore(o,sel.querySelector('option[value="__new"]'));sel.value=c.id;toast('Cliente <b>'+esc(nome)+'</b> cadastrado');}
/**
 * As coleções da loja — as seções do site e do app, na ordem em que aparecem.
 *
 * Antes isto era texto livre no produto: "Coleção Areia" e "Colecao Areia"
 * viravam duas seções, e não havia como dizer qual vem primeiro. Virou lista
 * cadastrada porque a vitrine precisa de ordem, e ordem precisa de dado.
 */
function colecoesOrdenadas(){
  return (db.colecoes||[]).slice().sort((a,b)=>(Number(a.ordem)||0)-(Number(b.ordem)||0));
}

function renderColecoes(){
  const box=document.getElementById('colecoesLista');
  if(!box)return;
  const cs=colecoesOrdenadas();
  if(!cs.length){
    box.innerHTML='<div class="hint-box">Nenhuma coleção ainda. Elas viram as seções da loja, no site e no app — e a ordem daqui é a ordem de lá.<div style="margin-top:10px"><button class="btn" onclick="semearColecoes()">Começar com as coleções da Cinérea</button></div></div>';
    return;
  }
  box.innerHTML=`<div class="tablewrap"><table><thead><tr><th>Ordem</th><th>Coleção</th><th>Como aparece na loja</th><th>Peças</th><th></th></tr></thead><tbody>`+
    cs.map(c=>{
      const n=(db.produtos||[]).filter(p=>p.colecao===c.id).length;
      return `<tr><td data-l="Ordem">${Number(c.ordem)||0}</td>
        <td data-l="Coleção"><b>${esc(c.nome)}</b></td>
        <td data-l="Descrição" style="max-width:420px">${esc(c.desc||'—')}</td>
        <td data-l="Peças">${n}</td>
        <td data-l=""><div class="row-actions"><button class="btn2" onclick="openForm('colecao','${c.id}')">Editar</button><button class="btn2" onclick="del('colecao','${c.id}')">Remover</button></div></td></tr>`;
    }).join('')+'</tbody></table></div>';
}

/** As oito coleções que o dono já tinha escrito no protótipo da loja. */
function semearColecoes(){
  if((db.colecoes||[]).length && !confirm('Já existem coleções. Acrescentar as da Cinérea mesmo assim?'))return;
  const base=[
    ['Coleção Areia','Esculturas duráveis que você preenche com areia perfumada. Sem molde, sem cera grudada: monta, acende e repõe. O coração da marca.'],
    ['O Templo Anatômico','Arte para colecionar — anatomia clássica de domínio público, com o peso da dark academia e do gabinete de curiosidades.'],
    ['Ritual & Aura','O universo astral e de bem-estar: sal de aura, cristais e óleos, em objetos feitos para o ritual diário.'],
    ['Velas & Bustos','Bustos e velas de cera tradicional. Alguns recebem areia, outros copo removível — a técnica de cada um está na descrição.'],
    ['Difusão','Aroma sem chama: difusores de varetas, room spray e queimadores de cera.'],
    ['Esculturas & Objetos','Esculturas de gesso puro e o altar de fragrância — presença, sem função de vela.'],
    ['Acessórios','O ritual completo: candelabro, cuidado da vela, porta-incenso e porta-fósforos.'],
    ['Refis & Consumíveis','O motor do negócio: areia perfumada, pavios, sal e óleos. É o que você repõe — e o que traz o cliente de volta.'],
  ];
  db.colecoes=db.colecoes||[];
  base.forEach(([nome,desc],i)=>db.colecoes.push({id:uidGen(),nome,desc,ordem:(i+1)*10}));
  cloudSave();renderColecoes();renderProdutos();avisoCatalogo();
  toast('8 coleções criadas — ajuste a ordem como quiser');
}

/**
 * Assinatura do que o catálogo publicaria AGORA.
 *
 * O app e o site leem `catalogo/{eid}`, que só muda quando alguém clica em
 * publicar. Editar um preço e esquecer de publicar deixa a loja vendendo pelo
 * valor velho — sem nenhum sinal de que isso aconteceu. Comparar esta
 * assinatura com a da última publicação transforma esse silêncio em aviso.
 */
/**
 * O recorte do banner que vai para a loja, ou `null` se não há o que mostrar.
 *
 * VENCIDO NÃO SOBE. Promoção que continua no ar depois de acabar é pior que
 * promoção nenhuma: ou a casa honra o que não queria, ou desmente o próprio
 * site na frente do cliente. A loja confere a data de novo ao desenhar, porque
 * o catálogo publicado hoje continua no ar amanhã.
 */
function bannerPublicavel(){
  const b = db.banner;
  if(!b || b.ativo === 'desligado' || !b.titulo) return null;
  if(b.ate && hoje() > b.ate) return null;
  return {
    titulo: String(b.titulo).slice(0,90),
    texto: String(b.texto||'').slice(0,140),
    cupom: normalizarCupom(b.cupom||''),
    ate: b.ate || '',
    cor: ['brasa','carvão','areia'].includes(b.cor) ? b.cor : 'brasa',
    // Só endereço do nosso Storage, pela mesma razão do logo: sem a trava,
    // alguém aponta a arte para servidor próprio e tem um pixel de
    // rastreamento rodando no domínio da marca.
    ...(/^https:\/\/firebasestorage\.googleapis\.com\//.test(b.imagem||'') ? {imagem:b.imagem} : {}),
  };
}

function renderBanner(){
  const box = document.getElementById('bannerPreview');
  if(!box) return;
  const b = db.banner;
  if(!b || !b.titulo){
    box.innerHTML = '<div class="hint-box">Nenhum banner. Ele aparece no alto da loja, no site, e serve para anunciar frete grátis, um cupom da semana ou uma coleção nova.</div>';
    return;
  }
  const vencido = b.ate && hoje() > b.ate;
  const desligado = b.ativo === 'desligado';
  const situacao = desligado ? '<span class="pill low">desligado</span>'
    : vencido ? '<span class="pill warn">venceu em '+esc(b.ate)+'</span>'
    : '<span class="pill ok">no ar</span>';
  const problema = cupomDoBannerFalha(b);
  box.innerHTML = `<div class="chartcard">
    <h3>${esc(b.titulo)} ${situacao}</h3>
    ${b.texto?`<div class="hint" style="margin-top:6px">${esc(b.texto)}</div>`:''}
    ${b.cupom?`<div class="hint" style="margin-top:6px">Cupom divulgado: <b>${esc(b.cupom)}</b></div>`:''}
    ${b.ate&&!vencido?`<div class="hint" style="margin-top:6px">Sai do ar em ${esc(b.ate)}</div>`:''}
    ${problema?`<div class="hint-box" style="margin-top:10px"><b>O banner promete um desconto que a loja não dá.</b><br>${problema}</div>`:''}
    ${(desligado||vencido)?'<div class="hint-box" style="margin-top:10px">Neste estado ele <b>não sobe</b> quando você publicar a loja, e sai do ar se já estava lá.</div>':''}
  </div>`;
}

/**
 * O banner anuncia um cupom que não vai funcionar? Devolve a explicação.
 *
 * ISTO ACONTECEU DE VERDADE (ago/2026): o banner no ar dizia "Celebre nossa
 * inauguração com 15% OFF!" com o código INAUGURA15, e `cupons/INAUGURA15` não
 * existia. O estrago não é só o desconto que não sai. O banner da loja é
 * CLICÁVEL: tocar nele abre a sacola com o código já preenchido, e a loja
 * responde "não encontrei esse cupom, confira as letras" — culpando o cliente
 * por um código que ele não digitou, na página em que ele ia comprar.
 *
 * A conferência é contra o cadastro DAQUI e não contra o ar, porque salvar
 * cupom já sincroniza sozinho. Divergência entre os dois é assunto do botão
 * "Conferir o que está no ar", na aba de cupons.
 */
function cupomDoBannerFalha(b){
  if(!b || !b.cupom) return '';
  const cod = normalizarCupom(b.cupom);
  if(!cod) return '';
  const c = (db.cupons||[]).find(x => normalizarCupom(x.codigo||'') === cod);
  const nome = `<b>${esc(cod)}</b>`;

  if(!c) return `Não existe cupom ${nome} no seu cadastro. Crie em Vendas → Cupons, ou tire o código do banner.`;
  if(c.ativo === 'desligado' || c.ativo === false)
    return `O cupom ${nome} está desligado, então a loja recusa quem tocar no banner.`;
  if(c.ate && hoje() > c.ate)
    return `O cupom ${nome} venceu em ${esc(c.ate)}, e o banner continua anunciando.`;
  if(c.ate && b.ate && b.ate > c.ate)
    return `O banner fica até ${esc(b.ate)} e o cupom ${nome} vence antes, em ${esc(c.ate)}. Entre as duas datas ele anuncia sozinho.`;
  return '';
}

function assinaturaCatalogo(){
  // O banner entra na assinatura: sem isso, mudar só o banner deixava o aviso
  // de "catálogo desatualizado" calado, e a promoção nunca chegava na loja.
  return JSON.stringify([itensDoCatalogo(), bannerPublicavel()]);
}

/** O recorte público de cada produto marcado para o catálogo. */
function itensDoCatalogo(){
  const ordemCol={}; colecoesOrdenadas().forEach((c,i)=>ordemCol[c.id]=i);
  return db.produtos.filter(p=>p.publico).map(p=>{
    const c=calcCusto(p).total;
    const preco=Number(p.preco)||c*Number(p.markup||3);
    const col=(db.colecoes||[]).find(x=>x.id===p.colecao);
    return{id:p.id,nome:p.nome,preco:Math.round(preco*100)/100,foto:p.foto||'',foto2:p.foto2||'',
      colecao:p.colecao||'', linha:col?col.nome:'', posicao:Number(p.posicao)||10,
      situacao:p.situacao||'disponivel',desc:p.desc||'',longa:p.longa||'',
      // FICHA VAI COMO TEXTO, uma linha por item. O Firestore recusa array
      // dentro de array, e `itens` já é array — então nada aqui dentro pode
      // ser lista. A ficha era array de pares: dois níveis de aninhamento.
      // Mapa preservaria a estrutura, mas o Firestore não garante a ordem das
      // chaves, e ficha técnica fora de ordem não serve. Texto preserva.
      ficha:(p.ficha||[]).map(l=>Array.isArray(l)?l.join(': '):String(l)).join('\n'),
      destaque:!!p.destaque,pronto:Number(p.pronto)||0};
  })
  // Já sai na ordem em que a loja mostra: a vitrine não precisa saber ordenar,
  // e site e app ficam iguais sem combinarem nada entre si.
  .sort((a,b)=>{
    const ca=ordemCol[a.colecao]??999, cb=ordemCol[b.colecao]??999;
    return ca!==cb ? ca-cb : (a.posicao-b.posicao);
  });
}

/** Mostra "há alterações não publicadas" quando a loja está atrasada. */
function avisoCatalogo(){
  const box=document.getElementById('avisoCatalogo');
  if(!box)return;
  const mudou=db.produtos.some(p=>p.publico) && db.catalogoAssinatura!==assinaturaCatalogo();
  box.innerHTML = mudou
    ? '<div class="hint-box" style="border-left-color:var(--ember)">A loja está <b>desatualizada</b>: há mudanças em produtos que ainda não foram publicadas. O app e o site continuam mostrando o que foi publicado da última vez.<div style="margin-top:10px"><button class="btn" onclick="revisarPublicacao()">Revisar e publicar</button></div></div>'
    : (db.catalogoAssinatura ? '<div class="hint">Loja em dia com o cadastro.</div>' : '');
}

/**
 * Envia a vitrine. Só o envio: quem revisa e confirma é `revisarPublicacao`.
 *
 * O erro SOBE em vez de virar toast. Antes ele era engolido aqui e a mensagem
 * na tela era um chute fixo sobre regras do Firestore — o dono foi mexer em
 * regra que estava certa por causa disso.
 */
async function publicarCatalogo(){
  if(!pode('fin'))throw new Error('Sem permissão para publicar');
  if(!eid)throw new Error('Empresa não carregada — recarregue a página');

  // O Firestore recusa `undefined` sem explicar qual campo. Limpar antes.
  const itens=itensDoCatalogo().map(i=>{
    const limpo={}; for(const k in i) if(i[k]!==undefined) limpo[k]=i[k];
    return limpo;
  });
  if(!itens.length)throw new Error('Nenhuma peça marcada para o catálogo');

  await setDoc(doc(fdb,'catalogo',eid),{
    itens,
    colecoes:colecoesOrdenadas().map(c=>({id:c.id||'',nome:c.nome||'',desc:c.desc||''})),
    nome:empresaNome||'Cinérea',
    whats:db.catWhats||'',
    // O banner viaja com o catálogo de propósito: é dado da loja, e um segundo
    // botão de publicar seria mais uma coisa para esquecer de apertar.
    ...(bannerPublicavel() ? {banner:bannerPublicavel()} : {}),
    atualizado:Date.now(),
  });

  db.catalogoAssinatura=assinaturaCatalogo();
  cloudSave();
  toast('Loja publicada — '+itens.length+' peça(s)');
}
function closeModal(){
  if(timerInt){clearInterval(timerInt);timerInt=null;}timerT0=null;
  document.getElementById('overlay').classList.remove('open');
  if(focoAnterior&&focoAnterior.focus){try{focoAnterior.focus();}catch(e){}focoAnterior=null;} // devolve o foco a quem abriu
}
// acessibilidade do modal: foco entra ao abrir, circula com Tab e volta ao fechar
let focoAnterior=null;
const _ov=document.getElementById('overlay');
new MutationObserver(()=>{
  if(!_ov.classList.contains('open'))return;
  focoAnterior=focoAnterior||document.activeElement;
  const alvo=_ov.querySelector('input:not([type=hidden]),select,textarea,button');
  if(alvo&&!_ov.contains(document.activeElement))setTimeout(()=>{try{alvo.focus();}catch(e){}},30);
}).observe(_ov,{attributes:true,attributeFilter:['class']});
_ov.addEventListener('keydown',e=>{
  if(e.key!=='Tab')return;
  const f=[..._ov.querySelectorAll('input:not([type=hidden]),select,textarea,button,a[href]')].filter(el=>el.offsetParent!==null);
  if(!f.length)return;
  const primeiro=f[0],ultimo=f[f.length-1];
  if(e.shiftKey&&document.activeElement===primeiro){e.preventDefault();ultimo.focus();}
  else if(!e.shiftKey&&document.activeElement===ultimo){e.preventDefault();primeiro.focus();}
});
document.getElementById('overlay').onclick=e=>{if(e.target.id==='overlay')closeModal();};

// ---------- exportações ----------
function dl(name,content,mime){const b=new Blob([content],{type:mime});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;a.click();}
function exportCSV(){
  if(!pode('fin')){toast('Sem permissão para dados financeiros');return;}
  let out='';
  const sec=(t,head,rows)=>{out+=t+'\n'+head.join(';')+'\n'+rows.map(r=>r.join(';')).join('\n')+'\n\n';};
  sec('INSUMOS',['Nome','Estoque','Unidade','Mínimo','Custo'],db.insumos.map(i=>[i.nome,i.estoque,i.unidade,i.minimo,i.custo]));
  sec('MOLDES',['Nome','Material','Usos','Vida'],db.moldes.map(m=>[m.nome,m.material,m.usos,m.vida]));
  sec('PRODUTOS',['Nome','Custo','Preço praticado','Prontas'],db.produtos.map(p=>{const c=calcCusto(p).total;return [p.nome,c.toFixed(2),p.preco||'',p.pronto||0];}));
  sec('PRODUÇÃO',['Data','Produto','Variação','Qtd','Min/peça','Lote'],db.producao.map(p=>{const pr=db.produtos.find(x=>x.id===p.produto);return [p.data,pr?pr.nome:'',p.variacao||'',p.qtd,p.minutos,p.lote||''];}));
  sec('PEDIDOS',['Data','Cliente','Item','Qtd','Canal','Prazo','Valor','Lucro','Situação'],db.pedidos.map(p=>{const pr=db.produtos.find(x=>x.id===p.produto);const cli=(db.clientes||[]).find(c=>c.id===p.clienteId);const can=(db.canais||[]).find(c=>c.id===p.canal);const l=lucroPedido(p);return [p.data,cli?cli.nome:(p.cliente||''),pr?pr.nome+(p.variacao?' - '+p.variacao:''):(p.item||''),p.qtd||1,can?can.nome:'',p.prazo||'',p.valor,l===null?'':l.toFixed(2),p.situacao];}));
  sec('COMPRAS',['Data','Insumo','Qtd','Valor pago','Fornecedor'],(db.compras||[]).map(c=>{const i=db.insumos.find(x=>x.id===c.insumo);return [c.data,i?i.nome:'',c.qtd,c.valor,c.fornecedor||''];}));
  sec('CUSTOS FIXOS',['Nome','Valor mensal'],(db.fixos||[]).map(f=>[f.nome,f.valor]));
  sec('CLIENTES',['Nome','WhatsApp','Observações'],(db.clientes||[]).map(c=>[c.nome,c.whats||'',c.obs||'']));
  sec('CANAIS',['Nome','Taxa %'],(db.canais||[]).map(c=>[c.nome,c.taxa||0]));
  sec('TAREFAS',['Tarefa','Responsável','Prazo','Situação'],(db.tarefas||[]).map(t=>[t.titulo,membros[t.resp]?membros[t.resp].nome:'',t.prazo||'',t.status||'aberta']));
  dl('cinerea-dados-'+new Date().toISOString().slice(0,10)+'.csv','\ufeff'+out,'text/csv');
  toast('Planilha exportada');
}
function buyDone(id,sug){openForm('compra');const s=document.getElementById('f_insumo');if(s)s.value=id;const q=document.getElementById('f_qtd');if(q)q.value=sug;const v=document.getElementById('f_valor');if(v)v.focus();}
// ---------- sourcing: cotação em Excel com marcações ocultas ----------
function gerarCotacao(){ // abre a seleção de itens e quantidades
  if(typeof ExcelJS==='undefined'){toast('Preciso de internet para carregar o gerador de planilhas');return;}
  if(!db.insumos.length){toast('Cadastre insumos primeiro');return;}
  currentForm={type:'cotacaoSel',id:null,recipe:[]};window.currentForm=currentForm;
  document.getElementById('modalTitle').textContent='Nova cotação — escolha itens e quantidades';
  const low=new Set(db.insumos.filter(i=>insumoStatus(i)!=='ok').map(i=>i.id));
  document.getElementById('modalBody').innerHTML='<div class="hint-box" style="margin-bottom:14px">Itens da lista de compras já vêm marcados com a quantidade sugerida — ajuste como quiser.</div>'+db.insumos.map(i=>{const sug=Math.round(Math.max(0,(i.minimo||0)*2-i.estoque)*100)/100;return `<div class="recipe-line" style="grid-template-columns:24px 1fr 110px 40px"><input type="checkbox" data-cot="${i.id}" ${low.has(i.id)?'checked':''} style="width:auto"><span>${esc(i.nome)}<div style="font-size:11px;color:var(--warm)">tem ${i.estoque} ${esc(i.unidade)} · mín. ${i.minimo}</div></span><input type="number" step="0.01" min="0" id="cotq_${i.id}" value="${low.has(i.id)?(sug||1):''}" placeholder="qtd"><span style="font-size:11px;color:var(--warm)">${esc(i.unidade)}</span></div>`;}).join('')
    +`<div class="field-row" style="margin-top:16px"><div class="field"><label>Responder até</label><input id="cotValidade" type="date"><div class="hint">Cotações vencidas ficam marcadas</div></div><div class="field"><label>Condições de pagamento</label><input id="cotCond" placeholder="ex.: Pix à vista, 28 dias…"><div class="hint">Vai escrita na planilha</div></div></div>`
    +((db.fornecedores||[]).length?`<div class="field"><label>Enviar para quais fornecedores?</label>${db.fornecedores.map(f=>`<label style="display:flex;gap:8px;align-items:center;padding:4px 0;font-size:13px;text-transform:none;letter-spacing:0;cursor:pointer"><input type="checkbox" data-alvo="${f.id}" style="width:auto"> ${esc(f.nome)}${f.categoria?` <span style="color:var(--warm);font-size:11px">· ${esc(f.categoria)}</span>`:''}</label>`).join('')}</div>`:'');
  document.getElementById('overlay').classList.add('open');
}
async function logoB64(){try{const r=await fetch('icon-192.png');if(!r.ok)return null;const b=await r.arrayBuffer();let s='';new Uint8Array(b).forEach(x=>s+=String.fromCharCode(x));return btoa(s);}catch(e){return null;}}
async function gerarCotacaoXlsx(itens,extras){
  extras=extras||{};
  const id=uidGen().toUpperCase();
  const C={paper:'FFF2EFEA',ash:'FFE7E3DC',char:'FF1C1A17',ember:'FFB5462A',smoke:'FF6E6862',line:'FFD8D2C8',warm:'FF8A7E70',edit:'FFFBF3E0'};
  const wb=new ExcelJS.Workbook();
  wb.creator=empresaNome||'Cinérea';
  const ws=wb.addWorksheet('Cotação',{views:[{showGridLines:false}]});
  ws.columns=[{width:36},{width:11},{width:13},{width:19},{width:21},{width:34},{width:2},{width:2}];
  // cabeçalho com a marca
  ws.mergeCells('A1:F2');
  const t=ws.getCell('A1');
  t.value=(empresaNome||'Cinérea').toUpperCase()+'   ·   COTAÇÃO DE PREÇOS';
  t.font={bold:true,size:15,color:{argb:C.char}};
  t.alignment={vertical:'middle',horizontal:'left',indent:10};
  ['A1','B1','C1','D1','E1','F1'].forEach(a=>ws.getCell(a).fill={type:'pattern',pattern:'solid',fgColor:{argb:C.paper}});
  ws.getCell('H1').value='CINEREA-RFQ:'+id; // marcação oculta que liga a resposta a esta cotação
  ws.mergeCells('A3:F3');
  const s3=ws.getCell('A3');
  s3.value='Preencha apenas as células destacadas — Preço, Prazo e Observações — e devolva este arquivo. O restante está protegido.'
    +(extras.validade?'  ·  Responder até '+extras.validade.split('-').reverse().join('/')+'.':'')
    +(extras.cond?'  ·  Condições: '+extras.cond+'.':'');
  s3.font={italic:true,size:10,color:{argb:C.smoke}};
  // cabeçalho da tabela
  const head=['Item','Unidade','Quantidade','Preço unitário (R$)','Prazo de entrega (dias)','Observações'];
  const hr=ws.getRow(4);hr.height=22;
  head.forEach((h,i)=>{const c=hr.getCell(i+1);c.value=h;c.font={bold:true,size:10,color:{argb:C.warm}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:C.ash}};c.border={bottom:{style:'medium',color:{argb:C.ember}}};c.alignment={vertical:'middle'};});
  // itens: colunas A-C travadas, D-F liberadas e destacadas
  itens.forEach((it,ix)=>{
    const ins=db.insumos.find(x=>x.id===it.insumo);
    const r=ws.getRow(5+ix);r.height=20;
    r.getCell(1).value=ins.nome;r.getCell(2).value=ins.unidade;r.getCell(3).value=it.qtd;
    [1,2,3].forEach(ci=>{const c=r.getCell(ci);c.font={size:11,color:{argb:C.char}};c.border={bottom:{style:'thin',color:{argb:C.line}}};});
    [4,5,6].forEach(ci=>{const c=r.getCell(ci);c.protection={locked:false};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:C.edit}};c.border={top:{style:'thin',color:{argb:C.line}},bottom:{style:'thin',color:{argb:C.line}},left:{style:'thin',color:{argb:C.line}},right:{style:'thin',color:{argb:C.line}}};});
    r.getCell(4).numFmt='#,##0.00';
    r.getCell(8).value=ins.id; // id oculto do insumo
  });
  ws.getColumn(7).hidden=true;ws.getColumn(8).hidden=true;
  const b64=await logoB64();
  if(b64){const img=wb.addImage({base64:b64,extension:'png'});ws.addImage(img,{tl:{col:0.12,row:0.12},ext:{width:48,height:48}});}
  await ws.protect('cinerea',{selectLockedCells:true,selectUnlockedCells:true});
  // aba de contato
  const wc=wb.addWorksheet('Contato',{views:[{showGridLines:false}]});
  wc.columns=[{width:24},{width:50}];
  wc.mergeCells('A1:B1');
  const ct=wc.getCell('A1');ct.value='Como falar com a gente';ct.font={bold:true,size:14,color:{argb:C.char}};
  const info=[['Empresa',empresaNome||'Cinérea'],['Responsável',(membros[uid]||{}).nome||''],['WhatsApp',db.catWhats||''],['E-mail',(auth.currentUser&&auth.currentUser.email)||''],['Endereço',db.endereco||''],['Como devolver','Responda a mensagem/e-mail anexando este mesmo arquivo preenchido.']];
  info.filter(([,v])=>v).forEach(([k,v],i)=>{const r=wc.getRow(3+i);r.getCell(1).value=k;r.getCell(1).font={bold:true,size:10,color:{argb:C.warm}};r.getCell(2).value=v;r.getCell(2).font={size:11,color:{argb:C.char}};r.getCell(1).border={bottom:{style:'thin',color:{argb:C.line}}};r.getCell(2).border={bottom:{style:'thin',color:{argb:C.line}}};});
  await wc.protect('cinerea',{selectLockedCells:true,selectUnlockedCells:true});
  const buf=await wb.xlsx.writeBuffer();
  const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='cotacao-'+id+'.xlsx';a.click();
  db.cotacoes=db.cotacoes||[];db.cotacoes.push({id,data:hoje(),itens,respostas:[],por:uid,validade:extras.validade||'',cond:extras.cond||'',alvos:extras.alvos||[]});
  logAtv('gerou a cotação '+id+' com '+itens.length+' itens');
  cloudSave();renderCotacoes();
  toast('Planilha <b>cotacao-'+id+'.xlsx</b> baixada — bloqueada, só as células de preço/prazo/observações editáveis');
}
function importarCotacao(){
  if(typeof XLSX==='undefined'){toast('Preciso de internet para ler planilhas');return;}
  const inp=document.createElement('input');inp.type='file';inp.accept='.xlsx,.xls';
  inp.onchange=()=>{const f=inp.files[0];if(!f)return;const r=new FileReader();
    r.onload=()=>{try{
      const wb=XLSX.read(r.result,{type:'array'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:true});
      const marker=String((rows[0]||[])[7]||'');
      if(!marker.startsWith('CINEREA-RFQ:')){toast('Esta planilha não é uma cotação gerada pelo app');return;}
      const cotId=marker.slice(12);
      const cot=(db.cotacoes||[]).find(c=>c.id===cotId);
      if(!cot){toast('Cotação '+esc(cotId)+' não encontrada — foi excluída?');return;}
      const precos={};let n=0;
      rows.slice(3).forEach(row=>{const insId=row[7];if(!insId)return;const preco=Number(String(row[3]??'').replace(',','.'));if(!isFinite(preco)||preco<=0)return;precos[insId]={preco,prazo:row[4]!==undefined&&row[4]!==''?String(row[4]):'',obs:row[5]!==undefined?String(row[5]):''};n++;});
      if(!n){toast('Nenhum preço preenchido na coluna D');return;}
      const fornecedor=prompt('Nome do fornecedor desta resposta:','');if(fornecedor===null)return;
      const nomeF=fornecedor.trim()||('Fornecedor '+((cot.respostas||[]).length+1));
      // liga (ou cria) o cadastro do fornecedor automaticamente
      db.fornecedores=db.fornecedores||[];
      let fcad=db.fornecedores.find(x=>x.nome.toLowerCase()===nomeF.toLowerCase());
      if(!fcad){fcad={id:uidGen(),nome:nomeF,whats:'',obs:''};db.fornecedores.push(fcad);}
      cot.respostas=cot.respostas||[];
      cot.respostas.push({fornecedor:nomeF,fornecedorId:fcad.id,data:hoje(),precos,por:uid});
      logAtv('importou resposta de cotação de '+(fornecedor.trim()||'fornecedor'));
      cloudSave();renderCotacoes();
      toast(n+' preço(s) importado(s) de <b>'+esc(fornecedor.trim()||'fornecedor')+'</b>');
    }catch(e){console.error(e);toast('Não consegui ler esta planilha');}};
    r.readAsArrayBuffer(f);};
  inp.click();
}
function renderCotacoes(){const tb=document.getElementById('tbCotacoes');if(!tb)return;const rows=[...(db.cotacoes||[])].reverse();const hj=hoje();
  tb.innerHTML=rows.length?rows.map(c=>{
    const nResp=(c.respostas||[]).length,nAlvo=(c.alvos||[]).length;
    const vencida=c.validade&&c.validade<hj&&(!nResp||(nAlvo&&nResp<nAlvo));
    let st;
    if(vencida)st='<span class="pill low">vencida'+(nResp?` · ${nResp}${nAlvo?'/'+nAlvo:''}`:'')+'</span>';
    else if(nAlvo&&nResp>=nAlvo)st=`<span class="pill ok">completa ${nResp}/${nAlvo}</span>`;
    else if(nResp)st=`<span class="pill ${nAlvo?'warn':'ok'}">${nResp}${nAlvo?'/'+nAlvo:''} resposta(s)</span>`;
    else st='<span class="pill warn">aguardando'+(c.validade?' · até '+esc(c.validade.slice(5)):'')+'</span>';
    const alvosNomes=(c.alvos||[]).map(a=>{const f=(db.fornecedores||[]).find(x=>x.id===a);return f?f.nome:'';}).filter(Boolean);
    const pendComWhats=(c.alvos||[]).map(a=>(db.fornecedores||[]).find(x=>x.id===a)).filter(f=>f&&String(f.whats||'').replace(/\D/g,'').length>=10&&!(c.respostas||[]).some(r=>r.fornecedorId===f.id));
    const online=c.rfqToken?(c.rfqFechada?'<div style="font-size:11px;color:var(--warm)">🌐 portal encerrado</div>':'<div style="font-size:11px;color:var(--ok)">🌐 aberto no portal</div>'):'';
    return `<tr><td style="font-family:monospace">${esc(c.id)}${alvosNomes.length?`<div style="font-size:11px;color:var(--warm)">→ ${esc(alvosNomes.join(', '))}</div>`:''}${c.cond?`<div style="font-size:11px;color:var(--warm)">${esc(c.cond)}</div>`:''}${online}</td><td>${esc(c.data)}</td><td>${c.itens.length}</td><td>${st}</td><td><div class="row-actions"><button class="icon-btn" title="${c.rfqToken?'Copiar link do portal':'Publicar cotação online'}" onclick="linkCotacao('${c.id}')">🌐</button>${c.rfqToken?`<button class="icon-btn" title="Buscar respostas enviadas pelo portal" onclick="buscarRespostasOnline('${c.id}')">⬇</button>`:''}${c.rfqToken&&!c.rfqFechada?`<button class="icon-btn" title="Encerrar cotação online" onclick="fecharRfq('${c.id}')">🔒</button>`:''}${pendComWhats.length?`<button class="icon-btn" title="Enviar/cobrar no WhatsApp" onclick="enviarCotacaoWhats('${c.id}')">💬</button>`:''}${nResp?`<button class="icon-btn" title="Comparar preços" onclick="verCotacao('${c.id}')">⇄</button>`:''}<button class="icon-btn" onclick="del('cotacao','${c.id}')">${ico("lixeira","Apagar")}</button></div></td></tr>`;
  }).join(''):`<tr><td colspan=5><div class="empty-t">Nenhuma cotação — gere uma a partir da lista de compras.</div></td></tr>`;
  // gasto com compras por mês
  if(typeof Chart!=='undefined'&&document.getElementById('chCompras')){
    const byMes={};(db.compras||[]).forEach(c=>{const m=(c.data||'').slice(0,7);if(m)byMes[m]=(byMes[m]||0)+Number(c.valor||0);});
    const meses=Object.keys(byMes).sort();
    const css=getComputedStyle(document.documentElement);const cv=(n,fb)=>((css.getPropertyValue(n)||'').trim()||fb);
    mkChart('chCompras',{type:'bar',data:{labels:meses,datasets:[{data:meses.map(m=>byMes[m].toFixed(2)),backgroundColor:cv('--warm','#8A7E70'),borderRadius:4}]},options:{plugins:{legend:{display:false}},scales:{y:{ticks:{color:cv('--smoke','#6E6862')}},x:{grid:{display:false},ticks:{color:cv('--smoke','#6E6862')}}}}});
  }
}
// ---------- portal do fornecedor ----------
// Publica a cotação numa página onde o fornecedor preenche os preços online.
// O Excel continua funcionando para quem prefere — os dois caminhos convergem
// para a mesma lista de respostas.
async function publicarRfq(cotId){
  const c=(db.cotacoes||[]).find(x=>x.id===cotId);if(!c)return null;
  if(!c.rfqToken)c.rfqToken=uidGen()+uidGen().slice(0,4);
  await setDoc(doc(fdb,'rfq',c.rfqToken),{
    empresaId:eid,empresa:empresaNome||'Cinérea',cotacao:c.id,
    validade:c.validade||'',cond:c.cond||'',fechada:false,
    itens:c.itens.map(it=>{const ins=db.insumos.find(x=>x.id===it.insumo);return{insumo:it.insumo,nome:ins?ins.nome:'item',unidade:ins?ins.unidade:'',qtd:it.qtd};}),
    atualizado:Date.now(),
  });
  cloudSave();
  return location.origin+location.pathname.replace(/index\.html$/,'')+'cotacao.html?c='+c.rfqToken;
}
async function linkCotacao(cotId){
  try{
    const url=await publicarRfq(cotId);
    if(!url)return;
    if(navigator.clipboard)navigator.clipboard.writeText(url).catch(()=>{});
    toast('Link da cotação copiado — mande ao fornecedor. Ele preenche online e você importa com o ↓');
    renderCotacoes();
  }catch(e){console.error(e);toast('Erro ao publicar — confira as regras do Firestore');}
}
async function buscarRespostasOnline(cotId){
  const c=(db.cotacoes||[]).find(x=>x.id===cotId);
  if(!c||!c.rfqToken){toast('Publique o link online primeiro (🌐)');return;}
  try{
    const qs=await getDocs(collection(fdb,'rfq',c.rfqToken,'respostas'));
    let novas=0;
    c.respostas=c.respostas||[];c.rfqLidas=c.rfqLidas||[];
    qs.forEach(d=>{
      if(c.rfqLidas.includes(d.id))return;             // já importada
      const r=d.data();
      if(!r||!r.precos||!Object.keys(r.precos).length)return;
      const nome=String(r.fornecedor||'Fornecedor').slice(0,120);
      db.fornecedores=db.fornecedores||[];
      let f=db.fornecedores.find(x=>x.nome.toLowerCase()===nome.toLowerCase());
      if(!f){f={id:uidGen(),nome,whats:'',obs:'',contatos:[]};db.fornecedores.push(f);}
      c.respostas.push({fornecedor:nome,fornecedorId:f.id,data:hoje(),precos:r.precos,online:true});
      c.rfqLidas.push(d.id);novas++;
    });
    if(!novas){toast('Nenhuma resposta nova por enquanto');return;}
    logAtv('importou '+novas+' resposta(s) online da cotação '+c.id);
    cloudSave();renderAll();
    toast('<b>'+novas+'</b> resposta(s) importada(s) do portal');
  }catch(e){console.error(e);toast('Erro ao buscar respostas — confira as regras do Firestore');}
}
async function fecharRfq(cotId){
  const c=(db.cotacoes||[]).find(x=>x.id===cotId);
  if(!c||!c.rfqToken)return;
  if(!confirm('Encerrar a cotação online? O link para de aceitar propostas.'))return;
  try{await setDoc(doc(fdb,'rfq',c.rfqToken),{fechada:true},{merge:true});c.rfqFechada=true;cloudSave();renderCotacoes();toast('Cotação online encerrada');}
  catch(e){console.error(e);toast('Erro ao encerrar');}
}
function enviarCotacaoWhats(cotId){
  const c=(db.cotacoes||[]).find(x=>x.id===cotId);if(!c)return;
  let pend=(c.alvos||[]).map(a=>(db.fornecedores||[]).find(x=>x.id===a)).filter(f=>f&&String(f.whats||'').replace(/\D/g,'').length>=10&&!(c.respostas||[]).some(r=>r.fornecedorId===f.id));
  if(!pend.length){toast('Nenhum fornecedor pendente com WhatsApp');return;}
  c.enviados=c.enviados||[];
  let fila=pend.filter(f=>!c.enviados.includes(f.id));
  if(!fila.length){c.enviados=[];fila=pend;} // todos já receberam: recomeça (cobrança)
  const f=fila[0];c.enviados.push(f.id);cloudSave();
  const dg=String(f.whats).replace(/\D/g,'');
  const link=c.rfqToken?location.origin+location.pathname.replace(/index\.html$/,'')+'cotacao.html?c='+c.rfqToken:'';
  const msg=`Olá${(f.contatos||[])[0]?', '+f.contatos[0].nome.split(' ')[0]:''}! Aqui é da ${empresaNome||'Cinérea'}. Estou enviando nossa cotação ${c.id} (${c.itens.length} itens${c.validade?', responder até '+c.validade.split('-').reverse().join('/'):''}${c.cond?', condições: '+c.cond:''}). `
    +(link?`Você pode preencher direto por aqui: ${link} — ou me pedir a planilha, como preferir. Obrigado!`
          :`Vou anexar a planilha aqui — é só preencher as células destacadas e devolver o arquivo. Obrigado!`);
  window.open('https://wa.me/'+(dg.length>=12?dg:'55'+dg)+'?text='+encodeURIComponent(msg),'_blank');
  if(fila.length>1)toast('Aberto para <b>'+esc(f.nome)+'</b> — toque de novo para o próximo ('+(fila.length-1)+' na fila)');
}
function verCotacao(id){
  const c=(db.cotacoes||[]).find(x=>x.id===id);if(!c)return;
  currentForm={type:'cotacaoView',id:null,recipe:[]};window.currentForm=currentForm;
  document.getElementById('modalTitle').textContent='Cotação '+c.id+' — comparação';
  const forn=c.respostas||[];
  const totais=forn.map(f=>c.itens.reduce((s,it)=>{const p=f.precos[it.insumo];return s+(p?p.preco*it.qtd:Infinity);},0));
  const minTotal=Math.min(...totais);
  // cesta ótima: melhor preço de cada item, e custo atual como referência de savings
  let cestaOtima=0,custoAtual=0,temAtual=false;
  c.itens.forEach(it=>{const ins=db.insumos.find(x=>x.id===it.insumo);const ps=forn.map(f=>f.precos[it.insumo]?f.precos[it.insumo].preco:null).filter(p=>p!==null);if(ps.length)cestaOtima+=Math.min(...ps)*it.qtd;if(ins&&Number(ins.custo)>0){custoAtual+=Number(ins.custo)*it.qtd;temAtual=true;}});
  let html=(c.validade||c.cond?`<div class="hint-box" style="margin-bottom:12px">${c.validade?'Responder até <b>'+esc(c.validade)+'</b>':''}${c.validade&&c.cond?' · ':''}${c.cond?'Condições: <b>'+esc(c.cond)+'</b>':''}</div>`:'');
  html+='<div class="tablewrap"><table><thead><tr><th>Item</th><th>Qtd</th><th>Seu custo</th>'+forn.map(f=>'<th>'+esc(f.fornecedor)+'</th>').join('')+'</tr></thead><tbody>';
  c.itens.forEach(it=>{const ins=db.insumos.find(x=>x.id===it.insumo);const ps=forn.map(f=>f.precos[it.insumo]?f.precos[it.insumo].preco:null);const valid=ps.filter(p=>p!==null);const min=valid.length?Math.min(...valid):null;
    const atual=ins&&Number(ins.custo)>0?Number(ins.custo):null;
    const sav=atual&&min!==null?Math.round((1-min/atual)*100):null;
    html+='<tr><td>'+esc(ins?ins.nome:'?')+'</td><td>'+it.qtd+'</td><td style="color:var(--smoke)">'+(atual?brl(atual)+(sav!==null?` <span style="font-size:11px;color:${sav>=0?'var(--ok)':'var(--ember)'}">(${sav>=0?'−':'+'}${Math.abs(sav)}%)</span>`:''):'—')+'</td>'+ps.map((p,fi)=>'<td>'+(p===null?'—':(p===min?`<span class="pill ok">${brl(p)}</span>`:brl(p))+` <button class="icon-btn" title="Registrar compra com este preço" onclick="usarPrecoCotacao('${c.id}',${fi},'${it.insumo}')">🛒</button>`)+'</td>').join('')+'</tr>';});
  html+='<tr><td style="font-weight:600">Total do pedido</td><td></td><td style="color:var(--smoke)">'+(temAtual?brl(custoAtual):'—')+'</td>'+totais.map(t=>'<td class="money" style="'+(t===minTotal&&isFinite(t)?'color:var(--ok);font-weight:600':'')+'">'+(isFinite(t)?brl(t):'—')+'</td>').join('')+'</tr>';
  html+=`<tr><td style="font-weight:600;color:var(--ember)">Cesta ótima (melhor de cada)</td><td></td><td colspan="${forn.length+1}" class="money" style="color:var(--ember);font-weight:600">${brl(cestaOtima)}${temAtual&&custoAtual>0?` <span style="font-size:12px">· economia de ${brl(Math.max(0,custoAtual-cestaOtima))} vs seu custo atual</span>`:''}</td></tr>`;
  html+='</tbody></table></div><div class="hint" style="margin-top:10px">Verde = melhor preço · "Seu custo" = custo médio atual do insumo · 🛒 registra a compra já preenchida.</div>';
  html+=`<button class="btn2" style="width:100%;margin-top:12px" onclick="imprimirCotacao('${c.id}')">🖨 Imprimir / salvar comparação em PDF</button>`;
  document.getElementById('modalBody').innerHTML=html;
  document.getElementById('overlay').classList.add('open');
}
function imprimirCotacao(id){
  const c=(db.cotacoes||[]).find(x=>x.id===id);if(!c)return;
  const forn=c.respostas||[];
  const row=a=>'<tr>'+a.map(x=>`<td>${x}</td>`).join('')+'</tr>';
  const win=window.open('','_blank');
  win.document.write(`<html><head><title>Cotação ${c.id} — ${esc(empresaNome||'Cinérea')}</title><style>body{font-family:Georgia,serif;color:#1C1A17;padding:40px;max-width:800px;margin:auto}h1{font-size:24px;font-weight:400}table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px}td,th{border:1px solid #ccc;padding:7px 10px;text-align:left}th{background:#E7E3DC}.b{color:#3F7D5B;font-weight:bold}</style></head><body>
  <h1>${esc(empresaNome||'Cinérea')} — Cotação ${c.id}</h1><p>${esc(c.data)}${c.validade?' · válida até '+esc(c.validade):''}${c.cond?' · '+esc(c.cond):''}</p>
  <table><tr><th>Item</th><th>Qtd</th>${forn.map(f=>'<th>'+esc(f.fornecedor)+'</th>').join('')}</tr>
  ${c.itens.map(it=>{const ins=db.insumos.find(x=>x.id===it.insumo);const ps=forn.map(f=>f.precos[it.insumo]?f.precos[it.insumo].preco:null);const valid=ps.filter(p=>p!==null);const min=valid.length?Math.min(...valid):null;return row([esc(ins?ins.nome:'?'),it.qtd,...ps.map(p=>p===null?'—':(p===min?`<span class="b">${brl(p)}</span>`:brl(p)))]);}).join('')}
  </table><p style="margin-top:30px;color:#999;font-size:11px">Gerado pelo sistema de gestão — ${new Date().toLocaleDateString('pt-BR')}</p></body></html>`);
  win.document.close();setTimeout(()=>win.print(),400);
}
function usarPrecoCotacao(cotId,fi,insId){
  const c=(db.cotacoes||[]).find(x=>x.id===cotId);if(!c)return;
  const f=(c.respostas||[])[fi];if(!f||!f.precos[insId])return;
  const it=c.itens.find(x=>x.insumo===insId)||{qtd:1};
  closeModal();openForm('compra');
  const g=id=>document.getElementById(id);
  if(g('f_insumo'))g('f_insumo').value=insId;
  if(g('f_qtd'))g('f_qtd').value=it.qtd;
  if(g('f_valor'))g('f_valor').value=Math.round(f.precos[insId].preco*it.qtd*100)/100;
  if(g('f_fornecedorId')&&f.fornecedorId)g('f_fornecedorId').value=f.fornecedorId;
  toast('Compra pré-preenchida com o preço de <b>'+esc(f.fornecedor)+'</b> — confira e salve');
}
// histórico de preços de um insumo (compras pagas + cotações recebidas)
function verPrecos(insId){
  const ins=db.insumos.find(x=>x.id===insId);if(!ins)return;
  currentForm={type:'cotacaoView',id:null,recipe:[]};window.currentForm=currentForm;
  document.getElementById('modalTitle').textContent='Preços — '+ins.nome;
  const compras=(db.compras||[]).filter(c=>c.insumo===insId&&Number(c.qtd)>0&&Number(c.valor)>0).map(c=>({d:c.data||'',v:Number(c.valor)/Number(c.qtd)}));
  const cots=[];(db.cotacoes||[]).forEach(ct=>(ct.respostas||[]).forEach(r=>{if(r.precos[insId])cots.push({d:r.data||'',v:r.precos[insId].preco,f:r.fornecedor});}));
  if(!compras.length&&!cots.length){toast('Ainda não há preços registrados para '+esc(ins.nome));return;}
  document.getElementById('modalBody').innerHTML=`<div class="hint-box">Custo médio atual: <b>${brl(ins.custo)}/${esc(ins.unidade)}</b></div><canvas id="chPrecoIns" style="max-height:260px"></canvas>`;
  document.getElementById('overlay').classList.add('open');
  const labels=[...new Set([...compras.map(c=>c.d),...cots.map(c=>c.d)])].sort();
  const serie=(pts)=>labels.map(l=>{const p=pts.filter(x=>x.d===l);return p.length?Math.round(p.reduce((s,x)=>s+x.v,0)/p.length*100)/100:null;});
  const css=getComputedStyle(document.documentElement);const cv=(n,fb)=>((css.getPropertyValue(n)||'').trim()||fb);
  mkChart('chPrecoIns',{type:'line',data:{labels,datasets:[{label:'Pago (compras)',data:serie(compras),borderColor:cv('--ember','#B5462A'),spanGaps:true,tension:.2},{label:'Cotado (fornecedores)',data:serie(cots),borderColor:cv('--smoke','#6E6862'),borderDash:[5,4],spanGaps:true,tension:.2}]},options:{plugins:{legend:{position:'bottom',labels:{color:cv('--smoke','#6E6862'),boxWidth:12,font:{family:'Inter',size:11}}}},scales:{y:{ticks:{color:cv('--smoke','#6E6862')}},x:{ticks:{color:cv('--smoke','#6E6862')}}}}});
}
function exportJSON(){if(!pode('fin')){toast('Sem permissão para dados financeiros');return;}dl('cinerea-backup-'+hoje()+'.json',JSON.stringify(db,null,2),'application/json');toast('Backup salvo — guarde este arquivo');}
function importJSON(){
  if(!pode('gerir')){toast('Só dono e admin restauram backups');return;}const inp=document.createElement('input');inp.type='file';inp.accept='.json,application/json';inp.onchange=()=>{const f=inp.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{const d=JSON.parse(r.result);if(!d||typeof d!=='object'||!Array.isArray(d.insumos))throw 0;if(!confirm('Substituir TODOS os dados atuais pelos do arquivo de backup?'))return;db={acessos:[],equip:[],moldes:[],insumos:[],produtos:[],producao:[],pedidos:[],compras:[],fixos:[],clientes:[],canais:[],tarefas:[],cotacoes:[],fornecedores:[],atividade:[],vendedores:[],cupons:[],meta:0,checks:{},...d};cloudSave();renderAll();toast('Dados restaurados do backup');}catch(e){toast('Arquivo inválido — use um backup gerado pelo app');}};r.readAsText(f);};inp.click();}
function exportCompras(){
  const low=db.insumos.filter(i=>insumoStatus(i)!=='ok');
  if(!low.length){toast('Nada para comprar');return;}
  const txt='LISTA DE COMPRAS · Cinérea\n'+new Date().toLocaleDateString('pt-BR')+'\n\n'+low.map(i=>{const comprar=Math.max(0,(i.minimo*2-i.estoque));return `• ${i.nome}: comprar ${comprar.toFixed(comprar%1?2:0)} ${i.unidade} (tem ${i.estoque})`;}).join('\n');
  navigator.clipboard?.writeText(txt).then(()=>toast('Lista copiada — cole no WhatsApp'),()=>dl('lista-compras.txt',txt,'text/plain'));
}
function exportPDF(){
  if(!pode('fin')){toast('Sem permissão para dados financeiros');return;}
  const receita=db.pedidos.filter(p=>p.situacao==='Pago'||p.situacao==='Entregue').reduce((s,p)=>s+Number(p.valor||0),0);
  const win=window.open('','_blank');
  const row=(a)=>'<tr>'+a.map(x=>`<td>${x}</td>`).join('')+'</tr>';
  win.document.write(`<html><head><title>Cinérea — Relatório</title><style>body{font-family:Georgia,serif;color:#1C1A17;padding:40px;max-width:800px;margin:auto}h1{font-size:32px}h2{border-bottom:2px solid #B5462A;padding-bottom:6px;margin-top:32px;font-size:20px}table{width:100%;border-collapse:collapse;margin-top:10px;font-size:13px}td,th{border:1px solid #ccc;padding:7px 10px;text-align:left}th{background:#eee}.big{font-size:22px;color:#B5462A}</style></head><body>
  <h1>Cinérea — Relatório</h1><p>${new Date().toLocaleDateString('pt-BR')}</p>
  <p class="big">Receita registrada: ${brl(receita)} · Peças produzidas: ${db.producao.reduce((s,p)=>s+Number(p.qtd||0),0)}</p>
  <h2>Produtos e custos</h2><table><tr><th>Produto</th><th>Custo</th><th>Preço</th><th>Margem</th><th>Prontas</th></tr>${db.produtos.map(p=>{const c=calcCusto(p).total;const sug=c*Number(p.markup||3);const prat=Number(p.preco||sug);const taxa=prat*Number(p.taxa||0)/100;const m=prat?Math.round((prat-taxa-c)/prat*100):0;return row([p.nome,brl(c),brl(prat),m+'%',p.pronto||0]);}).join('')}</table>
  <h2>Insumos em estoque</h2><table><tr><th>Insumo</th><th>Estoque</th><th>Mínimo</th><th>Situação</th></tr>${db.insumos.map(i=>row([i.nome,i.estoque+' '+i.unidade,i.minimo,insumoStatus(i)==='low'?'REPOR':insumoStatus(i)==='warn'?'baixo':'ok'])).join('')}</table>
  <h2>Moldes</h2><table><tr><th>Molde</th><th>Usos</th><th>Vida</th></tr>${db.moldes.map(m=>row([m.nome,m.usos,m.vida])).join('')}</table>
  <p style="margin-top:40px;color:#999;font-size:11px">Gerado pelo sistema de gestão Cinérea</p>
  </body></html>`);
  win.document.close();setTimeout(()=>win.print(),400);
}

// ---------- PWA, aviso de atualização e indicador online/offline ----------
window.addEventListener('online',()=>flashSync(true));
window.addEventListener('offline',()=>flashSync(true));
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('./sw.js').then(reg=>{
    reg.addEventListener('updatefound',()=>{
      const nw=reg.installing;if(!nw)return;
      nw.addEventListener('statechange',()=>{
        if(nw.state==='installed'&&navigator.serviceWorker.controller){
          window.__aplicarUpdate=()=>nw.postMessage({type:'SKIP_WAITING'});
          const t=document.getElementById('toast');
          t.innerHTML='Nova versão disponível <button onclick="window.__aplicarUpdate()" style="background:none;border:none;color:#e8a;text-decoration:underline;cursor:pointer;font-size:13px;margin-left:6px">Atualizar agora</button>';
          t.classList.add('show');clearTimeout(toastTimer); // fica até o usuário decidir
        }
      });
    });
  }).catch(()=>{});
  navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload());
}

// ============================================================
// GERADOR DE POST
// Monta a imagem do Instagram a partir das peças já cadastradas, para não
// redigitar nome, preço e foto que o sistema já sabe.
// ============================================================

let poFoto='';   // data URI (upload) ou URL (cadastro/colada)

/** Preenche o seletor de peças. Chamado pelo renderAll. */
function renderPostProdutos(){
  const sel=document.getElementById('po_produto');
  if(!sel)return;
  const atual=sel.value;
  const itens=(db.produtos||[]).slice().sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR'));
  sel.innerHTML='<option value="">— escrever do zero —</option>'+
    itens.map(p=>`<option value="${esc(p.id)}">${esc(p.nome||'sem nome')}</option>`).join('');
  if(atual)sel.value=atual;
}

function postDoProduto(id){
  if(!id){postSync();return;}
  const p=(db.produtos||[]).find(x=>String(x.id)===String(id));
  if(!p)return;
  const custo=calcCusto(p).total;
  const preco=Number(p.preco)||custo*Number(p.markup||3);
  document.getElementById('po_title').value=p.nome||'';
  document.getElementById('po_price').value=preco?brl(Math.round(preco*100)/100):'';
  if(p.foto){document.getElementById('po_fotourl').value=p.foto;postFotoUrl(p.foto);}
  postSync();
}

function postFotoUrl(url){
  poFoto=(url||'').trim();
  document.getElementById('po_photo').style.backgroundImage=poFoto?`url("${poFoto}")`:'';
  // Imagem de outro domínio pode "sujar" o canvas e impedir o download. Só
  // descobrimos na hora de exportar, então o aviso fica preparado ali.
  document.getElementById('po_fotohint').textContent = poFoto && !poFoto.startsWith('data:')
    ? 'Foto por link: se o download falhar, envie o arquivo do computador.'
    : 'Foto real da peça vende mais que conceito.';
}

function postRatio(r,btn){
  btn.parentElement.querySelectorAll('button').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  document.getElementById('po_post').classList.toggle('r45',r==='45');
}

function postMood(m,btn){
  btn.parentElement.querySelectorAll('button').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  const el=document.getElementById('po_post');
  el.classList.remove('lt','dk');el.classList.add(m);
}

function postToggle(t,btn){
  btn.classList.toggle('on');
  const on=btn.classList.contains('on');
  if(t==='mark')document.getElementById('po_topmark').classList.toggle('hide',!on);
  if(t==='frame')document.getElementById('po_frame').classList.toggle('nf',!on);
}

/** *palavra* vira itálico — escapando antes, para o texto não injetar HTML. */
function postItalico(s){
  return esc(s).replace(/\*(.+?)\*/g,'<span class="it">$1</span>');
}

function postSync(){
  const v=id=>(document.getElementById(id)||{}).value||'';
  document.getElementById('po_peyebrow').textContent=v('po_eyebrow');
  document.getElementById('po_ptitle').innerHTML=postItalico(v('po_title'));
  const sub=v('po_subtitle'),pr=v('po_price'),bd=v('po_badge');
  const elSub=document.getElementById('po_psubtitle');elSub.textContent=sub;elSub.style.display=sub?'block':'none';
  const elPr=document.getElementById('po_pprice');elPr.textContent=pr;elPr.style.display=pr?'block':'none';
  const elBd=document.getElementById('po_badgeel');elBd.textContent=bd;elBd.classList.toggle('hide',!bd);
  postLegenda();
}

function postLegenda(){
  const v=id=>(document.getElementById(id)||{}).value||'';
  const t=v('po_title').replace(/\*/g,''),e=v('po_eyebrow'),s=v('po_subtitle'),pr=v('po_price');
  let c=t?(e?`${t} — ${e}.\n\n`:`${t}.\n\n`):'';
  if(s)c+=s.charAt(0).toUpperCase()+s.slice(1)+'.\n\n';
  c+='Feito à mão em Campos do Jordão. Cada peça é única.\n';
  if(pr)c+=`${pr} · link na bio.\n`;
  c+='\n#cinerea #velasdeautor #decoração #velasartesanais #camposdojordão #homedecor #velasperfumadas #aromaterapia';
  document.getElementById('po_caption').textContent=c;
}

function copiarLegenda(){
  const t=document.getElementById('po_caption').textContent;
  if(navigator.clipboard)navigator.clipboard.writeText(t).then(()=>toast('Legenda copiada')).catch(()=>toast('Não consegui copiar'));
}

async function exportarPost(){
  const alvo=document.getElementById('po_post');
  if(typeof html2canvas!=='function'){toast('Sem internet para carregar o exportador');return;}
  try{
    // 1080 de largura é o que o Instagram quer; o palco tem 540.
    const canvas=await html2canvas(alvo,{scale:1080/540,backgroundColor:null,useCORS:true});
    const a=document.createElement('a');
    a.href=canvas.toDataURL('image/png');
    const nome=(document.getElementById('po_title').value||'post').replace(/[^\w\-]+/g,'-').toLowerCase();
    a.download=`cinerea-${nome}.png`;a.click();
    toast('Imagem baixada');
  }catch(e){
    console.error(e);
    // Quase sempre é o canvas "sujo" por imagem de outro domínio.
    toast('Não consegui gerar. Envie a foto do computador em vez de usar link.');
  }
}

// liga os campos e o upload
['po_eyebrow','po_title','po_subtitle','po_price','po_badge'].forEach(id=>{
  const el=document.getElementById(id);if(el)el.addEventListener('input',postSync);
});
(()=>{
  const btn=document.getElementById('po_upbtn'),inp=document.getElementById('po_upinput');
  if(!btn||!inp)return;
  btn.onclick=()=>inp.click();
  inp.onchange=e=>{
    const f=e.target.files[0];if(!f)return;
    const r=new FileReader();
    r.onload=()=>{document.getElementById('po_fotourl').value='';postFotoUrl(String(r.result));};
    r.readAsDataURL(f);
  };
  postSync();
})();

Object.assign(window,{postDoProduto,postFotoUrl,postRatio,postMood,postToggle,copiarLegenda,exportarPost});

// ============================================================
// ENCOMENDAS — a caixa de entrada da loja do app
// Uma encomenda NÃO é um pedido: é um pedido de compra esperando aceite.
// Sem pagamento online, quem decide é gente: confere estoque e preço antes.
// ============================================================

let encomendas=[];

async function carregarEncomendas(){
  const box=document.getElementById('encList');
  if(!box)return;
  if(!pode('fin')){box.innerHTML='<div class="hint-box">Sem permissão para ver encomendas.</div>';return;}
  box.innerHTML='<div class="hint">Buscando…</div>';
  try{
    const snap=await getDocs(collection(fdb,'encomendas'));
    encomendas=snap.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>(b.criadaEm?.toMillis?.()||0)-(a.criadaEm?.toMillis?.()||0));
    renderEncomendas();
  }catch(e){
    console.error(e);
    box.innerHTML='<div class="hint">Não consegui buscar. Descobrindo por quê…</div>';
    box.innerHTML='<div class="hint-box">'+await porQueFalhouEncomendas(e)+'</div>';
  }
}

/**
 * Por que a busca das encomendas falhou — de verdade, não por palpite.
 *
 * O texto anterior era fixo: mandava publicar as regras e conferir `gestores`
 * para QUALQUER falha, inclusive falta de rede. E mandava mexer nas regras, que
 * já estavam publicadas — ou seja, apontava para o lugar errado com confiança.
 *
 * Dá para saber. Duas coisas ajudam:
 *
 * 1. Listar `encomendas` SEM filtro exige `ehDaCasa()`. O Firestore não avalia
 *    "só as minhas" documento por documento numa consulta de coleção — por isso
 *    o app do cliente consegue (ele consulta `where clienteUid == uid`) e a
 *    gestão, que lista tudo, não.
 * 2. A regra deixa cada um LER o próprio documento em `gestores`. Então basta
 *    perguntar se ele existe, em vez de sugerir que talvez não exista.
 */
async function porQueFalhouEncomendas(e){
  const cod=e?.code||e?.name||'erro';
  const cabeca='<strong>Não consegui buscar as encomendas.</strong><br>'
    +'<code>'+esc(cod)+'</code> — '+esc(e?.message||'sem mensagem')+'<br><br>';

  if(cod!=='permission-denied'){
    return cabeca+'Não é recusa de permissão, então não é regra nem <code>gestores</code>. '
      +'<code>unavailable</code> ou <code>deadline-exceeded</code> é rede; '
      +'<code>failed-precondition</code> costuma ser índice faltando.';
  }

  const u=auth.currentUser;
  if(!u) return cabeca+'Esta aba não está autenticada. Saia e entre de novo.';

  try{
    const meu=await getDoc(doc(fdb,'gestores',u.uid));
    if(meu.exists()){
      return cabeca+'Você <strong>está</strong> em <code>gestores</code>, então não é isso. '
        +'As regras publicadas devem estar atrás de <code>docs/firestore.rules</code> — '
        +'publique com <code>npx firebase-tools deploy --only firestore:rules</code>.';
    }
    return cabeca+'Confirmado: <strong>você não está em <code>gestores</code></strong>, e listar '
      +'todas as encomendas exige isso.<br><br>Crie no Console do Firebase o documento '
      +'<code>gestores/'+esc(u.uid)+'</code> — qualquer campo serve (ex.: <code>nome</code>). '
      +'Nenhum app escreve nessa coleção, de propósito: é ela que decide quem é da casa.'
      +'<br><br>A encomenda do cliente provavelmente <strong>foi salva</strong>; o que falta é '
      +'permissão para ela ser listada aqui.';
  }catch(err){
    return cabeca+'Não consegui nem ler o meu próprio <code>gestores/'+esc(u.uid)+'</code> '
      +'('+esc(err?.code||'erro')+'). Aí sim as regras publicadas estão atrás de '
      +'<code>docs/firestore.rules</code>.';
  }
}

/**
 * O total que o app enviou é o que o CLIENTE VIU. Aqui recalculamos pelo nosso
 * próprio cadastro — é isso que impede um preço adulterado de virar venda
 * enquanto não existe servidor. Divergiu, aparece na tela.
 */
function conferirTotal(enc){
  let nosso=0, achouTodos=true;
  (enc.itens||[]).forEach(i=>{
    const p=db.produtos.find(x=>String(x.id)===String(i.id));
    if(!p){achouTodos=false;return;}
    const c=calcCusto(p).total;
    nosso+=(Number(p.preco)||c*Number(p.markup||3))*Number(i.qtd||1);
  });
  nosso=Math.round(nosso*100)/100;
  return {nosso,achouTodos,divergiu:achouTodos&&Math.abs(nosso-Number(enc.totalVisto||0))>0.01};
}

function renderEncomendas(){
  const box=document.getElementById('encList');
  if(!box)return;
  // PAGA CONTA COMO NOVA, e essa linha e dinheiro. O filtro pegava so 'nova',
  // entao a encomenda que o cliente PAGOU sumia da caixa de entrada: o dinheiro
  // entrava e a casa nao ficava sabendo. Paga vem primeiro, porque e a que ja
  // tem dinheiro parado esperando alguem separar a peca.
  const esperando = e => e.situacao==='paga' || e.situacao==='nova';
  const novas=encomendas.filter(esperando);
  if(!encomendas.length){box.innerHTML='<div class="hint-box">Nenhuma encomenda ainda. Elas chegam quando alguém fecha a sacola no app.</div>';return;}
  box.innerHTML=(novas.length?'':'<div class="hint">Nenhuma encomenda esperando.</div>')
    +[...encomendas].sort((a,b)=>
        (a.situacao==='paga'?0:a.situacao==='nova'?1:2)
      - (b.situacao==='paga'?0:b.situacao==='nova'?1:2)).map(e=>{
    const t=conferirTotal(e);
    const itens=(e.itens||[]).map(i=>`<div class="prazo-item"><span>${i.qtd}× ${esc(i.nome)}</span><b>${brl(Number(i.preco||0)*Number(i.qtd||1))}</b></div>`).join('');
    const alerta = t.divergiu
      ? `<div class="hint-box" style="margin-top:8px">Atenção: o cliente viu <b>${brl(e.totalVisto)}</b>, mas pelo cadastro de hoje dá <b>${brl(t.nosso)}</b>. Combine antes de aceitar.</div>`
      : (!t.achouTodos?'<div class="hint-box" style="margin-top:8px">Alguma peça desta encomenda não está mais no cadastro.</div>':'');

    // O CUPOM. O cliente mandou só o código; o desconto é recalculado aqui,
    // pelo cadastro desta casa. É o mesmo cuidado do preço logo acima, e pela
    // mesma razão: quem compra não pode ser dono do valor.
    const cod=normalizarCupom(e.cupom);
    const cup=cod?descontoDoCupom(cod,t.nosso):null;
    const vend=cup&&cup.cupom?(db.vendedores||[]).find(v=>v.id===cup.cupom.vendedorId):null;
    const blocoCupom = !cod ? '' : (
      !cup.achou
        ? `<div class="hint-box" style="margin-top:8px">O cliente usou o cupom <b>${esc(cod)}</b>, que <b>não existe neste cadastro</b>. Ninguém recebe comissão por ele, e não há desconto a dar.</div>`
        : cup.desconto<=0
          ? `<div class="hint-box" style="margin-top:8px">Cupom <b>${esc(cod)}</b> não vale para esta encomenda: ${esc(cup.motivo)}. Sem desconto.</div>`
          : `<div class="prazo-item" style="margin-top:8px"><span>Cupom <b>${esc(cod)}</b>${vend?` · ${esc(vend.nome)} (${Number(vend.comissao)||0}% de comissão)`:' · <span style="color:var(--ember)">vendedor não cadastrado</span>'}</span><b>−${brl(cup.desconto)}</b></div>
             <div class="prazo-item"><span>Com o desconto</span><b>${brl(Math.round((t.nosso-cup.desconto)*100)/100)}</b></div>`
    );
    const acoes = esperando(e)
      ? `<div style="display:flex;gap:8px;margin-top:12px"><button class="btn" onclick="aceitarEncomenda('${e.id}')">Aceitar e criar pedido</button><button class="btn2" onclick="recusarEncomenda('${e.id}')">Não consigo atender</button></div>`
      : `<div class="hint" style="margin-top:10px">Situação: ${esc(e.situacao)}</div>`;
    return `<div class="chartcard" style="margin-bottom:14px">
      <h3>${esc(e.clienteNome||'Sem nome')} · ${brl(e.totalVisto)}
        ${e.situacao==='paga'?'<span class="pill ok">JÁ PAGA</span>':''}
        ${e.situacao==='aguardando pagamento'?'<span class="pill warn">pagamento em aberto</span>':''}</h3>
      ${e.situacao==='paga'?`<div class="hint-box" style="margin-top:8px">O cliente
        <b>já pagou ${brl(e.totalFechado)}</b>${Number(e.descontoAplicado)>0?` (com ${brl(e.descontoAplicado)} de desconto)`:''}.
        O valor está fechado: aceitar cria os pedidos por ele, sem recalcular.</div>`:''}
      <div class="hint">${esc(e.clienteEmail||'')} · ${esc(e.clienteTelefone||'')}</div>
      <div class="hint" style="margin-top:6px">${esc(e.endereco||'sem endereço')}</div>
      ${e.recado?`<div class="hint" style="margin-top:6px">Recado: ${esc(e.recado)}</div>`:''}
      <div style="margin-top:12px">${itens}</div>
      ${blocoCupom}${alerta}${acoes}
    </div>`;
  }).join('');
}

/**
 * Aceitar cria UM PEDIDO POR ITEM, porque o pedido daqui é de um produto só.
 * Transformar o pedido em multi-item mexeria no painel, na receita e na baixa
 * de estoque — muito risco para o ganho.
 */
async function aceitarEncomenda(id){
  const e=encomendas.find(x=>x.id===id);if(!e)return;
  const t=conferirTotal(e);
  // Divergência de catálogo só interessa antes de haver dinheiro. Depois de
  // pago, perguntar "criar pelo preço de hoje?" é oferecer uma escolha que não
  // existe: o preço de hoje não é o que a pessoa pagou.
  if(e.situacao!=='paga' && t.divergiu
     && !confirm(`O cliente viu ${brl(e.totalVisto)} e o cadastro de hoje dá ${brl(t.nosso)}. Criar os pedidos pelo preço de hoje?`))return;

  let cli=db.clientes.find(c=>c.nome===e.clienteNome);
  if(!cli){cli={id:uidGen(),nome:e.clienteNome||'Cliente do app',contato:e.clienteTelefone||e.clienteEmail||'',endereco:e.endereco||''};db.clientes.push(cli);}

  // O desconto do cupom é rateado entre os pedidos na proporção do valor de
  // cada um. Aceitar cria UM PEDIDO POR ITEM, e jogar o desconto inteiro no
  // primeiro deixaria a margem daquele item mentindo — e a comissão, que sai
  // do valor do pedido, sairia certa por acaso.
  const cod=normalizarCupom(e.cupom);
  const precoDoItem=i=>{
    const p=db.produtos.find(x=>String(x.id)===String(i.id));
    const c=p?calcCusto(p).total:0;
    const preco=p?(Number(p.preco)||c*Number(p.markup||3)):Number(i.preco||0);
    return preco*Number(i.qtd||1);
  };
  const cheios=(e.itens||[]).map(precoDoItem);
  const bruto=cheios.reduce((s,x)=>s+x,0);
  // O QUE JÁ FOI PAGO NÃO SE RECALCULA. Recalcular aqui reescreveria o valor
  // por cima do que saiu da conta da pessoa: bastava o cupom vencer entre o
  // pagamento e o aceite para a casa registrar um total MAIOR do que cobrou, e
  // a comissão sair de um número que nunca existiu.
  //
  // Pago, o número está fechado desde o instante em que o dinheiro se moveu.
  // Não pago, vale a conta de sempre — pelo cadastro desta casa, porque quem
  // compra não pode ser dono do valor.
  const jaPago = e.situacao==='paga' && Number(e.totalFechado)>0;
  const cup=(!jaPago&&cod)?descontoDoCupom(cod,Math.round(bruto*100)/100):null;
  const desconto=jaPago?(Number(e.descontoAplicado)||0):(cup?cup.desconto:0);
  const valores=ratearDesconto(cheios,desconto);

  (e.itens||[]).forEach((i,k)=>{
    const p=db.produtos.find(x=>String(x.id)===String(i.id));
    db.pedidos.push({
      id:uidGen(), produto:p?p.id:'', clienteId:cli.id, cliente:cli.nome,
      qtd:Number(i.qtd||1), valor:valores[k],
      // NASCE PAGO quando o dinheiro já entrou. "Pendente" num pedido que foi
      // pago manda a casa cobrar de novo quem já pagou -- e some do que o
      // painel mostra como recebido.
      situacao:jaPago?'Pago':'Pendente', data:hoje(), origem:'loja do app', encomendaId:e.id,
      // O código fica gravado no pedido: é dele que a comissão é calculada, e
      // é o que permite conferir a atribuição meses depois.
      ...(desconto>0?{cupom:cod}:{}),
    });
  });

  cloudSave();
  try{
    // O desconto CONFIRMADO volta para a encomenda, e é o que o cliente passa a
    // ver no app. Até aqui ele via uma prévia recalculada do próprio cupom;
    // daqui em diante vê o que ficou combinado, e o número para de depender de
    // o cupom continuar existindo ou dentro da validade.
    await updateDoc(doc(fdb,'encomendas',id),{
      situacao:'aceita',
      descontoAplicado:Math.round(desconto*100)/100,
      totalFechado:Math.round((bruto-desconto)*100)/100,
    });
    e.situacao='aceita';
    toast(`Pedido${(e.itens||[]).length>1?'s':''} criado${(e.itens||[]).length>1?'s':''} — veja em Pedidos`);
  }catch(err){console.error(err);toast('Pedidos criados aqui, mas não consegui avisar o cliente');}
  renderEncomendas();
}

async function recusarEncomenda(id){
  if(!confirm('Marcar como não atendida? O cliente vê isso no app.'))return;
  try{
    await updateDoc(doc(fdb,'encomendas',id),{situacao:'recusada'});
    const e=encomendas.find(x=>x.id===id);if(e)e.situacao='recusada';
    renderEncomendas();toast('Encomenda marcada');
  }catch(err){console.error(err);toast('Não consegui atualizar');}
}

// ===========================================================================
// VENDEDORES E CUPONS
//
// O cupom é o único jeito de saber QUEM trouxe a venda sem servidor: o cliente
// digita o código, o código viaja junto com o pedido, e a comissão sai daí.
//
// A regra que sustenta tudo isto: o cliente manda o CÓDIGO, nunca o desconto.
// O que ele vê na loja é prévia; o valor que vale é o recalculado aqui, pelo
// cadastro desta tela. Se o desconto viesse do aplicativo, bastaria alguém
// mandar "desconto de R$ 300" para a casa pagar comissão por cima disso.
//
// O que sobe para `cupons/{codigo}` no Firestore é um RECORTE PÚBLICO: só o que
// o cliente precisa para ver o desconto na tela. Comissão e chave Pix ficam
// aqui, porque não são da conta de quem compra.
// ===========================================================================

/* =========================================================================
 * USUÁRIOS: quem pode entrar na gestão
 *
 * NÃO EXISTE "criar a conta da pessoa" aqui, e vale explicar por quê: criar
 * conta de terceiro exige o Admin SDK num servidor, que este projeto não tem, e
 * fazer isso pelo navegador desconectaria quem está cadastrando da própria
 * sessão. Então o que se cadastra é a AUTORIZAÇÃO: a casa diz que aquele e-mail
 * entra e com que papel, e a pessoa cria a própria senha na tela de entrada.
 *
 * É melhor que o código de convite que já existia em duas coisas: não há código
 * para vazar ou repassar, e o acesso fica preso a uma pessoa identificada.
 * ========================================================================= */

/**
 * CONVITE POR E-MAIL DE VERDADE.
 *
 * Cadastrar a autorização não avisa ninguém — foi o buraco da primeira versão:
 * o cadastro dizia "aguardando" e a pessoa nunca soube que precisava fazer algo.
 *
 * `sendSignInLinkToEmail` é a única forma de o navegador mandar e-mail para um
 * endereço qualquer com o SDK do Firebase. E resolve dois problemas de uma vez:
 * a pessoa entra clicando no link, sem inventar senha, e o e-mail sai
 * CONFIRMADO por construção — quem clicou provou que tem a caixa. A regra exige
 * `email_verified`, então isso deixou de ser uma etapa extra.
 *
 * EXIGE UM INTERRUPTOR NO CONSOLE: Authentication > Sign-in method > "Email
 * link (passwordless sign-in)" ligado. Sem ele o envio falha com
 * `auth/operation-not-allowed`, e o recado abaixo diz isso com todas as letras
 * em vez de "erro ao enviar".
 */
window.copiarUid = u => {
  if(navigator.clipboard) navigator.clipboard.writeText(u).then(
    ()=>toast('uid copiado: <code>'+esc(u)+'</code>'),
    ()=>toast('Não consegui copiar. O uid é: <code>'+esc(u)+'</code>'));
  else toast('O uid é: <code>'+esc(u)+'</code>');
};

async function convidarPorEmail(email){
  const alvo = String(email||'').trim().toLowerCase();
  if(!alvo) return;
  if(!pode('gerir')){toast('Só dono e admin convidam');return;}
  try{
    await sendSignInLinkToEmail(auth, alvo, {
      // Volta para esta mesma página; o `entrarPorLink` lá embaixo reconhece.
      url: location.origin + location.pathname,
      handleCodeInApp: true,
    });
    // Guardado para quando a pessoa abrir o link NESTE aparelho. Se ela abrir
    // em outro, o código pergunta o e-mail — que é o caminho previsto.
    try{ localStorage.setItem('cinereaConvite', alvo); }catch(e){}
    toast('Convite enviado para <b>'+esc(alvo)+'</b>');
  }catch(e){
    console.error(e);
    const m = {
      'auth/operation-not-allowed':
        'Falta ligar <b>Email link (passwordless sign-in)</b> no Console do Firebase, em Authentication &gt; Sign-in method.',
      'auth/unauthorized-continue-uri':
        'O domínio desta página não está autorizado no Firebase, em Authentication &gt; Settings &gt; Authorized domains.',
      'auth/invalid-email': 'E-mail inválido.',
    };
    toast(m[e.code] || ('Não consegui enviar: '+e.code));
  }
}

/**
 * A outra ponta: a pessoa clicou no link do convite e voltou para cá.
 *
 * Roda antes de qualquer decisão de tela. Se o e-mail não estiver guardado
 * (link aberto em outro aparelho, que é o caso comum), pergunta — o Firebase
 * exige o endereço para fechar a autenticação, e é ele que impede que um link
 * interceptado sirva para outra pessoa.
 */
async function entrarPorLink(){
  if(!auth || !isSignInWithEmailLink(auth, location.href)) return false;
  let email = '';
  try{ email = localStorage.getItem('cinereaConvite') || ''; }catch(e){}
  if(!email) email = prompt('Confirme o e-mail que recebeu o convite:') || '';
  email = email.trim().toLowerCase();
  if(!email) return false;
  try{
    await signInWithEmailLink(auth, email, location.href);
    try{ localStorage.removeItem('cinereaConvite'); }catch(e){}
    // Tira o código do endereço para um F5 não tentar reusar um link já gasto.
    history.replaceState(null, '', location.pathname);
    return true;
  }catch(e){
    console.error(e);
    alert(e.code === 'auth/invalid-action-code'
      ? 'Este convite já foi usado ou expirou. Peça outro a quem administra.'
      : 'Não consegui entrar com este link: ' + e.code);
    return false;
  }
}

async function sincronizarAcesso(a, emailAntigo){
  // Escreve o novo primeiro: se apagar o antigo falhar, sobra uma autorização a
  // mais (que o conserto remove), e não uma pessoa trancada do lado de fora.
  await setDoc(doc(fdb,'acessos',a.email), { empresaId: eid, papel: a.papel || 'empregado' });
  if(emailAntigo && emailAntigo !== a.email){
    await deleteDoc(doc(fdb,'acessos',emailAntigo));
  }
}

/** Quem já entrou de fato: casa a autorização com os membros da empresa. */
function membroDoEmail(email){
  return Object.entries(membros).find(([,m]) =>
    String(m.email||'').toLowerCase() === String(email||'').toLowerCase());
}

function renderAcessos(){
  const tb = document.getElementById('tbAcessos');
  if(!tb) return;
  const ger = pode('gerir');
  const lista = db.acessos || [];

  tb.innerHTML = lista.length ? lista.map(a => {
    const par = membroDoEmail(a.email);
    const situacao = par
      ? '<span class="pill ok">entrou</span>'
      : '<span class="pill warn">aguardando</span>';
    // O papel que vale é o do documento de membro, se a pessoa já entrou: se
    // alguém trocou o papel aqui depois, o de lá é o que o servidor aplica.
    const papelReal = par ? (par[1].papel || 'empregado') : a.papel;
    const divergiu = par && papelReal !== a.papel;
    return `<tr>
      <td>${esc(a.email)}${a.obs?`<div style="font-size:11px;color:var(--warm)">${esc(a.obs)}</div>`:''}</td>
      <td>${esc(par ? (par[1].nome || a.nome || '') : (a.nome||'—'))}
        ${par?`<div class="uid-linha">
          <code>${esc(par[0])}</code>
          <button class="icon-btn" title="Copiar o uid" onclick="copiarUid('${esc(par[0])}')">${ico("copiar","Copiar o uid")}</button>
        </div>`:''}</td>
      <td>${esc(PAPEL_LABEL[a.papel]||a.papel)}${divergiu?`<div style="font-size:11px;color:var(--ember)">na empresa está como ${esc(PAPEL_LABEL[papelReal]||papelReal)}</div>`:''}</td>
      <td>${situacao}</td>
      <td>${ger?`<div class="row-actions">
        ${par?'':`<button class="icon-btn" title="Enviar convite por e-mail" onclick="convidarPorEmail('${esc(a.email)}')">✉</button>`}
        <button class="icon-btn" onclick="openForm('acesso','${a.id}')">${ico("lapis","Editar")}</button>
        <button class="icon-btn" onclick="del('acesso','${a.id}')">${ico("lixeira","Apagar")}</button>
      </div>`:''}</td>
    </tr>`;
  }).join('') : `<tr><td colspan=5><div class="empty-t">Ninguém cadastrado além de você. Cadastre o e-mail de quem vai usar a gestão.</div></td></tr>`;

  const aviso = document.getElementById('acessosAviso');
  if(aviso) aviso.innerHTML = ger ? '' :
    '<div class="hint-box" style="margin-bottom:10px">Só dono e admin mexem aqui.</div>';

  const guia = document.getElementById('acessosGuia');
  if(guia) guia.innerHTML = `<div class="hint-box" style="margin-top:16px">
    <b>Cadastrar não avisa ninguém.</b> Depois de cadastrar, toque no <b>✉</b> da
    linha para mandar o convite. A pessoa recebe um e-mail com um link, clica, e
    entra direto na empresa com o papel que você definiu — sem inventar senha e
    sem código para passar.
    <br><br>
    <b>Por que o link, e não uma senha.</b> Quem clica no link prova que tem
    aquela caixa de e-mail. Sem essa prova, qualquer pessoa que soubesse o
    endereço convidado criaria uma conta com ele e entraria no lugar dela — num
    sistema que mostra faturamento, margem e a base de clientes. O servidor
    recusa quem não confirmou.
    <br><br>
    <b>E a senha dela?</b> Entrando pelo link ela não precisa de uma. Se quiser
    definir uma para as próximas vezes, é só usar "Esqueci a senha" na tela de
    entrada, com o mesmo e-mail.
    <br><br>
    <b>Se o envio falhar</b> dizendo que falta ligar algo: é o interruptor
    <b>Email link (passwordless sign-in)</b>, no Console do Firebase, em
    Authentication &gt; Sign-in method. Uma vez só.
    <br><br>
    <b>Papéis.</b> ${esc(PAPEL_LABEL.empregado)} não vê o financeiro nem a aba
    Peças. ${esc(PAPEL_LABEL.socio)} vê. ${esc(PAPEL_LABEL.admin)} vê e também
    convida, publica e mexe nos papéis.
    <br><br>
    <b>Encomendas exigem um passo a mais, no Console.</b> O papel aqui manda no
    que a tela mostra; quem manda em listar as encomendas é a coleção
    <code>gestores</code> do Firebase, e ela só se mexe por lá. Para ${esc(PAPEL_LABEL.socio)}
    ou ${esc(PAPEL_LABEL.admin)} enxergar a caixa de entrada, crie no Console o
    documento <code>gestores/{uid}</code> com o uid que aparece ao lado do nome
    da pessoa (o botão ao lado copia). Qualquer campo serve.
    <br><br>
    São dois conceitos que não conversam, e é de propósito:
    <code>gestores</code> é "quem é da casa" e vale para o projeto inteiro,
    inclusive para registrar procedência de peça e publicar cupom. Papel na
    empresa é só desta empresa.
  </div>`;
}

/**
 * Conserto, igual ao dos cupons: relê o que está no ar e acerta os dois lados.
 * Existe para quando a rede falhar no meio de um salvamento.
 */
async function conferirAcessos(){
  if(!pode('gerir')){toast('Só dono e admin mexem em usuários');return;}
  const lista = db.acessos || [];
  let noAr = [];
  try{
    const snap = await getDocs(collection(fdb,'acessos'));
    noAr = snap.docs.filter(d => d.data().empresaId === eid).map(d => d.id);
  }catch(e){
    console.error(e);
    toast('Não consegui ler o que está no ar. Se a regra de <b>acessos</b> ainda não foi publicada, é isso.');
    return;
  }
  const daqui = lista.map(a => a.email);
  const orfaos = noAr.filter(e => !daqui.includes(e));
  if(!lista.length && !orfaos.length){toast('Nada a acertar.');return;}
  const aviso = [lista.length?`${lista.length} autorização(ões) sobem ou são atualizadas`:'',
                 orfaos.length?`${orfaos.length} sai(em) do ar: ${orfaos.join(', ')}`:'']
                .filter(Boolean).join('\n');
  if(!confirm(aviso+'\n\nAcertar agora?'))return;
  let ok=0,fora=0,falhou=0;
  for(const a of lista){
    try{ await setDoc(doc(fdb,'acessos',a.email),{empresaId:eid,papel:a.papel||'empregado'}); ok++; }
    catch(e){ console.error(e); falhou++; }
  }
  for(const e of orfaos){
    try{ await deleteDoc(doc(fdb,'acessos',e)); fora++; }
    catch(err){ console.error(err); falhou++; }
  }
  toast(falhou?`${ok} no ar, ${fora} removida(s), ${falhou} falhou(aram)`:`Acertado: ${ok} no ar${fora?`, ${fora} removida(s)`:''}`);
  renderAcessos();
}

function normalizarCupom(bruto){
  return String(bruto||'').normalize('NFD').replace(/[^A-Za-z0-9-]/g,'').toUpperCase().slice(0,24);
}

/** O desconto que ESTE cadastro dá, que é o que vale. */
function descontoDoCupom(codigo,total){
  const c=(db.cupons||[]).find(x=>x.codigo===normalizarCupom(codigo));
  if(!c) return {achou:false,cupom:null,desconto:0,motivo:'cupom não cadastrado aqui'};
  if(total<=0) return {achou:true,cupom:c,desconto:0,motivo:'pedido sem valor'};
  if(c.ativo==='desligado') return {achou:true,cupom:c,desconto:0,motivo:'cupom desligado'};
  if(c.ate&&hoje()>c.ate) return {achou:true,cupom:c,desconto:0,motivo:'cupom venceu em '+c.ate};
  const min=Number(c.minimo)||0;
  if(total<min) return {achou:true,cupom:c,desconto:0,motivo:'abaixo do mínimo de '+brl(min)};
  const bruto=c.tipo==='valor'
    ? Math.max(Number(c.valor)||0,0)
    : total*Math.min(Math.max(Number(c.valor)||0,0),100)/100;
  return {achou:true,cupom:c,desconto:Math.round(Math.min(bruto,total)*100)/100,motivo:''};
}

/**
 * Reparte o desconto entre os pedidos, na proporção do valor de cada um.
 *
 * Aceitar uma encomenda cria UM PEDIDO POR ITEM. Jogar o desconto inteiro no
 * primeiro deixaria a margem daquele item mentindo, e a comissão, que sai do
 * valor do pedido, sairia certa só por acaso.
 *
 * O MAIOR ITEM ABSORVE A SOBRA, e é isso que faz a conta fechar. Repartir na
 * proporção e arredondar cada parte por si perde ou ganha centavos: sete peças
 * de R$ 19,99 com R$ 20 de desconto somavam R$ 119,91 quando o combinado com o
 * cliente era R$ 119,93. Dois centavos que ninguém cobra e ninguém acha depois,
 * e que deixam a receita divergindo do que o cliente pagou.
 *
 * A sobra vai no MAIOR e não no último porque o último pode ser um item de
 * poucos centavos, que não tem de onde tirar.
 */
function ratearDesconto(cheios,desconto){
  const cent=v=>Math.round(v*100)/100;
  const valores=(cheios||[]).map(cent);
  const bruto=cent((cheios||[]).reduce((s,x)=>s+x,0));
  if(!(desconto>0)||!(bruto>0)||!valores.length) return valores;

  const rateados=cheios.map(c=>cent(c-desconto*(c/bruto)));
  const alvo=cent(bruto-desconto);
  const sobra=cent(alvo-rateados.reduce((s,x)=>s+x,0));
  let maior=0;
  rateados.forEach((v,i)=>{ if(v>rateados[maior]) maior=i; });
  rateados[maior]=cent(rateados[maior]+sobra);
  return rateados;
}

/**
 * Comissão só de PEDIDO, e pedido só nasce de encomenda aceita.
 *
 * Contar sobre encomenda recebida deixaria qualquer um gerar comissão para si
 * mesmo, mandando pedidos falsos com o próprio cupom. Aceitar já é decisão
 * humana, então esse filtro sai de graça. Cancelado também não conta.
 */
function comissoes(){
  const porVendedor={};
  (db.pedidos||[]).forEach(p=>{
    const cod=normalizarCupom(p.cupom);
    if(!cod||p.situacao==='Cancelado') return;
    const c=(db.cupons||[]).find(x=>x.codigo===cod);
    const v=c?(db.vendedores||[]).find(y=>y.id===c.vendedorId):null;
    if(!v) return;
    const linha=porVendedor[v.id]||(porVendedor[v.id]={vendedor:v,pedidos:[],vendido:0,comissao:0});
    const valor=Number(p.valor)||0;
    linha.pedidos.push(p);
    linha.vendido+=valor;
    linha.comissao+=valor*(Number(v.comissao)||0)/100;
  });
  Object.values(porVendedor).forEach(l=>{
    l.vendido=Math.round(l.vendido*100)/100;
    l.comissao=Math.round(l.comissao*100)/100;
  });
  return Object.values(porVendedor).sort((a,b)=>b.comissao-a.comissao);
}

function renderVendedores(){
  const tb=document.getElementById('tbVendedores');
  if(!tb)return;
  const com=comissoes();
  const vs=db.vendedores||[];
  tb.innerHTML=vs.length?vs.map(v=>{
    const c=com.find(x=>x.vendedor.id===v.id);
    const zap=v.whats?`<a href="https://wa.me/${String(v.whats).replace(/\D/g,'')}" target="_blank" rel="noopener">${esc(v.whats)}</a>`:'—';
    return `<tr><td>${esc(v.nome)}${v.chavePix?`<div style="font-size:11px;color:var(--warm)">Pix: ${esc(v.chavePix)}</div>`:''}</td>
      <td>${zap}</td><td>${Number(v.comissao)||0}%</td>
      <td>${c?c.pedidos.length:0}</td><td class="money">${brl(c?c.vendido:0)}</td>
      <td class="money"><b>${brl(c?c.comissao:0)}</b></td>
      <td>${rowActions('vendedor',v.id)}</td></tr>`;
  }).join(''):`<tr><td colspan=7><div class="empty-t">Nenhum vendedor. Cadastre quem divulga a Cinérea e depois crie um cupom para cada um.</div></td></tr>`;
}

function renderCupons(){
  const tb=document.getElementById('tbCupons');
  if(!tb)return;
  const cs=db.cupons||[];
  const usos={};
  (db.pedidos||[]).forEach(p=>{const c=normalizarCupom(p.cupom);if(c)usos[c]=(usos[c]||0)+1;});
  tb.innerHTML=cs.length?cs.map(c=>{
    const v=(db.vendedores||[]).find(x=>x.id===c.vendedorId);
    const venceu=c.ate&&hoje()>c.ate;
    const pill=c.ativo==='desligado'?'<span class="pill low">desligado</span>'
      :venceu?'<span class="pill warn">vencido</span>':'<span class="pill ok">ativo</span>';
    const regras=[c.minimo?`mín. ${brl(c.minimo)}`:'',c.ate?`até ${String(c.ate).slice(8,10)}/${String(c.ate).slice(5,7)}`:''].filter(Boolean).join(' · ')||'—';
    return `<tr><td><b>${esc(c.codigo)}</b></td>
      <td>${v?esc(v.nome):'<span style="color:var(--ember)">sem vendedor</span>'}</td>
      <td>${c.tipo==='valor'?brl(c.valor):`${Number(c.valor)||0}%`}</td>
      <td style="font-size:12px;color:var(--warm)">${esc(regras)}</td>
      <td>${pill}</td><td>${usos[c.codigo]||0}</td>
      <td>${rowActions('cupom',c.id)}</td></tr>`;
  }).join(''):`<tr><td colspan=7><div class="empty-t">Nenhum cupom. Cada vendedor precisa de um para a venda ser atribuída a ele.</div></td></tr>`;

  const box=document.getElementById('cuponsAviso');
  if(box) box.innerHTML=cs.length
    ? '<div class="hint-box" style="margin-bottom:10px">Salvar, desligar e apagar valem <b>na hora</b> no site e no app. Se algum salvamento avisar que a rede falhou, <b>Conferir o que está no ar</b> acerta os dois lados e remove o que sobrou. Comissão e chave Pix nunca saem daqui.</div>'
    : '';
}

function renderComissoes(){
  const box=document.getElementById('comissoes');
  if(!box)return;
  const com=comissoes();
  if(!com.length){box.innerHTML='';return;}
  const total=com.reduce((s,c)=>s+c.comissao,0);
  box.innerHTML=`<div class="panel-head" style="margin-top:32px"><div><h2 style="font-size:20px">A pagar</h2>
    <div class="desc">Sobre pedido criado e não cancelado. Encomenda do app só entra depois de aceita</div></div></div>`
    + com.map(c=>`<div class="chartcard" style="margin-bottom:12px">
        <h3>${esc(c.vendedor.nome)} · ${brl(c.comissao)}</h3>
        <div class="hint">${c.pedidos.length} pedido(s) · ${brl(c.vendido)} vendidos · ${Number(c.vendedor.comissao)||0}% de comissão${c.vendedor.chavePix?' · Pix '+esc(c.vendedor.chavePix):''}</div>
        <div style="margin-top:10px">${c.pedidos.map(p=>`<div class="prazo-item"><span>${esc(p.data||'')} · ${esc(p.cliente||'cliente')} <span style="color:var(--warm)">(${esc(normalizarCupom(p.cupom))})</span></span><b>${brl(p.valor)}</b></div>`).join('')}</div>
      </div>`).join('')
    + `<div class="hint" style="margin-top:6px">Total a pagar: <b>${brl(Math.round(total*100)/100)}</b></div>`;
}

/**
 * O RECORTE PÚBLICO de um cupom: só o que a loja precisa para mostrar o
 * desconto. Comissão e chave Pix não sobem, porque não são da conta de quem
 * compra.
 */
function recortePublico(c){
  return {
    // `vendedor` sobe só como identificador, para a encomenda saber a quem
    // atribuir. Nome, comissão e Pix ficam neste cadastro.
    vendedor:c.vendedorId||'',
    tipo:c.tipo==='valor'?'valor':'percentual',
    valor:Number(c.valor)||0,
    ativo:c.ativo!=='desligado',
    minimo:Number(c.minimo)||0,
    ...(c.ate?{ate:new Date(c.ate+'T23:59:59').getTime()}:{}),
    atualizadoEm:Date.now(),
  };
}

/**
 * O cupom vai e volta SOZINHO, ao salvar e ao apagar.
 *
 * Antes havia só um botão de publicar, e ele só ESCREVIA. Apagar um cupom aqui
 * deixava o documento vivo no servidor dando desconto para sempre: o cadastro
 * dizia uma coisa e a loja fazia outra. Desligar tinha o mesmo problema, e
 * renomear o código deixava o código velho valendo — inclusive pagando
 * comissão.
 *
 * Agora salvar e apagar mexem no servidor na hora. Se a rede falhar, o aviso
 * aparece e o botão "Conferir o que está no ar" conserta. O que não pode
 * existir é o servidor ficar errado em silêncio.
 */
async function sincronizarCupom(c,codigoAntigo){
  // Renomear cria um documento novo, então o antigo TEM de sair. Primeiro
  // escreve o novo: se a remoção falhar, sobra um cupom a mais (que o conserto
  // apaga), e não um cupom a menos no meio de uma campanha.
  await setDoc(doc(fdb,'cupons',c.codigo),recortePublico(c));
  if(codigoAntigo&&codigoAntigo!==c.codigo){
    await deleteDoc(doc(fdb,'cupons',codigoAntigo));
  }
}

/**
 * Confere o que está no ar contra este cadastro e acerta os dois lados: sobe o
 * que falta, atualiza o que mudou e APAGA o que já não existe aqui.
 *
 * É o conserto para quando a rede falhou no meio de um salvamento, e é o único
 * lugar que enxerga cupom órfão: aquele que ficou no servidor sem corresponder
 * a nada neste cadastro.
 */
async function apagarCupomDoAr(codigo){
  if(!codigo)return;
  await deleteDoc(doc(fdb,'cupons',codigo));
}

async function publicarCupons(){
  if(!pode('gerir')){toast('Só dono e admin mexem nos cupons');return;}
  const cs=db.cupons||[];
  let noAr=[];
  try{
    const snap=await getDocs(collection(fdb,'cupons'));
    noAr=snap.docs.map(d=>d.id);
  }catch(e){
    console.error(e);
    toast('Não consegui ler o que está no ar. Se a regra de <b>cupons</b> ainda não foi publicada, é isso.');
    return;
  }
  const daqui=cs.map(c=>c.codigo);
  const orfaos=noAr.filter(id=>!daqui.includes(id));

  if(!cs.length&&!orfaos.length){toast('Nada a acertar — o ar está igual a este cadastro.');return;}
  const aviso=[cs.length?`${cs.length} cupom(ns) deste cadastro sobem ou são atualizados`:'',
               orfaos.length?`${orfaos.length} sai(em) do ar por não existir(em) mais aqui: ${orfaos.join(', ')}`:'']
              .filter(Boolean).join('\n');
  if(!confirm(aviso+'\n\nAcertar agora?'))return;

  let ok=0,fora=0,falhou=0;
  for(const c of cs){
    try{ await setDoc(doc(fdb,'cupons',c.codigo),recortePublico(c)); ok++; }
    catch(e){ console.error('cupom',c.codigo,e); falhou++; }
  }
  for(const id of orfaos){
    try{ await deleteDoc(doc(fdb,'cupons',id)); fora++; }
    catch(e){ console.error('órfão',id,e); falhou++; }
  }
  toast(falhou
    ? `${ok} no ar, ${fora} removido(s), ${falhou} falhou(aram) — veja o console`
    : `Acertado: ${ok} no ar${fora?`, ${fora} removido(s)`:''}`);
  renderCupons();
}

Object.assign(window,{carregarEncomendas,aceitarEncomenda,recusarEncomenda,avisoCatalogo,semearColecoes,renderColecoes,renderBanner,renderAcessos,conferirAcessos,convidarPorEmail,publicarCupons,renderVendedores,renderCupons,renderComissoes});

// ============================================================
// FOTO DE PRODUTO — envio para o Cloud Storage
// ============================================================

/**
 * Reduz a foto ANTES de subir.
 *
 * Foto de celular tem 3 a 6 MB. Subir crua custa duas vezes: você paga o
 * armazenamento e o cliente paga o download — na loja, em dados móveis, com a
 * peça demorando a aparecer. 1200px de lado maior é mais do que suficiente
 * para uma vitrine, e a regra do Storage recusa acima de 2 MB de qualquer jeito.
 */
function comprimirImagem(file, ladoMax=1200, qualidade=0.82){
  return new Promise((ok,erro)=>{
    const img=new Image();
    img.onload=()=>{
      const escala=Math.min(1, ladoMax/Math.max(img.width,img.height));
      const c=document.createElement('canvas');
      c.width=Math.round(img.width*escala); c.height=Math.round(img.height*escala);
      c.getContext('2d').drawImage(img,0,0,c.width,c.height);
      c.toBlob(b=>b?ok(b):erro(new Error('nao consegui comprimir')),'image/jpeg',qualidade);
      URL.revokeObjectURL(img.src);
    };
    img.onerror=()=>erro(new Error('arquivo nao parece ser imagem'));
    img.src=URL.createObjectURL(file);
  });
}

/**
 * Onde a foto vai morar.
 *
 * Se já existe uma foto NOSSA no campo, reescrevemos o mesmo arquivo — assim
 * trocar a foto não deixa a antiga ocupando espaço pago para sempre. Senão,
 * nome novo.
 *
 * O nome NÃO vem do id do produto de propósito: produto novo ainda não tem id,
 * e inventar um aqui faria o salvamento achar que é uma edição e procurar um
 * registro que não existe.
 */
function caminhoDaFoto(urlAtual){
  // O uid entra no CAMINHO porque é assim que a regra do Storage confere quem
  // pode escrever: cada um só grava dentro da própria pasta. Antes a regra
  // perguntava ao Firestore quem era da casa, e essa ponte exigia uma permissão
  // que nunca foi concedida — dava `storage/unauthorized` sem dizer por quê.
  const m=String(urlAtual||'').match(/\/o\/(produtos%2F[^?]+)/);
  if(m){
    const caminho=decodeURIComponent(m[1]);
    // Só reaproveita o arquivo se ele já estiver na pasta certa. Foto antiga,
    // do formato sem uid, seria recusada — melhor gravar uma nova.
    if(caminho.startsWith(`produtos/${uid}/`))return caminho;
  }
  return `produtos/${uid}/${uidGen()}${uidGen().slice(0,4)}.jpg`;
}

/** Chamado pelo campo de foto no formulário de produto. */
/**
 * Envio genérico de imagem, para os campos `t:'imagem'`.
 *
 * A foto de produto tem a sua própria (`escolherFoto`), com caminho e teto
 * herdados; esta serve aos campos novos e recebe pasta, lado máximo e teto por
 * argumento — é o que permite ter TRÊS limites diferentes sem três funções.
 *
 * Os limites não são arbitrários: cada arquivo é servido a um público
 * diferente. Foto de produto sai uma vez por peça na loja; banner e logo saem a
 * cada visita, e por isso apertam mais.
 */
async function escolherImagem(input, campo, pasta, ladoMax, tetoKB){
  const file = input.files && input.files[0];
  if(!file) return;
  const aviso = document.getElementById('f_'+campo+'Status');
  const alvo  = document.getElementById('f_'+campo);
  const prev  = document.getElementById('f_'+campo+'Prev');
  const diz = t => { if(aviso) aviso.innerHTML = t; };

  if(!pode('gerir')){diz('Só dono e admin enviam imagens.');return;}
  if(!fstore){diz('Storage não iniciado.');return;}

  diz('Encolhendo e enviando…');
  try{
    const blob = await comprimirImagem(file, ladoMax, 0.82);
    const kb = Math.round(blob.size/1024);
    if(kb > tetoKB){
      diz(`Mesmo encolhida ficou com ${kb} KB, acima do teto de ${tetoKB} KB. `
        + 'Tente uma imagem menos detalhada, ou com menos texto dentro dela.');
      return;
    }
    const caminho = `${pasta}/${uid}/${campo}-${Date.now()}.jpg`;
    await uploadBytes(sRef(fstore, caminho), blob, {contentType:'image/jpeg'});
    const url = await getDownloadURL(sRef(fstore, caminho));
    if(alvo) alvo.value = url;
    if(prev){ prev.src = url; prev.style.display = 'block'; }
    diz(`Enviada (${kb} KB). <b>Publique a loja</b> para ela entrar no ar.`);
  }catch(e){
    console.error(e);
    diz(e.code === 'storage/unauthorized'
      ? 'O envio foi recusado. As regras do Storage podem não estar publicadas.'
      : 'Não consegui enviar: ' + ((e && e.message) || 'erro'));
  }finally{
    input.value = '';
  }
}

async function escolherFoto(input){
  const file=input.files&&input.files[0];
  if(!file)return;
  const aviso=document.getElementById('f_fotoStatus');
  const campo=document.getElementById('f_foto');
  const prev=document.getElementById('f_fotoPrev');
  if(!pode('fin')){if(aviso)aviso.textContent='Sem permissão para enviar fotos.';return;}
  if(!fstore){if(aviso)aviso.textContent='Storage não iniciado.';return;}

  if(aviso)aviso.textContent='Comprimindo e enviando…';
  try{
    const blob=await comprimirImagem(file);
    const caminho=caminhoDaFoto(campo&&campo.value);
    await uploadBytes(sRef(fstore,caminho), blob, {contentType:'image/jpeg'});
    const url=await getDownloadURL(sRef(fstore,caminho));
    if(campo)campo.value=url;
    if(prev){prev.src=url;prev.style.display='block';}
    const kb=Math.round(blob.size/1024);
    if(aviso)aviso.textContent=`Foto enviada (${kb} KB).`;
  }catch(e){
    console.error(e);
    if(aviso)aviso.textContent='Não consegui enviar: '+((e&&e.message)||'erro');
  }finally{
    input.value='';
  }
}

Object.assign(window,{escolherFoto});

// ============================================================
// PUBLICAR A LOJA — revisar antes de mandar
// ============================================================

/**
 * O que está errado ou faltando em cada peça que iria para a loja.
 *
 * Nada aqui impede a publicação: são escolhas do dono, não erros. Mas peça sem
 * foto aparece como um símbolo cinza na vitrine, e peça sem coleção fica fora
 * de todas as seções — sumindo do site sem explicação. Melhor ver antes.
 */
function pendenciasDaLoja(){
  const p=[];
  const publicas=(db.produtos||[]).filter(x=>x.publico);
  publicas.forEach(x=>{
    const c=calcCusto(x).total;
    const preco=Number(x.preco)||c*Number(x.markup||3);
    if(!x.foto) p.push([x.nome||'(sem nome)','sem foto — aparece só com o símbolo da marca']);
    if(!x.colecao) p.push([x.nome||'(sem nome)','sem coleção — fica fora das seções do site']);
    if(!preco) p.push([x.nome||'(sem nome)','sem preço — aparece como R$ 0']);
    if(!x.nome) p.push(['(peça sem nome)','o cliente vê o campo vazio']);
  });
  return p;
}

function revisarPublicacao(){
  if(!pode('fin')){toast('Sem permissão');return;}
  const publicas=(db.produtos||[]).filter(x=>x.publico);
  if(!publicas.length){toast('Marque "mostrar no catálogo" em alguma peça primeiro');return;}

  const cols=colecoesOrdenadas();
  const porColecao=cols.map(c=>[c.nome,publicas.filter(x=>x.colecao===c.id).length]).filter(([,n])=>n);
  const soltas=publicas.filter(x=>!x.colecao).length;
  const pend=pendenciasDaLoja();

  currentForm={type:'publicar',id:null,recipe:[]};window.currentForm=currentForm;
  document.getElementById('modalTitle').textContent='Publicar a loja';
  document.getElementById('modalBody').innerHTML=`
    <div class="hint-box">Isto atualiza a vitrine no <b>site</b> e no <b>app</b> ao mesmo tempo. Quem já estiver com a loja aberta vê a mudança ao recarregar.</div>

    <div class="field" style="margin-top:16px">
      <label>O que vai subir</label>
      <div id="pagList">
        ${porColecao.map(([n,q])=>`<div class="prazo-item"><span>${esc(n)}</span><b>${q} peça${q>1?'s':''}</b></div>`).join('')}
        ${soltas?`<div class="prazo-item"><span style="color:var(--ember)">Sem coleção</span><b>${soltas}</b></div>`:''}
      </div>
      <div class="hint">${publicas.length} peça(s) no total, em ${porColecao.length} coleção(ões)</div>
    </div>

    ${pend.length?`<div class="field"><label>Vale conferir antes</label><div id="pendList">
      ${pend.map(([n,m])=>`<div class="prazo-item"><span>${esc(n)}</span><span style="color:var(--warm);font-size:12px">${esc(m)}</span></div>`).join('')}
    </div><div class="hint">Nada disso impede publicar — só muda o que o cliente vê.</div></div>`:''}

    <div class="field">
      <label>WhatsApp para encomendas</label>
      <input id="f_whats" value="${esc(db.catWhats||'')}" placeholder="31999998888">
      <div class="hint">Só números com DDD. Vazio esconde o botão de encomendar na loja.</div>
    </div>

    <button class="btn" style="width:100%" onclick="confirmarPublicacao()">Publicar agora</button>
    <div class="hint" id="pubStatus" style="margin-top:10px"></div>`;
  // Esta tela não salva nada — o rodapé padrão "Cancelar / Salvar" só
  // confundiria. O fechar fica no × do canto e no próprio fluxo.
  const rodape=document.querySelector('.modal-foot');
  if(rodape)rodape.style.display='none';
  document.getElementById('overlay').classList.add('open');
}

async function confirmarPublicacao(){
  const st=document.getElementById('pubStatus');
  const whats=(document.getElementById('f_whats')||{}).value||'';
  db.catWhats=String(whats).replace(/\D/g,'');
  st.textContent='Publicando…';
  try{
    await publicarCatalogo();
    st.innerHTML='Publicado. <a href="https://cinerea.com.br/loja/" target="_blank" rel="noopener" style="color:var(--ember)">Ver a loja →</a>';
    avisoCatalogo();
  }catch(e){
    console.error('confirmarPublicacao:',e);
    st.innerHTML='<span style="color:var(--ember)">'+esc((e&&e.message)||'não consegui publicar')+'</span>';
  }
}

Object.assign(window,{revisarPublicacao,confirmarPublicacao});


/* ═══════════════════════════════════════════════════════════════════════════
   ÍCONES
   ═══════════════════════════════════════════════════════════════════════════
   Eram emoji: 🗑 ✎ ⧉ 🔍 💰 ◈. Emoji não é ícone de sistema, e por três razões
   que aparecem todas na tela do dono:

   - quem desenha é o SISTEMA OPERACIONAL. O mesmo 🗑 sai como lixeira cinza no
     macOS, verde no Android e azul no Windows — a paleta da marca não alcança;
   - a cor é fixa. `color:var(--warm)` não pinta emoji, então o botão de apagar
     ficava colorido no meio de uma interface de dois tons, e o tema escuro não
     mexia nele;
   - `✎` e `◈` não são emoji, são símbolos de texto: caem para a fonte que o
     aparelho tiver, e num celular sem esse glifo saem como retângulo vazio.

   SVG em traço herda `currentColor`, alinha com o texto e é o mesmo desenho em
   todo lugar. São seis, todos no mesmo grid de 24 e com o mesmo peso de traço
   da marca.
*/
const ICONES={
  lapis:'<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="M14.5 6.5 17.5 9.5"/>',
  lixeira:'<path d="M4 7h16"/><path d="M10 4h4M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  copiar:'<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  lupa:'<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
  baixar:'<path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>',
  subir:'<path d="M12 20V9"/><path d="m7 13 5-5 5 5"/><path d="M5 4h14"/>',
  alerta:'<path d="M12 8v5"/><circle cx="12" cy="16.5" r=".6" fill="currentColor"/><circle cx="12" cy="12" r="8.5"/>',
  loja:'<path d="M4 9h16l-1.2 10.2a1 1 0 0 1-1 .8H6.2a1 1 0 0 1-1-.8L4 9Z"/><path d="M9 9V6.5a3 3 0 0 1 6 0V9"/>',
};

/** Um ícone de traço, do tamanho do texto ao lado. `rotulo` vira o title. */
function ico(nome,rotulo){
  const d=ICONES[nome];
  if(!d) return '';
  return `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" `
    +`stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`
    +(rotulo?` role="img"><title>${esc(rotulo)}</title>`:`>`)+d+'</svg>';
}
Object.assign(window,{ico});


/* ═══════════════════════════════════════════════════════════════════════════
   O RÓTULO DAS CÉLULAS NO CELULAR
   ═══════════════════════════════════════════════════════════════════════════

   No celular a tabela deixa de ser tabela: cada linha vira um cartão, e o
   cabeçalho some. Quem diz o que é cada valor é o `data-l` da célula, que o CSS
   desenha com `td::before{content:attr(data-l)}`.

   O mecanismo existia desde sempre e estava praticamente sem uso: 5 células
   tinham `data-l` e 136 não. Ou seja, no aparelho em que o dono mais abre isto
   — o celular, no meio do ateliê — a tabela de peças aparecia assim:

       Ondina
       Coleção Areia
       R$ 112,00
       R$ 280,00
       60,0%

   Sete números empilhados e nenhum dizendo se é custo, preço ou margem. Num
   sistema em que a pessoa decide preço olhando margem, isso não é feio: é
   ilegível.

   A correção NÃO é sair escrevendo `data-l` em 136 lugares. Isso conserta hoje
   e volta a quebrar na próxima coluna que alguém adicionar, sem erro nenhum
   para avisar — foi exatamente assim que se chegou a 136. O rótulo passa a vir
   do `<thead>` da própria tabela, que já tem o nome de cada coluna e já é a
   fonte da verdade quando a tela é larga. Uma coluna nova nasce rotulada.

   Um `MutationObserver` em vez de chamar depois de cada render: as tabelas são
   preenchidas em dezenas de funções diferentes (`renderProdutos`,
   `renderPedidos`, `carregarEncomendas`…), e qualquer lista de chamadas fica
   incompleta do mesmo jeito que a lista de `data-l` ficou. O observador não
   depende de ninguém lembrar dele.

   `colSpan` é respeitado: a linha de "nenhum produto" ocupa a tabela inteira e
   não pode receber o rótulo da primeira coluna.
*/
function rotularCelulas(tabela){
  if(!tabela) return;
  const colunas=[...tabela.querySelectorAll('thead th')];
  const cabecalhos=colunas.map(th=>th.textContent.trim());
  if(!cabecalhos.length) return;
  /* Qual coluna vira o TÍTULO do cartão no celular.
     A primeira coluna serve para quase todas as tabelas, e mente em três:
     Pedidos, Produção e Compras começam pela data, e um cartão intitulado
     "12/07" não diz de quem é o pedido — que é justamente o que se procura ao
     correr o olho pela lista. Por isso o `<th data-titulo>` no HTML: é decisão
     de cada tabela, fica visível ao lado do nome da coluna, e quem não declara
     cai na primeira, que é o certo na maioria. */
  const iTitulo=Math.max(0,colunas.findIndex(th=>th.hasAttribute('data-titulo')));
  for(const linha of tabela.querySelectorAll('tbody tr')){
    let coluna=0;
    for(const celula of linha.children){
      // Célula que atravessa a tabela é aviso de vazio, não dado de coluna.
      if(celula.colSpan>1){ celula.setAttribute('data-l',''); coluna+=celula.colSpan; continue; }
      // Quem já traz o próprio rótulo manda: há colunas cujo cabeçalho é curto
      // demais para servir de rótulo solto no celular.
      if(!celula.hasAttribute('data-l')) celula.setAttribute('data-l',cabecalhos[coluna]||'');
      celula.classList.toggle('celula-titulo',coluna===iTitulo);
      coluna++;
    }
  }
}

/* Colunas numéricas alinham à direita, e o cabeçalho vai junto.
   Decidido pelo CONTEÚDO e não por uma lista de nomes de coluna: a marca
   `.money` já é posta pelo render de cada tabela, e uma lista de nomes voltaria
   a ficar desatualizada do mesmo jeito que os `data-l` ficaram. */
function alinharColunasNumericas(tabela){
  const cabecalhos=[...tabela.querySelectorAll('thead th')];
  const linhas=[...tabela.querySelectorAll('tbody tr')].filter(l=>!l.querySelector('[colspan]'));
  if(!linhas.length) return;
  cabecalhos.forEach((th,i)=>{
    const celulas=linhas.map(l=>l.children[i]).filter(Boolean);
    if(!celulas.length) return;
    const numerica=celulas.every(td=>td.classList.contains('money')||td.classList.contains('num'));
    th.classList.toggle('num',numerica);
  });
}

/* A barra de grupos rola quando não cabe, e sem sinal a última aba some sem
   deixar rastro: no celular são 6 grupos e cabem 5. O esmaecido na direita é o
   sinal, e some ao chegar no fim — mostrar "tem mais" quando não tem é o mesmo
   defeito ao contrário. */
function marcarRolagemDasAbas(){
  // Vale para os dois níveis: a barra de grupos tem 6 e cabem 5 no celular, e a
  // de subgrupos de Vender tem 4 que também não cabem.
  const barras=[...document.querySelectorAll('nav.tabs, .subtabs')];
  const atualizar=()=>barras.forEach(b=>b.classList.toggle('tem-mais',
    b.scrollWidth-b.clientWidth-b.scrollLeft>4));
  atualizar();
  barras.forEach(b=>b.addEventListener('scroll',atualizar,{passive:true}));
  addEventListener('resize',atualizar);
  // Trocar de grupo troca a barra de subgrupos visível, e uma barra escondida
  // mede zero: remedir depois da troca.
  document.querySelectorAll('nav.tabs button').forEach(b=>b.addEventListener('click',()=>setTimeout(atualizar,0)));
}

function observarTabelas(){
  const olho=new MutationObserver(mudancas=>{
    const tabelas=new Set();
    for(const m of mudancas){
      const t=(m.target.closest && m.target.closest('table'));
      if(t) tabelas.add(t);
    }
    tabelas.forEach(t=>{rotularCelulas(t);alinharColunasNumericas(t);});
  });
  olho.observe(document.body,{childList:true,subtree:true});
  document.querySelectorAll('.tablewrap table').forEach(t=>{rotularCelulas(t);alinharColunasNumericas(t);});
  marcarRolagemDasAbas();
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',observarTabelas);
else observarTabelas();

Object.assign(window,{rotularCelulas});
