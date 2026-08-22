// ============================================================
//  dashboard.js — Main Dashboard Logic
// ============================================================

import { auth, db, signOutUser, onAuth } from './app.js';
import {
  doc, getDoc, updateDoc, collection,
  query, orderBy, getDocs, setDoc,
  serverTimestamp, runTransaction, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { initCalendar, refreshCalendar } from './calendar.js';
import { initTrendChart, updateTrendChart } from './charts.js';

// ── State ────────────────────────────────────────────────────
let currentUser = null;
let userData    = null;   // Firestore user document data
let pendingLog  = null;   // Log awaiting confirmation

const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

// ── Auth Guard ───────────────────────────────────────────────
onAuth(async (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  currentUser = user;
  await initDashboard();
});

// ── Offline Detection ────────────────────────────────────────
window.addEventListener('offline', () =>
  document.getElementById('offline-banner').classList.add('show'));
window.addEventListener('online',  () =>
  document.getElementById('offline-banner').classList.remove('show'));
if (!navigator.onLine)
  document.getElementById('offline-banner').classList.add('show');

// ── Init ─────────────────────────────────────────────────────
async function initDashboard() {
  try {
    await loadUserData();
    renderNavbar();
    renderOverallStats();
    renderSubjectCards();
    detectTodaySubjects();
    setupForm();
    setupQuickActions();
    setupLeaveCalculator();
    setupThemeToggle();
    setupLogout();
    await initCalendar(currentUser.uid, db, onDayClick);
    await initTrendChart(currentUser.uid, db, userData.subjects);
    document.getElementById('loading-overlay').classList.add('hidden');
    document.getElementById('main-content').classList.remove('hidden');
  } catch (err) {
    console.error('Dashboard init error:', err);
    showToast('Error loading dashboard: ' + err.message, 'error');
    document.getElementById('loading-overlay').classList.add('hidden');
  }
}

// ── Load User Data ───────────────────────────────────────────
async function loadUserData() {
  const snap = await getDoc(doc(db, 'users', currentUser.uid));
  if (!snap.exists()) { window.location.href = 'setup.html'; return; }
  userData = snap.data();
}

// ── Navbar ────────────────────────────────────────────────────
function renderNavbar() {
  document.getElementById('user-name').textContent   = userData.name;
  document.getElementById('user-avatar').src         = userData.photoURL || '';
  document.getElementById('streak-count').textContent = userData.currentStreak || 0;
}

// ── Overall Stats ─────────────────────────────────────────────
function renderOverallStats() {
  const { totalConducted, totalAttended } = computeTotals(userData.subjects);
  const pct = totalConducted > 0
    ? Math.round((totalAttended / totalConducted) * 100) : 0;

  document.getElementById('overall-pct').textContent = totalConducted > 0 ? `${pct}%` : '—';
  updateProgressRing('overall-ring-fill', pct);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  document.getElementById('hero-greeting').textContent =
    `${greeting}, ${userData.name.split(' ')[0]}!`;

  const adviceCard = document.getElementById('advice-card');
  const adviceIcon = document.getElementById('advice-icon');
  const adviceText = document.getElementById('advice-text');

  if (totalConducted === 0) {
    adviceCard.className = 'advice-card advice-card--warning';
    adviceIcon.textContent = '📋';
    adviceText.textContent = 'No attendance logged yet. Start by logging today\'s attendance!';
    return;
  }

  document.getElementById('overall-counts').textContent = 
    `Total: ${totalAttended} / ${totalConducted} classes`;

  const status = getAttendanceStatus(totalAttended, totalConducted);

  let subText = '';
  if (status.nextMissPct !== undefined) {
    const avg = getAvgClassesPerDay();
    const fmt = (c) => `${c} classes (~${(c / avg).toFixed(1)} days)`;

    if (status.nextMissPct >= 75) {
       subText += `• If you bunk 1 class: ${status.nextMissPct.toFixed(1)}%<br/>`;
    } else {
       subText += `• If you bunk 1 class: ${status.nextMissPct.toFixed(1)}% (need ${fmt(status.nextMissRecovery)} to recover)<br/>`;
    }
    
    if (status.miss7Pct >= 75) {
       subText += `• If you bunk 7 classes: ${status.miss7Pct.toFixed(1)}%`;
    } else {
       subText += `• If you bunk 7 classes: ${status.miss7Pct.toFixed(1)}% (need ${fmt(status.miss7Recovery)} to recover)`;
    }
  }

  if (status.status === 'safe') {
    const avg = getAvgClassesPerDay();
    const fmt = (c) => `${c} class${c !== 1 ? 'es' : ''} (~${(c / avg).toFixed(1)} days)`;
    adviceCard.className = 'advice-card advice-card--safe';
    adviceIcon.textContent = '🟢';
    adviceText.innerHTML = status.canBunk > 0
      ? `<strong>Safe Zone</strong> — You can miss up to ${fmt(status.canBunk)} and stay above 75%.<br/><span style="font-size:0.8rem;opacity:0.8;display:block;margin-top:4px">${subText}</span>`
      : `<strong>Safe Zone</strong> — You're right at the threshold. Attend all classes to stay safe.<br/><span style="font-size:0.8rem;opacity:0.8;display:block;margin-top:4px">${subText}</span>`;
  } else {
    const avg = getAvgClassesPerDay();
    const fmt = (c) => `${c} consecutive class${c !== 1 ? 'es' : ''} (~${(c / avg).toFixed(1)} days)`;
    adviceCard.className = 'advice-card advice-card--danger';
    adviceIcon.textContent = '🔴';
    adviceText.innerHTML =
      `<strong>Danger Zone</strong> — You must attend the next ${fmt(status.mustAttend)} to reach 75%.<br/><span style="font-size:0.8rem;opacity:0.8;display:block;margin-top:4px">${subText}</span>`;
  }
}

// ── Compute Totals ────────────────────────────────────────────
function computeTotals(subjects) {
  let totalConducted = (userData.globalSeedConducted || 0);
  let totalAttended  = (userData.globalSeedAttended  || 0);
  Object.values(subjects || {}).forEach(s => {
    totalConducted += (s.seedConducted   || 0) + (s.loggedConducted || 0);
    totalAttended  += (s.seedAttended    || 0) + (s.loggedAttended  || 0);
  });
  return { totalConducted, totalAttended };
}

function subjectTotals(s) {
  return {
    conducted: (s.seedConducted || 0) + (s.loggedConducted || 0),
    attended:  (s.seedAttended  || 0) + (s.loggedAttended  || 0)
  };
}

// ── Attendance Math ───────────────────────────────────────────
function getAttendanceStatus(attended, conducted) {
  if (conducted === 0) return { status: 'no-data', percentage: 0 };
  const percentage = (attended / conducted) * 100;

  const nextMissPct = (attended / (conducted + 1)) * 100;
  let nextMissRecovery = 0;
  if (nextMissPct < 75) {
      nextMissRecovery = Math.ceil((3 * (conducted + 1)) - (4 * attended));
  }

  const miss7Pct = (attended / (conducted + 7)) * 100;
  let miss7Recovery = 0;
  if (miss7Pct < 75) {
      miss7Recovery = Math.ceil((3 * (conducted + 7)) - (4 * attended));
  }

  if (percentage >= 75) {
    const canBunk = Math.floor((attended / 0.75) - conducted);
    return { status: 'safe', percentage, canBunk, nextMissPct, nextMissRecovery, miss7Pct, miss7Recovery };
  } else {
    const mustAttend = Math.ceil((3 * conducted) - (4 * attended));
    return { status: 'danger', percentage, mustAttend, nextMissPct, nextMissRecovery, miss7Pct, miss7Recovery };
  }
}

// ── Subject Cards ─────────────────────────────────────────────
function renderSubjectCards() {
  const grid = document.getElementById('subjects-grid');
  grid.innerHTML = '';
  const subjects = userData.subjects || {};

  if (Object.keys(subjects).length === 0) {
    grid.innerHTML = '<p class="text-muted text-sm">No subjects yet. Complete setup first.</p>';
    return;
  }

  Object.entries(subjects).forEach(([name, data]) => {
    const { conducted, attended } = subjectTotals(data);
    const pct = conducted > 0 ? Math.round((attended / conducted) * 100) : 0;
    const status = getAttendanceStatus(attended, conducted);
    const colorClass = pct >= 75 ? 'safe' : pct >= 65 ? 'warning' : 'danger';

    let adviceHtml = '';
    if (conducted === 0) {
      adviceHtml = '<span class="text-muted">No logs yet</span>';
    } else if (status.status === 'safe') {
      adviceHtml = `<span style="color:var(--safe)">🟢 Can miss ${status.canBunk} class${status.canBunk !== 1 ? 'es' : ''}</span>`;
    } else {
      adviceHtml = `<span style="color:var(--danger)">🔴 Must attend ${status.mustAttend} more</span>`;
    }

    const card = document.createElement('div');
    card.className = `subject-card border--${colorClass}`;
    card.innerHTML = `
      <div class="subject-card__name">${name}</div>
      <div class="subject-card__pct pct--${colorClass}">${conducted > 0 ? pct + '%' : '—'}</div>
      <div class="subject-card__counts">${attended} / ${conducted} classes</div>
      <div class="subject-card__bar">
        <div class="subject-card__bar-fill bar--${colorClass}"
             style="width:${Math.min(pct, 100)}%"></div>
      </div>
      <div class="subject-card__advice">${adviceHtml}</div>`;
    grid.appendChild(card);
  });
}

// ── Detect Today's Subjects ───────────────────────────────────
function detectTodaySubjects() {
  const dayName = DAYS[new Date().getDay()];
  const todaySubjects = (userData.timetable || {})[dayName] || [];
  const banner = document.getElementById('today-banner-text');

  if (todaySubjects.length === 0) {
    banner.innerHTML = `<strong>No classes</strong> scheduled for today (${capitalize(dayName)}).`;
  } else {
    banner.innerHTML = `<strong>${capitalize(dayName)}</strong> — ${todaySubjects.length} subject${todaySubjects.length !== 1 ? 's' : ''} detected.`;
  }
  return todaySubjects;
}

// ── Form Setup ────────────────────────────────────────────────
function setupForm() {
  // Set default date to today
  const dateInput = document.getElementById('log-date');
  dateInput.value = getTodayString();
  dateInput.max   = getTodayString();

  // Load today's subjects into form
  loadSubjectsForDate(getTodayString());

  // Date change → reload subjects + check duplicate
  dateInput.addEventListener('change', () => {
    loadSubjectsForDate(dateInput.value);
    checkDuplicateLog(dateInput.value);
  });

  // Lab toggle
  document.getElementById('lab-toggle').addEventListener('change', (e) => {
    document.querySelectorAll('.subject-toggle-row').forEach(row => {
      row.dataset.labday = e.target.checked ? 'true' : 'false';
    });
  });

  // Submit
  document.getElementById('submit-btn').addEventListener('click', () => {
    collectAndConfirm();
  });

  // Check today for duplicate
  checkDuplicateLog(getTodayString());
}

function loadSubjectsForDate(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  const dayName = DAYS[date.getDay()];
  const subjects = (userData.timetable || {})[dayName] || [];
  renderSubjectToggles(subjects);
  return subjects;
}

function renderSubjectToggles(subjects) {
  const container = document.getElementById('subject-toggles');
  container.innerHTML = '';

  if (subjects.length === 0) {
    container.innerHTML = '<p class="text-sm text-muted">No subjects scheduled for this day.</p>';
    return;
  }

  subjects.forEach(name => {
    const row = document.createElement('div');
    row.className = 'subject-toggle-row';
    row.dataset.subject = name;
    row.dataset.status  = 'present';  // default present

    row.innerHTML = `
      <span class="subject-toggle-name">${name}</span>
      <div class="subject-toggle-btns">
        <button class="toggle-btn active-present" data-action="present">Present</button>
        <button class="toggle-btn"                data-action="absent">Absent</button>
      </div>`;

    row.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        row.dataset.status = action;
        row.className = `subject-toggle-row ${action}`;
        row.querySelectorAll('.toggle-btn').forEach(b => {
          b.className = 'toggle-btn' +
            (b.dataset.action === action
              ? (action === 'present' ? ' active-present' : ' active-absent')
              : '');
        });
      });
    });

    container.appendChild(row);
    row.classList.add('present');
  });
}

