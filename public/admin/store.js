// Couche de données du dashboard : Firestore en temps réel.
import { db, DEFAULT_SETTINGS, SEED_SERVICES, SEED_PRODUCTS, fmtDate, toMin, toTime, busyId, dayGrid } from '../js/firebase.js';
import {
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch, getDoc, getDocs, query, where, increment,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export const COLS = ['patients', 'appointments', 'services', 'treatments', 'payments', 'products', 'stockMoves', 'expenses', 'closures'];
export const D = { settings: { ...DEFAULT_SETTINGS }, ...Object.fromEntries(COLS.map((c) => [c, []])) };

const SCHEMAS = {
  patients: { name: 's', phone: 's', email: 's', birthdate: 's', gender: 's', address: 's', notes: 's' },
  appointments: { patientId: 's', name: 's', phone: 's', serviceId: 's', date: 's', time: 's', duration: 'n', status: 's', notes: 's', source: 's' },
  services: { name: 's', description: 's', price: 'n', duration: 'n', icon: 's', public: 'b' },
  treatments: { patientId: 's', serviceId: 's', label: 's', total: 'n', date: 's', status: 's', notes: 's' },
  payments: { patientId: 's', treatmentId: 's', amount: 'n', method: 's', date: 's', note: 's' },
  products: { name: 's', category: 's', quantity: 'n', unit: 's', minQty: 'n', price: 'n', supplier: 's', expiry: 's' },
  stockMoves: { productId: 's', type: 's', qty: 'n', date: 's', note: 's' },
  expenses: { label: 's', category: 's', amount: 'n', date: 's', note: 's' },
  closures: { date: 's', reason: 's' },
};
function clean(col, body) {
  const out = {};
  for (const [k, t] of Object.entries(SCHEMAS[col])) {
    if (!(k in body)) continue;
    let v = body[k];
    if (t === 's') v = v == null ? '' : String(v).trim().slice(0, 3000);
    else if (t === 'n') { v = Number(v); if (!Number.isFinite(v)) v = 0; }
    else v = !!v;
    out[k] = v;
  }
  return out;
}
const err = (message, status) => Object.assign(new Error(message), { status });
const nowIso = () => new Date().toISOString();
const today = () => fmtDate(new Date());
const normPhone = (p) => String(p || '').replace(/[^\d+]/g, '');
const newRef = (col) => doc(collection(db, col));
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const isTime = (s) => /^\d{2}:\d{2}$/.test(s || '');
const slot = () => Number(D.settings.slotMinutes) || 30;

/* ------------------------------------------------------------ temps réel */
const norm = (v) => (v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v);
const fromDoc = (d) => { const o = { id: d.id, ...d.data() }; for (const k in o) o[k] = norm(o[k]); return o; };

/** Écoute toutes les collections ; onChange({ added }) est appelé à chaque modification. */
export function subscribe(onChange, onError) {
  const loaded = new Set(); const total = COLS.length + 1;
  const ready = () => loaded.size === total;
  const unsubs = [
    onSnapshot(doc(db, 'settings', 'clinic'), (s) => {
      D.settings = { ...DEFAULT_SETTINGS, ...(s.data() || {}) }; loaded.add('settings');
      if (ready()) onChange({ added: [] });
    }, onError),
    ...COLS.map((col) => onSnapshot(collection(db, col), (snap) => {
      const first = !loaded.has(col);
      D[col] = snap.docs.map(fromDoc);
      loaded.add(col);
      const added = first || col !== 'appointments' ? [] : snap.docChanges().filter((c) => c.type === 'added' && !c.doc.metadata.hasPendingWrites).map((c) => fromDoc(c.doc));
      if (ready()) onChange({ added });
    }, onError)),
  ];
  return () => unsubs.forEach((u) => u());
}

/** Premier lancement : crée les paramètres, services et stock de départ. */
export async function ensureSeed() {
  const ref = doc(db, 'settings', 'clinic');
  if ((await getDoc(ref)).exists()) return false;
  const b = writeBatch(db);
  b.set(ref, { ...DEFAULT_SETTINGS, createdAt: nowIso() });
  const services = await getDocs(collection(db, 'services'));
  if (services.empty) SEED_SERVICES.forEach((s) => b.set(newRef('services'), { ...s, createdAt: nowIso() }));
  const products = await getDocs(collection(db, 'products'));
  if (products.empty) SEED_PRODUCTS.forEach((p) => b.set(newRef('products'), { ...p, createdAt: nowIso() }));
  await b.commit();
  return true;
}

/* ------------------------------------------------------------ créneaux occupés (collection publique "busy") */
function coveredSlots(date, time, duration) {
  const g = dayGrid(D.settings, date);
  const st = toMin(time), en = st + (Number(duration) || g.step);
  return g.slots.filter((m) => m < en && m + g.step > st).map(toTime);
}
/** Recalcule les documents "busy" (créneaux visibles comme occupés sur le site) pour ces dates. */
export async function syncBusy(dates, changed, removedIds = []) {
  let list = D.appointments.filter((a) => !removedIds.includes(a.id) && a.id !== changed?.id);
  if (changed) list = list.concat(changed);
  for (const date of new Set(dates.filter(Boolean))) {
    const want = new Map();
    for (const a of list.filter((x) => x.date === date && x.status !== 'cancelled')) {
      for (const t of coveredSlots(date, a.time, a.duration)) if (!want.has(t)) want.set(t, a.id);
    }
    const snap = await getDocs(query(collection(db, 'busy'), where('date', '==', date)));
    const have = new Map(snap.docs.map((d) => [d.data().time, d]));
    const b = writeBatch(db); let n = 0;
    for (const [t, d] of have) {
      if (!want.has(t)) { b.delete(d.ref); n++; }
      else if (d.data().apptId !== want.get(t)) { b.set(d.ref, { date, time: t, apptId: want.get(t) }); n++; }
    }
    for (const [t, id] of want) if (!have.has(t)) { b.set(doc(db, 'busy', busyId(date, t)), { date, time: t, apptId: id }); n++; }
    if (n) await b.commit();
  }
}
export function hasConflict(date, time, duration, ignoreId) {
  const st = toMin(time), en = st + (Number(duration) || slot());
  return D.appointments.some((a) => a.id !== ignoreId && a.date === date && a.status !== 'cancelled' &&
    st < toMin(a.time) + (Number(a.duration) || slot()) && en > toMin(a.time));
}

/* ------------------------------------------------------------ patients */
export async function findOrCreatePatient(name, phone) {
  const np = normPhone(phone);
  const found = np && D.patients.find((p) => normPhone(p.phone) === np);
  if (found) return found;
  const ref = newRef('patients');
  const p = { name, phone: phone || '', email: '', birthdate: '', gender: '', address: '', notes: '', createdAt: nowIso() };
  await setDoc(ref, p);
  return { id: ref.id, ...p };
}
/** Rattache les demandes en ligne à une fiche patient (créée si besoin, retrouvée par téléphone). */
const linking = new Set();
export async function linkWebAppointments() {
  for (const a of D.appointments.filter((x) => !x.patientId && !linking.has(x.id))) {
    linking.add(a.id);
    try {
      const p = await findOrCreatePatient(a.name, a.phone);
      await updateDoc(doc(db, 'appointments', a.id), { patientId: p.id, duration: a.duration || slot() });
    } catch (e) { console.error(e); linking.delete(a.id); }
  }
}

/* ------------------------------------------------------------ rendez-vous */
async function saveAppointment(body, id) {
  const b = clean('appointments', body);
  const old = id ? D.appointments.find((x) => x.id === id) : null;
  if (id && !old) throw err('Rendez-vous introuvable.');
  const item = id ? { ...old, ...b } : { duration: slot(), status: 'confirmed', source: 'cabinet', ...b };
  if (!isDate(item.date) || !isTime(item.time)) throw err('Date ou heure invalide.');
  if (!item.duration) item.duration = slot();
  if (b.patientId || (!id && item.patientId)) {
    const pt = D.patients.find((x) => x.id === item.patientId);
    if (pt) { item.name = pt.name; item.phone = pt.phone; }
  } else if (!item.patientId) {
    if (!item.name) throw err('Nom du patient requis.');
    item.patientId = (await findOrCreatePatient(item.name, item.phone)).id;
  }
  const check = !id || 'date' in b || 'time' in b || 'duration' in b || ('status' in b && b.status !== 'cancelled');
  if (check && item.status !== 'cancelled' && !body.force && hasConflict(item.date, item.time, item.duration, id)) throw err('Ce créneau est déjà occupé.', 409);
  const { id: _omit, ...data } = item;
  if (id) {
    data.updatedAt = nowIso();
    await updateDoc(doc(db, 'appointments', id), data);
  } else {
    const ref = newRef('appointments');
    data.ref = ref.id.slice(0, 6).toUpperCase(); data.createdAt = nowIso();
    await setDoc(ref, data); item.id = ref.id;
  }
  await syncBusy([item.date, old?.date], item);
  return item;
}

/* ------------------------------------------------------------ API générique */
export async function create(col, body) {
  if (!SCHEMAS[col]) throw err('Collection inconnue');
  if (col === 'appointments') return saveAppointment(body);
  const item = { ...clean(col, body), createdAt: nowIso() };
  if (['payments', 'expenses', 'treatments'].includes(col) && !item.date) item.date = today();
  if (col === 'closures') {
    if (!isDate(item.date)) throw err('Date invalide.');
    await setDoc(doc(db, 'closures', item.date), item); // identifiant = date (vérifié par les règles publiques)
    return { id: item.date, ...item };
  }
  if (col === 'stockMoves') {
    const prod = D.products.find((x) => x.id === item.productId);
    if (!prod) throw err('Produit introuvable.');
    item.qty = Math.abs(item.qty); if (!item.qty) throw err('Quantité invalide.');
    if (item.type !== 'in' && item.type !== 'out') item.type = 'in';
    if (item.type === 'out' && prod.quantity < item.qty) throw err(`Stock insuffisant (disponible : ${prod.quantity}).`);
    if (!item.date) item.date = today();
    const ref = newRef('stockMoves'); const b = writeBatch(db);
    b.set(ref, item);
    b.update(doc(db, 'products', prod.id), { quantity: increment(item.type === 'in' ? item.qty : -item.qty) });
    await b.commit();
    return { id: ref.id, ...item };
  }
  if (col === 'services') item.order = D.services.length;
  const ref = newRef(col);
  await setDoc(ref, item);
  return { id: ref.id, ...item };
}

export async function update(col, id, body) {
  if (!SCHEMAS[col]) throw err('Collection inconnue');
  if (col === 'appointments') return saveAppointment(body, id);
  if (col === 'stockMoves') throw err('Un mouvement de stock ne peut pas être modifié.');
  const upd = { ...clean(col, body), updatedAt: nowIso() };
  if (col === 'patients') {
    const b = writeBatch(db);
    b.update(doc(db, 'patients', id), upd);
    const p = { ...D.patients.find((x) => x.id === id), ...upd };
    D.appointments.filter((a) => a.patientId === id).forEach((a) => b.update(doc(db, 'appointments', a.id), { name: p.name, phone: p.phone }));
    await b.commit();
    return p;
  }
  await updateDoc(doc(db, col, id), upd);
  return { id, ...upd };
}

export async function remove(col, id) {
  if (!SCHEMAS[col]) throw err('Collection inconnue');
  const ops = [(b) => b.delete(doc(db, col, id))];
  let busyDates = [];
  if (col === 'patients') {
    for (const k of ['treatments', 'payments', 'appointments']) D[k].filter((x) => x.patientId === id).forEach((x) => ops.push((b) => b.delete(doc(db, k, x.id))));
    busyDates = D.appointments.filter((a) => a.patientId === id).map((a) => a.date);
  }
  if (col === 'appointments') busyDates = [D.appointments.find((a) => a.id === id)?.date];
  if (col === 'treatments') D.payments.filter((p) => p.treatmentId === id).forEach((p) => ops.push((b) => b.update(doc(db, 'payments', p.id), { treatmentId: '' })));
  if (col === 'products') D.stockMoves.filter((m) => m.productId === id).forEach((m) => ops.push((b) => b.delete(doc(db, 'stockMoves', m.id))));
  if (col === 'stockMoves') {
    const m = D.stockMoves.find((x) => x.id === id); const prod = m && D.products.find((x) => x.id === m.productId);
    if (prod) ops.push((b) => b.update(doc(db, 'products', prod.id), { quantity: Math.max(0, prod.quantity + (m.type === 'in' ? -m.qty : m.qty)) }));
  }
  const removed = col === 'appointments' ? [id] : col === 'patients' ? D.appointments.filter((a) => a.patientId === id).map((a) => a.id) : [];
  await commitOps(ops);
  if (busyDates.length) await syncBusy(busyDates, null, removed);
}

async function commitOps(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(db);
    ops.slice(i, i + 400).forEach((fn) => fn(b));
    await b.commit();
  }
}

