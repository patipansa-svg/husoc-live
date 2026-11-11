// ===== จอนำเสนอ (เปิดบนเครื่องที่ต่อโปรเจกเตอร์) =====
import { db, ROOMS, $, esc, avatar, hue, hashStr, pick, roomCodeFromUrl, joinUrl, tsMs, drawQR, DEFAULT_SND } from './common.js';
import { doc, collection, onSnapshot, query, orderBy, limit, where, Timestamp, getCountFromServer } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const code = roomCodeFromUrl();
const PREVIEW = new URLSearchParams(location.search).get('preview') === '1';
if (PREVIEW) document.body.classList.add('preview');
const msg = (h, sub = '') => { $('#msg').hidden = false; $('#msg h2').textContent = h; $('#msgSub').textContent = sub; };

const S = { title:'', code, open:true, mode:'comment', comments:[], questions:[], people:0, pinned:null,
            wc:{ question:'', round:0, answers:new Map(), banned:new Set() } };
let wcAll = new Map();
const SND = { ...DEFAULT_SND };
const FLY = ['danmaku','bubble'], WIDE = ['danmaku','postit','bubble','wordcloud'];
const visC = () => S.comments;
const visQ = () => S.questions;
const likesOf = q => (q.likes || []).length;
const sortedQ = () => [...S.questions].sort((a,b) => (a.answered - b.answered) || (likesOf(b) - likesOf(a)) || (tsMs(a.ts) - tsMs(b.ts)));
function wcCounts(){
  const m = new Map();
  for (const a of S.wc.answers.values()) for (const w of a.words || []) m.set(w, (m.get(w) || 0) + 1);
  return [...m.entries()].filter(([w]) => !S.wc.banned.has(w)).sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/* ======================= เริ่มต้น ======================= */
if (!code) msg('ไม่พบรหัสห้อง', 'เปิดลิงก์จอนำเสนอจากหน้าแอดมิน');
else setTimeout(listen, 0);   // จอนำเสนออ่านอย่างเดียว ไม่ต้องล็อกอิน (รอให้โค้ดทั้งไฟล์พร้อมก่อน)

let first = { c:true, q:true, w:true }, lastSndTest = null, loadAt = Date.now();
function listen(){
  const R = path => collection(db, ROOMS, code, path);
  onSnapshot(doc(db, ROOMS, code), snap => {
    if (!snap.exists()) return msg('ไม่พบห้อง ' + code, 'ห้องอาจถูกลบไปแล้ว');
    $('#msg').hidden = true;
    const d = snap.data(), prevMode = S.mode, prevPin = S.pinned && S.pinned.id;
    S.title = d.title || ''; S.open = d.open !== false; S.mode = d.mode || 'comment';
    S.pinned = d.pinned || null;
    S.wc.question = d.wcQuestion || ''; S.wc.banned = new Set(d.wcBanned || []);
    if ((d.wcRound || 0) !== S.wc.round){ S.wc.round = d.wcRound || 0; prevPos = new Map(); const w = $('#wc'); if (w) w.innerHTML = ''; }
    filterWc();
    Object.assign(SND, DEFAULT_SND, d.snd || {}); applyMusic(); renderSndUI();
    if (lastSndTest !== null && d.sndTest && d.sndTest !== lastSndTest){ lastPlay.h = 0; SFX.highlight(); }
    lastSndTest = d.sndTest || 0;
    if (S.pinned && S.pinned.id !== prevPin) SFX.highlight();
    if (prevMode !== S.mode) checkTop(true);
    renderScreen();
  }, e => msg('เชื่อมต่อไม่สำเร็จ', e.code));

  onSnapshot(query(R('comments'), orderBy('ts', 'desc'), limit(40)), snap => {
    S.comments = snap.docs.map(d => ({ id:d.id, ...d.data({ serverTimestamps:'estimate' }) })).filter(c => !c.deleted).reverse();
    if (!first.c) snap.docChanges().forEach(ch => { if (ch.type === 'added'){ const c = { id:ch.doc.id, ...ch.doc.data({ serverTimestamps:'estimate' }) }; if (!c.deleted){ SFX.comment(); if (FLY.includes(S.mode)) launch(c); } } });
    else S.comments.forEach(c => seen.add(c.id));
    first.c = false; renderScreen();
  });

  onSnapshot(query(R('questions'), orderBy('ts', 'desc'), limit(60)), snap => {
    S.questions = snap.docs.map(d => ({ id:d.id, ...d.data({ serverTimestamps:'estimate' }) })).filter(q => !q.deleted);
    if (!first.q && snap.docChanges().some(ch => ch.type === 'added')) SFX.question();
    first.q = false; checkTop(false); renderScreen();
  });

  onSnapshot(R('wc'), snap => {
    wcAll = new Map(snap.docs.map(d => [d.id, d.data()]));
    filterWc();
    if (!first.w && S.mode === 'wordcloud' && snap.docChanges().some(ch => ch.type !== 'removed')) SFX.wc();
    first.w = false; renderScreen();
  });

  onSnapshot(query(R('emojis'), where('ts', '>', Timestamp.fromMillis(loadAt - 2000)), orderBy('ts')), snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type !== 'added') return;
      const { e, n } = ch.doc.data(); const k = Math.min(6, n || 1);
      for (let i = 0; i < k; i++) setTimeout(() => { floatEmoji(e); if (i === 0) SFX.emoji(e); }, i * 160 + Math.random() * 120);
    });
  });

  const count = () => getCountFromServer(R('people')).then(s => { S.people = s.data().count; renderStats(); }).catch(() => {});
  count(); setInterval(count, 20000);
}
function filterWc(){ S.wc.answers = new Map([...wcAll].filter(([, a]) => (a.round || 0) === S.wc.round)); }
let topId = null;
function checkTop(reset){
  const top = sortedQ().find(q => !q.answered && likesOf(q) > 0), id = top ? top.id : null;
  if (!reset && S.mode === 'qa' && id && topId && id !== topId) SFX.highlight();
  topId = id;
}

