// GYM MINI APP — app.js
const tg = window.Telegram && window.Telegram.WebApp;
if (tg) { tg.ready(); tg.expand(); }

const API = 'https://kABACh0k.pythonanywhere.com/api'; // замени на URL своего сервера
let DB = { workouts: [], profile: {}, body: [] };
let currentTab = 'dashboard';
let diaryDays = 7; // Сохраняем текущий фильтр дневника
let workout = { exercise: '', date: '', sets: [], rpe: 'Легко', weight: 80, reps: 8 };

// ── Helpers ──
const $ = id => document.getElementById(id);
const epley = (w, r) => r === 1 ? w : Math.round(w * (1 + r / 30) * 10) / 10;
const parseDate = s => { if (!s) return null; const [d, m, y] = s.split('.'); return new Date(+y, +m - 1, +d); };
const fmtDate = d => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

function showToast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  $('tab-' + name).classList.add('active');
  document.querySelector(`[data-tab="${name}"]`).classList.add('active');
  currentTab = name;
  if (name === 'dashboard') renderDashboard();
  else if (name === 'diary') renderDiary(diaryDays);
  else if (name === 'analytics') renderAnalytics();
  else if (name === 'profile') renderProfile();
}

// ── Load Data ──
async function loadData() {
  const uid = tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id;
  if (!uid) {
    // Demo mode — load from localStorage
    const saved = localStorage.getItem('gym_db');
    if (saved) DB = JSON.parse(saved);
    initUI(); return;
  }
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);

  try {
    const r = await fetch(`${API}/data?uid=${uid}`, { signal: controller.signal });
    clearTimeout(timeoutId);
    DB = await r.json();
  } catch (e) {
    clearTimeout(timeoutId);
    console.warn("API request failed or timed out. Falling back to localStorage.", e);
    const saved = localStorage.getItem('gym_db');
    if (saved) DB = JSON.parse(saved);
  }
  initUI();
}

let deletedIds = [];

async function saveData() {
  localStorage.setItem('gym_db', JSON.stringify(DB));
  const uid = tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id;
  if (!uid) return;
  try {
    await fetch(`${API}/save`, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ uid, data: DB, deleted_ids: deletedIds }) 
    });
    deletedIds = []; // Очищаем после успешного сохранения
  } catch (e) { }
}

// ── Init ──
function initUI() {
  const user = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
  $('greeting').textContent = `💪 Привет, ${user && user.first_name ? user.first_name : 'Атлет'}!`;
  $('today-date').textContent = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  $('avatar-letter').textContent = (user && user.first_name ? user.first_name : 'A')[0].toUpperCase();
  renderDashboard();
  renderExerciseChips();
  renderQuickWeights();
  setupSVGGradient();
}

function setupSVGGradient() {
  const svg = document.querySelector('.ring');
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `<linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#7c5cff"/><stop offset="100%" stop-color="#00e5c8"/></linearGradient>`;
  svg.prepend(defs);
}

// ── Dashboard ──
function renderDashboard() {
  const ws = DB.workouts || [];
  const days = [...new Set(ws.map(w => w.date))];
  const tonnage = ws.reduce((s, w) => s + (w.weight || 0) * (w.reps || 0), 0);
  const allE1rm = ws.filter(w => w.weight > 0).map(w => epley(w.weight, w.reps));
  const max1rm = allE1rm.length ? Math.max(...allE1rm) : 0;

  $('stat-sessions').textContent = days.length;
  $('stat-tonnage').textContent = tonnage > 1000 ? (tonnage / 1000).toFixed(1) + 'т' : Math.round(tonnage);
  $('stat-1rm').textContent = max1rm ? max1rm + 'кг' : '—';

  // Streak
  const weekSet = new Set(ws.map(w => { const d = parseDate(w.date); return d ? `${d.getFullYear()}-${d.getMonth()}-${Math.floor(d.getDate() / 7)}` : null; }).filter(Boolean));
  $('stat-streak').textContent = weekSet.size;
  $('streak-num').textContent = weekSet.size;

  renderRecovery();
  renderLastWorkout();
  renderPRList();
  renderHealthTracker();
}

function renderRecovery() {
  const ws = DB.workouts || [];
  const now = new Date();
  const cutoff7 = new Date(now - 7 * 24 * 3600 * 1000);
  const w7d = ws.filter(w => { const d = parseDate(w.date); return d && d >= cutoff7; });

  // CNS/EIMD multipliers (from bot)
  const CNS_MULT  = { 'Жим лёжа': 1.0, 'Становая тяга': 1.4, 'Присед': 1.2 };
  const EIMD_MULT = { 'Жим лёжа': 1.0, 'Становая тяга': 1.35, 'Присед': 1.15 };
  const RPE_INT   = { 'Легко': 0.60, 'Средне': 0.80, 'Тяжело': 0.93 };

  const exercises = [...new Set(ws.map(w => w.exercise))].filter(Boolean);

  let totalCns = 0, totalMuscle = 0, count = 0;
  const pills = $('recovery-pills');
  pills.innerHTML = '';

  exercises.slice(0, 6).forEach(ex => {
    const exRecs = w7d.filter(w => w.exercise === ex);
    if (!exRecs.length) return;

    // find last session date
    const lastRec = exRecs.reduce((a, b) => (parseDate(a.date) > parseDate(b.date) ? a : b));
    const lastDate = parseDate(lastRec.date);
    if (!lastDate) return;

    const hoursPassed = (now - lastDate) / 3600000;

    // CNS base by hours
    let cnsBase = hoursPassed < 8 ? 0.10 : hoursPassed < 16 ? 0.30 :
                  hoursPassed < 24 ? 0.50 : hoursPassed < 36 ? 0.65 :
                  hoursPassed < 48 ? 0.78 : hoursPassed < 60 ? 0.88 :
                  hoursPassed < 72 ? 0.95 : 1.00;
    let muscleBase = hoursPassed < 12 ? 0.15 : hoursPassed < 24 ? 0.45 :
                     hoursPassed < 36 ? 0.65 : hoursPassed < 48 ? 0.80 :
                     hoursPassed < 60 ? 0.90 : hoursPassed < 72 ? 0.96 : 1.00;

    const rpeInt = RPE_INT[lastRec.rpe] || RPE_INT[lastRec.diff] || 0.80;
    const cnsM = CNS_MULT[ex] || 1.0;
    const eimdM = EIMD_MULT[ex] || 1.0;
    const penalty = (rpeInt - 0.60) * 0.50;
    const cnsExtra = (cnsM - 1.0) * 0.18;
    const eimdExtra = (eimdM - 1.0) * 0.12;

    const cnsScore = Math.max(0.05, Math.min(1.0, cnsBase - penalty - cnsExtra));
    const muscleScore = Math.max(0.05, Math.min(1.0, muscleBase - penalty - eimdExtra));
    const overallScore = Math.min(cnsScore, muscleScore);

    totalCns += cnsScore;
    totalMuscle += muscleScore;
    count++;

    const pct = Math.round(overallScore * 100);
    const cls = pct >= 70 ? 'green' : pct >= 40 ? 'yellow' : 'red';
    pills.innerHTML += `<span class="pill ${cls}" title="${ex}: ЦНС ${Math.round(cnsScore*100)}% Мыш ${Math.round(muscleScore*100)}%">${ex.split(' ')[0]} ${pct}%</span>`;
  });

  // Overall recovery
  const avgCns = count ? totalCns / count : 1.0;
  const avgMuscle = count ? totalMuscle / count : 1.0;
  const overall = Math.round(Math.min(avgCns, avgMuscle) * 100);

  $('recovery-pct').textContent = overall;
  const offset = 314 - (314 * overall / 100);
  $('recovery-circle').style.strokeDashoffset = offset;

  let cnsLabel = Math.round(avgCns * 100);
  let musLabel = Math.round(avgMuscle * 100);
  $('recovery-status').textContent = overall >= 90 ? `✅ Готов к рекордам! (ЦНС ${cnsLabel}% | Мышцы ${musLabel}%)` :
    overall >= 70 ? `🟡 Суперкомпенсация идёт (ЦНС ${cnsLabel}% | Мышцы ${musLabel}%)` :
    overall >= 45 ? `⚠️ Неполное восстановление (ЦНС ${cnsLabel}% | Мышцы ${musLabel}%)` :
    `🔴 Нужен отдых (ЦНС ${cnsLabel}% | Мышцы ${musLabel}%)`;
}

function renderLastWorkout() {
  const ws = DB.workouts || [];
  if (!ws.length) return;
  const sortedDates = [...new Set(ws.map(w => w.date))].sort((a, b) => parseDate(b) - parseDate(a));
  const lastDate = sortedDates[0];
  const last = ws.filter(w => w.date === lastDate);
  const exs = [...new Set(last.map(w => w.exercise))];
  const card = $('last-workout-card');
  card.innerHTML = `<div style="font-size:.75rem;color:var(--text2);margin-bottom:8px">📅 ${lastDate}</div>`;
  exs.forEach(ex => {
    const sets = last.filter(w => w.exercise === ex);
    const tonnage = sets.reduce((s, w) => s + (w.weight || 0) * (w.reps || 0), 0);
    card.innerHTML += `<div class="workout-row"><span class="workout-ex">${ex}</span><span class="workout-detail">${sets.length} подх · ${Math.round(tonnage)} кг</span></div>`;
  });
}

function renderPRList() {
  const ws = DB.workouts || [];
  const records = {};
  ws.filter(w => w.weight > 0).forEach(w => {
    const e = epley(w.weight, w.reps);
    if (!records[w.exercise] || e > records[w.exercise].e1rm) records[w.exercise] = { e1rm: e, weight: w.weight, reps: w.reps };
  });
  const medals = ['🥇', '🥈', '🥉'];
  const list = $('pr-list');
  list.innerHTML = '';
  Object.entries(records).slice(0, 5).forEach(([ex, r], i) => {
    list.innerHTML += `<div class="pr-item"><span class="pr-medal">${medals[i] || '🏅'}</span><div class="pr-info"><div class="pr-ex">${ex}</div><div class="pr-val">${r.weight}кг × ${r.reps} повт</div></div><span class="pr-num">${r.e1rm} кг</span></div>`;
  });
  if (!list.innerHTML) list.innerHTML = '<p class="empty-state">Нет рекордов</p>';
}

