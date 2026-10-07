import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  createUserWithEmailAndPassword, deleteUser, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, deleteDoc, updateDoc, collection, onSnapshot, addDoc,
  query, orderBy, limit, serverTimestamp, where, getDocs, getDoc, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCuT_E8UUdBmftYGcVa7nxww6fUE1WBuak",
  authDomain: "tree-d26aa.firebaseapp.com",
  projectId: "tree-d26aa",
  storageBucket: "tree-d26aa.firebasestorage.app",
  messagingSenderId: "222720179431",
  appId: "1:222720179431:web:e86835cdc1b950e8a07642"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let students = [];
let collectionsData = {};
let legacyCollectionsData = {};
let paymentsData = {};
let donationsData = [];
let expensesData = [];
let sheetsData = [];
let sheetOrdersData = [];
let usersData = [];
let currentTreasurerName = "";
let currentUserRole = "pending";
let currentUserGender = null;
let currentSubscriberRoll = null;
let currentOrderDateFilter = null;
let currentActiveTab = null;
let currentReceivedDateFilter = 'all';
let currentReceivedSheetFilter = 'all';
let currentGirlsReceivedDateFilter = 'all';
let currentGirlsReceivedSheetFilter = 'all';
let currentBoysReceivedDateFilter = 'all';
let currentBoysReceivedSheetFilter = 'all';
let treasurerPendingOnly = false;
let girlsPendingOnly = false;
let boysPendingOnly = false;
let batchCountersData = {};
let expenseSelectedRoll = null;

let orderConfig = { cutoffHour: 15, windowStartHour: 10, windowEndHour: 17, discountPercent: 0 };
const DUE_ORDER_BLOCK_LIMIT = 20;

function discountedPrice(basePrice) {
  const pct = Number(orderConfig.discountPercent) || 0;
  if (pct <= 0) return +(basePrice || 0).toFixed(2);
  return +(Math.max(0, (basePrice || 0) * (1 - pct / 100))).toFixed(2);
}
function businessDateKeyOf(date) {
  const d = new Date(date);
  if (d.getHours() >= orderConfig.cutoffHour) d.setDate(d.getDate() + 1);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function currentBusinessDateKey() { return businessDateKeyOf(new Date()); }
function isPastCutoffNow() { return new Date().getHours() >= orderConfig.cutoffHour; }
function formatBusinessDateLabel(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
}
function localDateKey(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function formatHourLabel(h) {
  const hour = ((Number(h) % 24) + 24) % 24;
  const period = hour < 12 ? 'AM' : 'PM';
  let hour12 = hour % 12; if (hour12 === 0) hour12 = 12;
  return `${hour12}:00 ${period}`;
}
function isWithinOrderWindow() {
  const h = new Date().getHours();
  return h >= orderConfig.windowStartHour && h < orderConfig.windowEndHour;
}
function orderWindowMessage() {
  return `অর্ডার শুধুমাত্র প্রতিদিন ${formatHourLabel(orderConfig.windowStartHour)} থেকে ${formatHourLabel(orderConfig.windowEndHour)} এর মধ্যে দেওয়া যায়। এখন অর্ডার নেওয়া বন্ধ আছে।`;
}
function currentBatchSeqFor(businessDate) {
  const rec = batchCountersData[businessDate];
  return (rec && rec.currentSeq) ? rec.currentSeq : 1;
}
function orderBatchKey(o) { return `${o.businessDate}#${o.batchSeq || 1}`; }
function parseBatchKey(key) {
  const idx = key.lastIndexOf('#');
  return { businessDate: key.slice(0, idx), seq: Number(key.slice(idx + 1)) || 1 };
}
function formatBatchLabel(businessDate, seq, extra) {
  return `${formatBusinessDateLabel(businessDate)} — ব্যাচ ${seq}${extra ? ' ' + extra : ''}`;
}
function tsToDate(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  const d = new Date(ts);
  return isNaN(d) ? null : d;
}
function eligibleStudentsAt(time) {
  return students.filter(s => {
    const addedAt = tsToDate(s.addedAt);
    if (!addedAt) return true;
    return !time || addedAt <= time;
  });
}
function stampInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
}
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const PRICE_PER_DUPLEX_SHEET = 3;
const PRICE_PER_SINGLE_SHEET = 1.5;
function sheetBreakdownFor(pages) {
  const p = Math.max(0, Math.floor(Number(pages) || 0));
  const duplexSheets = Math.floor(p / 2);
  const hasSingleLeftover = p % 2 === 1;
  return { pages: p, duplexSheets, hasSingleLeftover, physicalSheets: duplexSheets + (hasSingleLeftover ? 1 : 0) };
}
function computeSheetPrice(pages) {
  const { duplexSheets, hasSingleLeftover } = sheetBreakdownFor(pages);
  return duplexSheets * PRICE_PER_DUPLEX_SHEET + (hasSingleLeftover ? PRICE_PER_SINGLE_SHEET : 0);
}
function sheetBreakdownLabel(pages) {
  const { duplexSheets, hasSingleLeftover } = sheetBreakdownFor(pages);
  const parts = [];
  if (duplexSheets > 0) parts.push(`${duplexSheets}টি এপিঠ-ওপিঠ`);
  if (hasSingleLeftover) parts.push(`১টি এক সাইড`);
  return parts.join(' + ') || 'পেজ নেই';
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}
function resetAuthErrorStyle() {
  const el = document.getElementById('auth-error');
  if (!el) return;
  el.style.background = '';
  el.style.color = '';
  el.style.borderColor = '';
}

window.doLogin = async () => {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) return showAuthError("Please enter both email and password.");
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    showAuthError(e && (e.code === 'auth/invalid-email')
      ? "সঠিক ইমেইল ঠিকানা দিন।"
      : "Login failed. Please check your email and password.");
  }
};

window.doLogout = async () => {
  currentActiveTab = null;
  stopListeners();
  await signOut(auth);
};

window.showRegisterForm = () => {
  document.getElementById('auth-error').classList.add('hidden');
  resetAuthErrorStyle();
  document.getElementById('login-form').classList.add('hidden');
  const ff = document.getElementById('forgot-password-form');
  if (ff) ff.classList.add('hidden');
  document.getElementById('register-form').classList.remove('hidden');
};
window.showLoginForm = () => {
  document.getElementById('auth-error').classList.add('hidden');
  resetAuthErrorStyle();
  document.getElementById('register-form').classList.add('hidden');
  const ff = document.getElementById('forgot-password-form');
  if (ff) ff.classList.add('hidden');
  document.getElementById('login-form').classList.remove('hidden');
};
window.showForgotPasswordForm = () => {
  document.getElementById('auth-error').classList.add('hidden');
  resetAuthErrorStyle();
  document.getElementById('login-form').classList.add('hidden');
  document.getElementById('register-form').classList.add('hidden');
  document.getElementById('forgot-password-form').classList.remove('hidden');
};

window.doForgotPassword = async () => {
  const email = document.getElementById('forgot-email').value.trim();
  if (!email) { showAuthError("Please enter your email address."); return; }
  const btn = document.getElementById('forgot-btn');
  if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
  document.getElementById('auth-error').classList.add('hidden');
  resetAuthErrorStyle();
  try {
    await sendPasswordResetEmail(auth, email);
    const errEl = document.getElementById('auth-error');
    errEl.textContent = `✓ Reset link sent to ${email}. Check your inbox (and spam folder).`;
    errEl.style.background = 'var(--success-soft)';
    errEl.style.color = '#065F46';
    errEl.style.borderColor = '#A7F3D0';
    errEl.classList.remove('hidden');
    document.getElementById('forgot-email').value = '';
    setTimeout(() => { resetAuthErrorStyle(); errEl.classList.add('hidden'); }, 8000);
  } catch (e) {
    const code = e && e.code;
    let msg = "Could not send reset link. ";
    if (code === 'auth/invalid-email') msg = "Invalid email address.";
    else if (code === 'auth/user-not-found') msg = "No account found with this email.";
    else if (code === 'auth/too-many-requests') msg = "Too many requests. Try again later.";
    else msg += (e && e.message ? e.message : e);
    showAuthError(msg);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Send Reset Link"; }
  }
};

window.doRegister = async () => {
  const roll = parseInt(document.getElementById('reg-roll').value, 10);
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const confirmPassword = document.getElementById('reg-confirm-password').value;
  if (!roll && roll !== 0) return showAuthError("সঠিক Roll নম্বর দিন।");
  if (!email || !password) return showAuthError("ইমেইল ও পাসওয়ার্ড — দুটোই দিন।");
  if (password.length < 6) return showAuthError("পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।");
  if (password !== confirmPassword) return showAuthError("পাসওয়ার্ড দুইবার একই দেননি।");
  const btn = document.getElementById('register-btn');
  if (btn) { btn.disabled = true; btn.textContent = "রেজিস্ট্রেশন হচ্ছে…"; }
  document.getElementById('auth-error').classList.add('hidden');
  let cred;
  try {
    cred = await createUserWithEmailAndPassword(auth, email, password);
  } catch (e) {
    const code = e && e.code;
    let msg = "অ্যাকাউন্ট তৈরি করা যায়নি। কারণ: " + (e && e.message ? e.message : e);
    if (code === 'auth/email-already-in-use') msg = "এই ইমেইলে ইতিমধ্যে একটি অ্যাকাউন্ট আছে।";
    if (code === 'auth/invalid-email') msg = "সঠিক ইমেইল ঠিকানা দিন।";
    showAuthError(msg);
    if (btn) { btn.disabled = false; btn.textContent = "Register"; }
    return;
  }
  try {
    const studentDoc = await getDoc(doc(db, "students", roll.toString()));
    if (!studentDoc.exists()) throw new Error(`Roll ${roll} এখনো Treasurer যোগ করেননি।`);
    const student = studentDoc.data();
    const existingSnap = await getDocs(query(collection(db, "users"), where("role", "==", "subscriber")));
    if (existingSnap.docs.some(d => d.data().roll === roll)) throw new Error(`Roll ${roll} এর জন্য আগে থেকেই একটি অ্যাকাউন্ট রেজিস্টার করা আছে।`);
    await setDoc(doc(db, "users", cred.user.uid), {
      role: 'subscriber', roll, name: student.name, email, gender: student.gender || null,
      createdAt: serverTimestamp(), addedBy: 'self-registration'
    });
    document.getElementById('reg-roll').value = "";
    document.getElementById('reg-email').value = "";
    document.getElementById('reg-password').value = "";
    document.getElementById('reg-confirm-password').value = "";
    await applyLoggedInUser(cred.user);
  } catch (e) {
    showAuthError(e && e.message ? e.message : "রেজিস্ট্রেশন করা যায়নি।");
    try { await deleteUser(cred.user); } catch (_) { try { await signOut(auth); } catch (_) {} }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Register"; }
  }
};

async function applyLoggedInUser(user) {
  let role = "pending", roll = null, name = user.displayName || user.email;
  let adminGender = null;
  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists()) {
      const data = userDoc.data();
      role = data.role || "pending";
      roll = data.roll || null;
      name = data.name || name;
      adminGender = data.gender || (role === 'girls_admin' ? 'female' : (role === 'chele_admin' ? 'male' : null));
    }
  } catch (e) { console.error("Error loading user doc:", e); }
  currentUserRole = role;
  currentSubscriberRoll = roll;
  currentTreasurerName = name;
  currentUserGender = adminGender;
  document.getElementById('auth-screen').classList.add('hidden');
  const pendingEl = document.getElementById('pending-screen');
  const appEl = document.getElementById('app');
  if (role === 'pending') {
    appEl.classList.add('hidden');
    document.getElementById('pending-email').textContent = user.email || name;
    pendingEl.classList.remove('hidden');
    return;
  }
  pendingEl.classList.add('hidden');
  appEl.classList.remove('hidden');
  document.getElementById('current-user-name').textContent = name;
  document.getElementById('current-user-role').textContent =
    role === 'subscriber' ? 'Subscriber' : (role === 'girls_admin' ? 'মেয়েদের এডমিন' : (role === 'chele_admin' ? 'ছেলেদের এডমিন' : 'Treasurer'));
  const initials = stampInitials(name);
  document.getElementById('current-user-stamp').textContent = initials;
  const topStamp = document.getElementById('topbar-user-stamp');
  if (topStamp) topStamp.textContent = initials;
  invalidateShareCache();
  applyRoleVisibility();
  startListeners();
}

onAuthStateChanged(auth, (user) => {
  if (user) { applyLoggedInUser(user); }
  else {
    stopListeners();
    document.getElementById('app').classList.add('hidden');
    document.getElementById('pending-screen').classList.add('hidden');
    document.getElementById('auth-screen').classList.remove('hidden');
    window.showLoginForm();
  }
});

const TABS_BY_ROLE = {
  treasurer: [
    { id: 'dashboard', label: '📊 Dashboard' },
    { id: 'subscribers', label: '👥 Subscribers' },
    { id: 'users', label: '🔑 Login Accounts' },
    { id: 'expense', label: '🧾 Add Expense' },
    { id: 'sheets', label: '📄 Sheets & Orders' },
    { id: 'activity', label: '🕘 Activity' }
  ],
  subscriber: [
    { id: 'dashboard', label: '📊 My Account' },
    { id: 'sheets', label: '📄 Order Sheets' }
  ],
  girls_admin: [
    { id: 'dashboard', label: '📊 Overview' },
    { id: 'payments', label: '💰 Add Payment' },
    { id: 'sheets', label: '📄 My Orders' }
  ],
  chele_admin: [
    { id: 'dashboard', label: '📊 Overview' },
    { id: 'payments', label: '💰 Add Payment' },
    { id: 'sheets', label: '📄 My Orders' }
  ]
};

