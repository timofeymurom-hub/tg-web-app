// GYM MINI APP — app.js
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

const API = 'https://your-server.com/api'; // замени на URL своего сервера
let DB = { workouts: [], profile: {}, body: [] };
let currentTab = 'dashboard';
let workout = { exercise: '', date: '', sets: [], rpe: 'Легко', weight: 80, reps: 8 };

// ── Helpers ──
const $ = id => document.getElementById(id);
const epley = (w, r) => r === 1 ? w : Math.round(w * (1 + r / 30) * 10) / 10;
const parseDate = s => { if (!s) return null; const [d,m,y] = s.split('.'); return new Date(+y,+m-1,+d); };
const fmtDate = d => `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;

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
  else if (name === 'diary') renderDiary(7);
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
  } catch(e) {
    const saved = localStorage.getItem('gym_db');
    if (saved) DB = JSON.parse(saved);
  }
  initUI();
}

async function saveData() {
  localStorage.setItem('gym_db', JSON.stringify(DB));
  const uid = tg?.initDataUnsafe?.user?.id;
  if (!uid) return;
  try {
    await fetch(`${API}/save`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({uid, data: DB}) });
  } catch(e) {}
}

// ── Init ──
function initUI() {
  const user = tg?.initDataUnsafe?.user;
  $('greeting').textContent = `💪 Привет, ${user?.first_name || 'Атлет'}!`;
  $('today-date').textContent = new Date().toLocaleDateString('ru-RU', {weekday:'long', day:'numeric', month:'long'});
  $('avatar-letter').textContent = (user?.first_name || 'A')[0].toUpperCase();
  renderDashboard();
  renderExerciseChips();
  renderQuickWeights();
  setupSVGGradient();
}

function setupSVGGradient() {
  const svg = document.querySelector('.ring');
  const defs = document.createElementNS('http://www.w3.org/2000/svg','defs');
  defs.innerHTML = `<linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#7c5cff"/><stop offset="100%" stop-color="#00e5c8"/></linearGradient>`;
  svg.prepend(defs);
}

// ── Dashboard ──
function renderDashboard() {
  const ws = DB.workouts || [];
  const days = [...new Set(ws.map(w => w.date))];
  const tonnage = ws.reduce((s,w) => s + (w.weight||0)*(w.reps||0), 0);
  const allE1rm = ws.filter(w => w.weight > 0).map(w => epley(w.weight, w.reps));
  const max1rm = allE1rm.length ? Math.max(...allE1rm) : 0;

  $('stat-sessions').textContent = days.length;
  $('stat-tonnage').textContent = tonnage > 1000 ? (tonnage/1000).toFixed(1)+'т' : Math.round(tonnage);
  $('stat-1rm').textContent = max1rm ? max1rm+'кг' : '—';

  // Streak
  const weekSet = new Set(ws.map(w => { const d = parseDate(w.date); return d ? `${d.getFullYear()}-${d.getMonth()}-${Math.floor(d.getDate()/7)}` : null; }).filter(Boolean));
  $('stat-streak').textContent = weekSet.size;
  $('streak-num').textContent = weekSet.size;

  renderRecovery();
  renderLastWorkout();
  renderPRList();
}

function renderRecovery() {
  const ws = DB.workouts || [];
  const cutoff = new Date(Date.now() - 7*24*3600*1000);
  const recent = ws.filter(w => { const d = parseDate(w.date); return d && d >= cutoff; });
  const heavy = recent.filter(w => w.rpe === 'Тяжело').length;
  const total = recent.length;
  const pct = total === 0 ? 100 : Math.max(20, Math.round(100 - heavy/total*50));
  $('recovery-pct').textContent = pct;
  const offset = 314 - (314 * pct / 100);
  $('recovery-circle').style.strokeDashoffset = offset;
  $('recovery-status').textContent = pct >= 80 ? '✅ Готов к тяжёлой тренировке' : pct >= 50 ? '🟡 Умеренная нагрузка' : '⚠️ Нужен отдых';
  const pills = $('recovery-pills');
  pills.innerHTML = '';
  const exs = [...new Set(recent.map(w => w.exercise))];
  exs.slice(0,4).forEach(ex => {
    const h = recent.filter(w => w.exercise === ex && w.rpe === 'Тяжело').length;
    const cls = h === 0 ? 'green' : h <= 1 ? 'yellow' : 'red';
    pills.innerHTML += `<span class="pill ${cls}">${ex}</span>`;
  });
}

