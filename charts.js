// ============================================================
//  charts.js — Subject-wise Attendance Trend Chart (Chart.js)
// ============================================================

import {
  collection, getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const SUBJECT_COLORS = [
  '#6c63ff','#06d6a0','#ff4d6d','#ffd166','#4ecdc4',
  '#a8dadc','#f4a261','#e76f51','#2a9d8f','#e9c46a'
];

let chartInstance = null;
let _userId, _db;

// ── Init ─────────────────────────────────────────────────────
export async function initTrendChart(userId, db, subjects) {
  _userId  = userId;
  _db      = db;
  await renderChart(subjects);
}

export async function updateTrendChart(userId, db, subjects) {
  _userId  = userId;
  _db      = db;
  await renderChart(subjects);
}

async function renderChart(subjects) {
  const canvas = document.getElementById('trend-chart');
  if (!canvas) return;

  const allLogs = await fetchAllLogs();
  if (Object.keys(allLogs).length === 0) {
    canvas.parentElement.innerHTML =
      '<p class="text-muted text-sm" style="text-align:center;padding:40px 0">Log at least 2 weeks of attendance to see your trend chart.</p>';
    return;
  }

  const subjectNames = Object.keys(subjects || {});
  const { labels, datasets } = buildWeeklyDatasets(allLogs, subjectNames);

  if (chartInstance) chartInstance.destroy();

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const gridColor   = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const tickColor   = isDark ? '#9197ae' : '#6b7280';
  const legendColor = isDark ? '#e8eaf6' : '#1a1a2e';

  chartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        // 75% threshold dashed line
        {
          label: '75% Target',
          data: Array(labels.length).fill(75),
          borderColor: '#ffd166',
          borderWidth: 1.5,
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false,
          tension: 0,
          order: 99
        },
        ...datasets
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: legendColor,
            font: { family: 'Inter', size: 11 },
            padding: 16,
            boxWidth: 12,
            borderRadius: 4
          }
        },
        tooltip: {
          backgroundColor: isDark ? '#1a2035' : '#fff',
          titleColor:      legendColor,
          bodyColor:       tickColor,
          borderColor:     'rgba(108,99,255,0.3)',
          borderWidth:     1,
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1) ?? '—'}%`
          }
        }
      },
      scales: {
        x: {
          grid:  { color: gridColor },
          ticks: { color: tickColor, font: { family: 'Inter', size: 11 } }
        },
        y: {
          min: 0, max: 100,
          grid:  { color: gridColor },
          ticks: {
            color: tickColor,
            font:  { family: 'Inter', size: 11 },
            callback: v => v + '%'
          }
        }
      }
    }
  });
}

// ── Fetch All Logs ────────────────────────────────────────────
async function fetchAllLogs() {
  const result = {};
  try {
    const snap = await getDocs(
      collection(_db, 'users', _userId, 'attendance_logs')
    );
    snap.forEach(d => {
      if (d.data().type !== 'holiday') {
        result[d.id] = d.data();
      }
    });
  } catch (err) {
    console.warn('Chart fetch error:', err);
  }
  return result;
}

// ── Group by ISO Week → build datasets ───────────────────────
function buildWeeklyDatasets(logs, subjectNames) {
  // { 'YYYY-Www': { Subject: { conducted, attended } } }
  const weekMap = {};

  Object.entries(logs).forEach(([dateStr, log]) => {
    const weekLabel = getISOWeekLabel(dateStr);
    if (!weekMap[weekLabel]) weekMap[weekLabel] = {};

    Object.entries(log.subjects || {}).forEach(([name, v]) => {
      if (!weekMap[weekLabel][name]) {
        weekMap[weekLabel][name] = { conducted: 0, attended: 0 };
      }
      weekMap[weekLabel][name].conducted += v.conducted || 0;
      weekMap[weekLabel][name].attended  += v.attended  || 0;
    });
  });

  const labels   = Object.keys(weekMap).sort();
  const datasets = subjectNames.map((name, i) => ({
    label:           name,
    data:            labels.map(wk => {
      const s = weekMap[wk]?.[name];
      if (!s || s.conducted === 0) return null;
      return parseFloat(((s.attended / s.conducted) * 100).toFixed(1));
    }),
    borderColor:     SUBJECT_COLORS[i % SUBJECT_COLORS.length],
    backgroundColor: SUBJECT_COLORS[i % SUBJECT_COLORS.length] + '22',
    borderWidth:     2,
    pointRadius:     4,
    pointHoverRadius:6,
    tension:         0.35,
    fill:            false,
    spanGaps:        true
  }));

  return { labels: labels.map(formatWeekLabel), datasets };
}

function getISOWeekLabel(dateStr) {
  const d    = new Date(dateStr + 'T00:00:00');
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d - jan1) / 86400000) + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function formatWeekLabel(isoWeek) {
  // e.g. '2026-W03' → 'W3 Jan'
  const [year, w] = isoWeek.split('-W');
  const weekNum   = parseInt(w);
  const d = new Date(parseInt(year), 0, 1 + (weekNum - 1) * 7);
  return `W${weekNum} ${d.toLocaleDateString('en', { month: 'short' })}`;
}
