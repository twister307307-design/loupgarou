// ─── MUSIC h24 horreur ───────────────────────────────────────
const TRACKS = {
  ambiance: 'https://cdn.pixabay.com/audio/2022/10/16/audio_127a6e8c9e.mp3',
  vote:     'https://cdn.pixabay.com/audio/2022/08/04/audio_2dde668d05.mp3',
};
let audio = null, curTrack = null, musicOn = true, musicStarted = false;

function playMusic(t) {
  if (!musicOn) return;
  if (curTrack === t && audio && !audio.paused) return;
  if (audio) { audio.pause(); audio.currentTime = 0; }
  curTrack = t;
  if (!TRACKS[t]) return;
  audio = new Audio(TRACKS[t]);
  audio.loop = true; audio.volume = 0.22;
  audio.play().catch(() => {});
}
function trackFor(phase) {
  if (['vote','chasseur_revenge'].includes(phase)) return 'vote';
  return 'ambiance';
}
function toggleMusic() {
  musicOn = !musicOn;
  const b = document.getElementById('music-btn');
  if (!musicOn) { if (audio) audio.pause(); if (b) b.textContent = '🔇'; }
  else { if (b) b.textContent = '🔊'; playMusic(curTrack || 'ambiance'); }
}
// Démarre dès le 1er clic/touche
function startMusicOnce() {
  if (musicStarted) return;
  musicStarted = true;
  playMusic('ambiance');
  document.removeEventListener('click', startMusicOnce);
  document.removeEventListener('keydown', startMusicOnce);
}
document.addEventListener('click', startMusicOnce);
document.addEventListener('keydown', startMusicOnce);

// ─── STARS ───────────────────────────────────────────────────
const cvs = document.getElementById('stars'), ctx = cvs.getContext('2d');
let stars = [];
function initStars() {
  cvs.width = window.innerWidth; cvs.height = window.innerHeight;
  stars = Array.from({length:200}, () => ({ x:Math.random()*cvs.width, y:Math.random()*cvs.height, r:Math.random()*1.4+.3, o:Math.random(), s:Math.random()*.007+.002 }));
}
function drawStars() {
  ctx.clearRect(0,0,cvs.width,cvs.height);
  stars.forEach(s => { s.o+=s.s; if(s.o>1||s.o<0)s.s*=-1; ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2); ctx.fillStyle=`rgba(255,245,230,${s.o})`; ctx.fill(); });
  requestAnimationFrame(drawStars);
}
initStars(); drawStars(); window.addEventListener('resize', initStars);

// ─── DATA ────────────────────────────────────────────────────
const ROLES = {
  loup_garou: { label:'Loup-Garou', emoji:'🐺', color:'#dc2626', team:'loups', teamLabel:'🐺 Loups', desc:'La nuit, choisissez une victime. Les loups se connaissent.' },
  villageois: { label:'Villageois', emoji:'👨‍🌾', color:'#16a34a', team:'village', teamLabel:'🌿 Village', desc:'Pas de pouvoir spécial, mais votre vote est crucial !' },
  voyante:    { label:'Voyante', emoji:'🔮', color:'#7c3aed', team:'village', teamLabel:'🌿 Village', desc:'Chaque nuit, révélez le vrai rôle d\'un joueur.' },
  sorciere:   { label:'Sorcière', emoji:'🧙‍♀️', color:'#0891b2', team:'village', teamLabel:'🌿 Village', desc:'Une potion de vie, une de mort. Choisissez avec sagesse.' },
  chasseur:   { label:'Chasseur', emoji:'🏹', color:'#b45309', team:'village', teamLabel:'🌿 Village', desc:'À votre mort, emportez un joueur avec vous.' },
  cupidon:    { label:'Cupidon', emoji:'💘', color:'#db2777', team:'village', teamLabel:'🌿 Village', desc:'La 1ère nuit, liez deux joueurs pour l\'éternité.' },
};
const PHASES = {
  lobby:           { ico:'🏰', name:'Salon', sub:'En attente des joueurs...' },
  attribution:     { ico:'🃏', name:'Distribution des rôles', sub:'Lisez votre rôle attentivement...' },
  nuit_cupidon:    { ico:'💘', name:'Nuit — Cupidon', sub:'Cupidon choisit deux amoureux' },
  nuit_voyante:    { ico:'🔮', name:'Nuit — Voyante', sub:'La Voyante scrute l\'obscurité' },
  nuit_loups:      { ico:'🐺', name:'Nuit — Loups-Garous', sub:'Les loups choisissent leur victime' },
  nuit_sorciere:   { ico:'🧙‍♀️', name:'Nuit — Sorcière', sub:'La Sorcière décide du sort' },
  resultat_nuit:   { ico:'☀️', name:'Aube', sub:'Le village se réveille...' },
  jour:            { ico:'☀️', name:'Délibération', sub:'Débattez et trouvez les loups !' },
  vote:            { ico:'🗳️', name:'Vote du village', sub:'Éliminez un suspect !' },
  chasseur_revenge:{ ico:'🏹', name:'Vengeance du Chasseur !', sub:'Le chasseur choisit sa cible' },
  fin:             { ico:'🏆', name:'Fin de partie', sub:'Les rôles sont révélés' },
};

