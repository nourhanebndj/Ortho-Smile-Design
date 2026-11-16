import { app, db, DEFAULT_SETTINGS, pad, fmtDate, toTime, busyId, dayGrid, withTimeout } from './firebase.js';
import { doc, getDoc, getDocs, collection, query, where, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAnalytics, isSupported } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js';

isSupported().then((ok) => ok && getAnalytics(app)).catch(() => {});
const MAX_DAYS_AHEAD = 90;

(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const fmtLong = (iso) => { const d = new Date(iso + 'T00:00:00'); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };

  $('#year').textContent = new Date().getFullYear();

  /* ---------------- navigation ---------------- */
  const nav = $('#nav'), burger = $('#burger'), links = $('#navLinks');
  addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 10), { passive: true });
  burger.addEventListener('click', () => { burger.classList.toggle('open'); links.classList.toggle('open'); });
  $$('#navLinks a').forEach((a) => a.addEventListener('click', () => { burger.classList.remove('open'); links.classList.remove('open'); }));
  const sections = $$('main section[id]');
  const spy = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) $$('#navLinks a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id));
  }), { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach((s) => spy.observe(s));

  const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12 });
  const observeReveal = () => $$('.reveal:not(.in)').forEach((el) => io.observe(el));
  observeReveal();

  /* ---------------- données publiques ---------------- */
  const state = { services: [], settings: { ...DEFAULT_SETTINGS }, today: '', maxDate: '', ym: '', date: '', time: '', days: {}, busy: new Map(), closures: new Map() };

  async function loadPublic() {
    const now = new Date(); const max = new Date(); max.setDate(max.getDate() + MAX_DAYS_AHEAD);
    state.today = fmtDate(now); state.maxDate = fmtDate(max);
    state.ym = state.today.slice(0, 7);
    renderHours();
    try {
      const [sSnap, svSnap] = await withTimeout(Promise.all([getDoc(doc(db, 'settings', 'clinic')), getDocs(collection(db, 'services'))]));
      if (sSnap.exists()) state.settings = { ...DEFAULT_SETTINGS, ...sSnap.data() };
      state.services = svSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((s) => s.public !== false)
        .sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name));
      applySettings(); renderServices(); renderServiceSelect(); renderHours();
      if (!state.services.length) $('#servicesGrid').innerHTML = '<p class="muted" style="grid-column:1/-1;text-align:center">Nos soins seront bientôt présentés ici.</p>';
    } catch (e) {
      console.error(e);
      $('#servicesGrid').innerHTML = '<p class="muted" style="grid-column:1/-1;text-align:center">Impossible de charger les soins pour le moment. Rechargez la page.</p>';
    }
    loadMonth();
  }

  /** Charge les créneaux occupés et les fermetures entre deux dates (aucune donnée personnelle). */
  async function fetchAvailability(start, end) {
    const range = (col) => getDocs(query(collection(db, col), where('date', '>=', start), where('date', '<=', end)));
    const [busySnap, closSnap] = await withTimeout(Promise.all([range('busy'), range('closures')]));
    for (const k of [...state.busy.keys()]) if (k >= start && k <= end) state.busy.delete(k);
    for (const k of [...state.closures.keys()]) if (k >= start && k <= end) state.closures.delete(k);
    busySnap.forEach((d) => { const { date, time } = d.data(); if (!state.busy.has(date)) state.busy.set(date, new Set()); state.busy.get(date).add(time); });
    closSnap.forEach((d) => { const { date, reason } = d.data(); state.closures.set(date, reason || 'Cabinet fermé ce jour'); });
  }
  function daySlots(date) {
    if (date > state.maxDate) return { closed: true, reason: 'Réservation possible jusqu’à 90 jours à l’avance', slots: [] };
    if (state.closures.has(date)) return { closed: true, reason: state.closures.get(date), slots: [] };
    const g = dayGrid(state.settings, date);
    if (g.closed) return { closed: true, reason: 'Cabinet fermé ce jour', slots: [] };
    const busy = state.busy.get(date) || new Set();
    const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes();
    return { closed: false, slots: g.slots.map((m) => {
      const time = toTime(m);
      const past = date < state.today || (date === state.today && m <= nowMin);
      return { time, status: busy.has(time) ? 'busy' : past ? 'past' : 'free' };
    }) };
  }

  function applySettings() {
    const s = state.settings;
    $$('[data-s]').forEach((el) => { const v = s[el.dataset.s]; if (v) el.textContent = v; });
    $$('[data-href]').forEach((el) => { const v = s[el.dataset.href]; if (v) el.href = v; });
    const tel = 'tel:' + String(s.phone || '').replace(/\s/g, '');
    $$('.tel-link').forEach((el) => { el.href = tel; });
    if (s.whatsapp) $$('.wa-link').forEach((el) => { el.href = 'https://wa.me/' + s.whatsapp.replace(/\D/g, ''); });
  }

  function renderServices() {
    $('#servicesGrid').innerHTML = state.services.map((s) => `
      <article class="service reveal">
        <i class="fa-solid ${esc(s.icon || 'fa-tooth')}"></i>
        <h3>${esc(s.name)}</h3>
        <p>${esc(s.description)}</p>
        <a href="#rendez-vous" data-service="${esc(s.id)}">Réserver <i class="fa-solid fa-arrow-right"></i></a>
      </article>`).join('');
    $$('#servicesGrid [data-service]').forEach((a) => a.addEventListener('click', () => { $('#bService').value = a.dataset.service; updateSummary(); }));
    observeReveal();
  }
  function renderServiceSelect() {
    $('#bService').innerHTML = '<option value="">— Choisissez un motif —</option>' +
      state.services.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  }
  function renderHours() {
    const order = [6, 0, 1, 2, 3, 4, 5];
    const H = state.settings.hours;
    $('#hoursList').innerHTML = order.map((d) => {
      const h = H[d]; const name = DAYS[d][0].toUpperCase() + DAYS[d].slice(1);
      return `<b>${name}</b><span class="${h.closed ? 'closed' : ''}">${h.closed ? 'Fermé' : `${h.open.replace(':', 'h')} – ${h.close.replace(':', 'h')}`}</span>`;
    }).join('');
  }

  /* ---------------- calendrier ---------------- */
  async function loadMonth() {
    const [y, m] = state.ym.split('-').map(Number);
    $('#calTitle').textContent = `${MONTHS[m - 1]} ${y}`;
    $('#calGrid').innerHTML = '<div style="grid-column:1/-1;display:grid;place-items:center;padding:3rem"><div class="spin"></div></div>';
    const t = new Date(state.today + 'T00:00:00');
    const max = new Date(state.maxDate + 'T00:00:00');
    $('#calPrev').disabled = y === t.getFullYear() && m === t.getMonth() + 1;
    $('#calNext').disabled = y > max.getFullYear() || (y === max.getFullYear() && m >= max.getMonth() + 1);
    const n = new Date(y, m, 0).getDate();
    state.days = {};
    try {
      await fetchAvailability(`${state.ym}-01`, `${state.ym}-${pad(n)}`);
      for (let i = 1; i <= n; i++) {
        const date = `${state.ym}-${pad(i)}`;
        if (date < state.today) { state.days[date] = { status: 'past' }; continue; }
        if (date > state.maxDate) { state.days[date] = { status: 'out' }; continue; }
        const r = daySlots(date);
        const free = r.slots.filter((s) => s.status === 'free').length;
        const allPast = r.slots.length && r.slots.every((s) => s.status === 'past');
        state.days[date] = { status: r.closed ? 'closed' : free ? 'free' : allPast ? 'past' : 'full', free };
      }
    } catch (e) {
      console.error(e);
      $('#calGrid').innerHTML = `<p class="slots-empty" style="grid-column:1/-1"><i class="fa-solid fa-phone"></i> La réservation en ligne est momentanément indisponible. Appelez-nous au ${esc(state.settings.phone)}.</p>`;
      return;
    }
    renderMonth();
  }
  function renderMonth() {
    const [y, m] = state.ym.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const offset = (first.getDay() + 1) % 7; // semaine commençant le samedi
    const n = new Date(y, m, 0).getDate();
    let html = '';
    for (let i = 0; i < offset; i++) html += '<span class="cal-day empty"></span>';
    for (let d = 1; d <= n; d++) {
      const iso = `${state.ym}-${pad(d)}`;
      const info = state.days[iso] || { status: 'out' };
      const cls = ['cal-day', info.status, iso === state.today ? 'today' : '', iso === state.date ? 'selected' : ''].join(' ');
      const title = info.status === 'free' ? `${info.free} créneau(x) libre(s)` : info.status === 'full' ? 'Complet' : info.status === 'closed' ? 'Fermé' : '';
      html += `<button type="button" class="${cls}" data-date="${iso}" title="${title}" ${info.status === 'free' ? '' : 'disabled'}>${d}</button>`;
    }
    $('#calGrid').innerHTML = html;
  }
  $('#calGrid').addEventListener('click', (e) => {
    const b = e.target.closest('.cal-day.free'); if (!b) return;
    state.date = b.dataset.date; state.time = ''; renderMonth(); loadSlots(); updateSummary();
  });
  const shiftMonth = (k) => { const [y, m] = state.ym.split('-').map(Number); const d = new Date(y, m - 1 + k, 1); state.ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; loadMonth(); };
  $('#calPrev').addEventListener('click', () => shiftMonth(-1));
  $('#calNext').addEventListener('click', () => shiftMonth(1));

  /* ---------------- créneaux ---------------- */
  async function loadSlots() {
    const box = $('#slots');
    $('#slotDate').textContent = fmtLong(state.date);
    box.innerHTML = '<div class="slots-empty"><div class="spin"></div></div>';
    try {
      await fetchAvailability(state.date, state.date);
      const data = daySlots(state.date);
      if (data.closed || !data.slots.length) { box.innerHTML = `<p class="slots-empty"><i class="fa-regular fa-calendar-xmark"></i> ${esc(data.reason || 'Aucun créneau ce jour')}</p>`; return; }
      box.innerHTML = data.slots.map((s) => `<button type="button" class="slot ${s.status} ${s.time === state.time ? 'selected' : ''}" data-time="${s.time}" ${s.status === 'free' ? '' : 'disabled'} title="${s.status === 'busy' ? 'Occupé' : s.status === 'past' ? 'Passé' : 'Disponible'}">${s.time}</button>`).join('');
      if (!data.slots.some((s) => s.status === 'free')) box.insertAdjacentHTML('afterbegin', '<p class="slots-empty">Cette journée est complète, choisissez une autre date.</p>');
    } catch { box.innerHTML = '<p class="slots-empty">Erreur de chargement, réessayez.</p>'; }
  }
  $('#slots').addEventListener('click', (e) => {
    const b = e.target.closest('.slot.free'); if (!b) return;
    state.time = b.dataset.time;
    $$('#slots .slot').forEach((x) => x.classList.toggle('selected', x === b));
    updateSummary();
  });
  $('#bService').addEventListener('change', updateSummary);

  function updateSummary() {
    const svc = state.services.find((s) => s.id === $('#bService').value);
    const parts = [];
    if (svc) parts.push(esc(svc.name));
    if (state.date) parts.push(fmtLong(state.date));
    if (state.time) parts.push('à ' + state.time.replace(':', 'h'));
    $('#bSummary').innerHTML = `<i class="fa-regular fa-calendar${state.date && state.time ? '-check' : ''}"></i> ${parts.length ? parts.join(' · ') : 'Aucun créneau sélectionné'}`;
  }

  /* ---------------- envoi ---------------- */
  $('#bookingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target; const err = $('#bError'); err.textContent = '';
    const body = { name: f.name.value, phone: f.phone.value, notes: f.notes.value, website: f.website.value, serviceId: $('#bService').value, date: state.date, time: state.time };
    if (!body.serviceId) return (err.textContent = 'Veuillez choisir un motif de consultation.');
    if (!body.date || !body.time) return (err.textContent = 'Veuillez sélectionner une date et une heure.');
    if (body.name.trim().length < 3) return (err.textContent = 'Veuillez indiquer votre nom complet.');
    if (body.phone.replace(/\D/g, '').length < 9) return (err.textContent = 'Veuillez indiquer un numéro de téléphone valide.');
    const btn = $('#bSubmit'); btn.disabled = true; btn.innerHTML = '<span class="spin" style="border-color:rgba(255,255,255,.4);border-top-color:#fff"></span> Envoi…';
    if (body.website) return; // anti-spam (champ invisible rempli par les robots)
    if (body.date < state.today || daySlots(body.date).slots.find((s) => s.time === body.time)?.status !== 'free') return (err.textContent = 'Ce créneau n’est plus disponible, choisissez-en un autre.');
    try {
      const apptRef = doc(collection(db, 'appointments'));
      const ref = apptRef.id.slice(0, 6).toUpperCase();
      const batch = writeBatch(db);
      batch.set(apptRef, { name: body.name.trim().slice(0, 120), phone: body.phone.trim().slice(0, 30), notes: body.notes.trim().slice(0, 1000), serviceId: body.serviceId,
        date: body.date, time: body.time, status: 'pending', source: 'web', ref, createdAt: serverTimestamp() });
      batch.set(doc(db, 'busy', busyId(body.date, body.time)), { date: body.date, time: body.time, apptId: apptRef.id });
      await withTimeout(batch.commit(), 15000);
      const svc = state.services.find((s) => s.id === body.serviceId);
      $('#confirmText').innerHTML = `Votre demande pour <strong>${esc(svc?.name)}</strong> le <strong>${fmtLong(body.date)} à ${body.time.replace(':', 'h')}</strong> a bien été enregistrée.<br>Référence : <strong>${esc(ref)}</strong>`;
      $('#confirmModal').classList.add('open');
      f.reset(); state.time = ''; loadMonth(); loadSlots(); updateSummary();
    } catch (x) {
      console.error(x);
      if (x.code === 'permission-denied') { err.textContent = 'Ce créneau vient d’être réservé ou n’est plus disponible. Merci d’en choisir un autre.'; state.time = ''; loadSlots(); loadMonth(); updateSummary(); }
      else err.textContent = 'Connexion impossible. Vérifiez votre réseau ou appelez-nous.';
    }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Envoyer ma demande de rendez-vous'; }
  });
  $('#confirmClose').addEventListener('click', () => $('#confirmModal').classList.remove('open'));
  $('#confirmModal').addEventListener('click', (e) => { if (e.target.id === 'confirmModal') e.target.classList.remove('open'); });

  loadPublic();
})();
