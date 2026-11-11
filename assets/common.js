// ===== HUSOC Live Chat — ส่วนกลาง (Firebase + ฟังก์ชันช่วย) =====
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ใช้โปรเจกต์ Firebase เดียวกับเกมควิซ (ข้อมูลแชทเก็บแยกไว้ที่ "liverooms")
export const firebaseConfig = {
  apiKey: "AIzaSyAN6pfq4604V75P6zxzsVkrgysHiPzgsYw",
  authDomain: "husoc-quiz-live.firebaseapp.com",
  projectId: "husoc-quiz-live",
  storageBucket: "husoc-quiz-live.firebasestorage.app",
  messagingSenderId: "720821873188",
  appId: "1:720821873188:web:1507859736ed55954586b1"
};
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const ROOMS = 'liverooms';

/* ---------- helpers ---------- */
export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const uid = () => Math.random().toString(36).slice(2, 9);
export const pick = a => a[Math.floor(Math.random() * a.length)];
export const hashStr = n => { let h = 0; for (const ch of String(n)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
export const hue = n => [270,295,320,205,165,25,345,250][hashStr(n) % 8];
export const avatar = n => `<div class="av" style="background:hsl(${hue(n)} 65% 58%)">${esc([...String(n)][0] || '?')}</div>`;
export const newCode = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)]; return s; };
// เวลาในเอกสาร Firestore → มิลลิวินาที (ตอนเพิ่งส่งอาจยังเป็น null)
export const tsMs = t => t && typeof t.toMillis === 'function' ? t.toMillis() : (typeof t === 'number' ? t : Date.now());
export const hhmm = ms => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
export const roomCodeFromUrl = () => (new URLSearchParams(location.search).get('c') || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
export const siteBase = () => location.origin + location.pathname.replace(/[^/]*$/, '');
export const joinUrl = code => siteBase() + '?c=' + code;
export const screenUrl = code => siteBase() + 'screen.html?c=' + code;

/* ---------- กรองคำหยาบ ---------- */
export const BAD = ['เหี้ย','ควย','สัส','เย็ด','แตด','ระยำ','ชาติหมา','อีดอก','ตอแหล','ไอ้สัตว์','อีสัตว์','พ่อมึงตาย','แม่มึงตาย','จัญไร','กะหรี่','fuck','shit','bitch','asshole'];
export function clean(t){
  let out = String(t), flagged = false;
  for (const w of BAD){
    const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    if (re.test(out)){ flagged = true; out = out.replace(re, '***'); }
  }
  return { text: out, flagged };
}
export const normWord = w => String(w).replace(/\s+/g, ' ').replace(/^[\s.,!?'"“”‘’()\-]+|[\s.,!?'"“”‘’()\-]+$/g, '').toLowerCase().slice(0, 20);

export const MODES = { comment:'💬 รายการ', danmaku:'🚀 วิ่งข้ามจอ', postit:'📝 โพสต์อิท', bubble:'🫧 ฟองสบู่', wordcloud:'☁️ Word Cloud', qa:'🙋 คำถาม' };
export const DEFAULT_SND = { on:true, comment:true, emoji:true, highlight:true, music:false, vol:0.8, musicVol:0.5 };

export function drawQR(box, url, size){
  box.innerHTML = '';
  if (window.QRCode) new window.QRCode(box, { text:url, width:size, height:size, colorDark:'#361161', colorLight:'#ffffff', correctLevel:window.QRCode.CorrectLevel.M });
  else box.innerHTML = '<div style="color:#999;padding-top:40%;text-align:center">QR</div>';
}