// Plus d'emojis au choix !
const ALL_AVATARS = [
  '🐺','🦊','🦅','🐻','🐗','🦁','🦝','🦌','🐴','🦔',
  '🦋','🐉','🦂','🦀','🐸','🦉','🐦','🦚','🐊','🐬',
  '🧙','🧛','🧟','💀','👻','🕷️','🦇','🐍','🦎','🐙',
  '🌙','⭐','🔥','❄️','🌊','🍄','🌹','🗡️','🏹','🔮',
];

// ─── STATE ───────────────────────────────────────────────────
let token = localStorage.getItem('lg_token');
let myUsername = localStorage.getItem('lg_user') || '';
let myAvatar = localStorage.getItem('lg_avatar') || '🐺';
let currentRoom = null, gs = null, timerIv = null;
let socket = null, mySid = null;
let selectedAv = '🐺', cupChoices = [];
let endShown = false;

// ─── INIT ────────────────────────────────────────────────────
function init() {
  buildAvPicker();
  socket = io();
  socket.on('connect', () => { mySid = socket.id; if (token) socket.emit('auth', { token }); });
  socket.on('auth_ok', ({ username, avatar }) => {
    myUsername = username; myAvatar = avatar || '🐺';
    localStorage.setItem('lg_user', username); localStorage.setItem('lg_avatar', myAvatar);
    document.getElementById('my-name').textContent = username;
    document.getElementById('my-avatar').textContent = myAvatar;
    show('s-menu');
  });
  socket.on('auth_error', () => { token = null; localStorage.clear(); show('s-auth'); });
  socket.on('err', msg => showErr(msg));
  socket.on('room_joined', ({ code }) => {
    currentRoom = code;
    document.getElementById('room-code').textContent = code;
    buildRoleChips();
    show('s-room');
  });
  socket.on('state', st => onState(st));
  socket.on('chat_msg', m => appendChat(m));
  socket.on('voyante_result', ({ username, role, emoji, team }) => {
    showNotif('🔮 Révélation !', `${username} est :\n${emoji} ${role}\nÉquipe : ${team === 'loups' ? '🐺 Loups' : '🌿 Village'}`, '🔮');
  });
  socket.on('lover_notif', ({ partner }) => {
    showNotif('💘 Cupidon vous a lié !', `Vous et ${partner} êtes liés pour l'éternité.\nSi l'un meurt, l'autre mourra de chagrin...`, '💘');
  });

  if (token) socket.emit('auth', { token });
  else show('s-auth');

  document.getElementById('chat-in').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
  // Lobby chat
  const lci = document.getElementById('lobby-chat-in') || document.getElementById('room-chat-in');
  if (lci) lci.addEventListener('keydown', e => { if (e.key === 'Enter') sendLobbyChat(); });
}

