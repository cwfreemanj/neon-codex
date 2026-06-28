const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 10000,
  pingTimeout: 8000
});

app.use(express.static('public'));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

const PORT = process.env.PORT || 3000;
const TICK_RATE = 30;
const DT = 1 / TICK_RATE;
const MAX_PLAYERS = 12;
const ARENA = { w: 3000, h: 1900 };
const TAU = Math.PI * 2;
const rooms = new Map();
const socketRoom = new Map();

const CLASSES = {
  rune: { name: 'Rune Mecha', hp: 150, speed: 255, damage: 16, fire: 0.24, radius: 18, skill: 8.0 },
  samurai: { name: 'Cyber Samurai', hp: 120, speed: 315, damage: 13, fire: 0.17, radius: 17, skill: 5.8 },
  witch: { name: 'Neon Witch', hp: 112, speed: 275, damage: 15, fire: 0.21, radius: 17, skill: 7.2 },
  seraph: { name: 'Crystal Seraph', hp: 125, speed: 265, damage: 14, fire: 0.19, radius: 17, skill: 7.8 },
  mushroom: { name: 'Mushroom Knight', hp: 170, speed: 235, damage: 17, fire: 0.26, radius: 19, skill: 8.4 },
  dragon: { name: 'Dragonkin', hp: 135, speed: 250, damage: 20, fire: 0.28, radius: 18, skill: 9.0 },
  monk: { name: 'Quantum Monk', hp: 112, speed: 330, damage: 12, fire: 0.16, radius: 16, skill: 6.4 },
  golem: { name: 'Stone Golem', hp: 205, speed: 210, damage: 19, fire: 0.31, radius: 21, skill: 8.8 }
};

const ENEMY_TYPES = [
  { kind: 'quantum_monk', color: 0, hp: 28, speed: 125, touch: 8, score: 8, ai: 'chase', r: 15 },
  { kind: 'toxic_alchemist', color: 1, hp: 36, speed: 95, touch: 7, score: 9, ai: 'spit', r: 16 },
  { kind: 'shadow_jester', color: 2, hp: 25, speed: 145, touch: 9, score: 10, ai: 'zig', r: 15 },
  { kind: 'stone_golem', color: 5, hp: 80, speed: 70, touch: 14, score: 14, ai: 'chase', r: 20 },
  { kind: 'frost_ranger', color: 0, hp: 44, speed: 90, touch: 6, score: 12, ai: 'ranger', r: 16 },
  { kind: 'mushroom_knight', color: 4, hp: 52, speed: 88, touch: 10, score: 12, ai: 'guard', r: 18 },
  { kind: 'dragonkin', color: 3, hp: 62, speed: 95, touch: 13, score: 14, ai: 'spit', r: 18 },
  { kind: 'demon_knight', color: 2, hp: 76, speed: 92, touch: 16, score: 16, ai: 'charge', r: 19 }
];

