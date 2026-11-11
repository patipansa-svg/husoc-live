// ===== หน้ามือถือผู้เข้าร่วม =====
import { auth, db, ROOMS, $, $$, esc, clean, normWord, roomCodeFromUrl, hhmm, tsMs } from './common.js';
import { signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { doc, collection, onSnapshot, addDoc, setDoc, getDoc, updateDoc, query, orderBy, limit,
         serverTimestamp, arrayUnion, arrayRemove } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const code = roomCodeFromUrl();
let me = null;            // uid จาก Firebase (ไม่ต้องล็อกอิน)
let R = null;             // ข้อมูลห้อง
let myName = null, lastSend = 0, toastT, lastWcRound = null, lastMode = null, qUnsub = null, questions = [];
const LS = k => 'husoc-live:' + code + ':' + k;
const lsGet = (k, d) => { try { const v = localStorage.getItem(LS(k)); return v ? JSON.parse(v) : d; } catch(e){ return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(LS(k), JSON.stringify(v)); } catch(e){} };

function show(id){ ['#pCode','#pLoad','#pJoin','#pMain'].forEach(s => { const el = $(s); el.hidden = s !== id; if (s === '#pMain') el.style.display = s === id ? 'flex' : ''; }); }
function toast(m){ const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200); }
function shake(el){ el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); el.focus(); }
const room = () => doc(db, ROOMS, code);

/* ---------- 1) ไม่มีรหัสห้องในลิงก์ → ให้พิมพ์เอง ---------- */
if (!code){
  show('#pCode');
  const go = () => { const c = $('#pCodeIn').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); if (!c) return shake($('#pCodeIn')); location.search = '?c=' + c; };
  $('#pCodeGo').onclick = go; $('#pCodeIn').onkeydown = e => { if (e.key === 'Enter') go(); };
} else start();

function start(){
  show('#pLoad');
  let tried = false;
  onAuthStateChanged(auth, u => {
    if (u){ if (!me){ me = u.uid; listenRoom(); } return; }
    if (tried) return; tried = true;   // ยังไม่มีใครล็อกอิน → เข้าแบบไม่ระบุตัวตน (ผู้เข้าร่วมไม่ต้องล็อกอิน)
    signInAnonymously(auth).catch(e => { $('#pLoadMsg').textContent = 'เชื่อมต่อไม่สำเร็จ'; $('#pLoadSub').textContent = 'ลองรีเฟรชหน้านี้อีกครั้ง (' + e.code + ')'; });
  });
}

/* ---------- 2) ฟังข้อมูลห้อง ---------- */
function listenRoom(){
  onSnapshot(room(), snap => {
    if (!snap.exists()){ R = null; show('#pLoad'); $('#pLoadMsg').textContent = 'ไม่พบห้อง ' + code; $('#pLoadSub').textContent = 'ห้องอาจถูกปิดไปแล้ว หรือรหัสไม่ถูกต้อง'; return; }
    R = snap.data();
    if (!myName){
      const saved = lsGet('name', null);
      if (saved){ myName = saved; enterMain(); } else { show('#pJoin'); $('#pjTitle').textContent = R.title; }
    }
    render();
    if (R.mode !== lastMode){
      if (lastMode !== null && myName){ if (R.mode === 'wordcloud' && R.wcQuestion) setTab('wc'); else if (R.mode === 'qa') setTab('qa'); }
      lastMode = R.mode;
    }
  }, err => { show('#pLoad'); $('#pLoadMsg').textContent = 'เชื่อมต่อไม่สำเร็จ'; $('#pLoadSub').textContent = err.code; });
}

/* ---------- 3) ใส่ชื่อ ---------- */
function join(){
  const n = $('#pName').value.trim(); if (!n) return shake($('#pName'));
  myName = n.slice(0, 20); lsSet('name', myName); enterMain();
}
function enterMain(){
  show('#pMain'); render();
  setDoc(doc(db, ROOMS, code, 'people', me), { name: myName, ts: serverTimestamp() }).catch(() => {});
  if (R && R.mode === 'wordcloud' && R.wcQuestion) setTab('wc'); else if (R && R.mode === 'qa') setTab('qa');
}
$('#pJoinBtn').onclick = join;
$('#pName').onkeydown = e => { if (e.key === 'Enter') join(); };
$('#pRename').onclick = () => { show('#pJoin'); $('#pjTitle').textContent = R ? R.title : ''; $('#pName').value = myName || ''; myName = null; lsSet('name', null); };