const PAGE_TITLES = {
  dashboard: 'Dashboard', subscribers: 'Subscribers', users: 'Login Accounts',
  expense: 'Add Expense', sheets: 'Sheets & Orders', activity: 'Activity', payments: 'Add Payment'
};

function getRoleClass(role) {
  if (role === 'treasurer') return 'treasurer-only';
  if (role === 'subscriber') return 'subscriber-only';
  if (role === 'girls_admin') return 'girls-admin-only';
  if (role === 'chele_admin') return 'boys-admin-only';
  return null;
}

window.setActiveTab = (tabId) => {
  currentActiveTab = tabId;
  const currentRoleClass = getRoleClass(currentUserRole);
  document.querySelectorAll('[data-tab]').forEach(el => {
    const hasRoleClass = currentRoleClass && el.classList.contains(currentRoleClass);
    const matchesTab = el.dataset.tab === tabId;
    if (hasRoleClass && matchesTab) el.classList.remove('hidden');
    else el.classList.add('hidden');
  });
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tabid === tabId);
  });
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = PAGE_TITLES[tabId] || 'Dashboard';
  const sb = document.getElementById('sidebar');
  if (sb) sb.classList.remove('open');
};

function renderSidebar() {
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;
  const tabs = TABS_BY_ROLE[currentUserRole] || [];
  nav.innerHTML = tabs.map(t =>
    `<button class="nav-tab-btn" data-tabid="${t.id}" onclick="setActiveTab('${t.id}')">${t.label}</button>`
  ).join('');
  if (tabs.length > 0) {
    currentActiveTab = tabs[0].id;
    window.setActiveTab(currentActiveTab);
  }
}

function applyRoleVisibility() {
  const role = currentUserRole || 'pending';
  const topbarSearch = document.getElementById('topbar-search-wrap');
  if (topbarSearch) {
    if (role === 'treasurer') topbarSearch.classList.remove('hidden');
    else topbarSearch.classList.add('hidden');
  }
  renderSidebar();
  if (role === 'subscriber') renderSubscriberPanel();
  if (role === 'girls_admin') renderGirlsAdminPanel();
  if (role === 'chele_admin') renderBoysAdminPanel();
}

window.toggleMobileSidebar = () => {
  const sb = document.getElementById('sidebar');
  if (sb) sb.classList.toggle('open');
};

let _shareCache = null;
let _shareCacheKey = "";
let _recomputeTimer = null;

function invalidateShareCache() { _shareCache = null; _shareCacheKey = ""; }

function _computeShareCache() {
  const cacheKey = students.length + "|" + expensesData.length + "|" + donationsData.length;
  if (_shareCache && _shareCacheKey === cacheKey) return _shareCache;
  const donationEvents = donationsData.map(d => ({ type: 'donation', amount: d.amount || 0, time: tsToDate(d.addedAt) || new Date(0) }));
  const expenseEvents = expensesData.filter(e => e.chargeType !== 'individual').map(e => ({ type: 'expense', id: e.id, amount: e.amount || 0, time: tsToDate(e.addedAt) || new Date(0) }));
  const events = [...donationEvents, ...expenseEvents].sort((a, b) => a.time - b.time);
  let pool = 0;
  const netCostById = {};
  events.forEach(ev => {
    if (ev.type === 'donation') { pool += ev.amount; return; }
    const offset = Math.min(pool, ev.amount);
    pool -= offset;
    netCostById[ev.id] = ev.amount - offset;
  });
  const shares = {};
  students.forEach(student => {
    const joinTime = tsToDate(student.addedAt);
    let share = 0;
    expensesData.filter(e => e.chargeType !== 'individual').forEach(e => {
      const eTime = tsToDate(e.addedAt) || new Date(0);
      if (joinTime && eTime < joinTime) return;
      const net = netCostById[e.id] || 0;
      if (net <= 0) return;
      const count = eligibleStudentsAt(eTime).length || 1;
      share += net / count;
    });
    shares[student.roll] = share;
  });
  _shareCache = shares;
  _shareCacheKey = cacheKey;
  return shares;
}

function scheduleRecompute() {
  if (_recomputeTimer) clearTimeout(_recomputeTimer);
  _recomputeTimer = setTimeout(() => {
    _recomputeTimer = null;
    recomputeCollections();
  }, 300);
}

let listenersStarted = false;
let activeUnsubscribes = [];

function startListeners() {
  if (listenersStarted) return;
  listenersStarted = true;
  activeUnsubscribes = [];
  const isTreasurer  = currentUserRole === 'treasurer';
  const isGirlsAdmin = currentUserRole === 'girls_admin';
  const isBoysAdmin  = currentUserRole === 'chele_admin';
  const isSubscriber = currentUserRole === 'subscriber';
  const isAdmin      = isTreasurer || isGirlsAdmin || isBoysAdmin;

  activeUnsubscribes.push(onSnapshot(doc(db, "settings", "orderConfig"), (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      orderConfig = {
        cutoffHour: typeof data.cutoffHour === 'number' ? data.cutoffHour : orderConfig.cutoffHour,
        windowStartHour: typeof data.windowStartHour === 'number' ? data.windowStartHour : orderConfig.windowStartHour,
        windowEndHour: typeof data.windowEndHour === 'number' ? data.windowEndHour : orderConfig.windowEndHour,
        discountPercent: typeof data.discountPercent === 'number' ? data.discountPercent : orderConfig.discountPercent
      };
    }
    renderOrderTimingSettingsForm();
    if (isSubscriber) renderSheetCatalogSubscriber();
    if (isGirlsAdmin) renderGirlsAdminSheetCatalog();
    if (isBoysAdmin)  renderBoysAdminSheetCatalog();
  }, (err) => { console.error("orderConfig listen error:", err); }));

  if (isTreasurer) {
    activeUnsubscribes.push(onSnapshot(collection(db, "batchCounters"), (snap) => {
      batchCountersData = {};
      snap.forEach(d => batchCountersData[d.id] = d.data());
      renderSheetOrdersTreasurer();
    }, (err) => { console.error("batchCounters error:", err); }));
  }

  if (isAdmin) {
    activeUnsubscribes.push(onSnapshot(query(collection(db, "students"), orderBy("roll")), (snap) => {
      students = [];
      snap.forEach(d => students.push({ id: d.id, ...d.data() }));
      invalidateShareCache();
      renderStudentRows();
      renderNewUserRollOptions();
      scheduleRecompute();
      renderExpenses();
      renderSummary();
      if (isGirlsAdmin) renderGirlsAdminPanel();
      if (isBoysAdmin)  renderBoysAdminPanel();
    }, (err) => { console.error("students error:", err); }));
  } else if (isSubscriber) {
    activeUnsubscribes.push(onSnapshot(doc(db, "students", String(currentSubscriberRoll)), (snap) => {
      students = snap.exists() ? [{ id: snap.id, ...snap.data() }] : [];
      invalidateShareCache();
      scheduleRecompute();
    }, (err) => { console.error("student single error:", err); }));
  }

  if (isTreasurer) {
    activeUnsubscribes.push(onSnapshot(collection(db, "users"), (snap) => {
      usersData = [];
      snap.forEach(d => usersData.push({ id: d.id, ...d.data() }));
      renderUsersList();
    }, (err) => { console.error("users error:", err); }));
  }

  if (isAdmin) {
    activeUnsubscribes.push(onSnapshot(collection(db, "collections"), (snap) => {
      legacyCollectionsData = {};
      snap.forEach(d => legacyCollectionsData[d.id] = d.data());
      scheduleRecompute();
    }, (err) => { console.error("collections error:", err); }));
  } else if (isSubscriber) {
    activeUnsubscribes.push(onSnapshot(doc(db, "collections", String(currentSubscriberRoll)), (snap) => {
      legacyCollectionsData = {};
      if (snap.exists()) legacyCollectionsData[snap.id] = snap.data();
      scheduleRecompute();
    }, (err) => { console.error("single collection error:", err); }));
  }

  if (isSubscriber) {
    activeUnsubscribes.push(onSnapshot(
      query(collection(db, "payments"), where("roll", "==", currentSubscriberRoll)),
      (snap) => {
        paymentsData = {};
        snap.forEach(d => {
          const data = d.data();
          const key = String(data.roll);
          if (!paymentsData[key]) paymentsData[key] = [];
          paymentsData[key].push({ id: d.id, ...data });
        });
        scheduleRecompute();
      },
      (err) => { console.error("payments (subscriber) error:", err); }
    ));
  } else if (isAdmin) {
    activeUnsubscribes.push(onSnapshot(query(collection(db, "payments"), orderBy("addedAt", "desc")), (snap) => {
      paymentsData = {};
      snap.forEach(d => {
        const data = d.data();
        const key = String(data.roll);
        if (!paymentsData[key]) paymentsData[key] = [];
        paymentsData[key].push({ id: d.id, ...data });
      });
      scheduleRecompute();
    }, (err) => { console.error("payments (admin) error:", err); }));
  }

  if (isAdmin) {
    activeUnsubscribes.push(onSnapshot(query(collection(db, "donations"), orderBy("addedAt", "desc")), (snap) => {
      donationsData = [];
      snap.forEach(d => donationsData.push({ id: d.id, ...d.data() }));
      invalidateShareCache();
      renderStudents();
      renderSummary();
    }, (err) => { console.error("donations error:", err); }));
  }

  if (isAdmin) {
    activeUnsubscribes.push(onSnapshot(query(collection(db, "expenses"), orderBy("addedAt", "desc")), (snap) => {
      expensesData = [];
      snap.forEach(d => expensesData.push({ id: d.id, ...d.data() }));
      invalidateShareCache();
      renderExpenses();
      renderStudents();
      renderSummary();
    }, (err) => { console.error("expenses (admin) error:", err); }));
  } else if (isSubscriber) {
    activeUnsubscribes.push(onSnapshot(query(collection(db, "expenses"), orderBy("addedAt", "desc")), (snap) => {
      expensesData = [];
      snap.forEach(d => expensesData.push({ id: d.id, ...d.data() }));
      invalidateShareCache();
      renderSubscriberPanel();
    }, (err) => { console.error("expenses (subscriber) error:", err); }));
  }

  activeUnsubscribes.push(onSnapshot(collection(db, "sheets"), (snap) => {
    sheetsData = [];
    snap.forEach(d => sheetsData.push({ id: d.id, ...d.data() }));
    sheetsData.sort((a, b) => (tsToDate(b.addedAt) || 0) - (tsToDate(a.addedAt) || 0));
    if (isTreasurer)  renderSheetCatalogTreasurer();
    if (isSubscriber) renderSheetCatalogSubscriber();
    if (isGirlsAdmin) renderGirlsAdminSheetCatalog();
    if (isBoysAdmin)  renderBoysAdminSheetCatalog();
  }, (err) => { console.error("sheets error:", err); }));

  if (isSubscriber) {
    activeUnsubscribes.push(onSnapshot(
      query(collection(db, "sheetOrders"), where("roll", "==", currentSubscriberRoll)),
      (snap) => {
        sheetOrdersData = [];
        snap.forEach(d => sheetOrdersData.push({ id: d.id, ...d.data() }));
        sheetOrdersData.sort((a, b) => (tsToDate(b.orderedAt) || 0) - (tsToDate(a.orderedAt) || 0));
        invalidateShareCache();
        renderSheetCatalogSubscriber();
        renderMySheetOrders();
        renderSubscriberPanel();
      },
      (err) => { console.error("sheetOrders (subscriber) error:", err); }
    ));
  } else if (isAdmin) {
    activeUnsubscribes.push(onSnapshot(collection(db, "sheetOrders"), (snap) => {
      sheetOrdersData = [];
      snap.forEach(d => sheetOrdersData.push({ id: d.id, ...d.data() }));
      sheetOrdersData.sort((a, b) => (tsToDate(b.orderedAt) || 0) - (tsToDate(a.orderedAt) || 0));
      invalidateShareCache();
      if (isTreasurer)  renderSheetOrdersTreasurer();
      if (isGirlsAdmin) renderGirlsAdminPanel();
      if (isBoysAdmin)  renderBoysAdminPanel();
      renderStudents();
      renderSummary();
    }, (err) => { console.error("sheetOrders (admin) error:", err); }));
  }
}

function stopListeners() {
  activeUnsubscribes.forEach(unsub => { try { unsub(); } catch (_) {} });
  activeUnsubscribes = [];
  listenersStarted = false;
  if (_recomputeTimer) { clearTimeout(_recomputeTimer); _recomputeTimer = null; }
  invalidateShareCache();
}

