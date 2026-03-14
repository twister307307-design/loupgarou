const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const JWT_SECRET = process.env.JWT_SECRET || 'loupgarou_secret_2024';
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const users = {};
const rooms = {};

const ROLES = {
  loup_garou: { label: 'Loup-Garou', emoji: '🐺', team: 'loups', description: 'La nuit, choisissez une victime. Les loups se connaissent.' },
  villageois: { label: 'Villageois', emoji: '👨‍🌾', team: 'village', description: 'Pas de pouvoir, mais votre vote est crucial !' },
  voyante:    { label: 'Voyante', emoji: '🔮', team: 'village', description: 'Chaque nuit, découvrez le vrai rôle d\'un joueur.' },
  sorciere:   { label: 'Sorcière', emoji: '🧙‍♀️', team: 'village', description: 'Une potion de vie, une de mort. Choisissez bien.' },
  chasseur:   { label: 'Chasseur', emoji: '🏹', team: 'village', description: 'À votre mort, emportez un joueur avec vous.' },
  cupidon:    { label: 'Cupidon', emoji: '💘', team: 'village', description: 'La 1ère nuit, liez deux joueurs pour l\'éternité.' },
};

const AVATARS = ['🐺','🦊','🦅','🐻','🐗','🦁','🦝','🦌','🐴','🦔','🦋','🐉','🦂','🦀','🐸','🦉','🐦','🦚','🐊','🐬'];

function getRoles(n) {
  if (n <= 4)  return ['loup_garou','voyante','villageois','villageois'];
  if (n <= 6)  return ['loup_garou','loup_garou','voyante','sorciere','villageois','villageois'];
  if (n <= 8)  return ['loup_garou','loup_garou','voyante','sorciere','chasseur','villageois','villageois','villageois'];
  if (n <= 10) return ['loup_garou','loup_garou','loup_garou','voyante','sorciere','chasseur','cupidon','villageois','villageois','villageois'];
  const r = ['loup_garou','loup_garou','loup_garou','loup_garou','voyante','sorciere','chasseur','cupidon'];
  while (r.length < n) r.push('villageois');
  return r;
}

function getTimers(n) {
  const b = Math.max(1, Math.floor(n / 4));
  return {
    night: (25 + b * 5) * 1000,
    day:   (60 + b * 15) * 1000,
    vote:  (20 + b * 5) * 1000,
    chasseur: (15 + b * 3) * 1000,
  };
}

function shuffle(a) {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// AUTH
app.post('/api/register', async (req, res) => {
  const { username, password, avatar } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Champs manquants' });
  if (username.length < 3) return res.status(400).json({ error: 'Pseudo trop court (min 3)' });
  if (password.length < 4) return res.status(400).json({ error: 'Mot de passe trop court (min 4)' });
  if (users[username]) return res.status(400).json({ error: 'Pseudo déjà pris' });
  const hash = await bcrypt.hash(password, 10);
  const chosen = AVATARS.includes(avatar) ? avatar : AVATARS[0];
  users[username] = { password: hash, avatar: chosen };
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username, avatar: chosen });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const u = users[username];
  if (!u) return res.status(400).json({ error: 'Compte introuvable' });
  if (!await bcrypt.compare(password, u.password)) return res.status(400).json({ error: 'Mot de passe incorrect' });
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username, avatar: u.avatar });
});

app.get('/api/avatars', (req, res) => res.json({ avatars: AVATARS }));