/* ======================= วาดจอ ======================= */
const seen = new Set();
function renderStats(){
  $('#sStats').textContent = S.mode === 'wordcloud'
    ? `👥 ${S.people} คน   ·   ☁️ ${S.wc.answers.size} คนตอบ   ·   ${wcCounts().length} คำ`
    : `👥 ${S.people} คน   ·   💬 ${visC().length} ข้อความล่าสุด   ·   🙋 ${visQ().length} คำถาม`;
}
let qrDone = false;
function renderScreen(){
  if (!qrDone){ drawQR($('#qrBox'), joinUrl(code), 220); drawQR($('#qrMiniBox'), joinUrl(code), 104); qrDone = true; }
  document.title = (S.title || 'จอนำเสนอ') + ' — HUSOC Live';
  $('#sTitle').textContent = S.title;
  $('#sCode').textContent = code; $('#sCode2').textContent = code;
  $('#sUrl').textContent = joinUrl(code).replace(/^https?:\/\//, '');
  $('#qrHead').textContent = S.mode === 'qa' ? 'สแกนเพื่อถามวิทยากร' : 'สแกนเพื่อคอมเมนต์';
  $('#qrMiniTx').textContent = S.mode === 'wordcloud' ? 'สแกนเพื่อตอบ' : 'สแกนเพื่อคอมเมนต์';
  $('#sClosed').hidden = S.open;
  renderStats();
  $('#stage').classList.toggle('wide', WIDE.includes(S.mode));
  const body = $('#sBody'), pin = $('#sPin');
  const changed = body.dataset.m !== S.mode;
  if (changed){ body.dataset.m = S.mode; body.innerHTML = ''; pin.innerHTML = ''; pin.dataset.k = ''; }
  body.className = 'sBody m-' + S.mode;
  if (S.mode === 'comment') renderList(body, pin);
  else if (S.mode === 'qa') renderQA(body);
  else if (S.mode === 'postit') renderPostit(body);
  else if (S.mode === 'wordcloud') scheduleCloud(changed);
  else { if (changed) prepFly(body); pruneFly(body); }
}
const emptyMsg = t => `<div class="sEmpty">${t}</div>`;
function renderList(body, pin){
  const list = visC().slice(-8);
  body.innerHTML = list.length ? list.map(c => `<div class="bub ${seen.has(c.id) ? '' : 'new'}">${avatar(c.name)}<div><div class="nm">${esc(c.name)}</div><div class="tx">${esc(c.text)}</div></div></div>`).join('')
                               : emptyMsg('สแกน QR ทางขวา แล้วส่งคอมเมนต์แรกได้เลย 💬');
  list.forEach(c => seen.add(c.id));
  const p = S.pinned;
  const pk = p ? p.id + '|' + p.text : ''; if (pin.dataset.k === pk) return; pin.dataset.k = pk;
  pin.innerHTML = p ? `<div class="pinCard"><div class="pinTag">📌 ข้อความเด่น</div><div class="pinText">${esc(p.text)}</div><div class="pinName">— ${esc(p.name)}</div></div>` : '';
}
function renderQA(body){
  const qs = sortedQ().filter(q => !q.answered).slice(0, 5);
  body.innerHTML = '<div class="qaHead">🙋 คำถามถึงวิทยากร · เรียงตามจำนวนโหวต</div>' +
    (qs.length ? qs.map((q,i) => `<div class="qrow ${i === 0 ? 'top1' : ''}"><div class="rank">${i + 1}</div><div class="qtx">${esc(q.text)}<small>${esc(q.name)}</small></div><div class="votes">👍 ${likesOf(q)}</div></div>`).join('')
               : emptyMsg('ยังไม่มีคำถาม · สแกน QR เพื่อส่งคำถามได้เลย'));
}
const NOTE = ['#fff3a8','#ffd1dc','#c8f7d4','#cfe6ff','#ffe0b8','#e6d6ff'];
function renderPostit(body){
  const list = visC().slice(-15).reverse();
  body.innerHTML = list.length ? '<div class="board">' + list.map(c => {
      const h = hashStr(c.id), rot = ((h % 9) - 4) * 0.9, len = [...c.text].length;
      const fs = len < 25 ? 26 : len < 50 ? 21 : len < 80 ? 18 : 16;
      return `<div class="sticky ${seen.has('n' + c.id) ? '' : 'new'} ${S.pinned && c.id === S.pinned.id ? 'pinned' : ''}" style="--r:${rot}deg;background:${NOTE[h % NOTE.length]}"><div class="ntx" style="font-size:${fs}px">${esc(c.text)}</div><div class="nnm">— ${esc(c.name)}</div></div>`;
    }).join('') + '</div>' : emptyMsg('กระดานยังว่างอยู่ · สแกน QR แล้วแปะข้อความแรกได้เลย 📝');
  list.forEach(c => seen.add('n' + c.id));
}

/* วิ่งข้ามจอ + ฟองสบู่ */
const LANES = 8; let laneFree = [], bubCol = 0;
function prepFly(body){
  body.innerHTML = '<div class="fly" id="fly"></div>'; laneFree = new Array(LANES).fill(0);
  visC().slice(-6).forEach((c,i) => setTimeout(() => launch(c), i * 700));
}
function pruneFly(body){ const ids = new Set(S.comments.map(c => c.id)); body.querySelectorAll('[data-id]').forEach(el => { if (!ids.has(el.dataset.id)) el.remove(); }); }
function launch(c){
  const fly = $('#fly'); if (!fly || !FLY.includes(S.mode)) return;
  if (S.mode === 'danmaku'){
    const el = document.createElement('div'); el.className = 'dm'; el.dataset.id = c.id;
    el.innerHTML = `${avatar(c.name)}<span class="dn">${esc(c.name)}</span><span class="dt">${esc(c.text)}</span>`;
    el.style.visibility = 'hidden'; fly.appendChild(el);
    const w = el.offsetWidth, now = performance.now();
    let lane = 0; for (let i = 1; i < LANES; i++) if (laneFree[i] < laneFree[lane]) lane = i;
    const delay = Math.max(0, laneFree[lane] - now);
    if (delay > 5000){ el.remove(); return; }
    const speed = 170, W = 1200;
    el.style.top = (lane * 68 + 4) + 'px'; el.style.visibility = '';
    laneFree[lane] = now + delay + (w + 90) / speed * 1000;
    const a = el.animate([{transform:`translateX(${W}px)`},{transform:`translateX(${-w - 20}px)`}], {duration:(W + w + 20) / speed * 1000, delay, easing:'linear', fill:'both'});
    a.onfinish = () => el.remove();
  } else {
    if (fly.children.length >= 8) return;
    const len = [...c.text].length, d = Math.round(Math.min(220, Math.max(140, 115 + len * 2.2)));
    const el = document.createElement('div'); el.className = 'bb'; el.dataset.id = c.id;
    el.style.width = el.style.height = d + 'px';
    const col = (bubCol = (bubCol + 2 + Math.floor(Math.random() * 2)) % 6);
    el.style.left = Math.round(Math.max(0, Math.min(1070 - d, col * 178 + 89 - d / 2 + (Math.random() * 40 - 20)))) + 'px';
    el.style.setProperty('--bh', `hsla(${hue(c.name)},70%,60%,.55)`);
    el.innerHTML = `<div class="bt" style="font-size:${len < 20 ? 22 : len < 45 ? 18 : 15}px">${esc(c.text)}</div><div class="bn">${esc(c.name)}</div>`;
    fly.appendChild(el);
    const H = fly.clientHeight || 550, sway = 30 + Math.random() * 40;
    const a = el.animate([
      {transform:`translate(0,${H}px) scale(.5)`, opacity:0},
      {transform:`translate(${sway}px,${H * .62}px) scale(1)`, opacity:1, offset:.15},
      {transform:`translate(${-sway}px,${H * .22}px) scale(1)`, opacity:1, offset:.65},
      {transform:`translate(${sway / 2}px,${-d - 30}px) scale(1.05)`, opacity:0}
    ], {duration:12000 + Math.random() * 5000, easing:'ease-in-out', fill:'both'});
    a.onfinish = () => el.remove();
  }
}
setInterval(() => {
  if (!FLY.includes(S.mode)) return; const fly = $('#fly'); if (!fly) return;
  if (fly.children.length < (S.mode === 'danmaku' ? 6 : 7)){ const onS = new Set([...fly.children].map(e => e.dataset.id)); const r = visC().slice(-30).filter(c => !onS.has(c.id)); if (r.length) launch(pick(r)); }
}, 2000);

/* Word Cloud */
const CC = ['#f5b841','#ff7eb6','#5ee6b0','#7cc4ff','#c9a7ff','#ffffff','#ff9f6b','#9ef0ff'];
const mctx = document.createElement('canvas').getContext('2d');
let cloudT = null, cloudLast = 0, prevPos = new Map();
function scheduleCloud(now){
  if (now){ layoutCloud(); return; }
  if (cloudT) return;
  cloudT = setTimeout(() => { cloudT = null; layoutCloud(); }, Math.max(0, 2500 - (Date.now() - cloudLast)));
}
function layoutCloud(){
  cloudLast = Date.now();
  if (S.mode !== 'wordcloud') return;
  const body = $('#sBody');
  let wrap = $('#wc');
  if (!wrap){ body.innerHTML = '<div class="wcQ" id="wcQ"></div><div class="wc" id="wc"></div>'; wrap = $('#wc'); }
  $('#wcQ').innerHTML = `${esc(S.wc.question || 'ยังไม่ได้ตั้งคำถาม')}<span>☁️ ตอบแล้ว ${S.wc.answers.size} คน · พิมพ์คนละ 1–3 คำ</span>`;
  const W = 1200, H = 440, cx = W / 2, cy = H / 2;
  const words = wcCounts().slice(0, 60);
  const max = words.length ? words[0][1] : 1;
  const placed = [{x:1060, y:270, w:140, h:170}];
  const hit = r => placed.some(p => r.x < p.x + p.w + 6 && r.x + r.w + 6 > p.x && r.y < p.y + p.h + 2 && r.y + r.h + 2 > p.y);
  const out = [];
  words.forEach(([w, c], i) => {
    let fs = max > 1 ? 20 + 86 * Math.pow((c - 1) / (max - 1), 0.75) : (words.length < 8 ? 50 : 30);
    const rot = i > 2 && hashStr(w) % 4 === 0;
    for (let tries = 0; tries < 4; tries++, fs *= 0.82){
      mctx.font = `600 ${fs}px Prompt, sans-serif`;
      const tw = mctx.measureText(w).width + 6, th = fs * 1.3;
      const bw = rot ? th : tw, bh = rot ? tw : th;
      let found = null;
      const pv = prevPos.get(w), ox = pv && pv.rot === rot ? pv.x : cx, oy = pv && pv.rot === rot ? pv.y : cy;
      for (let t = 0; t < 2600; t++){
        const a = t * 0.1, r = 2.6 * a;
        const x = ox + r * Math.cos(a) * 1.75 - bw / 2, y = oy + r * Math.sin(a) - bh / 2;
        if (x < 0 || y < 0 || x + bw > W || y + bh > H) continue;
        const Rr = {x, y, w:bw, h:bh}; if (!hit(Rr)){ found = Rr; break; }
      }
      if (found){ placed.push(found); out.push({w, c, fs, rot, cxp:found.x + bw / 2, cyp:found.y + bh / 2, color:CC[hashStr(w) % CC.length]}); break; }
    }
  });
  prevPos = new Map(out.map(o => [o.w, {x:o.cxp, y:o.cyp, rot:o.rot}]));
  const old = new Map([...wrap.querySelectorAll('.ww')].map(e => [e.dataset.w, e]));
  wrap.querySelectorAll('.sEmpty').forEach(e => e.remove());
  out.forEach(o => {
    let el = old.get(o.w);
    if (el) old.delete(o.w);
    else { el = document.createElement('div'); el.className = 'ww new'; el.dataset.w = o.w; el.textContent = o.w; el.style.left = o.cxp + 'px'; el.style.top = o.cyp + 'px'; wrap.appendChild(el); }
    el.style.fontSize = o.fs + 'px'; el.style.color = o.color;
    el.style.left = o.cxp + 'px'; el.style.top = o.cyp + 'px';
    el.style.transform = `translate(-50%,-50%) rotate(${o.rot ? -90 : 0}deg)`;
  });
  old.forEach(e => e.remove());
  if (!out.length) wrap.insertAdjacentHTML('beforeend', emptyMsg('รอคำตอบแรก… สแกน QR แล้วพิมพ์ 1–3 คำ ☁️'));
}
if (document.fonts) document.fonts.load('600 40px Prompt').then(() => { if (S.mode === 'wordcloud') layoutCloud(); });

function floatEmoji(e){
  const L = $('#sEmoji'); const s = document.createElement('span');
  s.className = 'fl'; s.textContent = e;
  s.style.left = (4 + Math.random() * 86) + '%';
  s.style.fontSize = (42 + Math.random() * 34) + 'px';
  s.style.animationDuration = (3 + Math.random() * 1.6) + 's';
  L.appendChild(s); setTimeout(() => s.remove(), 5000);
  if (L.children.length > 45) L.firstChild.remove();
}
function fitStage(){
  const w = $('#screenWrap'), st = $('#stage');
  const W = w.clientWidth, H = w.clientHeight; if (!W) return;
  const s = Math.min(W / 1280, H / 720);
  st.style.transform = `scale(${s})`;
  st.style.left = (W - 1280 * s) / 2 + 'px'; st.style.top = (H - 720 * s) / 2 + 'px';
}
new ResizeObserver(fitStage).observe($('#screenWrap')); fitStage();
$('#fsBtn').onclick = async () => { try { await document.documentElement.requestFullscreen(); } catch(e){} };

/* ======================= เสียง ======================= */
let AC = null, master, sfxBus, musicBus, noiseBuf, musT = null, nextBeat = 0, beatIdx = 0;
const audioReady = () => !PREVIEW && AC && AC.state === 'running';
function audioInit(){
  if (PREVIEW) return;
  try {
    if (!AC){
      AC = new (window.AudioContext || window.webkitAudioContext)();
      master = AC.createGain(); master.gain.value = SND.vol; master.connect(AC.destination);
      sfxBus = AC.createGain(); sfxBus.connect(master);
      musicBus = AC.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
      noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    AC.resume().then(() => { applyMusic(); renderSndUI(); });
  } catch(e){ console.warn(e); }
}
function tone(f, t, dur, o = {}){
  const osc = AC.createOscillator(), g = AC.createGain();
  osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(f, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + (o.slide || dur));
  const pk = o.gain ?? .25, at = o.attack ?? .005;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(pk, t + at);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g); g.connect(o.dest || sfxBus); osc.start(t); osc.stop(t + dur + .05);
}
function noise(t, dur, o = {}){
  const src = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  src.buffer = noiseBuf; f.type = o.filter || 'bandpass'; f.Q.value = o.q ?? 1;
  f.frequency.setValueAtTime(o.f || 1200, t); if (o.fTo) f.frequency.exponentialRampToValueAtTime(o.fTo, t + dur);
  const pk = o.gain ?? .3, at = o.attack ?? .003;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(pk, t + at); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(sfxBus); src.start(t, Math.random() * .5); src.stop(t + dur + .05);
}
const lastPlay = {}; let voices = 0;
function canPlay(key, gap, maxV = 6, len = .4){
  if (!SND.on || !audioReady()) return false;
  const now = performance.now(); if (now - (lastPlay[key] || 0) < gap || voices >= maxV) return false;
  lastPlay[key] = now; voices++; setTimeout(() => voices--, len * 1000); return true;
}
const SFX = {
  comment(){
    if (!SND.comment || !canPlay('c', 220)) return; const t = AC.currentTime;
    switch (S.mode){
      case 'danmaku': noise(t, .38, {f:350, fTo:2600, q:1.4, gain:.22, attack:.08}); break;
      case 'postit':  noise(t, .05, {filter:'lowpass', f:2000, gain:.35}); tone(170, t, .09, {type:'triangle', gain:.3}); break;
      case 'bubble':  tone(320, t, .16, {to:760, gain:.22}); tone(620, t + .07, .14, {to:1150, gain:.12}); break;
      default:        tone(420, t, .1, {to:980, slide:.05, gain:.22}); tone(1320, t + .05, .12, {gain:.06});
    }
  },
  question(){ if (!SND.comment || !canPlay('q', 300)) return; const t = AC.currentTime; tone(660, t, .2, {type:'triangle', gain:.18}); tone(990, t + .08, .25, {type:'triangle', gain:.12}); },
  wc(){ if (!SND.comment || !canPlay('w', 260)) return; const t = AC.currentTime; const n = pick([1047,1175,1319,1568]); tone(n, t, .5, {gain:.1}); tone(n * 1.5, t + .06, .4, {gain:.05}); },
  emoji(e){
    if (!SND.emoji || !canPlay('e', 110, 7, .5)) return; const t = AC.currentTime;
    if (e === '👏') for (let i = 0; i < 5; i++) noise(t + i * .075 + Math.random() * .02, .045, {f:1400 + Math.random() * 600, q:.7, gain:.32});
    else if (e === '😂') [560,520,480,440].forEach((f,i) => tone(f, t + i * .12, .09, {type:'triangle', to:f * .85, gain:.13}));
    else if (e === '❤️' || e === '💜') [1568,2093,2637].forEach((f,i) => tone(f, t + i * .06, .32, {gain:.07}));
    else if (e === '🔥') noise(t, .45, {filter:'lowpass', f:250, fTo:1600, gain:.25, attack:.06});
    else if (e === '😮') tone(300, t, .38, {type:'triangle', to:720, gain:.14, attack:.03});
    else { tone(523, t, .16, {type:'triangle', gain:.17}); tone(784, t + .06, .2, {type:'triangle', gain:.12}); }
  },
  highlight(){
    if (!SND.highlight || !canPlay('h', 800, 9, 1.4)) return; const t = AC.currentTime;
    [1047,1319,1568,2093].forEach((f,i) => { tone(f, t + i * .09, 1.1, {gain:.16}); tone(f * 2, t + i * .09, .6, {gain:.03}); });
  }
};
const CH = [[53,57,60,64],[52,55,59,62],[50,53,57,60],[48,52,55,59]], SPB = 60 / 72;
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
function pad(f, t, dur){
  [['sine',0],['triangle',4]].forEach(([ty, det]) => {
    const o = AC.createOscillator(), g = AC.createGain(), lp = AC.createBiquadFilter();
    o.type = ty; o.frequency.value = f; o.detune.value = det; lp.type = 'lowpass'; lp.frequency.value = 1100;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(.035, t + .8); g.gain.setValueAtTime(.035, t + dur - .3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + .9);
    o.connect(lp); lp.connect(g); g.connect(musicBus); o.start(t); o.stop(t + dur + 1);
  });
}
function schedBeat(t, i){
  const ch = CH[Math.floor(i / 8) % 4];
  if (i % 8 === 0){ ch.forEach(m => pad(mtof(m), t, SPB * 4)); tone(mtof(ch[0] - 12), t, SPB * 1.8, {gain:.09, attack:.02, dest:musicBus}); }
  if (i % 8 === 4) tone(mtof(ch[0] - 12), t, SPB * 1.8, {gain:.07, attack:.02, dest:musicBus});
  if (Math.random() < .55) tone(mtof(pick(ch) + 12 + (Math.random() < .3 ? 12 : 0)), t, .7, {gain:.035, attack:.01, dest:musicBus});
}
function applyMusic(){
  if (!AC) return;
  if (master) master.gain.setTargetAtTime(SND.vol, AC.currentTime, .05);
  const want = SND.on && SND.music && audioReady(), t = AC.currentTime;
  musicBus.gain.cancelScheduledValues(t); musicBus.gain.setValueAtTime(musicBus.gain.value, t);
  musicBus.gain.linearRampToValueAtTime(want ? SND.musicVol * .9 : 0, t + 1.2);
  if (want && !musT){ nextBeat = t + .1; beatIdx = 0;
    musT = setInterval(() => { while (nextBeat < AC.currentTime + .5){ schedBeat(nextBeat, beatIdx); nextBeat += SPB / 2; beatIdx++; } }, 150); }
  if (!want && musT){ const id = musT; musT = null; setTimeout(() => { if (!musT) clearInterval(id); }, 1300); }
}
function renderSndUI(){
  if (PREVIEW) return;
  const ready = audioReady();
  $('#sndHint').hidden = !SND.on || ready;
  $('#sndBtn').textContent = !SND.on ? '🔇 แอดมินปิดเสียง' : ready ? '🔊 เสียงเปิดอยู่' : '🔇 กดเพื่อเปิดเสียง';
}
$('#sndBtn').onclick = () => audioInit();
$('#screenWrap').addEventListener('click', () => { if (SND.on && !audioReady()) audioInit(); });
renderSndUI();