function recomputeCollections() {
  collectionsData = {};
  const rolls = new Set([...Object.keys(legacyCollectionsData), ...Object.keys(paymentsData)]);
  rolls.forEach(roll => {
    const legacy = legacyCollectionsData[roll];
    const pays = paymentsData[roll] || [];
    const legacyAmt = legacy ? (legacy.amount || 0) : 0;
    const paysAmt = pays.reduce((a, p) => a + (p.amount || 0), 0);
    let latestBy = legacy ? legacy.updatedBy : null;
    let latestAt = legacy ? legacy.updatedAt : null;
    pays.forEach(p => {
      const pTime = p.addedAt && p.addedAt.toDate ? p.addedAt.toDate() : null;
      const latestTime = latestAt && latestAt.toDate ? latestAt.toDate() : null;
      if (pTime && (!latestTime || pTime > latestTime)) { latestAt = p.addedAt; latestBy = p.addedBy; }
    });
    collectionsData[roll] = { amount: legacyAmt + paysAmt, updatedBy: latestBy, updatedAt: latestAt, paymentCount: pays.length };
  });
  invalidateShareCache();
  renderStudents();
  renderSummary();
  if (currentUserRole === 'girls_admin') renderGirlsAdminPanel();
  if (currentUserRole === 'chele_admin') renderBoysAdminPanel();
  if (currentUserRole === 'subscriber') renderSubscriberPanel();
}

function getEqualShareForStudent(roll) {
  const shares = _computeShareCache();
  return shares[roll] || 0;
}

function getPersonalCharge(roll) {
  const individualExpenses = expensesData
    .filter(e => e.chargeType === 'individual' && e.targetRoll === roll)
    .reduce((a, e) => a + (e.amount || 0), 0);
  const sheetCharges = sheetOrdersData
    .filter(o => o.roll === roll)
    .reduce((a, o) => a + (o.price || 0), 0);
  return individualExpenses + sheetCharges;
}

// ⭐⭐⭐ FIXED: Current Balance = Total Deposited − Total Spent
// Total Spent = Equal Share + Personal Charges
// This is the SAME calculation shown on subscriber dashboard
function getSubscriberRemaining(roll) {
  const rec = collectionsData[roll];
  const totalDeposited = rec ? (rec.amount || 0) : 0;
  const equalShare = getEqualShareForStudent(roll);
  const personalCharge = getPersonalCharge(roll);
  const totalSpent = equalShare + personalCharge;
  return totalDeposited - totalSpent;
}

// ⭐ Block if Current Balance < -20
function isOrderBlockedByDue(roll) {
  return getSubscriberRemaining(roll) < -DUE_ORDER_BLOCK_LIMIT;
}

function getGenderTotals(gender) {
  const list = students.filter(s => s.gender === gender);
  const totalCollected = list.reduce((a, s) => a + ((collectionsData[s.roll] || {}).amount || 0), 0);
  const totalBalance = list.reduce((a, s) => a + getSubscriberRemaining(s.roll), 0);
  return { count: list.length, totalCollected, totalBalance };
}

window.addStudent = async () => {
  const name = document.getElementById('new-student-name').value.trim();
  const roll = parseInt(document.getElementById('new-student-roll').value);
  const mobile = document.getElementById('new-student-mobile').value.trim();
  const gender = document.getElementById('new-student-gender').value;
  if (!name || !roll) { alert("Please enter both name and roll number."); return; }
  await setDoc(doc(db, "students", roll.toString()), {
    name, roll, mobile: mobile || "", gender, addedBy: currentTreasurerName, addedAt: serverTimestamp()
  });
  document.getElementById('new-student-name').value = "";
  document.getElementById('new-student-roll').value = "";
  document.getElementById('new-student-mobile').value = "";
};

window.updateStudentGender = async (roll, gender) => {
  try { await updateDoc(doc(db, "students", roll.toString()), { gender }); }
  catch (e) { alert("জেন্ডার আপডেট করা যায়নি। কারণ: " + (e && e.message ? e.message : e)); }
};

window.deleteStudent = async (roll) => {
  if (!confirm("Remove this subscriber?")) return;
  await deleteDoc(doc(db, "students", roll.toString()));
  try { await deleteDoc(doc(db, "collections", roll.toString())); } catch (e) {}
  try {
    const paySnap = await getDocs(query(collection(db, "payments"), where("roll", "==", roll)));
    await Promise.all(paySnap.docs.map(d => deleteDoc(d.ref)));
  } catch (e) {}
};

window.addPayment = async (roll) => {
  const input = document.getElementById(`pay-${roll}`);
  const amt = parseFloat(input ? input.value : "");
  if (!amt || amt <= 0) { alert("সঠিক পরিমাণ লিখুন।"); return; }
  const student = students.find(s => s.roll === roll);
  try {
    await addDoc(collection(db, "payments"), { roll, amount: amt, addedBy: currentTreasurerName, addedAt: serverTimestamp() });
    await addDoc(collection(db, "activity"), {
      type: "payment", actor: currentTreasurerName,
      detail: `${student ? student.name : 'Roll ' + roll} (Roll ${roll}) থেকে ৳${amt.toFixed(2)} জমা`,
      amount: amt, createdAt: serverTimestamp()
    });
    if (input) input.value = "";
  } catch (e) {
    console.error("Add payment error:", e);
    alert("Payment add failed: " + (e && e.message ? e.message : e));
  }
};

