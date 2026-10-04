import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  createUserWithEmailAndPassword, deleteUser
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
let activityData = [];
let sheetsData = [];
let sheetOrdersData = [];
let usersData = [];
let currentTreasurerName = "";
let currentUserRole = "treasurer";
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
function orderBatchKey(o) {
  return `${o.businessDate}#${o.batchSeq || 1}`;
}
function parseBatchKey(key) {
  const idx = key.lastIndexOf('#');
  return { businessDate: key.slice(0, idx), seq: Number(key.slice(idx + 1)) || 1 };
}
function formatBatchLabel(businessDate, seq, extra) {
  return `${formatBusinessDateLabel(businessDate)} — ব্যাচ ${seq}${extra ? ' ' + extra : ''}`;
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

setInterval(() => {
  if (currentUserRole === 'subscriber') renderSheetCatalogSubscriber();
  else if (currentUserRole === 'girls_admin') renderGirlsAdminSheetCatalog();
  else if (currentUserRole === 'chele_admin') renderBoysAdminSheetCatalog();
  else if (currentUserRole === 'treasurer') window.maybeAutoDownloadReceiversPDF();
}, 60000);

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
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
  document.getElementById('login-form').classList.add('hidden');
  document.getElementById('register-form').classList.remove('hidden');
};

window.showLoginForm = () => {
  document.getElementById('auth-error').classList.add('hidden');
  document.getElementById('register-form').classList.add('hidden');
  document.getElementById('login-form').classList.remove('hidden');
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
    if (!studentDoc.exists()) {
      throw new Error(`Roll ${roll} এখনো Treasurer যোগ করেননি।`);
    }
    const student = studentDoc.data();

    const existingSnap = await getDocs(query(collection(db, "users"), where("role", "==", "subscriber")));
    if (existingSnap.docs.some(d => d.data().roll === roll)) {
      throw new Error(`Roll ${roll} এর জন্য আগে থেকেই একটি অ্যাকাউন্ট রেজিস্টার করা আছে।`);
    }

    await setDoc(doc(db, "users", cred.user.uid), {
      role: 'subscriber', roll, name: student.name, email,
      gender: student.gender || null,
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

function stampInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
}

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
  } catch (e) {}

  currentUserRole = role;
  currentSubscriberRoll = roll;
  currentTreasurerName = name;
  currentUserGender = adminGender;

  document.getElementById('auth-screen').classList.add('hidden');

  if (role === 'pending') {
    document.getElementById('app').classList.add('hidden');
    document.getElementById('pending-email').textContent = user.email || name;
    document.getElementById('pending-screen').classList.remove('hidden');
    return;
  }
  document.getElementById('pending-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  document.getElementById('current-user-name').textContent = name;
  document.getElementById('current-user-role').textContent =
    role === 'subscriber' ? 'Subscriber' : (role === 'girls_admin' ? 'মেয়েদের এডমিন' : (role === 'chele_admin' ? 'ছেলেদের এডমিন' : 'Treasurer'));
  document.getElementById('current-user-stamp').textContent = stampInitials(name);
  document.getElementById('masthead-sub').textContent =
    role === 'subscriber' ? 'Subscriber Dashboard' : (role === 'girls_admin' ? 'মেয়েদের এডমিন ড্যাশবোর্ড' : (role === 'chele_admin' ? 'ছেলেদের এডমিন ড্যাশবোর্ড' : 'Treasury Dashboard'));

  invalidateShareCache();
  applyRoleVisibility();
  startListeners();
}

const TABS_BY_ROLE = {
  treasurer: [
    { id: 'dashboard', label: '📊 ড্যাশবোর্ড' },
    { id: 'subscribers', label: '👥 সাবস্ক্রাইবার' },
    { id: 'users', label: '🔑 লগইন অ্যাকাউন্ট' },
    { id: 'fund', label: '💰 ফান্ড' },
    { id: 'expense', label: '🧾 খরচ' },
    { id: 'sheets', label: '📄 শিট ও অর্ডার' },
    { id: 'activity', label: '🕘 কার্যক্রম' }
  ],
  subscriber: [
    { id: 'dashboard', label: '📊 আপনার হিসাব' },
    { id: 'sheets', label: '📄 শিট অর্ডার' }
  ],
  girls_admin: [
    { id: 'dashboard', label: '📊 সংক্ষিপ্ত' },
    { id: 'payments', label: '💰 জমা যোগ করুন' },
    { id: 'sheets', label: '📄 ব্যক্তিগত অর্ডার' }
  ],
  chele_admin: [
    { id: 'dashboard', label: '📊 সংক্ষিপ্ত' },
    { id: 'payments', label: '💰 জমা যোগ করুন' },
    { id: 'sheets', label: '📄 ব্যক্তিগত অর্ডার' }
  ]
};

window.setActiveTab = (tabId) => {
  currentActiveTab = tabId;
  document.querySelectorAll('[data-tab]').forEach(el => {
    el.classList.toggle('tab-inactive', el.dataset.tab !== tabId);
  });
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tabid === tabId);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

function renderNavBar() {
  const nav = document.getElementById('nav-bar');
  if (!nav) return;
  const tabs = TABS_BY_ROLE[currentUserRole] || [];
  nav.innerHTML = tabs.map(t =>
    `<button class="nav-tab-btn" data-tabid="${t.id}" onclick="setActiveTab('${t.id}')">${t.label}</button>`
  ).join('');
  if (!tabs.find(t => t.id === currentActiveTab)) {
    currentActiveTab = tabs.length ? tabs[0].id : null;
  }
  if (currentActiveTab) window.setActiveTab(currentActiveTab);
}

function applyRoleVisibility() {
  const role = currentUserRole;
  document.querySelectorAll('.treasurer-only').forEach(el => el.classList.toggle('hidden', role !== 'treasurer'));
  document.querySelectorAll('.subscriber-only').forEach(el => el.classList.toggle('hidden', role !== 'subscriber'));
  document.querySelectorAll('.girls-admin-only').forEach(el => el.classList.toggle('hidden', role !== 'girls_admin'));
  document.querySelectorAll('.boys-admin-only').forEach(el => el.classList.toggle('hidden', role !== 'chele_admin'));
  renderNavBar();
  if (role === 'subscriber') renderSubscriberPanel();
  if (role === 'girls_admin') renderGirlsAdminPanel();
  if (role === 'chele_admin') renderBoysAdminPanel();
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    applyLoggedInUser(user);
  } else {
    stopListeners();
    document.getElementById('app').classList.add('hidden');
    document.getElementById('pending-screen').classList.add('hidden');
    document.getElementById('auth-screen').classList.remove('hidden');
    window.showLoginForm();
  }
});

let _shareCache = null;
let _shareCacheKey = "";
let _recomputeTimer = null;

function invalidateShareCache() {
  _shareCache = null;
  _shareCacheKey = "";
}

function _computeShareCache() {
  const cacheKey = students.length + "|" + expensesData.length + "|" + donationsData.length;
  if (_shareCache && _shareCacheKey === cacheKey) return _shareCache;

  const donationEvents = donationsData.map(d => ({
    type: 'donation', amount: d.amount || 0,
    time: tsToDate(d.addedAt) || new Date(0)
  }));
  const expenseEvents = expensesData
    .filter(e => e.chargeType !== 'individual')
    .map(e => ({
      type: 'expense', id: e.id, amount: e.amount || 0,
      time: tsToDate(e.addedAt) || new Date(0)
    }));
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
    expensesData
      .filter(e => e.chargeType !== 'individual')
      .forEach(e => {
        const eTime = tsToDate(e.addedAt) || new Date(0);
        if (joinTime && eTime < joinTime) return;
        const net = netCostById[e.id] || 0;
        if (net <= 0) return;
        const eligible = eligibleStudentsAt(eTime);
        const count = eligible.length || 1;
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
        cutoffHour:      (typeof data.cutoffHour === 'number')      ? data.cutoffHour      : orderConfig.cutoffHour,
        windowStartHour: (typeof data.windowStartHour === 'number') ? data.windowStartHour : orderConfig.windowStartHour,
        windowEndHour:   (typeof data.windowEndHour === 'number')   ? data.windowEndHour   : orderConfig.windowEndHour,
        discountPercent: (typeof data.discountPercent === 'number') ? data.discountPercent : orderConfig.discountPercent
      };
    }
    renderOrderTimingSettingsForm();
    if (isSubscriber) renderSheetCatalogSubscriber();
    if (isGirlsAdmin) renderGirlsAdminSheetCatalog();
    if (isBoysAdmin)  renderBoysAdminSheetCatalog();
  }));

  if (isTreasurer) {
    activeUnsubscribes.push(onSnapshot(collection(db, "batchCounters"), (snap) => {
      batchCountersData = {};
      snap.forEach(d => batchCountersData[d.id] = d.data());
      renderSheetOrdersTreasurer();
    }));
  }

  if (isAdmin) {
    activeUnsubscribes.push(onSnapshot(query(collection(db, "students"), orderBy("roll")), (snap) => {
      students = [];
      snap.forEach(d => students.push({ id: d.id, ...d.data() }));
      invalidateShareCache();
      renderStudentRows();
      renderExpenseTargetOptions();
      renderExpenseMultiTargetOptions();
      renderNewUserRollOptions();
      scheduleRecompute();
      renderExpenses();
      renderSummary();
      if (isGirlsAdmin) renderGirlsAdminPanel();
      if (isBoysAdmin)  renderBoysAdminPanel();
    }));
  } else if (isSubscriber) {
    activeUnsubscribes.push(onSnapshot(doc(db, "students", String(currentSubscriberRoll)), (snap) => {
      students = snap.exists() ? [{ id: snap.id, ...snap.data() }] : [];
      invalidateShareCache();
      scheduleRecompute();
    }));
  }

  if (isTreasurer) {
    activeUnsubscribes.push(onSnapshot(collection(db, "users"), (snap) => {
      usersData = [];
      snap.forEach(d => usersData.push({ id: d.id, ...d.data() }));
      renderUsersList();
    }));
  }

  if (isAdmin) {
    activeUnsubscribes.push(onSnapshot(collection(db, "collections"), (snap) => {
      legacyCollectionsData = {};
      snap.forEach(d => legacyCollectionsData[d.id] = d.data());
      scheduleRecompute();
    }));
  } else if (isSubscriber) {
    activeUnsubscribes.push(onSnapshot(doc(db, "collections", String(currentSubscriberRoll)), (snap) => {
      legacyCollectionsData = {};
      if (snap.exists()) legacyCollectionsData[snap.id] = snap.data();
      scheduleRecompute();
    }));
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
      }
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
    }));
  }

  if (isAdmin) {
    activeUnsubscribes.push(onSnapshot(query(collection(db, "donations"), orderBy("addedAt", "desc")), (snap) => {
      donationsData = [];
      snap.forEach(d => donationsData.push({ id: d.id, ...d.data() }));
      invalidateShareCache();
      renderDonations();
      renderStudents();
      renderSummary();
    }));
  }

  if (isAdmin) {
    activeUnsubscribes.push(onSnapshot(query(collection(db, "expenses"), orderBy("addedAt", "desc")), (snap) => {
      expensesData = [];
      snap.forEach(d => expensesData.push({ id: d.id, ...d.data() }));
      invalidateShareCache();
      renderExpenses();
      renderStudents();
      renderSummary();
    }));
  } else if (isSubscriber) {
    activeUnsubscribes.push(onSnapshot(query(collection(db, "expenses"), orderBy("addedAt", "desc")), (snap) => {
      expensesData = [];
      snap.forEach(d => expensesData.push({ id: d.id, ...d.data() }));
      invalidateShareCache();
      renderSubscriberPanel();
    }));
  }

  if (isTreasurer) {
    activeUnsubscribes.push(onSnapshot(query(collection(db, "activity"), orderBy("createdAt", "desc"), limit(20)), (snap) => {
      activityData = [];
      snap.forEach(d => activityData.push({ id: d.id, ...d.data() }));
      renderActivity();
    }));
  }

  activeUnsubscribes.push(onSnapshot(collection(db, "sheets"), (snap) => {
    sheetsData = [];
    snap.forEach(d => sheetsData.push({ id: d.id, ...d.data() }));
    sheetsData.sort((a, b) => (tsToDate(b.addedAt) || 0) - (tsToDate(a.addedAt) || 0));
    if (isTreasurer)  renderSheetCatalogTreasurer();
    if (isSubscriber) renderSheetCatalogSubscriber();
    if (isGirlsAdmin) renderGirlsAdminSheetCatalog();
    if (isBoysAdmin)  renderBoysAdminSheetCatalog();
  }));

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
      }
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
      window.maybeAutoDownloadReceiversPDF();
    }));
  }
}

