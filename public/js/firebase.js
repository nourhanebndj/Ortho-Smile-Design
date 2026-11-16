// Initialisation Firebase partagée par le site public et le dashboard.
// (La clé "apiKey" Firebase est publique par nature : la sécurité repose sur les règles Firestore.)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export const firebaseConfig = {
  apiKey: 'AIzaSyCVJFgf7aQkR5t0jCf0dCYP9cwKZlxICkg',
  authDomain: 'ortho-smile-design.firebaseapp.com',
  projectId: 'ortho-smile-design',
  storageBucket: 'ortho-smile-design.firebasestorage.app',
  messagingSenderId: '214308757165',
  appId: '1:214308757165:web:08e8e8ae372df301d97024',
  measurementId: 'G-PVGFWLRW0B',
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const FS = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const day = (open, close, closed = false) => ({ open, close, closed });
export const DEFAULT_SETTINGS = {
  clinicName: 'Ortho Smile Design',
  tagline: 'Cabinet d’orthodontie & soins dentaires',
  phone: '0655 77 23 71',
  whatsapp: '213655772371',
  email: '',
  address: '502 Logements, El Hadjar, Annaba, Algérie',
  facebook: 'https://www.facebook.com/profile.php?id=61594913084469',
  tiktok: 'https://www.tiktok.com/@chaima.ortho0',
  slotMinutes: 30,
  breakStart: '12:30',
  breakEnd: '13:30',
  // 0 = dimanche … 6 = samedi (vendredi fermé)
  hours: { 0: day('09:00', '17:00'), 1: day('09:00', '17:00'), 2: day('09:00', '17:00'), 3: day('09:00', '17:00'), 4: day('09:00', '17:00'), 5: day('09:00', '12:00', true), 6: day('09:00', '17:00') },
};

export const SEED_SERVICES = [
  ['Consultation & diagnostic', 'Examen complet, bilan bucco-dentaire et conseils personnalisés.', 1500, 30, 'fa-stethoscope'],
  ['Orthodontie (appareil fixe)', 'Bagues métalliques ou céramiques pour aligner durablement vos dents.', 150000, 45, 'fa-teeth'],
  ['Aligneurs invisibles', 'Gouttières transparentes, discrètes et amovibles.', 250000, 45, 'fa-face-smile'],
  ['Orthodontie enfant', 'Traitement interceptif et suivi de la croissance dès le plus jeune âge.', 90000, 30, 'fa-child'],
  ['Détartrage & polissage', 'Élimination du tartre et des taches pour des gencives saines.', 3000, 30, 'fa-hand-sparkles'],
  ['Blanchiment dentaire', 'Un sourire plus éclatant en toute sécurité.', 25000, 60, 'fa-wand-magic-sparkles'],
  ['Soins conservateurs', 'Traitement des caries, composites esthétiques et dévitalisations.', 4000, 30, 'fa-tooth'],
  ['Prothèses & couronnes', 'Couronnes, bridges et prothèses sur mesure.', 30000, 45, 'fa-crown'],
  ['Contention & suivi', 'Fils et gouttières de contention pour stabiliser le résultat.', 8000, 30, 'fa-shield-heart'],
].map(([name, description, price, duration, icon], order) => ({ name, description, price, duration, icon, public: true, order }));

export const SEED_PRODUCTS = [
  ['Gants nitrile (boîte 100)', 'Consommables', 12, 'boîte', 5, 900],
  ['Masques chirurgicaux (boîte 50)', 'Consommables', 10, 'boîte', 4, 450],
  ['Bavoirs patients (paquet 125)', 'Consommables', 6, 'paquet', 2, 1200],
  ['Brackets métalliques (kit 20)', 'Orthodontie', 15, 'kit', 5, 3500],
  ['Arcs NiTi 0.014', 'Orthodontie', 40, 'pièce', 15, 250],
  ['Élastiques orthodontiques', 'Orthodontie', 30, 'sachet', 10, 300],
  ['Colle orthodontique', 'Orthodontie', 3, 'seringue', 2, 4800],
  ['Composite A2', 'Soins', 5, 'seringue', 2, 2800],
  ['Anesthésique articaïne (50 carp.)', 'Pharmacie', 4, 'boîte', 2, 5200],
  ['Aiguilles dentaires (boîte 100)', 'Pharmacie', 3, 'boîte', 1, 1800],
  ['Désinfectant surfaces 1L', 'Hygiène', 6, 'flacon', 2, 1500],
  ['Sachets de stérilisation', 'Hygiène', 8, 'boîte', 3, 1600],
].map(([name, category, quantity, unit, minQty, price]) => ({ name, category, quantity, unit, minQty, price, supplier: '', expiry: '' }));

/* ---- calcul des créneaux (partagé site / dashboard) ---- */
export const pad = (n) => String(n).padStart(2, '0');
export const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toMin = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + m; };
export const toTime = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export const busyId = (date, time) => `${date}_${time.replace(':', '')}`;

/** Grille des créneaux d'une journée selon les horaires (minutes depuis minuit). */
export function dayGrid(settings, date) {
  const step = Number(settings.slotMinutes) || 30;
  const h = settings.hours?.[new Date(date + 'T00:00:00').getDay()];
  const slots = []; let breakAt = null;
  if (!h || h.closed) return { closed: true, slots, step, breakAt };
  const open = toMin(h.open), close = toMin(h.close);
  const bs = settings.breakStart && settings.breakEnd ? toMin(settings.breakStart) : null;
  const be = bs != null ? toMin(settings.breakEnd) : null;
  for (let m = open; m + step <= close; m += step) {
    if (bs != null && be > bs && m < be && m + step > bs) { if (breakAt == null) breakAt = slots.length; continue; }
    slots.push(m);
  }
  return { closed: false, slots, step, breakAt };
}

/** Évite qu'une page reste bloquée si Firestore est injoignable ou pas encore créé. */
export const withTimeout = (p, ms = 10000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('Délai dépassé'), { code: 'timeout' })), ms))]);
