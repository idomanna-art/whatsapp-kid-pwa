const APP_EL = document.getElementById('app');
const VIDEO = document.getElementById('callVideo');

const LS_HUNG = 'wk_hungUpTooSoon';
const LS_LAST = 'wk_lastPlayed';

let cfg = null;
let contacts = [];

let active = null;
let callState = 'idle'; // idle | ringing | connected
let currentVideoUrl = null;

let ringAudio = null;
let ringTimer = null;
let noAnswerTimer = null;
let freezeTimer = null;
let connectedAt = null;

const hungLog = loadJSON(LS_HUNG, {});
const lastPlayed = loadJSON(LS_LAST, {});

function loadJSON(key, fallback){
  try{
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  }catch{ return fallback; }
}
function saveJSON(key, obj){
  try{ localStorage.setItem(key, JSON.stringify(obj)); }catch{}
}

function randInt(min, max){
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickVideo(contact){
  if (hungLog[contact.id]) return contact.angryVideo;

  let options = [...contact.defaultVideos];
  if (options.length > 1 && lastPlayed[contact.id]) {
    options = options.filter(v => v !== lastPlayed[contact.id]);
    if (options.length === 0) options = [...contact.defaultVideos];
  }
  const chosen = options[Math.floor(Math.random() * options.length)];
  lastPlayed[contact.id] = chosen;
  saveJSON(LS_LAST, lastPlayed);
  return chosen;
}

function renderList(){
  active = null;
  callState = 'idle';
  currentVideoUrl = null;

  APP_EL.innerHTML = `
    <div class="header">WhatsApp</div>
    <ul class="list">
      ${contacts.map(c => `
        <li class="item" data-id="${c.id}">
          <img class="avatar" src="./${c.profilePic}" alt="" />
          <div class="name">${c.name}</div>
          <div class="icon">📹</div>
        </li>
      `).join('')}
    </ul>
  `;

  document.querySelectorAll('.item').forEach(li => {
    li.addEventListener('click', () => {
      const id = li.getAttribute('data-id');
      const c = contacts.find(x => x.id === id);
      if (c) startCall(c);
    }, { passive:true });
  });
}

function renderCallScreen(){
  APP_EL.innerHTML = `
    <div class="call">
      <div class="ringing" id="ringingUI">
        <img class="big-avatar" src="./${active.profilePic}" alt="" />
        <div class="call-name">${active.name}</div>
        <div class="call-status">${callState === 'ringing' ? 'Ringing...' : ''}</div>
      </div>

      <div class="controls">
        <button class="hangup" id="hangupBtn">☎️</button>
      </div>
    </div>
  `;

  document.getElementById('hangupBtn').addEventListener('click', endCall, { passive:true });
}

async function startCall(contact){
  // 1) מצב
  active = contact;
  callState = 'ringing';
  connectedAt = null;

  renderCallScreen();

  // 2) בוחרים וידאו
  currentVideoUrl = pickVideo(contact);

  // 3) ***החלק החשוב***: “פותחים” autoplay בתוך הקליק של המשתמש
  //    - מכינים וידאו מיד, מתחילים לנגן מיד עם ווליום 0
  //    - בזמן ringing מקבעים אותו על תחילת הסרטון (שלא “יברח”)
  primeAndStartVideoWithinUserClick(currentVideoUrl);

  // 4) רינגטון (גם בתוך המחווה – הכי אמין)
  startRingtoneWithinUserClick();

  // 5) סימולציה: יענה/לא יענה
  const willAnswer = Math.random() < cfg.app.answerProbability;

  if (willAnswer) {
    const ringMs = randInt(cfg.app.ringMinMs, cfg.app.ringMaxMs);
    ringTimer = setTimeout(connectCall, ringMs);
  } else {
    noAnswerTimer = setTimeout(endCall, cfg.app.noAnswerTimeoutMs);
  }
}

function primeAndStartVideoWithinUserClick(url){
  clearIntervalSafe(freezeTimer);

  // מאפסים הכל
  VIDEO.classList.remove('hidden', 'contain');
  VIDEO.classList.add('hidden'); // מסתירים בזמן ringing
  VIDEO.src = `./${url}`;
  VIDEO.load();

  // playsinline כבר ב-HTML
  // הכי אמין: מתחילים עם volume 0 (לא muted) כדי שנוכל להעלות ווליום ב-Connected בלי play חדש
  VIDEO.muted = false;
  VIDEO.volume = 0.0;

  // כדי להגדיר cover/contain לפי יחס
  VIDEO.onloadedmetadata = () => {
    try{
      const landscape = VIDEO.videoWidth > VIDEO.videoHeight;
      if (landscape) VIDEO.classList.add('contain');
      else VIDEO.classList.remove('contain');
    }catch{}
  };

  // אם נגמר – מנתקים
  VIDEO.onended = () => endCall();

  // מנסים לנגן *עכשיו* (בתוך הקליק)
  VIDEO.play().catch(() => {
    // fallback: אם דפדפן חוסם unmuted אפילו בתוך קליק, ננסה muted (לפחות שירוץ)
    VIDEO.muted = true;
    VIDEO.volume = 0.0;
    return VIDEO.play().catch(() => {
      // אם גם זה נחסם – אין מה לעשות בדפדפן בלי מחווה נוספת
      // אבל לפחות נמשיך את ה-UI (הילד לא יעשה קליק; במקרה כזה צריך פתרון native).
    });
  });

  // מקבעים אותו על תחילת הסרטון בזמן ringing (כדי שכשמראים אותו הוא יתחיל מההתחלה)
  freezeTimer = setInterval(() => {
    if (callState !== 'ringing') return;
    try{ VIDEO.currentTime = 0; }catch{}
  }, 200);
}

function startRingtoneWithinUserClick(){
  stopRingtone();

  ringAudio = new Audio('./media/audio/ringtone.mp3');
  ringAudio.loop = true;

  // חשוב: play() בתוך מחווה של משתמש
  ringAudio.play().catch(() => {
    // אם נחסם, עדיין נמשיך. (בדרך כלל זה יעבוד באנדרואיד/כרום.)
  });
}

function connectCall(){
  callState = 'connected';
  connectedAt = Date.now();

  // מפסיקים רינגטון
  stopRingtone();

  // מפסיקים freeze ומראים וידאו מהתחלה עם סאונד
  clearIntervalSafe(freezeTimer);
  try{
    VIDEO.currentTime = 0;
    VIDEO.classList.remove('hidden');
    VIDEO.muted = false;
    VIDEO.volume = 1.0;
    // לא קוראים ל-play כאן! הוא כבר “רץ” מהקליק.
  }catch{}

  // מסתירים ringing UI
  const ringingUI = document.getElementById('ringingUI');
  if (ringingUI) ringingUI.style.display = 'none';
}

function endCall(){
  // ניקוי טיימרים
  clearTimeoutSafe(ringTimer); ringTimer = null;
  clearTimeoutSafe(noAnswerTimer); noAnswerTimer = null;
  clearIntervalSafe(freezeTimer); freezeTimer = null;

  // עצירת רינגטון
  stopRingtone();

  // לוג "ניתק מוקדם"
  if (callState === 'connected' && connectedAt && active?.id) {
    const dur = Date.now() - connectedAt;
    if (dur < cfg.app.hangUpThresholdMs) hungLog[active.id] = true;
    else hungLog[active.id] = false;
    saveJSON(LS_HUNG, hungLog);
  }

  // עצירת וידאו ושחרור
  try{
    VIDEO.pause();
    VIDEO.removeAttribute('src');
    VIDEO.load();
    VIDEO.classList.add('hidden');
  }catch{}

  active = null;
  callState = 'idle';
  connectedAt = null;
  currentVideoUrl = null;

  renderList();
}

function stopRingtone(){
  if (!ringAudio) return;
  try{ ringAudio.pause(); ringAudio.currentTime = 0; }catch{}
  ringAudio = null;
}

function clearTimeoutSafe(t){
  try{ if (t) clearTimeout(t); }catch{}
}
function clearIntervalSafe(t){
  try{ if (t) clearInterval(t); }catch{}
}

// Service Worker (Cache) – כדי שאחרי פעם אחת זה יהיה מיידי ויציב
function registerSW(){
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
  });
}

async function boot(){
  const res = await fetch('./data/contacts.json', { cache: 'no-store' });
  cfg = await res.json();
  contacts = cfg.contacts;

  registerSW();
  renderList();
}

boot().catch(err => {
  APP_EL.innerHTML = `<div style="padding:16px">שגיאה בטעינה: ${String(err)}</div>`;
});
