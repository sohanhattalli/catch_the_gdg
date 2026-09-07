const GAME_LENGTH = 60;
const boardKey = 'catch-the-google-scores';
const screens = { intro: document.querySelector('#intro-screen'), game: document.querySelector('#game-screen'), result: document.querySelector('#result-screen') };
const elements = { form: document.querySelector('#start-form'), name: document.querySelector('#player-name'), field: document.querySelector('#playfield'), score: document.querySelector('#score'), streak: document.querySelector('#streak'), boost: document.querySelector('#boost'), banner: document.querySelector('#final-banner'), time: document.querySelector('#time-left'), progress: document.querySelector('#time-progress'), activePlayer: document.querySelector('#active-player'), finalScore: document.querySelector('#final-score'), resultPlayer: document.querySelector('#result-player'), resultNote: document.querySelector('#result-note'), quit: document.querySelector('#quit-button'), again: document.querySelector('#play-again'), home: document.querySelector('#back-home') };
let player = ''; let score = 0; let streak = 0; let timeLeft = GAME_LENGTH; let timer; let roundActive = false; let cloudScores = null; let scoresRef = null;
const BALL_SIZE_MAX = 86;
const BALL_SIZE_MIN = 42;
const ORB_LIFETIME_EASY = 1450; const ORB_LIFETIME_HARD = 780;
const MAX_ORBS_EASY = 2; const MAX_ORBS_HARD = 4;
const SPAWN_CHECK_INTERVAL = 300;
const FINAL_STRETCH_SECONDS = 10; const FINAL_STRETCH_LIFETIME = 520; const FINAL_STRETCH_MAX_ORBS = 5; const FINAL_STRETCH_SIZE = 52; const FINAL_STRETCH_MULTIPLIER = 3;
const DECOY_CHANCE_EASY = 0.1; const DECOY_CHANCE_HARD = 0.24;
const POWER_CHANCE = 0.07; const POWER_COOLDOWN = 11000; const POWER_LIFETIME = 3200; const POWER_DURATION = 5000; const POWER_MULTIPLIER = 2;
const BOSS_CHANCE = 0.05; const BOSS_COOLDOWN = 18000; const BOSS_LIFETIME = 2600; const BOSS_BONUS = 15; const BOSS_MIN_ELAPSED = 8;
const STREAK_BONUS_STEP = 5; const STREAK_BONUS_POINTS = 5;
const PARTICLE_COLORS = ['#4285f4', '#ea4335', '#fbbc05', '#34a853'];
let orbs = new Map(); let spawnInterval = null; let orbSeq = 0;
let multiplierActive = false; let multiplierTimeout = null;
let finalStretchActive = false; let bannerTimeout = null;
let lastPowerAt = -Infinity; let lastBossAt = -Infinity;
let audioCtx = null;

