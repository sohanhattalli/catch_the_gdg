const GAME_LENGTH = 60;
const DECOY_ROUNDS = 3;
const DECOY_LATE_WINDOW = 48;
const DECOY_DURATION = 4500;
const boardKey = 'catch-the-google-scores';
const screens = { intro: document.querySelector('#intro-screen'), game: document.querySelector('#game-screen'), result: document.querySelector('#result-screen') };
const elements = { form: document.querySelector('#start-form'), name: document.querySelector('#player-name'), field: document.querySelector('#playfield'), score: document.querySelector('#score'), combo: document.querySelector('#combo'), time: document.querySelector('#time-left'), progress: document.querySelector('#time-progress'), activePlayer: document.querySelector('#active-player'), finalScore: document.querySelector('#final-score'), resultPlayer: document.querySelector('#result-player'), resultNote: document.querySelector('#result-note'), quit: document.querySelector('#quit-button'), again: document.querySelector('#play-again'), home: document.querySelector('#back-home') };
let player = ''; let score = 0; let combo = 0; let timeLeft = GAME_LENGTH; let timer; let decoyTimeout; let escapeTimer; let roundActive = false; let decoyShown = 0; let decoyActive = false; let cloudScores = null; let scoresCollection = null;
const LEVEL_SCORE_CAP = 30;
const BALL_SIZE_MAX = 86;
const BALL_SIZE_MIN = 34;
const BALL_SPEED_MIN = 150;
const BALL_SPEED_MAX = 460;
const DIRECTION_CHANGE_INTERVAL_MS = 900;
const DIRECTION_CHANGE_JITTER_MS = 500;
const DIRECTION_CHANGE_MAX_TURN = Math.PI / 2;
const ESCAPE_WINDOW_EASY = 1600; const ESCAPE_WINDOW_HARD = 550;
const POP_DURATION = 220;
const PARTICLE_COLORS = ['#4285f4', '#ea4335', '#fbbc05', '#34a853'];
let activeTarget = null; let rafId = null; let lastFrameTime = 0; let posX = 0; let posY = 0; let dirX = 1; let dirY = 0;
let nextTurnAt = 0; let popStart = -Infinity; let audioCtx = null;