/* ---------- แท็บ ---------- */
let tab = 'comment';
function setTab(t){
  tab = t;
  $$('.pTabs button').forEach(x => x.classList.toggle('on', x.dataset.pt === t));
  $('#ptComment').hidden = t !== 'comment'; $('#ptQa').hidden = t !== 'qa'; $('#ptWc').hidden = t !== 'wc';
  // ฟังรายการคำถามเฉพาะตอนเปิดแท็บนี้ เพื่อประหยัดโควตา
  if (t === 'qa' && !qUnsub){
    qUnsub = onSnapshot(query(collection(db, ROOMS, code, 'questions'), orderBy('ts', 'desc'), limit(40)), s => {
      questions = s.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) })).filter(q => !q.deleted);
      renderQ();
    });
  } else if (t !== 'qa' && qUnsub){ qUnsub(); qUnsub = null; }
}
$$('.pTabs button').forEach(b => b.onclick = () => setTab(b.dataset.pt));

/* ---------- คอมเมนต์ ---------- */
const EMO = ['❤️','👏','😂','😮','🔥','👍','💜'];
$('#emoRow').innerHTML = EMO.map(e => `<button data-e="${e}">${e}</button>`).join('');
// รวมการกดอีโมจิทุก ~1 วินาทีเป็นข้อมูลเดียว เพื่อประหยัดโควตา
const emoBuf = {}; let emoT = null;
$('#emoRow').onclick = ev => {
  const b = ev.target.closest('button'); if (!b) return;
  if (!R || !R.open) return toast('ปิดรับข้อความชั่วคราว');
  emoBuf[b.dataset.e] = Math.min(10, (emoBuf[b.dataset.e] || 0) + 1);
  if (!emoT) emoT = setTimeout(flushEmo, 1000);
};
function flushEmo(){
  emoT = null;
  for (const [e, n] of Object.entries(emoBuf)){
    delete emoBuf[e];
    addDoc(collection(db, ROOMS, code, 'emojis'), { e, n, uid: me, ts: serverTimestamp() }).catch(() => {});
  }
}
$('#pText').oninput = () => $('#pCnt').textContent = $('#pText').value.length;
$('#pSend').onclick = async () => {
  const t = $('#pText').value.trim();
  if (!R || !R.open) return toast('ปิดรับข้อความชั่วคราว');
  if (!t) return shake($('#pText'));
  const wait = 3000 - (Date.now() - lastSend);
  if (wait > 0) return toast(`รออีก ${Math.ceil(wait / 1000)} วินาที แล้วส่งได้อีกครั้ง`);
  lastSend = Date.now();
  const c = clean(t.slice(0, 120));
  $('#pText').value = ''; $('#pCnt').textContent = 0;
  try {
    await addDoc(collection(db, ROOMS, code, 'comments'), { name: myName, text: c.text, flagged: c.flagged, uid: me, deleted: false, ts: serverTimestamp() });
    const mine = lsGet('mine', []); mine.unshift({ text: c.text, at: Date.now() }); lsSet('mine', mine.slice(0, 10));
    toast(c.flagged ? 'ส่งแล้ว · ระบบกรองคำไม่สุภาพให้แล้ว' : 'ขึ้นจอแล้ว ✓'); render();
  } catch(e){ $('#pText').value = t; toast('ส่งไม่สำเร็จ ลองใหม่อีกครั้ง'); }
};