function getScores() { try { return JSON.parse(localStorage.getItem(boardKey)) || []; } catch { return []; } }
function saveScore() { const scores = [...getScores(), { name: player, score }].sort((a, b) => b.score - a.score).slice(0, 8); localStorage.setItem(boardKey, JSON.stringify(scores)); if (scoresRef) { scoresRef.push({ name: player, score, createdAt: firebase.database.ServerValue.TIMESTAMP }).catch((error) => console.warn('[leaderboard] cloud save failed:', error.message)); } return scores; }
function renderBoards() { const scores = cloudScores && cloudScores.length ? cloudScores : getScores(); document.querySelectorAll('.leaderboard').forEach((board) => { board.innerHTML = scores.map((entry, index) => `<li><span class="rank">0${index + 1}</span><span class="player">${escapeHtml(entry.name)}</span><span class="points">${entry.score}</span></li>`).join(''); }); document.querySelectorAll('.empty-board').forEach((empty) => { empty.hidden = scores.length > 0; }); }
function connectFirebase() { const config = window.FIREBASE_CONFIG; if (!window.firebase || !config || !config.apiKey || config.apiKey.includes('PASTE_') || config.projectId === 'YOUR_PROJECT_ID') return; try { firebase.initializeApp(config); scoresRef = firebase.database().ref('scores'); scoresRef.orderByChild('score').limitToLast(8).on('value', (snapshot) => { const rows = []; snapshot.forEach((child) => { rows.push(child.val()); }); cloudScores = rows.reverse(); renderBoards(); }, (error) => { console.warn('[leaderboard] cloud read failed, using local scores:', error.message); cloudScores = null; renderBoards(); }); } catch (error) { console.warn('[leaderboard] firebase init failed:', error.message); scoresRef = null; } }
function escapeHtml(value) { return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
function showScreen(name) { Object.entries(screens).forEach(([key, screen]) => screen.classList.toggle('hidden', key !== name)); }
function randomPosition() { const padding = 9; return { x: padding + Math.random() * (100 - padding * 2), y: padding + Math.random() * (100 - padding * 2) }; }
function lerp(a, b, t) { return a + (b - a) * t; }
function level() { return Math.min((GAME_LENGTH - timeLeft) / GAME_LENGTH, 1); }
function orbSize() { return finalStretchActive ? FINAL_STRETCH_SIZE : lerp(BALL_SIZE_MAX, BALL_SIZE_MIN, level()); }
function orbLifetime() { return finalStretchActive ? FINAL_STRETCH_LIFETIME : lerp(ORB_LIFETIME_EASY, ORB_LIFETIME_HARD, level()); }
function maxOrbs() { return finalStretchActive ? FINAL_STRETCH_MAX_ORBS : Math.round(lerp(MAX_ORBS_EASY, MAX_ORBS_HARD, level())); }
function decoyChance() { return lerp(DECOY_CHANCE_EASY, DECOY_CHANCE_HARD, level()); }
function boostActive() { return multiplierActive || finalStretchActive; }
function currentMultiplier() { return Math.max(finalStretchActive ? FINAL_STRETCH_MULTIPLIER : 1, multiplierActive ? POWER_MULTIPLIER : 1); }
function resetStreak() { streak = 0; elements.streak.textContent = streak; }
function updateBoostUI() { elements.boost.textContent = `×${currentMultiplier()}`; elements.boost.classList.toggle('active', boostActive()); }
function startFinalStretch() {
  finalStretchActive = true;
  updateBoostUI();
  elements.field.classList.add('final-stretch');
  elements.banner.hidden = false;
  elements.banner.classList.remove('show');
  void elements.banner.offsetWidth;
  elements.banner.classList.add('show');
  window.clearTimeout(bannerTimeout);
  bannerTimeout = window.setTimeout(() => { elements.banner.classList.remove('show'); elements.banner.hidden = true; }, 1900);
}
function clearFinalStretch() {
  finalStretchActive = false;
  window.clearTimeout(bannerTimeout);
  elements.field.classList.remove('final-stretch');
  elements.banner.classList.remove('show');
  elements.banner.hidden = true;
}
function activateMultiplier() { multiplierActive = true; window.clearTimeout(multiplierTimeout); multiplierTimeout = window.setTimeout(() => { multiplierActive = false; updateBoostUI(); }, POWER_DURATION); updateBoostUI(); }

function ensureAudio() {
  if (audioCtx) return audioCtx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  audioCtx = new Ctx();
  return audioCtx;
}
function playHitSound(accented) {
  const ctx = ensureAudio();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(accented ? 720 : 560, now);
  osc.frequency.exponentialRampToValueAtTime(accented ? 1080 : 880, now + 0.08);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.22, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.16);
}
function triggerShake() {
  elements.field.classList.remove('shake');
  void elements.field.offsetWidth;
  elements.field.classList.add('shake');
}
elements.field.addEventListener('animationend', (event) => { if (event.animationName === 'screen-shake') elements.field.classList.remove('shake'); });

function burstParticles(xPercent, yPercent) {
  const rect = elements.field.getBoundingClientRect();
  const x = (xPercent / 100) * rect.width;
  const y = (yPercent / 100) * rect.height;
  for (let i = 0; i < 10; i += 1) {
    const particle = document.createElement('span');
    particle.className = 'hit-particle';
    const angle = Math.random() * Math.PI * 2;
    const dist = 26 + Math.random() * 42;
    particle.style.left = `${x}px`;
    particle.style.top = `${y}px`;
    particle.style.background = PARTICLE_COLORS[i % PARTICLE_COLORS.length];
    particle.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    particle.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
    particle.addEventListener('animationend', () => particle.remove());
    elements.field.appendChild(particle);
  }
}

function activePositions() { return [...orbs.values()].map((orb) => orb.position); }

function pickOrbType(now) {
  if (timeLeft <= GAME_LENGTH - BOSS_MIN_ELAPSED && now - lastBossAt > BOSS_COOLDOWN && Math.random() < BOSS_CHANCE) { lastBossAt = now; return 'boss'; }
  if (now - lastPowerAt > POWER_COOLDOWN && Math.random() < POWER_CHANCE) { lastPowerAt = now; return 'power'; }
  if (Math.random() < decoyChance()) return 'decoy';
  return 'real';
}