// ── Duplicate Check ───────────────────────────────────────────
async function checkDuplicateLog(dateStr) {
  const warning = document.getElementById('dup-warning');
  try {
    const logRef = doc(db, 'users', currentUser.uid, 'attendance_logs', dateStr);
    const snap   = await getDoc(logRef);
    if (snap.exists()) {
      const data = snap.data();
      const isEditable = data.editableUntil?.toDate() > new Date();
      document.getElementById('dup-warning-text').textContent =
        isEditable
          ? `You already logged ${dateStr}. Submitting again will overwrite it (edit window open).`
          : `You already logged ${dateStr} and the 24-hour edit window has closed.`;
      warning.classList.add('show');
      document.getElementById('submit-btn').disabled = !isEditable;
    } else {
      warning.classList.remove('show');
      document.getElementById('submit-btn').disabled = false;
    }
  } catch {
    warning.classList.remove('show');
  }
}

// ── Collect & Show Confirmation ───────────────────────────────
function collectAndConfirm() {
  const date    = document.getElementById('log-date').value;
  const isLabDay = document.getElementById('lab-toggle').checked;
  const rows    = document.querySelectorAll('.subject-toggle-row');

  if (rows.length === 0) { showToast('No subjects to log for this day.', 'warning'); return; }

  const subjectLogs = {};
  rows.forEach(row => {
    const name   = row.dataset.subject;
    const present = row.dataset.status === 'present';
    const periods = isLabDay ? 3 : 1;
    subjectLogs[name] = {
      conducted: periods,
      attended:  present ? periods : 0
    };
  });

  pendingLog = { date, isLabDay, subjectLogs };

  // Build confirmation modal
  const list = document.getElementById('modal-list');
  list.innerHTML = Object.entries(subjectLogs).map(([name, v]) => `
    <li>
      <span>${name}</span>
      <span style="color:${v.attended > 0 ? 'var(--safe)' : 'var(--danger)'}">
        ${v.attended > 0 ? '✅ Present' : '❌ Absent'} (${v.attended}/${v.conducted})
      </span>
    </li>`).join('');

  document.getElementById('modal-title').textContent =
    isLabDay ? '🔬 Confirm Lab Day' : '✅ Confirm Attendance';
  document.getElementById('modal-body').querySelector ? null : null;

  document.getElementById('confirm-modal').classList.add('show');
}