function renderStudentRows() {
  const tbody = document.getElementById('student-body');
  if (!tbody) return;
  if (!students.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="activity-meta">No subscribers added yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = students.map(s => `
    <tr data-name="${escapeHtml((s.name || '').toLowerCase())}" data-roll="${s.roll}">
      <td class="num">${s.roll}</td>
      <td>${escapeHtml(s.name || '')}</td>
      <td class="activity-meta">${escapeHtml(s.mobile || '—')}</td>
      <td>
        <select onchange="updateStudentGender(${s.roll}, this.value)" class="modern-select" style="min-width:100px;padding:6px 10px;font-size:.8rem;">
          <option value="male" ${s.gender === 'female' ? '' : 'selected'}>ছেলে</option>
          <option value="female" ${s.gender === 'female' ? 'selected' : ''}>মেয়ে</option>
        </select>
      </td>
      <td class="num" id="total-${s.roll}">৳0</td>
      <td>
        <div style="display:flex;gap:6px;align-items:center;">
          <input type="number" class="coll-input" id="pay-${s.roll}" placeholder="৳" onkeydown="if(event.key==='Enter'){addPayment(${s.roll});}">
          <button class="btn btn-outline btn-sm" onclick="addPayment(${s.roll})">+ Add</button>
        </div>
      </td>
      <td class="num" id="rem-${s.roll}">৳0</td>
      <td class="activity-meta" id="upd-${s.roll}">—</td>
      <td><button class="icon-btn" onclick="deleteStudent(${s.roll})">✕</button></td>
    </tr>
  `).join('');
}

function renderStudents() {
  students.forEach(s => {
    const equalShare = getEqualShareForStudent(s.roll);
    const rec = collectionsData[s.roll];
    const amount = rec ? (rec.amount || 0) : 0;
    const personalCharge = getPersonalCharge(s.roll);
    const totalSpent = equalShare + personalCharge;
    const remaining = amount - totalSpent;
    const totalEl = document.getElementById(`total-${s.roll}`);
    if (totalEl) totalEl.textContent = "৳" + amount.toFixed(2);
    const remEl = document.getElementById(`rem-${s.roll}`);
    if (remEl) {
      remEl.textContent = (remaining >= 0 ? "৳" : "-৳") + Math.abs(remaining).toFixed(2);
      remEl.className = "num " + (remaining >= 0 ? "balance-pos" : "balance-neg");
      remEl.title = `জমা ৳${amount.toFixed(2)} − খরচ ৳${totalSpent.toFixed(2)}`;
    }
    const updEl = document.getElementById(`upd-${s.roll}`);
    if (updEl) {
      let txt = "—";
      if (rec && rec.updatedBy) {
        const t = rec.updatedAt && rec.updatedAt.toDate ? rec.updatedAt.toDate().toLocaleDateString('en-US') : "";
        const cnt = rec.paymentCount ? ` (${rec.paymentCount})` : "";
        txt = `${rec.updatedBy} ${t ? "· " + t : ""}${cnt}`;
      }
      updEl.textContent = txt;
    }
  });
  if (currentUserRole === 'subscriber') renderSubscriberPanel();
}

function renderSubscriberPanel() {
  if (currentUserRole !== 'subscriber' || !currentSubscriberRoll) return;
  const roll = currentSubscriberRoll;
  const student = students.find(s => s.roll === roll);
  const equalShare = getEqualShareForStudent(roll);
  const rec = collectionsData[roll];
  const amount = rec ? (rec.amount || 0) : 0;
  const personalCharge = getPersonalCharge(roll);
  const totalSpent = equalShare + personalCharge;
  const remaining = amount - totalSpent;

  const warnEl = document.getElementById('subscriber-due-warning');
  const warnText = document.getElementById('subscriber-due-warning-text');
  if (warnEl && warnText) {
    if (isOrderBlockedByDue(roll)) {
      warnEl.classList.remove('hidden');
      warnText.innerHTML = ` আপনার বর্তমান ব্যালেন্স <strong>−৳${Math.abs(remaining).toFixed(2)}</strong> — যা সীমা ৳${DUE_ORDER_BLOCK_LIMIT} টাকার বেশি বাকি। নতুন শিট অর্ডার করতে Treasurer-এর কাছে টাকা জমা দিন।`;
    } else warnEl.classList.add('hidden');
  }

  const greetingEl = document.getElementById('subscriber-greeting-name');
  if (greetingEl) greetingEl.textContent = student ? student.name : `Roll ${roll}`;
  const subEl = document.getElementById('subscriber-account-sub');
  if (subEl) subEl.textContent = student ? `Roll ${student.roll}${student.mobile ? ' · ' + student.mobile : ''}` : `Roll ${roll}`;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('sub-total-collected', "৳" + amount.toFixed(2));
  set('sub-total-expense', "৳" + totalSpent.toFixed(2));
  const dueEl = document.getElementById('sub-due-credit');
  if (dueEl) {
    dueEl.textContent = (remaining >= 0 ? "৳" : "-৳") + Math.abs(remaining).toFixed(2);
    dueEl.style.color = remaining >= 0 ? 'var(--success)' : 'var(--danger)';
  }

  const pays = (paymentsData[roll] || []).slice().sort((a, b) => {
    const ta = a.addedAt && a.addedAt.toDate ? a.addedAt.toDate() : 0;
    const tb = b.addedAt && b.addedAt.toDate ? b.addedAt.toDate() : 0;
    return tb - ta;
  });
  const hb = document.getElementById('sub-payment-history');
  if (hb) {
    hb.innerHTML = pays.map(p => {
      const t = p.addedAt && p.addedAt.toDate ? p.addedAt.toDate().toLocaleDateString('en-US') : "...";
      return `<tr><td class="activity-meta">${t}</td><td class="num">৳${(p.amount || 0).toFixed(2)}</td><td class="activity-meta">${escapeHtml(p.addedBy || "")}</td></tr>`;
    }).join('') || `<tr><td colspan="3" class="activity-meta">এখনো কোনো জমা রেকর্ড করা হয়নি।</td></tr>`;
  }
  renderSubscriberExpenseBreakdown();
}

function renderSubscriberExpenseBreakdown() {
  const tbody = document.getElementById('sub-expense-breakdown');
  if (!tbody || currentUserRole !== 'subscriber' || !currentSubscriberRoll) return;
  const roll = currentSubscriberRoll;
  const student = students.find(s => s.roll === roll);
  const joinTime = student ? tsToDate(student.addedAt) : null;
  const donationEvents = donationsData.map(d => ({ type: 'donation', amount: d.amount || 0, time: tsToDate(d.addedAt) || new Date(0) }));
  const expenseEvents = expensesData.filter(e => e.chargeType !== 'individual').map(e => ({ type: 'expense', id: e.id, amount: e.amount || 0, time: tsToDate(e.addedAt) || new Date(0) }));
  const events = [...donationEvents, ...expenseEvents].sort((a, b) => a.time - b.time);
  let pool = 0;
  const netCostById = {};
  events.forEach(ev => {
    if (ev.type === 'donation') { pool += ev.amount; return; }
    const offset = Math.min(pool, ev.amount);
    pool -= offset;
    netCostById[ev.id] = ev.amount - offset;
  });
  const rows = [];
  expensesData.filter(e => e.chargeType !== 'individual').forEach(e => {
    const eTime = tsToDate(e.addedAt) || new Date(0);
    if (joinTime && eTime < joinTime) return;
    const net = netCostById[e.id] || 0;
    if (net <= 0) return;
    const count = eligibleStudentsAt(eTime).length || 1;
    rows.push({ time: eTime, purpose: e.description, tag: 'সবার সমান ভাগে', amount: net / count });
  });
  expensesData.filter(e => e.chargeType === 'individual' && e.targetRoll === roll).forEach(e => {
    rows.push({ time: tsToDate(e.addedAt) || new Date(0), purpose: e.description, tag: 'ব্যক্তিগত খরচ', amount: e.amount || 0 });
  });
  sheetOrdersData.filter(o => o.roll === roll).forEach(o => {
    rows.push({ time: tsToDate(o.orderedAt) || new Date(0), purpose: `শিট: ${o.sheetTitle}`, tag: 'লেকচার শিট', amount: o.price || 0 });
  });
  rows.sort((a, b) => b.time - a.time);
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td class="activity-meta">${r.time.toLocaleDateString('en-US')}</td>
      <td>${escapeHtml(r.purpose || '—')} <span class="activity-meta">(${r.tag})</span></td>
      <td class="num balance-neg">৳${r.amount.toFixed(2)}</td>
    </tr>
  `).join('') || `<tr><td colspan="3" class="activity-meta">এখনো আপনার হিসাব থেকে কোনো খরচ কাটা হয়নি।</td></tr>`;
}

function renderSummary() {
  const totalCollection = students.reduce((a, s) => a + ((collectionsData[s.roll] || {}).amount || 0), 0);
  const totalDonation = donationsData.reduce((a, d) => a + (d.amount || 0), 0);
  const totalSheetCharges = sheetOrdersData.reduce((a, o) => a + (o.price || 0), 0);
  const totalExpense = expensesData.reduce((a, e) => a + (e.amount || 0), 0) + totalSheetCharges;
  const totalEarning = totalCollection + totalDonation;
  const balance = totalEarning - totalExpense;
  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setTxt('sum-earning', "৳" + totalEarning.toFixed(2));
  setTxt('sum-collection', "৳" + totalCollection.toFixed(2));
  setTxt('sum-expense', "৳" + totalExpense.toFixed(2));
  setTxt('sum-balance', "৳" + balance.toFixed(2));
  const pending = sheetOrdersData.filter(o => o.printed && !o.received).length;
  setTxt('dashboard-pending-receive-count', String(pending));
  const boys = getGenderTotals('male');
  const girls = getGenderTotals('female');
  setTxt('boys-count-admin', boys.count);
  setTxt('boys-collected-admin', "৳" + boys.totalCollected.toFixed(2));
  setBalance('boys-balance-admin', boys.totalBalance);
  setTxt('girls-count-admin', girls.count);
  setTxt('girls-collected-admin', "৳" + girls.totalCollected.toFixed(2));
  setBalance('girls-balance-admin', girls.totalBalance);
}

function setBalance(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = (val >= 0 ? "৳" : "-৳") + Math.abs(val).toFixed(2);
  el.style.color = val >= 0 ? 'var(--success)' : 'var(--danger)';
}

function renderExpenses() {
  const el = document.getElementById('expense-list');
  if (!el) return;
  el.innerHTML = expensesData.map(e => {
    let chargedTo;
    if (e.chargeType === 'individual') {
      chargedTo = `${escapeHtml(e.targetName || 'Roll ' + e.targetRoll)} <span class="activity-meta">(ব্যক্তিগত)</span>`;
    } else chargedTo = `সবার সমান ভাগে`;
    return `<tr>
      <td class="activity-meta">${escapeHtml(e.date || "")}</td>
      <td>${escapeHtml(e.description || '')}</td>
      <td class="num">৳${(e.amount || 0).toFixed(2)}</td>
      <td>${chargedTo}</td>
      <td class="activity-meta">${escapeHtml(e.addedBy || "")}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="5" class="activity-meta">No expenses added yet.</td></tr>`;
}

window.filterExpenseSubscriberList = (q) => {
  const dd = document.getElementById('expense-subscriber-dropdown');
  if (!dd) return;
  const query = (q || '').trim().toLowerCase();
  let matches;
  if (!query) matches = students.slice(0, 30);
  else {
    matches = students.filter(s => {
      const name = (s.name || '').toLowerCase();
      const roll = String(s.roll);
      return name.includes(query) || roll.includes(query);
    });
  }
  if (!matches.length) {
    dd.innerHTML = `<div class="subscriber-dropdown-empty">🔍 No subscriber found</div>`;
    dd.classList.remove('hidden');
    return;
  }
  dd.innerHTML = matches.slice(0, 30).map(s => `
    <div class="subscriber-option" onclick="selectExpenseTarget(${s.roll})">
      <span class="so-name">${escapeHtml(s.name || '')}</span>
      <span class="so-roll">Roll ${s.roll}</span>
    </div>
  `).join('');
  dd.classList.remove('hidden');
};

window.selectExpenseTarget = (roll) => {
  const s = students.find(x => x.roll === roll);
  if (!s) return;
  expenseSelectedRoll = roll;
  const chip = document.getElementById('expense-selected-chip');
  const emptyEl = document.getElementById('expense-selected-empty');
  const nameEl = document.getElementById('expense-selected-name');
  if (nameEl) nameEl.textContent = `${s.name} (Roll ${s.roll})`;
  if (chip) chip.classList.remove('hidden');
  if (emptyEl) emptyEl.classList.add('hidden');
  const searchEl = document.getElementById('expense-subscriber-search');
  if (searchEl) searchEl.value = '';
  const dd = document.getElementById('expense-subscriber-dropdown');
  if (dd) { dd.classList.add('hidden'); dd.innerHTML = ''; }
};

window.clearExpenseTarget = () => {
  expenseSelectedRoll = null;
  const chip = document.getElementById('expense-selected-chip');
  const emptyEl = document.getElementById('expense-selected-empty');
  if (chip) chip.classList.add('hidden');
  if (emptyEl) emptyEl.classList.remove('hidden');
};

document.addEventListener('click', (ev) => {
  const dd = document.getElementById('expense-subscriber-dropdown');
  if (!dd) return;
  const wrap = ev.target.closest('.field');
  if (!wrap || !wrap.querySelector('#expense-subscriber-search')) dd.classList.add('hidden');
});

window.saveExpense = async () => {
  const desc = document.getElementById('expense-desc').value.trim();
  const amount = parseFloat(document.getElementById('expense-amount').value);
  if (!desc || !amount || amount <= 0) { alert("Please enter a description and a valid amount."); return; }
  if (!expenseSelectedRoll) { alert("Please select a subscriber to charge."); return; }
  const student = students.find(s => s.roll === expenseSelectedRoll);
  if (!student) { alert("Subscriber not found."); return; }
  const date = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  try {
    await addDoc(collection(db, "expenses"), {
      description: desc, amount, date,
      addedBy: currentTreasurerName, addedAt: serverTimestamp(),
      chargeType: 'individual', targetRoll: student.roll, targetName: student.name
    });
    await addDoc(collection(db, "activity"), {
      type: "expense", actor: currentTreasurerName,
      detail: `৳${amount.toFixed(2)} "${desc}" — ${student.name} (Roll ${student.roll}) এর হিসাব থেকে`,
      amount, createdAt: serverTimestamp()
    });
    document.getElementById('expense-desc').value = "";
    document.getElementById('expense-amount').value = "";
    window.clearExpenseTarget();
  } catch (e) { alert("Could not save charge: " + (e && e.message ? e.message : e)); }
};

function getGroupedSheets(list) {
  const FALLBACK = 'General';
  const groups = {};
  const subjects = [];
  list.forEach(s => {
    const subject = (s.subject && String(s.subject).trim()) || FALLBACK;
    if (!groups[subject]) { groups[subject] = []; subjects.push(subject); }
    groups[subject].push(s);
  });
  subjects.sort((a, b) => {
    if (a === FALLBACK) return 1;
    if (b === FALLBACK) return -1;
    return a.localeCompare(b, 'bn');
  });
  subjects.forEach(subject => {
    groups[subject].sort((a, b) => {
      const ca = (a.cardNo !== null && a.cardNo !== undefined && a.cardNo !== '') ? Number(a.cardNo) : Infinity;
      const cb = (b.cardNo !== null && b.cardNo !== undefined && b.cardNo !== '') ? Number(b.cardNo) : Infinity;
      if (ca !== cb) return ca - cb;
      return (a.title || '').localeCompare(b.title || '', 'bn');
    });
  });
  return subjects.map(subject => ({ subject, sheets: groups[subject] }));
}

function renderSheetCatalogTreasurer() {
  const tbody = document.getElementById('sheet-catalog-body');
  if (!tbody) return;
  const grouped = getGroupedSheets(sheetsData);
  tbody.innerHTML = grouped.map(g => g.sheets.map(s => `
    <tr>
      <td class="activity-meta">${escapeHtml(g.subject)}</td>
      <td class="num">${(s.cardNo !== null && s.cardNo !== undefined && s.cardNo !== '') ? s.cardNo : '—'}</td>
      <td>${escapeHtml(s.title || '')}</td>
      <td class="activity-meta">${s.pages ? s.pages + ' · ' + sheetBreakdownLabel(s.pages) : '—'}</td>
      <td class="num">৳${(s.price || 0).toFixed(2)}</td>
      <td class="activity-meta">${escapeHtml(s.addedBy || '')}</td>
      <td>
        <button class="icon-btn edit" onclick="editSheet('${s.id}')">✎</button>
        <button class="icon-btn" onclick="deleteSheet('${s.id}')">✕</button>
      </td>
    </tr>
  `).join('')).join('') || `<tr><td colspan="7" class="activity-meta">No sheets added yet.</td></tr>`;
}

function renderSheetCatalogSubscriber() {
  const box = document.getElementById('sheet-select-list');
  if (!box || currentUserRole !== 'subscriber') return;
  const myOrderedIds = new Set(sheetOrdersData.filter(o => o.roll === currentSubscriberRoll).map(o => o.sheetId));
  const windowOpen = isWithinOrderWindow();
  const dueBlocked = isOrderBlockedByDue(currentSubscriberRoll);
  const canOrder = windowOpen && !dueBlocked;
  const notice = document.getElementById('order-window-notice');
  if (notice) {
    if (dueBlocked) {
      const currentBal = getSubscriberRemaining(currentSubscriberRoll);
      const needToDeposit = (currentBal + DUE_ORDER_BLOCK_LIMIT).toFixed(2);
      notice.classList.remove('hidden');
      notice.style.background = 'var(--danger-soft)';
      notice.style.color = '#991B1B';
      notice.style.borderColor = '#FECACA';
      notice.innerHTML = `⛔ আপনার বর্তমান ব্যালেন্স <strong>−৳${Math.abs(currentBal).toFixed(2)}</strong> — সীমা ৳${DUE_ORDER_BLOCK_LIMIT} টাকার বেশি বাকি। কমপক্ষে <strong>৳${needToDeposit}</strong> জমা দিয়ে ব্যালেন্স −৳${DUE_ORDER_BLOCK_LIMIT} এর উপরে আনতে হবে।`;
    } else {
      notice.style.background = '';
      notice.style.color = '';
      notice.style.borderColor = '';
      notice.classList.toggle('hidden', windowOpen);
      if (!windowOpen) notice.textContent = '⏰ ' + orderWindowMessage();
    }
  }
  const confirmBtn = document.getElementById('confirm-sheet-order-btn');
  if (confirmBtn) confirmBtn.disabled = !canOrder;
  if (!sheetsData.length) {
    box.innerHTML = `<div class="product-empty">📄 এখনো কোনো লেকচার শিট যোগ করা হয়নি।</div>`;
    updateSheetOrderSummary();
    return;
  }
  const searchInput = document.getElementById('sheet-search-input');
  const q = (searchInput ? searchInput.value : '').trim().toLowerCase();
  const filtered = q ? sheetsData.filter(s => (s.title || '').toLowerCase().includes(q)) : sheetsData;
  if (!filtered.length) {
    box.innerHTML = `<div class="product-empty">🔍 "${escapeHtml(q)}" নামে কোনো শিট পাওয়া যায়নি।</div>`;
    updateSheetOrderSummary();
    return;
  }
  const grouped = getGroupedSheets(filtered);
  box.innerHTML = grouped.map(g => `
    <div class="subject-section">
      <div class="subject-heading">${escapeHtml(g.subject)} <span class="subject-count">${g.sheets.length}টি</span></div>
      <div class="product-grid">
        ${g.sheets.map(s => {
          const ordered = myOrderedIds.has(s.id);
          const disabled = ordered || !canOrder;
          const classes = ['product-card'];
          if (ordered) classes.push('ordered');
          else if (!canOrder) classes.push('locked');
          const hasCardNo = s.cardNo !== null && s.cardNo !== undefined && s.cardNo !== '';
          const dPrice = discountedPrice(s.price || 0);
          const hasDiscount = dPrice < (s.price || 0) - 0.001;
          return `
            <label class="${classes.join(' ')}">
              ${hasDiscount ? `<span class="discount-ribbon">${orderConfig.discountPercent}% OFF</span>` : ''}
              <input type="checkbox" class="sheet-check" value="${s.id}" ${ordered ? 'checked' : ''} ${disabled ? 'disabled' : ''} onchange="onSheetCheckChange(this)">
              <span class="product-subject">${escapeHtml(g.subject)}${hasCardNo ? ' · Card #' + s.cardNo : ''}</span>
              <span class="product-title">${escapeHtml(s.title || '')}</span>
              ${s.pages ? `<span class="product-meta"><span>📄 ${s.pages} pages</span><span>${sheetBreakdownLabel(s.pages)}</span></span>` : ''}
              <span class="product-price-row num">
                ${hasDiscount ? `<span class="product-price-old">৳${(s.price || 0).toFixed(2)}</span>` : ''}
                <span class="product-price-new">৳${dPrice.toFixed(2)}</span>
              </span>
              ${ordered ? '<span class="product-badge">✓ Ordered</span>' : ''}
            </label>`;
        }).join('')}
      </div>
    </div>
  `).join('');
  box.querySelectorAll('.sheet-check:checked').forEach(cb => cb.closest('.product-card').classList.add('checked'));
  updateSheetOrderSummary();
}

window.onSheetCheckChange = (cb) => {
  cb.closest('.product-card').classList.toggle('checked', cb.checked);
  updateSheetOrderSummary();
};

function updateSheetOrderSummary() {
  const countEl = document.getElementById('sheet-selected-count');
  const totalEl = document.getElementById('sheet-selected-total');
  if (!countEl || !totalEl) return;
  const checkedIds = Array.from(document.querySelectorAll('.sheet-check:checked:not(:disabled)')).map(cb => cb.value);
  const chosen = sheetsData.filter(s => checkedIds.includes(s.id));
  const total = chosen.reduce((a, s) => a + discountedPrice(s.price || 0), 0);
  countEl.textContent = String(chosen.length);
  totalEl.textContent = '৳' + total.toFixed(2);
}

function renderMySheetOrders() {
  const tbody = document.getElementById('my-sheet-orders-body');
  if (!tbody || currentUserRole !== 'subscriber') return;
  const mine = sheetOrdersData.filter(o => o.roll === currentSubscriberRoll);
  tbody.innerHTML = mine.map(o => {
    const t = o.orderedAt && o.orderedAt.toDate ? o.orderedAt.toDate().toLocaleDateString('en-US') : '...';
    const batch = o.businessDate ? formatBusinessDateLabel(o.businessDate) : '—';
    let status;
    if (o.received) status = '<span style="color:var(--success);font-weight:600;">✓ Received</span>';
    else if (o.printed) status = `<button class="btn btn-outline btn-sm" onclick="markMyOrderReceived('${o.id}')">📥 Mark Received</button>`;
    else status = '<span class="activity-meta">Pending</span>';
    return `<tr><td class="activity-meta">${t}</td><td>${escapeHtml(o.sheetTitle || '')}</td><td class="num">৳${(o.price || 0).toFixed(2)}</td><td class="activity-meta">${batch}</td><td>${status}</td></tr>`;
  }).join('') || `<tr><td colspan="5" class="activity-meta">No orders yet.</td></tr>`;
}

window.markMyOrderReceived = async (orderId) => {
  const order = sheetOrdersData.find(o => o.id === orderId && o.roll === currentSubscriberRoll);
  if (!order || order.received) return;
  if (!confirm(`আপনি কি "${order.sheetTitle}" বুঝে পেয়েছেন?`)) return;
  const student = students.find(s => s.roll === currentSubscriberRoll);
  try {
    await updateDoc(doc(db, "sheetOrders", orderId), {
      received: true, receivedAt: serverTimestamp(),
      receivedBy: `${student ? student.name : 'Subscriber'} (self)`
    });
  } catch (e) { alert("Update failed: " + (e && e.message ? e.message : e)); }
};

window.confirmSheetOrders = async () => {
  if (currentUserRole !== 'subscriber' || !currentSubscriberRoll) return;
  if (!isWithinOrderWindow()) { alert('⏰ ' + orderWindowMessage()); return; }
  if (isOrderBlockedByDue(currentSubscriberRoll)) {
    const currentBal = getSubscriberRemaining(currentSubscriberRoll);
    const dueAmount = Math.abs(currentBal).toFixed(2);
    const needToDeposit = (currentBal + DUE_ORDER_BLOCK_LIMIT).toFixed(2);
    alert(`⛔ আপনার বর্তমান ব্যালেন্স −৳${dueAmount} — সীমা ৳${DUE_ORDER_BLOCK_LIMIT} টাকার বেশি বাকি।\n\nকমপক্ষে ৳${needToDeposit} জমা দিতে হবে। Treasurer-এর সাথে যোগাযোগ করুন।`);
    return;
  }
  const alreadyOrderedIds = new Set(sheetOrdersData.filter(o => o.roll === currentSubscriberRoll).map(o => o.sheetId));
  const checked = Array.from(document.querySelectorAll('.sheet-check:checked'))
    .map(cb => cb.value).filter(id => !alreadyOrderedIds.has(id));
  if (!checked.length) { alert("No new sheets selected."); return; }
  const chosenSheets = sheetsData.filter(s => checked.includes(s.id));
  const total = chosenSheets.reduce((a, s) => a + discountedPrice(s.price || 0), 0);
  const names = chosenSheets.map(s => s.title).join(', ');
  const businessDate = currentBusinessDateKey();
  if (!confirm(`Order ${chosenSheets.length} sheet(s)?\n\n${names}\n\nTotal: ৳${total.toFixed(2)} will be charged.`)) return;
  const user = auth.currentUser;
  const student = students.find(s => s.roll === currentSubscriberRoll);
  const batchSeq = currentBatchSeqFor(businessDate);
  try {
    await Promise.all(chosenSheets.map(s => addDoc(collection(db, "sheetOrders"), {
      roll: currentSubscriberRoll,
      studentName: student ? student.name : currentTreasurerName,
      gender: (student && student.gender) || 'unspecified',
      sheetId: s.id, sheetTitle: s.title,
      price: discountedPrice(s.price || 0),
      originalPrice: s.price || 0,
      orderedAt: serverTimestamp(),
      businessDate, batchSeq,
      printed: false, printedAt: null, printedBy: null,
      received: false, receivedAt: null, receivedBy: null,
      addedBy: currentTreasurerName,
      orderedByUid: user ? user.uid : null
    })));
  } catch (e) { alert("Order failed: " + (e && e.message ? e.message : e)); }
};

function getDistinctBatchKeys() {
  const set = new Set(sheetOrdersData.map(o => orderBatchKey(o)).filter(Boolean));
  return Array.from(set).sort((a, b) => {
    const pa = parseBatchKey(a), pb = parseBatchKey(b);
    if (pa.businessDate !== pb.businessDate) return pb.businessDate.localeCompare(pa.businessDate);
    return pb.seq - pa.seq;
  });
}
function orderStatusLabel(o) {
  return o.received
    ? '<span style="color:var(--success);font-weight:600;">✓ Received</span>'
    : (o.printed ? '<span style="color:var(--gold);font-weight:600;">Printed</span>' : '<span class="activity-meta">Pending</span>');
}
function orderRollTag(o) {
  return o.personal ? '(admin-personal)' : `(Roll ${o.roll})`;
}

function renderSheetOrdersTreasurer() {
  const detailBody = document.getElementById('sheet-orders-detail-body');
  const groupedBody = document.getElementById('sheet-orders-grouped-body');
  const dateSelect = document.getElementById('order-date-select');
  if (!detailBody || !groupedBody || !dateSelect) return;
  const batchKeys = getDistinctBatchKeys();
  const today = currentBusinessDateKey();
  const todayCurrentKey = `${today}#${currentBatchSeqFor(today)}`;
  if (!batchKeys.includes(todayCurrentKey)) batchKeys.unshift(todayCurrentKey);
  batchKeys.sort((a, b) => {
    const pa = parseBatchKey(a), pb = parseBatchKey(b);
    if (pa.businessDate !== pb.businessDate) return pb.businessDate.localeCompare(pa.businessDate);
    return pb.seq - pa.seq;
  });
  if (!currentOrderDateFilter || !batchKeys.includes(currentOrderDateFilter)) {
    currentOrderDateFilter = batchKeys.includes(todayCurrentKey) ? todayCurrentKey : batchKeys[0];
  }
  dateSelect.innerHTML = batchKeys.map(key => {
    const { businessDate: d, seq } = parseBatchKey(key);
    const count = sheetOrdersData.filter(o => orderBatchKey(o) === key).length;
    const isOpenBatch = key === `${d}#${currentBatchSeqFor(d)}`;
    const tag = `${d === today ? ' (Today)' : ''}${isOpenBatch ? ' (open)' : ' (printed)'}`;
    return `<option value="${key}">${formatBatchLabel(d, seq, tag)} — ${count}</option>`;
  }).join('');
  dateSelect.value = currentOrderDateFilter;
  const batchOrders = sheetOrdersData.filter(o => orderBatchKey(o) === currentOrderDateFilter);
  detailBody.innerHTML = batchOrders.map(o => {
    const t = o.orderedAt && o.orderedAt.toDate ? o.orderedAt.toDate().toLocaleString('en-US') : '...';
    const genderLabel = o.gender === 'female' ? 'মেয়ে' : (o.gender === 'male' ? 'ছেলে' : '—');
    return `<tr>
      <td class="activity-meta">${t}</td>
      <td>${escapeHtml(o.studentName || '—')} <span class="activity-meta">${orderRollTag(o)}</span></td>
      <td class="activity-meta">${genderLabel}</td>
      <td>${escapeHtml(o.sheetTitle || '')}</td>
      <td class="num">৳${(o.price || 0).toFixed(2)}</td>
      <td>${orderStatusLabel(o)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="6" class="activity-meta">No orders in this batch.</td></tr>`;
  const groups = {};
  batchOrders.forEach(o => {
    const key = o.sheetId || o.sheetTitle;
    if (!groups[key]) groups[key] = { title: o.sheetTitle, names: [], total: 0 };
    groups[key].names.push(`${o.studentName || 'Unknown'} ${orderRollTag(o)}`);
    groups[key].total += (o.price || 0);
  });
  const groupList = Object.values(groups).sort((a, b) => b.names.length - a.names.length);
  groupedBody.innerHTML = groupList.map(g => `
    <tr>
      <td>${escapeHtml(g.title || '')}</td>
      <td class="num">${g.names.length}</td>
      <td style="font-size:.8rem;color:var(--ink-soft);">${g.names.map(escapeHtml).join(', ')}</td>
      <td class="num">৳${g.total.toFixed(2)}</td>
    </tr>
  `).join('') || `<tr><td colspan="4" class="activity-meta">No orders in this batch.</td></tr>`;
  const markBtn = document.getElementById('mark-printed-btn');
  if (markBtn) {
    const pending = batchOrders.filter(o => !o.printed).length;
    markBtn.disabled = pending === 0;
    markBtn.textContent = pending === 0 ? '✓ Batch Printed' : `✓ Mark Printed (${pending})`;
  }
  const rds = document.getElementById('received-date-select');
  const rss = document.getElementById('received-sheet-select');
  const { filtered, effectiveDateFilter, effectiveSheetFilter } = applyReceivedFilters(
    sheetOrdersData.filter(o => o.printed), rds, rss,
    currentReceivedDateFilter, currentReceivedSheetFilter
  );
  currentReceivedDateFilter = effectiveDateFilter;
  currentReceivedSheetFilter = effectiveSheetFilter;
  renderGroupedReceivedChecklist(filtered, 'order-received-body', true, treasurerPendingOnly, 'treasurer-pending-count');
}

function applyReceivedFilters(orders, dateSelectEl, sheetSelectEl, dateFilter, sheetFilter) {
  const dateKeys = Array.from(new Set(orders.map(o => o.businessDate).filter(Boolean))).sort().reverse();
  if (dateSelectEl) {
    const prev = dateFilter;
    dateSelectEl.innerHTML = `<option value="all">All dates</option>` +
      dateKeys.map(d => `<option value="${d}">📅 ${formatBusinessDateLabel(d)}</option>`).join('');
    dateSelectEl.value = (prev === 'all' || dateKeys.includes(prev)) ? prev : 'all';
  }
  const effectiveDateFilter = dateSelectEl ? dateSelectEl.value : dateFilter;
  const dateScoped = effectiveDateFilter === 'all' ? orders : orders.filter(o => o.businessDate === effectiveDateFilter);
  const sheetTitles = Array.from(new Set(dateScoped.map(o => o.sheetTitle).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'bn'));
  if (sheetSelectEl) {
    const prevSheet = sheetFilter;
    sheetSelectEl.innerHTML = `<option value="all">All sheets</option>` +
      sheetTitles.map(t => `<option value="${t}">📄 ${escapeHtml(t)}</option>`).join('');
    sheetSelectEl.value = (prevSheet === 'all' || sheetTitles.includes(prevSheet)) ? prevSheet : 'all';
  }
  const effectiveSheetFilter = sheetSelectEl ? sheetSelectEl.value : sheetFilter;
  const filtered = dateScoped.filter(o => effectiveSheetFilter === 'all' || o.sheetTitle === effectiveSheetFilter);
  return { filtered, effectiveDateFilter, effectiveSheetFilter };
}

function renderGroupedReceivedChecklist(orders, tbodyId, showGenderCol, pendingOnly, countElId) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  const colspan = showGenderCol ? 4 : 3;
  const totalPending = orders.filter(o => !o.received).length;
  if (countElId) {
    const cEl = document.getElementById(countElId);
    if (cEl) cEl.textContent = totalPending > 0 ? `${totalPending} pending` : (orders.length ? 'All received ✓' : '');
  }
  const visibleOrders = pendingOnly ? orders.filter(o => !o.received) : orders;
  if (!visibleOrders.length) {
    tbody.innerHTML = `<tr><td colspan="${colspan}" class="activity-meta">${pendingOnly ? 'All caught up!' : 'No printed orders matching filters.'}</td></tr>`;
    return;
  }
  const sorted = [...visibleOrders].sort((a, b) => {
    const dcmp = (b.businessDate || '').localeCompare(a.businessDate || '');
    if (dcmp !== 0) return dcmp;
    const scmp = (a.sheetTitle || '').localeCompare(b.sheetTitle || '', 'bn');
    if (scmp !== 0) return scmp;
    return (a.studentName || '').localeCompare(b.studentName || '', 'bn');
  });
  let html = '';
  let lastDate = null, lastSheet = null;
  sorted.forEach(o => {
    if (o.businessDate !== lastDate) {
      html += `<tr><td colspan="${colspan}" style="background:var(--bg-soft);font-weight:700;padding:12px 14px;">📅 ${o.businessDate ? formatBusinessDateLabel(o.businessDate) : 'No date'}</td></tr>`;
      lastDate = o.businessDate;
      lastSheet = null;
    }
    if (o.sheetTitle !== lastSheet) {
      html += `<tr><td colspan="${colspan}" style="color:var(--ink-soft);font-size:.82rem;font-weight:600;padding:8px 14px 8px 28px;">📄 ${escapeHtml(o.sheetTitle || '')}</td></tr>`;
      lastSheet = o.sheetTitle;
    }
    const genderLabel = o.gender === 'female' ? 'মেয়ে' : (o.gender === 'male' ? 'ছেলে' : '—');
    const info = o.received
      ? `<span class="activity-meta">${escapeHtml(o.receivedBy || '')} ${o.receivedAt && o.receivedAt.toDate ? '· ' + o.receivedAt.toDate().toLocaleDateString('en-US') : ''}</span>`
      : '<span class="activity-meta">Not yet received</span>';
    html += `<tr>
      <td style="padding-left:28px;"><input type="checkbox" ${o.received ? 'checked disabled' : ''} onchange="toggleOrderReceived('${o.id}', this)" style="width:18px;height:18px;accent-color:var(--primary);"></td>
      <td>${escapeHtml(o.studentName || '—')} <span class="activity-meta">${orderRollTag(o)}</span></td>
      ${showGenderCol ? `<td class="activity-meta">${genderLabel}</td>` : ''}
      <td>${info}</td>
    </tr>`;
  });
  tbody.innerHTML = html;
}

window.onOrderDateFilterChange = () => {
  const sel = document.getElementById('order-date-select');
  currentOrderDateFilter = sel ? sel.value : null;
  renderSheetOrdersTreasurer();
};
window.onReceivedDateFilterChange = () => {
  const sel = document.getElementById('received-date-select');
  currentReceivedDateFilter = sel ? sel.value : 'all';
  currentReceivedSheetFilter = 'all';
  renderSheetOrdersTreasurer();
};
window.onReceivedSheetFilterChange = () => {
  const sel = document.getElementById('received-sheet-select');
  currentReceivedSheetFilter = sel ? sel.value : 'all';
  renderSheetOrdersTreasurer();
};
window.onTreasurerPendingOnlyToggle = () => {
  const el = document.getElementById('treasurer-pending-only-toggle');
  treasurerPendingOnly = el ? el.checked : false;
  renderSheetOrdersTreasurer();
};
window.markCurrentBatchPrinted = () => window.markOrdersPrinted(currentOrderDateFilter);
window.downloadCurrentBatchPDF = () => window.downloadOrdersPDF(currentOrderDateFilter);

window.markOrdersPrinted = async (batchKey) => {
  if (!batchKey) return;
  const { businessDate, seq } = parseBatchKey(batchKey);
  const toMark = sheetOrdersData.filter(o => orderBatchKey(o) === batchKey && !o.printed);
  if (!toMark.length) { alert("All orders in this batch already marked as printed."); return; }
  if (!confirm(`Mark ${toMark.length} order(s) as printed?`)) return;
  try {
    await Promise.all(toMark.map(o => updateDoc(doc(db, "sheetOrders", o.id), {
      printed: true, printedAt: serverTimestamp(), printedBy: currentTreasurerName
    })));
    if (seq >= currentBatchSeqFor(businessDate)) {
      await setDoc(doc(db, "batchCounters", businessDate), {
        currentSeq: increment(1), updatedBy: currentTreasurerName, updatedAt: serverTimestamp()
      }, { merge: true });
    }
  } catch (e) { alert("Update failed: " + (e && e.message ? e.message : e)); }
};

window.toggleOrderReceived = async (orderId, checkboxEl) => {
  if (!checkboxEl.checked) return;
  if (!confirm("Mark this sheet as received? This cannot be undone.")) { checkboxEl.checked = false; return; }
  checkboxEl.disabled = true;
  try {
    await updateDoc(doc(db, "sheetOrders", orderId), {
      received: true, receivedAt: serverTimestamp(), receivedBy: currentTreasurerName
    });
  } catch (e) {
    checkboxEl.disabled = false;
    checkboxEl.checked = false;
    alert("Update failed: " + (e && e.message ? e.message : e));
  }
};

function getGirlsTotals() {
  const list = students.filter(s => s.gender === 'female');
  const totalCollected = list.reduce((a, s) => a + ((collectionsData[s.roll] || {}).amount || 0), 0);
  const adminIncluded = currentUserRole === 'girls_admin' ? 1 : 0;
  return { count: list.length + adminIncluded, totalCollected };
}

function renderGirlsAdminStudentRows() {
  const tbody = document.getElementById('girls-admin-student-body');
  if (!tbody) return;
  const list = students.filter(s => s.gender === 'female');
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="activity-meta">No female subscribers yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(s => {
    const amt = (collectionsData[s.roll] || {}).amount || 0;
    return `
    <tr data-name="${escapeHtml((s.name || '').toLowerCase())}" data-roll="${s.roll}">
      <td class="num">${s.roll}</td>
      <td>${escapeHtml(s.name || '')}</td>
      <td class="num">৳${amt.toFixed(2)}</td>
      <td>
        <div style="display:flex;gap:6px;">
          <input type="number" class="coll-input" id="girls-pay-${s.roll}" placeholder="৳" onkeydown="if(event.key==='Enter'){addPaymentGirlsAdmin(${s.roll});}">
          <button class="btn btn-outline btn-sm" onclick="addPaymentGirlsAdmin(${s.roll})">+ Add</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

window.filterGirlsAdminStudents = () => {
  const q = document.getElementById('girls-admin-student-search').value.trim().toLowerCase();
  document.querySelectorAll('#girls-admin-student-body tr').forEach(tr => {
    if (!tr.dataset.name) return;
    const match = tr.dataset.name.includes(q) || tr.dataset.roll.includes(q);
    tr.style.display = match ? "" : "none";
  });
};

window.addPaymentGirlsAdmin = async (roll) => {
  const student = students.find(s => s.roll === roll);
  if (!student) { alert("Subscriber not found."); return; }
  if (student.gender !== 'female') { alert("Only female subscribers can be charged here."); return; }
  const input = document.getElementById(`girls-pay-${roll}`);
  const amt = parseFloat(input ? input.value : "");
  if (!amt || amt <= 0) { alert("Enter valid amount."); return; }
  try {
    await addDoc(collection(db, "payments"), { roll, amount: amt, addedBy: currentTreasurerName, addedAt: serverTimestamp() });
    await addDoc(collection(db, "activity"), {
      type: "payment", actor: currentTreasurerName,
      detail: `${student.name} (Roll ${roll}) — ৳${amt.toFixed(2)} added (girls admin)`,
      amount: amt, createdAt: serverTimestamp()
    });
    if (input) input.value = "";
  } catch (e) {
    console.error("Girls admin payment error:", e);
    let msg = "Failed: " + (e && e.message ? e.message : e);
    if (e && e.code === 'permission-denied') msg = "Permission denied. Check subscriber's gender is 'female'.";
    alert(msg);
  }
};

function renderGirlsAdminSheetCatalog() {
  const box = document.getElementById('girls-admin-sheet-select-list');
  if (!box || currentUserRole !== 'girls_admin') return;
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  const myOrderedIds = new Set(sheetOrdersData.filter(o => o.personal && o.orderedByUid === uid).map(o => o.sheetId));
  const windowOpen = isWithinOrderWindow();
  const notice = document.getElementById('girls-order-window-notice');
  if (notice) {
    notice.classList.toggle('hidden', windowOpen);
    if (!windowOpen) notice.textContent = '⏰ ' + orderWindowMessage();
  }
  const btn = document.getElementById('confirm-girls-order-btn');
  if (btn) btn.disabled = !windowOpen;
  if (!sheetsData.length) { box.innerHTML = `<div class="activity-meta" style="padding:20px;">No sheets added yet.</div>`; return; }
  box.innerHTML = sheetsData.map(s => {
    const ordered = myOrderedIds.has(s.id);
    const dPrice = discountedPrice(s.price || 0);
    const hasDiscount = dPrice < (s.price || 0) - 0.001;
    return `
      <label style="${!windowOpen && !ordered ? 'opacity:.55;' : ''}">
        <input type="checkbox" class="girls-admin-sheet-check" value="${s.id}" ${ordered ? 'checked' : ''} ${(ordered || !windowOpen) ? 'disabled' : ''}>
        <span style="flex:1;">${escapeHtml(s.title || '')}</span>
        ${hasDiscount ? `<span class="activity-meta" style="text-decoration:line-through;">৳${(s.price || 0).toFixed(2)}</span>` : ''}
        <span class="num" style="color:var(--ink-soft);">৳${dPrice.toFixed(2)}</span>
        ${ordered ? '<span style="color:var(--success);font-weight:600;font-size:.82rem;">✓ Ordered</span>' : ''}
      </label>`;
  }).join('');
}

window.confirmGirlsAdminPersonalOrder = async () => {
  if (currentUserRole !== 'girls_admin') return;
  if (!isWithinOrderWindow()) { alert('⏰ ' + orderWindowMessage()); return; }
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  const existing = new Set(sheetOrdersData.filter(o => o.personal && o.orderedByUid === uid).map(o => o.sheetId));
  const checked = Array.from(document.querySelectorAll('.girls-admin-sheet-check:checked'))
    .map(cb => cb.value).filter(id => !existing.has(id));
  if (!checked.length) { alert("No new sheets selected."); return; }
  const chosen = sheetsData.filter(s => checked.includes(s.id));
  if (!confirm(`Place ${chosen.length} personal order(s)?`)) return;
  const businessDate = currentBusinessDateKey();
  const batchSeq = currentBatchSeqFor(businessDate);
  try {
    await Promise.all(chosen.map(s => addDoc(collection(db, "sheetOrders"), {
      roll: null,
      studentName: currentTreasurerName + " (girls admin)",
      gender: 'female', personal: true,
      sheetId: s.id, sheetTitle: s.title,
      price: discountedPrice(s.price || 0),
      originalPrice: s.price || 0,
      orderedAt: serverTimestamp(),
      businessDate, batchSeq,
      printed: false, received: false,
      addedBy: currentTreasurerName,
      orderedByUid: uid
    })));
  } catch (e) { alert("Order failed: " + (e && e.message ? e.message : e)); }
};

function renderGirlsAdminMyOrders() {
  const tbody = document.getElementById('girls-admin-my-orders-body');
  if (!tbody || currentUserRole !== 'girls_admin') return;
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  const mine = sheetOrdersData.filter(o => o.personal && o.orderedByUid === uid);
  tbody.innerHTML = mine.map(o => {
    const t = o.orderedAt && o.orderedAt.toDate ? o.orderedAt.toDate().toLocaleDateString('en-US') : '...';
    const batch = o.businessDate ? formatBusinessDateLabel(o.businessDate) : '—';
    const status = o.received
      ? '<span style="color:var(--success);font-weight:600;">✓ Received</span>'
      : (o.printed ? '<span style="color:var(--gold);font-weight:600;">Printed</span>' : '<span class="activity-meta">Pending</span>');
    return `<tr><td class="activity-meta">${t}</td><td>${escapeHtml(o.sheetTitle || '')}</td><td class="num">৳${(o.price || 0).toFixed(2)}</td><td class="activity-meta">${batch}</td><td>${status}</td></tr>`;
  }).join('') || `<tr><td colspan="5" class="activity-meta">No personal orders.</td></tr>`;
}

function renderGirlsAdminPanel() {
  if (currentUserRole !== 'girls_admin') return;
  const { count, totalCollected } = getGirlsTotals();
  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setTxt('girls-count', count);
  setTxt('girls-total-collected', "৳" + totalCollected.toFixed(2));
  renderGirlsAdminStudentRows();
  renderGirlsAdminSheetCatalog();
  renderGirlsAdminMyOrders();
  const printedGirls = sheetOrdersData.filter(o => o.gender === 'female' && o.printed);
  const gds = document.getElementById('girls-received-date-select');
  const gss = document.getElementById('girls-received-sheet-select');
  const { filtered, effectiveDateFilter, effectiveSheetFilter } = applyReceivedFilters(
    printedGirls, gds, gss,
    currentGirlsReceivedDateFilter, currentGirlsReceivedSheetFilter
  );
  currentGirlsReceivedDateFilter = effectiveDateFilter;
  currentGirlsReceivedSheetFilter = effectiveSheetFilter;
  renderGroupedReceivedChecklist(filtered, 'girls-received-body', false, girlsPendingOnly, 'girls-pending-count');
}

window.onGirlsPendingOnlyToggle = () => {
  const el = document.getElementById('girls-pending-only-toggle');
  girlsPendingOnly = el ? el.checked : false;
  renderGirlsAdminPanel();
};
window.onGirlsReceivedDateFilterChange = () => {
  const sel = document.getElementById('girls-received-date-select');
  currentGirlsReceivedDateFilter = sel ? sel.value : 'all';
  currentGirlsReceivedSheetFilter = 'all';
  renderGirlsAdminPanel();
};
window.onGirlsReceivedSheetFilterChange = () => {
  const sel = document.getElementById('girls-received-sheet-select');
  currentGirlsReceivedSheetFilter = sel ? sel.value : 'all';
  renderGirlsAdminPanel();
};

function getBoysTotals() {
  const list = students.filter(s => s.gender === 'male');
  const totalCollected = list.reduce((a, s) => a + ((collectionsData[s.roll] || {}).amount || 0), 0);
  const adminIncluded = currentUserRole === 'chele_admin' ? 1 : 0;
  return { count: list.length + adminIncluded, totalCollected };
}

function renderBoysAdminStudentRows() {
  const tbody = document.getElementById('boys-admin-student-body');
  if (!tbody) return;
  const list = students.filter(s => s.gender === 'male');
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="activity-meta">No male subscribers yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(s => {
    const amt = (collectionsData[s.roll] || {}).amount || 0;
    return `
    <tr data-name="${escapeHtml((s.name || '').toLowerCase())}" data-roll="${s.roll}">
      <td class="num">${s.roll}</td>
      <td>${escapeHtml(s.name || '')}</td>
      <td class="num">৳${amt.toFixed(2)}</td>
      <td>
        <div style="display:flex;gap:6px;">
          <input type="number" class="coll-input" id="boys-pay-${s.roll}" placeholder="৳" onkeydown="if(event.key==='Enter'){addPaymentBoysAdmin(${s.roll});}">
          <button class="btn btn-outline btn-sm" onclick="addPaymentBoysAdmin(${s.roll})">+ Add</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

window.filterBoysAdminStudents = () => {
  const q = document.getElementById('boys-admin-student-search').value.trim().toLowerCase();
  document.querySelectorAll('#boys-admin-student-body tr').forEach(tr => {
    if (!tr.dataset.name) return;
    const match = tr.dataset.name.includes(q) || tr.dataset.roll.includes(q);
    tr.style.display = match ? "" : "none";
  });
};

window.addPaymentBoysAdmin = async (roll) => {
  const student = students.find(s => s.roll === roll);
  if (!student) { alert("Subscriber not found."); return; }
  if (student.gender !== 'male') { alert("Only male subscribers can be charged here."); return; }
  const input = document.getElementById(`boys-pay-${roll}`);
  const amt = parseFloat(input ? input.value : "");
  if (!amt || amt <= 0) { alert("Enter valid amount."); return; }
  try {
    await addDoc(collection(db, "payments"), { roll, amount: amt, addedBy: currentTreasurerName, addedAt: serverTimestamp() });
    await addDoc(collection(db, "activity"), {
      type: "payment", actor: currentTreasurerName,
      detail: `${student.name} (Roll ${roll}) — ৳${amt.toFixed(2)} added (boys admin)`,
      amount: amt, createdAt: serverTimestamp()
    });
    if (input) input.value = "";
  } catch (e) {
    console.error("Boys admin payment error:", e);
    let msg = "Failed: " + (e && e.message ? e.message : e);
    if (e && e.code === 'permission-denied') msg = "Permission denied. Check subscriber's gender is 'male'.";
    alert(msg);
  }
};

function renderBoysAdminSheetCatalog() {
  const box = document.getElementById('boys-admin-sheet-select-list');
  if (!box || currentUserRole !== 'chele_admin') return;
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  const myOrderedIds = new Set(sheetOrdersData.filter(o => o.personal && o.orderedByUid === uid).map(o => o.sheetId));
  const windowOpen = isWithinOrderWindow();
  const notice = document.getElementById('boys-order-window-notice');
  if (notice) {
    notice.classList.toggle('hidden', windowOpen);
    if (!windowOpen) notice.textContent = '⏰ ' + orderWindowMessage();
  }
  const btn = document.getElementById('confirm-boys-order-btn');
  if (btn) btn.disabled = !windowOpen;
  if (!sheetsData.length) { box.innerHTML = `<div class="activity-meta" style="padding:20px;">No sheets added yet.</div>`; return; }
  box.innerHTML = sheetsData.map(s => {
    const ordered = myOrderedIds.has(s.id);
    const dPrice = discountedPrice(s.price || 0);
    const hasDiscount = dPrice < (s.price || 0) - 0.001;
    return `
      <label style="${!windowOpen && !ordered ? 'opacity:.55;' : ''}">
        <input type="checkbox" class="boys-admin-sheet-check" value="${s.id}" ${ordered ? 'checked' : ''} ${(ordered || !windowOpen) ? 'disabled' : ''}>
        <span style="flex:1;">${escapeHtml(s.title || '')}</span>
        ${hasDiscount ? `<span class="activity-meta" style="text-decoration:line-through;">৳${(s.price || 0).toFixed(2)}</span>` : ''}
        <span class="num" style="color:var(--ink-soft);">৳${dPrice.toFixed(2)}</span>
        ${ordered ? '<span style="color:var(--success);font-weight:600;font-size:.82rem;">✓ Ordered</span>' : ''}
      </label>`;
  }).join('');
}

window.confirmBoysAdminPersonalOrder = async () => {
  if (currentUserRole !== 'chele_admin') return;
  if (!isWithinOrderWindow()) { alert('⏰ ' + orderWindowMessage()); return; }
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  const existing = new Set(sheetOrdersData.filter(o => o.personal && o.orderedByUid === uid).map(o => o.sheetId));
  const checked = Array.from(document.querySelectorAll('.boys-admin-sheet-check:checked'))
    .map(cb => cb.value).filter(id => !existing.has(id));
  if (!checked.length) { alert("No new sheets selected."); return; }
  const chosen = sheetsData.filter(s => checked.includes(s.id));
  if (!confirm(`Place ${chosen.length} personal order(s)?`)) return;
  const businessDate = currentBusinessDateKey();
  const batchSeq = currentBatchSeqFor(businessDate);
  try {
    await Promise.all(chosen.map(s => addDoc(collection(db, "sheetOrders"), {
      roll: null,
      studentName: currentTreasurerName + " (boys admin)",
      gender: 'male', personal: true,
      sheetId: s.id, sheetTitle: s.title,
      price: discountedPrice(s.price || 0),
      originalPrice: s.price || 0,
      orderedAt: serverTimestamp(),
      businessDate, batchSeq,
      printed: false, received: false,
      addedBy: currentTreasurerName,
      orderedByUid: uid
    })));
  } catch (e) { alert("Order failed: " + (e && e.message ? e.message : e)); }
};

function renderBoysAdminMyOrders() {
  const tbody = document.getElementById('boys-admin-my-orders-body');
  if (!tbody || currentUserRole !== 'chele_admin') return;
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  const mine = sheetOrdersData.filter(o => o.personal && o.orderedByUid === uid);
  tbody.innerHTML = mine.map(o => {
    const t = o.orderedAt && o.orderedAt.toDate ? o.orderedAt.toDate().toLocaleDateString('en-US') : '...';
    const batch = o.businessDate ? formatBusinessDateLabel(o.businessDate) : '—';
    const status = o.received
      ? '<span style="color:var(--success);font-weight:600;">✓ Received</span>'
      : (o.printed ? '<span style="color:var(--gold);font-weight:600;">Printed</span>' : '<span class="activity-meta">Pending</span>');
    return `<tr><td class="activity-meta">${t}</td><td>${escapeHtml(o.sheetTitle || '')}</td><td class="num">৳${(o.price || 0).toFixed(2)}</td><td class="activity-meta">${batch}</td><td>${status}</td></tr>`;
  }).join('') || `<tr><td colspan="5" class="activity-meta">No personal orders.</td></tr>`;
}

function renderBoysAdminPanel() {
  if (currentUserRole !== 'chele_admin') return;
  const { count, totalCollected } = getBoysTotals();
  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setTxt('boys-count', count);
  setTxt('boys-total-collected', "৳" + totalCollected.toFixed(2));
  renderBoysAdminStudentRows();
  renderBoysAdminSheetCatalog();
  renderBoysAdminMyOrders();
  const printedBoys = sheetOrdersData.filter(o => o.gender === 'male' && o.printed);
  const bds = document.getElementById('boys-received-date-select');
  const bss = document.getElementById('boys-received-sheet-select');
  const { filtered, effectiveDateFilter, effectiveSheetFilter } = applyReceivedFilters(
    printedBoys, bds, bss,
    currentBoysReceivedDateFilter, currentBoysReceivedSheetFilter
  );
  currentBoysReceivedDateFilter = effectiveDateFilter;
  currentBoysReceivedSheetFilter = effectiveSheetFilter;
  renderGroupedReceivedChecklist(filtered, 'boys-received-body', false, boysPendingOnly, 'boys-pending-count');
}

window.onBoysPendingOnlyToggle = () => {
  const el = document.getElementById('boys-pending-only-toggle');
  boysPendingOnly = el ? el.checked : false;
  renderBoysAdminPanel();
};
window.onBoysReceivedDateFilterChange = () => {
  const sel = document.getElementById('boys-received-date-select');
  currentBoysReceivedDateFilter = sel ? sel.value : 'all';
  currentBoysReceivedSheetFilter = 'all';
  renderBoysAdminPanel();
};
window.onBoysReceivedSheetFilterChange = () => {
  const sel = document.getElementById('boys-received-sheet-select');
  currentBoysReceivedSheetFilter = sel ? sel.value : 'all';
  renderBoysAdminPanel();
};

window.updateNewSheetPricePreview = () => {
  const pages = parseInt(document.getElementById('new-sheet-pages').value, 10) || 0;
  const preview = document.getElementById('new-sheet-price-preview');
  const breakdown = document.getElementById('new-sheet-price-breakdown');
  if (preview) preview.textContent = '৳' + computeSheetPrice(pages).toFixed(2);
  if (breakdown) breakdown.textContent = pages > 0 ? sheetBreakdownLabel(pages) : '';
};

let editingSheetId = null;

window.cancelSheetEdit = () => {
  editingSheetId = null;
  ['new-sheet-title','new-sheet-pages','new-sheet-subject','new-sheet-card','new-sheet-custom-price'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  window.updateNewSheetPricePreview();
  const btn = document.getElementById('add-sheet-btn');
  const cancelBtn = document.getElementById('cancel-sheet-edit-btn');
  if (btn) btn.textContent = '+ Add Sheet';
  if (cancelBtn) cancelBtn.classList.add('hidden');
};

window.editSheet = (id) => {
  const s = sheetsData.find(x => x.id === id);
  if (!s) return;
  editingSheetId = id;
  document.getElementById('new-sheet-title').value = s.title || "";
  document.getElementById('new-sheet-pages').value = s.pages || "";
  document.getElementById('new-sheet-subject').value = s.subject || "";
  document.getElementById('new-sheet-card').value = (s.cardNo !== null && s.cardNo !== undefined) ? s.cardNo : "";
  window.updateNewSheetPricePreview();
  const autoPrice = computeSheetPrice(s.pages);
  document.getElementById('new-sheet-custom-price').value =
    (typeof s.price === 'number' && Math.abs(s.price - autoPrice) > 0.001) ? s.price : "";
  const btn = document.getElementById('add-sheet-btn');
  const cancelBtn = document.getElementById('cancel-sheet-edit-btn');
  if (btn) btn.textContent = '✓ Save Changes';
  if (cancelBtn) cancelBtn.classList.remove('hidden');
  document.getElementById('new-sheet-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
};

window.addSheet = async () => {
  const title = document.getElementById('new-sheet-title').value.trim();
  const subject = document.getElementById('new-sheet-subject').value.trim();
  const cardRaw = document.getElementById('new-sheet-card').value;
  const cardNo = cardRaw !== '' ? parseFloat(cardRaw) : null;
  const pages = parseInt(document.getElementById('new-sheet-pages').value, 10);
  if (!title) { alert("Enter sheet title."); return; }
  if (!pages || pages <= 0) { alert("Enter valid page count."); return; }
  const customPriceRaw = document.getElementById('new-sheet-custom-price').value;
  const customPrice = customPriceRaw !== '' ? parseFloat(customPriceRaw) : null;
  if (customPrice !== null && (isNaN(customPrice) || customPrice < 0)) { alert("Invalid custom price."); return; }
  const price = (customPrice !== null) ? customPrice : computeSheetPrice(pages);
  try {
    if (editingSheetId) {
      await updateDoc(doc(db, "sheets", editingSheetId), {
        title, price, pages, subject: subject || null, cardNo,
        editedBy: currentTreasurerName, editedAt: serverTimestamp()
      });
    } else {
      await addDoc(collection(db, "sheets"), {
        title, price, pages, subject: subject || null, cardNo,
        addedBy: currentTreasurerName, addedAt: serverTimestamp()
      });
    }
    window.cancelSheetEdit();
  } catch (e) { alert("Failed: " + (e && e.message ? e.message : e)); }
};

window.deleteSheet = async (id) => {
  if (!confirm("Delete this sheet?")) return;
  if (editingSheetId === id) window.cancelSheetEdit();
  try { await deleteDoc(doc(db, "sheets", id)); }
  catch (e) { alert("Failed: " + (e && e.message ? e.message : e)); }
};

function renderOrderTimingSettingsForm() {
  const s = document.getElementById('cfg-window-start');
  const e = document.getElementById('cfg-window-end');
  const c = document.getElementById('cfg-cutoff');
  const d = document.getElementById('cfg-discount');
  if (s && document.activeElement !== s) s.value = orderConfig.windowStartHour;
  if (e && document.activeElement !== e) e.value = orderConfig.windowEndHour;
  if (c && document.activeElement !== c) c.value = orderConfig.cutoffHour;
  if (d && document.activeElement !== d) d.value = orderConfig.discountPercent || 0;
  const preview = document.getElementById('cfg-preview');
  if (preview) {
    const note = (orderConfig.discountPercent > 0) ? ` Currently ${orderConfig.discountPercent}% discount is active.` : '';
    preview.textContent = `Orders accepted from ${formatHourLabel(orderConfig.windowStartHour)} to ${formatHourLabel(orderConfig.windowEndHour)}. Orders after ${formatHourLabel(orderConfig.cutoffHour)} go to the next day's batch.${note}`;
  }
}

window.saveOrderTimingSettings = async () => {
  const start = parseInt(document.getElementById('cfg-window-start').value, 10);
  const end = parseInt(document.getElementById('cfg-window-end').value, 10);
  const cutoff = parseInt(document.getElementById('cfg-cutoff').value, 10);
  const discountRaw = document.getElementById('cfg-discount').value;
  const discountPercent = discountRaw === '' ? 0 : parseFloat(discountRaw);
  if ([start, end, cutoff].some(v => isNaN(v) || v < 0 || v > 23)) { alert("Hours must be 0-23."); return; }
  if (start >= end) { alert("Start must be before end."); return; }
  if (isNaN(discountPercent) || discountPercent < 0 || discountPercent > 100) { alert("Discount 0-100."); return; }
  try {
    await setDoc(doc(db, "settings", "orderConfig"), {
      windowStartHour: start, windowEndHour: end, cutoffHour: cutoff, discountPercent,
      updatedBy: currentTreasurerName, updatedAt: serverTimestamp()
    }, { merge: true });
    alert("Settings saved.");
  } catch (e) { alert("Failed: " + (e && e.message ? e.message : e)); }
};

function roleLabel(role) {
  if (role === 'subscriber') return 'Subscriber';
  if (role === 'girls_admin') return 'Girls Admin';
  if (role === 'chele_admin') return 'Boys Admin';
  if (role === 'treasurer') return 'Treasurer';
  return 'Pending';
}

function renderNewUserRollOptions() {
  const sel = document.getElementById('new-user-roll');
  if (!sel) return;
  const prev = sel.value;
  const taken = new Set(usersData.filter(u => u.role === 'subscriber' && u.roll != null).map(u => String(u.roll)));
  sel.innerHTML = students.map(s =>
    `<option value="${s.roll}" ${taken.has(String(s.roll)) ? 'disabled' : ''}>${escapeHtml(s.name)} (Roll ${s.roll})${taken.has(String(s.roll)) ? ' — already has account' : ''}</option>`
  ).join('') || `<option value="">No subscribers — add from Subscribers tab</option>`;
  if (prev && students.some(s => String(s.roll) === prev)) sel.value = prev;
}

window.onNewUserRoleChange = () => {
  const role = document.getElementById('new-user-role').value;
  document.getElementById('new-user-roll-wrap').classList.toggle('hidden', role !== 'subscriber');
};

window.addUserAccount = async () => {
  const name = document.getElementById('new-user-name').value.trim();
  const email = document.getElementById('new-user-email').value.trim();
  const password = document.getElementById('new-user-password').value;
  const role = document.getElementById('new-user-role').value;
  const rollRaw = document.getElementById('new-user-roll').value;
  const roll = role === 'subscriber' ? parseInt(rollRaw) : null;
  if (!name || !email || !password) { alert("Fill all fields."); return; }
  if (password.length < 6) { alert("Password must be 6+ characters."); return; }
  if (role === 'subscriber' && !roll) { alert("Select subscriber."); return; }
  if (role === 'subscriber' && usersData.some(u => u.role === 'subscriber' && u.roll === roll)) {
    alert("Account already exists for this subscriber."); return;
  }
  const btn = document.getElementById('add-user-btn');
  if (btn) { btn.disabled = true; btn.textContent = "Creating…"; }
  const secondaryApp = initializeApp(firebaseConfig, "secondary-" + Date.now());
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    await setDoc(doc(db, "users", cred.user.uid), {
      role, roll, name, email,
      gender: role === 'girls_admin' ? 'female' : (role === 'chele_admin' ? 'male' : null),
      createdAt: serverTimestamp(), addedBy: currentTreasurerName
    });
    try { await signOut(secondaryAuth); } catch (_) {}
    alert(`✓ Account created for ${name} as ${roleLabel(role)}`);
    document.getElementById('new-user-name').value = "";
    document.getElementById('new-user-email').value = "";
    document.getElementById('new-user-password').value = "";
  } catch (e) {
    let msg = "Failed: " + (e && e.message ? e.message : e);
    if (e && e.code === 'auth/email-already-in-use') msg = "Email already in use.";
    if (e && e.code === 'auth/invalid-email') msg = "Invalid email.";
    alert(msg);
  } finally {
    try { await deleteApp(secondaryApp); } catch (_) {}
    if (btn) { btn.disabled = false; btn.textContent = "🔑 Create Account"; }
  }
};

function renderUsersList() {
  const tbody = document.getElementById('users-list-body');
  if (!tbody) return;
  if (!usersData.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="activity-meta">No login accounts yet.</td></tr>`;
    renderNewUserRollOptions();
    return;
  }
  const sorted = [...usersData].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'bn'));
  tbody.innerHTML = sorted.map(u => `
    <tr>
      <td>${escapeHtml(u.name || '—')}</td>
      <td class="activity-meta">${escapeHtml(u.email || '—')}</td>
      <td>${roleLabel(u.role)}</td>
      <td class="num">${u.role === 'subscriber' && u.roll != null ? u.roll : '—'}</td>
      <td><button class="icon-btn" onclick="revokeUserAccess('${u.id}', '${escapeHtml(u.name || u.email || '').replace(/'/g, "")}')">Revoke</button></td>
    </tr>
  `).join('');
  renderNewUserRollOptions();
}

window.revokeUserAccess = async (uid, label) => {
  if (!confirm(`Revoke access for ${label}?`)) return;
  try { await deleteDoc(doc(db, "users", uid)); }
  catch (e) { alert("Failed: " + (e && e.message ? e.message : e)); }
};

window.filterStudents = () => {
  const q = document.getElementById('student-search').value.trim().toLowerCase();
  document.querySelectorAll('#student-body tr').forEach(tr => {
    if (!tr.dataset.name) return;
    const match = tr.dataset.name.includes(q) || tr.dataset.roll.includes(q);
    tr.style.display = match ? "" : "none";
  });
};

window.loadActivity = async () => {
  if (currentUserRole !== 'treasurer') return;
  const feed = document.getElementById('activity-feed');
  if (!feed) return;
  feed.innerHTML = `<div class="activity-meta">Loading…</div>`;
  try {
    const snap = await getDocs(query(collection(db, "activity"), orderBy("createdAt", "desc"), limit(50)));
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));
    if (!items.length) { feed.innerHTML = `<div class="activity-meta">No activity yet.</div>`; return; }
    const iconClass = { payment: "pay", donation: "don", expense: "exp" };
    feed.innerHTML = items.map(a => {
      const t = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().toLocaleString('en-US') : "just now";
      return `<div class="activity-item">
        <div class="activity-dot ${iconClass[a.type] || 'pay'}"></div>
        <div>
          <div class="activity-detail">${escapeHtml(a.detail || '')}</div>
          <div class="activity-meta-sm">${escapeHtml(a.actor || '')} · ${t}</div>
        </div>
      </div>`;
    }).join('');
  } catch (e) { feed.innerHTML = `<div class="activity-meta">Failed to load activity.</div>`; }
};

window.downloadOrdersPDF = (batchKey) => {
  if (!batchKey) return;
  const { businessDate, seq } = parseBatchKey(batchKey);
  const orders = sheetOrdersData.filter(o => orderBatchKey(o) === batchKey);
  if (!orders.length) { alert("No orders in this batch."); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const now = new Date();
  doc.setFontSize(14); doc.setTextColor(0, 0, 0);
  doc.setFont(undefined, 'bold');
  doc.text("Sheet Print Orders", 14, 16);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(10);
  doc.text(`${formatBusinessDateLabel(businessDate)}  |  Batch ${seq}`, 14, 22);
  doc.setFontSize(8); doc.setTextColor(80, 80, 80);
  doc.text(`Treasurer: ${currentTreasurerName}   |   ${now.toLocaleString()}`, 14, 27);
  const groups = {};
  orders.forEach(o => {
    const key = o.sheetId || o.sheetTitle;
    if (!groups[key]) groups[key] = { title: o.sheetTitle, total: 0, boys: 0, girls: 0 };
    groups[key].total += 1;
    if (o.gender === 'male') groups[key].boys += 1;
    else if (o.gender === 'female') groups[key].girls += 1;
  });
  const list = Object.values(groups).sort((a, b) => b.total - a.total);
  doc.autoTable({
    startY: 32,
    head: [["Sheet", "Total", "Boys", "Girls"]],
    body: list.map(g => [g.title, String(g.total), String(g.boys), String(g.girls)]),
    theme: "grid",
    headStyles: { fillColor: [220, 220, 220], textColor: [0, 0, 0], fontSize: 9, fontStyle: 'bold' },
    bodyStyles: { textColor: [0, 0, 0], fontSize: 9 },
    styles: { halign: "center", lineColor: [150, 150, 150], lineWidth: 0.2 },
    columnStyles: { 0: { halign: "left" } }
  });
  const totalCopies = orders.length;
  const totalBoys = list.reduce((a, g) => a + g.boys, 0);
  const totalGirls = list.reduce((a, g) => a + g.girls, 0);
  const finalY = doc.lastAutoTable.finalY + 8;
  doc.setFontSize(10); doc.setTextColor(0, 0, 0);
  doc.setFont(undefined, 'bold');
  doc.text(`Total: ${totalCopies}   |   Boys: ${totalBoys}   |   Girls: ${totalGirls}`, 14, finalY);
  doc.save(`Sheet_Orders_${businessDate}_batch${seq}.pdf`);
};

function buildReceiversPDF(orders, titleText, filenameSuffix) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const now = new Date();
  doc.setFontSize(14); doc.setTextColor(0, 0, 0);
  doc.setFont(undefined, 'bold');
  doc.text(titleText, 14, 16);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(8); doc.setTextColor(80, 80, 80);
  doc.text(`Treasurer: ${currentTreasurerName}   |   ${now.toLocaleString()}`, 14, 21);
  function buildRows(list) {
    const sorted = [...list].sort((a, b) => {
      const dcmp = (b.businessDate || '').localeCompare(a.businessDate || '');
      if (dcmp !== 0) return dcmp;
      const scmp = (a.sheetTitle || '').localeCompare(b.sheetTitle || '');
      if (scmp !== 0) return scmp;
      return (a.studentName || '').localeCompare(b.studentName || '');
    });
    return sorted.map(o => [
      o.businessDate ? formatBusinessDateLabel(o.businessDate) : '-',
      o.sheetTitle || '-',
      o.studentName || 'Unknown',
      o.roll != null ? String(o.roll) : '-',
      o.received ? 'Received' : 'Pending'
    ]);
  }
  const boys = orders.filter(o => o.gender === 'male');
  const girls = orders.filter(o => o.gender === 'female');
  doc.setFontSize(11); doc.setTextColor(0, 0, 0);
  doc.setFont(undefined, 'bold');
  doc.text(`Boys (${boys.length})`, 14, 30);
  doc.setFont(undefined, 'normal');
  doc.autoTable({
    startY: 33,
    head: [["Date", "Sheet", "Name", "Roll", "Status"]],
    body: boys.length ? buildRows(boys) : [["-", "-", "No orders", "-", "-"]],
    theme: "grid",
    headStyles: { fillColor: [220, 220, 220], textColor: [0, 0, 0], fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { textColor: [0, 0, 0], fontSize: 8 },
    styles: { lineColor: [150, 150, 150], lineWidth: 0.2, cellPadding: 1.5 }
  });
  const yAfterBoys = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(11); doc.setTextColor(0, 0, 0);
  doc.setFont(undefined, 'bold');
  doc.text(`Girls (${girls.length})`, 14, yAfterBoys);
  doc.setFont(undefined, 'normal');
  doc.autoTable({
    startY: yAfterBoys + 3,
    head: [["Date", "Sheet", "Name", "Roll", "Status"]],
    body: girls.length ? buildRows(girls) : [["-", "-", "No orders", "-", "-"]],
    theme: "grid",
    headStyles: { fillColor: [220, 220, 220], textColor: [0, 0, 0], fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { textColor: [0, 0, 0], fontSize: 8 },
    styles: { lineColor: [150, 150, 150], lineWidth: 0.2, cellPadding: 1.5 }
  });
  doc.save(`Sheet_Receivers_${filenameSuffix}.pdf`);
}

window.downloadReceiversPDF = () => {
  const printed = sheetOrdersData.filter(o => o.printed && (o.gender === 'male' || o.gender === 'female'));
  if (!printed.length) { alert("No printed orders yet."); return; }
  buildReceiversPDF(printed, "Sheet Receivers List", localDateKey(new Date()));
};

window.downloadTodayReceiversPDF = () => {
  const todayKey = localDateKey(new Date());
  const todays = sheetOrdersData.filter(o => {
    if (o.gender !== 'male' && o.gender !== 'female') return false;
    const t = tsToDate(o.orderedAt);
    return t && localDateKey(t) === todayKey;
  });
  if (!todays.length) { alert("No orders today."); return; }
  buildReceiversPDF(todays, `Sheet Receivers — ${formatBusinessDateLabel(todayKey)}`, `${todayKey}_${Date.now()}`);
};

console.log('[Arundeepto App] Loaded successfully ✅');