function buildAvPicker() {
  const g = document.getElementById('avatar-grid'); if (!g) return;
  g.innerHTML = ALL_AVATARS.map(a => `<span class="av-opt${a===selectedAv?' sel':''}" onclick="pickAv('${a}')">${a}</span>`).join('');
}
function pickAv(a) {
  selectedAv = a;
  document.getElementById('avatar-preview').textContent = a;
  document.querySelectorAll('.av-opt').forEach(el => el.classList.toggle('sel', el.textContent === a));
}

// ─── AUTH ─────────────────────────────────────────────────────
async function login() {
  const u = document.getElementById('l-user').value.trim();
  const p = document.getElementById('l-pass').value;
  if (!u || !p) return setErr('auth-err','Remplis tous les champs');
  try {
    const r = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:u,password:p}) });
    const d = await r.json();
    if (!r.ok) return setErr('auth-err', d.error);
    saveAuth(d);
  } catch { setErr('auth-err','Erreur réseau'); }
}
async function register() {
  const u = document.getElementById('r-user').value.trim();
  const p = document.getElementById('r-pass').value;
  if (!u || !p) return setErr('auth-err','Remplis tous les champs');
  try {
    const r = await fetch('/api/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:u,password:p,avatar:selectedAv}) });
    const d = await r.json();
    if (!r.ok) return setErr('auth-err', d.error);
    saveAuth(d);
  } catch { setErr('auth-err','Erreur réseau'); }
}
function saveAuth({ token: t, username, avatar }) {
  token = t; myUsername = username; myAvatar = avatar || '🐺';
  localStorage.setItem('lg_token', t);
  localStorage.setItem('lg_user', username);
  localStorage.setItem('lg_avatar', myAvatar);
  if (socket) socket.emit('auth', { token });
  document.getElementById('my-name').textContent = username;
  document.getElementById('my-avatar').textContent = myAvatar;
  show('s-menu');
}
function logout() { token = null; localStorage.clear(); show('s-auth'); }
function switchTab(t) {
  document.querySelectorAll('.tab').forEach((b,i) => b.classList.toggle('active',(i===0&&t==='login')||(i===1&&t==='register')));
  document.getElementById('t-login').classList.toggle('active', t==='login');
  document.getElementById('t-register').classList.toggle('active', t==='register');
  setErr('auth-err','');
}

// ─── MENU ─────────────────────────────────────────────────────
function createRoom() { socket.emit('create_room', { token }); }
function toggleJoin() { document.getElementById('join-box').classList.toggle('hidden'); }
function joinRoom() {
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!code) return;
  socket.emit('join_room', { token, code });
}

// ─── ROOM ─────────────────────────────────────────────────────
function leaveRoom() { socket.emit('leave_room',{token,code:currentRoom}); currentRoom=null; show('s-menu'); }
function copyCode() { navigator.clipboard?.writeText(currentRoom); const b=document.querySelector('.copy-btn'); b.textContent='✅'; setTimeout(()=>b.textContent='📋',1400); }
function startGame() { socket.emit('start_game',{token,code:currentRoom}); }
function buildRoleChips() {
  document.getElementById('roles-wrap').innerHTML = Object.entries(ROLES).map(([,r])=>
    `<div class="role-chip"><div class="rc-ico">${r.emoji}</div><div class="rc-nm">${r.label}</div></div>`).join('');
}

// Lobby chat
function sendLobbyChat() {
  const el = document.getElementById('lobby-chat-in') || document.getElementById('room-chat-in');
  const msg = el?.value.trim(); if (!msg || !currentRoom) return;
  socket.emit('chat', { token, code: currentRoom, msg }); el.value = '';
}

// ─── STATE ────────────────────────────────────────────────────
function onState(st) {
  gs = st;
  mySid = mySid || socket.id;
  const { phase, players, narrator } = st;
  const sid = players[mySid] ? mySid : Object.keys(players).find(k => players[k].username === myUsername);
  const me = sid ? players[sid] : null;

  // Narrator
  const nt = document.getElementById('narrator-txt');
  if (narrator && nt && nt.textContent !== narrator) nt.textContent = narrator;

  if (phase === 'lobby') { show('s-room'); renderRoom(st, sid); return; }
  show('s-game'); renderGame(st, sid, me);
}