document.getElementById('modal-cancel').addEventListener('click',  () => {
  document.getElementById('confirm-modal').classList.remove('show');
  pendingLog = null;
});

document.getElementById('modal-confirm').addEventListener('click', async () => {
  document.getElementById('confirm-modal').classList.remove('show');
  if (pendingLog) await submitAttendance(pendingLog);
  pendingLog = null;
});

// ── Submit Attendance ─────────────────────────────────────────
async function submitAttendance({ date, isLabDay, subjectLogs }) {
  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled  = true;
  submitBtn.textContent = 'Saving…';

  try {
    const userRef  = doc(db, 'users', currentUser.uid);
    const logRef   = doc(db, 'users', currentUser.uid, 'attendance_logs', date);
    const now      = new Date();
    const editable = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    await runTransaction(db, async (tx) => {
      const userSnap = await tx.get(userRef);
      const current  = userSnap.data();
      const prevLog  = await tx.get(logRef);

      // Reverse previous log if overwriting
      let subjects = { ...current.subjects };
      if (prevLog.exists()) {
        const old = prevLog.data();
        if (old.subjects) {
          Object.entries(old.subjects).forEach(([name, v]) => {
            if (subjects[name]) {
              subjects[name].loggedConducted =
                Math.max(0, (subjects[name].loggedConducted || 0) - (v.conducted || 0));
              subjects[name].loggedAttended  =
                Math.max(0, (subjects[name].loggedAttended  || 0) - (v.attended  || 0));
            }
          });
        }
      }

      // Apply new log
      Object.entries(subjectLogs).forEach(([name, v]) => {
        if (!subjects[name]) {
          subjects[name] = { seedConducted: 0, seedAttended: 0,
                             loggedConducted: 0, loggedAttended: 0 };
        }
        subjects[name].loggedConducted = (subjects[name].loggedConducted || 0) + v.conducted;
        subjects[name].loggedAttended  = (subjects[name].loggedAttended  || 0) + v.attended;
      });

      tx.set(logRef, {
        type:          'normal',
        isLabDay,
        subjects:      subjectLogs,
        createdAt:     Timestamp.fromDate(now),
        editableUntil: Timestamp.fromDate(editable)
      });

      tx.update(userRef, { subjects });
    });

    // Update local state
    const snap = await getDoc(userRef);
    userData = snap.data();

    await updateStreak();

    renderSubjectCards();
    renderOverallStats();
    refreshCalendar();
    updateTrendChart(currentUser.uid, db, userData.subjects);
    checkDuplicateLog(date);

    showToast('Attendance logged successfully! 🎉', 'success');
  } catch (err) {
    console.error(err);
    showToast('Failed to save: ' + err.message, 'error');
  } finally {
    submitBtn.disabled  = false;
    submitBtn.textContent = 'Submit Attendance';
  }
}