const BOSS_TYPES = [
  { name: 'Rune Mecha Prime', kind: 'rune_mecha', color: 0, hp: 560, speed: 82, ai: 'prime', r: 42 },
  { name: 'Lava Brute', kind: 'lava_brute', color: 3, hp: 690, speed: 75, ai: 'volcano', r: 45 },
  { name: 'Neon Witch', kind: 'neon_witch', color: 4, hp: 500, speed: 105, ai: 'witch', r: 40 },
  { name: 'Clockwork Paladin', kind: 'clockwork_paladin', color: 3, hp: 760, speed: 70, ai: 'paladin', r: 46 },
  { name: 'Crystal Seraph', kind: 'crystal_seraph', color: 5, hp: 620, speed: 85, ai: 'seraph', r: 42 },
  { name: 'Orc Warlord', kind: 'orc_warlord', color: 1, hp: 705, speed: 88, ai: 'warlord', r: 44 }
];

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function dist2(a, b, c, d) { const x = a - c, y = b - d; return x * x + y * y; }
function len(x, y) { return Math.hypot(x, y) || 1; }
function rand(a, b) { return a + Math.random() * (b - a); }
function randi(a, b) { return Math.floor(rand(a, b + 1)); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function sanitizeName(name) {
  return String(name || 'Codex Runner').replace(/[<>]/g, '').trim().slice(0, 18) || 'Codex Runner';
}
function sanitizeProfile(profile = {}) {
  const classId = CLASSES[profile.classId] ? profile.classId : 'rune';
  const palette = Number.isInteger(profile.palette) ? clamp(profile.palette, 0, 7) : 0;
  const trim = Number.isInteger(profile.trim) ? clamp(profile.trim, 0, 7) : palette;
  const skin = String(profile.skin || CLASSES[classId].name.toLowerCase().replace(/ /g, '_')).replace(/[^a-z0-9_]/gi, '').slice(0, 26) || 'rune_mecha';
  const aura = String(profile.aura || 'square').replace(/[^a-z0-9_]/gi, '').slice(0, 16) || 'square';
  return { name: sanitizeName(profile.name), classId, palette, trim, skin, aura };
}
function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  } while (rooms.has(code));
  return code;
}
function serializeRoom(room) {
  return {
    code: room.code,
    mode: room.mode,
    hostId: room.hostId,
    started: room.started,
    maxPlayers: MAX_PLAYERS,
    players: Array.from(room.players.values()).map(p => ({
      id: p.id, name: p.name, classId: p.classId, skin: p.skin, palette: p.palette, trim: p.trim, aura: p.aura,
      x: p.x, y: p.y, hp: Math.ceil(p.hp), maxHp: p.maxHp, shield: Math.ceil(p.shield), maxShield: p.maxShield,
      team: p.team, kills: p.kills, deaths: p.deaths, score: Math.floor(p.score), shards: p.shards, alive: p.alive,
      respawn: p.respawn, skillCd: Math.max(0, p.skillCd), dashCd: Math.max(0, p.dashCd), dir: p.dir
    })),
    hill: room.hill,
    crystals: room.crystals,
    scoreLimit: room.scoreLimit,
    timeLeft: Math.max(0, Math.ceil(room.timeLeft)),
    message: room.message,
    wave: room.wave,
    winner: room.winner
  };
}
function makeRoom(mode = 'coop') {
  const code = makeCode();
  const room = {
    code,
    mode,
    hostId: null,
    players: new Map(),
    bullets: [],
    enemyBullets: [],
    enemies: [],
    pickups: [],
    hazards: [],
    t: 0,
    started: false,
    wave: 0,
    spawnTimer: 0,
    clearTimer: 0,
    scoreLimit: mode === 'hill' ? 240 : mode === 'ffa' ? 18 : 1,
    timeLeft: mode === 'coop' ? 9999 : 360,
    message: 'Waiting in the lobby',
    winner: null,
    hill: { x: ARENA.w / 2, y: ARENA.h / 2, r: 230, owner: null, cyan: 0, magenta: 0, pulse: 0 },
    crystals: {
      cyan: { x: 230, y: ARENA.h / 2, hp: 1400, maxHp: 1400 },
      magenta: { x: ARENA.w - 230, y: ARENA.h / 2, hp: 1400, maxHp: 1400 }
    },
    lastEmpty: Date.now()
  };
  rooms.set(code, room);
  return room;
}
function teamCounts(room) {
  let cyan = 0, magenta = 0;
  for (const p of room.players.values()) {
    if (p.team === 'cyan') cyan++;
    if (p.team === 'magenta') magenta++;
  }
  return { cyan, magenta };
}
function assignTeam(room) {
  if (room.mode === 'coop') return 'cyan';
  if (room.mode === 'ffa') return 'solo';
  const c = teamCounts(room);
  return c.cyan <= c.magenta ? 'cyan' : 'magenta';
}
function spawnPoint(room, team = 'cyan') {
  if (room.mode === 'crystal') {
    return team === 'magenta' ? { x: ARENA.w - 390 + rand(-80, 80), y: ARENA.h / 2 + rand(-220, 220) } : { x: 390 + rand(-80, 80), y: ARENA.h / 2 + rand(-220, 220) };
  }
  if (room.mode === 'hill') {
    return team === 'magenta' ? { x: ARENA.w - 360 + rand(-100, 100), y: ARENA.h / 2 + rand(-300, 300) } : { x: 360 + rand(-100, 100), y: ARENA.h / 2 + rand(-300, 300) };
  }
  return { x: ARENA.w / 2 + rand(-260, 260), y: ARENA.h / 2 + rand(-210, 210) };
}
function addPlayerToRoom(socket, room, profile) {
  if (room.players.size >= MAX_PLAYERS) return { ok: false, error: 'That room is full.' };
  const clean = sanitizeProfile(profile);
  const base = CLASSES[clean.classId];
  const team = assignTeam(room);
  const pos = spawnPoint(room, team);
  const p = {
    id: socket.id,
    name: clean.name || `Player ${room.players.size + 1}`,
    classId: clean.classId,
    skin: clean.skin,
    palette: clean.palette,
    trim: clean.trim,
    aura: clean.aura,
    x: pos.x,
    y: pos.y,
    vx: 0,
    vy: 0,
    r: base.radius,
    hp: base.hp,
    maxHp: base.hp,
    shield: clean.classId === 'mushroom' ? 40 : 15,
    maxShield: clean.classId === 'mushroom' ? 55 : 25,
    speed: base.speed,
    damage: base.damage,
    fireDelay: base.fire,
    lastShot: 0,
    dashCd: 0,
    skillCd: 0,
    inv: 0,
    team,
    kills: 0,
    deaths: 0,
    score: 0,
    shards: 0,
    alive: true,
    respawn: 0,
    dir: 1,
    input: { mx: 0, my: 0, aim: 0, shoot: false, dash: false, skill: false }
  };
  room.players.set(socket.id, p);
  if (!room.hostId) room.hostId = socket.id;
  socket.join(room.code);
  socketRoom.set(socket.id, room.code);
  return { ok: true, room: serializeRoom(room) };
}
function resetPlayer(room, p) {
  const base = CLASSES[p.classId] || CLASSES.rune;
  const pos = spawnPoint(room, p.team);
  Object.assign(p, {
    x: pos.x, y: pos.y, vx: 0, vy: 0,
    hp: base.hp, maxHp: base.hp, shield: p.classId === 'mushroom' ? 40 : 15, maxShield: p.classId === 'mushroom' ? 55 : 25,
    speed: base.speed, damage: base.damage, fireDelay: base.fire, r: base.radius,
    alive: true, respawn: 0, inv: 2.2, dashCd: 0.8, skillCd: 2.0
  });
}
function startRoom(room) {
  room.started = true;
  room.t = 0;
  room.wave = 0;
  room.bullets = [];
  room.enemyBullets = [];
  room.enemies = [];
  room.pickups = [];
  room.hazards = [];
  room.clearTimer = 0;
  room.winner = null;
  room.hill = { x: ARENA.w / 2, y: ARENA.h / 2, r: 230, owner: null, cyan: 0, magenta: 0, pulse: 0 };
  room.crystals = {
    cyan: { x: 230, y: ARENA.h / 2, hp: 1400, maxHp: 1400 },
    magenta: { x: ARENA.w - 230, y: ARENA.h / 2, hp: 1400, maxHp: 1400 }
  };
  room.timeLeft = room.mode === 'coop' ? 9999 : 360;
  room.scoreLimit = room.mode === 'hill' ? 240 : room.mode === 'ffa' ? 18 : 1;
  for (const p of room.players.values()) {
    if (room.mode === 'coop') p.team = 'cyan';
    if (room.mode === 'ffa') p.team = 'solo';
    resetPlayer(room, p);
    p.kills = 0;
    p.deaths = 0;
    p.score = 0;
    p.shards = 0;
  }
  room.message = modeTitle(room.mode) + ' begins';
  if (room.mode === 'coop') nextWave(room);
}
function modeTitle(mode) {
  return mode === 'coop' ? 'Co-op Boss Rush' : mode === 'hill' ? 'King/Queen of the Hill' : mode === 'ffa' ? 'Free-for-All Versus' : 'Crystal Clash Versus';
}
function nextWave(room) {
  room.wave++;
  room.clearTimer = 0;
  const playerCount = Math.max(1, room.players.size);
  const count = Math.min(48, 5 + Math.floor(room.wave * 1.6) + playerCount * 2);
  for (let i = 0; i < count; i++) spawnEnemy(room, false);
  if (room.wave % 4 === 0) spawnEnemy(room, true);
  room.message = room.wave % 4 === 0 ? `Wave ${room.wave}: boss signature detected` : `Wave ${room.wave} awakened`;
}
function spawnEnemy(room, boss = false) {
  const template = boss ? pick(BOSS_TYPES) : pick(ENEMY_TYPES);
  const scale = boss ? 1 + room.wave * 0.18 + room.players.size * 0.12 : 1 + room.wave * 0.095 + room.players.size * 0.08;
  let x, y;
  let attempts = 0;
  do {
    const edge = randi(0, 3);
    if (edge === 0) { x = rand(80, ARENA.w - 80); y = 60; }
    else if (edge === 1) { x = rand(80, ARENA.w - 80); y = ARENA.h - 60; }
    else if (edge === 2) { x = 60; y = rand(80, ARENA.h - 80); }
    else { x = ARENA.w - 60; y = rand(80, ARENA.h - 80); }
    attempts++;
  } while (attempts < 12 && nearestLivingPlayer(room, x, y, 500));
  room.enemies.push({
    id: 'e' + Math.random().toString(36).slice(2),
    boss,
    name: template.name || template.kind,
    kind: template.kind,
    color: template.color,
    x, y,
    vx: 0,
    vy: 0,
    r: boss ? template.r : template.r + Math.min(5, room.wave * 0.15),
    hp: template.hp * scale,
    maxHp: template.hp * scale,
    speed: template.speed + room.wave * 1.8,
    touch: template.touch + room.wave * 0.9,
    score: (template.score || 60) * (boss ? 8 : 1),
    ai: template.ai,
    cd: rand(0.4, 1.8),
    frozen: 0,
    ang: 0
  });
}
function nearestLivingPlayer(room, x, y, maxDist = Infinity) {
  let best = null, bd = maxDist * maxDist;
  for (const p of room.players.values()) {
    if (!p.alive) continue;
    const d = dist2(x, y, p.x, p.y);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
function enemyTarget(room, enemy) {
  return nearestLivingPlayer(room, enemy.x, enemy.y);
}
function targetForPlayer(room, p, maxDist = 650) {
  let best = null, bd = maxDist * maxDist;
  if (room.mode === 'coop') {
    for (const e of room.enemies) {
      const d = dist2(p.x, p.y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
  } else {
    for (const q of room.players.values()) {
      if (q.id === p.id || !q.alive || sameTeam(room, p, q)) continue;
      const d = dist2(p.x, p.y, q.x, q.y);
      if (d < bd) { bd = d; best = q; }
    }
  }
  return best;
}
function sameTeam(room, a, b) {
  if (room.mode === 'ffa') return false;
  if (room.mode === 'coop') return true;
  return a.team === b.team;
}
function spawnBullet(room, owner, angle, opts = {}) {
  const speed = opts.speed || 680;
  room.bullets.push({
    id: 'b' + Math.random().toString(36).slice(2),
    owner: owner.id,
    team: owner.team,
    x: owner.x + Math.cos(angle) * (owner.r + 9),
    y: owner.y + Math.sin(angle) * (owner.r + 9),
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    r: opts.r || 5,
    damage: opts.damage || owner.damage,
    life: opts.life || 1.15,
    color: opts.color ?? owner.palette,
    pierce: opts.pierce || 0,
    explode: !!opts.explode,
    homing: opts.homing || 0
  });
}
function spawnEnemyBullet(room, enemy, angle, damage, speed = 420) {
  room.enemyBullets.push({
    id: 'eb' + Math.random().toString(36).slice(2),
    x: enemy.x + Math.cos(angle) * enemy.r,
    y: enemy.y + Math.sin(angle) * enemy.r,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    r: enemy.boss ? 7 : 5,
    damage,
    life: enemy.boss ? 2.3 : 1.8,
    color: enemy.color
  });
}
function hurtPlayer(room, p, dmg, attacker = null) {
  if (!p.alive || p.inv > 0) return false;
  let remain = dmg;
  if (p.shield > 0) {
    const s = Math.min(p.shield, remain);
    p.shield -= s;
    remain -= s;
  }
  p.hp -= remain;
  p.inv = 0.08;
  if (p.hp <= 0) {
    killPlayer(room, p, attacker);
    return true;
  }
  return false;
}
function killPlayer(room, p, attacker = null) {
  p.alive = false;
  p.respawn = room.mode === 'coop' ? 5.0 : 3.0;
  p.deaths++;
  p.hp = 0;
  if (attacker && attacker.id && attacker.id !== p.id) {
    const a = room.players.get(attacker.id);
    if (a) {
      a.kills++;
      a.score += room.mode === 'ffa' ? 1 : 8;
      if (room.mode === 'ffa' && a.kills >= room.scoreLimit) room.winner = a.name;
    }
  }
  if (room.mode === 'coop') {
    const anyAlive = Array.from(room.players.values()).some(x => x.alive);
    if (!anyAlive) {
      room.winner = 'The Codex shattered at Wave ' + room.wave;
      room.message = room.winner;
    }
  }
}
function damageEnemy(room, enemy, dmg, owner) {
  enemy.hp -= dmg;
  if (enemy.hp <= 0) {
    const idx = room.enemies.indexOf(enemy);
    if (idx >= 0) room.enemies.splice(idx, 1);
    if (owner) {
      owner.kills++;
      owner.score += enemy.score;
      owner.shards += enemy.boss ? 12 + room.wave : randi(1, 3);
      owner.hp = Math.min(owner.maxHp, owner.hp + (enemy.boss ? 22 : 4));
    }
    for (let i = 0; i < (enemy.boss ? 12 : 3); i++) {
      room.pickups.push({ id: 'p' + Math.random().toString(36).slice(2), x: enemy.x + rand(-16, 16), y: enemy.y + rand(-16, 16), r: 9, kind: Math.random() < 0.15 ? 'heart' : 'shard', value: enemy.boss ? 3 : 1, life: 12, vx: rand(-90, 90), vy: rand(-90, 90) });
    }
  }
}
function slash(room, p, radius, damage) {
  if (room.mode === 'coop') {
    for (const e of [...room.enemies]) if (dist2(p.x, p.y, e.x, e.y) < (radius + e.r) ** 2) damageEnemy(room, e, damage, p);
  } else {
    for (const q of room.players.values()) if (q.id !== p.id && q.alive && !sameTeam(room, p, q) && dist2(p.x, p.y, q.x, q.y) < (radius + q.r) ** 2) hurtPlayer(room, q, damage, p);
  }
}
function useSkill(room, p) {
  p.skillCd = (CLASSES[p.classId] || CLASSES.rune).skill;
  if (p.classId === 'rune') {
    for (let i = 0; i < 14; i++) spawnBullet(room, p, i / 14 * TAU, { damage: p.damage * 0.95, speed: 610, life: 1.35, pierce: 1, r: 5 });
  } else if (p.classId === 'samurai') {
    const a = p.input.aim || 0;
    p.x = clamp(p.x + Math.cos(a) * 170, 35, ARENA.w - 35);
    p.y = clamp(p.y + Math.sin(a) * 170, 35, ARENA.h - 35);
    p.inv = 0.45;
    slash(room, p, 125, p.damage * 2.5);
  } else if (p.classId === 'witch') {
    for (let i = 0; i < 9; i++) spawnBullet(room, p, i / 9 * TAU, { damage: p.damage * 1.05, speed: 520, life: 1.7, homing: 0.07, r: 6 });
  } else if (p.classId === 'seraph') {
    for (const q of room.players.values()) if (q.alive && (room.mode === 'ffa' ? q.id === p.id : q.team === p.team) && dist2(p.x, p.y, q.x, q.y) < 320 * 320) q.hp = Math.min(q.maxHp, q.hp + 48);
    for (const e of room.enemies) if (dist2(p.x, p.y, e.x, e.y) < 340 * 340) e.frozen = Math.max(e.frozen, 2.0);
    slash(room, p, 160, p.damage * 1.35);
  } else if (p.classId === 'mushroom') {
    p.shield = Math.min(p.maxShield, p.shield + 55);
    room.hazards.push({ owner: p.id, team: p.team, x: p.x, y: p.y, r: 135, damage: p.damage * 0.38, life: 4.2, color: p.palette });
  } else if (p.classId === 'dragon') {
    for (let i = 0; i < 22; i++) spawnBullet(room, p, i / 22 * TAU, { damage: p.damage * 1.15, speed: 560, life: 1.45, explode: true, r: 7 });
  } else if (p.classId === 'monk') {
    const a = p.input.aim || 0;
    p.x = clamp(p.x + Math.cos(a) * 230, 35, ARENA.w - 35);
    p.y = clamp(p.y + Math.sin(a) * 230, 35, ARENA.h - 35);
    p.inv = 1.0;
    for (let i = 0; i < 10; i++) spawnBullet(room, p, a + (i - 4.5) * 0.13, { damage: p.damage * 0.82, speed: 660, life: 1.15, r: 4 });
  } else if (p.classId === 'golem') {
    p.inv = 0.7;
    slash(room, p, 190, p.damage * 2.1);
    for (const q of room.players.values()) if (q.id !== p.id && q.alive && !sameTeam(room, p, q) && dist2(p.x, p.y, q.x, q.y) < 260 * 260) {
      const a = Math.atan2(q.y - p.y, q.x - p.x);
      q.x = clamp(q.x + Math.cos(a) * 90, 35, ARENA.w - 35);
      q.y = clamp(q.y + Math.sin(a) * 90, 35, ARENA.h - 35);
    }
  }
}
function updateRoom(room) {
  if (room.players.size === 0) {
    if (Date.now() - room.lastEmpty > 120000) rooms.delete(room.code);
    return;
  }
  room.lastEmpty = Date.now();
  if (!room.started) return;
  room.t += DT;
  if (room.mode !== 'coop' && !room.winner) {
    room.timeLeft -= DT;
    if (room.timeLeft <= 0) room.winner = decideWinner(room);
  }

  for (const p of room.players.values()) updatePlayer(room, p);
  updateBullets(room);
  updateEnemyBullets(room);
  updateHazards(room);
  updatePickups(room);
  if (room.mode === 'coop' && !room.winner) updateCoop(room);
  if (room.mode === 'hill' && !room.winner) updateHill(room);
  if (room.mode === 'crystal' && !room.winner) updateCrystal(room);
}
function updatePlayer(room, p) {
  p.dashCd = Math.max(0, p.dashCd - DT);
  p.skillCd = Math.max(0, p.skillCd - DT);
  p.inv = Math.max(0, p.inv - DT);
  if (!p.alive) {
    p.respawn -= DT;
    if (p.respawn <= 0 && !room.winner) resetPlayer(room, p);
    return;
  }
  const base = CLASSES[p.classId] || CLASSES.rune;
  if (p.classId === 'seraph') p.hp = Math.min(p.maxHp, p.hp + 2.2 * DT);
  p.shield = Math.min(p.maxShield, p.shield + 1.9 * DT);
  let mx = clamp(Number(p.input.mx) || 0, -1, 1);
  let my = clamp(Number(p.input.my) || 0, -1, 1);
  const m = len(mx, my);
  if (m > 1) { mx /= m; my /= m; }
  p.dir = Math.cos(p.input.aim || 0) >= 0 ? 1 : -1;
  if (p.input.dash && p.dashCd <= 0) {
    const a = Math.abs(mx) + Math.abs(my) > 0.05 ? Math.atan2(my, mx) : (p.input.aim || 0);
    p.x += Math.cos(a) * (p.classId === 'monk' ? 165 : 125);
    p.y += Math.sin(a) * (p.classId === 'monk' ? 165 : 125);
    p.inv = p.classId === 'samurai' ? 0.42 : 0.25;
    p.dashCd = p.classId === 'samurai' ? 0.9 : 1.35;
    if (p.classId === 'samurai') slash(room, p, 95, p.damage * 1.75);
  }
  p.x = clamp(p.x + mx * base.speed * DT, 30, ARENA.w - 30);
  p.y = clamp(p.y + my * base.speed * DT, 30, ARENA.h - 30);
  if (p.input.skill && p.skillCd <= 0) useSkill(room, p);
  if (p.input.shoot && room.t - p.lastShot >= p.fireDelay) {
    const opts = {};
    if (p.classId === 'dragon') { opts.explode = true; opts.r = 6; opts.speed = 600; }
    if (p.classId === 'rune') opts.pierce = 1;
    if (p.classId === 'witch') opts.homing = 0.045;
    if (p.classId === 'monk') opts.speed = 730;
    spawnBullet(room, p, p.input.aim || 0, opts);
    p.lastShot = room.t;
  }
}
function updateBullets(room) {
  for (let i = room.bullets.length - 1; i >= 0; i--) {
    const b = room.bullets[i];
    b.life -= DT;
    if (b.homing) {
      const owner = room.players.get(b.owner);
      if (owner) {
        const t = targetForPlayer(room, owner, 700);
        if (t) {
          const dx = t.x - b.x, dy = t.y - b.y;
          const d = len(dx, dy), speed = len(b.vx, b.vy);
          b.vx = b.vx * (1 - b.homing) + dx / d * speed * b.homing;
          b.vy = b.vy * (1 - b.homing) + dy / d * speed * b.homing;
        }
      }
    }
    b.x += b.vx * DT;
    b.y += b.vy * DT;
    if (b.life <= 0 || b.x < -100 || b.y < -100 || b.x > ARENA.w + 100 || b.y > ARENA.h + 100) { room.bullets.splice(i, 1); continue; }
    const owner = room.players.get(b.owner);
    let hit = false;
    if (room.mode === 'coop') {
      for (const e of [...room.enemies]) {
        if (dist2(b.x, b.y, e.x, e.y) < (b.r + e.r) ** 2) {
          damageEnemy(room, e, b.damage, owner);
          if (b.explode) explode(room, b, owner);
          if (b.pierce > 0) b.pierce--; else hit = true;
          break;
        }
      }
    } else {
      for (const q of room.players.values()) {
        if (!q.alive || q.id === b.owner) continue;
        const fakeOwner = owner || { team: b.team };
        if (sameTeam(room, fakeOwner, q)) continue;
        if (dist2(b.x, b.y, q.x, q.y) < (b.r + q.r) ** 2) {
          hurtPlayer(room, q, b.damage, owner);
          if (b.explode) explode(room, b, owner);
          if (b.pierce > 0) b.pierce--; else hit = true;
          break;
        }
      }
      if (!hit && room.mode === 'crystal') {
        const enemyKey = b.team === 'cyan' ? 'magenta' : 'cyan';
        const c = room.crystals[enemyKey];
        if (c && dist2(b.x, b.y, c.x, c.y) < (b.r + 55) ** 2) {
          c.hp = Math.max(0, c.hp - b.damage);
          if (owner) owner.score += b.damage * 0.04;
          hit = true;
        }
      }
    }
    if (hit) room.bullets.splice(i, 1);
  }
}
function explode(room, b, owner) {
  const radius = 72;
  if (room.mode === 'coop') {
    for (const e of [...room.enemies]) if (dist2(b.x, b.y, e.x, e.y) < (radius + e.r) ** 2) damageEnemy(room, e, b.damage * 0.45, owner);
  } else if (owner) {
    for (const q of room.players.values()) if (q.id !== owner.id && q.alive && !sameTeam(room, owner, q) && dist2(b.x, b.y, q.x, q.y) < (radius + q.r) ** 2) hurtPlayer(room, q, b.damage * 0.45, owner);
  }
}
function updateEnemyBullets(room) {
  for (let i = room.enemyBullets.length - 1; i >= 0; i--) {
    const b = room.enemyBullets[i];
    b.life -= DT;
    b.x += b.vx * DT;
    b.y += b.vy * DT;
    if (b.life <= 0 || b.x < -100 || b.y < -100 || b.x > ARENA.w + 100 || b.y > ARENA.h + 100) { room.enemyBullets.splice(i, 1); continue; }
    for (const p of room.players.values()) {
      if (!p.alive) continue;
      if (dist2(b.x, b.y, p.x, p.y) < (b.r + p.r) ** 2) {
        hurtPlayer(room, p, b.damage, null);
        room.enemyBullets.splice(i, 1);
        break;
      }
    }
  }
}
function updateHazards(room) {
  for (let i = room.hazards.length - 1; i >= 0; i--) {
    const h = room.hazards[i];
    h.life -= DT;
    if (h.life <= 0) { room.hazards.splice(i, 1); continue; }
    const owner = room.players.get(h.owner);
    if (room.t % 0.3 < DT) {
      if (room.mode === 'coop') {
        for (const e of [...room.enemies]) if (dist2(h.x, h.y, e.x, e.y) < (h.r + e.r) ** 2) damageEnemy(room, e, h.damage, owner);
      } else if (owner) {
        for (const q of room.players.values()) if (q.id !== h.owner && q.alive && !sameTeam(room, owner, q) && dist2(h.x, h.y, q.x, q.y) < (h.r + q.r) ** 2) hurtPlayer(room, q, h.damage, owner);
      }
    }
  }
}
function updatePickups(room) {
  for (let i = room.pickups.length - 1; i >= 0; i--) {
    const o = room.pickups[i];
    o.life -= DT;
    o.x += o.vx * DT;
    o.y += o.vy * DT;
    o.vx *= 0.96;
    o.vy *= 0.96;
    if (o.life <= 0) { room.pickups.splice(i, 1); continue; }
    for (const p of room.players.values()) {
      if (!p.alive) continue;
      if (dist2(o.x, o.y, p.x, p.y) < (o.r + p.r + 20) ** 2) {
        if (o.kind === 'heart') p.hp = Math.min(p.maxHp, p.hp + 22);
        else { p.shards += o.value || 1; p.score += 2; }
        room.pickups.splice(i, 1);
        break;
      }
    }
  }
}
function updateCoop(room) {
  updateEnemies(room);
  if (room.enemies.length === 0 && room.clearTimer <= 0) {
    room.clearTimer = 3.0;
    room.message = `Wave ${room.wave} cleared`;
    for (const p of room.players.values()) if (p.alive) { p.hp = Math.min(p.maxHp, p.hp + 18); p.shards += 2; }
  }
  if (room.clearTimer > 0) {
    room.clearTimer -= DT;
    if (room.clearTimer <= 0) nextWave(room);
  }
}
function updateEnemies(room) {
  for (const e of room.enemies) {
    e.ang += DT * 2;
    if (e.frozen > 0) { e.frozen -= DT; continue; }
    const target = enemyTarget(room, e);
    if (!target) continue;
    let dx = target.x - e.x, dy = target.y - e.y;
    const d = len(dx, dy);
    dx /= d; dy /= d;
    if (e.ai === 'zig') {
      dx += Math.cos(room.t * 4 + e.x * 0.01) * 0.55;
      dy += Math.sin(room.t * 4 + e.y * 0.01) * 0.55;
      const m = len(dx, dy); dx /= m; dy /= m;
    }
    let speed = e.speed;
    if (e.ai === 'ranger' && d < 430) speed *= -0.35;
    if (e.ai === 'guard' && d < 160) speed *= 0.2;
    e.x = clamp(e.x + dx * speed * DT, 28, ARENA.w - 28);
    e.y = clamp(e.y + dy * speed * DT, 28, ARENA.h - 28);
    e.cd -= DT;
    if ((e.ai === 'spit' || e.ai === 'ranger') && e.cd <= 0 && d < 650) {
      spawnEnemyBullet(room, e, Math.atan2(target.y - e.y, target.x - e.x), e.boss ? 18 : 10, e.ai === 'ranger' ? 500 : 390);
      e.cd = e.ai === 'ranger' ? 1.25 : 1.55;
    }
    if (e.boss && e.cd <= 0 && d < 760) {
      for (let i = -2; i <= 2; i++) spawnEnemyBullet(room, e, Math.atan2(target.y - e.y, target.x - e.x) + i * 0.16, 18 + room.wave, 430);
      e.cd = 1.8;
    }
    if (dist2(e.x, e.y, target.x, target.y) < (e.r + target.r) ** 2) hurtPlayer(room, target, e.touch, null);
  }
}
function updateHill(room) {
  room.hill.pulse += DT;
  let cyan = 0, magenta = 0;
  for (const p of room.players.values()) {
    if (!p.alive) continue;
    if (dist2(p.x, p.y, room.hill.x, room.hill.y) < room.hill.r ** 2) {
      if (p.team === 'cyan') cyan++;
      if (p.team === 'magenta') magenta++;
    }
  }
  if (cyan > magenta) { room.hill.owner = 'cyan'; room.hill.cyan += DT * (1 + (cyan - magenta) * 0.25); }
  if (magenta > cyan) { room.hill.owner = 'magenta'; room.hill.magenta += DT * (1 + (magenta - cyan) * 0.25); }
  if (room.hill.cyan >= room.scoreLimit) room.winner = 'Cyan Crown';
  if (room.hill.magenta >= room.scoreLimit) room.winner = 'Magenta Crown';
}
function updateCrystal(room) {
  if (room.crystals.cyan.hp <= 0) room.winner = 'Magenta Crystal Clan';
  if (room.crystals.magenta.hp <= 0) room.winner = 'Cyan Crystal Clan';
}
function decideWinner(room) {
  if (room.mode === 'hill') return room.hill.cyan >= room.hill.magenta ? 'Cyan Crown' : 'Magenta Crown';
  if (room.mode === 'crystal') return room.crystals.cyan.hp >= room.crystals.magenta.hp ? 'Cyan Crystal Clan' : 'Magenta Crystal Clan';
  let best = null;
  for (const p of room.players.values()) if (!best || p.kills > best.kills || (p.kills === best.kills && p.deaths < best.deaths)) best = p;
  return best ? best.name : 'No one';
}
function snapshot(room) {
  return {
    code: room.code,
    mode: room.mode,
    started: room.started,
    hostId: room.hostId,
    t: room.t,
    arena: ARENA,
    localMaxPlayers: MAX_PLAYERS,
    players: Array.from(room.players.values()).map(p => ({
      id: p.id, name: p.name, classId: p.classId, skin: p.skin, palette: p.palette, trim: p.trim, aura: p.aura,
      x: Math.round(p.x), y: Math.round(p.y), hp: Math.ceil(p.hp), maxHp: p.maxHp, shield: Math.ceil(p.shield), maxShield: p.maxShield,
      team: p.team, kills: p.kills, deaths: p.deaths, score: Math.floor(p.score), shards: p.shards, alive: p.alive, respawn: Math.max(0, p.respawn), skillCd: Math.max(0, p.skillCd), dashCd: Math.max(0, p.dashCd), dir: p.dir
    })),
    enemies: room.enemies.map(e => ({ id: e.id, x: Math.round(e.x), y: Math.round(e.y), r: e.r, hp: Math.ceil(e.hp), maxHp: Math.ceil(e.maxHp), kind: e.kind, color: e.color, boss: e.boss, name: e.name, frozen: e.frozen > 0 })),
    bullets: room.bullets.map(b => ({ x: Math.round(b.x), y: Math.round(b.y), vx: b.vx, vy: b.vy, r: b.r, color: b.color, owner: b.owner })),
    enemyBullets: room.enemyBullets.map(b => ({ x: Math.round(b.x), y: Math.round(b.y), vx: b.vx, vy: b.vy, r: b.r, color: b.color })),
    pickups: room.pickups.map(o => ({ x: Math.round(o.x), y: Math.round(o.y), r: o.r, kind: o.kind, value: o.value })),
    hazards: room.hazards.map(h => ({ x: Math.round(h.x), y: Math.round(h.y), r: h.r, color: h.color, team: h.team, life: h.life })),
    hill: room.hill,
    crystals: room.crystals,
    wave: room.wave,
    message: room.message,
    winner: room.winner,
    timeLeft: Math.max(0, Math.ceil(room.timeLeft)),
    scoreLimit: room.scoreLimit
  };
}

io.on('connection', socket => {
  socket.emit('hello', { id: socket.id, maxPlayers: MAX_PLAYERS });

  socket.on('createRoom', (data = {}, ack = () => {}) => {
    const mode = ['coop', 'hill', 'ffa', 'crystal'].includes(data.mode) ? data.mode : 'coop';
    const room = makeRoom(mode);
    const result = addPlayerToRoom(socket, room, data.profile || {});
    if (result.ok) result.room = serializeRoom(room);
    ack(result);
    io.to(room.code).emit('room', serializeRoom(room));
  });

  socket.on('quickJoin', (data = {}, ack = () => {}) => {
    const mode = ['coop', 'hill', 'ffa', 'crystal'].includes(data.mode) ? data.mode : 'coop';
    let room = Array.from(rooms.values()).find(r => r.mode === mode && r.players.size < MAX_PLAYERS && !r.winner);
    if (!room) room = makeRoom(mode);
    const result = addPlayerToRoom(socket, room, data.profile || {});
    ack(result);
    io.to(room.code).emit('room', serializeRoom(room));
  });

  socket.on('joinRoom', (data = {}, ack = () => {}) => {
    const code = String(data.code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return ack({ ok: false, error: 'Room not found.' });
    const result = addPlayerToRoom(socket, room, data.profile || {});
    ack(result);
    io.to(room.code).emit('room', serializeRoom(room));
  });

  socket.on('updateProfile', (profile = {}) => {
    const code = socketRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p || room.started) return;
    const clean = sanitizeProfile(profile);
    Object.assign(p, clean);
    const base = CLASSES[p.classId] || CLASSES.rune;
    p.maxHp = base.hp; p.hp = base.hp; p.speed = base.speed; p.damage = base.damage; p.fireDelay = base.fire; p.r = base.radius;
    io.to(room.code).emit('room', serializeRoom(room));
  });

  socket.on('startMatch', (ack = () => {}) => {
    const code = socketRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room) return ack({ ok: false, error: 'No room.' });
    if (room.hostId !== socket.id) return ack({ ok: false, error: 'Only the host can start.' });
    startRoom(room);
    ack({ ok: true });
    io.to(room.code).emit('room', serializeRoom(room));
  });

  socket.on('input', data => {
    const code = socketRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room || !room.started) return;
    const p = room.players.get(socket.id);
    if (!p) return;
    p.input = {
      mx: clamp(Number(data.mx) || 0, -1, 1),
      my: clamp(Number(data.my) || 0, -1, 1),
      aim: Number.isFinite(data.aim) ? data.aim : 0,
      shoot: !!data.shoot,
      dash: !!data.dash,
      skill: !!data.skill
    };
  });

  socket.on('leaveRoom', () => leave(socket));
  socket.on('disconnect', () => leave(socket));
});
function leave(socket) {
  const code = socketRoom.get(socket.id);
  if (!code) return;
  const room = rooms.get(code);
  socketRoom.delete(socket.id);
  if (!room) return;
  room.players.delete(socket.id);
  socket.leave(code);
  if (room.hostId === socket.id) room.hostId = room.players.keys().next().value || null;
  if (room.players.size === 0) room.lastEmpty = Date.now();
  else io.to(code).emit('room', serializeRoom(room));
}

setInterval(() => {
  for (const room of rooms.values()) {
    updateRoom(room);
    if (room.started) io.to(room.code).emit('snapshot', snapshot(room));
  }
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`Neon Codex multiplayer server running on port ${PORT}`);
});