/* ---------- Word Cloud ---------- */
$('#pWcSend').onclick = async () => {
  if (!R || !R.open) return toast('ปิดรับข้อความชั่วคราว');
  const ins = $$('[data-wc]'); let rude = false;
  const words = [...new Set(ins.map(i => normWord(i.value)).filter(Boolean))].filter(w => { if (clean(w).flagged){ rude = true; return false; } return true; });
  if (!words.length) return rude ? toast('มีคำไม่สุภาพ ระบบไม่รับคำนั้นนะ') : shake(ins[0]);
  try {
    await setDoc(doc(db, ROOMS, code, 'wc', me), { name: myName, words, round: R.wcRound || 0, uid: me, ts: serverTimestamp() });
    lsSet('wc', { round: R.wcRound || 0, words }); render();
    toast(rude ? 'ส่งแล้ว · ตัดคำไม่สุภาพออกให้แล้ว' : 'ส่งคำตอบแล้ว ✓ ดูบนจอได้เลย');
  } catch(e){ toast('ส่งไม่สำเร็จ ลองใหม่อีกครั้ง'); }
};

/* ---------- ถามวิทยากร ---------- */
$('#pAsk').onclick = async () => {
  const t = $('#pQ').value.trim();
  if (!R || !R.open) return toast('ปิดรับข้อความชั่วคราว');
  if (!t) return shake($('#pQ'));
  const c = clean(t.slice(0, 150)); $('#pQ').value = '';
  try { await addDoc(collection(db, ROOMS, code, 'questions'), { name: myName, text: c.text, flagged: c.flagged, uid: me, likes: [], answered: false, deleted: false, ts: serverTimestamp() }); toast('ส่งคำถามแล้ว ✓'); }
  catch(e){ $('#pQ').value = t; toast('ส่งไม่สำเร็จ ลองใหม่อีกครั้ง'); }
};
$('#pQList').onclick = ev => {
  const b = ev.target.closest('[data-like]'); if (!b) return;
  const q = questions.find(x => x.id === b.dataset.like); if (!q) return;
  const liked = (q.likes || []).includes(me);
  updateDoc(doc(db, ROOMS, code, 'questions', q.id), { likes: liked ? arrayRemove(me) : arrayUnion(me) }).catch(() => toast('กดไม่สำเร็จ'));
};
function renderQ(){
  const qs = [...questions].sort((a, b) => (a.answered - b.answered) || ((b.likes || []).length - (a.likes || []).length) || (tsMs(a.ts) - tsMs(b.ts)));
  $('#pQList').innerHTML = qs.length ? qs.map(q => { const n = (q.likes || []).length, on = (q.likes || []).includes(me);
    return `<div class="qi ${q.answered ? 'ans' : ''}"><div class="q">${esc(q.text)}<small>${esc(q.name)}${q.answered ? ' · ✓ ตอบแล้ว' : ''}</small></div><button class="like ${on ? 'on' : ''}" data-like="${q.id}">👍 ${n}</button></div>`; }).join('')
    : '<div class="empty" style="padding:10px">ยังไม่มีคำถาม</div>';
}

/* ---------- วาดหน้าจอ ---------- */
function render(){
  if (!R) return;
  $('#pTitle').textContent = R.title; $('#pMe').textContent = myName || '';
  $('#pClosed').hidden = !!R.open;
  ['#pSend','#pAsk','#pWcSend'].forEach(s => $(s).disabled = !R.open);
  $('#pTabWc').hidden = !R.wcQuestion;
  if (!R.wcQuestion && tab === 'wc') setTab('comment');
  $('#pWcQ').textContent = '☁️ ' + (R.wcQuestion || '');
  const myWc = lsGet('wc', null), round = R.wcRound || 0;
  if (lastWcRound !== round){ lastWcRound = round; $$('[data-wc]').forEach((i, k) => i.value = myWc && myWc.round === round ? (myWc.words[k] || '') : ''); }
  const has = myWc && myWc.round === round;
  $('#pWcMine').hidden = !has; if (has) $('#pWcMine').textContent = '✓ คำตอบของคุณ: ' + myWc.words.join(' · ');
  $('#pWcSend').textContent = has ? 'แก้ไขคำตอบ' : 'ส่งคำตอบ';
  const mine = lsGet('mine', []).slice(0, 5);
  $('#pMine').innerHTML = mine.length ? mine.map(c => `<div class="myc">${esc(c.text)}<div class="st">✓ ส่งแล้ว · ${hhmm(c.at)}</div></div>`).join('') : '<div class="empty" style="padding:10px">ยังไม่มีข้อความ</div>';
}