// ── Holiday Submit ─────────────────────────────────────────────
async function submitHoliday(date) {
  try {
    const now      = new Date();
    const editable = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    await setDoc(
      doc(db, 'users', currentUser.uid, 'attendance_logs', date),
      {
        type:          'holiday',
        isLabDay:      false,
        subjects:      {},
        createdAt:     Timestamp.fromDate(now),
        editableUntil: Timestamp.fromDate(editable)
      }
    );
    refreshCalendar();
    checkDuplicateLog(date);
    showToast('Day marked as Holiday 🏖️', 'success');
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  }
}

// ── Quick Actions ─────────────────────────────────────────────
function setupQuickActions() {
  document.getElementById('qa-all-present').addEventListener('click', () => {
    markAll('present');
  });
  document.getElementById('qa-all-absent').addEventListener('click', () => {
    markAll('absent');
  });
  document.getElementById('qa-holiday').addEventListener('click', async () => {
    const date = document.getElementById('log-date').value;
    const confirmed = window.confirm(`Mark ${date} as a Holiday? No attendance will be recorded.`);
    if (confirmed) await submitHoliday(date);
  });
}

function markAll(status) {
  const rows = document.querySelectorAll('.subject-toggle-row');
  if (rows.length === 0) { showToast('No subjects loaded. Select a date first.', 'warning'); return; }

  rows.forEach(row => {
    row.dataset.status = status;
    row.className = `subject-toggle-row ${status}`;
    row.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.className = 'toggle-btn' + (btn.dataset.action === status
        ? (status === 'present' ? ' active-present' : ' active-absent')
        : '');
    });
  });

  if (status === 'present') showToast('All subjects marked as Present ✅', 'success');
  else showToast('All subjects marked as Absent ❌', 'warning');

  // Auto-trigger confirmation
  collectAndConfirm();
}

