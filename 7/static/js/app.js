/* ==========================================================================
   Virtual Lab Kimia Dasar: Titrasi Asam-Basa
   Seluruh perhitungan, state, dan interaksi berjalan di sisi klien.

   Struktur kelas:
   - Indicator, TitrationModel   : data dan perhitungan kimia
   - Store, LabController        : state reaktif dan aksi domain
   - ApparatusRenderer           : animasi alat pada canvas (buret, labu, tetesan)
   - CurveRenderer               : grafik pH terhadap volume pada canvas
   - Simulation                  : loop animasi dan aliran titran
   - DragDropController          : HTML5 Drag and Drop native
   - UIController                : sinkronisasi state ke DOM
   ========================================================================== */

/* ---------- Utilitas ---------- */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const fmt = (value, digits = 2) =>
  Number(value).toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const hexToRgb = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mixRgb = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgbStr = (rgb, alpha = 1) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
const hexA = (hex, alpha) => rgbStr(hexToRgb(hex), alpha);

const readPalette = () => {
  const styles = getComputedStyle(document.documentElement);
  const get = (name) => styles.getPropertyValue(name).trim();
  return {
    blue: get('--color-blue'),
    green: get('--color-green'),
    yellow: get('--color-yellow'),
    light: get('--color-light'),
    dark: get('--color-dark'),
  };
};

/* Menyesuaikan resolusi canvas dengan lebar tampil dan devicePixelRatio */
const fitCanvas = (canvas, logicalW, logicalH) => {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || logicalW;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssW * (logicalH / logicalW) * dpr);
  const ctx = canvas.getContext('2d');
  const scale = canvas.width / logicalW;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return ctx;
};

const roundedRect = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

/* ---------- Konfigurasi dan data ---------- */
const CONFIG = Object.freeze({
  analyteVolume: 25,
  titrantConc: 0.1,
  buretCapacity: 50,
  dropVolume: 0.05,
  Kw: 1e-14,
  flowRate: { hold: 1.0, queue: 3.0 }, // mL per detik
  concentrationChoices: [0.05, 0.1, 0.15],
  tolerance: { volume: 0.3, concentration: 0.03 },
  maxRecords: 30,
});

const WATER_RGB = [233, 242, 248];

const ACIDS = Object.freeze({
  hcl: { key: 'hcl', name: 'HCl', label: 'Asam klorida (HCl)', type: 'strong', ka: null },
  asetat: { key: 'asetat', name: 'CH₃COOH', label: 'Asam asetat (CH₃COOH)', type: 'weak', ka: 1.8e-5 },
});

const INDICATOR_DEFS = [
  {
    key: 'phenolphthalein', name: 'Fenolftalein', low: 8.2, high: 10.0,
    colors: ['#e9f2f8', '#f3a6cc', '#d9267f'],
    labels: ['Tidak berwarna', 'Merah muda pucat', 'Merah muda'],
    dropColor: '#a9b8c4',
  },
  {
    key: 'methylRed', name: 'Metil merah', low: 4.4, high: 6.2,
    colors: ['#e53935', '#f58220', '#fdd835'],
    labels: ['Merah', 'Jingga', 'Kuning'],
    dropColor: '#e53935',
  },
  {
    key: 'methylOrange', name: 'Metil jingga', low: 3.1, high: 4.4,
    colors: ['#e0301e', '#ee7a20', '#f9c823'],
    labels: ['Merah', 'Jingga', 'Kuning'],
    dropColor: '#e8501f',
  },
  {
    key: 'bromothymolBlue', name: 'Bromtimol biru', low: 6.0, high: 7.6,
    colors: ['#f2d92e', '#52b86a', '#2f6fdc'],
    labels: ['Kuning', 'Hijau', 'Biru'],
    dropColor: '#52b86a',
  },
];

/* ---------- Model kimia ---------- */
class Indicator {
  constructor(def) {
    Object.assign(this, def);
    this.rgb = def.colors.map(hexToRgb);
  }

  progress(pH) { return clamp((pH - this.low) / (this.high - this.low), 0, 1); }

  stage(pH) {
    if (pH < this.low) return 0;
    if (pH > this.high) return 2;
    return 1;
  }

  rgbAt(pH) {
    const t = this.progress(pH);
    return t < 0.5
      ? mixRgb(this.rgb[0], this.rgb[1], t * 2)
      : mixRgb(this.rgb[1], this.rgb[2], (t - 0.5) * 2);
  }

  label(pH) { return this.labels[this.stage(pH)]; }
}

const INDICATORS = Object.fromEntries(INDICATOR_DEFS.map((def) => [def.key, new Indicator(def)]));

class TitrationModel {
  constructor({ acid, analyteConc, analyteVolume, titrantConc }) {
    this.acid = acid;
    this.ca = analyteConc;
    this.va = analyteVolume;
    this.cb = titrantConc;
  }

  get equivalenceVolume() { return (this.ca * this.va) / this.cb; }

