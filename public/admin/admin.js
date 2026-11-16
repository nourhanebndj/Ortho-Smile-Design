import { app, withTimeout } from '../js/firebase.js';
import * as store from './store.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

(() => {
  'use strict';
  /* =================================================================== helpers */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => new Date(s + 'T00:00:00');
  const todayIso = () => iso(new Date());
  const addDays = (s, k) => { const d = parse(s); d.setDate(d.getDate() + k); return iso(d); };
  const toMin = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + m; };
  const toTime = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const MONTHS_S = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const WEEK = [6, 0, 1, 2, 3, 4, 5]; // semaine commençant le samedi
  const fmtD = (s) => (s ? s.split('-').reverse().join('/') : '—');
  const fmtLong = (s) => { const d = parse(s); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
  const nf = new Intl.NumberFormat('fr-FR');
  const money = (n) => nf.format(Math.round(Number(n) || 0)) + ' DA';
  const sum = (arr, k) => arr.reduce((a, x) => a + (Number(k ? x[k] : x) || 0), 0);
  const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const byDateTime = (a, b) => (a.date + a.time).localeCompare(b.date + b.time);
  const waNumber = (p) => { let d = String(p || '').replace(/\D/g, ''); if (d.startsWith('0')) d = '213' + d.slice(1); return d; };
  const COLORS = ['#7b65c4', '#2fa98c', '#e19a3c', '#4c8ee0', '#d9576b', '#b3a3e2', '#3fb6c9', '#9c6fb6', '#e7b0be', '#86b85a', '#7c7792'];
  const STATUS = {
    pending: { label: 'En attente', icon: 'fa-hourglass-half' },
    confirmed: { label: 'Confirmé', icon: 'fa-circle-check' },
    done: { label: 'Terminé', icon: 'fa-check-double' },
    cancelled: { label: 'Annulé', icon: 'fa-ban' },
    noshow: { label: 'Absent', icon: 'fa-user-xmark' },
  };
  const pill = (st) => `<span class="pill st-${st}"><i class="fa-solid ${STATUS[st]?.icon || 'fa-circle'}"></i> ${STATUS[st]?.label || esc(st)}</span>`;
  const METHODS = ['Espèces', 'Chèque', 'Virement', 'CCP / BaridiMob', 'Carte bancaire'];
  const EXP_CATS = ['Loyer', 'Salaires', 'Fournitures', 'Charges', 'Matériel', 'Laboratoire', 'Impôts & taxes', 'Entretien', 'Publicité', 'Autre'];
  const PROD_CATS = ['Consommables', 'Orthodontie', 'Soins', 'Pharmacie', 'Hygiène', 'Instruments', 'Autre'];
  const ICONS = ['fa-tooth', 'fa-teeth', 'fa-teeth-open', 'fa-face-smile', 'fa-child', 'fa-stethoscope', 'fa-hand-sparkles', 'fa-wand-magic-sparkles', 'fa-crown', 'fa-shield-heart', 'fa-syringe', 'fa-x-ray', 'fa-tooth', 'fa-user-doctor', 'fa-star'];
  const auth = getAuth(app);
  let changePassword = async () => {};

  /* =================================================================== state */
  let D = null;
  const S = {
    cal: { mode: 'month', ym: todayIso().slice(0, 7), day: todayIso() },
    appts: { status: '', period: 'upcoming', q: '' },
    patients: { q: '', debt: false },
    stock: { q: '', cat: '' },
    acc: { ym: todayIso().slice(0, 7), year: new Date().getFullYear() },
    stats: { year: new Date().getFullYear() },
  };
  let charts = [];
  const svc = (id) => D.services.find((s) => s.id === id);
  const pat = (id) => D.patients.find((p) => p.id === id);
  const prod = (id) => D.products.find((p) => p.id === id);
  function finance(pid) {
    const total = sum(D.treatments.filter((t) => t.patientId === pid), 'total');
    const paid = sum(D.payments.filter((p) => p.patientId === pid), 'amount');
    return { total, paid, rest: Math.max(0, total - paid) };
  }
  const treatPaid = (tid) => sum(D.payments.filter((p) => p.treatmentId === tid), 'amount');
  const totalDebt = () => D.patients.reduce((a, p) => a + finance(p.id).rest, 0);

  // Les données arrivent en temps réel (onSnapshot) : "reload" ne fait que redessiner la vue.
  async function reload(quiet) {
    if (!D) return;
    updateBadges();
    if (!quiet) render();
  }
  let renderTimer = null, dirty = false;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      const typing = document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName) && document.activeElement.closest('#content');
      if (modal.classList.contains('open') || typing) { dirty = true; return; }
      dirty = false; render();
    }, 150);
  }
  function updateBadges() {
    const pending = D.appointments.filter((a) => a.status === 'pending').length;
    const low = D.products.filter((p) => p.quantity <= p.minQty).length;
    const pb = $('#pendingBadge'), sb = $('#stockBadge');
    pb.hidden = !pending; pb.textContent = pending;
    sb.hidden = !low; sb.textContent = low;
  }

  /* =================================================================== ui: toast, modal */
  function toast(msg, type = 'ok') {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = `<i class="fa-solid ${type === 'ok' ? 'fa-circle-check' : 'fa-triangle-exclamation'}"></i> ${esc(msg)}`;
    $('#toasts').append(el); setTimeout(() => el.remove(), 3500);
  }
  const modal = $('#modal'), box = $('#modalBox');
  function openModal(html, wide) { box.className = 'modal-box' + (wide ? ' wide' : ''); box.innerHTML = html; modal.classList.add('open'); }
  function closeModal() { modal.classList.remove('open'); box.innerHTML = ''; if (dirty) scheduleRender(); }
  modal.addEventListener('mousedown', (e) => { if (e.target === modal) closeModal(); });
  box.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });

  const askEl = document.createElement('div');
  askEl.className = 'modal'; askEl.style.zIndex = 150;
  document.body.append(askEl);
  function ask(message, okLabel = 'Confirmer', danger = true) {
    return new Promise((resolve) => {
      askEl.innerHTML = `<div class="modal-box" style="max-width:420px;text-align:center">
        <div style="font-size:2rem;color:${danger ? 'var(--red)' : 'var(--primary)'};margin-bottom:.5rem"><i class="fa-solid ${danger ? 'fa-triangle-exclamation' : 'fa-circle-question'}"></i></div>
        <p style="color:var(--ink);font-weight:600;margin-bottom:1.2rem">${message}</p>
        <div class="modal-foot" style="justify-content:center"><button class="btn btn-light" data-r="0">Annuler</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-r="1">${okLabel}</button></div></div>`;
      askEl.classList.add('open');
      askEl.onclick = (e) => { const b = e.target.closest('[data-r]'); if (!b && e.target !== askEl) return; askEl.classList.remove('open'); resolve(b?.dataset.r === '1'); };
    });
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (askEl.classList.contains('open')) askEl.click(); else closeModal(); } });

  function field(f, v) {
    const val = v ?? f.value ?? '';
    const cls = f.full ? 'full' : '';
    const req = f.required ? 'required' : '';
    const lab = esc(f.label) + (f.required ? ' *' : '');
    if (f.type === 'select') return `<label class="${cls}" data-f="${f.name}">${lab}<select name="${f.name}" ${req}>${f.options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(val) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`;
    if (f.type === 'textarea') return `<label class="${cls}" data-f="${f.name}">${lab}<textarea name="${f.name}" rows="${f.rows || 3}" ${req}>${esc(val)}</textarea></label>`;
    if (f.type === 'checkbox') return `<label class="check-label ${cls}" data-f="${f.name}"><input type="checkbox" name="${f.name}" ${val ? 'checked' : ''}> ${esc(f.label)}</label>`;
    const dl = f.datalist ? `<datalist id="dl-${f.name}">${f.datalist.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>` : '';
    return `<label class="${cls}" data-f="${f.name}">${lab}<input type="${f.type || 'text'}" name="${f.name}" value="${esc(val)}" ${req} ${f.attrs || ''} ${f.datalist ? `list="dl-${f.name}"` : ''}>${dl}</label>`;
  }
  function formModal({ title, icon = 'fa-pen-to-square', fields, values = {}, submit = 'Enregistrer', onSubmit, onOpen, onDelete, wide, intro = '' }) {
    openModal(`<div class="modal-head"><h3><i class="fa-solid ${icon}" style="color:var(--primary)"></i> ${esc(title)}</h3><button class="icon-btn" data-close><i class="fa-solid fa-xmark"></i></button></div>
      ${intro}
      <form id="mForm" class="form-grid" novalidate>${fields.map((f) => field(f, values[f.name])).join('')}<p class="err full" id="mErr"></p><button type="submit" hidden></button></form>
      <div class="modal-foot">${onDelete ? '<button class="btn btn-danger left" id="mDelete"><i class="fa-regular fa-trash-can"></i> Supprimer</button>' : ''}<button class="btn btn-light" data-close>Annuler</button><button class="btn btn-primary" id="mSubmit"><i class="fa-solid fa-check"></i> ${esc(submit)}</button></div>`, wide);
    const form = $('#mForm'), btn = $('#mSubmit');
    const go = async (e) => {
      e?.preventDefault();
      const vals = {};
      for (const f of fields) {
        const el = form.elements[f.name]; if (!el) continue;
        let v = f.type === 'checkbox' ? el.checked : el.value;
        if (f.type === 'number') v = v === '' ? 0 : Number(v);
        if (f.required && !f.type?.includes('checkbox') && (v === '' || v == null) && !el.closest('label').hidden) { $('#mErr').textContent = `Le champ « ${f.label} » est obligatoire.`; el.focus(); return; }
        vals[f.name] = v;
      }
      btn.disabled = true;
      try { await onSubmit(vals, form); closeModal(); }
      catch (err) { if (err.message !== '__cancel') $('#mErr').textContent = err.message; }
      finally { btn.disabled = false; }
    };
    form.addEventListener('submit', go); btn.addEventListener('click', go);
    if (onDelete) $('#mDelete').addEventListener('click', async () => { if (await ask('Supprimer définitivement cet élément ?', 'Supprimer')) { try { await onDelete(); closeModal(); } catch (e) { toast(e.message, 'bad'); } } });
    onOpen && onOpen(form);
    setTimeout(() => form.querySelector('input:not([type=hidden]):not([type=checkbox]),select')?.focus(), 50);
  }

  /* =================================================================== charts */
  function destroyCharts() { charts.forEach((c) => c.destroy()); charts = []; }
  function chart(id, config) {
    const el = document.getElementById(id); if (!el || !window.Chart) return;
    Chart.defaults.font.family = "'Plus Jakarta Sans', system-ui, sans-serif";
    Chart.defaults.color = '#837e98';
    charts.push(new Chart(el, config));
  }
  const barOpts = (stacked) => ({ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.dataset.money === false ? c.raw : money(c.raw)}` } } },
    scales: { x: { stacked, grid: { display: false } }, y: { stacked, beginAtZero: true, grid: { color: '#f0eef6' }, ticks: { callback: (v) => nf.format(v) } } } });
  const doughnut = (labels, data, isMoney) => ({ type: 'doughnut', data: { labels, datasets: [{ data, backgroundColor: COLORS, borderWidth: 2, borderColor: '#fff' }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '64%', plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 12 } }, tooltip: { callbacks: { label: (c) => `${c.label}: ${isMoney ? money(c.raw) : c.raw}` } } } } });
  const lastMonths = (n) => { const out = []; const d = new Date(); d.setDate(1); for (let i = n - 1; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(`${x.getFullYear()}-${pad(x.getMonth() + 1)}`); } return out; };
  const monthLabel = (ym) => { const [y, m] = ym.split('-'); return `${MONTHS_S[m - 1]} ${y.slice(2)}`; };

  /* =================================================================== router */
  const VIEWS = {
    dashboard: ['Tableau de bord', viewDashboard],
    calendar: ['Calendrier des rendez-vous', viewCalendar],
    appointments: ['Rendez-vous', viewAppointments],
    patients: ['Patients & versements', viewPatients],
    patient: ['Fiche patient', viewPatient],
    services: ['Services du cabinet', viewServices],
    stock: ['Gestion du stock', viewStock],
    accounting: ['Comptabilité', viewAccounting],
    stats: ['Statistiques', viewStats],
    settings: ['Paramètres', viewSettings],
  };
  const route = () => { const [v, p] = location.hash.replace(/^#\/?/, '').split('/'); return { view: VIEWS[v] ? v : 'dashboard', param: p }; };
  const go = (v, p) => { location.hash = '#/' + v + (p ? '/' + p : ''); };
  addEventListener('hashchange', () => { closeSidebar(); render(); scrollTo(0, 0); });

  function render() {
    if (!D) return;
    const { view, param } = route();
    destroyCharts();
    $('#viewTitle').textContent = VIEWS[view][0];
    $$('#sbNav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view || (view === 'patient' && a.dataset.view === 'patients')));
    const after = VIEWS[view][1](param);
    if (typeof after === 'function') after();
  }
  const content = (html) => { $('#content').innerHTML = html; };

  /* =================================================================== DASHBOARD */
  function viewDashboard() {
    const t = todayIso(), ym = t.slice(0, 7);
    const todays = D.appointments.filter((a) => a.date === t && a.status !== 'cancelled').sort(byDateTime);
    const pending = D.appointments.filter((a) => a.status === 'pending').sort(byDateTime);
    const monthAppts = D.appointments.filter((a) => a.date.startsWith(ym) && a.status !== 'cancelled');
    const rec = sum(D.payments.filter((p) => p.date?.startsWith(ym)), 'amount');
    const dep = sum(D.expenses.filter((p) => p.date?.startsWith(ym)), 'amount');
    const low = D.products.filter((p) => p.quantity <= p.minQty);
    const newPat = D.patients.filter((p) => (p.createdAt || '').startsWith(ym)).length;
    const apptLi = (a, actions) => `<div class="li"><span class="time">${a.date === t ? a.time : fmtD(a.date).slice(0, 5) + ' · ' + a.time}</span>
      <div class="info" data-action="apptDetail" data-id="${a.id}" style="cursor:pointer"><strong>${esc(a.name)}</strong><small>${esc(svc(a.serviceId)?.name || '—')}</small></div>${actions}</div>`;
    content(`
      <div class="kpis">
        ${kpi('fa-calendar-day', 'RDV aujourd’hui', todays.length, '', 'Voir le calendrier', 'calendar')}
        ${kpi('fa-hourglass-half', 'Demandes en attente', pending.length, pending.length ? 'orange' : '', '', 'appointments')}
        ${kpi('fa-sack-dollar', 'Recettes du mois', money(rec), 'green', '', 'accounting')}
        ${kpi('fa-scale-balanced', 'Résultat du mois', money(rec - dep), rec - dep >= 0 ? 'green' : 'red', '', 'accounting')}
        ${kpi('fa-user-group', 'Patients', `${D.patients.length} <small style="display:inline;color:var(--green)">+${newPat} ce mois</small>`, 'blue', '', 'patients')}
        ${kpi('fa-file-invoice-dollar', 'Reste à encaisser', money(totalDebt()), 'orange', '', 'patients')}
        ${kpi('fa-calendar-check', 'RDV ce mois', monthAppts.length, '', '', 'appointments')}
        ${kpi('fa-box-open', 'Alertes stock', low.length, low.length ? 'red' : 'green', '', 'stock')}
      </div>
      <div class="grid g-2-1">
        <div class="card"><div class="card-head"><h3><i class="fa-solid fa-chart-column"></i> Recettes & dépenses (12 mois)</h3><a class="btn btn-light btn-sm" href="#/accounting">Comptabilité</a></div><div class="chart-box"><canvas id="cFin"></canvas></div></div>
        <div class="card"><div class="card-head"><h3><i class="fa-solid fa-chart-pie"></i> Rendez-vous par soin</h3></div><div class="chart-box"><canvas id="cSvc"></canvas></div></div>
      </div>
      <div class="grid g3">
        <div class="card"><div class="card-head"><h3><i class="fa-regular fa-clock"></i> Aujourd’hui</h3><span class="muted" style="font-size:.8rem;text-transform:capitalize">${fmtLong(t)}</span></div>
          <div class="list">${todays.length ? todays.map((a) => apptLi(a, pill(a.status))).join('') : empty('fa-mug-hot', 'Aucun rendez-vous aujourd’hui')}</div></div>
        <div class="card"><div class="card-head"><h3><i class="fa-solid fa-bell"></i> Demandes à confirmer</h3></div>
          <div class="list">${pending.length ? pending.slice(0, 8).map((a) => apptLi(a, `<div class="actions"><button class="icon-btn" title="Confirmer" data-action="setStatus" data-id="${a.id}" data-st="confirmed" style="color:var(--green)"><i class="fa-solid fa-check"></i></button><button class="icon-btn danger" title="Annuler" data-action="setStatus" data-id="${a.id}" data-st="cancelled"><i class="fa-solid fa-xmark"></i></button></div>`)).join('') : empty('fa-circle-check', 'Aucune demande en attente')}</div></div>
        <div class="card"><div class="card-head"><h3><i class="fa-solid fa-triangle-exclamation"></i> Stock faible</h3><a class="btn btn-light btn-sm" href="#/stock">Stock</a></div>
          <div class="list">${low.length ? low.map((p) => `<div class="li"><div class="info"><strong>${esc(p.name)}</strong><small>Seuil : ${p.minQty} ${esc(p.unit)}</small></div><span class="pill ${p.quantity <= 0 ? 'bad' : 'warn'}">${p.quantity} ${esc(p.unit)}</span><button class="icon-btn" title="Entrée de stock" data-action="stockMove" data-id="${p.id}" data-type="in"><i class="fa-solid fa-plus"></i></button></div>`).join('') : empty('fa-boxes-stacked', 'Tous les stocks sont suffisants')}</div></div>
      </div>`);
    return () => {
      const months = lastMonths(12);
      chart('cFin', { type: 'bar', data: { labels: months.map(monthLabel), datasets: [
        { label: 'Recettes', data: months.map((m) => sum(D.payments.filter((p) => p.date?.startsWith(m)), 'amount')), backgroundColor: '#7b65c4', borderRadius: 6 },
        { label: 'Dépenses', data: months.map((m) => sum(D.expenses.filter((p) => p.date?.startsWith(m)), 'amount')), backgroundColor: '#e7b0be', borderRadius: 6 },
      ] }, options: barOpts(false) });
      const counts = {}; D.appointments.filter((a) => a.status !== 'cancelled').forEach((a) => { const n = svc(a.serviceId)?.name || 'Autre'; counts[n] = (counts[n] || 0) + 1; });
      const ent = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      chart('cSvc', doughnut(ent.map((e) => e[0]), ent.map((e) => e[1])));
    };
  }
  const kpi = (icon, label, value, color = '', _s, link) => `<a class="kpi ${color}" ${link ? `href="#/${link}"` : ''}><i class="fa-solid ${icon}"></i><div style="min-width:0"><small>${label}</small><strong>${value}</strong></div></a>`;
  const empty = (icon, text) => `<div class="empty"><i class="fa-solid ${icon}"></i>${text}</div>`;

  /* =================================================================== CALENDAR */
  function dayInfo(date) {
    const st = D.settings, step = Number(st.slotMinutes) || 30, h = st.hours[parse(date).getDay()];
    const closure = D.closures.find((c) => c.date === date);
    const weeklyClosed = !h || h.closed;
    const slots = []; let breakAt = null;
    if (!weeklyClosed) {
      const open = toMin(h.open), close = toMin(h.close);
      const bs = st.breakStart && st.breakEnd ? toMin(st.breakStart) : null, be = bs != null ? toMin(st.breakEnd) : null;
      for (let m = open; m + step <= close; m += step) {
        if (bs != null && m < be && m + step > bs) { if (breakAt == null) breakAt = slots.length; continue; }
        slots.push(m);
      }
    }
    return { closure, weeklyClosed, closed: weeklyClosed || !!closure, slots, step, breakAt };
  }
  function viewCalendar() {
    const c = S.cal;
    const head = (title, prev, next) => `<div class="card-head"><div class="cal-toolbar">
        <button class="icon-btn" data-action="calNav" data-k="${prev}"><i class="fa-solid fa-chevron-left"></i></button>
        <button class="btn btn-light btn-sm" data-action="calToday">Aujourd’hui</button>
        <button class="icon-btn" data-action="calNav" data-k="${next}"><i class="fa-solid fa-chevron-right"></i></button>
        <h2>${title}</h2></div>
        <div class="cal-toolbar"><div class="legend">${['pending', 'confirmed', 'done', 'noshow'].map(pill).join('')}</div>
        <div class="seg"><button class="${c.mode === 'month' ? 'on' : ''}" data-action="calMode" data-mode="month">Mois</button><button class="${c.mode === 'day' ? 'on' : ''}" data-action="calMode" data-mode="day">Jour</button></div></div></div>`;

    if (c.mode === 'month') {
      const [y, m] = c.ym.split('-').map(Number);
      const first = new Date(y, m - 1, 1);
      const start = new Date(first); start.setDate(1 - ((first.getDay() + 1) % 7));
      const t = todayIso();
      let cells = '';
      for (let i = 0; i < 42; i++) {
        const d = new Date(start); d.setDate(start.getDate() + i);
        const ds = iso(d);
        if (i >= 35 && d.getMonth() !== m - 1) break;
        const appts = D.appointments.filter((a) => a.date === ds && a.status !== 'cancelled').sort(byDateTime);
        const info = dayInfo(ds);
        cells += `<div class="mcell ${d.getMonth() !== m - 1 ? 'other' : ''} ${ds === t ? 'today' : ''} ${info.closed ? 'closed' : ''}" data-action="calDay" data-date="${ds}">
          <div class="dn"><b>${d.getDate()}</b>${appts.length ? `<span class="cnt">${appts.length} RDV</span>` : info.closed ? '<span class="cnt">Fermé</span>' : ''}</div>
          ${appts.slice(0, 3).map((a) => `<span class="chip st-${a.status}" data-action="apptDetail" data-id="${a.id}" title="${esc(a.time + ' ' + a.name)}">${a.time} ${esc(a.name)}</span>`).join('')}
          ${appts.length > 3 ? `<span class="more">+${appts.length - 3} autres</span>` : ''}</div>`;
      }
      content(`<div class="card">${head(`${MONTHS[m - 1]} ${y}`, -1, 1)}
        <div class="month">${WEEK.map((d) => `<div class="wd">${DAYS[d].slice(0, 3)}</div>`).join('')}${cells}</div></div>`);
      return;
    }

    // vue jour
    const date = c.day; const info = dayInfo(date); const t = todayIso();
    const appts = D.appointments.filter((a) => a.date === date).sort(byDateTime);
    const active = appts.filter((a) => a.status !== 'cancelled');
    const placed = new Set();
    let rows = '';
    info.slots.forEach((m, i) => {
      if (i === info.breakAt) rows += `<div class="break-row"><i class="fa-solid fa-mug-saucer"></i> Pause ${esc(D.settings.breakStart)} – ${esc(D.settings.breakEnd)}</div>`;
      const starting = appts.filter((a) => toMin(a.time) >= m && toMin(a.time) < m + info.step);
      starting.forEach((a) => placed.add(a.id));
      const startingActive = starting.filter((a) => a.status !== 'cancelled');
      let cell = starting.map(apptRow).join('');
      if (!startingActive.length) {
        const cover = active.find((a) => toMin(a.time) < m && toMin(a.time) + (Number(a.duration) || info.step) > m);
        if (cover) cell += `<div class="busy-slot cont st-${cover.status}" data-action="apptDetail" data-id="${cover.id}"><i class="fa-solid fa-arrow-turn-down" style="transform:rotate(90deg)"></i> suite — ${esc(cover.name)}</div>`;
        else cell += `<div class="free-slot" data-action="newApptAt" data-date="${date}" data-time="${toTime(m)}"><i class="fa-solid fa-plus"></i> Libre — ajouter un rendez-vous</div>`;
      }
      rows += `<div class="ds"><div class="t">${toTime(m)}</div><div style="display:grid;gap:.35rem">${cell}</div></div>`;
    });
    const outside = appts.filter((a) => !placed.has(a.id));
    const freeCount = info.slots.length - info.slots.filter((m) => active.some((a) => toMin(a.time) < m + info.step && toMin(a.time) + (Number(a.duration) || info.step) > m)).length;
    content(`<div class="card">${head(fmtLong(date) + (date === t ? ' · aujourd’hui' : ''), -1, 1)}
      <div class="toolbar" style="margin-bottom:1rem">
        <span class="pill src"><i class="fa-regular fa-calendar-check"></i> ${active.length} rendez-vous</span>
        ${info.closed ? '<span class="pill bad"><i class="fa-solid fa-lock"></i> Fermé</span>' : `<span class="pill ok"><i class="fa-regular fa-clock"></i> ${freeCount} créneau(x) libre(s)</span>`}
        <span style="flex:1"></span>
        ${info.closure ? `<button class="btn btn-success btn-sm" data-action="unblockDay" data-id="${info.closure.id}"><i class="fa-solid fa-lock-open"></i> Rouvrir la journée</button>`
          : !info.weeklyClosed ? `<button class="btn btn-light btn-sm" data-action="blockDay" data-date="${date}"><i class="fa-solid fa-lock"></i> Bloquer la journée</button>` : ''}
        <button class="btn btn-primary btn-sm" data-action="newApptAt" data-date="${date}" data-time="${info.slots[0] != null ? toTime(info.slots[0]) : '09:00'}"><i class="fa-solid fa-plus"></i> Ajouter</button>
      </div>
      ${info.closed ? `<div class="notice warn" style="margin-bottom:1rem"><i class="fa-solid fa-circle-info"></i> ${info.closure ? `Journée bloquée${info.closure.reason ? ' : ' + esc(info.closure.reason) : ''}. Les patients ne peuvent pas réserver.` : 'Jour de fermeture hebdomadaire (modifiable dans Paramètres).'}</div>` : ''}
      ${outside.length ? `<div style="margin-bottom:1rem"><p class="muted" style="font-size:.8rem;font-weight:700;margin-bottom:.4rem">EN DEHORS DES CRÉNEAUX</p><div style="display:grid;gap:.35rem">${outside.map(apptRow).join('')}</div></div>` : ''}
      <div class="day-slots">${rows || (outside.length ? '' : empty('fa-door-closed', 'Aucun créneau ce jour'))}</div></div>`);
  }
  const apptRow = (a) => `<div class="busy-slot st-${a.status}" data-action="apptDetail" data-id="${a.id}" ${a.status === 'cancelled' ? 'style="opacity:.5;background:var(--grey-50)"' : ''}>
      <strong>${a.time} · ${esc(a.name)}</strong><span class="muted">${esc(svc(a.serviceId)?.name || '')}</span>${pill(a.status)}${a.source === 'web' ? '<span class="pill src"><i class="fa-solid fa-globe"></i> En ligne</span>' : ''}<span class="muted" style="margin-left:auto">${esc(a.phone)}</span></div>`;

  /* =================================================================== APPOINTMENTS */
  function viewAppointments() {
    const f = S.appts;
    content(`<div class="card">
      <div class="card-head"><div class="toolbar" style="flex:1">
        <div class="search"><i class="fa-solid fa-magnifying-glass"></i><input id="aQ" placeholder="Rechercher un patient, un téléphone, une référence…" value="${esc(f.q)}"></div>
        <select id="aPeriod">${[['upcoming', 'À venir'], ['today', 'Aujourd’hui'], ['week', '7 prochains jours'], ['past', 'Passés'], ['all', 'Tous']].map(([v, l]) => `<option value="${v}" ${f.period === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select id="aStatus"><option value="">Tous les statuts</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
      </div><button class="btn btn-primary" data-action="newAppt"><i class="fa-solid fa-plus"></i> Nouveau RDV</button></div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Heure</th><th>Patient</th><th>Soin</th><th>Origine</th><th>Statut</th><th class="num">Actions</th></tr></thead><tbody id="aBody"></tbody></table></div></div>`);
    const draw = () => {
      const t = todayIso(), wk = addDays(t, 7), q = f.q.toLowerCase();
      let list = D.appointments.filter((a) => {
        if (f.status && a.status !== f.status) return false;
        if (f.period === 'upcoming' && a.date < t) return false;
        if (f.period === 'today' && a.date !== t) return false;
        if (f.period === 'week' && (a.date < t || a.date > wk)) return false;
        if (f.period === 'past' && a.date >= t) return false;
        if (q && !`${a.name} ${a.phone} ${a.ref}`.toLowerCase().includes(q)) return false;
        return true;
      }).sort(byDateTime);
      if (f.period === 'past' || f.period === 'all') list.reverse();
      $('#aBody').innerHTML = list.length ? list.slice(0, 300).map((a) => `<tr>
        <td><strong style="color:var(--ink)">${fmtD(a.date)}</strong><br><small class="muted" style="text-transform:capitalize">${DAYS[parse(a.date).getDay()]}</small></td>
        <td><strong>${a.time}</strong></td>
        <td><div class="name-cell"><span class="avatar">${initials(a.name)}</span><div><a href="#/patient/${a.patientId}">${esc(a.name)}</a><br><small class="muted">${esc(a.phone)}</small></div></div></td>
        <td>${esc(svc(a.serviceId)?.name || '—')}</td>
        <td>${a.source === 'web' ? '<span class="pill src"><i class="fa-solid fa-globe"></i> En ligne</span>' : '<span class="pill" style="background:var(--grey-50)"><i class="fa-solid fa-house-medical"></i> Cabinet</span>'}</td>
        <td>${pill(a.status)}</td>
        <td class="num"><div class="actions">
          ${a.status === 'pending' ? `<button class="icon-btn" title="Confirmer" style="color:var(--green)" data-action="setStatus" data-id="${a.id}" data-st="confirmed"><i class="fa-solid fa-check"></i></button>` : ''}
          ${a.status === 'confirmed' ? `<button class="icon-btn" title="Marquer terminé" style="color:var(--green)" data-action="setStatus" data-id="${a.id}" data-st="done"><i class="fa-solid fa-check-double"></i></button>` : ''}
          <button class="icon-btn" title="Détails" data-action="apptDetail" data-id="${a.id}"><i class="fa-regular fa-eye"></i></button>
          <button class="icon-btn" title="Modifier" data-action="editAppt" data-id="${a.id}"><i class="fa-regular fa-pen-to-square"></i></button>
        </div></td></tr>`).join('') : `<tr><td colspan="7">${empty('fa-calendar-xmark', 'Aucun rendez-vous trouvé')}</td></tr>`;
    };
    draw();
    $('#aQ').addEventListener('input', (e) => { f.q = e.target.value; draw(); });
    $('#aPeriod').addEventListener('change', (e) => { f.period = e.target.value; draw(); });
    $('#aStatus').addEventListener('change', (e) => { f.status = e.target.value; draw(); });
  }

  function apptDetail(id) {
    const a = D.appointments.find((x) => x.id === id); if (!a) return;
    const s = svc(a.serviceId);
    const msg = encodeURIComponent(`Bonjour ${a.name}, le cabinet ${D.settings.clinicName} confirme votre rendez-vous le ${fmtLong(a.date)} à ${a.time.replace(':', 'h')}. Merci et à bientôt !`);
    const btn = (st, cls, icon, label) => a.status !== st ? `<button class="btn ${cls} btn-sm" data-action="setStatus" data-id="${a.id}" data-st="${st}"><i class="fa-solid ${icon}"></i> ${label}</button>` : '';
    openModal(`<div class="modal-head"><h3><i class="fa-regular fa-calendar-check" style="color:var(--primary)"></i> Rendez-vous ${a.ref ? '#' + esc(a.ref) : ''}</h3><button class="icon-btn" data-close><i class="fa-solid fa-xmark"></i></button></div>
      <dl class="detail-list">
        <dt>Patient</dt><dd><a href="#/patient/${a.patientId}" data-close style="color:var(--primary)">${esc(a.name)}</a></dd>
        <dt>Téléphone</dt><dd><a href="tel:${esc(a.phone)}">${esc(a.phone)}</a></dd>
        <dt>Soin</dt><dd>${esc(s?.name || '—')}</dd>
        <dt>Date</dt><dd style="text-transform:capitalize">${fmtLong(a.date)}</dd>
        <dt>Heure</dt><dd>${a.time} <span class="muted">(${a.duration || D.settings.slotMinutes} min)</span></dd>
        <dt>Statut</dt><dd>${pill(a.status)}</dd>
        <dt>Origine</dt><dd>${a.source === 'web' ? 'Réservation en ligne' : 'Saisie au cabinet'}</dd>
        ${a.notes ? `<dt>Message</dt><dd style="font-weight:500">${esc(a.notes)}</dd>` : ''}
        <dt>Créé le</dt><dd class="muted">${a.createdAt ? new Date(a.createdAt).toLocaleString('fr-FR') : '—'}</dd>
      </dl>
      <div class="toolbar" style="margin-top:1.2rem">
        ${btn('confirmed', 'btn-light', 'fa-circle-check', 'Confirmer')}${btn('done', 'btn-success', 'fa-check-double', 'Terminé')}${btn('noshow', 'btn-light', 'fa-user-xmark', 'Absent')}${btn('cancelled', 'btn-danger', 'fa-ban', 'Annuler')}
      </div>
      <div class="modal-foot">
        <button class="btn btn-danger left" data-action="deleteAppt" data-id="${a.id}"><i class="fa-regular fa-trash-can"></i></button>
        <a class="btn btn-light" target="_blank" rel="noopener" href="https://wa.me/${waNumber(a.phone)}?text=${msg}"><i class="fa-brands fa-whatsapp" style="color:#25d366"></i> WhatsApp</a>
        <button class="btn btn-primary" data-action="editAppt" data-id="${a.id}"><i class="fa-regular fa-pen-to-square"></i> Modifier</button>
      </div>`);
  }

  function apptForm(a = {}, preset = {}) {
    const editing = !!a.id;
    const v = { status: 'confirmed', duration: D.settings.slotMinutes, date: todayIso(), time: '09:00', ...preset, ...a };
    const patients = [...D.patients].sort((x, y) => x.name.localeCompare(y.name));
    formModal({
      title: editing ? 'Modifier le rendez-vous' : 'Nouveau rendez-vous', icon: 'fa-calendar-plus', values: v,
      fields: [
        { name: 'patientId', label: 'Patient', type: 'select', full: true, options: [{ value: '', label: '➕ Nouveau patient' }, ...patients.map((p) => ({ value: p.id, label: `${p.name} — ${p.phone}` }))] },
        { name: 'name', label: 'Nom et prénom', required: true },
        { name: 'phone', label: 'Téléphone', type: 'tel' },
        { name: 'serviceId', label: 'Soin', type: 'select', full: true, options: D.services.map((s) => ({ value: s.id, label: s.name })) },
        { name: 'date', label: 'Date', type: 'date', required: true },
        { name: 'time', label: 'Heure', type: 'time', required: true, attrs: 'step="300"' },
        { name: 'duration', label: 'Durée (min)', type: 'number', attrs: 'min="5" step="5"' },
        { name: 'status', label: 'Statut', type: 'select', options: Object.entries(STATUS).map(([k, x]) => ({ value: k, label: x.label })) },
        { name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 2 },
      ],
      onOpen: (form) => {
        const sync = () => { const has = !!form.patientId.value; form.querySelector('[data-f=name]').hidden = has; form.querySelector('[data-f=phone]').hidden = has; };
        form.patientId.addEventListener('change', sync); sync();
        form.serviceId.addEventListener('change', () => { const s = svc(form.serviceId.value); if (s && !editing) form.duration.value = Math.max(D.settings.slotMinutes, s.duration || 0); });
      },
      onSubmit: async (vals) => {
        const save = (force) => (editing ? store.update('appointments', a.id, { ...vals, force }) : store.create('appointments', { ...vals, force }));
        try { await save(false); }
        catch (e) {
          if (e.status !== 409) throw e;
          if (!(await ask('Ce créneau est déjà occupé par un autre rendez-vous. Enregistrer quand même ?', 'Oui, enregistrer', false))) throw new Error('__cancel');
          await save(true);
        }
        toast(editing ? 'Rendez-vous modifié' : 'Rendez-vous ajouté'); await reload();
      },
      onDelete: editing ? async () => { await store.remove('appointments', a.id); toast('Rendez-vous supprimé'); await reload(); } : null,
    });
  }

  /* =================================================================== PATIENTS */
  function viewPatients() {
    const f = S.patients;
    content(`<div class="kpis">
        ${kpi('fa-user-group', 'Patients enregistrés', D.patients.length, 'blue')}
        ${kpi('fa-file-medical', 'Total des soins facturés', money(sum(D.treatments, 'total')))}
        ${kpi('fa-hand-holding-dollar', 'Total versé', money(sum(D.payments, 'amount')), 'green')}
        ${kpi('fa-file-invoice-dollar', 'Reste à encaisser', money(totalDebt()), 'orange')}
      </div>
      <div class="card"><div class="card-head"><div class="toolbar" style="flex:1">
        <div class="search"><i class="fa-solid fa-magnifying-glass"></i><input id="pQ" placeholder="Rechercher par nom ou téléphone…" value="${esc(f.q)}"></div>
        <label class="check-label" style="font-size:.85rem"><input type="checkbox" id="pDebt" ${f.debt ? 'checked' : ''}> Avec reste à payer</label>
      </div><button class="btn btn-primary" data-action="newPatient"><i class="fa-solid fa-user-plus"></i> Nouveau patient</button></div>
      <div class="table-wrap"><table><thead><tr><th>Patient</th><th>Téléphone</th><th>Prochain RDV</th><th class="num">Soins</th><th class="num">Versé</th><th class="num">Reste</th><th>Progression</th><th class="num"></th></tr></thead><tbody id="pBody"></tbody></table></div></div>`);
    const draw = () => {
      const q = f.q.toLowerCase(), t = todayIso();
      const rows = D.patients.map((p) => ({ p, fin: finance(p.id), next: D.appointments.filter((a) => a.patientId === p.id && a.date >= t && !['cancelled', 'done', 'noshow'].includes(a.status)).sort(byDateTime)[0] }))
        .filter(({ p, fin }) => (!q || `${p.name} ${p.phone}`.toLowerCase().includes(q)) && (!f.debt || fin.rest > 0))
        .sort((a, b) => a.p.name.localeCompare(b.p.name));
      $('#pBody').innerHTML = rows.length ? rows.map(({ p, fin, next }) => `<tr>
        <td><a class="name-cell" href="#/patient/${p.id}"><span class="avatar">${initials(p.name)}</span>${esc(p.name)}</a></td>
        <td>${esc(p.phone)}</td>
        <td>${next ? `${fmtD(next.date)} · ${next.time}` : '<span class="muted">—</span>'}</td>
        <td class="num">${money(fin.total)}</td><td class="num amount-pos">${money(fin.paid)}</td>
        <td class="num ${fin.rest > 0 ? 'amount-neg' : ''}">${money(fin.rest)}</td>
        <td><div class="progress"><span style="width:${fin.total ? Math.min(100, (fin.paid / fin.total) * 100) : 0}%"></span></div></td>
        <td class="num"><div class="actions"><button class="icon-btn" title="Ajouter un versement" data-action="newPayment" data-pid="${p.id}"><i class="fa-solid fa-money-bill-wave"></i></button><a class="icon-btn" title="Fiche" href="#/patient/${p.id}"><i class="fa-regular fa-folder-open"></i></a></div></td></tr>`).join('')
        : `<tr><td colspan="8">${empty('fa-user-slash', 'Aucun patient trouvé')}</td></tr>`;
    };
    draw();
    $('#pQ').addEventListener('input', (e) => { f.q = e.target.value; draw(); });
    $('#pDebt').addEventListener('change', (e) => { f.debt = e.target.checked; draw(); });
  }

  function viewPatient(id) {
    const p = pat(id);
    if (!p) { content(`<div class="card">${empty('fa-user-slash', 'Patient introuvable')}<div style="text-align:center"><a class="btn btn-light" href="#/patients">Retour</a></div></div>`); return; }
    const fin = finance(id);
    const treats = D.treatments.filter((t) => t.patientId === id).sort((a, b) => b.date.localeCompare(a.date));
    const pays = D.payments.filter((x) => x.patientId === id).sort((a, b) => b.date.localeCompare(a.date));
    const appts = D.appointments.filter((a) => a.patientId === id).sort(byDateTime).reverse();
    const age = p.birthdate ? Math.floor((Date.now() - parse(p.birthdate)) / 31557600000) : null;
    content(`<div><a class="btn btn-light btn-sm" href="#/patients"><i class="fa-solid fa-arrow-left"></i> Tous les patients</a></div>
      <div class="card"><div class="card-head" style="margin-bottom:0"><div class="profile"><span class="avatar">${initials(p.name)}</span><div>
        <h2>${esc(p.name)}</h2><div class="meta"><span><i class="fa-solid fa-phone"></i><a href="tel:${esc(p.phone)}">${esc(p.phone || '—')}</a></span>${p.email ? `<span><i class="fa-regular fa-envelope"></i>${esc(p.email)}</span>` : ''}${age != null ? `<span><i class="fa-solid fa-cake-candles"></i>${age} ans</span>` : ''}${p.gender ? `<span><i class="fa-solid fa-venus-mars"></i>${p.gender === 'F' ? 'Femme' : 'Homme'}</span>` : ''}${p.address ? `<span><i class="fa-solid fa-location-dot"></i>${esc(p.address)}</span>` : ''}<span><i class="fa-regular fa-calendar"></i>Patient depuis ${fmtD((p.createdAt || '').slice(0, 10))}</span></div></div></div>
        <div class="toolbar"><a class="btn btn-light btn-sm" target="_blank" rel="noopener" href="https://wa.me/${waNumber(p.phone)}"><i class="fa-brands fa-whatsapp" style="color:#25d366"></i></a><button class="btn btn-light btn-sm" data-action="editPatient" data-id="${p.id}"><i class="fa-regular fa-pen-to-square"></i> Modifier</button><button class="btn btn-primary btn-sm" data-action="newApptFor" data-pid="${p.id}"><i class="fa-solid fa-calendar-plus"></i> Rendez-vous</button></div></div>
        <div class="balance"><div><small>Total des soins</small><strong>${money(fin.total)}</strong></div><div><small>Total versé</small><strong style="color:var(--green)">${money(fin.paid)}</strong></div><div><small>Reste à payer</small><strong style="color:${fin.rest ? 'var(--red)' : 'var(--green)'}">${money(fin.rest)}</strong></div></div>
        ${p.notes ? `<div class="notice" style="margin-top:1rem"><i class="fa-regular fa-note-sticky"></i> ${esc(p.notes)}</div>` : ''}</div>

      <div class="card"><div class="card-head"><h3><i class="fa-solid fa-file-medical"></i> Plans de traitement</h3><button class="btn btn-primary btn-sm" data-action="newTreatment" data-pid="${id}"><i class="fa-solid fa-plus"></i> Ajouter un soin</button></div>
        <div class="table-wrap"><table><thead><tr><th>Date</th><th>Soin</th><th>Statut</th><th class="num">Montant</th><th class="num">Versé</th><th class="num">Reste</th><th>Progression</th><th class="num"></th></tr></thead><tbody>
        ${treats.length ? treats.map((t) => { const pd = treatPaid(t.id); return `<tr><td>${fmtD(t.date)}</td><td><strong style="color:var(--ink)">${esc(t.label || svc(t.serviceId)?.name || '—')}</strong>${t.notes ? `<br><small class="muted">${esc(t.notes)}</small>` : ''}</td>
          <td><span class="pill ${t.status === 'terminé' ? 'ok' : t.status === 'devis' ? 'src' : 'warn'}">${esc(t.status || 'en cours')}</span></td>
          <td class="num">${money(t.total)}</td><td class="num amount-pos">${money(pd)}</td><td class="num ${t.total - pd > 0 ? 'amount-neg' : ''}">${money(Math.max(0, t.total - pd))}</td>
          <td><div class="progress"><span style="width:${t.total ? Math.min(100, (pd / t.total) * 100) : 0}%"></span></div></td>
          <td class="num"><div class="actions"><button class="icon-btn" title="Versement" data-action="newPayment" data-pid="${id}" data-tid="${t.id}"><i class="fa-solid fa-money-bill-wave"></i></button><button class="icon-btn" title="Modifier" data-action="editTreatment" data-id="${t.id}"><i class="fa-regular fa-pen-to-square"></i></button></div></td></tr>`; }).join('')
          : `<tr><td colspan="8">${empty('fa-file-circle-plus', 'Aucun soin enregistré')}</td></tr>`}</tbody></table></div></div>

      <div class="grid g2">
        <div class="card"><div class="card-head"><h3><i class="fa-solid fa-money-bill-wave"></i> Versements</h3><button class="btn btn-primary btn-sm" data-action="newPayment" data-pid="${id}"><i class="fa-solid fa-plus"></i> Versement</button></div>
          <div class="table-wrap"><table><thead><tr><th>Date</th><th>Soin</th><th>Mode</th><th class="num">Montant</th><th class="num"></th></tr></thead><tbody>
          ${pays.length ? pays.map((x) => `<tr><td>${fmtD(x.date)}</td><td>${esc(D.treatments.find((t) => t.id === x.treatmentId)?.label || 'Général')}${x.note ? `<br><small class="muted">${esc(x.note)}</small>` : ''}</td><td>${esc(x.method)}</td><td class="num amount-pos">${money(x.amount)}</td>
            <td class="num"><div class="actions"><button class="icon-btn" title="Imprimer le reçu" data-action="receipt" data-id="${x.id}"><i class="fa-solid fa-print"></i></button><button class="icon-btn" title="Modifier" data-action="editPayment" data-id="${x.id}"><i class="fa-regular fa-pen-to-square"></i></button></div></td></tr>`).join('')
            : `<tr><td colspan="5">${empty('fa-wallet', 'Aucun versement')}</td></tr>`}</tbody></table></div></div>
        <div class="card"><div class="card-head"><h3><i class="fa-regular fa-calendar"></i> Historique des rendez-vous</h3></div>
          <div class="list">${appts.length ? appts.map((a) => `<div class="li" data-action="apptDetail" data-id="${a.id}" style="cursor:pointer"><span class="time">${fmtD(a.date)}</span><div class="info"><strong>${a.time} · ${esc(svc(a.serviceId)?.name || '—')}</strong><small>${a.source === 'web' ? 'En ligne' : 'Cabinet'}</small></div>${pill(a.status)}</div>`).join('') : empty('fa-calendar-xmark', 'Aucun rendez-vous')}</div></div>
      </div>
      <div style="text-align:right"><button class="btn btn-danger btn-sm" data-action="deletePatient" data-id="${id}"><i class="fa-regular fa-trash-can"></i> Supprimer ce patient</button></div>`);
  }

  function patientForm(p = {}) {
    const editing = !!p.id;
    formModal({
      title: editing ? 'Modifier le patient' : 'Nouveau patient', icon: 'fa-user-plus', values: p,
      fields: [
        { name: 'name', label: 'Nom et prénom', required: true, full: true },
        { name: 'phone', label: 'Téléphone', type: 'tel', required: true },
        { name: 'email', label: 'E-mail', type: 'email' },
        { name: 'birthdate', label: 'Date de naissance', type: 'date' },
        { name: 'gender', label: 'Sexe', type: 'select', options: [{ value: '', label: '—' }, { value: 'F', label: 'Femme' }, { value: 'H', label: 'Homme' }] },
        { name: 'address', label: 'Adresse', full: true },
        { name: 'notes', label: 'Notes médicales (allergies, antécédents…)', type: 'textarea', full: true },
      ],
      onSubmit: async (v) => {
        const r = editing ? await store.update('patients', p.id, v) : await store.create('patients', v);
        toast(editing ? 'Patient modifié' : 'Patient ajouté'); await reload(true);
        if (!editing) go('patient', r.id); else render();
      },
    });
  }
  function treatmentForm(pid, t = {}) {
    const editing = !!t.id;
    formModal({
      title: editing ? 'Modifier le soin' : 'Nouveau plan de traitement', icon: 'fa-file-medical',
      values: { date: todayIso(), status: 'en cours', ...t },
      fields: [
        { name: 'serviceId', label: 'Type de soin', type: 'select', full: true, options: [{ value: '', label: '— Autre —' }, ...D.services.map((s) => ({ value: s.id, label: `${s.name} (${money(s.price)})` }))] },
        { name: 'label', label: 'Libellé', required: true, full: true },
        { name: 'total', label: 'Montant total (DA)', type: 'number', required: true, attrs: 'min="0" step="100"' },
        { name: 'date', label: 'Date de début', type: 'date' },
        { name: 'status', label: 'Statut', type: 'select', options: ['devis', 'en cours', 'terminé'].map((x) => ({ value: x, label: x[0].toUpperCase() + x.slice(1) })) },
        { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, full: true },
      ],
      onOpen: (form) => form.serviceId.addEventListener('change', () => { const s = svc(form.serviceId.value); if (s) { form.label.value = s.name; form.total.value = s.price; } }),
      onSubmit: async (v) => {
        v.patientId = pid;
        editing ? await store.update('treatments', t.id, v) : await store.create('treatments', v);
        toast('Soin enregistré'); await reload();
      },
      onDelete: editing ? async () => { await store.remove('treatments', t.id); toast('Soin supprimé'); await reload(); } : null,
    });
  }
  function paymentForm(pid, x = {}, tid = '') {
    const editing = !!x.id;
    const treats = D.treatments.filter((t) => t.patientId === pid);
    const p = pat(pid);
    const fin = finance(pid);
    formModal({
      title: editing ? 'Modifier le versement' : 'Nouveau versement', icon: 'fa-money-bill-wave',
      intro: `<div class="notice" style="margin-bottom:1rem"><i class="fa-solid fa-user"></i><div><strong>${esc(p?.name)}</strong> — reste à payer : <strong>${money(fin.rest)}</strong></div></div>`,
      values: { date: todayIso(), method: 'Espèces', treatmentId: tid || (treats.length === 1 ? treats[0].id : ''), ...x },
      fields: [
        { name: 'treatmentId', label: 'Soin concerné', type: 'select', full: true, options: [{ value: '', label: 'Général (non affecté)' }, ...treats.map((t) => ({ value: t.id, label: `${t.label} — reste ${money(Math.max(0, t.total - treatPaid(t.id)))}` }))] },
        { name: 'amount', label: 'Montant (DA)', type: 'number', required: true, attrs: 'min="0" step="100"' },
        { name: 'date', label: 'Date', type: 'date', required: true },
        { name: 'method', label: 'Mode de paiement', type: 'select', options: METHODS.map((m) => ({ value: m, label: m })) },
        { name: 'note', label: 'Note', placeholder: '' },
      ],
      onSubmit: async (v) => {
        if (!(v.amount > 0)) throw new Error('Le montant doit être supérieur à 0.');
        v.patientId = pid;
        editing ? await store.update('payments', x.id, v) : await store.create('payments', v);
        toast('Versement enregistré'); await reload();
      },
      onDelete: editing ? async () => { await store.remove('payments', x.id); toast('Versement supprimé'); await reload(); } : null,
    });
  }
  function printReceipt(id) {
    const x = D.payments.find((y) => y.id === id); if (!x) return;
    const p = pat(x.patientId) || {}; const t = D.treatments.find((y) => y.id === x.treatmentId); const fin = finance(x.patientId); const st = D.settings;
    const w = window.open('', '_blank', 'width=720,height=800');
    if (!w) return toast('Autorisez les fenêtres pop-up pour imprimer', 'bad');
    w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Reçu ${esc(id.slice(0, 6).toUpperCase())}</title>
      <style>body{font-family:Arial,sans-serif;color:#222;max-width:640px;margin:30px auto;padding:0 20px}header{display:flex;align-items:center;gap:16px;border-bottom:3px solid #7b65c4;padding-bottom:14px}header img{width:90px}h1{color:#7b65c4;margin:0;font-size:22px}small{color:#777}h2{text-align:center;letter-spacing:.2em;margin:28px 0 18px;color:#5f4aa8}table{width:100%;border-collapse:collapse;margin:14px 0}td{padding:9px;border-bottom:1px solid #eee}td:last-child{text-align:right;font-weight:bold}.total{font-size:20px;background:#f6f3fd}.sign{margin-top:60px;display:flex;justify-content:space-between}.sign div{border-top:1px solid #999;padding-top:6px;width:200px;text-align:center;font-size:13px;color:#666}</style></head>
      <body><header><img src="${new URL('../assets/logo.jpg', location.href).href}"><div><h1>${esc(st.clinicName)}</h1><small>${esc(st.tagline || '')}<br>${esc(st.address)} — Tél : ${esc(st.phone)}</small></div></header>
      <h2>REÇU DE PAIEMENT</h2>
      <table><tr><td>N° de reçu</td><td>${esc(id.slice(0, 8).toUpperCase())}</td></tr><tr><td>Date</td><td>${fmtD(x.date)}</td></tr><tr><td>Patient</td><td>${esc(p.name)}</td></tr><tr><td>Téléphone</td><td>${esc(p.phone)}</td></tr>
      <tr><td>Soin</td><td>${esc(t?.label || 'Général')}</td></tr><tr><td>Mode de paiement</td><td>${esc(x.method)}</td></tr>${x.note ? `<tr><td>Note</td><td>${esc(x.note)}</td></tr>` : ''}
      <tr class="total"><td>Montant versé</td><td>${money(x.amount)}</td></tr></table>
      <table><tr><td>Total des soins</td><td>${money(fin.total)}</td></tr><tr><td>Total versé à ce jour</td><td>${money(fin.paid)}</td></tr><tr><td>Reste à payer</td><td>${money(fin.rest)}</td></tr></table>
      <div class="sign"><div>Signature du patient</div><div>Cachet & signature du cabinet</div></div></body></html>`);
    w.document.close();
    // impression lancée depuis cette page : aucun script dans la fenêtre du reçu (compatible CSP)
    const img = w.document.querySelector('img');
    const go = () => setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 250);
    if (img && !img.complete) { img.onload = go; img.onerror = go; } else go();
  }

  /* =================================================================== SERVICES */
  function viewServices() {
    content(`<div class="card"><div class="card-head"><h3><i class="fa-solid fa-tooth"></i> Soins proposés (${D.services.length})</h3><button class="btn btn-primary" data-action="newService"><i class="fa-solid fa-plus"></i> Nouveau service</button></div>
      <p class="muted" style="margin:-.4rem 0 1rem;font-size:.85rem">Les services « visibles » apparaissent sur le site et dans le formulaire de réservation. Les tarifs ne sont pas affichés sur le site.</p>
      <div class="table-wrap"><table><thead><tr><th>Service</th><th>Description</th><th class="num">Tarif</th><th class="num">Durée</th><th>Site</th><th class="num">RDV</th><th class="num"></th></tr></thead><tbody>
      ${D.services.map((s) => `<tr><td><div class="name-cell"><span class="avatar" style="border-radius:10px"><i class="fa-solid ${esc(s.icon || 'fa-tooth')}"></i></span>${esc(s.name)}</div></td>
        <td class="muted" style="max-width:340px">${esc(s.description)}</td><td class="num"><strong>${money(s.price)}</strong></td><td class="num">${s.duration || '—'} min</td>
        <td>${s.public !== false ? '<span class="pill ok"><i class="fa-regular fa-eye"></i> Visible</span>' : '<span class="pill" style="background:var(--grey-50)"><i class="fa-regular fa-eye-slash"></i> Masqué</span>'}</td>
        <td class="num">${D.appointments.filter((a) => a.serviceId === s.id && a.status !== 'cancelled').length}</td>
        <td class="num"><button class="icon-btn" data-action="editService" data-id="${s.id}"><i class="fa-regular fa-pen-to-square"></i></button></td></tr>`).join('')}
      </tbody></table></div></div>`);
  }
  function serviceForm(s = {}) {
    const editing = !!s.id;
    formModal({
      title: editing ? 'Modifier le service' : 'Nouveau service', icon: 'fa-tooth', values: { public: true, duration: 30, icon: 'fa-tooth', ...s },
      fields: [
        { name: 'name', label: 'Nom du service', required: true, full: true },
        { name: 'description', label: 'Description (affichée sur le site)', type: 'textarea', rows: 2, full: true },
        { name: 'price', label: 'Tarif indicatif (DA)', type: 'number', attrs: 'min="0" step="100"' },
        { name: 'duration', label: 'Durée (min)', type: 'number', attrs: 'min="5" step="5"' },
        { name: 'icon', label: 'Icône', type: 'select', options: [...new Set(ICONS)].map((i) => ({ value: i, label: i.replace('fa-', '') })) },
        { name: 'public', label: 'Visible sur le site', type: 'checkbox' },
      ],
      onSubmit: async (v) => { editing ? await store.update('services', s.id, v) : await store.create('services', v); toast('Service enregistré'); await reload(); },
      onDelete: editing ? async () => { await store.remove('services', s.id); toast('Service supprimé'); await reload(); } : null,
    });
  }

  /* =================================================================== STOCK */
  function viewStock() {
    const f = S.stock;
    const cats = [...new Set(D.products.map((p) => p.category).filter(Boolean))].sort();
    const value = D.products.reduce((a, p) => a + p.quantity * (p.price || 0), 0);
    const low = D.products.filter((p) => p.quantity <= p.minQty && p.quantity > 0).length;
    const out = D.products.filter((p) => p.quantity <= 0).length;
    const soon = iso(new Date(Date.now() + 60 * 864e5));
    const expiring = D.products.filter((p) => p.expiry && p.expiry <= soon).length;
    content(`<div class="kpis">
        ${kpi('fa-boxes-stacked', 'Produits', D.products.length, 'blue')}
        ${kpi('fa-coins', 'Valeur du stock', money(value), 'green')}
        ${kpi('fa-triangle-exclamation', 'Stock faible', low, low ? 'orange' : 'green')}
        ${kpi('fa-ban', 'Ruptures / péremption < 60 j', `${out} / ${expiring}`, out || expiring ? 'red' : 'green')}
      </div>
      <div class="card"><div class="card-head"><div class="toolbar" style="flex:1">
        <div class="search"><i class="fa-solid fa-magnifying-glass"></i><input id="sQ" placeholder="Rechercher un produit…" value="${esc(f.q)}"></div>
        <select id="sCat"><option value="">Toutes les catégories</option>${cats.map((c) => `<option ${f.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      </div><button class="btn btn-primary" data-action="newProduct"><i class="fa-solid fa-plus"></i> Nouveau produit</button></div>
      <div class="table-wrap"><table><thead><tr><th>Produit</th><th>Catégorie</th><th class="num">Quantité</th><th class="num">Seuil</th><th class="num">Prix unit.</th><th class="num">Valeur</th><th>Péremption</th><th class="num">Mouvements</th></tr></thead><tbody id="sBody"></tbody></table></div></div>
      <div class="card"><div class="card-head"><h3><i class="fa-solid fa-right-left"></i> Derniers mouvements</h3></div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Produit</th><th>Type</th><th class="num">Quantité</th><th>Note</th><th class="num"></th></tr></thead><tbody>
      ${D.stockMoves.length ? [...D.stockMoves].sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt)).slice(0, 40).map((m) => `<tr><td>${fmtD(m.date)}</td><td>${esc(prod(m.productId)?.name || '—')}</td>
        <td>${m.type === 'in' ? '<span class="pill ok"><i class="fa-solid fa-arrow-down"></i> Entrée</span>' : '<span class="pill warn"><i class="fa-solid fa-arrow-up"></i> Sortie</span>'}</td>
        <td class="num"><strong>${m.type === 'in' ? '+' : '−'}${m.qty}</strong></td><td class="muted">${esc(m.note)}</td>
        <td class="num"><button class="icon-btn danger" title="Annuler ce mouvement" data-action="deleteMove" data-id="${m.id}"><i class="fa-solid fa-rotate-left"></i></button></td></tr>`).join('')
        : `<tr><td colspan="6">${empty('fa-right-left', 'Aucun mouvement enregistré')}</td></tr>`}</tbody></table></div></div>`);
    const draw = () => {
      const q = f.q.toLowerCase();
      const list = D.products.filter((p) => (!f.cat || p.category === f.cat) && (!q || `${p.name} ${p.supplier}`.toLowerCase().includes(q)))
        .sort((a, b) => (a.quantity <= a.minQty ? 0 : 1) - (b.quantity <= b.minQty ? 0 : 1) || a.name.localeCompare(b.name));
      $('#sBody').innerHTML = list.length ? list.map((p) => {
        const cls = p.quantity <= 0 ? 'bad' : p.quantity <= p.minQty ? 'warn' : 'ok';
        const exp = p.expiry ? (p.expiry <= todayIso() ? 'bad' : p.expiry <= soon ? 'warn' : '') : '';
        return `<tr><td><a data-action="editProduct" data-id="${p.id}" style="font-weight:600;color:var(--ink)">${esc(p.name)}</a>${p.supplier ? `<br><small class="muted">${esc(p.supplier)}</small>` : ''}</td><td>${esc(p.category)}</td>
          <td class="num"><span class="pill ${cls}">${p.quantity} ${esc(p.unit)}</span></td><td class="num muted">${p.minQty}</td><td class="num">${money(p.price)}</td><td class="num">${money(p.quantity * (p.price || 0))}</td>
          <td>${p.expiry ? `<span class="pill ${exp || 'src'}">${fmtD(p.expiry)}</span>` : '<span class="muted">—</span>'}</td>
          <td class="num"><div class="actions"><button class="btn btn-success btn-sm" data-action="stockMove" data-id="${p.id}" data-type="in" title="Entrée"><i class="fa-solid fa-plus"></i></button><button class="btn btn-light btn-sm" data-action="stockMove" data-id="${p.id}" data-type="out" title="Sortie / utilisation"><i class="fa-solid fa-minus"></i></button><button class="icon-btn" data-action="editProduct" data-id="${p.id}"><i class="fa-regular fa-pen-to-square"></i></button></div></td></tr>`;
      }).join('') : `<tr><td colspan="8">${empty('fa-box-open', 'Aucun produit')}</td></tr>`;
    };
    draw();
    $('#sQ').addEventListener('input', (e) => { f.q = e.target.value; draw(); });
    $('#sCat').addEventListener('change', (e) => { f.cat = e.target.value; draw(); });
  }
  function productForm(p = {}) {
    const editing = !!p.id;
    formModal({
      title: editing ? 'Modifier le produit' : 'Nouveau produit', icon: 'fa-box', values: { unit: 'pièce', minQty: 2, quantity: 0, ...p },
      fields: [
        { name: 'name', label: 'Nom du produit', required: true, full: true },
        { name: 'category', label: 'Catégorie', datalist: PROD_CATS },
        { name: 'supplier', label: 'Fournisseur' },
        ...(editing ? [] : [{ name: 'quantity', label: 'Quantité initiale', type: 'number', attrs: 'min="0"' }]),
        { name: 'unit', label: 'Unité', datalist: ['pièce', 'boîte', 'paquet', 'kit', 'seringue', 'flacon', 'sachet', 'rouleau'] },
        { name: 'minQty', label: 'Seuil d’alerte', type: 'number', attrs: 'min="0"' },
        { name: 'price', label: 'Prix unitaire (DA)', type: 'number', attrs: 'min="0" step="10"' },
        { name: 'expiry', label: 'Date de péremption', type: 'date' },
      ],
      onSubmit: async (v) => { editing ? await store.update('products', p.id, v) : await store.create('products', v); toast('Produit enregistré'); await reload(); },
      onDelete: editing ? async () => { await store.remove('products', p.id); toast('Produit supprimé'); await reload(); } : null,
    });
  }
  function moveForm(pid, type) {
    const p = prod(pid); if (!p) return;
    formModal({
      title: `${type === 'in' ? 'Entrée' : 'Sortie'} de stock`, icon: type === 'in' ? 'fa-arrow-down' : 'fa-arrow-up',
      intro: `<div class="notice" style="margin-bottom:1rem"><i class="fa-solid fa-box"></i><div><strong>${esc(p.name)}</strong> — en stock : <strong>${p.quantity} ${esc(p.unit)}</strong></div></div>`,
      values: { qty: 1, date: todayIso(), note: type === 'in' ? 'Réception commande' : 'Utilisation cabinet' },
      fields: [
        { name: 'qty', label: 'Quantité', type: 'number', required: true, attrs: 'min="1"' },
        { name: 'date', label: 'Date', type: 'date' },
        { name: 'note', label: 'Note', full: true },
      ],
      submit: type === 'in' ? 'Ajouter au stock' : 'Retirer du stock',
      onSubmit: async (v) => { await store.create('stockMoves', { ...v, productId: pid, type }); toast('Stock mis à jour'); await reload(); },
    });
  }

  /* =================================================================== ACCOUNTING */
  function viewAccounting() {
    const a = S.acc; const ym = a.ym;
    const pays = D.payments.filter((p) => p.date?.startsWith(ym)).sort((x, y) => y.date.localeCompare(x.date));
    const exps = D.expenses.filter((p) => p.date?.startsWith(ym)).sort((x, y) => y.date.localeCompare(x.date));
    const rec = sum(pays, 'amount'), dep = sum(exps, 'amount');
    const years = [...new Set([new Date().getFullYear(), ...D.payments.map((p) => +p.date.slice(0, 4)), ...D.expenses.map((p) => +p.date.slice(0, 4))])].filter(Boolean).sort((x, y) => y - x);
    let yr = 0, yd = 0;
    const annual = Array.from({ length: 12 }, (_, i) => { const m = `${a.year}-${pad(i + 1)}`; const r = sum(D.payments.filter((p) => p.date?.startsWith(m)), 'amount'); const d = sum(D.expenses.filter((p) => p.date?.startsWith(m)), 'amount'); yr += r; yd += d; return { m, r, d }; });
    const [Y, M] = ym.split('-').map(Number);
    content(`<div class="card" style="padding:1rem 1.3rem"><div class="toolbar">
        <strong style="color:var(--ink)">Période :</strong><input type="month" id="accMonth" value="${ym}" style="width:auto">
        <span class="muted" style="text-transform:capitalize">${MONTHS[M - 1]} ${Y}</span><span style="flex:1"></span>
        <button class="btn btn-light" data-action="exportCsv"><i class="fa-solid fa-file-csv"></i> Exporter (Excel)</button>
        <button class="btn btn-primary" data-action="newExpense"><i class="fa-solid fa-plus"></i> Nouvelle dépense</button></div></div>
      <div class="kpis">
        ${kpi('fa-arrow-trend-up', 'Recettes du mois', money(rec), 'green')}
        ${kpi('fa-arrow-trend-down', 'Dépenses du mois', money(dep), 'red')}
        ${kpi('fa-scale-balanced', 'Résultat net', money(rec - dep), rec - dep >= 0 ? 'green' : 'red')}
        ${kpi('fa-file-invoice-dollar', 'Créances patients (total)', money(totalDebt()), 'orange')}
      </div>
      <div class="grid g2">
        <div class="card"><div class="card-head"><h3><i class="fa-solid fa-arrow-trend-up"></i> Recettes (versements patients)</h3><span class="pill ok">${pays.length} opérations</span></div>
          <div class="table-wrap"><table><thead><tr><th>Date</th><th>Patient</th><th>Mode</th><th class="num">Montant</th></tr></thead><tbody>
          ${pays.length ? pays.map((p) => `<tr><td>${fmtD(p.date)}</td><td><a href="#/patient/${p.patientId}">${esc(pat(p.patientId)?.name || '—')}</a></td><td>${esc(p.method)}</td><td class="num amount-pos">${money(p.amount)}</td></tr>`).join('') : `<tr><td colspan="4">${empty('fa-wallet', 'Aucune recette ce mois')}</td></tr>`}
          </tbody></table></div></div>
        <div class="card"><div class="card-head"><h3><i class="fa-solid fa-arrow-trend-down"></i> Dépenses</h3><span class="pill bad">${exps.length} opérations</span></div>
          <div class="table-wrap"><table><thead><tr><th>Date</th><th>Libellé</th><th>Catégorie</th><th class="num">Montant</th><th class="num"></th></tr></thead><tbody>
          ${exps.length ? exps.map((p) => `<tr><td>${fmtD(p.date)}</td><td>${esc(p.label)}${p.note ? `<br><small class="muted">${esc(p.note)}</small>` : ''}</td><td><span class="pill src">${esc(p.category)}</span></td><td class="num amount-neg">${money(p.amount)}</td><td class="num"><button class="icon-btn" data-action="editExpense" data-id="${p.id}"><i class="fa-regular fa-pen-to-square"></i></button></td></tr>`).join('') : `<tr><td colspan="5">${empty('fa-receipt', 'Aucune dépense ce mois')}</td></tr>`}
          </tbody></table></div></div>
      </div>
      <div class="grid g-2-1">
        <div class="card"><div class="card-head"><h3><i class="fa-solid fa-table"></i> Bilan annuel</h3><select id="accYear" style="width:auto">${years.map((y) => `<option ${y === a.year ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
          <div class="table-wrap"><table><thead><tr><th>Mois</th><th class="num">Recettes</th><th class="num">Dépenses</th><th class="num">Résultat</th></tr></thead><tbody>
          ${annual.map((r, i) => `<tr><td style="text-transform:capitalize">${MONTHS[i]}</td><td class="num">${money(r.r)}</td><td class="num">${money(r.d)}</td><td class="num ${r.r - r.d >= 0 ? 'amount-pos' : 'amount-neg'}">${money(r.r - r.d)}</td></tr>`).join('')}
          <tr style="background:var(--primary-50)"><td><strong>Total ${a.year}</strong></td><td class="num"><strong>${money(yr)}</strong></td><td class="num"><strong>${money(yd)}</strong></td><td class="num ${yr - yd >= 0 ? 'amount-pos' : 'amount-neg'}"><strong>${money(yr - yd)}</strong></td></tr>
          </tbody></table></div></div>
        <div class="card"><div class="card-head"><h3><i class="fa-solid fa-chart-pie"></i> Dépenses par catégorie (${a.year})</h3></div><div class="chart-box"><canvas id="cExp"></canvas></div></div>
      </div>`);
    $('#accMonth').addEventListener('change', (e) => { if (e.target.value) { S.acc.ym = e.target.value; render(); } });
    $('#accYear').addEventListener('change', (e) => { S.acc.year = +e.target.value; render(); });
    return () => {
      const by = {}; D.expenses.filter((e) => e.date?.startsWith(String(a.year))).forEach((e) => { by[e.category || 'Autre'] = (by[e.category || 'Autre'] || 0) + e.amount; });
      const ent = Object.entries(by).sort((x, y) => y[1] - x[1]);
      chart('cExp', doughnut(ent.map((e) => e[0]), ent.map((e) => e[1]), true));
    };
  }
  function expenseForm(x = {}) {
    const editing = !!x.id;
    formModal({
      title: editing ? 'Modifier la dépense' : 'Nouvelle dépense', icon: 'fa-receipt', values: { date: todayIso(), category: 'Fournitures', ...x },
      fields: [
        { name: 'label', label: 'Libellé', required: true, full: true },
        { name: 'amount', label: 'Montant (DA)', type: 'number', required: true, attrs: 'min="0" step="100"' },
        { name: 'date', label: 'Date', type: 'date', required: true },
        { name: 'category', label: 'Catégorie', datalist: EXP_CATS },
        { name: 'note', label: 'Note' },
      ],
      onSubmit: async (v) => { editing ? await store.update('expenses', x.id, v) : await store.create('expenses', v); toast('Dépense enregistrée'); await reload(); },
      onDelete: editing ? async () => { await store.remove('expenses', x.id); toast('Dépense supprimée'); await reload(); } : null,
    });
  }
  function exportCsv() {
    const ym = S.acc.ym;
    const rows = [['Type', 'Date', 'Libellé', 'Catégorie / Mode', 'Montant (DA)']];
    D.payments.filter((p) => p.date?.startsWith(ym)).forEach((p) => rows.push(['Recette', fmtD(p.date), `Versement — ${pat(p.patientId)?.name || ''}`, p.method, p.amount]));
    D.expenses.filter((p) => p.date?.startsWith(ym)).forEach((p) => rows.push(['Dépense', fmtD(p.date), p.label, p.category, -p.amount]));
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `comptabilite-${ym}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  /* =================================================================== STATS */
  function viewStats() {
    const y = String(S.stats.year);
    const years = [...new Set([new Date().getFullYear(), ...D.appointments.map((a) => +a.date.slice(0, 4))])].sort((a, b) => b - a);
    const appts = D.appointments.filter((a) => a.date.startsWith(y));
    const past = appts.filter((a) => a.date < todayIso() && a.status !== 'cancelled');
    const attended = past.filter((a) => a.status === 'done').length;
    const noshow = past.filter((a) => a.status === 'noshow').length;
    const cancelled = appts.filter((a) => a.status === 'cancelled').length;
    const web = appts.filter((a) => a.source === 'web').length;
    const pays = D.payments.filter((p) => p.date?.startsWith(y));
    const avg = pays.length ? sum(pays, 'amount') / pays.length : 0;
    content(`<div class="card" style="padding:1rem 1.3rem"><div class="toolbar"><strong style="color:var(--ink)">Année :</strong><select id="stYear" style="width:auto">${years.map((x) => `<option ${String(x) === y ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div>
      <div class="kpis">
        ${kpi('fa-calendar-check', 'Rendez-vous sur l’année', appts.length - cancelled)}
        ${kpi('fa-user-check', 'Taux de présence', past.length ? Math.round((attended / Math.max(1, attended + noshow)) * 100) + ' %' : '—', 'green')}
        ${kpi('fa-ban', 'Annulations / absences', `${cancelled} / ${noshow}`, 'red')}
        ${kpi('fa-globe', 'Réservations en ligne', appts.length ? Math.round((web / appts.length) * 100) + ' %' : '—', 'blue')}
        ${kpi('fa-sack-dollar', 'Chiffre d’affaires encaissé', money(sum(pays, 'amount')), 'green')}
        ${kpi('fa-receipt', 'Versement moyen', money(avg))}
        ${kpi('fa-user-plus', 'Nouveaux patients', D.patients.filter((p) => (p.createdAt || '').startsWith(y)).length, 'blue')}
        ${kpi('fa-file-medical', 'Soins démarrés', D.treatments.filter((t) => t.date?.startsWith(y)).length, 'orange')}
      </div>
      <div class="grid g2">
        <div class="card"><div class="card-head"><h3><i class="fa-solid fa-chart-column"></i> Rendez-vous par mois</h3></div><div class="chart-box"><canvas id="c1"></canvas></div></div>
        <div class="card"><div class="card-head"><h3><i class="fa-solid fa-chart-line"></i> Chiffre d’affaires & nouveaux patients</h3></div><div class="chart-box"><canvas id="c2"></canvas></div></div>
      </div>
      <div class="grid g3">
        <div class="card"><div class="card-head"><h3><i class="fa-solid fa-tooth"></i> CA par soin</h3></div><div class="chart-box sm"><canvas id="c3"></canvas></div></div>
        <div class="card"><div class="card-head"><h3><i class="fa-solid fa-credit-card"></i> Modes de paiement</h3></div><div class="chart-box sm"><canvas id="c4"></canvas></div></div>
        <div class="card"><div class="card-head"><h3><i class="fa-solid fa-calendar-week"></i> Affluence par jour</h3></div><div class="chart-box sm"><canvas id="c5"></canvas></div></div>
      </div>`);
    $('#stYear').addEventListener('change', (e) => { S.stats.year = +e.target.value; render(); });
    return () => {
      const ms = Array.from({ length: 12 }, (_, i) => `${y}-${pad(i + 1)}`);
      const st = (k, color) => ({ label: STATUS[k].label, data: ms.map((m) => appts.filter((a) => a.date.startsWith(m) && a.status === k).length), backgroundColor: color, borderRadius: 4, money: false });
      chart('c1', { type: 'bar', data: { labels: MONTHS_S, datasets: [st('done', '#2fa98c'), st('confirmed', '#4c8ee0'), st('pending', '#e19a3c'), st('noshow', '#d9576b'), st('cancelled', '#cfcbdc')] }, options: barOpts(true) });
      chart('c2', { data: { labels: MONTHS_S, datasets: [
        { type: 'bar', label: 'CA encaissé', data: ms.map((m) => sum(pays.filter((p) => p.date.startsWith(m)), 'amount')), backgroundColor: '#b3a3e2', borderRadius: 6, yAxisID: 'y' },
        { type: 'line', label: 'Nouveaux patients', money: false, data: ms.map((m) => D.patients.filter((p) => (p.createdAt || '').startsWith(m)).length), borderColor: '#2fa98c', backgroundColor: '#2fa98c', tension: .35, yAxisID: 'y1' },
      ] }, options: { ...barOpts(false), scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: '#f0eef6' }, ticks: { callback: (v) => nf.format(v) } }, y1: { beginAtZero: true, position: 'right', grid: { display: false }, ticks: { precision: 0 } } } } });
      const bySvc = {}; pays.forEach((p) => { const t = D.treatments.find((x) => x.id === p.treatmentId); const n = (t && (svc(t.serviceId)?.name || t.label)) || 'Non affecté'; bySvc[n] = (bySvc[n] || 0) + p.amount; });
      const e3 = Object.entries(bySvc).sort((a, b) => b[1] - a[1]);
      chart('c3', doughnut(e3.map((e) => e[0]), e3.map((e) => e[1]), true));
      const byM = {}; pays.forEach((p) => { byM[p.method || 'Autre'] = (byM[p.method || 'Autre'] || 0) + p.amount; });
      chart('c4', doughnut(Object.keys(byM), Object.values(byM), true));
      chart('c5', { type: 'bar', data: { labels: WEEK.map((d) => DAYS[d].slice(0, 3)), datasets: [{ label: 'Rendez-vous', money: false, data: WEEK.map((d) => appts.filter((a) => a.status !== 'cancelled' && parse(a.date).getDay() === d).length), backgroundColor: '#7b65c4', borderRadius: 6 }] }, options: { ...barOpts(false), plugins: { legend: { display: false } } } });
    };
  }

  /* =================================================================== SETTINGS */
  function viewSettings() {
    const st = D.settings;
    const hasDemo = ['patients', 'appointments', 'expenses'].some((k) => D[k].some((x) => x.demo));
    content(`<div class="grid g2">
      <form class="card" id="fInfo"><div class="card-head"><h3><i class="fa-solid fa-house-medical"></i> Informations du cabinet</h3></div>
        <div class="form-grid">
          ${field({ name: 'clinicName', label: 'Nom du cabinet', full: true }, st.clinicName)}
          ${field({ name: 'tagline', label: 'Sous-titre', full: true }, st.tagline)}
          ${field({ name: 'phone', label: 'Téléphone' }, st.phone)}
          ${field({ name: 'whatsapp', label: 'WhatsApp (format international)' }, st.whatsapp)}
          ${field({ name: 'address', label: 'Adresse', full: true }, st.address)}
          ${field({ name: 'email', label: 'E-mail', type: 'email', full: true }, st.email)}
          ${field({ name: 'facebook', label: 'Lien Facebook', full: true }, st.facebook)}
          ${field({ name: 'tiktok', label: 'Lien TikTok', full: true }, st.tiktok)}
        </div><div class="modal-foot"><button class="btn btn-primary"><i class="fa-solid fa-check"></i> Enregistrer</button></div></form>

      <form class="card" id="fHours"><div class="card-head"><h3><i class="fa-regular fa-clock"></i> Horaires & créneaux de réservation</h3></div>
        <table class="hours-table"><tbody>${WEEK.map((d) => { const h = st.hours[d] || { open: '09:00', close: '17:00', closed: true }; return `<tr><td style="text-transform:capitalize;font-weight:600;color:var(--ink)">${DAYS[d]}</td>
          <td><label class="check-label" style="font-weight:500"><input type="checkbox" name="open-${d}" ${h.closed ? '' : 'checked'}> Ouvert</label></td>
          <td><input type="time" name="o-${d}" value="${h.open}"></td><td><input type="time" name="c-${d}" value="${h.close}"></td></tr>`; }).join('')}</tbody></table>
        <div class="form-grid" style="margin-top:1rem">
          ${field({ name: 'slotMinutes', label: 'Durée d’un créneau (min)', type: 'select', options: [15, 20, 30, 45, 60].map((x) => ({ value: x, label: x + ' minutes' })) }, st.slotMinutes)}
          <div></div>
          ${field({ name: 'breakStart', label: 'Début de pause', type: 'time' }, st.breakStart)}
          ${field({ name: 'breakEnd', label: 'Fin de pause', type: 'time' }, st.breakEnd)}
        </div><p class="muted" style="font-size:.8rem;margin-top:.5rem">Laissez la pause vide pour la désactiver. Pour fermer un jour précis (congé, jour férié), utilisez « Bloquer la journée » dans le calendrier.</p>
        <div class="modal-foot"><button class="btn btn-primary"><i class="fa-solid fa-check"></i> Enregistrer</button></div></form>
    </div>
    <div class="grid g2">
      <form class="card" id="fPwd"><div class="card-head"><h3><i class="fa-solid fa-key"></i> Mot de passe du compte</h3><span class="muted" style="font-size:.82rem" id="userEmail2"></span></div>
        <div class="form-grid">${field({ name: 'current', label: 'Mot de passe actuel', type: 'password', full: true })}${field({ name: 'next', label: 'Nouveau mot de passe', type: 'password' })}${field({ name: 'confirm', label: 'Confirmer', type: 'password' })}</div>
        <p class="err" id="pwdErr" style="margin-top:.6rem"></p>
        <div class="modal-foot"><button class="btn btn-primary"><i class="fa-solid fa-lock"></i> Changer le mot de passe</button></div></form>
      <div class="card"><div class="card-head"><h3><i class="fa-solid fa-flask"></i> Données de démonstration</h3></div>
        <p class="muted" style="font-size:.88rem;margin-bottom:1rem">Pour découvrir le tableau de bord, vous pouvez générer des patients, rendez-vous, versements et dépenses fictifs. Ils pourront être supprimés en un clic sans toucher à vos vraies données.</p>
        <div class="toolbar"><button class="btn btn-light" data-action="demoAdd"><i class="fa-solid fa-wand-magic-sparkles"></i> Générer des données de démo</button>
        ${hasDemo ? '<button class="btn btn-danger" data-action="demoRemove"><i class="fa-regular fa-trash-can"></i> Supprimer les données de démo</button>' : ''}</div>
        <div class="notice" style="margin-top:1.2rem"><i class="fa-solid fa-database"></i><div>Les données sont enregistrées dans <strong>Firebase Firestore</strong> (projet ortho-smile-design) et synchronisées en temps réel. Exportez-les régulièrement depuis la console Firebase.</div></div></div>
    </div>`);
    $('#fInfo').addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.target; const v = {};
      ['clinicName', 'tagline', 'phone', 'whatsapp', 'address', 'email', 'facebook', 'tiktok'].forEach((k) => (v[k] = f.elements[k].value.trim()));
      try { await store.saveSettings(v); toast('Informations enregistrées'); await reload(true); } catch (err) { toast(err.message, 'bad'); }
    });
    $('#fHours').addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.target; const hours = {};
      for (const d of WEEK) hours[d] = { open: f.elements['o-' + d].value || '09:00', close: f.elements['c-' + d].value || '17:00', closed: !f.elements['open-' + d].checked };
      if (Object.values(hours).some((h) => !h.closed && h.open >= h.close)) return toast('L’heure d’ouverture doit précéder l’heure de fermeture', 'bad');
      try { await store.saveSettings({ hours, slotMinutes: +f.elements.slotMinutes.value, breakStart: f.elements.breakStart.value, breakEnd: f.elements.breakEnd.value }); toast('Horaires enregistrés'); await reload(true); } catch (err) { toast(err.message, 'bad'); }
    });
    $('#userEmail2').textContent = auth.currentUser?.email || '';
    $('#fPwd').addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.target; const err = $('#pwdErr'); err.textContent = '';
      if (f.next.value !== f.confirm.value) return (err.textContent = 'Les deux mots de passe ne correspondent pas.');
      if (f.next.value.length < 10 || !/[A-Za-z]/.test(f.next.value) || !/\d/.test(f.next.value)) return (err.textContent = 'Le nouveau mot de passe doit contenir au moins 10 caractères, dont des lettres et des chiffres.');
      try { await changePassword(f.current.value, f.next.value); f.reset(); toast('Mot de passe modifié'); } catch (x) { err.textContent = authMsg(x); }
    });
  }

  /* =================================================================== actions */
  const ACTIONS = {
    logout: async () => {},
    refresh: async () => { await reload(); toast('Données actualisées'); },
    newAppt: () => apptForm({}, { date: S.cal.mode === 'day' && route().view === 'calendar' ? S.cal.day : todayIso() }),
    newApptAt: (d) => apptForm({}, { date: d.date, time: d.time }),
    newApptFor: (d) => apptForm({}, { patientId: d.pid }),
    editAppt: (d) => apptForm(D.appointments.find((a) => a.id === d.id)),
    apptDetail: (d) => apptDetail(d.id),
    deleteAppt: async (d) => { if (await ask('Supprimer ce rendez-vous ?', 'Supprimer')) { await store.remove('appointments', d.id); closeModal(); toast('Rendez-vous supprimé'); await reload(); } },
    setStatus: async (d) => {
      try { await store.update('appointments', d.id, { status: d.st }); }
      catch (e) { if (e.status === 409 && (await ask('Le créneau est désormais occupé par un autre rendez-vous. Rétablir quand même ?', 'Oui', false))) await store.update('appointments', d.id, { status: d.st, force: true }); else if (e.status !== 409) throw e; else return; }
      toast('Statut : ' + STATUS[d.st].label);
      const wasOpen = modal.classList.contains('open'); await reload(); if (wasOpen) apptDetail(d.id);
    },
    calNav: (d) => {
      const k = +d.k;
      if (S.cal.mode === 'month') { const [y, m] = S.cal.ym.split('-').map(Number); const x = new Date(y, m - 1 + k, 1); S.cal.ym = `${x.getFullYear()}-${pad(x.getMonth() + 1)}`; }
      else { S.cal.day = addDays(S.cal.day, k); S.cal.ym = S.cal.day.slice(0, 7); }
      render();
    },
    calToday: () => { S.cal.day = todayIso(); S.cal.ym = S.cal.day.slice(0, 7); render(); },
    calMode: (d) => { S.cal.mode = d.mode; if (d.mode === 'day' && S.cal.day.slice(0, 7) !== S.cal.ym) S.cal.day = S.cal.ym === todayIso().slice(0, 7) ? todayIso() : S.cal.ym + '-01'; render(); },
    calDay: (d) => { S.cal.mode = 'day'; S.cal.day = d.date; S.cal.ym = d.date.slice(0, 7); render(); },
    blockDay: (d) => formModal({ title: 'Bloquer la journée', icon: 'fa-lock', values: { reason: 'Cabinet fermé' }, intro: `<p class="muted" style="margin-bottom:1rem;text-transform:capitalize">${fmtLong(d.date)}</p>`,
      fields: [{ name: 'reason', label: 'Motif (affiché aux patients)', full: true }], submit: 'Bloquer',
      onSubmit: async (v) => { await store.create('closures', { date: d.date, reason: v.reason }); toast('Journée bloquée'); await reload(); } }),
    unblockDay: async (d) => { await store.remove('closures', d.id); toast('Journée rouverte'); await reload(); },
    newPatient: () => patientForm(),
    editPatient: (d) => patientForm(pat(d.id)),
    deletePatient: async (d) => { if (await ask('Supprimer ce patient ainsi que ses soins, versements et rendez-vous ? Cette action est irréversible.', 'Supprimer')) { await store.remove('patients', d.id); toast('Patient supprimé'); await reload(true); go('patients'); } },
    newTreatment: (d) => treatmentForm(d.pid),
    editTreatment: (d) => { const t = D.treatments.find((x) => x.id === d.id); treatmentForm(t.patientId, t); },
    newPayment: (d) => paymentForm(d.pid, {}, d.tid),
    editPayment: (d) => { const x = D.payments.find((y) => y.id === d.id); paymentForm(x.patientId, x); },
    receipt: (d) => printReceipt(d.id),
    newService: () => serviceForm(),
    editService: (d) => serviceForm(svc(d.id)),
    newProduct: () => productForm(),
    editProduct: (d) => productForm(prod(d.id)),
    stockMove: (d) => moveForm(d.id, d.type),
    deleteMove: async (d) => { if (await ask('Annuler ce mouvement ? La quantité du produit sera corrigée.', 'Annuler le mouvement')) { await store.remove('stockMoves', d.id); toast('Mouvement annulé'); await reload(); } },
    newExpense: () => expenseForm(),
    editExpense: (d) => expenseForm(D.expenses.find((x) => x.id === d.id)),
    exportCsv: () => exportCsv(),
    demoAdd: async () => { if (await ask('Générer des données fictives de démonstration ?', 'Générer', false)) { await store.addDemo(); toast('Données de démo ajoutées'); await reload(); } },
    demoRemove: async () => { if (await ask('Supprimer toutes les données de démonstration ?', 'Supprimer')) { await store.removeDemo(); toast('Données de démo supprimées'); await reload(); } },
  };
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !ACTIONS[el.dataset.action]) return;
    e.preventDefault(); e.stopPropagation();
    try { await ACTIONS[el.dataset.action](el.dataset, el); } catch (err) { toast(err.message || 'Erreur', 'bad'); }
  });

  /* =================================================================== sidebar */
  const sidebar = $('#sidebar'), overlay = $('#sbOverlay');
  const closeSidebar = () => { sidebar.classList.remove('open'); overlay.classList.remove('open'); };
  $('#menuBtn').addEventListener('click', () => { sidebar.classList.add('open'); overlay.classList.add('open'); });
  overlay.addEventListener('click', closeSidebar);
  $$('#sbNav a').forEach((a) => (a.href = '#/' + a.dataset.view));

  /* =================================================================== auth & boot (Firebase Authentication) */
  let unsubscribe = null;
  const AUTH_ERRORS = {
    'auth/invalid-credential': 'E-mail ou mot de passe incorrect.',
    'auth/invalid-login-credentials': 'E-mail ou mot de passe incorrect.',
    'auth/wrong-password': 'Mot de passe incorrect.',
    'auth/user-not-found': 'Aucun compte avec cet e-mail.',
    'auth/invalid-email': 'Adresse e-mail invalide.',
    'auth/too-many-requests': 'Trop de tentatives. Réessayez dans quelques minutes.',
    'auth/network-request-failed': 'Connexion Internet indisponible.',
    'auth/weak-password': 'Mot de passe trop faible (6 caractères minimum).',
    'auth/requires-recent-login': 'Reconnectez-vous puis réessayez.',
    'auth/configuration-not-found': 'Firebase Authentication n’est pas encore activé (console Firebase → Authentication → Commencer).',
    'auth/operation-not-allowed': 'La connexion par e-mail n’est pas activée dans Firebase.',
  };
  const authMsg = (e) => AUTH_ERRORS[e.code] || e.message || 'Erreur';

  function showLogin(message = '') {
    $('#app').hidden = true; $('#login').hidden = false;
    $('#loginErr').textContent = message;
    setTimeout(() => $('#loginForm').email.focus(), 50);
  }
  function onData({ added }) {
    D = store.D;
    if (!$('#app').hidden && $('#content').dataset.loading) { delete $('#content').dataset.loading; }
    updateBadges();
    const web = added.filter((a) => a.source === 'web');
    if (web.length) toast(`${web.length} nouvelle(s) demande(s) de rendez-vous en ligne`);
    store.linkWebAppointments();
    scheduleRender();
  }
  function onDbError(e) {
    console.error(e);
    toast(e.code === 'permission-denied' ? 'Accès refusé par Firestore : vérifiez les règles Firestore.' : 'Erreur de connexion à la base de données.', 'bad');
  }

  onAuthStateChanged(auth, async (user) => {
    unsubscribe?.(); unsubscribe = null; D = null;
    if (!user) return showLogin();
    $('#login').hidden = true; $('#app').hidden = false;
    $('#todayLabel').textContent = fmtLong(todayIso());
    $('#userEmail').textContent = user.email;
    $('#content').dataset.loading = '1';
    $('#content').innerHTML = '<div class="card">' + empty('fa-spinner fa-spin', 'Chargement des données…') + '</div>';
    try { await withTimeout(store.ensureSeed()); }
    catch (e) { console.error(e); return showLogin(e.code === 'timeout' ? 'Impossible de joindre Firestore : vérifiez que la base est créée dans la console Firebase.' : 'Accès à la base refusé : vérifiez les règles Firestore.'); }
    unsubscribe = store.subscribe(onData, onDbError);
  });

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault(); $('#loginErr').textContent = '';
    const f = e.target; const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    try { await signInWithEmailAndPassword(auth, f.email.value.trim(), f.password.value); f.password.value = ''; }
    catch (err) { $('#loginErr').textContent = authMsg(err); }
    finally { btn.disabled = false; }
  });
  $('#forgot').addEventListener('click', async (e) => {
    e.preventDefault();
    const email = $('#loginForm').email.value.trim();
    if (!email) return ($('#loginErr').textContent = 'Saisissez votre e-mail puis cliquez à nouveau sur « Mot de passe oublié ».');
    try { await sendPasswordResetEmail(auth, email); $('#loginErr').textContent = ''; toast('E-mail de réinitialisation envoyé'); }
    catch (err) { $('#loginErr').textContent = authMsg(err); }
  });

  // Déconnexion automatique après 30 minutes sans activité (poste partagé au cabinet)
  const IDLE_MS = 30 * 60 * 1000;
  let lastActivity = Date.now();
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true }));
  setInterval(async () => {
    if (!auth.currentUser || Date.now() - lastActivity < IDLE_MS) return;
    lastActivity = Date.now();
    closeModal();
    await signOut(auth);
    showLogin('Vous avez été déconnecté(e) après 30 minutes d’inactivité.');
  }, 30000);

  ACTIONS.logout = async () => { await signOut(auth); location.hash = ''; };
  ACTIONS.refresh = async () => { await reload(); toast('Données synchronisées en temps réel'); };
  changePassword = async (current, next) => {
    const user = auth.currentUser;
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current));
    await updatePassword(user, next);
  };
})();