export async function saveSettings(body) {
  const allowed = ['clinicName', 'tagline', 'phone', 'whatsapp', 'email', 'address', 'facebook', 'tiktok', 'slotMinutes', 'breakStart', 'breakEnd', 'hours'];
  const upd = {};
  for (const k of allowed) if (k in body) upd[k] = k === 'slotMinutes' ? Math.max(10, Math.min(120, Number(body[k]) || 30)) : body[k];
  await setDoc(doc(db, 'settings', 'clinic'), upd, { merge: true });
  if ('hours' in upd || 'slotMinutes' in upd || 'breakStart' in upd) {
    Object.assign(D.settings, upd);
    const t = today();
    await syncBusy([...new Set(D.appointments.filter((a) => a.date >= t).map((a) => a.date))]);
  }
}

/* ------------------------------------------------------------ données de démonstration */
export async function addDemo() {
  const names = ['Amina Boudiaf', 'Yacine Benali', 'Sara Khelifi', 'Mohamed Haddad', 'Lina Mansouri', 'Rayan Ziani', 'Imane Cherif', 'Karim Belkacem',
    'Nour El Houda Saidi', 'Adam Rahmani', 'Meriem Taleb', 'Walid Bouzid', 'Ines Larbi', 'Anis Meziane', 'Yasmine Djebbar', 'Hichem Ouali'];
  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  const now = new Date(); const ops = []; const put = (col, data) => { const ref = newRef(col); ops.push((b) => b.set(ref, { ...data, demo: true })); return ref.id; };
  const svc = D.services; if (!svc.length) throw err('Ajoutez au moins un service avant de générer la démo.');
  const pts = names.map((name, i) => {
    const p = { name, phone: `06${String(55000000 + i * 137911).slice(0, 8)}`, email: '', birthdate: `${1985 + (i % 25)}-0${1 + (i % 9)}-1${i % 9}`, gender: i % 2 ? 'H' : 'F', address: 'Annaba', notes: '', createdAt: new Date(now.getFullYear(), now.getMonth() - (i % 10), 3).toISOString() };
    return { id: put('patients', p), ...p };
  });
  for (const p of pts) {
    const s = rnd(svc); const months = Math.floor(Math.random() * 10);
    const start = new Date(now.getFullYear(), now.getMonth() - months, 5 + Math.floor(Math.random() * 20));
    const tid = put('treatments', { patientId: p.id, serviceId: s.id, label: s.name, total: s.price, date: fmtDate(start), status: 'en cours', notes: '', createdAt: start.toISOString() });
    let paid = 0; const parts = s.price >= 50000 ? 10 : 1 + Math.floor(Math.random() * 2);
    for (let k = 0; k <= months && k < parts; k++) {
      const amount = Math.round(s.price / parts / 100) * 100; if (paid + amount > s.price) break; paid += amount;
      const d = new Date(start); d.setMonth(d.getMonth() + k); if (d > now) break;
      put('payments', { patientId: p.id, treatmentId: tid, amount, method: rnd(['Espèces', 'Espèces', 'Chèque', 'Virement']), date: fmtDate(d), note: `Versement ${k + 1}`, createdAt: d.toISOString() });
    }
  }
  const appts = [];
  for (let i = -60; i <= 20; i++) {
    const d = new Date(); d.setDate(d.getDate() + i); const date = fmtDate(d);
    const g = dayGrid(D.settings, date);
    if (g.closed || D.closures.some((c) => c.date === date)) continue;
    const free = g.slots.filter((m) => !hasConflict(date, toTime(m), g.step));
    for (let k = 0, n = 2 + Math.floor(Math.random() * 4); k < n && free.length; k++) {
      const time = toTime(free.splice(Math.floor(Math.random() * free.length), 1)[0]);
      const p = rnd(pts); const s = rnd(svc);
      const status = i < 0 ? rnd(['done', 'done', 'done', 'cancelled', 'noshow']) : rnd(['confirmed', 'confirmed', 'pending']);
      const a = { patientId: p.id, name: p.name, phone: p.phone, serviceId: s.id, date, time, duration: g.step, status, notes: '', source: rnd(['web', 'cabinet']), ref: Math.random().toString(36).slice(2, 8).toUpperCase(), createdAt: d.toISOString(), demo: true };
      a.id = put('appointments', a); appts.push(a);
      if (status === 'done' && s.price < 50000) {
        const tid = put('treatments', { patientId: p.id, serviceId: s.id, label: s.name, total: s.price, date, status: 'terminé', notes: '', createdAt: d.toISOString() });
        put('payments', { patientId: p.id, treatmentId: tid, amount: s.price, method: 'Espèces', date, note: '', createdAt: d.toISOString() });
      }
    }
  }
  const exp = [['Loyer du cabinet', 'Loyer', 35000], ['Électricité & eau', 'Charges', 6000], ['Salaire assistante', 'Salaires', 30000], ['Commande fournitures', 'Fournitures', 15000], ['Internet & téléphone', 'Charges', 2500]];
  for (let k = 0; k < 10; k++) for (const [label, category, amount] of exp) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 10);
    put('expenses', { label, category, amount: Math.round(amount * (0.85 + Math.random() * 0.3) / 100) * 100, date: fmtDate(d), note: '', createdAt: d.toISOString() });
  }
  await commitOps(ops);
  // créneaux occupés à venir
  const t = today(); const future = appts.filter((a) => a.date >= t);
  D.appointments = D.appointments.filter((a) => !future.some((f) => f.id === a.id)).concat(future);
  await syncBusy([...new Set(future.map((a) => a.date))]);
}
export async function removeDemo() {
  const ops = []; const dates = new Set(); const ids = [];
  for (const col of COLS) for (const x of D[col]) if (x.demo) {
    ops.push((b) => b.delete(doc(db, col, x.id)));
    if (col === 'appointments' && x.date >= today()) { dates.add(x.date); ids.push(x.id); }
  }
  await commitOps(ops);
  await syncBusy([...dates], null, ids);
}
