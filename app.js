// ============================================================
//  app.js — Firebase Initialization & Auth Helpers
//  Shared by all pages via ES Module imports
// ============================================================

import { initializeApp }                             from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider,
         signInWithPopup, signOut,
         onAuthStateChanged,
         createUserWithEmailAndPassword,
         signInWithEmailAndPassword,
         updateProfile }                             from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { initializeFirestore }                       from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getStorage }                                from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

// ============================================================
//  🔑 PASTE YOUR FIREBASE CONFIG HERE
//  Get it from: Firebase Console → Project Settings → Your Apps
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyC7ajLbUNu2DT9KWMo0hOUeWJhlrqcvyxY",
  authDomain: "attendence-tracker-69359.firebaseapp.com",
  projectId: "attendence-tracker-69359",
  storageBucket: "attendence-tracker-69359.firebasestorage.app",
  messagingSenderId: "242331512338",
  appId: "1:242331512338:web:ad1c70795c1f1e362bb2cb",
  measurementId: "G-NH90P73R4S"
};

// ── Init ────────────────────────────────────────────────────
const app = initializeApp(firebaseConfig);

export const auth    = getAuth(app);
export const db      = initializeFirestore(app, {
  experimentalForceLongPolling: true
});
export const storage = getStorage(app);

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// ── Auth Helpers ─────────────────────────────────────────────
export async function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export async function registerWithEmail(name, email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: name });
  return cred;
}

export async function loginWithEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function signOutUser() {
  return signOut(auth);
}

/** Listen to auth state changes. Calls cb(user) or cb(null). */
export function onAuth(cb) {
  return onAuthStateChanged(auth, cb);
}

// ── Theme Bootstrap (runs on every page load) ────────────────
const saved = localStorage.getItem('theme') || 'dark';
document.documentElement.setAttribute('data-theme', saved);