function renderRoom(st, sid) {
  const { players, code, log } = st;
  document.getElementById('room-code').textContent = code;
  const w = document.getElementById('players-wrap');
  w.innerHTML = Object.entries(players).map(([,p]) =>
    `<div class="p-card ${p.isHost?'host':''}">
      <span class="p-av">${p.avatar||'🐺'}</span>
      <div class="p-nm">${p.username}</div>
      ${p.isHost?'<span class="p-badge">HÔTE</span>':''}
    </div>`).join('');
  const cnt = Object.keys(players).length;
  document.getElementById('player-count').textContent = `${cnt}/12 joueurs`;
  const isHost = players[sid]?.username === st.host;
  const btn = document.getElementById('start-btn');
  btn.style.display = isHost ? 'block' : 'none';
  btn.textContent = cnt < 4 ? `🔒 Minimum 4 joueurs (${cnt}/4)` : '🌙 Lancer la partie';
  btn.disabled = cnt < 4;

  // Log in lobby
  const ll = document.getElementById('lobby-log');
  if (ll) {
    ll.innerHTML = log.slice(-10).map(e => `<div class="log-entry ${e.type}">${e.msg}</div>`).join('');
    ll.scrollTop = ll.scrollHeight;
  }
}

function renderGame(st, sid, me) {
  const { phase, players, log, timerEnd, nightVictim, witchPotions } = st;
  const pi = PHASES[phase] || PHASES.jour;

  playMusic(trackFor(phase));

  document.getElementById('phase-ico').textContent = pi.ico;
  document.getElementById('phase-name').textContent = pi.name;
  document.getElementById('phase-sub').textContent = pi.sub;

  clearInterval(timerIv);
  if (timerEnd) {
    const tick = () => {
      const rem = Math.max(0, Math.round((timerEnd - Date.now()) / 1000));
      const el = document.getElementById('timer');
      el.textContent = rem > 0 ? rem + 's' : '⌛';
      el.classList.toggle('urgent', rem <= 10 && rem > 0);
    };
    tick(); timerIv = setInterval(tick, 500);
  } else { const el=document.getElementById('timer'); el.textContent=''; el.classList.remove('urgent'); }

  if (me?.role) {
    const r = ROLES[me.role] || {};
    document.getElementById('role-ico').textContent = r.emoji || '❓';
    document.getElementById('role-name').textContent = r.label || me.role;
    document.getElementById('role-desc').textContent = r.desc || '';
    const tEl = document.getElementById('role-team');
    tEl.textContent = r.teamLabel || '';
    tEl.className = `role-team team-${r.team || 'village'}`;
    document.getElementById('my-role').style.borderColor = r.color || 'var(--border)';
  }

  renderPlayers(st, sid, me);
  renderAction(st, sid, me);

  const ll = document.getElementById('log-list');
  ll.innerHTML = log.map(e => `<div class="log-entry ${e.type}">${e.msg}</div>`).join('');
  ll.parentElement.scrollTop = ll.parentElement.scrollHeight;

  const ci = document.getElementById('chat-in');
  const canChat = ['jour','lobby'].includes(phase) && me?.alive;
  ci.disabled = !canChat;
  ci.placeholder = canChat ? 'Parlez, villageois...' : '(muet pendant la nuit...)';

  if (phase === 'fin' && !endShown) {
    endShown = true;
    const winLog = log.filter(e => e.type === 'win').pop();
    if (winLog) {
      const myRole = me?.role;
      const won = myRole === 'loup_garou' ? winLog.msg.includes('LOUPS') : winLog.msg.includes('VILLAGE');
      showEnd(won ? '🎉 VICTOIRE !' : '💀 DÉFAITE...', winLog.msg, won ? '🏆' : '☠️', players[sid]?.isHost);
    }
  }
  if (phase !== 'fin') endShown = false;
}