function getScores() { try { return JSON.parse(localStorage.getItem(boardKey)) || []; } catch { return []; } }
function saveScore() { const scores = [...getScores(), { name: player, score }].sort((a, b) => b.score - a.score).slice(0, 8); localStorage.setItem(boardKey, JSON.stringify(scores)); if (scoresCollection) { scoresCollection.add({ name: player, score, createdAt: firebase.firestore.FieldValue.serverTimestamp() }).catch(() => {}); } return scores; }
function renderBoards() { const scores = cloudScores || getScores(); document.querySelectorAll('.leaderboard').forEach((board) => { board.innerHTML = scores.map((entry, index) => `<li><span class="rank">0${index + 1}</span><span class="player">${escapeHtml(entry.name)}</span><span class="points">${entry.score}</span></li>`).join(''); }); document.querySelectorAll('.empty-board').forEach((empty) => { empty.hidden = scores.length > 0; }); }
function connectFirebase() { const config = window.FIREBASE_CONFIG; if (!window.firebase || !config || !config.apiKey || config.apiKey.includes('PASTE_') || config.projectId === 'YOUR_PROJECT_ID') return; try { firebase.initializeApp(config); scoresCollection = firebase.firestore().collection('scores'); scoresCollection.orderBy('score', 'desc').limit(8).onSnapshot((snapshot) => { cloudScores = snapshot.docs.map((doc) => doc.data()); renderBoards(); }, () => { cloudScores = null; renderBoards(); }); } catch { scoresCollection = null; } }
function escapeHtml(value) { return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
function showScreen(name) { Object.entries(screens).forEach(([key, screen]) => screen.classList.toggle('hidden', key !== name)); }
function randomPosition() { const padding = 9; return { x: padding + Math.random() * (100 - padding * 2), y: padding + Math.random() * (100 - padding * 2) }; }
function lerp(a, b, t) { return a + (b - a) * t; }
function level() { return Math.min(score / LEVEL_SCORE_CAP, 1); }
function targetSize() { return lerp(BALL_SIZE_MAX, BALL_SIZE_MIN, level()); }
function popScale(now) { return 1 + (1 - Math.min(1, (now - popStart) / POP_DURATION)) * 0.32; }
function targetRadius() { return (targetSize() / 2) * popScale(performance.now()); }
function targetSpeed() { return lerp(BALL_SPEED_MIN, BALL_SPEED_MAX, level()); }
function scheduleNextTurn(now) { nextTurnAt = now + DIRECTION_CHANGE_INTERVAL_MS + Math.random() * DIRECTION_CHANGE_JITTER_MS; }
function escapeWindow() { return lerp(ESCAPE_WINDOW_EASY, ESCAPE_WINDOW_HARD, level()); }
function resetCombo() { combo = 0; elements.combo.textContent = combo; }
function escapeTarget() {
  if (!roundActive || decoyActive) return;
  resetCombo();
  spawnTarget();
}
function randomDirection() { const angle = Math.random() * Math.PI * 2; return { dx: Math.cos(angle), dy: Math.sin(angle) }; }
function burstParticles(x, y) {
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
function registerHit() {
  window.clearTimeout(escapeTimer);
  combo += 1;
  const bonus = Math.floor(combo / 5);
  score += 1 + bonus;
  elements.score.textContent = score;
  elements.combo.textContent = combo;
  popStart = performance.now();
  burstParticles(posX, posY);
  playHitSound(bonus > 0);
  if (combo >= 5) triggerShake();
  spawnTarget();
}
elements.field.addEventListener('pointerdown', (event) => {
  if (!roundActive || decoyActive || !activeTarget) return;
  const rect = elements.field.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const clickY = event.clientY - rect.top;
  if (Math.hypot(clickX - posX, clickY - posY) <= targetRadius()) registerHit();
});
function tick(now) {
  if (!roundActive || decoyActive || !activeTarget) { rafId = null; return; }
  const dt = Math.min(48, now - lastFrameTime) / 1000;
  lastFrameTime = now;
  const size = targetSize();
  const speed = targetSpeed();
  const half = size / 2;
  const fieldW = elements.field.clientWidth;
  const fieldH = elements.field.clientHeight;
  if (now >= nextTurnAt) {
    const turn = (Math.random() * 2 - 1) * DIRECTION_CHANGE_MAX_TURN;
    const angle = Math.atan2(dirY, dirX) + turn;
    dirX = Math.cos(angle); dirY = Math.sin(angle);
    scheduleNextTurn(now);
  }
  posX += dirX * speed * dt;
  posY += dirY * speed * dt;
  if (posX < half) { posX = half; dirX = Math.abs(dirX); }
  else if (posX > fieldW - half) { posX = fieldW - half; dirX = -Math.abs(dirX); }
  if (posY < half) { posY = half; dirY = Math.abs(dirY); }
  else if (posY > fieldH - half) { posY = fieldH - half; dirY = -Math.abs(dirY); }
  activeTarget.style.width = `${size}px`;
  activeTarget.style.height = `${size}px`;
  activeTarget.style.transform = `translate(${posX}px, ${posY}px) translate(-50%, -50%) scale(${popScale(now)})`;
  rafId = requestAnimationFrame(tick);
}
function spawnTarget() {
  window.clearTimeout(escapeTimer);
  if (!roundActive || decoyActive) return;
  if (maybeStartDecoyRound()) return;
  const size = targetSize();
  const fieldW = elements.field.clientWidth;
  const fieldH = elements.field.clientHeight;
  const half = size / 2;
  posX = half + Math.random() * Math.max(1, fieldW - size);
  posY = half + Math.random() * Math.max(1, fieldH - size);
  const direction = randomDirection();
  dirX = direction.dx; dirY = direction.dy;
  scheduleNextTurn(performance.now());
  let target = elements.field.querySelector('.target');
  if (!target) {
    target = document.createElement('button');
    target.type = 'button';
    target.setAttribute('aria-label', 'Google target');
    target.style.left = '0px';
    target.style.top = '0px';
    target.style.transition = 'none';
    target.style.pointerEvents = 'none';
    elements.field.appendChild(target);
  }
  target.className = 'target real';
  target.style.width = `${size}px`;
  target.style.height = `${size}px`;
  target.style.transform = `translate(${posX}px, ${posY}px) translate(-50%, -50%)`;
  activeTarget = target;
  lastFrameTime = performance.now();
  if (!rafId) rafId = requestAnimationFrame(tick);
  escapeTimer = window.setTimeout(escapeTarget, escapeWindow());
}
function maybeStartDecoyRound() {
  if (decoyShown >= DECOY_ROUNDS || timeLeft >= DECOY_LATE_WINDOW) return false;
  const slotSpan = DECOY_LATE_WINDOW / DECOY_ROUNDS;
  const slotDeadline = Math.max(4, DECOY_LATE_WINDOW - decoyShown * slotSpan - 3);
  const roll = Math.random() < .18;
  if (roll || timeLeft <= slotDeadline) { startDecoyRound(); return true; }
  return false;
}
function startDecoyRound() {
  decoyActive = true; decoyShown += 1;
  window.clearTimeout(escapeTimer);
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  activeTarget = null;
  elements.field.querySelectorAll('.target').forEach((node) => node.remove());
  const count = decoyShown >= DECOY_ROUNDS ? 4 : 3;
  const size = targetSize();
  const correctIndex = Math.floor(Math.random() * count);
  const positions = [];
  for (let i = 0; i < count; i += 1) {
    let position; let attempts = 0;
    do { position = randomPosition(); attempts += 1; } while (attempts < 12 && positions.some((p) => Math.hypot(p.x - position.x, p.y - position.y) < 22));
    positions.push(position);
    const target = document.createElement('button');
    target.className = 'target real';
    target.type = 'button';
    target.setAttribute('aria-label', i === correctIndex ? 'Google target' : 'Decoy target');
    target.style.cssText = `left:${position.x}%;top:${position.y}%;width:${size}px;height:${size}px`;
    target.addEventListener('pointerdown', () => resolveDecoyRound(i === correctIndex));
    elements.field.appendChild(target);
  }
  decoyTimeout = window.setTimeout(() => resolveDecoyRound(null), DECOY_DURATION);
}
function resolveDecoyRound(wasCorrect) {
  if (!decoyActive) return;
  decoyActive = false;
  window.clearTimeout(decoyTimeout);
  elements.field.querySelectorAll('.target').forEach((node) => node.remove());
  if (wasCorrect === true) { score += 1; } else { resetCombo(); if (wasCorrect === false) score = Math.max(0, score - 1); }
  elements.score.textContent = score;
  if (roundActive) spawnTarget();
}
function finishRound() { roundActive = false; decoyActive = false; if (rafId) { cancelAnimationFrame(rafId); rafId = null; } activeTarget = null; window.clearInterval(timer); window.clearTimeout(decoyTimeout); window.clearTimeout(escapeTimer); elements.field.querySelectorAll('.target').forEach((target) => target.remove()); saveScore(); elements.finalScore.textContent = score; elements.resultPlayer.textContent = player; elements.resultNote.textContent = score > 30 ? 'That was seriously quick. Your score is on the board.' : 'Good first run. Can you beat it on the next round?'; renderBoards(); showScreen('result'); }
function startRound() { player = elements.name.value.trim().slice(0, 18) || 'Anonymous'; score = 0; combo = 0; timeLeft = GAME_LENGTH; decoyShown = 0; decoyActive = false; roundActive = true; elements.activePlayer.textContent = player; elements.score.textContent = '0'; elements.combo.textContent = '0'; elements.time.textContent = GAME_LENGTH; elements.progress.style.transform = 'scaleX(1)'; showScreen('game'); window.setTimeout(spawnTarget, 0); timer = window.setInterval(() => { timeLeft -= 1; elements.time.textContent = timeLeft; elements.progress.style.transform = `scaleX(${timeLeft / GAME_LENGTH})`; if (timeLeft <= 0) finishRound(); }, 1000); }
elements.form.addEventListener('submit', (event) => { event.preventDefault(); startRound(); }); elements.quit.addEventListener('click', finishRound); elements.again.addEventListener('click', startRound); elements.home.addEventListener('click', () => { renderBoards(); showScreen('intro'); }); connectFirebase(); renderBoards();