function stopListeners() {
  activeUnsubscribes.forEach(unsub => { try { unsub(); } catch (_) {} });
  activeUnsubscribes = [];
  listenersStarted = false;
  if (_recomputeTimer) { clearTimeout(_recomputeTimer); _recomputeTimer = null; }
  invalidateShareCache();
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
  try {
    await updateDoc(doc(db, "students", roll.toString()), { gender });
  } catch (e) {
    alert("জেন্ডার আপডেট করা যায়নি। কারণ: " + (e && e.message ? e.message : e));
  }
};

window.deleteStudent = async (roll) => {
  if (!confirm("Remove this subscriber from the list?")) return;
  await deleteDoc(doc(db, "students", roll.toString()));
  try { await deleteDoc(doc(db, "collections", roll.toString())); } catch (e) {}
  try {
    const paySnap = await getDocs(query(collection(db, "payments"), where("roll", "==", roll)));
    await Promise.all(paySnap.docs.map(d => deleteDoc(d.ref)));
  } catch (e) {}
};

function renderStudentRows() {
  const tbody = document.getElementById('student-body');
  if (!tbody) return;
  if (!students.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="activity-meta">No subscribers added yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = students.map(s => `
    <tr data-name="${(s.name || '').toLowerCase()}" data-roll="${s.roll}">
      <td class="num">${s.roll}</td>
      <td>${s.name}</td>
      <td class="activity-meta">${s.mobile || '—'}</td>
      <td>
        <select onchange="updateStudentGender(${s.roll}, this.value)" style="padding:5px 7px;border:1px solid var(--line-strong);border-radius:6px;background:#fff;font-family:inherit;font-size:.8rem;color:var(--ink);">
          <option value="male" ${s.gender === 'female' ? '' : 'selected'}>ছেলে</option>
          <option value="female" ${s.gender === 'female' ? 'selected' : ''}>মেয়ে</option>
        </select>
      </td>
      <td class="num" id="total-${s.roll}">৳0</td>
      <td>
        <div style="display:flex;gap:6px;align-items:center;">
          <input type="number" class="coll-input" id="pay-${s.roll}" placeholder="৳ পরিমাণ" style="width:90px;" onkeydown="if(event.key==='Enter'){addPayment(${s.roll});}">
          <button class="btn btn-outline" style="padding:7px 10px;font-size:.78rem;white-space:nowrap;" onclick="addPayment(${s.roll})">+ যোগ করুন</button>
        </div>
      </td>
      <td class="num" id="rem-${s.roll}">৳0</td>
      <td class="activity-meta" id="upd-${s.roll}">—</td>
      <td><button class="icon-btn" onclick="deleteStudent(${s.roll})">✕</button></td>
    </tr>
  `).join('');
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

function getSharedExpenseNetCosts() {
  const donationEvents = donationsData.map(d => ({ type: 'donation', amount: d.amount || 0, time: tsToDate(d.addedAt) || new Date(0) }));
  const expenseEvents = expensesData
    .filter(e => e.chargeType !== 'individual')
    .map(e => ({ type: 'expense', id: e.id, amount: e.amount || 0, time: tsToDate(e.addedAt) || new Date(0) }));
  const events = [...donationEvents, ...expenseEvents].sort((a, b) => a.time - b.time);
  let pool = 0;
  const netCostById = {};
  events.forEach(ev => {
    if (ev.type === 'donation') { pool += ev.amount; return; }
    const offset = Math.min(pool, ev.amount);
    pool -= offset;
    netCostById[ev.id] = ev.amount - offset;
  });
  return netCostById;
}

function getEqualShareForStudent(roll) {
  const shares = _computeShareCache();
  return shares[roll] || 0;
}

function getEqualShare() {
  if (!students.length) return 0;
  const total = students.reduce((a, s) => a + getEqualShareForStudent(s.roll), 0);
  return total / students.length;
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

function getSubscriberRemaining(roll) {
  const equalShare = getEqualShareForStudent(roll);
  const rec = collectionsData[roll];
  const amount = rec ? (rec.amount || 0) : 0;
  const personalCharge = getPersonalCharge(roll);
  return amount - equalShare - personalCharge;
}

function isOrderBlockedByDue(roll) {
  return getSubscriberRemaining(roll) < -DUE_ORDER_BLOCK_LIMIT;
}

function renderStudents() {
  students.forEach(s => {
    const equalShare = getEqualShareForStudent(s.roll);
    const rec = collectionsData[s.roll];
    const amount = rec ? (rec.amount || 0) : 0;
    const personalCharge = getPersonalCharge(s.roll);

    const totalEl = document.getElementById(`total-${s.roll}`);
    if (totalEl) {
      const txt = "৳" + amount.toFixed(2);
      if (totalEl.textContent !== txt) totalEl.textContent = txt;
    }

    const remaining = amount - equalShare - personalCharge;
    const remEl = document.getElementById(`rem-${s.roll}`);
    if (remEl) {
      const title = personalCharge > 0 ? `এর মধ্যে ব্যক্তিগত চার্জ: ৳${personalCharge.toFixed(2)}` : "";
      if (remEl.title !== title) remEl.title = title;
      const txt = (remaining >= 0 ? "৳" : "-৳") + Math.abs(remaining).toFixed(2);
      const cls = "num " + (remaining >= 0 ? "due-pos" : "due-neg");
      if (remEl.textContent !== txt) remEl.textContent = txt;
      if (remEl.className !== cls) remEl.className = cls;
    }

    const updEl = document.getElementById(`upd-${s.roll}`);
    if (updEl) {
      let txt = "—";
      if (rec && rec.updatedBy) {
        const t = rec.updatedAt && rec.updatedAt.toDate ? rec.updatedAt.toDate().toLocaleDateString('en-US') : "";
        const count = rec.paymentCount ? ` (${rec.paymentCount} entries)` : "";
        txt = `${rec.updatedBy} ${t ? "· " + t : ""}${count}`;
      }
      if (updEl.textContent !== txt) updEl.textContent = txt;
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
  const remaining = amount - equalShare - personalCharge;

  const warnEl = document.getElementById('subscriber-due-warning');
  const warnText = document.getElementById('subscriber-due-warning-text');
  if (warnEl && warnText) {
    if (isOrderBlockedByDue(roll)) {
      const dueAmount = Math.abs(remaining).toFixed(2);
      warnEl.style.display = 'block';
      warnText.textContent = ` আপনার বাকেয়া ৳${dueAmount} (সীমা ৳${DUE_ORDER_BLOCK_LIMIT})। নতুন শিট অর্ডার করতে Treasurer-এর কাছে টাকা জমা দিন।`;
    } else {
      warnEl.style.display = 'none';
    }
  }

  const subEl = document.getElementById('subscriber-account-sub');
  if (subEl) subEl.textContent = student ? `${student.name} · Roll ${student.roll}${student.mobile ? ' · ' + student.mobile : ''}` : `Roll ${roll}`;

  const set = (id, val) => { const el = document.getElementById(id); if (el && el.textContent !== val) el.textContent = val; };
  set('sub-total-collected', "৳" + amount.toFixed(2));
  set('sub-total-expense', "৳" + (equalShare + personalCharge).toFixed(2));
  const dueEl = document.getElementById('sub-due-credit');
  if (dueEl) {
    dueEl.textContent = (remaining >= 0 ? "৳" : "-৳") + Math.abs(remaining).toFixed(2);
    dueEl.parentElement.classList.toggle('green', remaining >= 0);
    dueEl.parentElement.classList.toggle('red', remaining < 0);
  }

  const pays = (paymentsData[roll] || []).slice().sort((a, b) => {
    const ta = a.addedAt && a.addedAt.toDate ? a.addedAt.toDate() : 0;
    const tb = b.addedAt && b.addedAt.toDate ? b.addedAt.toDate() : 0;
    return tb - ta;
  });
  const historyBody = document.getElementById('sub-payment-history');
  if (historyBody) {
    historyBody.innerHTML = pays.map(p => {
      const t = p.addedAt && p.addedAt.toDate ? p.addedAt.toDate().toLocaleDateString('en-US') : "...";
      return `<tr><td class="activity-meta">${t}</td><td class="num">৳${(p.amount || 0).toFixed(2)}</td><td class="activity-meta">${p.addedBy || ""}</td></tr>`;
    }).join('') || `<tr><td colspan="3" class="activity-meta">এখনো কোনো জমা রেকর্ড করা হয়নি।</td></tr>`;
  }
  renderSubscriberExpenseBreakdown();
}

function renderSummary() {
  const totalCollection = students.reduce((a, s) => a + ((collectionsData[s.roll] || {}).amount || 0), 0);
  const totalDonation = donationsData.reduce((a, d) => a + (d.amount || 0), 0);
  const totalSheetCharges = sheetOrdersData.reduce((a, o) => a + (o.price || 0), 0);
  const totalExpense = expensesData.reduce((a, e) => a + (e.amount || 0), 0) + totalSheetCharges;
  const balance = totalCollection + totalDonation - totalExpense;
  const setTxt = (id, v) => { const el = document.getElementById(id); if (el && el.textContent !== v) el.textContent = v; };
  setTxt('sum-collection', "৳" + totalCollection.toFixed(2));
  setTxt('sum-donation', "৳" + totalDonation.toFixed(2));
  setTxt('sum-expense', "৳" + totalExpense.toFixed(2));
  setTxt('sum-balance', "৳" + balance.toFixed(2));
  const pendingReceiveEl = document.getElementById('dashboard-pending-receive-count');
  if (pendingReceiveEl) {
    pendingReceiveEl.textContent = String(sheetOrdersData.filter(o => o.printed && !o.received).length);
  }
  renderGenderSummary();
}

function getGenderTotals(gender) {
  const list = students.filter(s => s.gender === gender);
  const totalCollected = list.reduce((a, s) => a + ((collectionsData[s.roll] || {}).amount || 0), 0);
  const totalBalance = list.reduce((a, s) => a + getSubscriberRemaining(s.roll), 0);
  return { count: list.length, totalCollected, totalBalance };
}

function renderGenderSummary() {
  const setText = (id, val) => { const el = document.getElementById(id); if (el && el.textContent !== val) el.textContent = val; };
  const setBalance = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    const txt = (val >= 0 ? "৳" : "-৳") + Math.abs(val).toFixed(2);
    if (el.textContent !== txt) el.textContent = txt;
    const c = val >= 0 ? 'var(--green)' : 'var(--red)';
    if (el.style.color !== c) el.style.color = c;
  };
  const boys = getGenderTotals('male');
  const girls = getGenderTotals('female');
  setText('boys-count-admin', boys.count);
  setText('boys-collected-admin', "৳" + boys.totalCollected.toFixed(2));
  setBalance('boys-balance-admin', boys.totalBalance);
  setText('girls-count-admin', girls.count);
  setText('girls-collected-admin', "৳" + girls.totalCollected.toFixed(2));
  setBalance('girls-balance-admin', girls.totalBalance);
}

function renderDonations() {
  const el = document.getElementById('donation-list');
  if (!el) return;
  el.innerHTML = donationsData.map(d => {
    const t = d.addedAt && d.addedAt.toDate ? d.addedAt.toDate().toLocaleDateString('en-US') : "...";
    return `<tr>
      <td class="activity-meta">${t}</td>
      <td>${d.donorName || "Anonymous"}</td>
      <td class="num">৳${(d.amount || 0).toFixed(2)}</td>
      <td>${d.note || "—"}</td>
      <td class="activity-meta">${d.addedBy || ""}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="5" class="activity-meta">No funds added yet.</td></tr>`;
}

function renderExpenses() {
  const el = document.getElementById('expense-list');
  if (!el) return;
  el.innerHTML = expensesData.map(e => {
    let chargedTo;
    if (e.chargeType === 'individual') {
      const isViewerTheTarget = currentUserRole === 'subscriber' && currentSubscriberRoll === e.targetRoll;
      const canSeeName = currentUserRole !== 'subscriber' || isViewerTheTarget;
      chargedTo = canSeeName
        ? `${e.targetName || 'Roll ' + e.targetRoll} <span class="activity-meta">(ব্যক্তিগত)</span>`
        : `<span class="activity-meta">ব্যক্তিগত (গোপনীয়)</span>`;
    } else {
      chargedTo = `সবার সমান ভাগে`;
    }
    return `<tr>
      <td class="activity-meta">${e.date || ""}</td>
      <td>${e.description}</td>
      <td class="num">৳${(e.amount || 0).toFixed(2)}</td>
      <td>${chargedTo}</td>
      <td class="activity-meta">${e.addedBy || ""}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="5" class="activity-meta">No expenses added yet.</td></tr>`;
}

function renderActivity() {
  const el = document.getElementById('activity-feed');
  if (!el) return;
  const iconClass = { payment: "pay", donation: "don", expense: "exp" };
  el.innerHTML = activityData.map(a => {
    const t = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().toLocaleString('en-US') : "just now";
    return `<div class="activity-item">
      <div class="activity-dot ${iconClass[a.type] || 'pay'}"></div>
      <div>
        <div>${a.detail}</div>
        <div class="activity-meta">${a.actor} · ${t}</div>
      </div>
    </div>`;
  }).join('') || `<div class="activity-meta">No activity yet.</div>`;
}

function getGroupedSheets(list) {
  const FALLBACK = 'সাধারণ';
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
      <td class="activity-meta">${g.subject}</td>
      <td class="num">${(s.cardNo !== null && s.cardNo !== undefined && s.cardNo !== '') ? s.cardNo : '—'}</td>
      <td>${s.title}</td>
      <td class="activity-meta">${s.pages ? s.pages + ' পেজ · ' + sheetBreakdownLabel(s.pages) : '—'}</td>
      <td class="num">৳${(s.price || 0).toFixed(2)}</td>
      <td class="activity-meta">${s.addedBy || ''}</td>
      <td><button class="icon-btn edit" onclick="editSheet('${s.id}')">✎</button> <button class="icon-btn" onclick="deleteSheet('${s.id}')">✕</button></td>
    </tr>
  `).join('')).join('') || `<tr><td colspan="7" class="activity-meta">এখনো কোনো লেকচার শিট যোগ করা হয়নি।</td></tr>`;
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
      const remaining = getSubscriberRemaining(currentSubscriberRoll);
      const dueAmount = Math.abs(remaining).toFixed(2);
      const needToDeposit = (remaining + DUE_ORDER_BLOCK_LIMIT).toFixed(2);
      notice.classList.remove('hidden');
      notice.style.background = 'var(--red-bg)';
      notice.style.color = 'var(--red)';
      notice.style.borderColor = 'var(--red)';
      notice.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:4px;">
          <div>⛔ <strong>আপনার বাকেয়া ৳${dueAmount}</strong> — অনুমোদিত সীমা ৳${DUE_ORDER_BLOCK_LIMIT} টাকার বেশি।</div>
          <div style="font-size:.78rem;font-weight:500;">💡 নতুন শিট অর্ডার করতে হলে কমপক্ষে <strong>৳${needToDeposit}</strong> জমা দিয়ে বাকেয়া ৳${DUE_ORDER_BLOCK_LIMIT} টাকার নিচে নামাতে হবে। Treasurer-এর সাথে যোগাযোগ করুন।</div>
        </div>
      `;
    } else {
      notice.style.background = '';
      notice.style.color = '';
      notice.style.borderColor = '';
      notice.classList.toggle('hidden', windowOpen);
      if (!windowOpen) notice.textContent = '⏰ ' + orderWindowMessage();
    }
  }
  const confirmBtn = document.getElementById('confirm-sheet-order-btn');
  if (confirmBtn) {
    confirmBtn.disabled = !canOrder;
    confirmBtn.style.opacity = canOrder ? '1' : '.55';
    confirmBtn.style.cursor = canOrder ? 'pointer' : 'not-allowed';
  }

  if (!sheetsData.length) {
    box.className = '';
    box.innerHTML = `<div class="sheet-order-empty">📄 এখনো কোনো লেকচার শিট যোগ করা হয়নি।</div>`;
    updateSheetOrderSummary();
    return;
  }

  const searchInput = document.getElementById('sheet-search-input');
  const q = (searchInput ? searchInput.value : '').trim().toLowerCase();
  const filtered = q ? sheetsData.filter(s => s.title.toLowerCase().includes(q)) : sheetsData;

  if (!filtered.length) {
    box.className = '';
    box.innerHTML = `<div class="sheet-order-empty">🔍 "${q}" নামে কোনো শিট পাওয়া যায়নি।</div>`;
    updateSheetOrderSummary();
    return;
  }

  box.className = '';
  const grouped = getGroupedSheets(filtered);
  box.innerHTML = grouped.map(g => `
    <div class="sheet-subject-section">
      <div class="sheet-subject-heading">${g.subject} <span class="ssh-count">${g.sheets.length}টি</span></div>
      <div class="sheet-grid">
        ${g.sheets.map(s => {
          const ordered = myOrderedIds.has(s.id);
          const disabled = ordered || !canOrder;
          const cardClasses = ['sheet-card'];
          if (ordered) cardClasses.push('ordered');
          else if (!canOrder) cardClasses.push('locked');
          const hasCardNo = s.cardNo !== null && s.cardNo !== undefined && s.cardNo !== '';
          const dPrice = discountedPrice(s.price || 0);
          const hasDiscount = dPrice < (s.price || 0) - 0.001;
          return `
            <label class="${cardClasses.join(' ')}">
              ${hasDiscount ? `<span class="sc-discount-ribbon">${orderConfig.discountPercent}% ছাড়</span>` : ''}
              <input type="checkbox" class="sheet-check" value="${s.id}" ${ordered ? 'checked' : ''} ${disabled ? 'disabled' : ''} onchange="onSheetCheckChange(this)">
              <span class="sc-subject">${g.subject}${hasCardNo ? ' · কার্ড #' + s.cardNo : ''}</span>
              <span class="sc-title">${s.title}</span>
              ${s.pages ? `<span class="sc-meta"><span>📄 ${s.pages} পেজ</span><span>${sheetBreakdownLabel(s.pages)}</span></span>` : ''}
              <span class="sc-price-row num">${hasDiscount ? `<span class="sc-price-old">৳${(s.price || 0).toFixed(2)}</span>` : ''}<span class="sc-price-new">৳${dPrice.toFixed(2)}</span></span>
              ${ordered ? '<span class="sc-badge">✓ অর্ডার করা হয়েছে</span>' : ''}
            </label>`;
        }).join('')}
      </div>
    </div>
  `).join('');

  box.querySelectorAll('.sheet-check:checked').forEach(cb => cb.closest('.sheet-card').classList.add('checked'));
  updateSheetOrderSummary();
}

window.onSheetCheckChange = (cb) => {
  cb.closest('.sheet-card').classList.toggle('checked', cb.checked);
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
    if (o.received) {
      status = '<span style="color:var(--green);font-weight:600;">✓ গৃহীত</span>';
    } else if (o.printed) {
      status = `<button class="btn btn-sm btn-primary" onclick="markMyOrderReceived('${o.id}')">📥 পেয়ে গেছি</button>`;
    } else {
      status = '<span class="activity-meta">পেন্ডিং</span>';
    }
    return `<tr><td class="activity-meta">${t}</td><td>${o.sheetTitle}</td><td class="num">৳${(o.price || 0).toFixed(2)}</td><td class="activity-meta">${batch}</td><td>${status}</td></tr>`;
  }).join('') || `<tr><td colspan="5" class="activity-meta">এখনো কোনো শিট অর্ডার করা হয়নি।</td></tr>`;
}

window.markMyOrderReceived = async (orderId) => {
  const order = sheetOrdersData.find(o => o.id === orderId && o.roll === currentSubscriberRoll);
  if (!order || order.received) return;
  if (!confirm(`আপনি কি "${order.sheetTitle}" শিটটি বুঝে পেয়েছেন?`)) return;
  const student = students.find(s => s.roll === currentSubscriberRoll);
  try {
    await updateDoc(doc(db, "sheetOrders", orderId), {
      received: true, receivedAt: serverTimestamp(),
      receivedBy: `${student ? student.name : 'Subscriber'} (নিজে)`
    });
  } catch (e) {
    alert("আপডেট করা যায়নি। কারণ: " + (e && e.message ? e.message : e));
  }
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
    ? '<span style="color:var(--green);font-weight:600;">✓ গৃহীত</span>'
    : (o.printed ? '<span style="color:var(--gold);font-weight:600;">প্রিন্ট সম্পন্ন</span>' : '<span class="activity-meta">পেন্ডিং</span>');
}

function orderRollTag(o) {
  return o.personal ? '(এডমিন - ব্যক্তিগত)' : `(Roll ${o.roll})`;
}

function applyReceivedFilters(orders, dateSelectEl, sheetSelectEl, dateFilter, sheetFilter) {
  const dateKeys = Array.from(new Set(orders.map(o => o.businessDate).filter(Boolean))).sort().reverse();
  if (dateSelectEl) {
    const prev = dateFilter;
    dateSelectEl.innerHTML = `<option value="all">সব তারিখ</option>` +
      dateKeys.map(d => `<option value="${d}">📅 ${formatBusinessDateLabel(d)}</option>`).join('');
    dateSelectEl.value = (prev === 'all' || dateKeys.includes(prev)) ? prev : 'all';
  }
  const effectiveDateFilter = dateSelectEl ? dateSelectEl.value : dateFilter;

  const dateScoped = effectiveDateFilter === 'all' ? orders : orders.filter(o => o.businessDate === effectiveDateFilter);
  const sheetTitles = Array.from(new Set(dateScoped.map(o => o.sheetTitle).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'bn'));
  if (sheetSelectEl) {
    const prevSheet = sheetFilter;
    sheetSelectEl.innerHTML = `<option value="all">সব শিট</option>` +
      sheetTitles.map(t => `<option value="${t}">📄 ${t}</option>`).join('');
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
  const totalPendingCount = orders.filter(o => !o.received).length;
  if (countElId) {
    const countEl = document.getElementById(countElId);
    if (countEl) countEl.textContent = totalPendingCount > 0 ? `${totalPendingCount} জন এখনও বুঝে পাননি` : (orders.length ? 'সবাই বুঝে পেয়েছে ✓' : '');
  }
  const visibleOrders = pendingOnly ? orders.filter(o => !o.received) : orders;
  if (!visibleOrders.length) {
    tbody.innerHTML = `<tr><td colspan="${colspan}" class="activity-meta">${pendingOnly ? 'সবাই ইতিমধ্যে বুঝে পেয়েছে।' : 'কোনো প্রিন্ট-সম্পন্ন অর্ডার পাওয়া যায়নি।'}</td></tr>`;
    return;
  }
  orders = visibleOrders;
  const sorted = [...orders].sort((a, b) => {
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
      html += `<tr><td colspan="${colspan}" style="background:var(--bg);font-weight:700;padding:10px 8px 6px;">📅 ${o.businessDate ? formatBusinessDateLabel(o.businessDate) : 'তারিখ নেই'}</td></tr>`;
      lastDate = o.businessDate;
      lastSheet = null;
    }
    if (o.sheetTitle !== lastSheet) {
      html += `<tr><td colspan="${colspan}" style="color:var(--ink-soft);font-size:.82rem;font-weight:600;padding:6px 8px 6px 20px;">📄 ${o.sheetTitle}</td></tr>`;
      lastSheet = o.sheetTitle;
    }
    const genderLabel = o.gender === 'female' ? 'মেয়ে' : (o.gender === 'male' ? 'ছেলে' : '—');
    const info = o.received
      ? `<span class="activity-meta">${o.receivedBy || ''} ${o.receivedAt && o.receivedAt.toDate ? '· ' + o.receivedAt.toDate().toLocaleDateString('en-US') : ''}</span>`
      : '<span class="activity-meta">এখনো বুঝে পায়নি</span>';
    html += `<tr>
      <td style="padding-left:20px;"><input type="checkbox" ${o.received ? 'checked disabled' : ''} onchange="toggleOrderReceived('${o.id}', this)" style="width:16px;height:16px;"></td>
      <td>${o.studentName || '—'} <span class="activity-meta">${orderRollTag(o)}</span></td>
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
    const tag = `${d === today ? ' (আজ)' : ''}${isOpenBatch ? ' (চলমান)' : ' (প্রিন্টে গেছে)'}`;
    return `<option value="${key}">${formatBatchLabel(d, seq, tag)} — ${count} অর্ডার</option>`;
  }).join('');
  dateSelect.value = currentOrderDateFilter;

  const batchOrders = sheetOrdersData.filter(o => orderBatchKey(o) === currentOrderDateFilter);

  detailBody.innerHTML = batchOrders.map(o => {
    const t = o.orderedAt && o.orderedAt.toDate ? o.orderedAt.toDate().toLocaleString('en-US') : '...';
    const genderLabel = o.gender === 'female' ? 'মেয়ে' : (o.gender === 'male' ? 'ছেলে' : '—');
    return `<tr>
      <td class="activity-meta">${t}</td>
      <td>${o.studentName || '—'} <span class="activity-meta">${orderRollTag(o)}</span></td>
      <td class="activity-meta">${genderLabel}</td>
      <td>${o.sheetTitle}</td>
      <td class="num">৳${(o.price || 0).toFixed(2)}</td>
      <td>${orderStatusLabel(o)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="6" class="activity-meta">এই ব্যাচে এখনো কোনো অর্ডার আসেনি।</td></tr>`;

  const groups = {};
  batchOrders.forEach(o => {
    const key = o.sheetId || o.sheetTitle;
    if (!groups[key]) groups[key] = { title: o.sheetTitle, price: o.price, names: [], total: 0 };
    groups[key].names.push(`${o.studentName || 'Unknown'} ${orderRollTag(o)}`);
    groups[key].total += (o.price || 0);
  });
  const groupList = Object.values(groups).sort((a, b) => b.names.length - a.names.length);
  groupedBody.innerHTML = groupList.map(g => `
    <tr>
      <td>${g.title}</td>
      <td class="num">${g.names.length}</td>
      <td style="font-size:.8rem;color:var(--ink-soft);">${g.names.join(', ')}</td>
      <td class="num">৳${g.total.toFixed(2)}</td>
    </tr>
  `).join('') || `<tr><td colspan="4" class="activity-meta">এই ব্যাচে এখনো কোনো অর্ডার আসেনি।</td></tr>`;

  const markBtn = document.getElementById('mark-printed-btn');
  if (markBtn) {
    const pendingPrintCount = batchOrders.filter(o => !o.printed).length;
    markBtn.disabled = pendingPrintCount === 0;
    markBtn.style.opacity = pendingPrintCount === 0 ? '.55' : '1';
    markBtn.textContent = pendingPrintCount === 0 ? '✓ এই ব্যাচ প্রিন্ট সম্পন্ন' : `✓ প্রিন্ট সম্পন্ন চিহ্নিত করুন (${pendingPrintCount})`;
  }

  const receivedDateSel = document.getElementById('received-date-select');
  const receivedSheetSel = document.getElementById('received-sheet-select');
  const { filtered: receivedFiltered, effectiveDateFilter, effectiveSheetFilter } = applyReceivedFilters(
    sheetOrdersData.filter(o => o.printed), receivedDateSel, receivedSheetSel,
    currentReceivedDateFilter, currentReceivedSheetFilter
  );
  currentReceivedDateFilter = effectiveDateFilter;
  currentReceivedSheetFilter = effectiveSheetFilter;
  renderGroupedReceivedChecklist(receivedFiltered, 'order-received-body', true, treasurerPendingOnly, 'treasurer-pending-count');
}

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
  if (!toMark.length) { alert("এই ব্যাচের সব অর্ডার ইতিমধ্যে প্রিন্ট সম্পন্ন চিহ্নিত করা আছে।"); return; }
  if (!confirm(`${formatBatchLabel(businessDate, seq)}-এর ${toMark.length}টি অর্ডার প্রিন্ট সম্পন্ন হিসেবে চিহ্নিত করবেন?`)) return;
  try {
    await Promise.all(toMark.map(o => updateDoc(doc(db, "sheetOrders", o.id), {
      printed: true, printedAt: serverTimestamp(), printedBy: currentTreasurerName
    })));
    if (seq >= currentBatchSeqFor(businessDate)) {
      await setDoc(doc(db, "batchCounters", businessDate), {
        currentSeq: increment(1), updatedBy: currentTreasurerName, updatedAt: serverTimestamp()
      }, { merge: true });
    }
  } catch (e) {
    alert("প্রিন্ট স্ট্যাটাস আপডেট করা যায়নি। কারণ: " + (e && e.message ? e.message : e));
  }
};

window.toggleOrderReceived = async (orderId, checkboxEl) => {
  if (!checkboxEl.checked) return;
  if (!confirm("নিশ্চিত করছেন এই শিটটি বুঝে পেয়েছে? একবার টিক দেওয়ার পর এটি আর পরিবর্তন করা যাবে না।")) {
    checkboxEl.checked = false;
    return;
  }
  checkboxEl.disabled = true;
  try {
    await updateDoc(doc(db, "sheetOrders", orderId), {
      received: true, receivedAt: serverTimestamp(), receivedBy: currentTreasurerName
    });
  } catch (e) {
    checkboxEl.disabled = false;
    checkboxEl.checked = false;
    alert("প্রাপ্তি স্ট্যাটাস আপডেট করা যায়নি। কারণ: " + (e && e.message ? e.message : e));
  }
};

function getGirlsTotals() {
  const femaleStudents = students.filter(s => s.gender === 'female');
  const totalCollected = femaleStudents.reduce((a, s) => a + ((collectionsData[s.roll] || {}).amount || 0), 0);
  const adminIncluded = currentUserRole === 'girls_admin' ? 1 : 0;
  return { count: femaleStudents.length + adminIncluded, totalCollected };
}

function renderGirlsAdminStudentRows() {
  const tbody = document.getElementById('girls-admin-student-body');
  if (!tbody) return;
  const femaleStudents = students.filter(s => s.gender === 'female');
  if (!femaleStudents.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="activity-meta">এখনো কোনো মেয়ে সাবস্ক্রাইবার যোগ করা হয়নি।</td></tr>`;
    return;
  }
  tbody.innerHTML = femaleStudents.map(s => {
    const amt = (collectionsData[s.roll] || {}).amount || 0;
    return `
    <tr data-name="${(s.name || '').toLowerCase()}" data-roll="${s.roll}">
      <td class="num">${s.roll}</td>
      <td>${s.name}</td>
      <td class="num">৳${amt.toFixed(2)}</td>
      <td>
        <div style="display:flex;gap:6px;align-items:center;">
          <input type="number" class="coll-input" id="girls-pay-${s.roll}" placeholder="৳ পরিমাণ" style="width:90px;" onkeydown="if(event.key==='Enter'){addPaymentGirlsAdmin(${s.roll});}">
          <button class="btn btn-outline" style="padding:7px 10px;font-size:.78rem;white-space:nowrap;" onclick="addPaymentGirlsAdmin(${s.roll})">+ যোগ করুন</button>
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
  if (!student || student.gender !== 'female') { alert("শুধু মেয়ে সাবস্ক্রাইবারের জমা এখান থেকে যোগ করা যাবে।"); return; }
  const input = document.getElementById(`girls-pay-${roll}`);
  const amt = parseFloat(input ? input.value : "");
  if (!amt || amt <= 0) { alert("সঠিক পরিমাণ লিখুন।"); return; }
  try {
    await addDoc(collection(db, "payments"), {
      roll, amount: amt, addedBy: currentTreasurerName, addedAt: serverTimestamp()
    });
    await addDoc(collection(db, "activity"), {
      type: "payment", actor: currentTreasurerName,
      detail: `${student.name} (Roll ${roll}) থেকে ৳${amt.toFixed(2)} নতুন জমা যোগ হয়েছে (মেয়েদের এডমিন)`,
      amount: amt, createdAt: serverTimestamp()
    });
    if (input) input.value = "";
  } catch (e) {
    alert("জমা যোগ করা যায়নি। কারণ: " + (e && e.message ? e.message : e));
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
  const confirmBtn = document.getElementById('confirm-girls-order-btn');
  if (confirmBtn) {
    confirmBtn.disabled = !windowOpen;
    confirmBtn.style.opacity = windowOpen ? '1' : '.55';
  }

  if (!sheetsData.length) {
    box.innerHTML = `<div class="activity-meta">এখনো কোনো লেকচার শিট যোগ করা হয়নি।</div>`;
    return;
  }
  box.innerHTML = sheetsData.map(s => {
    const ordered = myOrderedIds.has(s.id);
    const disabled = ordered || !windowOpen;
    const dPrice = discountedPrice(s.price || 0);
    const hasDiscount = dPrice < (s.price || 0) - 0.001;
    return `
      <label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px dashed var(--line);font-size:.9rem;${!windowOpen && !ordered ? 'opacity:.55;' : ''}">
        <input type="checkbox" class="girls-admin-sheet-check" value="${s.id}" ${ordered ? 'checked' : ''} ${disabled ? 'disabled' : ''} style="width:16px;height:16px;">
        <span style="flex:1;">${s.title}</span>
        ${hasDiscount ? `<span class="activity-meta" style="text-decoration:line-through;">৳${(s.price || 0).toFixed(2)}</span>` : ''}
        <span class="num" style="color:var(--ink-soft);">৳${dPrice.toFixed(2)}</span>
        ${ordered ? '<span class="activity-meta" style="color:var(--green);">✓ অর্ডার করা হয়েছে</span>' : ''}
      </label>`;
  }).join('');
}

window.confirmGirlsAdminPersonalOrder = async () => {
  if (currentUserRole !== 'girls_admin') return;
  if (!isWithinOrderWindow()) { alert('⏰ ' + orderWindowMessage()); renderGirlsAdminSheetCatalog(); return; }
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  const alreadyOrderedIds = new Set(sheetOrdersData.filter(o => o.personal && o.orderedByUid === uid).map(o => o.sheetId));
  const checked = Array.from(document.querySelectorAll('.girls-admin-sheet-check:checked'))
    .map(cb => cb.value)
    .filter(id => !alreadyOrderedIds.has(id));
  if (!checked.length) { alert("অর্ডার করার জন্য নতুন কোনো শিট বাছাই করা হয়নি।"); return; }

  const chosenSheets = sheetsData.filter(s => checked.includes(s.id));
  const names = chosenSheets.map(s => s.title).join(', ');
  const businessDate = currentBusinessDateKey();
  if (!confirm(`নিচের শিটগুলো আপনার ব্যক্তিগত অর্ডার হিসেবে বসাতে চান?\n\n${names}\n\nএই অর্ডারটি ${formatBusinessDateLabel(businessDate)} তারিখের ব্যাচে গণনা হবে।`)) return;

  const batchSeq = currentBatchSeqFor(businessDate);
  try {
    await Promise.all(chosenSheets.map(s => addDoc(collection(db, "sheetOrders"), {
      roll: null,
      studentName: currentTreasurerName + " (মেয়েদের এডমিন)",
      gender: 'female',
      personal: true,
      sheetId: s.id,
      sheetTitle: s.title,
      price: discountedPrice(s.price || 0),
      originalPrice: s.price || 0,
      orderedAt: serverTimestamp(),
      businessDate,
      batchSeq,
      printed: false, printedAt: null, printedBy: null,
      received: false, receivedAt: null, receivedBy: null,
      addedBy: currentTreasurerName,
      orderedByUid: uid
    })));
  } catch (e) {
    alert("শিট অর্ডার করা যায়নি। কারণ: " + (e && e.message ? e.message : e));
  }
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
      ? '<span style="color:var(--green);font-weight:600;">✓ গৃহীত</span>'
      : (o.printed ? '<span style="color:var(--gold);font-weight:600;">প্রিন্ট সম্পন্ন</span>' : '<span class="activity-meta">পেন্ডিং</span>');
    return `<tr><td class="activity-meta">${t}</td><td>${o.sheetTitle}</td><td class="num">৳${(o.price || 0).toFixed(2)} <span class="activity-meta">(চার্জবিহীন)</span></td><td class="activity-meta">${batch}</td><td>${status}</td></tr>`;
  }).join('') || `<tr><td colspan="5" class="activity-meta">এখনো কোনো ব্যক্তিগত শিট অর্ডার করা হয়নি।</td></tr>`;
}

function renderGirlsAdminPanel() {
  if (currentUserRole !== 'girls_admin') return;
  const { count, totalCollected } = getGirlsTotals();
  const setText = (id, val) => { const el = document.getElementById(id); if (el && el.textContent !== val) el.textContent = val; };
  setText('girls-count', count);
  setText('girls-total-collected', "৳" + totalCollected.toFixed(2));

  renderGirlsAdminStudentRows();
  renderGirlsAdminSheetCatalog();
  renderGirlsAdminMyOrders();

  const printedGirlsOrders = sheetOrdersData.filter(o => o.gender === 'female' && o.printed);
  const girlsDateSel = document.getElementById('girls-received-date-select');
  const girlsSheetSel = document.getElementById('girls-received-sheet-select');
  const { filtered: girlsReceivedFiltered, effectiveDateFilter: gDateF, effectiveSheetFilter: gSheetF } = applyReceivedFilters(
    printedGirlsOrders, girlsDateSel, girlsSheetSel,
    currentGirlsReceivedDateFilter, currentGirlsReceivedSheetFilter
  );
  currentGirlsReceivedDateFilter = gDateF;
  currentGirlsReceivedSheetFilter = gSheetF;
  renderGroupedReceivedChecklist(girlsReceivedFiltered, 'girls-received-body', false, girlsPendingOnly, 'girls-pending-count');
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
  const maleStudents = students.filter(s => s.gender === 'male');
  const totalCollected = maleStudents.reduce((a, s) => a + ((collectionsData[s.roll] || {}).amount || 0), 0);
  const adminIncluded = currentUserRole === 'chele_admin' ? 1 : 0;
  return { count: maleStudents.length + adminIncluded, totalCollected };
}

function renderBoysAdminStudentRows() {
  const tbody = document.getElementById('boys-admin-student-body');
  if (!tbody) return;
  const maleStudents = students.filter(s => s.gender === 'male');
  if (!maleStudents.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="activity-meta">এখনো কোনো ছেলে সাবস্ক্রাইবার যোগ করা হয়নি।</td></tr>`;
    return;
  }
  tbody.innerHTML = maleStudents.map(s => {
    const amt = (collectionsData[s.roll] || {}).amount || 0;
    return `
    <tr data-name="${(s.name || '').toLowerCase()}" data-roll="${s.roll}">
      <td class="num">${s.roll}</td>
      <td>${s.name}</td>
      <td class="num">৳${amt.toFixed(2)}</td>
      <td>
        <div style="display:flex;gap:6px;align-items:center;">
          <input type="number" class="coll-input" id="boys-pay-${s.roll}" placeholder="৳ পরিমাণ" style="width:90px;" onkeydown="if(event.key==='Enter'){addPaymentBoysAdmin(${s.roll});}">
          <button class="btn btn-outline" style="padding:7px 10px;font-size:.78rem;white-space:nowrap;" onclick="addPaymentBoysAdmin(${s.roll})">+ যোগ করুন</button>
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
  if (!student || student.gender !== 'male') { alert("শুধু ছেলে সাবস্ক্রাইবারের জমা এখান থেকে যোগ করা যাবে।"); return; }
  const input = document.getElementById(`boys-pay-${roll}`);
  const amt = parseFloat(input ? input.value : "");
  if (!amt || amt <= 0) { alert("সঠিক পরিমাণ লিখুন।"); return; }
  try {
    await addDoc(collection(db, "payments"), {
      roll, amount: amt, addedBy: currentTreasurerName, addedAt: serverTimestamp()
    });
    await addDoc(collection(db, "activity"), {
      type: "payment", actor: currentTreasurerName,
      detail: `${student.name} (Roll ${roll}) থেকে ৳${amt.toFixed(2)} নতুন জমা যোগ হয়েছে (ছেলেদের এডমিন)`,
      amount: amt, createdAt: serverTimestamp()
    });
    if (input) input.value = "";
  } catch (e) {
    alert("জমা যোগ করা যায়নি। কারণ: " + (e && e.message ? e.message : e));
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
  const confirmBtn = document.getElementById('confirm-boys-order-btn');
  if (confirmBtn) {
    confirmBtn.disabled = !windowOpen;
    confirmBtn.style.opacity = windowOpen ? '1' : '.55';
  }

  if (!sheetsData.length) {
    box.innerHTML = `<div class="activity-meta">এখনো কোনো লেকচার শিট যোগ করা হয়নি।</div>`;
    return;
  }
  box.innerHTML = sheetsData.map(s => {
    const ordered = myOrderedIds.has(s.id);
    const disabled = ordered || !windowOpen;
    const dPrice = discountedPrice(s.price || 0);
    const hasDiscount = dPrice < (s.price || 0) - 0.001;
    return `
      <label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px dashed var(--line);font-size:.9rem;${!windowOpen && !ordered ? 'opacity:.55;' : ''}">
        <input type="checkbox" class="boys-admin-sheet-check" value="${s.id}" ${ordered ? 'checked' : ''} ${disabled ? 'disabled' : ''} style="width:16px;height:16px;">
        <span style="flex:1;">${s.title}</span>
        ${hasDiscount ? `<span class="activity-meta" style="text-decoration:line-through;">৳${(s.price || 0).toFixed(2)}</span>` : ''}
        <span class="num" style="color:var(--ink-soft);">৳${dPrice.toFixed(2)}</span>
        ${ordered ? '<span class="activity-meta" style="color:var(--green);">✓ অর্ডার করা হয়েছে</span>' : ''}
      </label>`;
  }).join('');
}

window.confirmBoysAdminPersonalOrder = async () => {
  if (currentUserRole !== 'chele_admin') return;
  if (!isWithinOrderWindow()) { alert('⏰ ' + orderWindowMessage()); renderBoysAdminSheetCatalog(); return; }
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  const alreadyOrderedIds = new Set(sheetOrdersData.filter(o => o.personal && o.orderedByUid === uid).map(o => o.sheetId));
  const checked = Array.from(document.querySelectorAll('.boys-admin-sheet-check:checked'))
    .map(cb => cb.value)
    .filter(id => !alreadyOrderedIds.has(id));
  if (!checked.length) { alert("অর্ডার করার জন্য নতুন কোনো শিট বাছাই করা হয়নি।"); return; }

  const chosenSheets = sheetsData.filter(s => checked.includes(s.id));
  const names = chosenSheets.map(s => s.title).join(', ');
  const businessDate = currentBusinessDateKey();
  if (!confirm(`নিচের শিটগুলো আপনার ব্যক্তিগত অর্ডার হিসেবে বসাতে চান?\n\n${names}\n\nএই অর্ডারটি ${formatBusinessDateLabel(businessDate)} তারিখের ব্যাচে গণনা হবে।`)) return;

  const batchSeq = currentBatchSeqFor(businessDate);
  try {
    await Promise.all(chosenSheets.map(s => addDoc(collection(db, "sheetOrders"), {
      roll: null,
      studentName: currentTreasurerName + " (ছেলেদের এডমিন)",
      gender: 'male',
      personal: true,
      sheetId: s.id,
      sheetTitle: s.title,
      price: discountedPrice(s.price || 0),
      originalPrice: s.price || 0,
      orderedAt: serverTimestamp(),
      businessDate,
      batchSeq,
      printed: false, printedAt: null, printedBy: null,
      received: false, receivedAt: null, receivedBy: null,
      addedBy: currentTreasurerName,
      orderedByUid: uid
    })));
  } catch (e) {
    alert("শিট অর্ডার করা যায়নি। কারণ: " + (e && e.message ? e.message : e));
  }
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
      ? '<span style="color:var(--green);font-weight:600;">✓ গৃহীত</span>'
      : (o.printed ? '<span style="color:var(--gold);font-weight:600;">প্রিন্ট সম্পন্ন</span>' : '<span class="activity-meta">পেন্ডিং</span>');
    return `<tr><td class="activity-meta">${t}</td><td>${o.sheetTitle}</td><td class="num">৳${(o.price || 0).toFixed(2)} <span class="activity-meta">(চার্জবিহীন)</span></td><td class="activity-meta">${batch}</td><td>${status}</td></tr>`;
  }).join('') || `<tr><td colspan="5" class="activity-meta">এখনো কোনো ব্যক্তিগত শিট অর্ডার করা হয়নি।</td></tr>`;
}

function renderBoysAdminPanel() {
  if (currentUserRole !== 'chele_admin') return;
  const { count, totalCollected } = getBoysTotals();
  const setText = (id, val) => { const el = document.getElementById(id); if (el && el.textContent !== val) el.textContent = val; };
  setText('boys-count', count);
  setText('boys-total-collected', "৳" + totalCollected.toFixed(2));

  renderBoysAdminStudentRows();
  renderBoysAdminSheetCatalog();
  renderBoysAdminMyOrders();

  const printedBoysOrders = sheetOrdersData.filter(o => o.gender === 'male' && o.printed);
  const boysDateSel = document.getElementById('boys-received-date-select');
  const boysSheetSel = document.getElementById('boys-received-sheet-select');
  const { filtered: boysReceivedFiltered, effectiveDateFilter: bDateF, effectiveSheetFilter: bSheetF } = applyReceivedFilters(
    printedBoysOrders, boysDateSel, boysSheetSel,
    currentBoysReceivedDateFilter, currentBoysReceivedSheetFilter
  );
  currentBoysReceivedDateFilter = bDateF;
  currentBoysReceivedSheetFilter = bSheetF;
  renderGroupedReceivedChecklist(boysReceivedFiltered, 'boys-received-body', false, boysPendingOnly, 'boys-pending-count');
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

window.downloadOrdersPDF = (batchKey) => {
  if (!batchKey) return;
  const { businessDate, seq } = parseBatchKey(batchKey);
  const orders = sheetOrdersData.filter(o => orderBatchKey(o) === batchKey);
  if (!orders.length) { alert("এই ব্যাচে কোনো অর্ডার নেই।"); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const now = new Date();

  doc.setFontSize(14); doc.setTextColor(0, 0, 0);
  doc.setFont(undefined, 'bold');
  doc.text(`Sheet Print Orders`, 14, 16);
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
  const groupList = Object.values(groups).sort((a, b) => b.total - a.total);

  doc.autoTable({
    startY: 32,
    head: [["Sheet", "Total", "Boys", "Girls"]],
    body: groupList.map(g => [g.title, String(g.total), String(g.boys), String(g.girls)]),
    theme: "grid",
    headStyles: { fillColor: [220, 220, 220], textColor: [0, 0, 0], fontSize: 9, fontStyle: 'bold' },
    bodyStyles: { textColor: [0, 0, 0], fontSize: 9 },
    styles: { halign: "center", lineColor: [150, 150, 150], lineWidth: 0.2 },
    columnStyles: { 0: { halign: "left" } },
    alternateRowStyles: { fillColor: [250, 250, 250] }
  });

  const totalCopies = orders.length;
  const totalBoys = groupList.reduce((a, g) => a + g.boys, 0);
  const totalGirls = groupList.reduce((a, g) => a + g.girls, 0);
  const finalY = doc.lastAutoTable.finalY + 8;
  doc.setFontSize(10); doc.setTextColor(0, 0, 0);
  doc.setFont(undefined, 'bold');
  doc.text(`Total Copies: ${totalCopies}   |   Boys: ${totalBoys}   |   Girls: ${totalGirls}`, 14, finalY);

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
    styles: { lineColor: [150, 150, 150], lineWidth: 0.2, cellPadding: 1.5 },
    alternateRowStyles: { fillColor: [250, 250, 250] }
  });

  const afterBoysY = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(11); doc.setTextColor(0, 0, 0);
  doc.setFont(undefined, 'bold');
  doc.text(`Girls (${girls.length})`, 14, afterBoysY);
  doc.setFont(undefined, 'normal');

  doc.autoTable({
    startY: afterBoysY + 3,
    head: [["Date", "Sheet", "Name", "Roll", "Status"]],
    body: girls.length ? buildRows(girls) : [["-", "-", "No orders", "-", "-"]],
    theme: "grid",
    headStyles: { fillColor: [220, 220, 220], textColor: [0, 0, 0], fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { textColor: [0, 0, 0], fontSize: 8 },
    styles: { lineColor: [150, 150, 150], lineWidth: 0.2, cellPadding: 1.5 },
    alternateRowStyles: { fillColor: [250, 250, 250] }
  });

  doc.save(`Sheet_Receivers_${filenameSuffix}.pdf`);
}

window.downloadReceiversPDF = () => {
  const printedOrders = sheetOrdersData.filter(o => o.printed && (o.gender === 'male' || o.gender === 'female'));
  if (!printedOrders.length) { alert("এখনো কোনো অর্ডার প্রিন্ট সম্পন্ন হয়নি।"); return; }
  buildReceiversPDF(printedOrders, "Sheet Receivers List", localDateKey(new Date()));
};

function generateTodayReceiversPDF() {
  const todayKey = localDateKey(new Date());
  const todaysOrders = sheetOrdersData.filter(o => {
    if (o.gender !== 'male' && o.gender !== 'female') return false;
    const t = tsToDate(o.orderedAt);
    return t && localDateKey(t) === todayKey;
  });
  if (!todaysOrders.length) return false;

  buildReceiversPDF(
    todaysOrders,
    `Sheet Receivers List — ${formatBusinessDateLabel(todayKey)}`,
    `${todayKey}_${Date.now()}`
  );
  return true;
}

window.downloadTodayReceiversPDF = () => {
  const ok = generateTodayReceiversPDF();
  if (!ok) alert("আজকে এখনো কোনো অর্ডার আসেনি।");
};

let autoReceiversFiredKey = null;
window.maybeAutoDownloadReceiversPDF = () => {
  if (currentUserRole !== 'treasurer') return;
  const now = new Date();
  if (now.getHours() < orderConfig.windowEndHour) return;
  const todayKey = localDateKey(now);
  if (autoReceiversFiredKey === todayKey) return;

  const generated = generateTodayReceiversPDF();
  if (generated) autoReceiversFiredKey = todayKey;
};

function renderSubscriberExpenseBreakdown() {
  const tbody = document.getElementById('sub-expense-breakdown');
  if (!tbody || currentUserRole !== 'subscriber' || !currentSubscriberRoll) return;
  const roll = currentSubscriberRoll;
  const student = students.find(s => s.roll === roll);
  const joinTime = student ? tsToDate(student.addedAt) : null;
  const netCostById = getSharedExpenseNetCosts();

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
    rows.push({ time: tsToDate(o.orderedAt) || new Date(0), purpose: `শিট প্রিন্ট: ${o.sheetTitle}`, tag: 'লেকচার শিট', amount: o.price || 0 });
  });
  rows.sort((a, b) => b.time - a.time);

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td class="activity-meta">${r.time.toLocaleDateString('en-US')}</td>
      <td>${r.purpose || '—'} <span class="activity-meta">(${r.tag})</span></td>
      <td class="num due-neg">৳${r.amount.toFixed(2)}</td>
    </tr>
  `).join('') || `<tr><td colspan="3" class="activity-meta">এখনো আপনার হিসাব থেকে কোনো খরচ কাটা হয়নি।</td></tr>`;
}

function renderExpenseTargetOptions() {
  const sel = document.getElementById('expense-target-roll');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = students.map(s => `<option value="${s.roll}">${s.name} (Roll ${s.roll})</option>`).join('')
    || `<option value="">কোনো সাবস্ক্রাইবার নেই</option>`;
  if (prev && students.some(s => String(s.roll) === prev)) sel.value = prev;
}

function renderExpenseMultiTargetOptions() {
  const box = document.getElementById('expense-multi-target-list');
  if (!box) return;
  const prevChecked = new Set(Array.from(document.querySelectorAll('.expense-multi-check:checked')).map(cb => cb.value));
  box.innerHTML = students.map(s => `
    <label style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:.86rem;">
      <input type="checkbox" class="expense-multi-check" value="${s.roll}" ${prevChecked.has(String(s.roll)) ? 'checked' : ''} style="width:15px;height:15px;">
      <span>${s.name} (Roll ${s.roll})</span>
    </label>
  `).join('') || `<div class="activity-meta">কোনো সাবস্ক্রাইবার নেই।</div>`;
}

window.onExpenseChargeTypeChange = () => {
  const type = document.getElementById('expense-charge-type').value;
  document.getElementById('expense-target-wrap').classList.toggle('hidden', type !== 'individual');
  document.getElementById('expense-target-multi-wrap').classList.toggle('hidden', type !== 'multiple');
  if (type === 'multiple') renderExpenseMultiTargetOptions();
};

function roleLabel(role) {
  if (role === 'subscriber') return 'Subscriber';
  if (role === 'girls_admin') return 'মেয়েদের এডমিন';
  if (role === 'chele_admin') return 'ছেলেদের এডমিন';
  if (role === 'treasurer') return 'Treasurer';
  return 'Pending';
}

function renderNewUserRollOptions() {
  const sel = document.getElementById('new-user-roll');
  if (!sel) return;
  const prev = sel.value;
  const takenRolls = new Set(usersData.filter(u => u.role === 'subscriber' && u.roll != null).map(u => String(u.roll)));
  sel.innerHTML = students.map(s =>
    `<option value="${s.roll}" ${takenRolls.has(String(s.roll)) ? 'disabled' : ''}>${s.name} (Roll ${s.roll})${takenRolls.has(String(s.roll)) ? ' — আগে থেকেই অ্যাকাউন্ট আছে' : ''}</option>`
  ).join('') || `<option value="">কোনো সাবস্ক্রাইবার নেই</option>`;
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

  if (!name || !email || !password) { alert("নাম, ইমেইল ও পাসওয়ার্ড — সবগুলো দিন।"); return; }
  if (password.length < 6) { alert("পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।"); return; }
  if (role === 'subscriber' && !roll) { alert("Subscriber এর জন্য একজন সাবস্ক্রাইবার নির্বাচন করুন।"); return; }
  if (role === 'subscriber' && usersData.some(u => u.role === 'subscriber' && u.roll === roll)) {
    alert("এই সাবস্ক্রাইবারের জন্য আগে থেকেই একটি অ্যাকাউন্ট আছে।"); return;
  }

  const btn = document.getElementById('add-user-btn');
  if (btn) { btn.disabled = true; btn.textContent = "তৈরি হচ্ছে…"; }

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
    alert(`✓ ${name} এর অ্যাকাউন্ট তৈরি হয়েছে এবং "${roleLabel(role)}" হিসেবে সক্রিয় করা হয়েছে।`);
    document.getElementById('new-user-name').value = "";
    document.getElementById('new-user-email').value = "";
    document.getElementById('new-user-password').value = "";
  } catch (e) {
    const code = e && e.code;
    let msg = "অ্যাকাউন্ট তৈরি করা যায়নি। কারণ: " + (e && e.message ? e.message : e);
    if (code === 'auth/email-already-in-use') msg = "এই ইমেইলে ইতিমধ্যে একটি অ্যাকাউন্ট আছে।";
    if (code === 'auth/invalid-email') msg = "সঠিক ইমেইল ঠিকানা দিন।";
    alert(msg);
  } finally {
    try { await deleteApp(secondaryApp); } catch (_) {}
    if (btn) { btn.disabled = false; btn.textContent = "🔑 অ্যাকাউন্ট তৈরি করুন"; }
  }
};

function renderUsersList() {
  const tbody = document.getElementById('users-list-body');
  if (!tbody) return;
  if (!usersData.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="activity-meta">এখনো কোনো লগইন অ্যাকাউন্ট তৈরি করা হয়নি।</td></tr>`;
    renderNewUserRollOptions();
    return;
  }
  const sorted = [...usersData].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'bn'));
  tbody.innerHTML = sorted.map(u => `
    <tr>
      <td>${u.name || '—'}</td>
      <td class="activity-meta">${u.email || '—'}</td>
      <td>${roleLabel(u.role)}</td>
      <td class="num">${u.role === 'subscriber' && u.roll != null ? u.roll : '—'}</td>
      <td><button class="icon-btn" onclick="revokeUserAccess('${u.id}', '${(u.name || u.email || '').replace(/'/g, "")}')">অ্যাক্সেস বাতিল</button></td>
    </tr>
  `).join('');
  renderNewUserRollOptions();
}

window.revokeUserAccess = async (uid, label) => {
  if (!confirm(`${label} এর অ্যাক্সেস বাতিল করতে চান?`)) return;
  try {
    await deleteDoc(doc(db, "users", uid));
  } catch (e) {
    alert("অ্যাক্সেস বাতিল করা যায়নি। কারণ: " + (e && e.message ? e.message : e));
  }
};

window.filterStudents = () => {
  const q = document.getElementById('student-search').value.trim().toLowerCase();
  document.querySelectorAll('#student-body tr').forEach(tr => {
    if (!tr.dataset.name) return;
    const match = tr.dataset.name.includes(q) || tr.dataset.roll.includes(q);
    tr.style.display = match ? "" : "none";
  });
};

function recomputeCollections() {
  collectionsData = {};
  const rolls = new Set([
    ...Object.keys(legacyCollectionsData),
    ...Object.keys(paymentsData)
  ]);
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
      if (pTime && (!latestTime || pTime > latestTime)) {
        latestAt = p.addedAt;
        latestBy = p.addedBy;
      }
    });

    collectionsData[roll] = {
      amount: legacyAmt + paysAmt,
      updatedBy: latestBy,
      updatedAt: latestAt,
      paymentCount: pays.length
    };
  });

  invalidateShareCache();

  renderStudents();
  renderSummary();
  if (currentUserRole === 'girls_admin') renderGirlsAdminPanel();
  if (currentUserRole === 'chele_admin') renderBoysAdminPanel();
  if (currentUserRole === 'subscriber') renderSubscriberPanel();
}

window.addPayment = async (roll) => {
  const input = document.getElementById(`pay-${roll}`);
  const amt = parseFloat(input ? input.value : "");
  if (!amt || amt <= 0) { alert("সঠিক পরিমাণ লিখুন।"); return; }
  const student = students.find(s => s.roll === roll);
  await addDoc(collection(db, "payments"), {
    roll, amount: amt, addedBy: currentTreasurerName, addedAt: serverTimestamp()
  });
  await addDoc(collection(db, "activity"), {
    type: "payment",
    actor: currentTreasurerName,
    detail: `${student ? student.name : 'Roll ' + roll} (Roll ${roll}) থেকে ৳${amt.toFixed(2)} নতুন জমা যোগ হয়েছে`,
    amount: amt,
    createdAt: serverTimestamp()
  });
  if (input) input.value = "";
};

window.saveDonation = async () => {
  const donorName = document.getElementById('donation-name').value.trim();
  const amount = parseFloat(document.getElementById('donation-amount').value);
  const note = document.getElementById('donation-note').value.trim();
  if (!amount || amount <= 0) { alert("Please enter a valid amount."); return; }
  await addDoc(collection(db, "donations"), {
    donorName: donorName || "Anonymous", amount, note, addedBy: currentTreasurerName, addedAt: serverTimestamp()
  });
  await addDoc(collection(db, "activity"), {
    type: "donation", actor: currentTreasurerName,
    detail: `Fund of ৳${amount.toFixed(2)} added from ${donorName || 'an anonymous donor'}`,
    amount, createdAt: serverTimestamp()
  });
  document.getElementById('donation-name').value = "";
  document.getElementById('donation-amount').value = "";
  document.getElementById('donation-note').value = "";
};

window.saveExpense = async () => {
  const desc = document.getElementById('expense-desc').value.trim();
  const amount = parseFloat(document.getElementById('expense-amount').value);
  if (!desc || !amount || amount <= 0) { alert("Please enter a description and a valid amount."); return; }

  const chargeType = document.getElementById('expense-charge-type').value;
  const date = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });

  if (chargeType === 'multiple') {
    const checkedRolls = Array.from(document.querySelectorAll('.expense-multi-check:checked')).map(cb => parseInt(cb.value));
    if (!checkedRolls.length) { alert("অনুগ্রহ করে অন্তত একজন সাবস্ক্রাইবার নির্বাচন করুন।"); return; }
    const targets = checkedRolls.map(roll => students.find(s => s.roll === roll)).filter(Boolean);
    if (!confirm(`${targets.length} জন সাবস্ক্রাইবারের প্রত্যেকের হিসাব থেকে ৳${amount.toFixed(2)} করে কাটা হবে — "${desc}"।`)) return;
    try {
      await Promise.all(targets.map(t => addDoc(collection(db, "expenses"), {
        description: desc, amount, date, addedBy: currentTreasurerName, addedAt: serverTimestamp(),
        chargeType: 'individual', targetRoll: t.roll, targetName: t.name
      })));
      await addDoc(collection(db, "activity"), {
        type: "expense", actor: currentTreasurerName,
        detail: `৳${amount.toFixed(2)} করে "${desc}" — ${targets.length} জনের থেকে একসাথে কাটা হয়েছে`,
        amount: amount * targets.length, createdAt: serverTimestamp()
      });
    } catch (e) {
      alert("খরচ যোগ করা যায়নি। কারণ: " + (e && e.message ? e.message : e));
      return;
    }
  } else {
    let targetRoll = null, targetName = null;
    if (chargeType === 'individual') {
      const rawRoll = document.getElementById('expense-target-roll').value;
      targetRoll = rawRoll ? parseInt(rawRoll) : null;
      const student = students.find(s => s.roll === targetRoll);
      if (!targetRoll || !student) { alert("অনুগ্রহ করে একজন সাবস্ক্রাইবার নির্বাচন করুন।"); return; }
      targetName = student.name;
    }
    await addDoc(collection(db, "expenses"), {
      description: desc, amount, date, addedBy: currentTreasurerName, addedAt: serverTimestamp(),
      chargeType, targetRoll, targetName
    });
    await addDoc(collection(db, "activity"), {
      type: "expense", actor: currentTreasurerName,
      detail: chargeType === 'individual'
        ? `ব্যক্তিগত খরচ ৳${amount.toFixed(2)} "${desc}" — ${targetName} (Roll ${targetRoll})`
        : `Expense of ৳${amount.toFixed(2)} added for "${desc}"`,
      amount, createdAt: serverTimestamp()
    });
  }

  document.getElementById('expense-desc').value = "";
  document.getElementById('expense-amount').value = "";
  document.getElementById('expense-charge-type').value = "all";
  onExpenseChargeTypeChange();
};

function renderOrderTimingSettingsForm() {
  const s = document.getElementById('cfg-window-start');
  const e = document.getElementById('cfg-window-end');
  const c = document.getElementById('cfg-cutoff');
  const dsc = document.getElementById('cfg-discount');
  if (s && document.activeElement !== s) s.value = orderConfig.windowStartHour;
  if (e && document.activeElement !== e) e.value = orderConfig.windowEndHour;
  if (c && document.activeElement !== c) c.value = orderConfig.cutoffHour;
  if (dsc && document.activeElement !== dsc) dsc.value = orderConfig.discountPercent || 0;
  const preview = document.getElementById('cfg-preview');
  if (preview) {
    const discountNote = (orderConfig.discountPercent > 0) ? ` বর্তমানে সবার জন্য ${orderConfig.discountPercent}% ডিসকাউন্ট চালু আছে।` : '';
    preview.textContent = `অর্ডার নেওয়া হচ্ছে ${formatHourLabel(orderConfig.windowStartHour)} থেকে ${formatHourLabel(orderConfig.windowEndHour)} পর্যন্ত। ${formatHourLabel(orderConfig.cutoffHour)}-এর পরের অর্ডার পরের দিনের ব্যাচে যোগ হবে।${discountNote}`;
  }
}

window.saveOrderTimingSettings = async () => {
  const start = parseInt(document.getElementById('cfg-window-start').value, 10);
  const end = parseInt(document.getElementById('cfg-window-end').value, 10);
  const cutoff = parseInt(document.getElementById('cfg-cutoff').value, 10);
  const discountRaw = document.getElementById('cfg-discount').value;
  const discountPercent = discountRaw === '' ? 0 : parseFloat(discountRaw);
  if ([start, end, cutoff].some(v => isNaN(v) || v < 0 || v > 23)) {
    alert("প্রতিটি ঘণ্টা ০ থেকে ২৩ এর মধ্যে হতে হবে।");
    return;
  }
  if (start >= end) {
    alert("শুরুর সময় শেষ সময়ের আগে হতে হবে।");
    return;
  }
  if (isNaN(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    alert("ডিসকাউন্ট ০ থেকে ১০০ এর মধ্যে হতে হবে।");
    return;
  }
  try {
    await setDoc(doc(db, "settings", "orderConfig"), {
      windowStartHour: start, windowEndHour: end, cutoffHour: cutoff, discountPercent,
      updatedBy: currentTreasurerName, updatedAt: serverTimestamp()
    }, { merge: true });
    alert("সংরক্ষণ করা হয়েছে।");
  } catch (e) {
    alert("সংরক্ষণ করা যায়নি। কারণ: " + (e && e.message ? e.message : e));
  }
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
  document.getElementById('new-sheet-title').value = "";
  document.getElementById('new-sheet-pages').value = "";
  document.getElementById('new-sheet-subject').value = "";
  document.getElementById('new-sheet-card').value = "";
  document.getElementById('new-sheet-custom-price').value = "";
  window.updateNewSheetPricePreview();
  const btn = document.getElementById('add-sheet-btn');
  const cancelBtn = document.getElementById('cancel-sheet-edit-btn');
  if (btn) btn.textContent = '+ শিট যোগ করুন';
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
  if (btn) btn.textContent = '✓ পরিবর্তন সংরক্ষণ করুন';
  if (cancelBtn) cancelBtn.classList.remove('hidden');
  document.getElementById('new-sheet-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
};

window.addSheet = async () => {
  const title = document.getElementById('new-sheet-title').value.trim();
  const subject = document.getElementById('new-sheet-subject').value.trim();
  const cardRaw = document.getElementById('new-sheet-card').value;
  const cardNo = cardRaw !== '' ? parseFloat(cardRaw) : null;
  const pages = parseInt(document.getElementById('new-sheet-pages').value, 10);
  if (!title) { alert("শিটের নাম লিখুন।"); return; }
  if (!pages || pages <= 0) { alert("সঠিক পেজ সংখ্যা লিখুন।"); return; }
  const customPriceRaw = document.getElementById('new-sheet-custom-price').value;
  const customPrice = customPriceRaw !== '' ? parseFloat(customPriceRaw) : null;
  if (customPrice !== null && (isNaN(customPrice) || customPrice < 0)) { alert("কাস্টম দাম সঠিক হতে হবে।"); return; }
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
  } catch (e) {
    alert((editingSheetId ? "পরিবর্তন সংরক্ষণ করা যায়নি।" : "শিট যোগ করা যায়নি।") + " কারণ: " + (e && e.message ? e.message : e));
  }
};

window.deleteSheet = async (id) => {
  if (!confirm("এই শিটটি সরিয়ে দিতে চান?")) return;
  if (editingSheetId === id) window.cancelSheetEdit();
  try {
    await deleteDoc(doc(db, "sheets", id));
  } catch (e) {
    alert("শিট মুছে ফেলা যায়নি। কারণ: " + (e && e.message ? e.message : e));
  }
};

window.confirmSheetOrders = async () => {
  if (currentUserRole !== 'subscriber' || !currentSubscriberRoll) return;
  if (!isWithinOrderWindow()) { alert('⏰ ' + orderWindowMessage()); renderSheetCatalogSubscriber(); return; }

  if (isOrderBlockedByDue(currentSubscriberRoll)) {
    const remaining = getSubscriberRemaining(currentSubscriberRoll);
    const dueAmount = Math.abs(remaining).toFixed(2);
    const needToDeposit = (remaining + DUE_ORDER_BLOCK_LIMIT).toFixed(2);
    alert(
      `⛔ আপনার বাকেয়া ৳${dueAmount} — অনুমোদিত সীমা ৳${DUE_ORDER_BLOCK_LIMIT} টাকার বেশি।\n\n` +
      `📌 নতুন শিট অর্ডার করতে হলে আগে Treasurer-এর কাছে টাকা জমা দিয়ে বাকেয়া কমাতে হবে।\n\n` +
      `💰 আপনার বর্তমান অবস্থা:\n` +
      `   • বাকেয়া: ৳${dueAmount}\n` +
      `   • অর্ডার করার জন্য আরও জমা লাগবে: ৳${needToDeposit}\n\n` +
      `অনুগ্রহ করে Treasurer-এর সাথে যোগাযোগ করুন।`
    );
    renderSheetCatalogSubscriber();
    return;
  }

  const alreadyOrderedIds = new Set(sheetOrdersData.filter(o => o.roll === currentSubscriberRoll).map(o => o.sheetId));
  const checked = Array.from(document.querySelectorAll('.sheet-check:checked'))
    .map(cb => cb.value)
    .filter(id => !alreadyOrderedIds.has(id));
  if (!checked.length) { alert("অর্ডার করার জন্য নতুন কোনো শিট বাছাই করা হয়নি।"); return; }

  const chosenSheets = sheetsData.filter(s => checked.includes(s.id));
  const total = chosenSheets.reduce((a, s) => a + discountedPrice(s.price || 0), 0);
  const names = chosenSheets.map(s => {
    const dPrice = discountedPrice(s.price || 0);
    const hasDiscount = dPrice < (s.price || 0) - 0.001;
    return hasDiscount ? `${s.title} (৳${dPrice.toFixed(2)}, আগে ৳${s.price.toFixed(2)})` : `${s.title} (৳${dPrice.toFixed(2)})`;
  }).join(', ');
  const businessDate = currentBusinessDateKey();
  const cutoffNote = isPastCutoffNow()
    ? `\n\n⏰ ${formatHourLabel(orderConfig.cutoffHour)} পার হয়ে গেছে, তাই এই অর্ডারটি ${formatBusinessDateLabel(businessDate)} তারিখের ব্যাচে গণনা হবে।`
    : `\n\nএই অর্ডারটি ${formatBusinessDateLabel(businessDate)} তারিখের ব্যাচে গণনা হবে।`;
  if (!confirm(`নিচের শিটগুলো প্রিন্টের জন্য অর্ডার করবেন? মোট ৳${total.toFixed(2)} আপনার হিসাব থেকে কাটা হবে।\n\n${names}${cutoffNote}`)) return;

  const user = auth.currentUser;
  const student = students.find(s => s.roll === currentSubscriberRoll);
  const batchSeq = currentBatchSeqFor(businessDate);
  try {
    await Promise.all(chosenSheets.map(s => addDoc(collection(db, "sheetOrders"), {
      roll: currentSubscriberRoll,
      studentName: student ? student.name : currentTreasurerName,
      gender: (student && student.gender) || 'unspecified',
      sheetId: s.id,
      sheetTitle: s.title,
      price: discountedPrice(s.price || 0),
      originalPrice: s.price || 0,
      orderedAt: serverTimestamp(),
      businessDate,
      batchSeq,
      printed: false, printedAt: null, printedBy: null,
      received: false, receivedAt: null, receivedBy: null,
      addedBy: currentTreasurerName,
      orderedByUid: user ? user.uid : null
    })));
  } catch (e) {
    alert("শিট অর্ডার করা যায়নি। কারণ: " + (e && e.message ? e.message : e));
  }
};

window.openVoucherModal = () => {
  const box = document.getElementById('voucher-box');
  document.getElementById('voucher-date').textContent = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  document.getElementById('voucher-treasurer').textContent = currentTreasurerName;
  document.getElementById('voucher-rows').innerHTML = expensesData.slice(0, 12).map(e =>
    `<tr><td style="padding:4px 0;">${e.description}</td><td style="padding:4px 0;text-align:right;">৳${e.amount.toFixed(2)}</td></tr>`
  ).join('');
  const total = expensesData.reduce((a, e) => a + (e.amount || 0), 0);
  document.getElementById('voucher-total').textContent = "৳" + total.toFixed(2);

  box.style.position = 'fixed'; box.style.left = '-9999px'; box.style.display = 'block';
  html2canvas(box, { scale: 2 }).then(canvas => {
    const link = document.createElement('a');
    link.download = 'Voucher.png';
    link.href = canvas.toDataURL("image/png");
    link.click();
    box.style.display = 'none';
  });
};

window.downloadFullReport = () => {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const avgEqualShare = getEqualShare();
  const totalCollection = students.reduce((a, s) => a + ((collectionsData[s.roll] || {}).amount || 0), 0);
  const totalDonation = donationsData.reduce((a, d) => a + (d.amount || 0), 0);
  const totalSheetCharges = sheetOrdersData.reduce((a, o) => a + (o.price || 0), 0);
  const totalExpense = expensesData.reduce((a, e) => a + (e.amount || 0), 0) + totalSheetCharges;
  const balance = totalCollection + totalDonation - totalExpense;
  const now = new Date();

  doc.setFontSize(16); doc.setTextColor(0, 0, 0);
  doc.text("Class Treasury Ledger — Report", 14, 18);
  doc.setFontSize(9); doc.setTextColor(80, 80, 80);
  doc.text(`Prepared by: ${currentTreasurerName}   |   ${now.toLocaleString()}`, 14, 24);

  doc.autoTable({
    startY: 30,
    head: [["Total Collection", "Total Fund", "Total Expense", "Balance in Hand", "Avg Share"]],
    body: [[
      `Tk ${totalCollection.toFixed(2)}`, `Tk ${totalDonation.toFixed(2)}`,
      `Tk ${totalExpense.toFixed(2)}`, `Tk ${balance.toFixed(2)}`, `Tk ${avgEqualShare.toFixed(2)}`
    ]],
    theme: "grid",
    headStyles: { fillColor: [220, 220, 220], textColor: [0, 0, 0], fontSize: 9, fontStyle: 'bold' },
    bodyStyles: { textColor: [0, 0, 0], fontSize: 9 },
    styles: { halign: "center", lineColor: [150, 150, 150], lineWidth: 0.2 }
  });

  doc.setFontSize(11); doc.setTextColor(0, 0, 0);
  doc.text("Student Ledger", 14, doc.lastAutoTable.finalY + 10);
  const studentRows = students.map(s => {
    const amt = (collectionsData[s.roll] || {}).amount || 0;
    const personalCharge = getPersonalCharge(s.roll);
    const rem = amt - getEqualShareForStudent(s.roll) - personalCharge;
    return [s.roll, s.name, s.mobile || "-", `Tk ${amt.toFixed(2)}`, `${rem >= 0 ? "" : "-"}Tk ${Math.abs(rem).toFixed(2)}`];
  });
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 14,
    head: [["Roll", "Name", "Mobile", "Collected", "Due / Credit"]],
    body: studentRows,
    theme: "striped",
    headStyles: { fillColor: [220, 220, 220], textColor: [0, 0, 0], fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { textColor: [0, 0, 0], fontSize: 8 },
    styles: { lineColor: [150, 150, 150], lineWidth: 0.2 },
    alternateRowStyles: { fillColor: [250, 250, 250] }
  });

  if (donationsData.length) {
    doc.setFontSize(11); doc.setTextColor(0, 0, 0);
    doc.text("Fund", 14, doc.lastAutoTable.finalY + 10);
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 14,
      head: [["Contributor", "Amount", "Note", "Added By"]],
      body: donationsData.map(d => [d.donorName || "Anonymous", `Tk ${d.amount.toFixed(2)}`, d.note || "-", d.addedBy || "-"]),
      theme: "grid",
      headStyles: { fillColor: [220, 220, 220], textColor: [0, 0, 0], fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { textColor: [0, 0, 0], fontSize: 8 },
      styles: { lineColor: [150, 150, 150], lineWidth: 0.2 }
    });
  }

  if (expensesData.length) {
    doc.setFontSize(11); doc.setTextColor(0, 0, 0);
    doc.text("Expenses", 14, doc.lastAutoTable.finalY + 10);
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 14,
      head: [["Date", "Description", "Amount", "Charged To", "Added By"]],
      body: expensesData.map(e => [
        e.date, e.description, `Tk ${e.amount.toFixed(2)}`,
        e.chargeType === 'individual' ? `${e.targetName || 'Roll ' + e.targetRoll} (personal)` : "All (equal split)",
        e.addedBy || "-"
      ]),
      theme: "grid",
      headStyles: { fillColor: [220, 220, 220], textColor: [0, 0, 0], fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { textColor: [0, 0, 0], fontSize: 8 },
      styles: { lineColor: [150, 150, 150], lineWidth: 0.2 }
    });
  }

  const finalY = doc.lastAutoTable.finalY + 15;
  doc.setFontSize(9); doc.setTextColor(0, 0, 0);
  doc.text(`Verified by: ${currentTreasurerName}`, 14, finalY);
  doc.setFontSize(8); doc.setTextColor(80, 80, 80);
  doc.text(`Generated on ${now.toLocaleDateString()}`, 14, finalY + 5);

  doc.save(`Treasury_Report_${now.toISOString().slice(0,10)}.pdf`);
};