// ── Streak Logic ──────────────────────────────────────────────
async function updateStreak() {
  const today     = getTodayString();
  const yesterday = getYesterdayString();
  let { currentStreak = 0, longestStreak = 0, lastLoggedDate = '' } = userData;

  if (lastLoggedDate === today) return; // Already counted today

  if (lastLoggedDate === yesterday) {
    currentStreak += 1;
  } else {
    currentStreak = 1;
  }
  longestStreak = Math.max(longestStreak, currentStreak);

  await updateDoc(doc(db, 'users', currentUser.uid), {
    currentStreak, longestStreak, lastLoggedDate: today
  });

  userData.currentStreak  = currentStreak;
  userData.longestStreak  = longestStreak;
  userData.lastLoggedDate = today;

  document.getElementById('streak-count').textContent = currentStreak;
}

// ── Calendar Day Click ────────────────────────────────────────
function onDayClick(dateStr, logData) {
  const modal   = document.getElementById('day-modal');
  const title   = document.getElementById('day-modal-title');
  const body    = document.getElementById('day-modal-body');
  const editBtn = document.getElementById('day-modal-edit');

  title.textContent = `📅 ${dateStr}`;

  if (!logData) {
    body.innerHTML = '<p class="text-muted text-sm">No attendance logged for this day.</p>';
    editBtn.classList.add('hidden');
  } else if (logData.type === 'holiday') {
    body.innerHTML = `<div class="holiday-badge">🏖️ Holiday / No Class</div>`;
    const editable = logData.editableUntil?.toDate() > new Date();
    editBtn.classList.toggle('hidden', !editable);
  } else {
    const rows = Object.entries(logData.subjects || {}).map(([name, v]) => `
      <li>
        <span>${name}</span>
        <span style="color:${v.attended > 0 ? 'var(--safe)' : 'var(--danger)'}">
          ${v.attended > 0 ? '✅' : '❌'} ${v.attended}/${v.conducted}
        </span>
      </li>`).join('');

    const labBadge = logData.isLabDay ? '<span class="holiday-badge" style="margin-bottom:12px;display:inline-flex">🔬 Lab Day</span>' : '';
    body.innerHTML = `${labBadge}<ul class="modal__list">${rows}</ul>`;

    const editable = logData.editableUntil?.toDate() > new Date();
    editBtn.classList.toggle('hidden', !editable);

    editBtn.onclick = () => {
      modal.classList.remove('show');
      document.getElementById('log-date').value = dateStr;
      loadSubjectsForDate(dateStr);
      checkDuplicateLog(dateStr);
      document.getElementById('log-date').scrollIntoView({ behavior: 'smooth' });
    };
  }

  modal.classList.add('show');
}