  /* pH larutan setelah penambahan vb mL titran NaOH */
  pH(vb) {
    const { Kw } = CONFIG;
    const total = this.va + vb;
    const nAcid = this.ca * this.va;
    const nBase = this.cb * vb;

    if (this.acid.type === 'strong') {
      const net = (nAcid - nBase) / total;
      const root = Math.sqrt(net * net + 4 * Kw);
      const h = net >= 0 ? (net + root) / 2 : (2 * Kw) / (-net + root);
      return -Math.log10(h);
    }

    // Asam lemah: kesetimbangan muatan [H+] + [Na+] = [OH-] + [A-], dicari dengan bisection
    const ct = nAcid / total;
    const na = nBase / total;
    const ka = this.acid.ka;
    let lo = -1;
    let hi = 15;
    for (let i = 0; i < 60; i += 1) {
      const mid = (lo + hi) / 2;
      const h = 10 ** -mid;
      const f = h + na - Kw / h - (ct * ka) / (ka + h);
      if (f > 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  curve(step = 0.1, max = CONFIG.buretCapacity) {
    const points = [];
    const count = Math.round(max / step);
    for (let i = 0; i <= count; i += 1) {
      const v = i * step;
      points.push({ v, ph: this.pH(v) });
    }
    return points;
  }
}

/* ---------- State reaktif ---------- */
class Store {
  #state;
  #listeners = new Set();

  constructor(initial) { this.#state = initial; }

  get state() { return this.#state; }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  set(patch) {
    this.#state = { ...this.#state, ...patch };
    this.#listeners.forEach((listener) => listener(this.#state, patch));
  }
}

const INITIAL_MESSAGE = {
  type: 'info',
  text: 'Seret labu Erlenmeyer ke dudukan di bawah buret untuk memulai percobaan.',
};

const createInitialState = () => ({
  mode: 'explore',
  acidKey: 'hcl',
  analyteConc: CONFIG.concentrationChoices[1],
  indicatorKey: 'phenolphthalein',
  flaskPlaced: false,
  indicatorPending: false,
  indicatorAdded: false,
  dispensed: 0,
  trace: [],
  records: [],
  showTheory: false,
  answerChecked: false,
  verify: null,
  message: INITIAL_MESSAGE,
});

const randomConcentration = () => Math.round((0.05 + Math.random() * 0.1) * 10000) / 10000;

class LabController {
  constructor(store) {
    this.store = store;
    this._modelKey = '';
    this._model = null;
  }

  get state() { return this.store.state; }

  get indicator() { return INDICATORS[this.state.indicatorKey]; }

  get model() {
    const s = this.state;
    const key = `${s.acidKey}|${s.analyteConc}`;
    if (key !== this._modelKey) {
      this._modelKey = key;
      this._model = new TitrationModel({
        acid: ACIDS[s.acidKey],
        analyteConc: s.analyteConc,
        analyteVolume: CONFIG.analyteVolume,
        titrantConc: CONFIG.titrantConc,
      });
    }
    return this._model;
  }

  /* Pesan status */
  notify(type, text) { this.store.set({ message: { type, text } }); }
  info(text) { this.notify('info', text); }
  warn(text) { this.notify('warning', text); }
  success(text) { this.notify('success', text); }

  configure(patch) {
    const s = this.state;
    if ('indicatorKey' in patch) {
      this.store.set({ indicatorKey: patch.indicatorKey });
      return;
    }
    const next = { ...patch };
    if (patch.mode && patch.mode !== s.mode) {
      next.analyteConc = patch.mode === 'determine'
        ? randomConcentration()
        : CONFIG.concentrationChoices[1];
    }
    this.store.set(next);
    const mode = next.mode || s.mode;
    this.resetBench(mode === 'determine'
      ? { type: 'info', text: 'Konsentrasi analit dirahasiakan. Lakukan titrasi untuk menentukannya.' }
      : INITIAL_MESSAGE);
  }

  resetBench(message = INITIAL_MESSAGE) {
    const s = this.state;
    this.store.set({
      flaskPlaced: false,
      indicatorPending: false,
      indicatorAdded: false,
      dispensed: 0,
      trace: [],
      records: [],
      answerChecked: false,
      verify: null,
      showTheory: s.mode === 'explore' ? s.showTheory : false,
      message,
    });
  }

  newProblem() {
    if (this.state.mode !== 'determine') return;
    this.store.set({ analyteConc: randomConcentration() });
    this.resetBench({ type: 'info', text: 'Soal baru dibuat. Konsentrasi analit disembunyikan.' });
  }

  placeFlask() {
    const s = this.state;
    if (s.flaskPlaced) return false;
    this.store.set({
      flaskPlaced: true,
      trace: [{ v: 0, ph: this.model.pH(0) }],
      message: {
        type: 'info',
        text: `Labu terpasang berisi ${fmt(CONFIG.analyteVolume)} mL ${ACIDS[s.acidKey].name}. Seret botol indikator ke dalam labu.`,
      },
    });
    return true;
  }

  startIndicator() {
    const s = this.state;
    if (!s.flaskPlaced || s.indicatorAdded || s.indicatorPending) return false;
    this.store.set({
      indicatorPending: true,
      message: { type: 'info', text: `Meneteskan indikator ${this.indicator.name} ke dalam labu.` },
    });
    return true;
  }

  finishIndicator() {
    const s = this.state;
    if (!s.indicatorPending) return;
    this.store.set({
      indicatorPending: false,
      indicatorAdded: true,
      message: {
        type: 'success',
        text: `Indikator ${this.indicator.name} telah ditambahkan. Buka keran buret atau tambahkan titran per tetes.`,
      },
    });
  }

  dispense(dv) {
    const s = this.state;
    if (!s.flaskPlaced) return;
    const prev = s.dispensed;
    const next = Math.min(CONFIG.buretCapacity, prev + dv);
    if (next === prev) return;

    const ph = this.model.pH(next);
    const patch = { dispensed: next, trace: [...s.trace, { v: next, ph }] };

    if (s.indicatorAdded) {
      const ind = this.indicator;
      const before = ind.stage(this.model.pH(prev));
      const after = ind.stage(ph);
      if (before !== after) {
        patch.message = after === 1
          ? { type: 'info', text: `Warna larutan mulai berubah menjadi ${ind.labels[1].toLowerCase()} pada volume ${fmt(next)} mL.` }
          : { type: 'success', text: `Perubahan warna selesai: larutan ${ind.labels[2].toLowerCase()} pada volume ${fmt(next)} mL.` };
      }
    }
    if (next >= CONFIG.buretCapacity) {
      patch.message = { type: 'warning', text: `Buret telah mencapai skala ${fmt(CONFIG.buretCapacity)} mL. Atur ulang percobaan untuk mengisi kembali.` };
    }
    this.store.set(patch);
  }

  recordData() {
    const s = this.state;
    if (!s.flaskPlaced) {
      this.warn('Letakkan labu Erlenmeyer pada dudukan sebelum mencatat data.');
      return;
    }
    if (s.records.length >= CONFIG.maxRecords) {
      this.warn(`Tabel data penuh (maksimum ${CONFIG.maxRecords} baris). Hapus data untuk melanjutkan.`);
      return;
    }
    const ph = this.model.pH(s.dispensed);
    const ind = this.indicator;
    const entry = {
      v: s.dispensed,
      ph,
      colorLabel: s.indicatorAdded ? ind.label(ph) : 'Tidak berwarna',
      rgb: s.indicatorAdded ? ind.rgbAt(ph) : WATER_RGB,
    };
    this.store.set({ records: [...s.records, entry] });
  }

  clearRecords() { this.store.set({ records: [] }); }

  setTheory(show) { this.store.set({ showTheory: show }); }

  checkAnswer(ve, ca) {
    const s = this.state;
    const trueVe = this.model.equivalenceVolume;
    const trueCa = this.model.ca;
    const veOk = Math.abs(ve - trueVe) <= CONFIG.tolerance.volume;
    const caOk = Math.abs(ca - trueCa) / trueCa <= CONFIG.tolerance.concentration;

    if (veOk && caOk) {
      this.store.set({
        answerChecked: true,
        showTheory: true,
        verify: {
          type: 'success',
          text: `Jawaban sesuai. Volume ekuivalen sebenarnya ${fmt(trueVe)} mL dan konsentrasi analit ${fmt(trueCa, 4)} M.`,
        },
      });
      return;
    }
    const text = veOk
      ? `Volume ekuivalen sudah sesuai, tetapi konsentrasi belum tepat. Gunakan Ca = (Cb × Vb) / Va dengan Va = ${fmt(CONFIG.analyteVolume)} mL dan Cb = ${fmt(CONFIG.titrantConc, 4)} M.`
      : 'Volume ekuivalen belum sesuai. Cari titik dengan kenaikan pH paling curam pada kurva titrasi, lalu coba kembali.';
    this.store.set({ verify: { type: 'warning', text }, answerChecked: s.answerChecked });
  }
}

/* ---------- Renderer alat (canvas) ---------- */
class ApparatusRenderer {
  static W = 400;
  static H = 580;
  static BURET = { x: 187, w: 26, top: 50, bottom: 302, y0: 70, y50: 290 };
  static TIP_Y = 338;
  static FLASK_BOTTOM = 540;

  constructor(canvas, lab, palette) {
    this.canvas = canvas;
    this.lab = lab;
    this.palette = palette;
    this.time = 0;
    this.drops = [];
    this.ripple = 0;
    this.placeT = 0;
    this.openT = 0;
    this.streaming = false;
    this.color = [...WATER_RGB];
    this.titrantColor = hexA(palette.blue, 0.8);
    this.resize();
  }

  resize() {
    this.ctx = fitCanvas(this.canvas, ApparatusRenderer.W, ApparatusRenderer.H);
  }

  surfaceY(state) {
    const total = CONFIG.analyteVolume + state.dispensed;
    return ApparatusRenderer.FLASK_BOTTOM - (40 + total * 0.85);
  }

  spawnDrop({ x = 200, y = ApparatusRenderer.TIP_Y + 2, kind, color, volume = 0, delay = 0, onLand }) {
    this.drops.push({ x, y, vy: 0, kind, color, volume, delay, onLand });
  }

  spawnIndicatorDrops() {
    const color = hexA(this.lab.indicator.dropColor, 0.95);
    this.spawnDrop({ x: 207, y: 372, kind: 'indicator', color, delay: 0 });
    this.spawnDrop({ x: 212, y: 372, kind: 'indicator', color, delay: 0.22, onLand: () => this.lab.finishIndicator() });
  }

  inFlightVolume() {
    return this.drops.reduce((sum, d) => sum + (d.kind === 'titrant' ? d.volume : 0), 0);
  }

  update(dt, sim) {
    const s = this.lab.state;
    this.time += dt;

    // Animasi peletakan labu
    const placeTarget = s.flaskPlaced ? 1 : 0;
    if (reduceMotion) this.placeT = placeTarget;
    else {
      this.placeT += (placeTarget - this.placeT) * Math.min(1, dt * 9);
      if (Math.abs(placeTarget - this.placeT) < 0.004) this.placeT = placeTarget;
    }

    // Keran buret
    this.streaming = sim.isFlowing;
    const openTarget = sim.isFlowing ? 1 : 0;
    this.openT += (openTarget - this.openT) * Math.min(1, dt * 14);

    // Warna larutan mengikuti pH secara halus
    let target = WATER_RGB;
    if (s.flaskPlaced && s.indicatorAdded) target = this.lab.indicator.rgbAt(this.lab.model.pH(s.dispensed));
    const k = reduceMotion ? 1 : Math.min(1, dt * 12);
    this.color = this.color.map((c, i) => c + (target[i] - c) * k);

    // Tetesan
    if (!s.flaskPlaced) this.drops.length = 0;
    const g = 1600;
    const surface = this.surfaceY(s);
    this.drops = this.drops.filter((drop) => {
      if (drop.delay > 0) { drop.delay -= dt; return true; }
      drop.vy += g * dt;
      drop.y += drop.vy * dt;
      if (drop.y >= surface) {
        this.ripple = 1;
        if (drop.onLand) drop.onLand();
        return false;
      }
      return true;
    });
    this.ripple = Math.max(0, this.ripple - dt * 1.6);
  }

  draw() {
    const ctx = this.ctx;
    const s = this.lab.state;
    ctx.clearRect(0, 0, ApparatusRenderer.W, ApparatusRenderer.H);
    this.drawStand(ctx);
    this.drawBuret(ctx, s);
    this.drawFlask(ctx, s);
    this.drawStream(ctx, s);
    this.drawDrops(ctx);
    this.drawStopcock(ctx, s);
    this.drawLabels(ctx, s);
  }

  drawStand(ctx) {
    const { dark } = this.palette;
    ctx.save();
    ctx.fillStyle = hexA(dark, 0.78);
    roundedRect(ctx, 60, 540, 310, 10, 3); ctx.fill();         // alas
    ctx.fillRect(346, 30, 8, 512);                              // tiang
    ctx.fillRect(216, 95, 130, 6);                              // lengan atas
    ctx.fillRect(216, 231, 130, 6);                             // lengan bawah
    ctx.fillStyle = hexA(dark, 0.9);
    roundedRect(ctx, 183, 90, 34, 16, 3); ctx.fill();           // penjepit atas
    roundedRect(ctx, 183, 226, 34, 16, 3); ctx.fill();          // penjepit bawah
    ctx.restore();
  }

  drawBuret(ctx, s) {
    const B = ApparatusRenderer.BURET;
    const { dark, blue } = this.palette;
    const perMl = (B.y50 - B.y0) / 50;
    const meniscus = B.y0 + s.dispensed * perMl;

    ctx.save();
    roundedRect(ctx, B.x, B.top, B.w, B.bottom - B.top, 4);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = hexA(blue, 0.3);
    ctx.fillRect(B.x, meniscus, B.w, B.bottom - meniscus + 2);
    ctx.strokeStyle = hexA(blue, 0.9);
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(B.x, meniscus); ctx.lineTo(B.x + B.w, meniscus); ctx.stroke();
    ctx.restore();

    ctx.save();
    roundedRect(ctx, B.x, B.top, B.w, B.bottom - B.top, 4);
    ctx.strokeStyle = hexA(dark, 0.75);
    ctx.lineWidth = 2;
    ctx.stroke();

    // Skala buret
    ctx.strokeStyle = hexA(dark, 0.8);
    ctx.fillStyle = hexA(dark, 0.75);
    ctx.lineWidth = 1;
    ctx.font = '600 10px "Open Sans", sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 50; i += 1) {
      const y = B.y0 + i * perMl;
      const len = i % 10 === 0 ? 14 : i % 5 === 0 ? 10 : 6;
      ctx.beginPath(); ctx.moveTo(B.x, y); ctx.lineTo(B.x + len, y); ctx.stroke();
      if (i % 10 === 0) ctx.fillText(String(i), B.x - 5, y + 3.5);
    }
    ctx.restore();
  }

  drawStopcock(ctx, s) {
    const { dark, blue, yellow } = this.palette;
    const tipY = ApparatusRenderer.TIP_Y;

    // Ujung buret
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(196, 314); ctx.lineTo(204, 314); ctx.lineTo(201.5, tipY); ctx.lineTo(198.5, tipY);
    ctx.closePath();
    ctx.fillStyle = s.dispensed < CONFIG.buretCapacity ? hexA(blue, 0.3) : 'rgba(255, 255, 255, 0.7)';
    ctx.fill();
    ctx.strokeStyle = hexA(dark, 0.75);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // Badan dan tuas keran
    ctx.save();
    ctx.fillStyle = hexA(dark, 0.88);
    roundedRect(ctx, 192, 302, 16, 12, 2); ctx.fill();
    ctx.translate(200, 308);
    ctx.rotate(this.openT * (Math.PI / 3));
    ctx.fillStyle = yellow;
    ctx.strokeStyle = dark;
    ctx.lineWidth = 1.2;
    roundedRect(ctx, 0, -3, 30, 6, 3); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.arc(200, 308, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  flaskPath(ctx) {
    ctx.beginPath();
    ctx.moveTo(176, 386);
    ctx.lineTo(176, 442);
    ctx.lineTo(116, 522);
    ctx.quadraticCurveTo(110, 540, 130, 540);
    ctx.lineTo(270, 540);
    ctx.quadraticCurveTo(290, 540, 284, 522);
    ctx.lineTo(224, 442);
    ctx.lineTo(224, 386);
  }

  drawFlask(ctx, s) {
    const { dark } = this.palette;
    const t = this.placeT;
    const surface = this.surfaceY(s);

    // Penanda dudukan saat labu belum dipasang
    if (t < 0.99) {
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = hexA(dark, 0.35);
      ctx.lineWidth = 1.6;
      this.flaskPath(ctx);
      ctx.stroke();
      ctx.restore();
    }
    if (t < 0.01) return;

    ctx.save();
    ctx.globalAlpha = t;
    ctx.translate(0, (1 - t) * -40);

    // Kaca
    this.flaskPath(ctx);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.fill();

    // Cairan
    ctx.save();
    this.flaskPath(ctx);
    ctx.clip();
    ctx.fillStyle = rgbStr(this.color.map(Math.round), 0.94);
    ctx.beginPath();
    ctx.moveTo(90, surface);
    for (let x = 90; x <= 310; x += 4) {
      ctx.lineTo(x, surface + Math.sin(x * 0.09 + this.time * 7) * 2.2 * this.ripple);
    }
    ctx.lineTo(310, 545);
    ctx.lineTo(90, 545);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Garis luar, bibir labu, dan pantulan
    this.flaskPath(ctx);
    ctx.strokeStyle = hexA(dark, 0.78);
    ctx.lineWidth = 2;
    ctx.stroke();
    roundedRect(ctx, 171, 380, 58, 8, 3);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(186, 398); ctx.lineTo(186, 436); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(146, 500); ctx.lineTo(132, 520); ctx.stroke();
    ctx.restore();
  }

  drawStream(ctx, s) {
    if (!this.streaming || !s.flaskPlaced) return;
    ctx.save();
    ctx.strokeStyle = this.titrantColor;
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(200, ApparatusRenderer.TIP_Y);
    ctx.lineTo(200, this.surfaceY(s));
    ctx.stroke();
    ctx.restore();
  }

  drawDrops(ctx) {
    this.drops.forEach((drop) => {
      if (drop.delay > 0) return;
      ctx.save();
      ctx.fillStyle = drop.color;
      ctx.beginPath();
      ctx.ellipse(drop.x, drop.y, 2.6, 3.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  drawLabels(ctx, s) {
    const { dark } = this.palette;
    const acid = ACIDS[s.acidKey];
    const hidden = s.mode === 'determine' && !s.answerChecked;
    ctx.save();
    ctx.fillStyle = hexA(dark, 0.72);
    ctx.font = '600 11px "Open Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Buret 50 mL: NaOH ${fmt(CONFIG.titrantConc, 4)} M`, 200, 34);
    const caption = s.flaskPlaced
      ? (hidden
        ? `${fmt(CONFIG.analyteVolume)} mL ${acid.name} (konsentrasi dicari)`
        : `${fmt(CONFIG.analyteVolume)} mL ${acid.name} ${fmt(s.analyteConc, 4)} M`)
      : 'Dudukan labu Erlenmeyer';
    ctx.fillText(caption, 200, 570);
    ctx.restore();
  }
}

/* ---------- Renderer kurva titrasi (canvas) ---------- */
class CurveRenderer {
  static W = 480;
  static H = 330;

  constructor(canvas, lab, palette) {
    this.canvas = canvas;
    this.lab = lab;
    this.palette = palette;
    this.geo = { L: 46, T: 14, R: CurveRenderer.W - 16, B: CurveRenderer.H - 42 };
    this.theoryKey = '';
    this.theory = [];
    this.resize();
  }

  resize() {
    this.ctx = fitCanvas(this.canvas, CurveRenderer.W, CurveRenderer.H);
  }

  x(v) { const { L, R } = this.geo; return L + (v / CONFIG.buretCapacity) * (R - L); }
  y(ph) { const { T, B } = this.geo; return B - (clamp(ph, 0, 14) / 14) * (B - T); }

  theoryCurve() {
    const s = this.lab.state;
    const key = `${s.acidKey}|${s.analyteConc}`;
    if (key !== this.theoryKey) {
      this.theoryKey = key;
      this.theory = this.lab.model.curve(0.1);
    }
    return this.theory;
  }

  draw() {
    const ctx = this.ctx;
    const { W, H } = { W: CurveRenderer.W, H: CurveRenderer.H };
    const { L, T, R, B } = this.geo;
    const p = this.palette;
    const s = this.lab.state;
    const ind = this.lab.indicator;

    ctx.clearRect(0, 0, W, H);

    // Rentang perubahan warna indikator
    ctx.fillStyle = rgbStr(ind.rgb[1], 0.3);
    ctx.fillRect(L, this.y(ind.high), R - L, this.y(ind.low) - this.y(ind.high));
    ctx.font = '600 10.5px "Open Sans", sans-serif';
    ctx.fillStyle = hexA(p.dark, 0.7);
    ctx.textAlign = 'right';
    ctx.fillText(ind.name, R - 6, this.y(ind.high) + 12);

    // Grid dan sumbu
    ctx.lineWidth = 1;
    ctx.font = '400 11px "Open Sans", sans-serif';
    for (let ph = 0; ph <= 14; ph += 2) {
      const y = this.y(ph);
      ctx.strokeStyle = hexA(p.dark, 0.1);
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke();
      ctx.fillStyle = hexA(p.dark, 0.7);
      ctx.textAlign = 'right';
      ctx.fillText(String(ph), L - 8, y + 4);
    }
    for (let v = 0; v <= 50; v += 10) {
      const x = this.x(v);
      ctx.strokeStyle = hexA(p.dark, 0.1);
      ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, B); ctx.stroke();
      ctx.fillStyle = hexA(p.dark, 0.7);
      ctx.textAlign = 'center';
      ctx.fillText(String(v), x, B + 16);
    }
    ctx.strokeStyle = hexA(p.dark, 0.8);
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(L, B); ctx.lineTo(R, B); ctx.stroke();

    ctx.fillStyle = hexA(p.dark, 0.8);
    ctx.font = '600 11.5px "Open Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Volume NaOH yang ditambahkan (mL)', (L + R) / 2, H - 8);
    ctx.save();
    ctx.translate(13, (T + B) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('pH', 0, 0);
    ctx.restore();

    // Kurva teoretis dan titik ekuivalen
    if (s.showTheory) {
      const pts = this.theoryCurve();
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = hexA(p.dark, 0.55);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      pts.forEach((pt, i) => (i ? ctx.lineTo(this.x(pt.v), this.y(pt.ph)) : ctx.moveTo(this.x(pt.v), this.y(pt.ph))));
      ctx.stroke();

      const ve = this.lab.model.equivalenceVolume;
      const phEq = this.lab.model.pH(ve);
      ctx.beginPath(); ctx.moveTo(this.x(ve), T); ctx.lineTo(this.x(ve), B); ctx.stroke();
      ctx.restore();

      ctx.fillStyle = p.yellow;
      ctx.strokeStyle = p.dark;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(this.x(ve), this.y(phEq), 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = hexA(p.dark, 0.85);
      ctx.font = '600 11px "Open Sans", sans-serif';
      ctx.textAlign = this.x(ve) > R - 90 ? 'right' : 'left';
      const dx = this.x(ve) > R - 90 ? -8 : 8;
      ctx.fillText(`Ve = ${fmt(ve)} mL, pH ${fmt(phEq)}`, this.x(ve) + dx, T + 12);
    }

    // Hasil pengamatan
    if (s.trace.length > 1) {
      ctx.save();
      ctx.strokeStyle = p.blue;
      ctx.lineWidth = 2.6;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      s.trace.forEach((pt, i) => (i ? ctx.lineTo(this.x(pt.v), this.y(pt.ph)) : ctx.moveTo(this.x(pt.v), this.y(pt.ph))));
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.fillStyle = hexA(p.dark, 0.55);
      ctx.font = '400 13px "Open Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Kurva ditampilkan setelah titrasi dimulai.', (L + R) / 2, (T + B) / 2);
    }

    // Data tercatat
    s.records.forEach((rec) => {
      ctx.fillStyle = p.yellow;
      ctx.strokeStyle = p.dark;
      ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.arc(this.x(rec.v), this.y(rec.ph), 4.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });

    // Titik saat ini
    if (s.flaskPlaced) {
      const ph = this.lab.model.pH(s.dispensed);
      ctx.fillStyle = p.dark;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(this.x(s.dispensed), this.y(ph), 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }
}

/* ---------- Simulasi: loop animasi dan aliran titran ---------- */
class Simulation {
  constructor(lab, renderer) {
    this.lab = lab;
    this.renderer = renderer;
    this.queued = 0;
    this.holding = false;
    this.isFlowing = false;
    this.last = 0;
  }

  guard() {
    const s = this.lab.state;
    if (!s.flaskPlaced) {
      this.lab.warn('Letakkan labu Erlenmeyer pada dudukan sebelum membuka keran buret.');
      return false;
    }
    if (s.dispensed >= CONFIG.buretCapacity - 1e-9) {
      this.lab.warn(`Buret telah mencapai skala ${fmt(CONFIG.buretCapacity)} mL. Atur ulang percobaan untuk mengisi kembali.`);
      return false;
    }
    return true;
  }

  queueVolume(volume) {
    if (this.guard()) this.queued += volume;
  }

  hold(on) {
    if (on && !this.guard()) return;
    this.holding = on;
  }

  dropOne() {
    if (!this.guard()) return;
    const pending = this.renderer.inFlightVolume();
    if (this.lab.state.dispensed + pending + CONFIG.dropVolume > CONFIG.buretCapacity + 1e-9) return;
    this.renderer.spawnDrop({
      kind: 'titrant',
      volume: CONFIG.dropVolume,
      color: this.renderer.titrantColor,
      onLand: () => this.lab.dispense(CONFIG.dropVolume),
    });
  }

  update(dt) {
    this.isFlowing = false;
    let rate = 0;
    if (this.holding) rate = CONFIG.flowRate.hold;
    else if (this.queued > 0) rate = CONFIG.flowRate.queue;
    if (rate === 0) return;

    if (!this.lab.state.flaskPlaced) {
      this.queued = 0;
      this.holding = false;
      return;
    }

    let dv = rate * dt;
    if (!this.holding) dv = Math.min(dv, this.queued);
    dv = Math.min(dv, CONFIG.buretCapacity - this.lab.state.dispensed);
    if (dv > 0) {
      this.lab.dispense(dv);
      this.isFlowing = true;
      if (!this.holding) this.queued -= dv;
    }
    if (this.lab.state.dispensed >= CONFIG.buretCapacity - 1e-9) {
      this.queued = 0;
      this.holding = false;
    }
  }

  start() {
    const frame = (time) => {
      const dt = this.last ? Math.min(0.05, (time - this.last) / 1000) : 0;
      this.last = time;
      this.update(dt);
      this.renderer.update(dt, this);
      this.renderer.draw();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
}

/* ---------- HTML5 Drag and Drop (native) ---------- */
class DragDropController {
  constructor({ items, zone, labelEl, labels, canAccept, onDrop, onReject }) {
    this.items = items;
    this.zone = zone;
    this.labelEl = labelEl;
    this.labels = labels;
    this.canAccept = canAccept;
    this.onDrop = onDrop;
    this.onReject = onReject;
    this.dragging = null;
    this.notified = false;
    this.bind();
  }

  bind() {
    this.items.forEach((el) => {
      el.addEventListener('dragstart', (e) => this.start(e, el));
      el.addEventListener('dragend', () => this.end(el));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.activate(el.dataset.item);
        }
      });
      el.addEventListener('dblclick', () => this.activate(el.dataset.item));
    });
    this.zone.addEventListener('dragenter', (e) => this.enter(e));
    this.zone.addEventListener('dragover', (e) => this.over(e));
    this.zone.addEventListener('dragleave', (e) => this.leave(e));
    this.zone.addEventListener('drop', (e) => this.drop(e));
  }

  activate(item) {
    if (this.canAccept(item)) this.onDrop(item);
    else this.onReject(item);
  }

  start(e, el) {
    if (el.classList.contains('is-used')) { e.preventDefault(); return; }
    const item = el.dataset.item;
    this.dragging = item;
    this.notified = false;
    e.dataTransfer.setData('text/plain', item);
    e.dataTransfer.effectAllowed = 'move';
    el.classList.add('is-dragging');
    this.labelEl.textContent = this.labels[item] || 'Letakkan di sini';
    this.zone.classList.toggle('is-target', this.canAccept(item));
  }

  end(el) {
    this.dragging = null;
    el.classList.remove('is-dragging');
    this.zone.classList.remove('is-target', 'is-over', 'is-rejected');
  }

  enter(e) {
    e.preventDefault();
    if (this.dragging && !this.canAccept(this.dragging) && !this.notified) {
      this.notified = true;
      this.onReject(this.dragging);
    }
  }

  over(e) {
    e.preventDefault();
    const ok = Boolean(this.dragging) && this.canAccept(this.dragging);
    e.dataTransfer.dropEffect = ok ? 'move' : 'none';
    this.zone.classList.toggle('is-over', ok);
    this.zone.classList.toggle('is-rejected', !ok);
  }

  leave(e) {
    if (!this.zone.contains(e.relatedTarget)) this.zone.classList.remove('is-over', 'is-rejected');
  }

  drop(e) {
    e.preventDefault();
    const item = this.dragging || e.dataTransfer.getData('text/plain');
    this.zone.classList.remove('is-over', 'is-rejected', 'is-target');
    if (item && this.canAccept(item)) this.onDrop(item);
  }
}

/* ---------- UI: sinkronisasi state ke DOM ---------- */
const STEPS = [
  (s) => s.flaskPlaced,
  (s) => s.indicatorAdded,
  (s) => s.dispensed >= 0.1,
  (s) => s.records.length >= 3,
  (s, lab) => (s.mode === 'determine'
    ? s.answerChecked
    : s.dispensed > lab.model.equivalenceVolume * 1.05),
];

const STATUS_ICONS = {
  info: 'ph ph-info',
  success: 'ph ph-check-circle',
  warning: 'ph ph-warning',
};

class UIController {
  constructor({ lab, store, bench, curve, sim }) {
    this.lab = lab;
    this.store = store;
    this.bench = bench;
    this.curve = curve;
    this.sim = sim;
    this.lastRecords = null;

    this.cacheDom();
    this.populateOptions();
    this.bindEvents();

    this.dnd = new DragDropController({
      items: [this.el.itemFlask, this.el.itemIndicator],
      zone: this.el.dropzone,
      labelEl: this.el.dropzoneLabel,
      labels: { flask: 'Letakkan labu di dudukan', indicator: 'Teteskan indikator ke labu' },
      canAccept: (item) => this.canAccept(item),
      onDrop: (item) => this.handleItem(item),
      onReject: (item) => this.rejectItem(item),
    });

    store.subscribe((state) => {
      this.render(state);
      this.curve.draw();
    });
    this.render(store.state);
    this.curve.draw();
  }

  cacheDom() {
    const ids = [
      'btnResetHeader', 'btnResetBench', 'selAcid', 'selConc', 'selIndicator', 'unknownOpt',
      'paramAcid', 'paramVol', 'paramConc', 'paramTitrant', 'paramEq',
      'itemFlask', 'flaskSub', 'itemIndicator', 'indicatorSub', 'stepList', 'stepFinalText',
      'outVolume', 'outPH', 'outColor', 'swatch', 'dropzone', 'dropzoneLabel',
      'status', 'statusIcon', 'statusText', 'btnDrop', 'btnHold', 'btnRecord', 'btnClear',
      'chkTheory', 'theoryHint', 'recordBody', 'recordEmpty', 'tableWrap',
      'panelVerify', 'formVerify', 'inVe', 'inCa', 'btnNewProblem', 'verifyResult',
    ];
    this.el = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
    this.el.modeInputs = $$('input[name="mode"]');
    this.el.volumeButtons = $$('[data-volume]');
    this.el.steps = $$('.step', this.el.stepList);
  }

  populateOptions() {
    const { selAcid, selConc, selIndicator, unknownOpt } = this.el;
    Object.values(ACIDS).forEach((acid) => {
      selAcid.add(new Option(acid.label, acid.key));
    });
    CONFIG.concentrationChoices.forEach((c) => {
      selConc.add(new Option(`${fmt(c, 4)} M`, String(c)), unknownOpt);
    });
    INDICATOR_DEFS.forEach((ind) => {
      selIndicator.add(new Option(`${ind.name} (pH ${fmt(ind.low, 1)} - ${fmt(ind.high, 1)})`, ind.key));
    });
  }

  bindEvents() {
    const { el, lab, sim } = this;

    el.modeInputs.forEach((input) => {
      input.addEventListener('change', () => { if (input.checked) lab.configure({ mode: input.value }); });
    });
    el.selAcid.addEventListener('change', () => lab.configure({ acidKey: el.selAcid.value }));
    el.selConc.addEventListener('change', () => {
      if (el.selConc.value !== 'unknown') lab.configure({ analyteConc: Number(el.selConc.value) });
    });
    el.selIndicator.addEventListener('change', () => lab.configure({ indicatorKey: el.selIndicator.value }));

    const reset = () => lab.resetBench({
      type: 'info',
      text: 'Percobaan diatur ulang. Buret terisi kembali hingga skala 0,00 mL.',
    });
    el.btnResetHeader.addEventListener('click', reset);
    el.btnResetBench.addEventListener('click', reset);

    // Kontrol buret
    el.btnDrop.addEventListener('click', () => sim.dropOne());
    el.volumeButtons.forEach((btn) => {
      btn.addEventListener('click', () => sim.queueVolume(Number(btn.dataset.volume)));
    });

    const hold = el.btnHold;
    const release = () => { sim.hold(false); hold.classList.remove('is-held'); };
    const press = () => { sim.hold(true); if (sim.holding) hold.classList.add('is-held'); };
    hold.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (hold.setPointerCapture) hold.setPointerCapture(e.pointerId);
      press();
    });
    hold.addEventListener('pointerup', release);
    hold.addEventListener('pointercancel', release);
    hold.addEventListener('lostpointercapture', release);
    hold.addEventListener('contextmenu', (e) => e.preventDefault());
    hold.addEventListener('keydown', (e) => {
      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); press(); }
    });
    hold.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') release(); });
    hold.addEventListener('blur', release);

    // Data dan grafik
    el.btnRecord.addEventListener('click', () => lab.recordData());
    el.btnClear.addEventListener('click', () => lab.clearRecords());
    el.chkTheory.addEventListener('change', () => lab.setTheory(el.chkTheory.checked));

    // Verifikasi
    el.formVerify.addEventListener('submit', (e) => {
      e.preventDefault();
      const ve = parseFloat(el.inVe.value.replace(',', '.'));
      const ca = parseFloat(el.inCa.value.replace(',', '.'));
      if (Number.isNaN(ve) || Number.isNaN(ca)) {
        this.store.set({ verify: { type: 'warning', text: 'Isi volume ekuivalen dan konsentrasi analit sebelum memeriksa jawaban.' } });
        return;
      }
      lab.checkAnswer(ve, ca);
    });
    el.btnNewProblem.addEventListener('click', () => {
      el.inVe.value = '';
      el.inCa.value = '';
      lab.newProblem();
    });
  }

  /* Aturan penerimaan item pada zona drop */
  canAccept(item) {
    const s = this.lab.state;
    if (item === 'flask') return !s.flaskPlaced;
    if (item === 'indicator') return s.flaskPlaced && !s.indicatorAdded && !s.indicatorPending;
    return false;
  }

  rejectItem(item) {
    const s = this.lab.state;
    if (item === 'flask') this.lab.warn('Labu Erlenmeyer sudah berada pada dudukan.');
    else if (!s.flaskPlaced) this.lab.warn('Letakkan labu Erlenmeyer pada dudukan terlebih dahulu.');
    else this.lab.warn('Indikator sudah ditambahkan pada labu ini.');
  }

  handleItem(item) {
    if (item === 'flask') this.lab.placeFlask();
    if (item === 'indicator' && this.lab.startIndicator()) this.bench.spawnIndicatorDrops();
  }

  render(s) {
    const { el, lab } = this;
    const model = lab.model;
    const acid = ACIDS[s.acidKey];
    const ind = lab.indicator;
    const hidden = s.mode === 'determine' && !s.answerChecked;
    const ph = model.pH(s.dispensed);

    // Kontrol parameter
    el.modeInputs.forEach((input) => { input.checked = input.value === s.mode; });
    el.selAcid.value = s.acidKey;
    el.unknownOpt.hidden = s.mode !== 'determine';
    el.selConc.value = s.mode === 'determine' ? 'unknown' : String(s.analyteConc);
    el.selConc.disabled = s.mode === 'determine';
    el.selIndicator.value = s.indicatorKey;
    el.selIndicator.disabled = s.indicatorAdded || s.indicatorPending;

    setText(el.paramAcid, acid.label);
    setText(el.paramVol, `${fmt(CONFIG.analyteVolume)} mL`);
    setText(el.paramConc, hidden ? 'Tidak diketahui' : `${fmt(s.analyteConc, 4)} M`);
    setText(el.paramTitrant, `NaOH ${fmt(CONFIG.titrantConc, 4)} M`);
    setText(el.paramEq, hidden ? 'Disembunyikan' : `${fmt(model.equivalenceVolume)} mL`);

    // Alat dan bahan
    el.itemFlask.classList.toggle('is-used', s.flaskPlaced);
    el.itemFlask.setAttribute('aria-disabled', String(s.flaskPlaced));
    el.itemIndicator.classList.toggle('is-used', s.indicatorAdded || s.indicatorPending);
    el.itemIndicator.setAttribute('aria-disabled', String(s.indicatorAdded || s.indicatorPending));
    setText(el.flaskSub, `${fmt(CONFIG.analyteVolume)} mL ${acid.name}${hidden ? ', konsentrasi dicari' : ` ${fmt(s.analyteConc, 4)} M`}`);
    setText(el.indicatorSub, ind.name);

    // Tahapan
    const done = STEPS.map((test) => test(s, lab));
    const active = done.indexOf(false);
    el.steps.forEach((li, i) => {
      li.classList.toggle('is-done', done[i]);
      li.classList.toggle('is-active', i === active);
    });
    setText(el.stepFinalText, s.mode === 'determine'
      ? 'Hitung konsentrasi analit dan periksa jawaban pada panel verifikasi.'
      : 'Lanjutkan titrasi melewati titik ekuivalen dan amati lonjakan pH.');

    // Pembacaan
    setText(el.outVolume, fmt(s.dispensed));
    setText(el.outPH, s.flaskPlaced ? fmt(ph) : '--');
    const rgb = s.flaskPlaced && s.indicatorAdded ? ind.rgbAt(ph) : WATER_RGB;
    el.swatch.style.backgroundColor = rgbStr(rgb);
    setText(el.outColor, !s.flaskPlaced ? '--' : (s.indicatorAdded ? ind.label(ph) : 'Tidak berwarna'));

    // Status
    el.status.dataset.type = s.message.type;
    el.statusIcon.className = STATUS_ICONS[s.message.type] || STATUS_ICONS.info;
    setText(el.statusText, s.message.text);

    // Tabel data
    if (s.records !== this.lastRecords) {
      this.lastRecords = s.records;
      this.renderRecords(s.records);
    }
    el.btnClear.disabled = s.records.length === 0;

    // Grafik teoretis dan verifikasi
    el.chkTheory.checked = s.showTheory;
    el.chkTheory.disabled = hidden;
    el.theoryHint.hidden = !hidden;
    el.panelVerify.hidden = s.mode !== 'determine';
    el.verifyResult.dataset.type = s.verify ? s.verify.type : '';
    setText(el.verifyResult, s.verify ? s.verify.text : '');
  }

  renderRecords(records) {
    const { recordBody, recordEmpty, tableWrap } = this.el;
    recordBody.replaceChildren();
    records.forEach((rec, i) => {
      const row = document.createElement('tr');
      const cells = [String(i + 1), fmt(rec.v), fmt(rec.ph)];
      cells.forEach((text) => {
        const td = document.createElement('td');
        td.textContent = text;
        row.appendChild(td);
      });
      const colorCell = document.createElement('td');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.backgroundColor = rgbStr(rec.rgb);
      colorCell.append(dot, document.createTextNode(rec.colorLabel));
      row.appendChild(colorCell);
      recordBody.appendChild(row);
    });
    tableWrap.classList.toggle('is-empty', records.length === 0);
    recordEmpty.hidden = records.length > 0;
    tableWrap.scrollTop = tableWrap.scrollHeight;
  }
}

/* ---------- Inisialisasi ---------- */
const palette = readPalette();
const store = new Store(createInitialState());
const lab = new LabController(store);
const benchRenderer = new ApparatusRenderer(document.getElementById('benchCanvas'), lab, palette);
const curveRenderer = new CurveRenderer(document.getElementById('curveCanvas'), lab, palette);
const simulation = new Simulation(lab, benchRenderer);

new UIController({ lab, store, bench: benchRenderer, curve: curveRenderer, sim: simulation });

const resizeObserver = new ResizeObserver(() => {
  benchRenderer.resize();
  curveRenderer.resize();
  curveRenderer.draw();
});
resizeObserver.observe(benchRenderer.canvas);
resizeObserver.observe(curveRenderer.canvas);

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => curveRenderer.draw());
}

simulation.start();