// ── Workout Tab ──
function renderExerciseChips() {
  const ws = DB.workouts || [];
  const defaults = ['Жим лёжа', 'Становая тяга', 'Присед'];
  const custom = [...new Set(ws.map(w => w.exercise))].filter(e => !defaults.includes(e)).slice(0, 5);
  const all = [...defaults, ...custom];
  const chips = $('exercise-chips');
  const achips = $('analytics-chips');
  chips.innerHTML = '';
  achips && (achips.innerHTML = '');
  all.forEach(ex => {
    chips.innerHTML += `<button class="ex-chip" onclick="selectExercise('${ex}', this)">${ex}</button>`;
    achips && (achips.innerHTML += `<button class="ex-chip" onclick="selectAnalyticsEx('${ex}', this)">${ex}</button>`);
  });
}

function selectExercise(name, el) {
  document.querySelectorAll('#exercise-chips .ex-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  workout.exercise = name;
  $('selected-ex-name').textContent = name;
  $('selected-exercise-display').style.display = 'flex';
  $('custom-exercise-input').value = '';
  updateE1RM();
}

function selectCustomExercise() {
  const v = $('custom-exercise-input').value.trim();
  if (!v) return;
  workout.exercise = v;
  $('selected-ex-name').textContent = v;
  $('selected-exercise-display').style.display = 'flex';
  document.querySelectorAll('#exercise-chips .ex-chip').forEach(c => c.classList.remove('active'));
}

function clearExercise() {
  workout.exercise = '';
  $('selected-exercise-display').style.display = 'none';
}

function selectDate(type, el) {
  document.querySelectorAll('.date-chips .chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  if (type === 'today') { workout.date = fmtDate(new Date()); $('custom-date-input').style.display = 'none'; }
  else if (type === 'yesterday') { const d = new Date(); d.setDate(d.getDate() - 1); workout.date = fmtDate(d); $('custom-date-input').style.display = 'none'; }
  else { $('custom-date-input').style.display = 'block'; }
}

function setCustomDate() {
  const v = $('custom-date-input').value;
  if (!v) return;
  const [y, m, d] = v.split('-');
  workout.date = `${d}.${m}.${y}`;
}

function renderQuickWeights() {
  const ws = DB.workouts || [];
  const hist = [...new Set(ws.map(w => w.weight).filter(w => w > 0))].sort((a, b) => a - b).slice(-6);
  if (!hist.length) return;
  const qw = $('quick-weights');
  qw.innerHTML = '';
  hist.forEach(w => { qw.innerHTML += `<button class="chip" onclick="setWeight(${w})">${w}</button>`; });
}

function updateWeight(v) {
  workout.weight = +v;
  $('weight-input').value = +v === 0 ? '0' : v;
  updateE1RM();
}

function adjustWeight(delta) {
  const nw = Math.max(0, Math.round((workout.weight + delta) * 10) / 10);
  workout.weight = nw;
  $('weight-input').value = nw;
  $('weight-slider').value = nw;
  updateE1RM();
}

function setWeight(v) {
  workout.weight = v;
  $('weight-input').value = v;
  $('weight-slider').value = v;
  updateE1RM();
}

function updateWeightFromInput(v) {
  const num = parseFloat(v);
  workout.weight = isNaN(num) ? 0 : num;
  $('weight-slider').value = workout.weight;
  updateE1RM();
}

function toggleNoWeight() {
  const cb = $('no-weight-cb');
  if (cb.checked) { 
    workout.weight = 0; 
    $('weight-input').value = '0'; 
    $('weight-input').disabled = true; 
    $('weight-slider').disabled = true; 
  } else { 
    workout.weight = 80; 
    $('weight-input').value = '80'; 
    $('weight-input').disabled = false; 
    $('weight-slider').disabled = false; 
  }
  updateE1RM();
}

function adjustReps(delta) {
  workout.reps = Math.max(1, Math.min(50, workout.reps + delta));
  $('reps-input').value = workout.reps;
  updateE1RM();
}

function setReps(v) {
  workout.reps = v;
  $('reps-input').value = v;
  updateE1RM();
}

function updateRepsFromInput(v) {
  const num = parseInt(v);
  workout.reps = isNaN(num) ? 1 : num;
  updateE1RM();
}

function selectRPE(v, el) {
  document.querySelectorAll('.rpe-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  workout.rpe = v;
}

function updateE1RM() {
  const e = workout.weight > 0 && workout.reps > 0 ? epley(workout.weight, workout.reps) : null;
  $('e1rm-val').textContent = e ? e + ' кг' : '—';
}

function getDateFromUI() {
  // Считываем дату напрямую из UI, чтобы избежать рассинхрона между DOM и JS-переменной
  const chips = document.querySelectorAll('.date-chips .chip');
  let activeIdx = 0;
  chips.forEach((c, i) => { if (c.classList.contains('active')) activeIdx = i; });
  if (activeIdx === 0) {
    // "Сегодня"
    return fmtDate(new Date());
  } else if (activeIdx === 1) {
    // "Вчера"
    const d = new Date(); d.setDate(d.getDate() - 1); return fmtDate(d);
  } else {
    // "Другая" — берём из input
    const v = $('custom-date-input').value;
    if (v) {
      const [y, m, d] = v.split('-');
      return `${d}.${m}.${y}`;
    }
    return fmtDate(new Date()); // фоллбэк
  }
}

function addSet() {
  if (!workout.exercise) { showToast('❌ Выбери упражнение!'); return; }
  // Считываем дату напрямую из UI-чипов (не из JS-переменной!)
  workout.date = getDateFromUI();
  // Считываем текущий RPE прямо из активной кнопки в DOM
  const activeRpeBtn = document.querySelector('.rpe-btn.active');
  let currentRpe = workout.rpe;
  if (activeRpeBtn) {
    if (activeRpeBtn.classList.contains('green')) currentRpe = 'Легко';
    else if (activeRpeBtn.classList.contains('yellow')) currentRpe = 'Средне';
    else if (activeRpeBtn.classList.contains('red')) currentRpe = 'Тяжело';
  }
  workout.rpe = currentRpe;
  // rpe saved both as rpe (web app) and diff (bot field) for cross-compatibility
  const set = { exercise: workout.exercise, date: workout.date, weight: workout.weight, reps: workout.reps, rpe: currentRpe, diff: currentRpe, set_num: workout.sets.length + 1 };
  workout.sets.push(set);
  renderSetsLog();
  $('save-btn').style.display = 'block';
  showToast(`✅ Подход ${workout.sets.length} добавлен`);
}

function renderSetsLog() {
  const log = $('sets-log');
  if (!workout.sets.length) { log.innerHTML = '<p class="empty-state">Ещё нет подходов</p>'; return; }
  log.innerHTML = workout.sets.map((s, i) => {
    const e = s.weight > 0 ? `1ПМ≈${epley(s.weight, s.reps)}кг` : 'без веса';
    const wt = s.weight > 0 ? `${s.weight}кг × ${s.reps}` : `(без веса) × ${s.reps}`;
    return `<div class="set-item"><span class="set-num">${i + 1}-й подход</span><span class="set-data">${wt}</span><span class="set-1rm">${e}</span><button class="set-del" onclick="delSet(${i})">🗑</button></div>`;
  }).join('');
}

function delSet(i) {
  workout.sets.splice(i, 1);
  workout.sets.forEach((s, j) => s.set_num = j + 1);
  renderSetsLog();
  if (!workout.sets.length) $('save-btn').style.display = 'none';
}

async function saveWorkout() {
  if (!workout.sets.length) { showToast('Нет подходов!'); return; }
  if (!DB.workouts) DB.workouts = [];
  // Assign unique IDs BEFORE pushing to avoid duplicate float IDs
  const ts = Date.now();
  workout.sets.forEach((s, i) => { s.id = String(ts + i); DB.workouts.push(s); });
  await saveData();
  showToast('✅ Тренировка сохранена!');
  // Сброс состояния: упражнение и подходы сбрасываются, дата ОСТАЁТСЯ как есть
  // (чтобы можно было записать несколько упражнений на одну дату)
  const keepDate = getDateFromUI();
  workout = { exercise: '', date: keepDate, sets: [], rpe: 'Легко', weight: 80, reps: 8 };
  // Сбрасываем кнопки сложности в UI на "Легко"
  document.querySelectorAll('.rpe-btn').forEach(b => b.classList.remove('active'));
  const greenBtn = document.querySelector('.rpe-btn.green');
  if (greenBtn) greenBtn.classList.add('active');
  // Дата НЕ сбрасывается — чипы и input остаются как есть
  renderSetsLog();
  $('save-btn').style.display = 'none';
  $('selected-exercise-display').style.display = 'none';
  document.querySelectorAll('#exercise-chips .ex-chip').forEach(c => c.classList.remove('active'));
  renderExerciseChips();
  renderQuickWeights();
  renderDashboard();
}

// ── Diary ──
function filterDiary(days, el) {
  diaryDays = days; // Запоминаем выбранный фильтр
  document.querySelectorAll('.diary-filter .chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderDiary(days);
}

function renderDiary(days) {
  const ws = DB.workouts || [];
  const cutoff = days > 0 ? new Date(Date.now() - days * 24 * 3600 * 1000) : new Date(0);
  const filtered = ws.filter(w => { const d = parseDate(w.date); return d && d >= cutoff; });
  // Group by date → exercise
  const byDate = {};
  filtered.forEach(w => {
    const d = w.date;
    if (!byDate[d]) byDate[d] = {};
    const ex = w.exercise || 'Неизвестно';
    if (!byDate[d][ex]) byDate[d][ex] = { sets: [], rpe: null };
    byDate[d][ex].sets.push(w);
    // Track hardest RPE for exercise — strict > to avoid last-set overwrite bug
    const rpeRank = { 'Тяжело': 3, 'Средне': 2, 'Средно': 2, 'Легко': 1 };
    const r = w.rpe || w.diff || 'Легко';
    if (byDate[d][ex].rpe === null || (rpeRank[r] || 0) > (rpeRank[byDate[d][ex].rpe] || 0)) byDate[d][ex].rpe = r;
  });
  // Compute all-time 1RM records
  const allRecords = {};
  ws.filter(w => w.weight > 0).forEach(w => {
    const e = epley(w.weight, w.reps);
    if (!allRecords[w.exercise] || e > allRecords[w.exercise]) allRecords[w.exercise] = e;
  });
  const list = $('diary-list');
  const dates = Object.keys(byDate).sort((a, b) => parseDate(b) - parseDate(a));
  if (!dates.length) { list.innerHTML = '<p class="empty-state">Нет тренировок за период</p>'; return; }
  list.innerHTML = dates.map(date => {
    const exs = byDate[date];
    const dayTonnage = Object.values(exs).flatMap(e => e.sets).reduce((s, w) => s + (w.weight || 0) * (w.reps || 0), 0);
    const numSets = Object.values(exs).reduce((s, e) => s + e.sets.length, 0);
    const dayRpeMax = Object.values(exs).reduce((max, e) => {
      const rk = { 'Тяжело': 3, 'Средне': 2, 'Средно': 2, 'Легко': 1 };
      return (rk[e.rpe] || 0) > (rk[max] || 0) ? e.rpe : max;
    }, 'Легко');
    const dayColor = dayRpeMax === 'Тяжело' ? '#ff4d6d' : dayRpeMax === 'Средне' ? '#ffd700' : '#00e5c8';
    // Get day of week from date
    const pd = parseDate(date);
    const dayNames = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
    const dayName = pd ? dayNames[pd.getDay()] : '';
    const exHtml = Object.entries(exs).map(([ex, exData]) => {
      const { sets, rpe } = exData;
      const exTonnage = sets.reduce((s, w) => s + (w.weight || 0) * (w.reps || 0), 0);
      const maxE1rm = sets.filter(w => w.weight > 0).reduce((m, w) => Math.max(m, epley(w.weight, w.reps)), 0);
      const isRecord = maxE1rm > 0 && allRecords[ex] && Math.abs(maxE1rm - allRecords[ex]) < 0.1;
      
      const rpeClass = rpe === 'Тяжело' ? 'rpe-badge-hard' : rpe === 'Средне' ? 'rpe-badge-medium' : 'rpe-badge-easy';
      const rpeText = rpe === 'Тяжело' ? '🔴 Тяжело' : rpe === 'Средне' ? '🟡 Средне' : '🟢 Легко';

      const recordHtml = isRecord ? `<span class="diary-ex-record-badge">🏆 Рекорд</span>` : '';
      let metaStr = '';
      if (exTonnage > 0) metaStr += `🏋️‍♂️ ${Math.round(exTonnage)} кг`;
      if (maxE1rm > 0) metaStr += (metaStr ? ' · ' : '') + `⚡ 1ПМ≈${maxE1rm}кг`;

      const badges = sets.map((s, idx) => {
        const wt = s.weight > 0 ? `${s.weight}кг×${s.reps}` : `BW×${s.reps}`;
        return `<div class="diary-set-pill">
          <span class="diary-set-pill-num">${idx + 1}</span>
          <span>${wt}</span>
          <span class="diary-set-pill-del" onclick="deleteHistorySet('${s.id}', event)" title="Удалить подход">&times;</span>
        </div>`;
      }).join('');

      return `<div class="diary-exercise">
        <div class="diary-ex-header">
          <div class="diary-ex-title-wrap">
            <span class="diary-ex-title">${ex}</span>
            <div class="diary-ex-meta-info">
              <span>${metaStr}</span>
              ${recordHtml}
            </div>
          </div>
          <span class="diary-ex-rpe-badge ${rpeClass}">${rpeText}</span>
        </div>
        <div class="diary-sets-grid">${badges}</div>
      </div>`;
    }).join('');

    return `<div class="diary-day glass">
      <div class="diary-day-header">
        <div class="diary-day-date-box">
          <span class="diary-day-weekday" style="background-color: ${dayColor}">${dayName}</span>
          <span class="diary-day-date">${date}</span>
        </div>
        <div class="diary-day-stats">
          <span class="diary-day-sets-count">${numSets} подходов</span>
          <span class="diary-day-tonnage-sum">${Math.round(dayTonnage)} кг</span>
        </div>
      </div>
      <div class="diary-exercises-list">
        ${exHtml}
      </div>
    </div>`;
  }).join('');
}

async function deleteHistorySet(id, event) {
  if (event) event.stopPropagation();
  if (!confirm('🗑 Удалить этот подход?')) return;
  deletedIds.push(String(id));
  DB.workouts = DB.workouts.filter(w => String(w.id) !== String(id));
  renderDiary(diaryDays); // Используем сохранённый фильтр
  await saveData();
  showToast('✅ Подход удалён');
}

// ── Analytics ──
function renderAnalytics() {
  renderVolumeChart();
  renderVolumeBreakdown();
  renderPlateauList();
  renderVolumeTrend();
  renderTop3Progress();
}

function selectAnalyticsEx(ex, el) {
  document.querySelectorAll('#analytics-chips .ex-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  $('chart-ex-label').textContent = ex;
  render1RMChart(ex);
}

function render1RMChart(ex) {
  if (!window.Chart) {
    $('chart-empty').textContent = '⚠️ График 1ПМ недоступен (ошибка сети/блокировка CDN)';
    $('chart-empty').style.display = 'block';
    return;
  }
  const ws = (DB.workouts || []).filter(w => w.exercise === ex && w.weight > 0);
  const byDate = {};
  ws.forEach(w => { const e = epley(w.weight, w.reps); if (!byDate[w.date] || e > byDate[w.date]) byDate[w.date] = e; });
  const dates = Object.keys(byDate).sort((a, b) => parseDate(a) - parseDate(b));
  if (dates.length < 2) { $('chart-empty').style.display = 'block'; return; }
  $('chart-empty').style.display = 'none';
  const ctx = $('chart-1rm').getContext('2d');
  if (window._chart1rm) window._chart1rm.destroy();
  window._chart1rm = new Chart(ctx, {
    type: 'line',
    data: { labels: dates.map(d => d.slice(0, 5)), datasets: [{ data: dates.map(d => byDate[d]), borderColor: '#7c5cff', backgroundColor: 'rgba(124,92,255,0.1)', tension: 0.4, fill: true, pointBackgroundColor: '#7c5cff', pointRadius: 4 }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#9090b0', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } }, y: { ticks: { color: '#9090b0', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } } } }
  });
}

function renderVolumeChart() {
  if (!window.Chart) return;
  const ws = DB.workouts || [];
  const byWeek = {};
  ws.forEach(w => { const d = parseDate(w.date); if (!d) return; const wk = `${d.getFullYear()}-W${Math.ceil(d.getDate() / 7) + d.getMonth() * 4}`; byWeek[wk] = (byWeek[wk] || 0) + (w.weight || 0) * (w.reps || 0); });
  const weeks = Object.keys(byWeek).sort().slice(-8);
  if (!weeks.length) return;
  const ctx = $('chart-volume').getContext('2d');
  if (window._chartVol) window._chartVol.destroy();
  window._chartVol = new Chart(ctx, {
    type: 'bar',
    data: { labels: weeks.map((_, i) => `Нед ${i + 1}`), datasets: [{ data: weeks.map(w => byWeek[w]), backgroundColor: 'rgba(0,229,200,0.7)', borderRadius: 6 }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#9090b0', font: { size: 10 } }, grid: { display: false } }, y: { ticks: { color: '#9090b0', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } } } }
  });
}

function renderVolumeBreakdown() {
  const ws = DB.workouts || [];
  const vol = {};
  ws.forEach(w => { vol[w.exercise] = (vol[w.exercise] || 0) + (w.weight || 0) * (w.reps || 0); });
  const sorted = Object.entries(vol).sort((a, b) => b[1] - a[1]);
  const max = (sorted[0] && sorted[0][1]) || 1;
  const div = $('volume-breakdown');
  div.innerHTML = sorted.slice(0, 6).map(([ex, v]) => `<div class="breakdown-item"><span class="breakdown-label">${ex}</span><div class="breakdown-bar-wrap"><div class="breakdown-bar" style="width:${v / max * 100}%"></div></div><span class="breakdown-val">${Math.round(v / 1000)}т</span></div>`).join('');
}

function renderPlateauList() {
  const ws = DB.workouts || [];
  const exs = [...new Set(ws.map(w => w.exercise))];
  const div = $('plateau-list');
  div.innerHTML = '';
  exs.forEach(ex => {
    const recs = ws.filter(w => w.exercise === ex && w.weight > 0).sort((a, b) => parseDate(a.date) - parseDate(b.date));
    if (recs.length < 4) return;
    const e1rms = recs.map(w => epley(w.weight, w.reps));
    const half = Math.floor(e1rms.length / 2);
    const old = Math.max(...e1rms.slice(0, half));
    const cur = Math.max(...e1rms.slice(half));
    const isPlat = cur <= old * 1.02;
    div.innerHTML += `<div class="plateau-item ${isPlat ? 'warning' : 'ok'}"><div class="plateau-ex">${isPlat ? '⚠️' : '✅'} ${ex}</div><div class="plateau-detail">${isPlat ? 'Плато! Нет прогресса более 21 дня' : 'Прогресс есть — продолжай!'} (1ПМ: ${cur}кг)</div></div>`;
  });
  if (!div.innerHTML) div.innerHTML = '<p class="empty-state">Недостаточно данных</p>';
}

function renderVolumeTrend() {
  const ws = DB.workouts || [];
  const now = new Date();
  const w1Start = new Date(now - 7 * 86400000);
  const w2Start = new Date(now - 14 * 86400000);
  let tThis = 0, tPrev = 0, sThis = 0, sPrev = 0;
  ws.forEach(w => {
    const d = parseDate(w.date);
    if (!d) return;
    const t = (w.weight || 0) * (w.reps || 0);
    if (d >= w1Start) { tThis += t; sThis++; }
    else if (d >= w2Start) { tPrev += t; sPrev++; }
  });
  const div = $('volume-trend');
  if (!div) return;
  if (!sThis && !sPrev) { div.innerHTML = '<p class="empty-state">Недостаточно данных</p>'; return; }
  const trendPct = tPrev > 0 ? ((tThis - tPrev) / tPrev * 100).toFixed(1) : null;
  const arrow = trendPct === null ? '—' : trendPct > 0 ? `📈 +${trendPct}%` : `📉 ${trendPct}%`;
  const cls = trendPct === null ? '' : trendPct > 0 ? 'color:#00e5c8' : 'color:#ff6b6b';
  div.innerHTML = `
    <div class="hist-row"><span>📊 Эта неделя</span><span class="hist-val">${Math.round(tThis / 1000 * 10) / 10} т (${sThis} подх)</span></div>
    <div class="hist-row"><span>📅 Прошлая неделя</span><span class="hist-val">${Math.round(tPrev / 1000 * 10) / 10} т (${sPrev} подх)</span></div>
    <div class="hist-row"><span>📈 Тренд</span><span class="hist-val" style="${cls}">${arrow}</span></div>`;
}

function renderTop3Progress() {
  const ws = DB.workouts || [];
  const now = new Date();
  const cutoff30 = new Date(now - 30 * 86400000);
  const recent = ws.filter(w => { const d = parseDate(w.date); return d && d >= cutoff30; });
  const older  = ws.filter(w => { const d = parseDate(w.date); return d && d < cutoff30; });
  const exs = [...new Set(recent.map(w => w.exercise))];
  const progress = [];
  exs.forEach(ex => {
    const curVals = recent.filter(w => w.exercise === ex && w.weight > 0).map(w => epley(w.weight, w.reps));
    if (!curVals.length) return;
    const cur1rm = Math.max(...curVals);
    const oldVals = older.filter(w => w.exercise === ex && w.weight > 0).map(w => epley(w.weight, w.reps));
    if (!oldVals.length) return;
    const old1rm = Math.max(...oldVals);
    if (old1rm > 0) progress.push({ ex, pct: (cur1rm - old1rm) / old1rm * 100, cur1rm });
  });
  progress.sort((a, b) => b.pct - a.pct);
  const div = $('top3-progress');
  if (!div) return;
  const medals = ['🥇','🥈','🥉'];
  if (!progress.length) { div.innerHTML = '<p class="empty-state">Недостаточно данных для сравнения</p>'; return; }
  div.innerHTML = progress.slice(0, 3).map((p, i) => {
    const sign = p.pct >= 0 ? '+' : '';
    const cls = p.pct >= 0 ? 'color:#00e5c8' : 'color:#ff6b6b';
    return `<div class="pr-item"><span class="pr-medal">${medals[i]}</span><div class="pr-info"><div class="pr-ex">${p.ex}</div><div class="pr-val">1ПМ: ${p.cur1rm} кг</div></div><span class="pr-num" style="${cls}">${sign}${p.pct.toFixed(1)}%</span></div>`;
  }).join('');
}

// ── Profile ──
function renderProfile() {
  const ws = DB.workouts || [];
  const profile = DB.profile || {};
  const body = (DB.body || []).slice(-1)[0] || {};
  const userName = tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.first_name;
  $('profile-name').textContent = userName || profile.name || '—';
  const goals = { hypertrophy: '💪 Гипертрофия', strength: '🏋️ Сила', weight_loss: '🔥 Похудение', endurance: '🏃 Выносливость' };
  $('profile-goal').textContent = goals[profile.goal] || '—';
  // Вес тела: API бота сохраняет как bodyweight, веб как weight — проверяем оба
  const bodyWeight = body.bodyweight || body.weight;
  $('p-weight').textContent = bodyWeight ? bodyWeight + 'кг' : '—';
  const heightCm = profile.height_cm || profile.height || 0;
  $('p-height').textContent = heightCm ? heightCm + 'см' : '—';
  let fatPct = '—';
  if (body.measurements && heightCm) {
    const m = body.measurements;
    const waist = parseFloat(m.waist_cm);
    const neck = parseFloat(m.neck_cm);
    const hips = parseFloat(m.hips_cm || 0);
    const h = parseFloat(heightCm);
    const gender = profile.gender || 'male';
    if (waist && neck) {
      if (gender === 'male') {
        const d = waist - neck;
        if (d > 0) fatPct = (495 / (1.0324 - 0.19077 * Math.log10(d) + 0.15456 * Math.log10(h)) - 450).toFixed(1);
      } else {
        const d = waist + hips - neck;
        if (d > 0) fatPct = (495 / (1.29579 - 0.35004 * Math.log10(d) + 0.22100 * Math.log10(h)) - 450).toFixed(1);
      }
    }
  }
  $('p-fat').textContent = fatPct !== '—' ? fatPct + '%' : (body.fat ? body.fat + '%' : '—');
  // Вес тела для нормативов и БЖУ
  const bw = parseFloat(bodyWeight) || 75;
  let tdee = '—';
  if (bodyWeight && heightCm && profile.birth_year) {
    const age = Math.max(1, new Date().getFullYear() - profile.birth_year);
    const g = profile.gender || 'male';
    const bmr = 10 * parseFloat(bodyWeight) + 6.25 * heightCm - 5 * age + (g === 'male' ? 5 : -161);
    const days = parseInt(profile.training_days_per_week || 3);
    const mult = days <= 3 ? 1.375 : (days <= 5 ? 1.55 : 1.725);
    tdee = Math.round(bmr * mult);
  }
  if (tdee !== '—') {
    const goal = profile.goal || 'hypertrophy';
    let target = tdee;
    let protein = Math.round(bw * 1.6);
    if (goal === 'hypertrophy') {
      target = tdee + 300;
      protein = Math.round(bw * 2.0);
    } else if (goal === 'weight_loss') {
      target = tdee - 400;
      protein = Math.round(bw * 1.8);
    }
    const fats = Math.round((target * 0.25) / 9);
    const carbs = Math.round((target - protein * 4 - fats * 9) / 4);
    $('p-tdee').innerHTML = `<span style="font-size:1.15rem;font-weight:800;">${target} ккал</span><small style="font-size:0.62rem;display:block;color:var(--text2);margin-top:2px;font-weight:600;letter-spacing:0.02em;">${protein}г Б · ${fats}г Ж · ${carbs}г У</small>`;
  } else {
    $('p-tdee').textContent = '—';
  }
  const days = [...new Set(ws.map(w => w.date))].length;
  const tonnage = ws.reduce((s, w) => s + (w.weight || 0) * (w.reps || 0), 0);
  const sets = ws.length;
  $('history-summary').innerHTML = `<div class="hist-row"><span>🗓 Тренировочных дней</span><span class="hist-val">${days}</span></div><div class="hist-row"><span>🔢 Всего подходов</span><span class="hist-val">${sets}</span></div><div class="hist-row"><span>🏗 Общий тоннаж</span><span class="hist-val">${(tonnage / 1000).toFixed(1)} т</span></div>`;
  const records = {};
  ws.filter(w => w.weight > 0).forEach(w => { const e = epley(w.weight, w.reps); if (!records[w.exercise] || e > records[w.exercise]) records[w.exercise] = e; });
  const stds = [['Жим лёжа', [0.75, 1.25, 1.5]], ['Присед', [1.0, 1.5, 2.0]], ['Становая тяга', [1.25, 1.75, 2.5]]];
  const stdDiv = $('strength-standards');
  stdDiv.innerHTML = stds.map(([ex, [n, m, a]]) => {
    const pr = records[ex] || 0;
    const rat = bw > 0 ? pr / bw : 0;
    const lvl = rat >= a ? ['Элита', 'elite'] : rat >= m ? ['Продвинутый', 'good'] : rat >= n ? ['Средний', 'ok'] : ['Новичок', 'base'];
    return `<div class="standard-item"><span class="std-label">${ex}</span><span class="std-val">${pr ? pr + 'кг' : '—'}</span><span class="std-badge ${lvl[1]}">${lvl[0]}</span></div>`;
  }).join('');
}

function toggleTheme() {
  const d = document.documentElement;
  const isLight = d.getAttribute('data-theme') === 'light';
  d.setAttribute('data-theme', isLight ? 'dark' : 'light');
  $('theme-btn').textContent = isLight ? '🌙 Тёмная' : '☀️ Светлая';
}

function clearSession() {
  if (!confirm('Очистить текущую сессию (несохранённые подходы)?')) return;
  workout.sets = [];
  workout.exercise = '';
  $('selected-exercise-display').style.display = 'none';
  document.querySelectorAll('#exercise-chips .ex-chip').forEach(c => c.classList.remove('active'));
  $('save-btn').style.display = 'none';
  $('no-weight-cb').checked = false;
  $('weight-input').disabled = false;
  $('weight-slider').disabled = false;
  setWeight(80);
  setReps(8);
  document.querySelectorAll('.rpe-btn').forEach(b => b.classList.remove('active'));
  const greenBtn = document.querySelector('.rpe-btn.green');
  if (greenBtn) greenBtn.classList.add('active');
  workout.rpe = 'Легко';
  renderSetsLog();
  showToast('🗑 Сессия очищена');
}

// ── Chart.js CDN check ──
function loadChartJS(cb) {
  if (window.Chart) { cb(); return; }
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
  s.onload = cb;
  s.onerror = () => {
    console.warn("Failed to load Chart.js, loading app without charts.");
    cb();
  };
  document.head.appendChild(s);
}

// ── Health Tracker & PubMed Hub functions ──
let selectedMood = '';

function renderHealthTracker() {
  const todayStr = fmtDate(new Date());
  const entries = DB.body || [];
  const todayEntry = entries.find(e => e.date === todayStr);
  const lastEntry = entries.length ? entries[entries.length - 1] : {};

  const weight = (todayEntry && (todayEntry.bodyweight || todayEntry.weight)) || (lastEntry && (lastEntry.bodyweight || lastEntry.weight)) || '—';
  const sleep = (todayEntry && todayEntry.sleep_hours) !== undefined && todayEntry.sleep_hours !== null ? todayEntry.sleep_hours : '—';
  const water = (todayEntry && todayEntry.water_l) !== undefined && todayEntry.water_l !== null ? todayEntry.water_l : '—';
  const cal = (todayEntry && todayEntry.calories) || '—';

  $('track-weight').textContent = weight;
  $('track-sleep').textContent = sleep;
  $('track-water').textContent = water;
  $('track-cal').textContent = cal;
}

function openHealthModal() {
  const todayStr = fmtDate(new Date());
  const entries = DB.body || [];
  const todayEntry = entries.find(e => e.date === todayStr) || {};
  const lastEntry = entries.length ? entries[entries.length - 1] : {};

  $('h-weight').value = todayEntry.bodyweight || todayEntry.weight || lastEntry.bodyweight || lastEntry.weight || '';
  $('h-sleep').value = todayEntry.sleep_hours !== undefined ? todayEntry.sleep_hours : '';
  $('h-water').value = todayEntry.water_l !== undefined ? todayEntry.water_l : '';
  $('h-calories').value = todayEntry.calories || '';
  $('h-protein').value = todayEntry.protein_g || '';
  
  selectedMood = todayEntry.mood || '';
  document.querySelectorAll('.mood-btn').forEach(btn => {
    btn.classList.remove('active');
    if (selectedMood && btn.textContent.includes(selectedMood)) btn.classList.add('active');
  });
  
  $('health-modal').style.display = 'flex';
}

function closeHealthModal() {
  $('health-modal').style.display = 'none';
}

function selectMood(mood, el) {
  document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  selectedMood = mood;
}

async function saveHealthParams() {
  const weight = parseFloat($('h-weight').value) || null;
  const sleep = parseFloat($('h-sleep').value) || null;
  const water = parseFloat($('h-water').value) || null;
  const calories = parseInt($('h-calories').value) || 0;
  const protein = parseInt($('h-protein').value) || 0;

  if (!DB.body) DB.body = [];

  const todayStr = fmtDate(new Date());
  let entry = DB.body.find(e => e.date === todayStr);
  if (!entry) {
    entry = {
      id: String(Date.now()),
      date: todayStr,
      ts: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      bodyweight: weight,
      calories: calories,
      protein_g: protein,
      water_l: water,
      sleep_hours: sleep,
      mood: selectedMood,
      measurements: {}
    };
    DB.body.push(entry);
  } else {
    if (weight !== null) entry.bodyweight = weight;
    if (sleep !== null) entry.sleep_hours = sleep;
    if (water !== null) entry.water_l = water;
    entry.calories = calories;
    entry.protein_g = protein;
    entry.mood = selectedMood;
  }

  await saveData();
  showToast('✅ Показатели здоровья обновлены!');
  closeHealthModal();
  renderDashboard();
  renderProfile();
}

// ── PubMed Articles ──
let currentPubmedCategory = 'all';

const PUBMED_ARTICLES = [
  {
    category: "recovery",
    title: "🍺 Алкоголь и синтез белка",
    summary: "Алкоголь после тренировки подавляет активность mTOR и снижает синтез мышечного белка (MPS) на 24-37%.",
    study: "Parr EB et al. (2014) | PMID: 24533157",
    details: "Употребление алкоголя (1.5 г/кг) после силовой снизило синтез белка на 37% без протеина и на 24% даже при приеме 25 г сывороточного белка. Доказал прямое угнетающее действие этанола на мышечный анаболизм."
  },
  {
    category: "supplements",
    title: "🧪 Бета-аланин: Буфер закисления",
    summary: "Бета-аланин повышает концентрацию карнозина в мышцах, увеличивая выносливость в сетах длительностью от 60 до 240 секунд.",
    study: "Hobson RM et al. (2012) | PMID: 22267562",
    details: "Бета-аланин достоверно повышает выносливость в упражнениях длительностью от 60 до 240 секунд. Эффект на сетах <60 сек минимален. Определил точную временную нишу для эффективности бета-аланина."
  },
  {
    category: "supplements",
    title: "☕️ Кофеин: Сила в чашке",
    summary: "Кофеин в дозе 3-6 мг/кг повышает силу на 3-5%, мощность на 6-8% и снижает RPE. Оптимальное время — за 30-60 минут до тренировки.",
    study: "Grgic J et al. (2018) | PMID: 29946216",
    details: "Кофеин повышает 1ПМ в жиме лежа на 2.1 кг и общий тренировочный объём на 6.5% при дозе 3-6 мг/кг. Количественно оценил эффект кофеина на силовые показатели."
  },
  {
    category: "supplements",
    title: "☕️ Кофеин: Сила в чашке",
    summary: "Кофеин в дозе 3-6 мг/кг повышает силу на 3-5%, мощность на 6-8% и снижает RPE. Оптимальное время — за 30-60 минут до тренировки.",
    study: "Warren GL et al. (2010) | PMID: 20966192",
    details: "Кофеин снижает болевое восприятие на 5.2% и воспринимаемое усилие (RPE) на 5.6%. Объяснил механизм: кофеин работает через снижение RPE, а не через прямое усиление мышц."
  },
  {
    category: "supplements",
    title: "☕️ Кофеин: Сила в чашке",
    summary: "Кофеин в дозе 3-6 мг/кг повышает силу на 3-5%, мощность на 6-8% и снижает RPE. Оптимальное время — за 30-60 минут до тренировки.",
    study: "Guest NS et al. (2021) | PMID: 33388079",
    details: "Генетический полиморфизм CYP1A2 влияет на метаболизм кофеина. 'Медленные' метаболизаторы получают меньше пользы и больше побочных эффектов. Объяснил, почему кофеин работает не на всех одинаково."
  },
  {
    category: "nutrition",
    title: "🍚 Углеводы: Топливо для силы и роста",
    summary: "Гликоген — основное топливо для анаэробной работы. Низкоуглеводные диеты снижают тренировочную производительность на 5-15%.",
    study: "Escobar KA et al. (2016) | PMID: 27042165",
    details: "Низкоуглеводная диета снизила объём тренировки на 12% и субъективное усилие повысилось на 15%. Прямое доказательство влияния углеводов на силовой тренинг."
  },
  {
    category: "nutrition",
    title: "🍚 Углеводы: Топливо для силы и роста",
    summary: "Гликоген — основное топливо для анаэробной работы. Низкоуглеводные диеты снижают тренировочную производительность на 5-15%.",
    study: "Ivy JL et al. (2002) | PMID: 12235033",
    details: "Приём углеводов + белка после тренировки ускорил ресинтез гликогена на 38% по сравнению с только углеводами. Обосновал комбинацию углеводов и белка после тренировки."
  },
  {
    category: "nutrition",
    title: "🍚 Углеводы: Топливо для силы и роста",
    summary: "Гликоген — основное топливо для анаэробной работы. Низкоуглеводные диеты снижают тренировочную производительность на 5-15%.",
    study: "Vargas-Molina S et al. (2020) | PMID: 32958094",
    details: "Кето-группа потеряла больше жира, но набрала достоверно меньше мышц, чем группа с нормальными углеводами. Показал, что кето-диета субоптимальна для гипертрофии."
  },
  {
    category: "training",
    title: "🏃‍♂️ Кардио и силовые: Эффект интерференции",
    summary: "Кардио перед силовой снижает мышечную силу и истощает гликоген. Лучше разделять их или делать кардио после тренировки.",
    study: "Murlasits Z et al. (2018) | PMID: 27318712",
    details: "Выполнение кардио непосредственно перед силовой снизило 1ПМ в жиме и приседе на 12-18% и замедлило рост мышц. Научно доказал негативное влияние кардио на последующую силовую работу (эффект интерференции)."
  },
  {
    category: "supplements",
    title: "💊 Цитруллин малат: Выносливость и памп",
    summary: "8 г цитруллина перед тренировкой повышают количество повторений в отказных подходах на 53% и снижают боль в мышцах на 40%.",
    study: "Pérez-Guisado J, Jakeman PM (2010) | PMID: 20386124",
    details: "Прием 8 г цитруллина малата дал прирост повторений в жиме лежа на 52.92% в последних сетах и снизил мышечную боль (DOMS) на 40% через 24-48 часов. Определил цитруллин как мощную добавку для преодоления утомления в силовом тренинге."
  },
  {
    category: "recovery",
    title: "🧠 Усталость ЦНС и перетрен",
    summary: "Утомление ЦНС снижает рекрутирование мышечных волокон. Три стадии: функциональное перенапряжение → нефункциональное → синдром перетренированности.",
    study: "Meeusen R et al. (2013) | PMID: 23247672",
    details: "Перетрен имеет 3 стадии: FO (функциональное, 2-4 нед восстановления), NFO (нефункциональное, 2-3 мес), OTS (синдром, месяцы-годы). Официальный консенсус по диагностике перетренированности."
  },
  {
    category: "recovery",
    title: "🧠 Усталость ЦНС и перетрен",
    summary: "Утомление ЦНС снижает рекрутирование мышечных волокон. Три стадии: функциональное перенапряжение → нефункциональное → синдром перетренированности.",
    study: "Halson SL & Jeukendrup AE (2004) | PMID: 15027528",
    details: "Соотношение кортизол/тестостерон >30% выше нормы — маркер перетрена. HRV снижается на 15-20% при накоплении усталости. Определил биомаркеры для раннего выявления перетрена."
  },
  {
    category: "recovery",
    title: "🧠 Усталость ЦНС и перетрен",
    summary: "Утомление ЦНС снижает рекрутирование мышечных волокон. Три стадии: функциональное перенапряжение → нефункциональное → синдром перетренированности.",
    study: "Grandou C et al. (2020) | PMID: 31820371",
    details: "Субъективные маркеры самочувствия (wellness questionnaires) предсказывают перетрен на 78% точно — лучше, чем анализы крови. Доказал, что простые анкеты лучше дорогих анализов для мониторинга."
  },
  {
    category: "supplements",
    title: "💊 Креатин: Король добавок",
    summary: "Креатин моногидрат — самая изученная и эффективная спортивная добавка. Повышает силу на 5-10%, мышечную массу на 1-2 кг за 4-12 недель.",
    study: "Lanhers C et al. (2017) | PMID: 27328852",
    details: "Креатин повышает 1ПМ верхней части тела на 5.3% и нижней на 5.2% по сравнению с плацебо. Крупнейший мета-анализ, подтвердивший эргогенный эффект креатина."
  },
  {
    category: "supplements",
    title: "💊 Креатин: Король добавок",
    summary: "Креатин моногидрат — самая изученная и эффективная спортивная добавка. Повышает силу на 5-10%, мышечную массу на 1-2 кг за 4-12 недель.",
    study: "Chilibeck PD et al. (2017) | PMID: 28070459",
    details: "Креатин + тренировки дают дополнительно +1.37 кг сухой массы тела по сравнению с плацебо + тренировки. Количественно оценил эффект креатина на гипертрофию."
  },
  {
    category: "supplements",
    title: "💊 Креатин: Король добавок",
    summary: "Креатин моногидрат — самая изученная и эффективная спортивная добавка. Повышает силу на 5-10%, мышечную массу на 1-2 кг за 4-12 недель.",
    study: "Kreider RB et al. (2017) | PMID: 28615996",
    details: "Креатин моногидрат безопасен при длительном применении (до 5 лет). Нет доказательств вреда для почек у здоровых людей. Официальная позиция ISSN по безопасности креатина."
  },
  {
    category: "nutrition",
    title: "🍕 Диетические перерывы: Исследование MATADOR",
    summary: "Чередование 2 недель дефицита калорий с 2... (MATADOR) теряет на 50% больше жира.",
    study: "Byrne NM et al. (2018) | PMID: 29117865",
    details: "Группа MATADOR (2 недели диеты / 2 недели отдыха на поддержке) потеряла на 50% больше жира и сохранила на 40% больше сухой массы. Доказал преимущество интервальной диеты над непрерывным дефицитом калорий."
  },
  {
    category: "nutrition",
    title: "🔥 Жиросжигание: Наука рекомпозиции",
    summary: "Дефицит калорий — единственный способ потери жира. При высоком белке и силовых тренировках можно сохранить или даже нарастить мышцы на дефиците.",
    study: "Helms ER et al. (2014) | PMID: 24864135",
    details: "Оптимальный темп жиропотери: 0.5-1% массы тела в неделю. Быстрее — потеря мышц увеличивается. Установил безопасный темп сушки для натуральных атлетов."
  },
  {
    category: "nutrition",
    title: "🔥 Жиросжигание: Наука рекомпозиции",
    summary: "Дефицит калорий — единственный способ потери жира. При высоком белке и силовых тренировках можно сохранить или даже нарастить мышцы на дефиците.",
    study: "Barakat C et al. (2020) | PMID: 31247944",
    details: "Body recomposition (одновременный набор мышц + потеря жира) возможна у новичков, людей с лишним весом и при возвращении после перерыва. Обосновал, для кого рекомпозиция реальна."
  },
  {
    category: "nutrition",
    title: "🔥 Жиросжигание: Наука рекомпозиции",
    summary: "Дефицит калорий — единственный способ потери жира. При высоком белке и силовых тренировках можно сохранить или даже нарастить мышцы на дефиците.",
    study: "Longland TM et al. (2016) | PMID: 26817506",
    details: "Группа с высоким белком (2.4 г/кг) на дефиците 40% набрала +1.2 кг мышц и потеряла -4.8 кг жира. Группа с 1.2 г/кг потеряла жир, но не набрала мышц. Доказал возможность рекомпозиции при высоком белке у новичков."
  },
  {
    category: "training",
    title: "🧬 Типы мышечных волокон",
    summary: "Тип I (медленные) и Тип II (быстрые) волокна растут при разных нагрузках. Оптимальная программа включает работу во всех диапазонах повторений.",
    study: "Ogborn D & Schoenfeld BJ (2014) | PMID: N/A",
    details: "Тип II волокна имеют вдвое больший потенциал для гипертрофии, чем Тип I. Они лучше всего растут при 6-12 повт. Обосновал приоритет средних повторений для максимальной массы."
  },
  {
    category: "training",
    title: "🧬 Типы мышечных волокон",
    summary: "Тип I (медленные) и Тип II (быстрые) волокна растут при разных нагрузках. Оптимальная программа включает работу во всех диапазонах повторений.",
    study: "Trappe S et al. (2004) | PMID: 14555683",
    details: "Высокие повторения (15-25) гипертрофировали Тип I волокна на 23%, в то время как тяжёлые (3-5) — только на 6%. Доказал, что для полного развития мышцы нужны разные диапазоны повторений."
  },
  {
    category: "recovery",
    title: "💧 Гидратация и сила",
    summary: "Потеря 2% массы тела от обезвоживания снижает силу на 6-10%, мощность на 3% и выносливость на 10-20%.",
    study: "Cheuvront SN & Kenefick RW (2014) | PMID: 24435467",
    details: "Потеря >2% массы тела от обезвоживания достоверно снижает все аспекты спортивной производительности. Установил порог критического обезвоживания."
  },
  {
    category: "recovery",
    title: "💧 Гидратация и сила",
    summary: "Потеря 2% массы тела от обезвоживания снижает силу на 6-10%, мощность на 3% и выносливость на 10-20%.",
    study: "Kraft JA et al. (2012) | PMID: 22124357",
    details: "Обезвоживание на 2.5% массы тела снизило жим лежа на 6.3% и объём тренировки на 14%. Прямо измерил влияние обезвоживания на силовые показатели."
  },
  {
    category: "recovery",
    title: "💧 Гидратация и сила",
    summary: "Потеря 2% массы тела от обезвоживания снижает силу на 6-10%, мощность на 3% и выносливость на 10-20%.",
    study: "Judelson DA et al. (2007) | PMID: 17887812",
    details: "Обезвоживание снижает анаболические гормоны (тестостерон -15%) и повышает катаболические (кортизол +20%). Показал гормональный механизм вреда обезвоживания."
  },
  {
    category: "training",
    title: "📊 Объём тренировок: Сколько подходов нужно?",
    summary: "Научный консенсус: 10-20 рабочих подходов в неделю на мышечную группу обеспечивают максимальную гипертрофию. Выше 20 — рост замедляется.",
    study: "Schoenfeld BJ et al. (2017) | PMID: 27433992",
    details: "Доза-отклик: >10 подходов/нед дают +9.8% роста мышц, 5-9 подходов — +6.6%, <5 — +5.4%. Окончательно доказал преимущество высокого объёма над низким для гипертрофии."
  },
  {
    category: "training",
    title: "📊 Объём тренировок: Сколько подходов нужно?",
    summary: "Научный консенсус: 10-20 рабочих подходов в неделю на мышечную группу обеспечивают максимальную гипертрофию. Выше 20 — рост замедляется.",
    study: "Baz-Valle E et al. (2022) | PMID: 35237172",
    details: "12-20 подходов в неделю — оптимум; превышение 20 подходов не даёт дополнительных преимуществ и повышает риск перетрена. Определил верхнюю границу полезного объёма (MRV)."
  },
  {
    category: "training",
    title: "📊 Объём тренировок: Сколько подходов нужно?",
    summary: "Научный консенсус: 10-20 рабочих подходов в неделю на мышечную группу обеспечивают максимальную гипертрофию. Выше 20 — рост замедляется.",
    study: "Radaelli R et al. (2015) | PMID: 25546444",
    details: "Группы с высоким объемом (3 и 5 подходов) показали достоверно больший рост мышечной массы, чем группа 1 подхода у тренированных мужчин. Показал долгосрочные эффекты объема у опытных атлетов."
  },
  {
    category: "training",
    title: "📊 Объём тренировок: Сколько подходов нужно?",
    summary: "Научный консенсус: 10-20 рабочих подходов в неделю на мышечную группу обеспечивают максимальную гипертрофию. Выше 20 — рост замедляется.",
    study: "Krieger JW (2010) | PMID: 20300012",
    details: "Множественные подходы (2-3) дают на 46% больший эффект размера для гипертрофии по сравнению с одним подходом. Один из первых мета-анализов, доказавших преимущество многоподходной работы."
  },
  {
    category: "training",
    title: "🧠 Связь Мозг-Мышцы (MMC)",
    summary: "Фокус на целевой мышце повышает её ЭМГ-активацию на 20-30% при нагрузке <60% 1ПМ. При тяжёлых весах эффект исчезает.",
    study: "Schoenfeld BJ et al. (2018) | PMID: 29933730",
    details: "Группа с внутренним фокусом ('сжимай бицепс') показала вдвое больший рост бицепса vs группа с внешним фокусом ('подними вес'). Первое прямое доказательство влияния MMC на гипертрофию."
  },
  {
    category: "training",
    title: "🧠 Связь Мозг-Мышцы (MMC)",
    summary: "Фокус на целевой мышце повышает её ЭМГ-активацию на 20-30% при нагрузке <60% 1ПМ. При тяжёлых весах эффект исчезает.",
    study: "Calatayud J et al. (2016) | PMID: 26209563",
    details: "Внутренний фокус повысил ЭМГ грудных на 20% и трицепса на 25% при жиме лежа с 50% 1ПМ. При 80% — эффект исчез. Определил границу эффективности MMC — до 60% 1ПМ."
  },
  {
    category: "recovery",
    title: "🩹 DOMS и мышечные повреждения",
    summary: "Боль после тренировки (DOMS) — НЕ показатель эффективности. Гипертрофия происходит и без боли. Чрезмерные повреждения замедляют рост.",
    study: "Damas F et al. (2018) | PMID: 29422874",
    details: "Мышечные повреждения — побочный эффект тренировки, а не причина роста. Гипертрофия может происходить без DOMS и EIMD. Разделил механизмы повреждения и роста мышц."
  },
  {
    category: "recovery",
    title: "🩹 DOMS и мышечные повреждения",
    summary: "Боль после тренировки (DOMS) — НЕ показатель эффективности. Гипертрофия происходит и без боли. Чрезмерные повреждения замедляют рост.",
    study: "Schoenfeld BJ & Contreras B (2013) | PMID: N/A",
    details: "Основные триггеры гипертрофии: механическое напряжение > метаболический стресс > мышечные повреждения (в порядке важности). Установил иерархию механизмов гипертрофии."
  },
  {
    category: "recovery",
    title: "🩹 DOMS и мышечные повреждения",
    summary: "Боль после тренировки (DOMS) — НЕ показатель эффективности. Гипертрофия происходит и без боли. Чрезмерные повреждения замедляют рост.",
    study: "Roberts LA et al. (2015) | PMID: 26174323",
    details: "Холодная ванна (10°C, 10 мин) после каждой тренировки СНИЗИЛА гипертрофию на 30% по сравнению с контролем. Опроверг рутинное использование холодных ванн после силовых."
  },
  {
    category: "supplements",
    title: "🐟 Омега-3: Синтез белка и суставы",
    summary: "Полиненасыщенные жирные кислоты Омега-3 усиливают анаболический отклик на аминокислоты и инсулин.",
    study: "Smith GI et al. (2011) | PMID: 21159787",
    details: "Прием 4 г Омега-3 в день достоверно повысил чувствительность мышц к анаболическому сигналу (инсулину и аминокислотам), усилив MPS. Доказал анаболический эффект Омега-3 жирных кислот у здоровых молодых людей."
  },
  {
    category: "training",
    title: "📅 Периодизация и Деload",
    summary: "Периодизированные программы на 22% эффективнее непериодизированных. Деload каждые 4-8 недель предотвращает перетрен и травмы.",
    study: "Williams TD et al. (2017) | PMID: 28497285",
    details: "Периодизированные программы дают +22% больший прирост силы vs непериодизированные. Обосновал периодизацию как стандарт для всех уровней."
  },
  {
    category: "training",
    title: "📅 Периодизация и Деload",
    summary: "Периодизированные программы на 22% эффективнее непериодизированных. Деload каждые 4-8 недель предотвращает перетрен и травмы.",
    study: "Harries SK et al. (2015) | PMID: 26382135",
    details: "DUP (ежедневная волнообразная периодизация) даёт +28% больший прирост силы vs линейная периодизация. DUP стала стандартом для атлетов среднего и продвинутого уровня."
  },
  {
    category: "training",
    title: "📅 Периодизация и Деload",
    summary: "Периодизированные программы на 22% эффективнее непериодизированных. Деload каждые 4-8 недель предотвращает перетрен и травмы.",
    study: "Pritchard HJ et al. (2015) | PMID: 25968229",
    details: "Деload с 40% снижением объёма улучшил 1ПМ на 0.8-2.3% после возвращения к нормальным тренировкам. Подтвердил суперкомпенсацию после разгрузочной недели."
  },
  {
    category: "training",
    title: "📈 Прогрессия нагрузок: Как расти постоянно?",
    summary: "Без систематического увеличения механического напряжения рост мышц прекращается. Прогрессия возможна через вес, повторения, объём и технику.",
    study: "Plotkin D et al. (2022) | PMID: 35291020",
    details: "Прогрессивная перегрузка — необходимое условие долгосрочной гипертрофии. Без неё адаптация прекращается за 6-8 недель. Подтвердил центральную роль прогрессии для всех уровней атлетов."
  },
  {
    category: "training",
    title: "📈 Прогрессия нагрузок: Как расти постоянно?",
    summary: "Без систематического увеличения механического напряжения рост мышц прекращается. Прогрессия возможна через вес, повторения, объём и технику.",
    study: "Williams TD et al. (2017) | PMID: 28497285",
    details: "Периодизированные программы с прогрессией дают +22% больший прирост силы vs непериодизированные. Доказал, что структурированная прогрессия эффективнее хаотичного тренинга."
  },
  {
    category: "nutrition",
    title: "🥩 Белок: Сколько, когда и какой?",
    summary: "1.6-2.2 г белка на кг массы тела в день — научно обоснованный оптимум для максимальной гипертрофии. Тайминг вторичен.",
    study: "Morton RW et al. (2018) | PMID: 28698222",
    details: "Оптимальная доза белка для гипертрофии — 1.62 г/кг/день. Выше 2.2 г/кг дополнительной пользы нет. Крупнейший мета-анализ по белку и гипертрофии, установивший точный оптимум."
  },
  {
    category: "nutrition",
    title: "🥩 Белок: Сколько, когда и какой?",
    summary: "1.6-2.2 г белка на кг массы тела в день — научно обоснованный оптимум для максимальной гипертрофии. Тайминг вторичен.",
    study: "Schoenfeld BJ & Aragon AA (2018) | PMID: 29497353",
    details: "Анаболическое окно длится минимум 4-6 часов, а не 30 минут. Главное — общее потребление белка за день. Окончательно развенчал миф о 30-минутном анаболическом окне."
  },
  {
    category: "nutrition",
    title: "🥩 Белок: Сколько, когда и какой?",
    summary: "1.6-2.2 г белка на кг массы тела в день — научно обоснованный оптимум для максимальной гипертрофии. Тайминг вторичен.",
    study: "Res PT et al. (2012) | PMID: 22330017",
    details: "40 г казеина перед сном увеличили ночной MPS на 22% и улучшили белковый баланс. Обосновал приём белка перед сном как эффективную стратегию."
  },
  {
    category: "nutrition",
    title: "🥩 Белок: Сколько, когда и какой?",
    summary: "1.6-2.2 г белка на кг массы тела в день — научно обоснованный оптимум для максимальной гипертрофии. Тайминг вторичен.",
    study: "Kim IY et al. (2016) | PMID: 26530155",
    details: "Равномерное распределение белка (4 приёма по 40 г) дало на 25% больше MPS за день vs 2 больших приёма. Показал важность распределения белка в течение дня."
  },
  {
    category: "training",
    title: "⚖️ Повторения и интенсивность: 5, 10 или 30?",
    summary: "Мышцы растут в ЛЮБОМ диапазоне повторений (от 5 до 30+), если подходы выполняются близко к отказу. Но для силы нужны тяжёлые веса.",
    study: "Schoenfeld BJ et al. (2017) | PMID: 28085795",
    details: "Нагрузка 8-12 повт. и 25-35 повт. привели к идентичной гипертрофии бицепса и квадрицепса при работе до отказа. Разрушил миф о «единственном правильном диапазоне» для гипертрофии."
  },
  {
    category: "training",
    title: "⚖️ Повторения и интенсивность: 5, 10 или 30?",
    summary: "Мышцы растут в ЛЮБОМ диапазоне повторений (от 5 до 30+), если подходы выполняются близко к отказу. Но для силы нужны тяжёлые веса.",
    study: "Lasevicius T et al. (2018) | PMID: 30319436",
    details: "20% 1ПМ не дало гипертрофии даже до отказа. 40%, 60% и 80% 1ПМ дали одинаковый рост. Минимальный порог ~40% 1ПМ. Определил нижнюю границу эффективной нагрузки для гипертрофии."
  },
  {
    category: "training",
    title: "⚖️ Повторения и интенсивность: 5, 10 или 30?",
    summary: "Мышцы растут в ЛЮБОМ диапазоне повторений (от 5 до 30+), если подходы выполняются близко к отказу. Но для силы нужны тяжёлые веса.",
    study: "Morton RW et al. (2016) | PMID: 26838985",
    details: "Тренировка с 30-50% 1ПМ до отказа дала ту же гипертрофию, что и 75-90% 1ПМ у тренированных мужчин. Подтвердил, что лёгкие веса до отказа — эффективная стратегия."
  },
  {
    category: "training",
    title: "⏱ Интервалы отдыха между подходами",
    summary: "Длинный отдых (2-3 мин) даёт больше гипертрофии и силы, чем короткий (1 мин), за счёт сохранения объёма и качества подходов.",
    study: "Schoenfeld BJ et al. (2016) | PMID: 26605807",
    details: "Отдых 3 мин дал достоверно больший рост мышц (+30%) и силы (+15%) vs отдых 1 мин при равном числе подходов. Ключевое исследование, изменившее рекомендации по отдыху."
  },
  {
    category: "training",
    title: "⏱ Интервалы отдыха между подходами",
    summary: "Длинный отдых (2-3 мин) даёт больше гипертрофии и силы, чем короткий (1 мин), за счёт сохранения объёма и качества подходов.",
    study: "Grgic J et al. (2017) | PMID: 28748451",
    details: "Для максимальной силы: отдых >2 мин. Для гипертрофии: >2 мин оптимально, но 60-90 сек допустимо при снижении веса. Систематизировал все данные по интервалам отдыха."
  },
  {
    category: "training",
    title: "📏 Амплитуда движений: Full ROM vs Partial ROM",
    summary: "Полная амплитуда движений (Full ROM) превосходит частичную амплитуду для мышечной гипертрофии.",
    study: "Pedrosa GF et al. (2020) | PMID: 32030125",
    details: "Работа в нижней части амплитуды (растянутая позиция мышцы) дала значительно большую гипертрофию, чем работа в верхней части. Показал важность растяжения мышцы под нагрузкой для запуска гипертрофии."
  },
  {
    category: "training",
    title: "👴 Силовые и старение (саркопения)",
    summary: "После 30 лет человек теряет 3-8% мышечной массы за декаду. Силовые тренировки — единственный доказанный способ предотвратить саркопению.",
    study: "Peterson MD et al. (2011) | PMID: 20881881",
    details: "Силовые тренировки у пожилых (60+) увеличивают мышечную массу на 1.1 кг в среднем за 20 недель. Доказал, что мышцы растут даже после 60 лет."
  },
  {
    category: "training",
    title: "👴 Силовые и старение (саркопения)",
    summary: "После 30 лет человек теряет 3-8% мышечной массы за декаду. Силовые тренировки — единственный доказанный способ предотвратить саркопению.",
    study: "Cruz-Jentoft AJ et al. (2019) | PMID: 30312372",
    details: "Саркопения (потеря мышц) связана с повышением смертности на 40-50% и увеличением риска падений на 60%. Определил саркопению как клиническое заболевание с чёткими критериями."
  },
  {
    category: "recovery",
    title: "😴 Сон: Главный легальный анаболик",
    summary: "Дефицит сна снижает тестостерон на 10-15%, повышает кортизол и снижает синтез белка. Оптимум для атлетов — 8-9 часов.",
    study: "Leproult R & Van Cauter E (2011) | PMID: 21632481",
    details: "Сон по 5 часов в течение 1 недели снизил тестостерон у здоровых мужчин на 10-15%. Прямо доказал разрушительное влияние недосыпа на анаболические гормоны."
  },
  {
    category: "recovery",
    title: "😴 Сон: Главный легальный анаболик",
    summary: "Дефицит сна снижает тестостерон на 10-15%, повышает кортизол и снижает синтез белка. Оптимум для атлетов — 8-9 часов.",
    study: "Dattilo M et al. (2011) | PMID: 21550729",
    details: "70% суточного ГР (гормона роста) выделяется в фазу глубокого сна (N3). Без полноценного сна — нет полноценного ГР. Обосновал связь качества сна с восстановлением мышц."
  },
  {
    category: "recovery",
    title: "😴 Сон: Главный легальный анаболик",
    summary: "Дефицит сна снижает тестостерон на 10-15%, повышает кортизол и снижает синтез белка. Оптимум для атлетов — 8-9 часов.",
    study: "Knowles OE et al. (2018) | PMID: 29605100",
    details: "Дефицит сна снижает силовые показатели на 5-10%, скорость реакции на 9%, точность на 14%. Количественно оценил влияние недосыпа на спортивную производительность."
  },
  {
    category: "recovery",
    title: "😴 Сон: Главный легальный анаболик",
    summary: "Дефицит сна снижает тестостерон на 10-15%, повышает кортизол и снижает синтез белка. Оптимум для атлетов — 8-9 часов.",
    study: "Mah CD et al. (2011) | PMID: 21731144",
    details: "Увеличение сна до 10 часов у баскетболистов улучшило точность бросков на 9% и спринт на 4%. Показал, что больше сна = лучшие результаты даже у элитных атлетов."
  },
  {
    category: "training",
    title: "⏱ Темп повторений: Быстро или медленно?",
    summary: "Темп выполнения повторений от 0.5 до 8 секунд дает схожую гипертрофию. Сверхмедленный темп неэффективен.",
    study: "Schoenfeld BJ et al. (2015) | PMID: 25601394",
    details: "Гипертрофия одинакова при темпе повторения от 0.5 до 8 секунд. Темп >10 секунд (super-slow) дает худший рост. Показал, что время под нагрузкой (TUT) вторично по отношению к уровню механического напряжения."
  },
  {
    category: "recovery",
    title: "🧬 Тестостерон и тренировки",
    summary: "Острый подъём тестостерона после тренировки НЕ влияет на гипертрофию. Важнее базовый уровень, сон и процент жира.",
    study: "West DWD et al. (2010) | PMID: 19164770",
    details: "Острый подъём тестостерона и ГР после тренировки НЕ коррелировал с ростом мышц. Рост мышц определялся MPS, а не гормонами. Разрушил миф о гормональном отклике как драйвере гипертрофии."
  },
  {
    category: "recovery",
    title: "🧬 Тестостерон и тренировки",
    summary: "Острый подъём тестостерона после тренировки НЕ влияет на гипертрофию. Важнее базовый уровень, сон и процент жира.",
    study: "Morton RW et al. (2016) | PMID: 26895395",
    details: "Ни тестостерон, ни ГР, ни IGF-1 после тренировки не предсказывали рост мышц. Единственный предиктор — MPS. Подтвердил, что острые гормональные изменения не определяют гипертрофию."
  },
  {
    category: "recovery",
    title: "🧬 Тестостерон и тренировки",
    summary: "Острый подъём тестостерона после тренировки НЕ влияет на гипертрофию. Важнее базовый уровень, сон и процент жира.",
    study: "Vingren JL et al. (2010) | PMID: 20020789",
    details: "Базовый уровень тестостерона в нормальном физиологическом диапазоне не коррелирует с потенциалом для гипертрофии. Показал, что нормальный диапазон тестостерона достаточен для роста."
  },
  {
    category: "training",
    title: "🔄 Частота тренировок: Сколько раз в неделю?",
    summary: "При равном недельном объёме частота 2 раза/нед на группу превосходит 1 раз/нед для гипертрофии. 3 раза дают минимальное преимущество над 2.",
    study: "Schoenfeld BJ et al. (2016) | PMID: 27102172",
    details: "Тренировка мышечной группы 2+ раз/нед достоверно превосходит 1 раз/нед для гипертрофии (ES = 0.25 vs 0.13). Научно обосновал преимущество повышенной частоты над классическим бро-сплитом."
  },
  {
    category: "training",
    title: "🔄 Частота тренировок: Сколько раз в неделю?",
    summary: "При равном недельном объёме частота 2 раза/нед на группу превосходит 1 раз/нед для гипертрофии. 3 раза дают минимальное преимущество над 2.",
    study: "Grgic J et al. (2018) | PMID: 29325495",
    details: "Силовые показатели улучшаются одинаково при частоте 1-3 раза/нед при равном объёме. Для гипертрофии 2 раза/нед оптимальнее. Разделил влияние частоты на силу и гипертрофию."
  },
  {
    category: "training",
    title: "🔄 Частота тренировок: Сколько раз в неделю?",
    summary: "При равном недельном объёме частота 2 раза/нед на группу превосходит 1 раз/нед для гипертрофии. 3 раза дают минимальное преимущество над 2.",
    study: "Yue FL et al. (2018) | PMID: 29485930",
    details: "Тренировка каждой мышцы 2 раза в неделю повышает синтез мышечного белка (MPS) на 68% эффективнее, чем 1 раз. Объяснил механизм преимущества высокой частоты через MPS."
  },
  {
    category: "supplements",
    title: "☀️ Витамин D: Сила и тестостерон",
    summary: "Витамин D регулирует кальциевый обмен и силу мышц. Его дефицит напрямую снижает спортивные показатели.",
    study: "Carrillo AE et al. (2013) | PMID: 27379691",
    details: "Устранение дефицита витамина D3 повысило силовые показатели и взрывную мощность мышц у спортсменов. Подтвердил прямую связь между нормальным уровнем витамина D и физической силой."
  },
  {
    category: "training",
    title: "🛡 Разминка и профилактика травм",
    summary: "Динамическая разминка снижает риск травм на 30-50%. Статическая растяжка перед силовой снижает силу на 5-8% и НЕ предотвращает травмы.",
    study: "Lauersen JB et al. (2014) | PMID: 24100287",
    details: "Силовые тренировки снижают риск травм на 68%. Растяжка НЕ снижает риск травм. Доказал, что сила — лучшая профилактика травм."
  },
  {
    category: "training",
    title: "🛡 Разминка и профилактика травм",
    summary: "Динамическая разминка снижает риск травм на 30-50%. Статическая растяжка перед силовой снижает силу на 5-8% и НЕ предотвращает травмы.",
    study: "Simic L et al. (2013) | PMID: 23316808",
    details: "Статическая растяжка >60 сек перед силовой снижает максимальную силу на 5.4% и мощность на 2.0%. Обосновал отказ от статической растяжки перед силовой."
  },
  {
    category: "training",
    title: "🛡 Разминка и профилактика травм",
    summary: "Динамическая разминка снижает риск травм на 30-50%. Статическая растяжка перед силовой снижает силу на 5-8% и НЕ предотвращает травмы.",
    study: "Behm DG et al. (2016) | PMID: 26642915",
    details: "Динамическая разминка повышает температуру мышц на 1-2°C, увеличивает ROM на 5-10% и снижает риск травм на 30-50%. Обосновал протокол динамической разминки."
  },
  {
    category: "supplements",
    title: "🥛 Сывороточный протеин против сои и казеина",
    summary: "Сывороточный белок усваивается быстрее, содержит больше лейцина и сильнее стимулирует синтез белка (MPS) после тренировки.",
    study: "Tang JE et al. (2009) | PMID: 19589961",
    details: "Сывороточный протеин (Whey) стимулирует MPS после силовой тренировки на 18% сильнее соевого и на 93% сильнее казеина. Доказал анаболическое превосходство быстрых белков с высоким содержанием лейцина после тренировки."
  }
];

function openPubmedModal() {
  $('pubmed-modal').style.display = 'flex';
  selectPubmedCategory('all', document.querySelector('#pubmed-cats .chip'));
}

function closePubmedModal() {
  $('pubmed-modal').style.display = 'none';
}

function selectPubmedCategory(cat, el) {
  currentPubmedCategory = cat;
  document.querySelectorAll('#pubmed-cats .chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  filterPubmed();
}

function renderPubmedArticles(filter = '') {
  const query = filter.toLowerCase().trim();
  const list = $('pubmed-topics-list');
  
  const filtered = PUBMED_ARTICLES.filter(a => {
    // Category match
    const categoryMatch = currentPubmedCategory === 'all' || a.category === currentPubmedCategory;
    // Text search match
    const textMatch = !query || 
      a.title.toLowerCase().includes(query) || 
      a.summary.toLowerCase().includes(query) || 
      a.details.toLowerCase().includes(query);
    return categoryMatch && textMatch;
  });

  if (!filtered.length) {
    list.innerHTML = '<p class="empty-state">Исследований не найдено</p>';
    return;
  }

  list.innerHTML = filtered.map(a => `
    <div class="pubmed-topic-card">
      <div class="pubmed-topic-title">${a.title}</div>
      <div class="pubmed-topic-summary">${a.summary}</div>
      <div class="pubmed-topic-study">🔍 Исследование: ${a.study}</div>
      <div class="pubmed-topic-details">${a.details}</div>
    </div>
  `).join('');
}

function filterPubmed() {
  const q = $('pubmed-search').value;
  renderPubmedArticles(q);
}

// ── Start ──
document.addEventListener('DOMContentLoaded', () => {
  loadChartJS(() => { loadData(); });
  selectDate('today', document.querySelector('.date-chips .chip'));
  updateE1RM();
});