function renderLastWorkout() {
  const ws = DB.workouts || [];
  if (!ws.length) return;
  const lastDate = ws[ws.length-1].date;
  const last = ws.filter(w => w.date === lastDate);
  const exs = [...new Set(last.map(w => w.exercise))];
  const card = $('last-workout-card');
  card.innerHTML = `<div style="font-size:.75rem;color:var(--text2);margin-bottom:8px">📅 ${lastDate}</div>`;
  exs.forEach(ex => {
    const sets = last.filter(w => w.exercise === ex);
    const tonnage = sets.reduce((s,w) => s+(w.weight||0)*(w.reps||0),0);
    card.innerHTML += `<div class="workout-row"><span class="workout-ex">${ex}</span><span class="workout-detail">${sets.length} подх · ${Math.round(tonnage)} кг</span></div>`;
  });
}

function renderPRList() {
  const ws = DB.workouts || [];
  const records = {};
  ws.filter(w => w.weight > 0).forEach(w => {
    const e = epley(w.weight, w.reps);
    if (!records[w.exercise] || e > records[w.exercise].e1rm) records[w.exercise] = {e1rm: e, weight: w.weight, reps: w.reps};
  });
  const medals = ['🥇','🥈','🥉'];
  const list = $('pr-list');
  list.innerHTML = '';
  Object.entries(records).slice(0,5).forEach(([ex, r], i) => {
    list.innerHTML += `<div class="pr-item"><span class="pr-medal">${medals[i]||'🏅'}</span><div class="pr-info"><div class="pr-ex">${ex}</div><div class="pr-val">${r.weight}кг × ${r.reps} повт</div></div><span class="pr-num">${r.e1rm} кг</span></div>`;
  });
  if (!list.innerHTML) list.innerHTML = '<p class="empty-state">Нет рекордов</p>';
}

// ── Workout Tab ──
function renderExerciseChips() {
  const ws = DB.workouts || [];
  const defaults = ['Жим лёжа','Становая тяга','Присед'];
  const custom = [...new Set(ws.map(w => w.exercise))].filter(e => !defaults.includes(e)).slice(0,5);
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
  if (type === 'today') { workout.date = fmtDate(new Date()); $('custom-date-input').style.display='none'; }
  else if (type === 'yesterday') { const d = new Date(); d.setDate(d.getDate()-1); workout.date = fmtDate(d); $('custom-date-input').style.display='none'; }
  else { $('custom-date-input').style.display='block'; }
}

function setCustomDate() {
  const v = $('custom-date-input').value;
  if (!v) return;
  const [y,m,d] = v.split('-');
  workout.date = `${d}.${m}.${y}`;
}

function renderQuickWeights() {
  const ws = DB.workouts || [];
  const hist = [...new Set(ws.map(w => w.weight).filter(w => w > 0))].sort((a,b) => a-b).slice(-6);
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
  const set = { exercise: workout.exercise, date: workout.date, weight: workout.weight, reps: workout.reps, rpe: workout.rpe, set_num: workout.sets.length+1 };
  workout.sets.push(set);
  renderSetsLog();
  $('save-btn').style.display = 'block';
  showToast(`✅ Подход ${workout.sets.length} добавлен`);
}

function renderSetsLog() {
  const log = $('sets-log');
  if (!workout.sets.length) { log.innerHTML = '<p class="empty-state">Ещё нет подходов</p>'; return; }
  log.innerHTML = workout.sets.map((s,i) => {
    const e = s.weight > 0 ? `1ПМ≈${epley(s.weight,s.reps)}кг` : 'без веса';
    const wt = s.weight > 0 ? `${s.weight}кг × ${s.reps}` : `(без веса) × ${s.reps}`;
    return `<div class="set-item"><span class="set-num">${i+1}-й подход</span><span class="set-data">${wt}</span><span class="set-1rm">${e}</span><button class="set-del" onclick="delSet(${i})">🗑</button></div>`;
  }).join('');
}

function delSet(i) {
  workout.sets.splice(i,1);
  workout.sets.forEach((s,j) => s.set_num = j+1);
  renderSetsLog();
  if (!workout.sets.length) $('save-btn').style.display = 'none';
}

async function saveWorkout() {
  if (!workout.sets.length) { showToast('Нет подходов!'); return; }
  if (!DB.workouts) DB.workouts = [];
  workout.sets.forEach(s => { s.id = Date.now() + Math.random(); DB.workouts.push(s); });
  await saveData();
  showToast('✅ Тренировка сохранена!');
  workout.sets = [];
  renderSetsLog();
  $('save-btn').style.display = 'none';
  renderExerciseChips();
  renderQuickWeights();
}

