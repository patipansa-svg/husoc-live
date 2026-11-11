// ===== หน้าแอดมิน (ล็อกอิน Google @msu.ac.th) =====
import { auth, db, ROOMS, $, $$, esc, newCode, tsMs, hhmm, joinUrl, screenUrl, drawQR, DEFAULT_SND } from './common.js';
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { doc, collection, onSnapshot, setDoc, getDoc, getDocs, updateDoc, deleteDoc, query, where, orderBy, limit,
         serverTimestamp, arrayUnion, arrayRemove, getCountFromServer } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

let user = null, code = null, R = null, unsubs = [], comments = [], questions = [], wcDocs = [], peopleN = 0, aTab = 'c';
const email = () => (user && user.email || '').toLowerCase();
const isOwner = () => R && user && R.owner === user.uid;
let toastT;
function toast(m, ms = 2400){ const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }
function view(id){ ['#vLogin','#vRooms','#vRoom'].forEach(s => $(s).hidden = s !== id); }
const roomRef = () => doc(db, ROOMS, code);
const sub = p => collection(db, ROOMS, code, p);
const upd = (data, okMsg) => updateDoc(roomRef(), data).then(() => okMsg && toast(okMsg)).catch(e => toast('บันทึกไม่สำเร็จ: ' + e.code));
function confirmBox(title, text){
  return new Promise(res => {
    $('#cfTitle').textContent = title; $('#cfText').textContent = text; $('#confirm').hidden = false;
    $('#cfYes').onclick = () => { $('#confirm').hidden = true; res(true); };
    $('#cfNo').onclick = () => { $('#confirm').hidden = true; res(false); };
  });
}

/* ======================= ล็อกอิน ======================= */
onAuthStateChanged(auth, u => {
  if (u && !u.isAnonymous && /@msu\.ac\.th$/i.test(u.email || '')){
    user = u; $('#who').hidden = false; $('#whoEmail').textContent = u.email;
    route();
  } else {
    if (u && !u.isAnonymous){ $('#loginErr').textContent = 'ใช้ได้เฉพาะอีเมล @msu.ac.th เท่านั้น'; signOut(auth); }
    user = null; $('#who').hidden = true; view('#vLogin');
  }
});
$('#gLogin').onclick = () => {
  $('#loginErr').textContent = '';
  const p = new GoogleAuthProvider(); p.setCustomParameters({ hd:'msu.ac.th', prompt:'select_account' });
  signInWithPopup(auth, p).catch(e => { if (e.code !== 'auth/popup-closed-by-user') $('#loginErr').textContent = 'เข้าสู่ระบบไม่สำเร็จ (' + e.code + ')'; });
};
$('#logout').onclick = () => signOut(auth);

/* ======================= เส้นทาง: ?r=CODE ======================= */
function route(){
  const r = new URLSearchParams(location.search).get('r');
  if (r) openRoom(r.toUpperCase()); else showRooms();
}
window.addEventListener('popstate', () => user && route());
function go(r){ history.pushState(null, '', r ? '?r=' + r : location.pathname); route(); }
$('#backRooms').onclick = () => go(null);

