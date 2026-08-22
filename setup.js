// ============================================================
//  setup.js — Simplified Setup Wizard (no AI, manual entry)
// ============================================================

import { auth, db, onAuth } from './app.js';
import {
  doc, setDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday'];
const DAY_LABELS = {
  monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday',
  thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday'
};

// ── State ────────────────────────────────────────────────────
let currentUser = null;
let timetable   = {};   // { monday: ["Math","Physics"], ... }
let midsemData  = { seedConducted: 0, seedAttended: 0 };

// ── Auth Guard ───────────────────────────────────────────────
onAuth((user) => {
  document.getElementById('loading-overlay').classList.add('hidden');
  if (!user) { window.location.href = 'index.html'; return; }
  currentUser = user;
  document.getElementById('wizard-root').classList.remove('hidden');
  buildTimetableInputs();
});

// ── Step Navigation ──────────────────────────────────────────
let currentStep = 1;
const TOTAL_STEPS = 3;

function goToStep(n) {
  document.getElementById(`step-${currentStep}`).classList.add('hidden');
  currentStep = n;
  document.getElementById(`step-${currentStep}`).classList.remove('hidden');
  updateDots();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateDots() {
  for (let i = 1; i <= TOTAL_STEPS; i++) {
    const dot = document.getElementById(`dot-${i}`);
    dot.classList.remove('active', 'done');
    if (i < currentStep)  dot.classList.add('done');
    if (i === currentStep) dot.classList.add('active');
  }
  for (let i = 1; i <= TOTAL_STEPS - 1; i++) {
    document.getElementById(`con-${i}`)?.classList.toggle('done', i < currentStep);
  }
}

// ── Step 1: Build Timetable Input Grid ───────────────────────
function buildTimetableInputs() {
  const container = document.getElementById('timetable-inputs');
  container.innerHTML = '';

  DAYS.forEach(day => {
    timetable[day] = [];
    const row = document.createElement('div');
    row.className = 'day-row';
    row.innerHTML = `
      <span class="day-label-text">${DAY_LABELS[day]}</span>
      <input
        type="text"
        class="subjects-input"
        id="input-${day}"
        placeholder="Math, Physics, Chemistry…"
        autocomplete="off"
      />`;
    container.appendChild(row);
  });
}

function parseTimetableFromInputs() {
  DAYS.forEach(day => {
    const val = document.getElementById(`input-${day}`)?.value.trim() || '';
    timetable[day] = val
      ? val.split(',').map(s => s.trim()).filter(s => s.length > 0)
      : [];
  });
}

function getUniqueSubjects() {
  const set = new Set();
  DAYS.forEach(d => (timetable[d] || []).forEach(s => set.add(s)));
  return [...set].sort();
}

// ── Step 1 → 2 ───────────────────────────────────────────────
document.getElementById('go-to-2').addEventListener('click', () => {
  parseTimetableFromInputs();
  const subjects = getUniqueSubjects();
  if (subjects.length === 0) {
    alert('Please enter at least one subject for any day.');
    return;
  }
  goToStep(2);
});

document.getElementById('back-to-1').addEventListener('click', () => goToStep(1));

// ── Step 2: Mid-Semester Combined Totals ─────────────────────
const midsemToggle = document.getElementById('midsem-toggle');
const midsemWrap   = document.getElementById('midsem-wrap');
const conInput     = document.getElementById('total-conducted');
const attInput     = document.getElementById('total-attended');
const pctPreview   = document.getElementById('pct-preview');

midsemToggle.addEventListener('change', () => {
  midsemWrap.classList.toggle('hidden', !midsemToggle.checked);
  if (!midsemToggle.checked) {
    midsemData = { seedConducted: 0, seedAttended: 0 };
    updatePreview();
  }
});

function updatePreview() {
  const c = parseInt(conInput.value) || 0;
  let   a = parseInt(attInput.value) || 0;
  if (a > c) { a = c; attInput.value = c; }

  if (c === 0) {
    pctPreview.style.background = 'var(--surface)';
    pctPreview.style.border     = '1px solid var(--border)';
    pctPreview.style.color      = 'var(--text-muted)';
    pctPreview.innerHTML = `— <span class="pct-preview-label">Enter numbers above to see your current %</span>`;
    return;
  }

  const pct = Math.round((a / c) * 100);
  const isSafe    = pct >= 75;
  const isWarning = pct >= 65 && pct < 75;

  pctPreview.style.background = isSafe
    ? 'var(--safe-bg)' : isWarning
    ? 'var(--warning-bg)' : 'var(--danger-bg)';
  pctPreview.style.border = isSafe
    ? '1px solid rgba(6,214,160,0.3)' : isWarning
    ? '1px solid rgba(255,209,102,0.3)' : '1px solid rgba(255,77,109,0.3)';
  pctPreview.style.color = isSafe
    ? 'var(--safe)' : isWarning
    ? 'var(--warning)' : 'var(--danger)';

  const statusText = isSafe
    ? '🟢 You are in the Safe Zone'
    : isWarning
    ? '🟡 Borderline — attend regularly'
    : '🔴 Danger Zone — needs recovery';

  pctPreview.innerHTML = `${pct}%
    <span class="pct-preview-label">${a} attended / ${c} conducted — ${statusText}</span>`;
}

conInput.addEventListener('input', updatePreview);
attInput.addEventListener('input', updatePreview);

// ── Step 2 → 3 ───────────────────────────────────────────────
document.getElementById('go-to-3').addEventListener('click', () => {
  if (midsemToggle.checked) {
    const c = parseInt(conInput.value) || 0;
    const a = Math.min(parseInt(attInput.value) || 0, c);
    midsemData = { seedConducted: c, seedAttended: a };
  } else {
    midsemData = { seedConducted: 0, seedAttended: 0 };
  }
  buildSummary();
  goToStep(3);
});

document.getElementById('back-to-2').addEventListener('click', () => goToStep(2));

// ── Step 3: Summary ──────────────────────────────────────────
function buildSummary() {
  const subjects = getUniqueSubjects();
  const el       = document.getElementById('setup-summary');

  const dayRows = DAYS
    .filter(d => (timetable[d] || []).length > 0)
    .map(d => `
      <div class="stat-row">
        <span class="stat-label">${DAY_LABELS[d]}</span>
        <span class="stat-value" style="font-size:0.82rem">
          ${timetable[d].join(', ')}
        </span>
      </div>`).join('');

  const midsemSummary = midsemToggle.checked && midsemData.seedConducted > 0
    ? `<div class="card" style="margin-top:12px">
        <p class="section-title">Previous Attendance (Seeded)</p>
        <div class="stat-row">
          <span class="stat-label">Classes Conducted So Far</span>
          <span class="stat-value">${midsemData.seedConducted}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Classes Attended So Far</span>
          <span class="stat-value">${midsemData.seedAttended}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Current Attendance</span>
          <span class="stat-value" style="color:${
            midsemData.seedConducted > 0 &&
            (midsemData.seedAttended / midsemData.seedConducted) >= 0.75
              ? 'var(--safe)' : 'var(--danger)'
          }">
            ${midsemData.seedConducted > 0
              ? Math.round((midsemData.seedAttended / midsemData.seedConducted) * 100) + '%'
              : '—'}
          </span>
        </div>
      </div>`
    : `<p class="text-xs text-muted mt-8">Starting fresh from zero.</p>`;

  el.innerHTML = `
    <div class="card">
      <p class="section-title">${subjects.length} Subjects · ${
        DAYS.filter(d => (timetable[d]||[]).length > 0).length
      } Days</p>
      ${dayRows}
    </div>
    ${midsemSummary}`;
}

// ── Step 4: Save to Firestore ────────────────────────────────
document.getElementById('confirm-btn').addEventListener('click', async () => {
  const btn      = document.getElementById('confirm-btn');
  const progress = document.getElementById('save-progress');
  btn.disabled   = true;
  progress.classList.remove('hidden');

  try {
    // Build per-subject map (all start at zero logged counts)
    // Global seed values are stored separately at the user level
    const subjects = {};
    getUniqueSubjects().forEach(subj => {
      subjects[subj] = {
        loggedConducted: 0,
        loggedAttended:  0
      };
    });

    const savePromise = setDoc(doc(db, 'users', currentUser.uid), {
      name:              currentUser.displayName || 'Student',
      email:             currentUser.email,
      photoURL:          currentUser.photoURL || '',
      targetPercentage:  75,
      setupComplete:     true,
      timetable,
      subjects,
      // ── Global seed for mid-semester join ──────────────
      globalSeedConducted: midsemData.seedConducted,
      globalSeedAttended:  midsemData.seedAttended,
      // ───────────────────────────────────────────────────
      currentStreak:     0,
      longestStreak:     0,
      lastLoggedDate:    '',
      theme:             localStorage.getItem('theme') || 'dark',
      createdAt:         serverTimestamp()
    }, { merge: true });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Network request timed out. Please check your internet connection or Firebase rules.')), 8000)
    );

    await Promise.race([savePromise, timeoutPromise]);

    window.location.href = 'dashboard.html';
  } catch (err) {
    console.error(err);
    alert('Error saving: ' + err.message);
    btn.disabled = false;
    progress.classList.add('hidden');
  }
});