function auth(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

// GAME ROOM
class Room {
  constructor(code, host) {
    this.code = code; this.host = host;
    this.players = {}; this.phase = 'lobby'; this.round = 0;
    this.votes = {}; this.nightActions = {}; this.lovers = [];
    this.witchPotions = { life: true, death: true };
    this.log = []; this.narrator = 'Bienvenue dans le village des ombres...';
    this.timer = null; this.timerEnd = null;
    this.nightVictim = null; this.phaseQueue = [];
    this.voyante_reveals = {}; // sid -> { targetSid: role }
  }
  add(sid, username, avatar) {
    this.players[sid] = { username, avatar, role: null, alive: true, voted: false, protected: false, connected: true };
  }
  del(sid) { delete this.players[sid]; }
  alive() { return Object.entries(this.players).filter(([, p]) => p.alive); }
  aliveByRole(r) { return Object.entries(this.players).filter(([, p]) => p.alive && p.role === r); }
  count() { return Object.keys(this.players).length; }
  timers() { return getTimers(this.count()); }
  assignRoles() {
    const ids = shuffle(Object.keys(this.players));
    const roles = shuffle(getRoles(ids.length));
    ids.forEach((sid, i) => { this.players[sid].role = roles[i] || 'villageois'; });
  }
  nightQueue() {
    const q = [];
    const has = r => Object.values(this.players).some(p => p.role === r && p.alive);
    if (this.round === 0 && has('cupidon')) q.push('nuit_cupidon');
    if (has('voyante')) q.push('nuit_voyante');
    q.push('nuit_loups');
    if (has('sorciere')) q.push('nuit_sorciere');
    return q;
  }
  winner() {
    const a = this.alive();
    const wolves = a.filter(([, p]) => p.role === 'loup_garou');
    const others = a.filter(([, p]) => p.role !== 'loup_garou');
    if (wolves.length === 0) return 'village';
    if (wolves.length >= others.length) return 'loups';
    return null;
  }
  log_(msg, type = 'info') { this.log.push({ msg, type, t: Date.now() }); }
  state(forSid = null) {
    const pl = {};
    Object.entries(this.players).forEach(([sid, p]) => {
      pl[sid] = { username: p.username, avatar: p.avatar, alive: p.alive, connected: p.connected, isHost: p.username === this.host, role: null, voted: p.voted };
    });
    if (forSid && this.players[forSid]) {
      pl[forSid].role = this.players[forSid].role;
      // Loups see each other
      if (this.players[forSid].role === 'loup_garou') {
        Object.entries(this.players).forEach(([sid, p]) => { if (p.role === 'loup_garou') pl[sid].role = 'loup_garou'; });
      }
      // Dead or fin: see all
      if (!this.players[forSid].alive || this.phase === 'fin') {
        Object.entries(this.players).forEach(([sid, p]) => { pl[sid].role = p.role; });
      }
      // Voyante revealed roles
      if (this.voyante_reveals[forSid]) {
        Object.entries(this.voyante_reveals[forSid]).forEach(([sid, role]) => {
          if (pl[sid]) pl[sid].revealedRole = role;
        });
      }
    }
    if (this.phase === 'fin') {
      Object.entries(this.players).forEach(([sid, p]) => { pl[sid].role = p.role; });
    }
    return {
      code: this.code, host: this.host, phase: this.phase, round: this.round,
      players: pl, votes: this.votes, log: this.log.slice(-40),
      narrator: this.narrator, timerEnd: this.timerEnd,
      nightVictim: ['resultat_nuit', 'jour', 'vote'].includes(this.phase) ? this.nightVictim : null,
      witchPotions: this.witchPotions, playerCount: this.count(),
    };
  }
}

const socketUsers = {};

io.on('connection', socket => {
  const bcast = code => {
    const r = rooms[code]; if (!r) return;
    Object.keys(r.players).forEach(sid => io.to(sid).emit('state', r.state(sid)));
  };

  socket.on('auth', ({ token }) => {
    const u = auth(token); if (!u) return socket.emit('auth_error');
    socketUsers[socket.id] = u.username;
    socket.emit('auth_ok', { username: u.username, avatar: users[u.username]?.avatar });
  });

  socket.on('create_room', ({ token }) => {
    const u = auth(token); if (!u) return;
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const r = new Room(code, u.username);
    rooms[code] = r;
    r.add(socket.id, u.username, users[u.username]?.avatar || '🐺');
    socket.join(code);
    r.log_(`🏰 ${u.username} a créé le salon`, 'system');
    r.narrator = 'Bienvenue dans le village des ombres... Attendez vos compagnons.';
    socket.emit('room_joined', { code });
    bcast(code);
  });

  socket.on('join_room', ({ token, code }) => {
    const u = auth(token); if (!u) return socket.emit('err', 'Non authentifié');
    const c = code?.toUpperCase();
    const r = rooms[c];
    if (!r) return socket.emit('err', 'Salon introuvable');
    if (r.phase !== 'lobby') return socket.emit('err', 'Partie déjà en cours');
    if (r.count() >= 12) return socket.emit('err', 'Salon plein');
    if (Object.values(r.players).find(p => p.username === u.username)) return socket.emit('err', 'Déjà dans ce salon');
    r.add(socket.id, u.username, users[u.username]?.avatar || '🐺');
    socket.join(c);
    r.log_(`🚪 ${u.username} a rejoint le village`, 'system');
    r.narrator = `${u.username} arrive dans le village... Ami ou ennemi ?`;
    socket.emit('room_joined', { code: c });
    bcast(c);
  });

  socket.on('start_game', ({ token, code }) => {
    const u = auth(token); if (!u) return;
    const r = rooms[code]; if (!r || r.host !== u.username) return socket.emit('err', 'Pas l\'hôte');
    if (r.count() < 4) return socket.emit('err', 'Minimum 4 joueurs !');
    r.assignRoles();
    r.phase = 'attribution';
    r.log_('🃏 Les rôles ont été distribués en secret...', 'system');
    r.narrator = 'Les destins sont scellés... Certains sont des loups parmi les moutons. Lisez votre rôle.';
    bcast(code);
    setTimeout(() => startNight(r, code), 5000);
  });

  function startNight(r, code) {
    r.round++;
    r.votes = {}; r.nightActions = {}; r.nightVictim = null;
    Object.values(r.players).forEach(p => { p.voted = false; p.protected = false; });
    r.phaseQueue = r.nightQueue();
    r.log_(`🌙 Nuit ${r.round} — Le village s'endort...`, 'night');
    r.narrator = `Nuit ${r.round}... Le silence s'installe. Les créatures de la nuit s'éveillent.`;
    bcast(code);
    setTimeout(() => nextNight(r, code), 2000);
  }

  function nextNight(r, code) {
    if (!r.phaseQueue.length) { processNight(r, code); return; }
    const phase = r.phaseQueue.shift();
    r.phase = phase;
    r.timerEnd = Date.now() + r.timers().night;
    const N = {
      nuit_cupidon: 'Cupidon s\'éveille... Il cherche deux âmes à lier pour l\'éternité.',
      nuit_voyante: 'La Voyante ouvre les yeux dans l\'obscurité... Son don perce les secrets les plus sombres.',
      nuit_loups:   'Les Loups-Garous se redressent, les yeux brillants... Ils choisissent leur proie en silence.',
      nuit_sorciere:'La Sorcière se lève, potions en main... Sauvera-t-elle la victime ou scellera-t-elle un destin ?',
    };
    const L = {
      nuit_cupidon: '💘 Cupidon cherche deux amoureux...',
      nuit_voyante: '🔮 La Voyante concentre ses pouvoirs...',
      nuit_loups:   '🐺 Les Loups-Garous délibèrent...',
      nuit_sorciere:'🧙‍♀️ La Sorcière consulte ses grimoires...',
    };
    r.log_(L[phase] || '...', 'night');
    r.narrator = N[phase] || '...';
    bcast(code);
    r.timer = setTimeout(() => { autoNight(r, phase); nextNight(r, code); }, r.timers().night);
  }

  function autoNight(r, phase) {
    if (phase === 'nuit_loups' && !r.nightActions.loups_target) {
      const t = r.alive().filter(([, p]) => p.role !== 'loup_garou');
      if (t.length) r.nightActions.loups_target = t[Math.floor(Math.random() * t.length)][0];
    }
    if (phase === 'nuit_cupidon' && !r.lovers.length) {
      const a = r.alive();
      if (a.length >= 2) r.lovers = shuffle(a).slice(0, 2).map(([sid]) => sid);
    }
  }

  function processNight(r, code) {
    const target = r.nightActions.loups_target;
    const sKill = r.nightActions.sorciere_kill;
    let victims = [];
    if (target && r.players[target] && !r.players[target].protected) {
      r.players[target].alive = false;
      victims.push(r.players[target].username);
      r.nightVictim = r.players[target].username;
      loverDeath(r, target, victims);
    }
    if (sKill && r.players[sKill]?.alive) {
      r.players[sKill].alive = false;
      victims.push(r.players[sKill].username);
      loverDeath(r, sKill, victims);
    }
    r.phase = 'resultat_nuit';
    if (!victims.length) {
      r.log_('☀️ L\'aube se lève... Personne n\'est mort cette nuit !', 'info');
      r.narrator = 'Le soleil se lève sur un village intact... Mais les loups sont encore là. Méfiance !';
    } else {
      r.log_(`☀️ L'aube se lève... ${victims.join(' et ')} ${victims.length > 1 ? 'ont été trouvés morts' : 'a été trouvé mort'} !`, 'death');
      r.narrator = `L'horreur ! ${victims.join(' et ')} ${victims.length > 1 ? 'ont été dévorés' : 'a été dévoré'} cette nuit...`;
    }
    bcast(code);
    const w = r.winner(); if (w) return endGame(r, code, w);
    setTimeout(() => startDay(r, code), 4000);
  }

  function loverDeath(r, deadSid, victims) {
    if (r.lovers.includes(deadSid)) {
      const partner = r.lovers.find(s => s !== deadSid);
      if (partner && r.players[partner]?.alive) {
        r.players[partner].alive = false;
        victims.push(r.players[partner].username);
        r.log_(`💔 ${r.players[partner].username} meurt de chagrin...`, 'death');
      }
    }
  }

  function startDay(r, code) {
    r.phase = 'jour'; r.votes = {};
    Object.values(r.players).forEach(p => p.voted = false);
    r.timerEnd = Date.now() + r.timers().day;
    r.log_(`🗣️ Débat — ${r.alive().length} survivants. Qui est le loup ?`, 'day');
    r.narrator = 'Le village se réunit. Accusez, défendez-vous, mentez si nécessaire... Trouvez les loups !';
    bcast(code);
    r.timer = setTimeout(() => startVote(r, code), r.timers().day);
  }

  function startVote(r, code) {
    r.phase = 'vote'; r.votes = {};
    Object.values(r.players).forEach(p => p.voted = false);
    r.timerEnd = Date.now() + r.timers().vote;
    r.log_('🗳️ Vote ! Désignez le suspect.', 'vote');
    r.narrator = 'Le moment de vérité... Chaque vote peut changer le destin du village.';
    bcast(code);
    r.timer = setTimeout(() => processVote(r, code), r.timers().vote);
  }

  function processVote(r, code) {
    const tally = {};
    Object.values(r.votes).forEach(sid => { tally[sid] = (tally[sid] || 0) + 1; });
    let max = 0, elim = null;
    Object.entries(tally).forEach(([sid, c]) => { if (c > max) { max = c; elim = sid; } });
    if (elim && r.players[elim]) {
      const p = r.players[elim]; p.alive = false;
      const role = ROLES[p.role];
      r.log_(`⚰️ ${p.username} éliminé ! Il était : ${role?.emoji} ${role?.label}`, 'death');
      r.narrator = `${p.username} est éliminé ! Il était ${role?.emoji} ${role?.label}. Le village a-t-il bien voté ?`;
      loverDeath(r, elim, []);
      if (p.role === 'chasseur') {
        r.phase = 'chasseur_revenge';
        r.nightActions.chasseur = elim;
        r.timerEnd = Date.now() + r.timers().chasseur;
        r.log_('🏹 Le Chasseur peut emporter quelqu\'un !', 'death');
        r.narrator = 'Le Chasseur tombe... mais il lève son arme une dernière fois. Qui emportera-t-il ?';
        bcast(code);
        r.timer = setTimeout(() => afterChasseur(r, code), r.timers().chasseur);
        return;
      }
    } else {
      r.log_('🤷 Aucune majorité — personne n\'est éliminé.', 'info');
      r.narrator = 'Le village ne trouve pas d\'accord... La nuit approche à nouveau.';
    }
    const w = r.winner(); if (w) return endGame(r, code, w);
    startNight(r, code);
  }

  function afterChasseur(r, code) {
    const t = r.nightActions.chasseur_target;
    if (t && r.players[t]) {
      r.players[t].alive = false;
      const role = ROLES[r.players[t].role];
      r.log_(`🏹 Le Chasseur emporte ${r.players[t].username} (${role?.emoji} ${role?.label}) !`, 'death');
      loverDeath(r, t, []);
    }
    const w = r.winner(); if (w) return endGame(r, code, w);
    startNight(r, code);
  }

  function endGame(r, code, winner) {
    r.phase = 'fin'; clearTimeout(r.timer);
    if (winner === 'village') {
      r.log_('🎉 VICTOIRE DU VILLAGE ! Tous les loups sont éliminés !', 'win');
      r.narrator = 'Le village a triomphé ! Les loups sont vaincus et la paix revient...';
    } else {
      r.log_('🐺 VICTOIRE DES LOUPS ! Le village est tombé...', 'win');
      r.narrator = 'Les loups ont gagné... Le village n\'a pas su les démasquer. La nuit règne.';
    }
    bcast(code);
  }

  socket.on('night_action', ({ token, code, action, target }) => {
    const u = auth(token); if (!u) return;
    const r = rooms[code]; if (!r) return;
    const entry = Object.entries(r.players).find(([, p]) => p.username === u.username);
    if (!entry || !entry[1].alive) return;
    const [mySid, me] = entry;

    if (r.phase === 'nuit_loups' && me.role === 'loup_garou') {
      r.nightActions.loups_target = target;
      r.log_('🐺 Les loups ont désigné leur victime...', 'night');
      clearTimeout(r.timer); r.timer = setTimeout(() => nextNight(r, code), 1500);
    }
    if (r.phase === 'nuit_voyante' && me.role === 'voyante') {
      const tp = r.players[target];
      if (tp) {
        // Store revealed role
        if (!r.voyante_reveals[mySid]) r.voyante_reveals[mySid] = {};
        r.voyante_reveals[mySid][target] = tp.role;
        const role = ROLES[tp.role];
        // Send ONLY to voyante
        io.to(mySid).emit('voyante_result', {
          username: tp.username,
          role: role?.label || 'Inconnu',
          emoji: role?.emoji || '❓',
          team: role?.team || 'village'
        });
        r.log_('🔮 La Voyante a scruté une âme dans l\'ombre...', 'night');
      }
      clearTimeout(r.timer); r.timer = setTimeout(() => nextNight(r, code), 1500);
    }
    if (r.phase === 'nuit_cupidon' && me.role === 'cupidon') {
      if (action === 'link' && Array.isArray(target) && target.length === 2) {
        r.lovers = target;
        const n1 = r.players[target[0]]?.username, n2 = r.players[target[1]]?.username;
        r.log_(`💘 Cupidon a lié ${n1} et ${n2} pour l'éternité...`, 'night');
        io.to(target[0]).emit('lover_notif', { partner: n2 });
        io.to(target[1]).emit('lover_notif', { partner: n1 });
      }
      clearTimeout(r.timer); r.timer = setTimeout(() => nextNight(r, code), 1500);
    }
    if (r.phase === 'nuit_sorciere' && me.role === 'sorciere') {
      if (action === 'save' && r.witchPotions.life && r.nightActions.loups_target) {
        r.players[r.nightActions.loups_target].protected = true;
        r.witchPotions.life = false; r.nightVictim = null;
        r.log_('🧙‍♀️ La Sorcière a utilisé sa potion de vie !', 'night');
      }
      if (action === 'kill' && r.witchPotions.death && r.players[target]) {
        r.nightActions.sorciere_kill = target;
        r.witchPotions.death = false;
        r.log_('🧙‍♀️ La Sorcière a utilisé sa potion de mort...', 'night');
      }
      if (action === 'skip') r.log_('🧙‍♀️ La Sorcière ne fait rien cette nuit.', 'night');
      clearTimeout(r.timer); r.timer = setTimeout(() => nextNight(r, code), 1500);
    }
    if (r.phase === 'chasseur_revenge' && me.role === 'chasseur') {
      r.nightActions.chasseur_target = target;
      clearTimeout(r.timer); afterChasseur(r, code);
    }
    bcast(code);
  });

  socket.on('vote', ({ token, code, target }) => {
    const u = auth(token); if (!u) return;
    const r = rooms[code]; if (!r || r.phase !== 'vote') return;
    const entry = Object.entries(r.players).find(([, p]) => p.username === u.username);
    if (!entry || !entry[1].alive || entry[1].voted) return;
    if (!r.players[target]?.alive) return;
    const [mySid, me] = entry;
    r.votes[mySid] = target; me.voted = true;
    r.log_(`🗳️ ${u.username} a voté`, 'vote');
    if (r.alive().map(([s]) => s).every(s => r.votes[s])) { clearTimeout(r.timer); processVote(r, code); }
    else bcast(code);
  });

  socket.on('chat', ({ token, code, msg }) => {
    const u = auth(token); if (!u) return;
    const r = rooms[code]; if (!r) return;
    const p = Object.values(r.players).find(p => p.username === u.username);
    if (!p) return;
    // En lobby tout le monde peut chatter, en jeu seulement les vivants le jour
    if (r.phase !== 'lobby' && (!p.alive || !['jour'].includes(r.phase))) return;
    const clean = String(msg).trim().substring(0, 200);
    if (!clean) return;
    io.to(code).emit('chat_msg', { username: u.username, avatar: p.avatar, msg: clean });
  });

  socket.on('skip_day', ({ token, code }) => {
    const u = auth(token); if (!u) return;
    const r = rooms[code]; if (!r || r.phase !== 'jour' || r.host !== u.username) return;
    clearTimeout(r.timer); startVote(r, code);
  });

  socket.on('leave_room', ({ token, code }) => {
    const u = auth(token); if (!u) return;
    const r = rooms[code]; if (!r) return;
    const sid = Object.keys(r.players).find(s => r.players[s].username === u.username);
    if (sid) { r.del(sid); r.log_(`👋 ${u.username} a quitté`, 'system'); }
    if (!r.count()) delete rooms[code]; else bcast(code);
  });

  socket.on('restart_game', ({ token, code }) => {
    const u = auth(token); if (!u) return;
    const r = rooms[code]; if (!r || r.host !== u.username) return;
    Object.values(r.players).forEach(p => { p.role = null; p.alive = true; p.voted = false; p.protected = false; });
    r.phase = 'lobby'; r.round = 0; r.votes = {}; r.nightActions = {};
    r.lovers = []; r.witchPotions = { life: true, death: true };
    r.log = []; r.voyante_reveals = {};
    r.narrator = 'Nouvelle partie ! En attente du lancement...';
    r.log_('🔄 Nouvelle partie lancée par l\'hôte !', 'system');
    bcast(code);
  });

  socket.on('disconnect', () => {
    const username = socketUsers[socket.id];
    if (username) {
      Object.entries(rooms).forEach(([code, r]) => {
        if (r.players[socket.id]) {
          r.players[socket.id].connected = false;
          r.log_(`📡 ${username} déconnecté`, 'system');
          bcast(code);
        }
      });
    }
    delete socketUsers[socket.id];
  });
});

server.listen(PORT, () => console.log(`🐺 Loup-Garou v2 — port ${PORT}`));