function renderPlayers(st, sid, me) {
  const { phase, players, votes } = st;
  const isVote = phase === 'vote';
  const aliveMe = me?.alive !== false;
  const myRole = me?.role;

  document.getElementById('gplayers').innerHTML = Object.entries(players).map(([psid, p]) => {
    const isMe = p.username === myUsername;
    const isAlly = myRole === 'loup_garou' && p.role === 'loup_garou' && !isMe;
    const myVote = votes?.[sid];
    const isTarget = myVote === psid;
    let sel = false;
    if (p.alive && !isMe && aliveMe) {
      if (isVote && !me?.voted) sel = true;
      if (phase === 'nuit_loups' && myRole === 'loup_garou' && p.role !== 'loup_garou') sel = true;
      if (phase === 'nuit_voyante' && myRole === 'voyante') sel = true;
      if (phase === 'chasseur_revenge' && myRole === 'chasseur') sel = true;
    }
    const rv = p.revealedRole ? (ROLES[p.revealedRole] || null) : null;
    return `<div class="gp ${sel?'sel':''} ${isMe?'me':''} ${isAlly?'ally':''} ${!p.alive?'dead':''}"
      style="${isTarget?'border-color:var(--acc)':''}"
      onclick="${sel?`act('${psid}')`:''}" >
      <div class="gp-av">${p.avatar||'🐺'}</div>
      ${p.role?`<div class="gp-role">${ROLES[p.role]?.emoji||'?'}</div>`:''}
      <div class="gp-nm">${p.username}${isMe?' ★':''}</div>
      ${p.voted?'<div class="gp-voted"></div>':''}
      ${!p.alive?'<div class="gp-dead">💀</div>':''}
      ${rv?`<div class="rev-badge">${rv.emoji} ${rv.label}</div>`:''}
      ${isAlly?'<div style="position:absolute;bottom:-4px;left:50%;transform:translateX(-50%);font-size:.54rem;background:rgba(220,38,38,.75);padding:1px 4px;border-radius:4px;font-family:var(--fh)">ALLIÉ</div>':''}
    </div>`;
  }).join('');
}

