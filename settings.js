// ============================================================
//  settings.js — Settings Page Logic
// ============================================================

import { auth, db, signOutUser, onAuth } from './app.js';
import {
  doc, getDoc, updateDoc, collection, getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday'];

let currentUser = null;
let userData    = null;

onAuth(async (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  currentUser = user;
  await loadSettings();
});

async function loadSettings() {
  try {
    const snap = await getDoc(doc(db, 'users', currentUser.uid));
    if (!snap.exists()) { window.location.href = 'setup.html'; return; }
    userData = snap.data();

    // Count total logs
    const logsSnap = await getDocs(
      collection(db, 'users', currentUser.uid, 'attendance_logs')
    );

    renderProfile();
    renderStats(logsSnap.size);
    renderTimetable();
    setupTheme();

    document.getElementById('loading-overlay').classList.add('hidden');
    document.getElementById('settings-root').classList.remove('hidden');
  } catch (err) {
    console.error(err);
    showToast('Error loading settings: ' + err.message, 'error');
    document.getElementById('loading-overlay').classList.add('hidden');
  }
}

function renderProfile() {
  document.getElementById('profile-avatar').src = userData.photoURL || '';
  document.getElementById('profile-name').textContent  = userData.name  || '—';
  document.getElementById('profile-email').textContent = userData.email || '—';
}

function renderStats(totalLogs) {
  const created = userData.createdAt?.toDate?.();
  document.getElementById('stat-member-since').textContent =
    created ? created.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '—';
  document.getElementById('stat-streak').textContent  =
    `🔥 ${userData.currentStreak || 0} days`;
  document.getElementById('stat-longest').textContent =
    `🏆 ${userData.longestStreak || 0} days`;
  document.getElementById('stat-total-logs').textContent = `${totalLogs} entries`;
}

function renderTimetable() {
  const viewer = document.getElementById('timetable-viewer');
  const tt     = userData.timetable || {};
  const hasDays = DAYS.some(d => (tt[d] || []).length > 0);

  if (!hasDays) {
    viewer.innerHTML = '<p class="text-muted text-sm">No timetable found. Please complete setup.</p>';
    return;
  }

  viewer.innerHTML = DAYS
    .filter(d => (tt[d] || []).length > 0)
    .map(day => `
      <div class="stat-row">
        <span class="stat-label">${capitalize(day)}</span>
        <span class="stat-value" style="font-size:0.82rem;text-align:right;flex-wrap:wrap;gap:4px;display:flex;justify-content:flex-end">
          ${(tt[day] || []).map(s => `<span class="subject-chip" style="font-size:0.7rem;padding:2px 8px">${s}</span>`).join('')}
        </span>
      </div>`)
    .join('');
}

function setupTheme() {
  const themeSwitch = document.getElementById('theme-switch');
  const current     = document.documentElement.getAttribute('data-theme');
  themeSwitch.checked = current === 'dark';

  async function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    try {
      await updateDoc(doc(db, 'users', currentUser.uid), { theme });
    } catch { /* offline */ }
  }

  themeSwitch.addEventListener('change', () => {
    applyTheme(themeSwitch.checked ? 'dark' : 'light');
  });

  document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    themeSwitch.checked = next === 'dark';
    applyTheme(next);
  });
}

// Re-upload timetable
document.getElementById('re-upload-btn').addEventListener('click', async () => {
  const confirmed = window.confirm(
    'This will take you to the setup wizard to re-upload your timetable.\n\n' +
    'Your existing attendance logs will NOT be deleted.\n\nContinue?'
  );
  if (!confirmed) return;
  try {
    await updateDoc(doc(db, 'users', currentUser.uid), { setupComplete: false });
    window.location.href = 'setup.html';
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
});

// Logout
document.getElementById('logout-btn').addEventListener('click', async () => {
  await signOutUser(); window.location.href = 'index.html';
});
document.getElementById('logout-full-btn').addEventListener('click', async () => {
  await signOutUser(); window.location.href = 'index.html';
});

// ── Toast ─────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