document.getElementById('day-modal-close').addEventListener('click',  () =>
  document.getElementById('day-modal').classList.remove('show'));

// ── Theme Toggle ──────────────────────────────────────────────
function setupThemeToggle() {
  document.getElementById('theme-toggle').addEventListener('click', async () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next    = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    try {
      await updateDoc(doc(db, 'users', currentUser.uid), { theme: next });
    } catch { /* offline — ignore */ }
  });
}

// ── Logout ────────────────────────────────────────────────────
function setupLogout() {
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await signOutUser();
    window.location.href = 'index.html';
  });
}

// ── Progress Ring ─────────────────────────────────────────────
function updateProgressRing(id, pct) {
  const el = document.getElementById(id);
  if (!el) return;
  const circumference = 339.3;
  const offset = circumference * (1 - Math.min(pct, 100) / 100);
  el.style.strokeDashoffset = offset;

  if (pct >= 75)      el.style.stroke = 'var(--safe)';
  else if (pct >= 65) el.style.stroke = 'var(--warning)';
  else                el.style.stroke = 'var(--danger)';
}

// ── Toast ─────────────────────────────────────────────────────
export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ── Helpers ───────────────────────────────────────────────────
function getTodayString() {
  return new Date().toISOString().split('T')[0];
}
function getYesterdayString() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ── Leave Calculator ──────────────────────────────────────────
function getAvgClassesPerDay() {
  const timetable = userData.timetable || {};
  let totalClasses = 0;
  let activeDays = 0;
  Object.values(timetable).forEach(daySubjects => {
    if (daySubjects && daySubjects.length > 0) {
      totalClasses += daySubjects.length;
      activeDays += 1;
    }
  });
  if (activeDays === 0) return 1;
  return totalClasses / activeDays;
}

function setupLeaveCalculator() {
  const input = document.getElementById('calc-leave-days');
  const result = document.getElementById('calc-result');
  if (!input || !result) return;

  function calculateLeave() {
    const daysToLeave = parseInt(input.value) || 0;
    const avgClasses = getAvgClassesPerDay();
    const missedClasses = Math.round(daysToLeave * avgClasses);
    
    const { totalConducted, totalAttended } = computeTotals(userData.subjects);
    if (totalConducted === 0) {
       result.textContent = 'my attendance will be —%';
       return;
    }
    
    const newConducted = totalConducted + missedClasses;
    const newPct = ((totalAttended / newConducted) * 100).toFixed(1);
    
    let color = 'var(--danger)';
    if (newPct >= 75) color = 'var(--safe)';
    else if (newPct >= 65) color = 'var(--warning)';
    
    let recoveryText = '';
    if (newPct < 75) {
       const recoveryClasses = Math.ceil((3 * newConducted) - (4 * totalAttended));
       const recoveryDays = (recoveryClasses / avgClasses).toFixed(1);
       recoveryText = ` <span style="font-size:0.85rem;color:var(--text-muted);font-weight:normal;display:block;margin-top:4px">(need ${recoveryClasses} classes / ~${recoveryDays} days to recover)</span>`;
    }
    
    result.innerHTML = `my attendance will be <span style="color:${color}">${newPct}%</span>${recoveryText}`;
  }
  
  input.addEventListener('input', calculateLeave);
  calculateLeave(); // Init
}
