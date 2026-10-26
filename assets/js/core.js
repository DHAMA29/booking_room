/* ============================================
   Campus Facility Booking — Core (dipakai user & admin)
   Isi: util, storage wrapper, notifikasi card (toast),
   modal konfirmasi animasi, validator UGM (NIM/email/+62)
   ============================================ */
window.CFB = window.CFB || {};
(function () {
  'use strict';

  // ============ Util ============
  const util = {
    esc(str) {
      if (str == null) return '';
      return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
    pad2(n) { return String(n).padStart(2, '0'); },
    hourLabel(h) { return util.pad2(h) + ':00'; },
    rangeLabel(startHour, endHour) { return util.hourLabel(startHour) + ' \u2013 ' + util.hourLabel(endHour); },
    todayStr() {
      const d = new Date();
      return d.getFullYear() + '-' + util.pad2(d.getMonth() + 1) + '-' + util.pad2(d.getDate());
    },
    nowHour() { return new Date().getHours(); },
    dateParts(ds) {
      const d = new Date(ds + 'T00:00:00');
      return {
        day: d.toLocaleDateString('id-ID', { weekday: 'short' }),
        date: d.getDate(),
        month: d.toLocaleDateString('id-ID', { month: 'short' }),
        full: d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      };
    },
    /* Paksa ulang animasi CSS pada elemen (untuk transisi antar halaman) */
    animateIn(el, cls) {
      if (!el) return;
      el.classList.remove('page-enter');
      void el.offsetWidth; // force reflow
      el.classList.add('page-enter');
    },
    /* Stagger anak-anak container: muncul berurutan halus */
    stagger(container, stepMs) {
      if (!container) return;
      Array.from(container.children).forEach((child, i) => {
        child.style.setProperty('--i', Math.min(i, 14));
        child.classList.remove('st-in');
        void child.offsetWidth;
        child.classList.add('st-in');
      });
    },
    /* Animasi angka naik (KPI admin) */
    countUp(el, target, dur) {
      if (!el) return;
      dur = dur || 700;
      const t0 = performance.now();
      function tick(t) {
        const p = Math.min(1, (t - t0) / dur);
        const e = 1 - Math.pow(1 - p, 3); // ease-out cubic
        el.textContent = Math.round(target * e);
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }
  };

  // ============ Storage wrapper (aman, try-catch) ============
  const store = {
    get(key, fallback) {
      try {
        const v = JSON.parse(localStorage.getItem(key));
        return v == null ? fallback : v;
      } catch (e) { return fallback; }
    },
    set(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); return true; }
      catch (e) { return false; }
    },
    remove(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }
  };

  // ============ Ikon SVG (stroke, konsisten) ============
  const ICONS = {
    success: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/></svg>',
    error: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
    warning: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    warningSmall: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
    bigCheck: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    grid: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    inbox: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
    building: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18"/><path d="M16 8h2a2 2 0 0 1 2 2v12"/><path d="M2 22h20"/><path d="M8 6h4M8 10h4M8 14h4M8 18h4"/></svg>',
    eye: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    edit: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
  };

  // ============ Notifikasi card (toast) ============
  function ensureStack() {
    let s = document.getElementById('cfbToastStack');
    if (!s) {
      s = document.createElement('div');
      s.id = 'cfbToastStack';
      s.className = 'toast-stack';
      s.setAttribute('aria-live', 'polite');
      document.body.appendChild(s);
    }
    return s;
  }

  function toastCard(type, title, message, opts) {
    opts = opts || {};
    const stack = ensureStack();
    while (stack.children.length >= 4) dismissCard(stack.firstElementChild); // batasi tumpukan

    const durations = { success: 4000, info: 4500, warning: 5500, error: 6500 };
    const dur = opts.duration || durations[type] || 4000;

    const el = document.createElement('div');
    el.className = 'toast-card tc-' + type;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML =
      '<div class="tc-icon">' + (ICONS[type] || ICONS.info) + '</div>' +
      '<div class="tc-body">' +
      '<p class="tc-title">' + util.esc(title) + '</p>' +
      (message ? '<p class="tc-message">' + util.esc(message) + '</p>' : '') +
      '</div>' +
      '<button type="button" class="tc-close" aria-label="Tutup notifikasi">' + ICONS.close + '</button>' +
      '<span class="tc-progress" style="animation-duration:' + dur + 'ms"></span>';

    el.querySelector('.tc-close').addEventListener('click', () => dismissCard(el));
    stack.appendChild(el);
    setTimeout(() => dismissCard(el), dur);
    return el;
  }

  function dismissCard(el) {
    if (!el || el.dataset.closing) return;
    el.dataset.closing = '1';
    el.classList.add('tc-hide');
    setTimeout(() => el.remove(), 240);
  }

  const notify = {
    success(title, message, opts) { return toastCard('success', title, message, opts); },
    error(title, message, opts) { return toastCard('error', title, message, opts); },
    warning(title, message, opts) { return toastCard('warning', title, message, opts); },
    info(title, message, opts) { return toastCard('info', title, message, opts); }
  };

  // ============ Modal konfirmasi (Promise<boolean>, animasi) ============
  function confirmModal(opts) {
    opts = opts || {};
    const danger = !!opts.danger;
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.className = 'modal-overlay';
      ov.innerHTML =
        '<div class="modal-card" role="dialog" aria-modal="true">' +
        '  <div class="modal-icon ' + (danger ? 'danger' : '') + '">' + (danger ? ICONS.warning : ICONS.info) + '</div>' +
        '  <h3 class="modal-title">' + util.esc(opts.title || 'Konfirmasi') + '</h3>' +
        '  <div class="modal-message">' + (opts.html || util.esc(opts.message || '')) + '</div>' +
        '  <div class="modal-actions">' +
        '    <button type="button" class="btn-ghost" data-modal-cancel>' + util.esc(opts.cancelText || 'Batal') + '</button>' +
        '    <button type="button" class="btn-primary' + (danger ? ' btn-danger' : '') + '" data-modal-ok>' + util.esc(opts.confirmText || 'Ya, lanjutkan') + '</button>' +
        '  </div>' +
        '</div>';
      document.body.appendChild(ov);
      requestAnimationFrame(() => ov.classList.add('show'));

      const btnOk = ov.querySelector('[data-modal-ok]');
      ov.querySelector('[data-modal-cancel]').addEventListener('click', () => close(false));
      btnOk.addEventListener('click', () => close(true));
      ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(false); });
      const onKey = (e) => { if (e.key === 'Escape') close(false); };
      document.addEventListener('keydown', onKey);
      setTimeout(() => btnOk.focus(), 60);

      function close(val) {
        document.removeEventListener('keydown', onKey);
        ov.classList.remove('show');
        setTimeout(() => ov.remove(), 200);
        resolve(val);
      }
    });
  }

  // ============ Validator (format UGM) ============
  const RE = {
    // NIM UGM: tahun(2)/nomor urut(6)/kode program(2-3 huruf)/nomor(5) — contoh: 21/456789/PA/20123
    nim: /^\d{2}\/\d{6}\/[A-Z]{2,3}\/\d{5}$/,
    emailUgm: /^[a-z0-9._%+-]+@mail\.ugm\.ac\.id$/i,
    phoneLocal: /^8\d{8,11}$/
  };

  const validators = {
    name(v) {
      const s = String(v == null ? '' : v).trim();
      if (!s) return 'Nama lengkap wajib diisi';
      if (s.length < 3) return 'Nama minimal 3 karakter';
      if (s.length > 80) return 'Nama maksimal 80 karakter';
      return '';
    },
    nim(v) {
      const s = String(v == null ? '' : v).trim().toUpperCase();
      if (!s) return 'NIM wajib diisi';
      if (!RE.nim.test(s)) return 'Format NIM UGM: tahun/nomor/kode/nomor — contoh 21/456789/PA/20123';
      return '';
    },
    email(v) {
      const s = String(v == null ? '' : v).trim();
      if (!s) return 'Email wajib diisi';
      if (!RE.emailUgm.test(s)) return 'Gunakan email mahasiswa UGM yang berakhiran @mail.ugm.ac.id';
      return '';
    },
    phoneLocal(v) {
      const raw = String(v == null ? '' : v).trim();
      if (!raw) return 'Nomor telepon wajib diisi';
      const digits = cleanPhoneLocal(raw); // buang tanda hubung/spasi & awalan 0/62
      if (!RE.phoneLocal.test(digits)) return 'Nomor tidak valid — ketik tanpa awalan 0/62, contoh: 812-3456-7890';
      return '';
    },
    participants(v, capacity) {
      const s = String(v == null ? '' : v).trim();
      if (!s) return 'Jumlah peserta wajib diisi';
      const n = parseInt(s, 10);
      if (isNaN(n) || n < 1) return 'Jumlah peserta minimal 1';
      if (n > 999) return 'Jumlah peserta maksimal 999';
      if (capacity && n > capacity) return 'Melebihi kapasitas fasilitas (maks ' + capacity + ' orang)';
      return '';
    },
    organization(v) {
      const s = String(v == null ? '' : v).trim();
      if (!s) return 'Organisasi / program studi wajib diisi';
      if (s.length < 2) return 'Minimal 2 karakter';
      return '';
    },
    purpose(v) {
      const s = String(v == null ? '' : v).trim();
      if (!s) return 'Tujuan peminjaman wajib diisi';
      if (s.length < 15) return 'Jelaskan tujuan minimal 15 karakter';
      if (s.length > 500) return 'Tujuan maksimal 500 karakter';
      return '';
    }
  };

  // ============ Auto-format ============
  /* NIM: susun otomatis menjadi XX/XXXXXX/AA/XXXXX saat diketik */
  function formatNIM(raw) {
    const clean = String(raw == null ? '' : raw).toUpperCase().replace(/[^0-9A-Z]/g, '');
    const d1 = (clean.match(/^\d{0,2}/) || [''])[0];
    let rest = clean.slice(d1.length);
    const d2 = (rest.match(/^\d{0,6}/) || [''])[0];
    rest = rest.slice(d2.length);
    const l1 = (rest.match(/^[A-Z]{0,3}/) || [''])[0];
    rest = rest.slice(l1.length);
    const d3 = (rest.match(/^\d{0,5}/) || [''])[0];

    let out = d1;
    if (d2) out += '/' + d2;
    if (l1) out += '/' + l1;
    if (d3) out += '/' + d3;
    return out;
  }

  /* Telepon: ambil bagian lokal (setelah +62), buang awalan 0/62 */
  function cleanPhoneLocal(raw) {
    let d = String(raw == null ? '' : raw).replace(/\D/g, '');
    while (d.length > 9 && (d.startsWith('62') || d.startsWith('0'))) {
      d = d.replace(/^62/, '').replace(/^0+/, '');
    }
    if (d.startsWith('0')) d = d.replace(/^0+/, '');
    return d.slice(0, 13);
  }

  /* Telepon: tata menjadi 812-3456-7890 */
  function formatPhoneLocal(digits) {
    const d = cleanPhoneLocal(digits);
    const g = [d.slice(0, 3), d.slice(3, 7), d.slice(7, 11), d.slice(11)].filter(Boolean);
    return g.join('-');
  }

  // ============ Publikasi ============
  CFB.util = util;
  CFB.store = store;
  CFB.notify = notify;
  CFB.confirm = confirmModal;
  CFB.validators = validators;
  CFB.format = { nim: formatNIM, phoneLocal: formatPhoneLocal, cleanPhoneLocal: cleanPhoneLocal };
  CFB.icons = ICONS;
})();
