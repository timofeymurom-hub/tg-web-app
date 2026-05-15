// GYM MINI APP — app.js
const tg = window.Telegram?.WebApp;
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
  const uid = tg?.initDataUnsafe?.user?.id;
  if (!uid) {
    // Demo mode — load from localStorage
    const saved = localStorage.getItem('gym_db');
    if (saved) DB = JSON.parse(saved);
    initUI(); return;
  }
  try {
    const r = await fetch(`${API}/data?uid=${uid}`);
    DB = await r.json();
  } catch (e) {
    const saved = localStorage.getItem('gym_db');
    if (saved) DB = JSON.parse(saved);
  }
  initUI();
}

let deletedIds = [];

async function saveData() {
  localStorage.setItem('gym_db', JSON.stringify(DB));
  const uid = tg?.initDataUnsafe?.user?.id;
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
  const user = tg?.initDataUnsafe?.user;
  $('greeting').textContent = `💪 Привет, ${user?.first_name || 'Атлет'}!`;
  $('today-date').textContent = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  $('avatar-letter').textContent = (user?.first_name || 'A')[0].toUpperCase();
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
  $('weight-display').textContent = +v === 0 ? '0' : v;
  updateE1RM();
}

function adjustWeight(delta) {
  const nw = Math.max(0, Math.round((workout.weight + delta) * 10) / 10);
  workout.weight = nw;
  $('weight-display').textContent = nw;
  $('weight-slider').value = nw;
  updateE1RM();
}

function setWeight(v) {
  workout.weight = v;
  $('weight-display').textContent = v;
  $('weight-slider').value = v;
  updateE1RM();
}

function toggleNoWeight() {
  const cb = $('no-weight-cb');
  if (cb.checked) { workout.weight = 0; $('weight-display').textContent = '0'; $('weight-slider').disabled = true; }
  else { workout.weight = 80; $('weight-display').textContent = '80'; $('weight-slider').disabled = false; }
  updateE1RM();
}

function adjustReps(delta) {
  workout.reps = Math.max(1, Math.min(50, workout.reps + delta));
  $('reps-display').textContent = workout.reps;
  updateE1RM();
}

function setReps(v) {
  workout.reps = v;
  $('reps-display').textContent = v;
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

function addSet() {
  if (!workout.exercise) { showToast('❌ Выбери упражнение!'); return; }
  if (!workout.date) workout.date = fmtDate(new Date());
  // rpe saved both as rpe (web app) and diff (bot field) for cross-compatibility
  const set = { exercise: workout.exercise, date: workout.date, weight: workout.weight, reps: workout.reps, rpe: workout.rpe, diff: workout.rpe, set_num: workout.sets.length + 1 };
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
  workout = { exercise: '', date: '', sets: [], rpe: 'Легко', weight: 80, reps: 8 };
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
    if (!byDate[d][ex]) byDate[d][ex] = { sets: [], rpe: 'Легко' };
    byDate[d][ex].sets.push(w);
    // Track hardest RPE for exercise
    const rpeRank = { 'Тяжело': 3, 'Средне': 2, 'Средно': 2, 'Легко': 1 };
    const r = w.rpe || w.diff || 'Легко';
    if ((rpeRank[r] || 0) >= (rpeRank[byDate[d][ex].rpe] || 0)) byDate[d][ex].rpe = r;
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
    const dayColor = dayRpeMax === 'Тяжело' ? '#ff6b6b' : dayRpeMax === 'Средне' ? '#ffd93d' : '#00e5c8';
    // Get day of week from date
    const pd = parseDate(date);
    const dayNames = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
    const dayName = pd ? dayNames[pd.getDay()] : '';
    const exHtml = Object.entries(exs).map(([ex, exData]) => {
      const { sets, rpe } = exData;
      const exTonnage = sets.reduce((s, w) => s + (w.weight || 0) * (w.reps || 0), 0);
      const maxE1rm = sets.filter(w => w.weight > 0).reduce((m, w) => Math.max(m, epley(w.weight, w.reps)), 0);
      const isRecord = maxE1rm > 0 && allRecords[ex] && Math.abs(maxE1rm - allRecords[ex]) < 0.1;
      const rpeEmoji = rpe === 'Тяжело' ? '🔴' : rpe === 'Средне' ? '🟡' : '🟢';
      const tonnageStr = exTonnage > 0 ? ` · ${Math.round(exTonnage)} кг` : '';
      const e1rmStr = maxE1rm > 0 ? ` · 1ПМ≈${maxE1rm}кг${isRecord ? ' 🏆' : ''}` : '';
      const badges = sets.map(s => {
        const wt = s.weight > 0 ? `${s.weight}кг×${s.reps}` : `BW×${s.reps}`;
        return `<span class="diary-set-badge" onclick="deleteHistorySet('${s.id}', event)" title="Удалить подход">${wt} ✖</span>`;
      }).join('');
      return `<div class="diary-exercise">
        <div class="diary-ex-name">${rpeEmoji} ${ex}<span class="diary-ex-meta">${tonnageStr}${e1rmStr}</span></div>
        <div class="diary-sets-row">${badges}</div>
      </div>`;
    }).join('');
    return `<div class="diary-day">
      <div class="diary-day-header" style="border-left: 3px solid ${dayColor}; padding-left: 8px">
        <span>📅 ${dayName} ${date}</span>
        <span class="diary-tonnage">${numSets} подх · ${Math.round(dayTonnage)} кг</span>
      </div>
      ${exHtml}
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
  const max = sorted[0]?.[1] || 1;
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
  $('profile-name').textContent = tg?.initDataUnsafe?.user?.first_name || profile.name || '—';
  const goals = { hypertrophy: '💪 Гипертрофия', strength: '🏋️ Сила', weight_loss: '🔥 Похудение', endurance: '🏃 Выносливость' };
  $('profile-goal').textContent = goals[profile.goal] || '—';
  // Вес тела: API бота сохраняет как bodyweight, веб как weight — проверяем оба
  const bodyWeight = body.bodyweight || body.weight;
  $('p-weight').textContent = bodyWeight ? bodyWeight + 'кг' : '—';
  $('p-height').textContent = profile.height ? profile.height + 'см' : '—';
  $('p-fat').textContent = body.fat ? body.fat + '%' : '—';
  const tdee = profile.tdee ? Math.round(profile.tdee) : '—';
  $('p-tdee').textContent = tdee;
  // Вес тела для нормативов
  const bw = parseFloat(bodyWeight) || 75;
  const days = [...new Set(ws.map(w => w.date))].length;
  const tonnage = ws.reduce((s, w) => s + (w.weight || 0) * (w.reps || 0), 0);
  const sets = ws.length;
  $('history-summary').innerHTML = `<div class="hist-row"><span>🗓 Тренировочных дней</span><span class="hist-val">${days}</span></div><div class="hist-row"><span>🔢 Всего подходов</span><span class="hist-val">${sets}</span></div><div class="hist-row"><span>🏗 Общий тоннаж</span><span class="hist-val">${(tonnage / 1000).toFixed(1)} т</span></div>`;
  const bw = body.weight || 75;
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
  $('weight-slider').disabled = false;
  setWeight(80);
  setReps(8);
  document.querySelectorAll('.rpe-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.rpe-btn.green')?.classList.add('active');
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
  document.head.appendChild(s);
}

// ── Start ──
document.addEventListener('DOMContentLoaded', () => {
  loadChartJS(() => { loadData(); });
  selectDate('today', document.querySelector('.date-chips .chip'));
  updateE1RM();
});