function renderAction(st, sid, me) {
  const { phase, players, nightVictim, witchPotions } = st;
  const ab = document.getElementById('action-box');
  const at = document.getElementById('action-title');
  const abody = document.getElementById('action-body');
  ab.style.display = 'none';
  if (!me?.alive) return;
  const r = me?.role;

  if (phase === 'nuit_loups' && r === 'loup_garou') {
    ab.style.display = 'block'; at.textContent = '🐺 Choisissez votre victime';
    const allies = Object.values(players).filter(p => p.role === 'loup_garou' && p.username !== myUsername);
    abody.innerHTML = `<p class="act-note">Cliquez sur un joueur pour le dévorer.${allies.length ? `<br>🐺 Alliés : ${allies.map(a=>a.avatar+' '+a.username).join(', ')}` : '<br>Vous êtes le seul loup !'}</p>`;
  }
  else if (phase === 'nuit_voyante' && r === 'voyante') {
    ab.style.display = 'block'; at.textContent = '🔮 Révélez le rôle d\'un joueur';
    abody.innerHTML = `<p class="act-note">Cliquez sur un joueur pour voir son rôle secret. Vous seul verrez le résultat.</p>`;
  }
  else if (phase === 'nuit_cupidon' && r === 'cupidon') {
    ab.style.display = 'block'; at.textContent = '💘 Liez deux amoureux';
    const alive = Object.entries(players).filter(([,p])=>p.alive).map(([psid,p])=>({psid,name:p.username,avatar:p.avatar}));
    abody.innerHTML = `<p class="act-note">Sélectionnez 2 joueurs (${cupChoices.length}/2) :</p>
      <div style="display:flex;flex-wrap:wrap;gap:.28rem;margin-bottom:.4rem">
        ${alive.map(({psid,name,avatar})=>`<button class="act-btn" style="${cupChoices.includes(psid)?'border-color:var(--p);background:rgba(192,132,252,.18)':''}" onclick="cupPick('${psid}')">${avatar} ${name}</button>`).join('')}
      </div>
      <button class="act-btn" onclick="skipAct()" style="opacity:.5">Passer (random)</button>`;
  }
  else if (phase === 'nuit_sorciere' && r === 'sorciere') {
    ab.style.display = 'block'; at.textContent = '🧙‍♀️ Vos potions';
    let h = nightVictim
      ? `<p class="act-note" style="color:#f87171">⚠️ ${nightVictim} va mourir cette nuit.</p>`
      : `<p class="act-note">Personne n'est ciblé.</p>`;
    h += `<button class="act-btn" onclick="witchSave()" ${(!nightVictim||!witchPotions?.life)?'disabled':''}>💊 Sauver ${nightVictim||'?'} ${!witchPotions?.life?'(utilisée)':'— Potion de vie'}</button>`;
    if (witchPotions?.death) {
      h += `<p class="act-note" style="color:#fde68a;margin-top:.4rem">☠️ Tuer avec potion de mort :</p>`;
      h += Object.entries(players).filter(([,p])=>p.alive&&p.username!==myUsername).map(([psid,p])=>
        `<button class="act-btn danger" onclick="witchKill('${psid}')">${p.avatar||'🐺'} ${p.username}</button>`).join('');
    } else h += `<button class="act-btn" disabled>☠️ Potion de mort (utilisée)</button>`;
    h += `<button class="act-btn" onclick="skipAct()" style="opacity:.45;margin-top:.3rem">Ne rien faire</button>`;
    abody.innerHTML = h;
  }
  else if (phase === 'chasseur_revenge' && r === 'chasseur') {
    ab.style.display = 'block'; at.textContent = '🏹 Vengeance du Chasseur';
    abody.innerHTML = `<p class="act-note" style="color:#fde68a">Tu meurs... mais emporte quelqu'un ! Cliquez sur un joueur.</p>
      ${Object.entries(players).filter(([,p])=>p.alive&&p.username!==myUsername).map(([psid,p])=>
        `<button class="act-btn" onclick="act('${psid}')">${p.avatar||'🐺'} ${p.username}</button>`).join('')}`;
  }
  else if (phase === 'vote') {
    ab.style.display = 'block';
    if (me?.voted) {
      const tv = st.votes?.[sid]; const tn = tv ? players[tv]?.username : '?';
      at.textContent = '🗳️ Vote enregistré';
      abody.innerHTML = `<p class="act-note">Tu as voté contre <strong>${tn}</strong>.<br>En attente des autres...</p>`;
    } else {
      at.textContent = '🗳️ Votez pour éliminer !';
      const tally = Object.values(st.votes||{}).reduce((a,s)=>{a[s]=(a[s]||0)+1;return a;},{});
      abody.innerHTML = `<p class="act-note">Cliquez pour voter :</p>` +
        Object.entries(players).filter(([,p])=>p.alive).map(([psid,p])=>
          `<button class="act-btn" onclick="act('${psid}')">${p.avatar||'🐺'} ${p.username}${tally[psid]?` <span style="margin-left:auto;color:var(--red)">${tally[psid]}v</span>`:''}</button>`).join('');
    }
  }
  else if (phase === 'jour' && players[sid]?.isHost) {
    ab.style.display = 'block'; at.textContent = '⚡ Hôte';
    abody.innerHTML = `<button class="act-btn" onclick="socket.emit('skip_day',{token,code:currentRoom})">⏩ Passer au vote</button>`;
  }
  else if (phase.startsWith('nuit_') && me?.alive && !['loup_garou','voyante','sorciere','cupidon'].includes(r)) {
    ab.style.display = 'block'; at.textContent = `${ROLES[r]?.emoji||'😴'} Vous dormez...`;
    abody.innerHTML = `<p class="act-note">Il fait nuit. Les pouvoirs agissent dans l'ombre.<br>Patientez jusqu'à l'aube.</p>`;
  }
}