function spawnOrb() {
  if (!roundActive) return;
  const now = performance.now();
  const type = pickOrbType(now);
  const size = type === 'boss' ? orbSize() * 1.25 : orbSize();
  const lifetime = type === 'power' ? POWER_LIFETIME : type === 'boss' ? BOSS_LIFETIME : orbLifetime();
  const taken = activePositions();
  let position; let attempts = 0;
  do { position = randomPosition(); attempts += 1; } while (attempts < 12 && taken.some((p) => Math.hypot(p.x - position.x, p.y - position.y) < 22));
  const id = orbSeq += 1;
  const el = document.createElement('button');
  el.type = 'button';
  el.className = type === 'power' ? 'target power' : type === 'boss' ? 'target boss' : 'target real';
  el.setAttribute('aria-label', type === 'decoy' ? 'Decoy target' : type === 'power' ? 'Boost orb' : type === 'boss' ? 'Boss orb' : 'Google target');
  el.style.cssText = `left:${position.x}%;top:${position.y}%;width:${size}px;height:${size}px`;
  el.addEventListener('pointerdown', () => resolveOrb(id, true));
  elements.field.appendChild(el);
  const timeoutId = window.setTimeout(() => resolveOrb(id, false), lifetime);
  orbs.set(id, { el, type, position, timeoutId });
}

function dissolveOrb(el) {
  el.style.pointerEvents = 'none';
  el.classList.add('dissolve');
  el.addEventListener('animationend', () => el.remove(), { once: true });
  window.setTimeout(() => el.remove(), 450);
}

function resolveOrb(id, wasHit) {
  const orb = orbs.get(id);
  if (!orb) return;
  window.clearTimeout(orb.timeoutId);
  orbs.delete(id);
  if (!wasHit) {
    if (orb.type === 'real') resetStreak();
    dissolveOrb(orb.el);
    return;
  }
  orb.el.remove();
  burstParticles(orb.position.x, orb.position.y);
  if (orb.type === 'real') {
    streak += 1;
    elements.streak.textContent = streak;
    let gained = 1;
    if (streak % STREAK_BONUS_STEP === 0) gained += STREAK_BONUS_POINTS;
    score += gained * currentMultiplier();
    playHitSound(streak % STREAK_BONUS_STEP === 0);
    if (streak >= 5) triggerShake();
  } else if (orb.type === 'decoy') {
    resetStreak();
    score = Math.max(0, score - 1);
  } else if (orb.type === 'power') {
    activateMultiplier();
    playHitSound(true);
  } else if (orb.type === 'boss') {
    score += BOSS_BONUS * currentMultiplier();
    triggerShake();
    playHitSound(true);
  }
  elements.score.textContent = score;
}

function spawnLoop() {
  if (!roundActive) return;
  const deficit = maxOrbs() - orbs.size;
  if (deficit <= 0) return;
  const spawns = finalStretchActive ? Math.min(deficit, 3) : 1;
  for (let i = 0; i < spawns; i += 1) spawnOrb();
}

function finishRound() {
  roundActive = false;
  window.clearInterval(timer);
  window.clearInterval(spawnInterval);
  window.clearTimeout(multiplierTimeout);
  orbs.forEach((orb) => window.clearTimeout(orb.timeoutId));
  orbs.clear();
  elements.field.querySelectorAll('.target').forEach((target) => target.remove());
  multiplierActive = false;
  clearFinalStretch();
  saveScore();
  elements.finalScore.textContent = score;
  elements.resultPlayer.textContent = player;
  elements.resultNote.textContent = score > 30 ? 'That was seriously quick. Your score is on the board.' : 'Good first run. Can you beat it on the next round?';
  renderBoards();
  showScreen('result');
}

function startRound() {
  player = elements.name.value.trim().slice(0, 18) || 'Anonymous';
  score = 0; streak = 0; timeLeft = GAME_LENGTH;
  multiplierActive = false; lastPowerAt = -Infinity; lastBossAt = -Infinity;
  orbs.clear();
  roundActive = true;
  clearFinalStretch();
  elements.activePlayer.textContent = player;
  elements.score.textContent = '0';
  elements.streak.textContent = '0';
  updateBoostUI();
  elements.time.textContent = GAME_LENGTH;
  elements.progress.style.transform = 'scaleX(1)';
  elements.field.querySelectorAll('.target').forEach((target) => target.remove());
  showScreen('game');
  window.setTimeout(spawnOrb, 0);
  window.setTimeout(spawnOrb, 180);
  spawnInterval = window.setInterval(spawnLoop, SPAWN_CHECK_INTERVAL);
  timer = window.setInterval(() => { timeLeft -= 1; elements.time.textContent = timeLeft; elements.progress.style.transform = `scaleX(${timeLeft / GAME_LENGTH})`; if (timeLeft === FINAL_STRETCH_SECONDS) startFinalStretch(); if (timeLeft <= 0) finishRound(); }, 1000);
}

elements.form.addEventListener('submit', (event) => { event.preventDefault(); startRound(); });
elements.quit.addEventListener('click', finishRound);
elements.again.addEventListener('click', startRound);
elements.home.addEventListener('click', () => { renderBoards(); showScreen('intro'); });
connectFirebase();
renderBoards();