// ── Diary ──
function filterDiary(days, el) {
  document.querySelectorAll('.diary-filter .chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderDiary(days);
}

function renderDiary(days) {
  const ws = DB.workouts || [];
  const cutoff = days > 0 ? new Date(Date.now() - days*24*3600*1000) : new Date(0);
  const filtered = ws.filter(w => { const d = parseDate(w.date); return d && d >= cutoff; });
  const byDate = {};
  filtered.forEach(w => { if (!byDate[w.date]) byDate[w.date] = {}; if (!byDate[w.date][w.exercise]) byDate[w.date][w.exercise] = []; byDate[w.date][w.exercise].push(w); });
  const list = $('diary-list');
  const dates = Object.keys(byDate).sort((a,b) => parseDate(b)-parseDate(a));
  if (!dates.length) { list.innerHTML = '<p class="empty-state">Нет тренировок за период</p>'; return; }
  list.innerHTML = dates.map(date => {
    const exs = byDate[date];
    const dayTonnage = Object.values(exs).flat().reduce((s,w) => s+(w.weight||0)*(w.reps||0),0);
    const exHtml = Object.entries(exs).map(([ex, sets]) => {
      const badges = sets.map(s => `<span class="diary-set-badge">${s.weight>0?s.weight+'кг':'BW'}×${s.reps}</span>`).join('');
      return `<div class="diary-exercise"><div class="diary-ex-name">${ex}</div><div class="diary-sets-row">${badges}</div></div>`;
    }).join('');
    return `<div class="diary-day"><div class="diary-day-header">📅 ${date}<span class="diary-tonnage">${Math.round(dayTonnage)} кг</span></div>${exHtml}</div>`;
  }).join('');
}

// ── Analytics ──
function renderAnalytics() {
  renderVolumeChart();
  renderVolumeBreakdown();
  renderPlateauList();
}

function selectAnalyticsEx(ex, el) {
  document.querySelectorAll('#analytics-chips .ex-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  $('chart-ex-label').textContent = ex;
  render1RMChart(ex);
}

function render1RMChart(ex) {
  const ws = (DB.workouts||[]).filter(w => w.exercise===ex && w.weight>0);
  const byDate = {};
  ws.forEach(w => { const e = epley(w.weight,w.reps); if (!byDate[w.date]||e>byDate[w.date]) byDate[w.date]=e; });
  const dates = Object.keys(byDate).sort((a,b) => parseDate(a)-parseDate(b));
  if (dates.length < 2) { $('chart-empty').style.display='block'; return; }
  $('chart-empty').style.display='none';
  const ctx = $('chart-1rm').getContext('2d');
  if (window._chart1rm) window._chart1rm.destroy();
  window._chart1rm = new Chart(ctx, {
    type: 'line',
    data: { labels: dates.map(d => d.slice(0,5)), datasets: [{ data: dates.map(d => byDate[d]), borderColor:'#7c5cff', backgroundColor:'rgba(124,92,255,0.1)', tension:0.4, fill:true, pointBackgroundColor:'#7c5cff', pointRadius:4 }] },
    options: { plugins:{legend:{display:false}}, scales:{ x:{ticks:{color:'#9090b0',font:{size:10}},grid:{color:'rgba(255,255,255,0.05)'}}, y:{ticks:{color:'#9090b0',font:{size:10}},grid:{color:'rgba(255,255,255,0.05)'}} } }
  });
}

function renderVolumeChart() {
  const ws = DB.workouts || [];
  const byWeek = {};
  ws.forEach(w => { const d = parseDate(w.date); if (!d) return; const wk = `${d.getFullYear()}-W${Math.ceil(d.getDate()/7)+d.getMonth()*4}`; byWeek[wk] = (byWeek[wk]||0) + (w.weight||0)*(w.reps||0); });
  const weeks = Object.keys(byWeek).sort().slice(-8);
  if (!weeks.length) return;
  const ctx = $('chart-volume').getContext('2d');
  if (window._chartVol) window._chartVol.destroy();
  window._chartVol = new Chart(ctx, {
    type:'bar',
    data:{ labels: weeks.map((_,i)=>`Нед ${i+1}`), datasets:[{ data: weeks.map(w=>byWeek[w]), backgroundColor:'rgba(0,229,200,0.7)', borderRadius:6 }] },
    options:{ plugins:{legend:{display:false}}, scales:{ x:{ticks:{color:'#9090b0',font:{size:10}},grid:{display:false}}, y:{ticks:{color:'#9090b0',font:{size:10}},grid:{color:'rgba(255,255,255,0.05)'}} } }
  });
}

function renderVolumeBreakdown() {
  const ws = DB.workouts || [];
  const vol = {};
  ws.forEach(w => { vol[w.exercise] = (vol[w.exercise]||0) + (w.weight||0)*(w.reps||0); });
  const sorted = Object.entries(vol).sort((a,b)=>b[1]-a[1]);
  const max = sorted[0]?.[1]||1;
  const div = $('volume-breakdown');
  div.innerHTML = sorted.slice(0,6).map(([ex,v]) => `<div class="breakdown-item"><span class="breakdown-label">${ex}</span><div class="breakdown-bar-wrap"><div class="breakdown-bar" style="width:${v/max*100}%"></div></div><span class="breakdown-val">${Math.round(v/1000)}т</span></div>`).join('');
}

function renderPlateauList() {
  const ws = DB.workouts || [];
  const exs = [...new Set(ws.map(w => w.exercise))];
  const div = $('plateau-list');
  div.innerHTML = '';
  exs.forEach(ex => {
    const recs = ws.filter(w => w.exercise===ex && w.weight>0).sort((a,b)=>parseDate(a.date)-parseDate(b.date));
    if (recs.length < 4) return;
    const e1rms = recs.map(w => epley(w.weight,w.reps));
    const half = Math.floor(e1rms.length/2);
    const old = Math.max(...e1rms.slice(0,half));
    const cur = Math.max(...e1rms.slice(half));
    const isPlat = cur <= old*1.02;
    div.innerHTML += `<div class="plateau-item ${isPlat?'warning':'ok'}"><div class="plateau-ex">${isPlat?'⚠️':'✅'} ${ex}</div><div class="plateau-detail">${isPlat?'Плато! Нет прогресса более 21 дня':'Прогресс есть — продолжай!'} (1ПМ: ${cur}кг)</div></div>`;
  });
  if (!div.innerHTML) div.innerHTML = '<p class="empty-state">Недостаточно данных</p>';
}

// ── Profile ──
function renderProfile() {
  const ws = DB.workouts || [];
  const profile = DB.profile || {};
  const body = (DB.body||[]).slice(-1)[0] || {};
  $('profile-name').textContent = tg?.initDataUnsafe?.user?.first_name || profile.name || '—';
  const goals = {hypertrophy:'💪 Гипертрофия', strength:'🏋️ Сила', weight_loss:'🔥 Похудение', endurance:'🏃 Выносливость'};
  $('profile-goal').textContent = goals[profile.goal] || '—';
  $('p-weight').textContent = body.weight ? body.weight+'кг' : '—';
  $('p-height').textContent = profile.height ? profile.height+'см' : '—';
  $('p-fat').textContent = body.fat ? body.fat+'%' : '—';
  const tdee = profile.tdee ? Math.round(profile.tdee) : '—';
  $('p-tdee').textContent = tdee;
  const days = [...new Set(ws.map(w=>w.date))].length;
  const tonnage = ws.reduce((s,w)=>s+(w.weight||0)*(w.reps||0),0);
  const sets = ws.length;
  $('history-summary').innerHTML = `<div class="hist-row"><span>🗓 Тренировочных дней</span><span class="hist-val">${days}</span></div><div class="hist-row"><span>🔢 Всего подходов</span><span class="hist-val">${sets}</span></div><div class="hist-row"><span>🏗 Общий тоннаж</span><span class="hist-val">${(tonnage/1000).toFixed(1)} т</span></div>`;
  const bw = body.weight || 75;
  const records = {};
  ws.filter(w=>w.weight>0).forEach(w=>{ const e=epley(w.weight,w.reps); if(!records[w.exercise]||e>records[w.exercise]) records[w.exercise]=e; });
  const stds = [['Жим лёжа',[0.75,1.25,1.5]],['Присед',[1.0,1.5,2.0]],['Становая тяга',[1.25,1.75,2.5]]];
  const stdDiv = $('strength-standards');
  stdDiv.innerHTML = stds.map(([ex,[n,m,a]])=>{
    const pr = records[ex]||0;
    const rat = pr/bw;
    const lvl = rat>=a?['Элита','elite']:rat>=m?['Продвинутый','good']:rat>=n?['Средний','ok']:['Новичок','base'];
    return `<div class="standard-item"><span class="std-label">${ex}</span><span class="std-val">${pr?pr+'кг':'—'}</span><span class="std-badge ${lvl[1]}">${lvl[0]}</span></div>`;
  }).join('');
}

function toggleTheme() {
  const d = document.documentElement;
  const isLight = d.getAttribute('data-theme')==='light';
  d.setAttribute('data-theme', isLight?'dark':'light');
  $('theme-btn').textContent = isLight?'🌙 Тёмная':'☀️ Светлая';
}

function clearSession() {
  if (!confirm('Очистить сессию записи?')) return;
  workout.sets = [];
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