// ─── ACTIONS ─────────────────────────────────────────────────
function act(targetSid) {
  if (!gs) return;
  const { phase } = gs;
  if (phase === 'vote') socket.emit('vote', { token, code: currentRoom, target: targetSid });
  else socket.emit('night_action', { token, code: currentRoom, action: 'target', target: targetSid });
}
function cupPick(sid) {
  if (cupChoices.includes(sid)) cupChoices = cupChoices.filter(s=>s!==sid);
  else if (cupChoices.length < 2) cupChoices.push(sid);
  if (cupChoices.length === 2) {
    socket.emit('night_action', { token, code: currentRoom, action: 'link', target: cupChoices });
    cupChoices = [];
  } else if (gs) {
    const sid2 = Object.keys(gs.players).find(k=>gs.players[k].username===myUsername);
    renderAction(gs, sid2, gs.players[sid2]);
  }
}
function witchSave() { socket.emit('night_action',{token,code:currentRoom,action:'save'}); }
function witchKill(sid) { socket.emit('night_action',{token,code:currentRoom,action:'kill',target:sid}); }
function skipAct() { socket.emit('night_action',{token,code:currentRoom,action:'skip'}); }

// ─── CHAT ─────────────────────────────────────────────────────
function sendChat() {
  const el = document.getElementById('chat-in');
  const msg = el.value.trim(); if (!msg || !currentRoom) return;
  socket.emit('chat', { token, code: currentRoom, msg }); el.value = '';
}
function appendChat({ username, avatar, msg }) {
  // Game chat
  const c = document.getElementById('chat-msgs');
  if (c) {
    const d = document.createElement('div'); d.className = 'c-msg';
    d.innerHTML = `<span class="c-nm">${avatar||'🐺'} ${username}</span><span class="c-txt">${esc(msg)}</span>`;
    c.appendChild(d); c.scrollTop = c.scrollHeight;
  }
  // Lobby chat
  const lc = document.getElementById('lobby-chat-msgs') || document.getElementById('room-chat-msgs');
  if (lc) {
    const d = document.createElement('div'); d.className = 'c-msg';
    d.innerHTML = `<span class="c-nm">${avatar||'🐺'} ${username}</span><span class="c-txt">${esc(msg)}</span>`;
    lc.appendChild(d); lc.scrollTop = lc.scrollHeight;
  }
}

// ─── END ─────────────────────────────────────────────────────
function showEnd(title, body, ico, isHost) {
  document.getElementById('end-ico').textContent = ico;
  document.getElementById('end-title').textContent = title;
  document.getElementById('end-body').textContent = body;
  const rb = document.getElementById('btn-replay');
  rb.style.display = isHost ? 'block' : 'none';
  document.getElementById('end-overlay').classList.remove('hidden');
}
function endGoMenu() {
  socket.emit('leave_room', { token, code: currentRoom });
  currentRoom = null;
  document.getElementById('end-overlay').classList.add('hidden');
  show('s-menu');
}
function endReplay() {
  socket.emit('restart_game', { token, code: currentRoom });
  document.getElementById('end-overlay').classList.add('hidden');
  endShown = false;
}

// ─── NOTIF ───────────────────────────────────────────────────
function showNotif(title, body, ico='🐺') {
  document.getElementById('notif-ico').textContent = ico;
  document.getElementById('notif-title').textContent = title;
  document.getElementById('notif-body').textContent = body;
  document.getElementById('notif-overlay').classList.remove('hidden');
}
function closeNotif() { document.getElementById('notif-overlay').classList.add('hidden'); }

// ─── UTILS ───────────────────────────────────────────────────
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id); if (el) el.classList.add('active');
}
function setErr(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; if (msg) setTimeout(()=>el.textContent='',4000); }
}
function showErr(msg) {
  const active = document.querySelector('.screen.active');
  if (!active) return;
  const e = active.querySelector('.err');
  if (e) { e.textContent = msg; setTimeout(()=>e.textContent='',4000); }
}
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

init();