/* ======================= รายการห้อง ======================= */
async function showRooms(){
  stopRoom(); view('#vRooms');
  try {
    const [a, b] = await Promise.all([
      getDocs(query(collection(db, ROOMS), where('owner', '==', user.uid))),
      getDocs(query(collection(db, ROOMS), where('admins', 'array-contains', email())))
    ]);
    const map = new Map(); [...a.docs, ...b.docs].forEach(d => map.set(d.id, d.data()));
    const rooms = [...map].sort((x, y) => tsMs(y[1].createdAt) - tsMs(x[1].createdAt));
    $('#roomList').innerHTML = rooms.length ? rooms.map(([id, d]) => `<button class="roomCard" data-r="${id}"><b>${esc(d.title)}</b><span>รหัส ${id} · สร้าง ${new Date(tsMs(d.createdAt)).toLocaleDateString('th-TH')}${d.owner === user.uid ? '' : ' · ผู้ช่วย'}</span><span class="pill2 ${d.open === false ? 'off' : ''}">${d.open === false ? 'ปิดรับ' : 'เปิดรับ'}</span></button>`).join('')
                                            : '<div class="empty">ยังไม่มีห้อง · สร้างห้องแรกด้านบนได้เลย</div>';
  } catch(e){ $('#roomList').innerHTML = `<div class="empty">โหลดไม่สำเร็จ (${esc(e.code)}) · ตรวจว่าเพิ่มกฎ Firestore แล้วหรือยัง</div>`; }
}
$('#roomList').onclick = ev => { const b = ev.target.closest('[data-r]'); if (b) go(b.dataset.r); };
$('#newGo').onclick = async () => {
  const title = $('#newTitle').value.trim(); if (!title) return $('#newTitle').focus();
  $('#newGo').disabled = true;
  try {
    let c; for (let i = 0; i < 5; i++){ c = newCode(); if (!(await getDoc(doc(db, ROOMS, c))).exists()) break; }
    await setDoc(doc(db, ROOMS, c), { title, owner:user.uid, ownerEmail:email(), admins:[], open:true, mode:'comment', pinned:null,
      wcQuestion:'', wcRound:0, wcBanned:[], snd:{ ...DEFAULT_SND }, sndTest:0, createdAt:serverTimestamp() });
    $('#newTitle').value = ''; go(c);
  } catch(e){
    const note = $('#vRooms .note');
    if (e.code === 'permission-denied'){
      const m = 'บัญชีนี้ยังไม่มีสิทธิ์สร้างห้อง กรุณาติดต่อแอดมิน งานโสตทัศนศึกษา คุณปฏิภาน สังกะเพศ';
      toast(m, 6000); note.textContent = '⚠️ ' + m; note.style.color = 'var(--danger)'; note.style.fontWeight = '600';
    } else toast('สร้างห้องไม่สำเร็จ: ' + e.code);
  }
  $('#newGo').disabled = false;
};

/* ======================= จัดการห้อง ======================= */
function stopRoom(){ unsubs.forEach(u => u()); unsubs = []; code = null; R = null; $('#pv').src = 'about:blank'; }
function openRoom(c){
  stopRoom(); code = c; view('#vRoom');
  $('#aCode').textContent = c;
  $('#lnkScreen').value = screenUrl(c); $('#openScreen').href = screenUrl(c); $('#lnkJoin').value = joinUrl(c);
  drawQR($('#aQr'), joinUrl(c), 110);
  $('#pv').src = screenUrl(c) + '&preview=1';
  let firstR = true;
  unsubs.push(onSnapshot(roomRef(), s => {
    if (!s.exists()){ toast('ไม่พบห้องนี้'); return go(null); }
    R = s.data();
    if (firstR){ $('#aTitle').value = R.title; $('#aWcQ').value = R.wcQuestion || ''; firstR = false; }
    render();
  }, e => { toast('เปิดห้องไม่ได้: ' + e.code); go(null); }));
  unsubs.push(onSnapshot(query(sub('comments'), orderBy('ts', 'desc'), limit(100)), s => { comments = s.docs.map(d => ({ id:d.id, ...d.data({ serverTimestamps:'estimate' }) })).filter(x => !x.deleted); render(); }));
  unsubs.push(onSnapshot(query(sub('questions'), orderBy('ts', 'desc'), limit(100)), s => { questions = s.docs.map(d => ({ id:d.id, ...d.data({ serverTimestamps:'estimate' }) })).filter(x => !x.deleted); render(); }));
  unsubs.push(onSnapshot(sub('wc'), s => { wcDocs = s.docs.map(d => d.data()); render(); }));
  const cnt = () => code === c && getCountFromServer(sub('people')).then(s => { peopleN = s.data().count; render(); }).catch(() => {});
  cnt(); const iv = setInterval(cnt, 20000); unsubs.push(() => clearInterval(iv));
}
const likesOf = q => (q.likes || []).length;
const sortedQ = () => [...questions].sort((a, b) => (a.answered - b.answered) || (likesOf(b) - likesOf(a)) || (tsMs(a.ts) - tsMs(b.ts)));
const curWc = () => wcDocs.filter(a => (a.round || 0) === (R.wcRound || 0));

