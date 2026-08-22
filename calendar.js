// ============================================================
//  calendar.js — Monthly Calendar Renderer
// ============================================================

import {
  collection, query, where,
  getDocs, orderBy, doc, getDoc, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];
const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

let _userId, _db, _onDayClick;
let currentYear, currentMonth;
let monthLogs = {};  // { 'YYYY-MM-DD': logData }

// ── Init ─────────────────────────────────────────────────────
export async function initCalendar(userId, db, onDayClick) {
  _userId     = userId;
  _db         = db;
  _onDayClick = onDayClick;

  const now    = new Date();
  currentYear  = now.getFullYear();
  currentMonth = now.getMonth();

  document.getElementById('cal-prev').addEventListener('click', () => navigate(-1));
  document.getElementById('cal-next').addEventListener('click', () => navigate(1));

  await renderCalendar();
}

export async function refreshCalendar() {
  await renderCalendar();
}

async function navigate(delta) {
  currentMonth += delta;
  if (currentMonth < 0)  { currentMonth = 11; currentYear--; }
  if (currentMonth > 11) { currentMonth = 0;  currentYear++; }
  await renderCalendar();
}

// ── Render ────────────────────────────────────────────────────
async function renderCalendar() {
  document.getElementById('cal-month-label').textContent =
    `${MONTH_NAMES[currentMonth]} ${currentYear}`;

  monthLogs = await fetchMonthLogs(currentYear, currentMonth);
  buildGrid(currentYear, currentMonth, monthLogs);
}

async function fetchMonthLogs(year, month) {
  const result = {};
  try {
    const logsRef = collection(_db, 'users', _userId, 'attendance_logs');

    // Build date range strings for the month
    const startStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const endDate  = new Date(year, month + 1, 0);
    const endStr   = `${year}-${String(month + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

    const snap = await getDocs(logsRef);
    snap.forEach(d => {
      const id = d.id;
      if (id >= startStr && id <= endStr) {
        result[id] = d.data();
      }
    });
  } catch (err) {
    console.warn('Calendar fetch error:', err);
  }
  return result;
}

// ── Grid Builder ──────────────────────────────────────────────
function buildGrid(year, month, logs) {
  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';

  // Day-of-week headers
  DAY_LABELS.forEach(label => {
    const el = document.createElement('div');
    el.className = 'cal-day-label';
    el.textContent = label;
    grid.appendChild(el);
  });

  const firstDay   = new Date(year, month, 1).getDay();   // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today       = new Date().toISOString().split('T')[0];

  // Empty cells before month start
  for (let i = 0; i < firstDay; i++) {
    const el = document.createElement('div');
    el.className = 'cal-day cal-day--empty';
    grid.appendChild(el);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isFuture = dateStr > today;
    const isToday  = dateStr === today;
    const log      = logs[dateStr];

    const el = document.createElement('div');
    el.textContent = d;
    el.setAttribute('data-date', dateStr);

    const classes = ['cal-day'];
    if (isFuture) {
      classes.push('cal-day--future');
    } else if (log) {
      classes.push(getDayClass(log));
      // Edit dot if within 24h
      if (true) {
        const dot = document.createElement('span');
        dot.className = 'edit-dot';
        el.appendChild(dot);
      }
    } else {
      classes.push('cal-day--no-data');
    }
    if (isToday) classes.push('cal-day--today');

    el.className = classes.join(' ');

    if (!isFuture) {
      el.addEventListener('click', () => _onDayClick(dateStr, log || null));
    }
    grid.appendChild(el);
  }
}

function getDayClass(log) {
  if (log.type === 'holiday') return 'cal-day--holiday';
  if (!log.subjects || Object.keys(log.subjects).length === 0) return 'cal-day--no-data';

  let totalConducted = 0, totalAttended = 0;
  Object.values(log.subjects).forEach(v => {
    totalConducted += v.conducted || 0;
    totalAttended  += v.attended  || 0;
  });

  if (totalConducted === 0) return 'cal-day--no-data';
  const pct = (totalAttended / totalConducted) * 100;

  if (pct >= 75) return 'cal-day--safe';
  if (pct >= 40) return 'cal-day--warning';
  return 'cal-day--danger';
}