function render(){
  if (!R) return;
  const snd = { ...DEFAULT_SND, ...(R.snd || {}) };
  $$('#aMode button').forEach(b => b.classList.toggle('on', b.dataset.mode === R.mode));
  const o = $('#aOpen'); o.textContent = R.open ? '🟢 เปิดรับอยู่ · กดเพื่อปิดชั่วคราว' : '⏸ ปิดรับอยู่ · กดเพื่อเปิด'; o.classList.toggle('closed', !R.open);
  const wc = curWc();
  $('#aStats').innerHTML = `<div class="stat"><b>${peopleN}</b><span>ผู้เข้าร่วม</span></div><div class="stat"><b>${comments.length}</b><span>คอมเมนต์</span></div><div class="stat"><b>${wc.length}</b><span>ตอบ Word Cloud</span></div><div class="stat"><b>${questions.length}</b><span>คำถาม</span></div>`;
  // เสียง
  $('#aSndOn').textContent = snd.on ? '🔊 เสียงเปิดอยู่ · กดเพื่อปิดทั้งหมด' : '🔇 ปิดเสียงอยู่ · กดเพื่อเปิด';
  $('#aSndOn').classList.toggle('closed', !snd.on);
  $$('[data-snd]').forEach(c => { c.checked = !!snd[c.dataset.snd]; c.disabled = !snd.on; });
  if (document.activeElement !== $('#aVol')) $('#aVol').value = Math.round(snd.vol * 100);
  if (document.activeElement !== $('#aMVol')) $('#aMVol').value = Math.round(snd.musicVol * 100);
  // Word Cloud
  const banned = new Set(R.wcBanned || []), all = new Map();
  wc.forEach(a => (a.words || []).forEach(w => all.set(w, (all.get(w) || 0) + 1)));
  const top = [...all.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  $('#aWcTop').innerHTML = !R.wcQuestion ? '<span class="note">ยังไม่ได้ตั้งคำถาม</span>' : top.length ? top.map(([w, c]) => `<span class="chip ${banned.has(w) ? 'ban' : ''}">${esc(w)} <b>${c}</b><button data-ban="${esc(w)}" title="${banned.has(w) ? 'แสดงอีกครั้ง' : 'ซ่อนคำนี้'}">${banned.has(w) ? '↺' : '×'}</button></span>`).join('') : '<span class="note">ยังไม่มีคำตอบ</span>';
  // รายการ
  const pid = R.pinned && R.pinned.id;
  $('#aCc').textContent = `(${comments.length})`; $('#aQc').textContent = `(${questions.length})`;
  $('#aListC').innerHTML = comments.length ? comments.map(c => `<div class="ai ${c.id === pid ? 'pinned' : ''}"><div class="m">${esc(c.text)}${c.flagged ? '<span class="tag">กรองคำ</span>' : ''}<small>${esc(c.name)} · ${hhmm(tsMs(c.ts))}</small></div><button class="ib ${c.id === pid ? 'on' : ''}" data-act="pin" data-id="${c.id}">📌 ${c.id === pid ? 'เลิกปัก' : 'ปักหมุด'}</button><button class="ib del" data-act="del" data-id="${c.id}">🗑</button></div>`).join('') : '<div class="empty">ยังไม่มีคอมเมนต์</div>';
  const qs = sortedQ();
  $('#aListQ').innerHTML = qs.length ? qs.map(q => `<div class="ai ${q.answered ? 'ans' : ''}"><div class="m">${esc(q.text)}<small>${esc(q.name)} · 👍 ${likesOf(q)}${q.answered ? ' · ตอบแล้ว' : ''}</small></div><button class="ib ${q.answered ? 'on' : ''}" data-act="ans" data-id="${q.id}">✓ ${q.answered ? 'ยกเลิก' : 'ตอบแล้ว'}</button><button class="ib del" data-act="del" data-id="${q.id}">🗑</button></div>`).join('') : '<div class="empty">ยังไม่มีคำถาม</div>';
  // ผู้ช่วย / ปุ่มเจ้าของ
  $('#coCard').hidden = !isOwner(); $('#aDelete').hidden = !isOwner();
  $('#coList').innerHTML = (R.admins || []).length ? R.admins.map(e => `<span class="chip">${esc(e)}<button data-co="${esc(e)}" title="เอาออก">×</button></span>`).join('') : '<span class="note">ยังไม่มีผู้ช่วย</span>';
}

/* ---------- ปุ่มควบคุม ---------- */
$('#aSaveTitle').onclick = () => { const t = $('#aTitle').value.trim(); if (t) upd({ title:t }, 'บันทึกชื่องานแล้ว'); };
$('#aMode').onclick = ev => { const b = ev.target.closest('button'); if (b) upd({ mode:b.dataset.mode }); };
$('#aOpen').onclick = () => upd({ open: !R.open });
const sndNow = () => ({ ...DEFAULT_SND, ...(R.snd || {}) });
$('#aSndOn').onclick = () => upd({ snd:{ ...sndNow(), on: !sndNow().on } });
$$('[data-snd]').forEach(c => c.onchange = () => upd({ snd:{ ...sndNow(), [c.dataset.snd]: c.checked } }));
let volT;
const volSave = () => { clearTimeout(volT); volT = setTimeout(() => upd({ snd:{ ...sndNow(), vol: $('#aVol').value / 100, musicVol: $('#aMVol').value / 100 } }), 400); };
$('#aVol').oninput = volSave; $('#aMVol').oninput = volSave;
$('#aTest').onclick = () => upd({ sndTest: Date.now() }, 'ส่งเสียงทดสอบไปที่จอนำเสนอแล้ว');
$('#aWcSet').onclick = async () => {
  const q = $('#aWcQ').value.trim(); if (!q) return $('#aWcQ').focus();
  const old = wcDocs.length;
  await upd({ wcQuestion:q, wcRound:Date.now(), wcBanned:[], mode:'wordcloud' }, 'ตั้งคำถามแล้ว · จอสลับเป็น Word Cloud');
  if (old) deleteAll(['wc']).catch(() => {});      // ล้างคำตอบรอบก่อนทิ้ง ประหยัดพื้นที่
};
$('#aWcTop').onclick = ev => { const b = ev.target.closest('[data-ban]'); if (!b) return; const w = b.dataset.ban;
  upd({ wcBanned: (R.wcBanned || []).includes(w) ? arrayRemove(w) : arrayUnion(w) }); };
$$('.aTabs button').forEach(b => b.onclick = () => {
  aTab = b.dataset.at; $$('.aTabs button').forEach(x => x.classList.toggle('on', x === b));
  $('#aListC').hidden = aTab !== 'c'; $('#aListQ').hidden = aTab !== 'q';
});
$('#aListC').onclick = ev => {
  const b = ev.target.closest('button'); if (!b) return;
  const c = comments.find(x => x.id === b.dataset.id); if (!c) return;
  if (b.dataset.act === 'pin'){
    const on = !(R.pinned && R.pinned.id === c.id);
    upd(on ? { pinned:{ id:c.id, name:c.name, text:c.text }, ...(R.mode === 'postit' ? {} : { mode:'comment' }) } : { pinned:null });
  }
  if (b.dataset.act === 'del'){
    updateDoc(doc(db, ROOMS, code, 'comments', c.id), { deleted:true }).catch(e => toast('ลบไม่สำเร็จ: ' + e.code));
    if (R.pinned && R.pinned.id === c.id) upd({ pinned:null });
  }
};
$('#aListQ').onclick = ev => {
  const b = ev.target.closest('button'); if (!b) return;
  const q = questions.find(x => x.id === b.dataset.id); if (!q) return;
  const ref = doc(db, ROOMS, code, 'questions', q.id);
  (b.dataset.act === 'ans' ? updateDoc(ref, { answered: !q.answered }) : updateDoc(ref, { deleted:true })).catch(e => toast('ไม่สำเร็จ: ' + e.code));
};
$('#coAdd').onclick = () => {
  const e = $('#coEmail').value.trim().toLowerCase();
  if (!/^[^@\s]+@msu\.ac\.th$/.test(e)) return toast('ใส่อีเมล @msu.ac.th ให้ถูกต้อง');
  upd({ admins: arrayUnion(e) }, 'เพิ่มผู้ช่วยแล้ว'); $('#coEmail').value = '';
};
$('#coList').onclick = ev => { const b = ev.target.closest('[data-co]'); if (b) upd({ admins: arrayRemove(b.dataset.co) }); };
$$('[data-copy]').forEach(b => b.onclick = async () => {
  const inp = $('#' + b.dataset.copy);
  try { await navigator.clipboard.writeText(inp.value); toast('คัดลอกลิงก์แล้ว'); } catch(e){ inp.select(); toast('กด Ctrl+C เพื่อคัดลอก'); }
});
$('#qrDl').onclick = () => {
  const box = document.createElement('div'); drawQR(box, joinUrl(code), 800);
  setTimeout(() => {
    const cv = box.querySelector('canvas'); if (!cv) return toast('สร้าง QR ไม่สำเร็จ');
    const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = 'QR-' + code + '.png'; a.click();
  }, 100);
};

/* ---------- ส่งออก / ล้าง / ลบ ---------- */
$('#aExport').onclick = async () => {
  $('#busy').textContent = 'กำลังเตรียมไฟล์…';
  try {
    const [c, q, w] = await Promise.all([getDocs(sub('comments')), getDocs(sub('questions')), getDocs(sub('wc'))]);
    const f = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const dt = t => new Date(tsMs(t)).toLocaleString('th-TH');
    const rows = [['เวลา','ประเภท','ชื่อ','ข้อความ','จำนวนโหวต','สถานะ']];
    c.docs.map(d => d.data()).sort((a, b) => tsMs(a.ts) - tsMs(b.ts)).forEach(x => rows.push([dt(x.ts), 'คอมเมนต์', x.name, x.text, '', x.deleted ? 'ถูกลบ' : (x.flagged ? 'กรองคำ' : 'แสดง')]));
    q.docs.map(d => d.data()).sort((a, b) => tsMs(a.ts) - tsMs(b.ts)).forEach(x => rows.push([dt(x.ts), 'คำถาม', x.name, x.text, likesOf(x), x.deleted ? 'ถูกลบ' : (x.answered ? 'ตอบแล้ว' : 'รอตอบ')]));
    w.docs.map(d => d.data()).filter(x => (x.round || 0) === (R.wcRound || 0)).forEach(x => rows.push([dt(x.ts), 'Word Cloud: ' + (R.wcQuestion || ''), x.name, (x.words || []).join(' / '), '', '']));
    const blob = new Blob(['﻿' + rows.map(r => r.map(f).join(',')).join('\r\n')], { type:'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `HUSOC-Live-${code}.csv`; a.click();
    $('#busy').textContent = 'ดาวน์โหลดแล้ว ✓';
  } catch(e){ $('#busy').textContent = 'ส่งออกไม่สำเร็จ: ' + e.code; }
};
async function deleteAll(paths){
  for (const p of paths){
    while (true){
      const s = await getDocs(query(sub(p), limit(100))); if (s.empty) break;
      await Promise.all(s.docs.map(d => deleteDoc(d.ref)));
    }
  }
}
const SUBS = ['comments','questions','wc','emojis','people'];
$('#aClear').onclick = async () => {
  if (!await confirmBox('ล้างข้อความทั้งหมด?', 'คอมเมนต์ คำถาม คำตอบ Word Cloud และรายชื่อผู้เข้าร่วมของห้องนี้จะถูกลบถาวร (แนะนำให้ดาวน์โหลด CSV ก่อน) ห้องและลิงก์/QR เดิมยังใช้ต่อได้')) return;
  $('#busy').textContent = 'กำลังล้างข้อมูล…';
  try { await deleteAll(SUBS); await upd({ pinned:null, wcQuestion:'', wcBanned:[] }); $('#busy').textContent = 'ล้างข้อมูลแล้ว ✓'; }
  catch(e){ $('#busy').textContent = 'ล้างไม่สำเร็จ: ' + e.code; }
};
$('#aDelete').onclick = async () => {
  if (!await confirmBox('ลบห้องนี้ถาวร?', 'ข้อมูลทั้งหมดของห้องจะหายไป และลิงก์/QR ของห้องนี้จะใช้ไม่ได้อีก (แนะนำให้ดาวน์โหลด CSV ก่อน)')) return;
  $('#busy').textContent = 'กำลังลบห้อง…';
  const c = code;
  try { await deleteAll(SUBS); stopRoom(); await deleteDoc(doc(db, ROOMS, c)); toast('ลบห้องแล้ว'); go(null); }
  catch(e){ $('#busy').textContent = 'ลบไม่สำเร็จ: ' + e.code; }
};
