/* eCoins Estate demo account.
   Prices: Binance public market data (USDT pairs) x live USD/ZAR, falling back to a simulation.
   Balances, orders and fills live in this browser only (localStorage). */
(() => {
'use strict';

const REST = 'https://data-api.binance.vision';
const WSS = 'wss://data-stream.binance.vision/stream';
const MAKER = 0.001, TAKER = 0.0018, INSTANT = 0.0075;
const SAST = 7200; // chart times shown in South African time
const ASSETS = [
  { s: 'BTC',  name: 'Bitcoin', bin: 'BTCUSDT', qdp: 6, pdp: 0, color: '#F2A93B', usd: 80000, net: 'Bitcoin',        fee: 0.00005 },
  { s: 'ETH',  name: 'Ether',   bin: 'ETHUSDT', qdp: 4, pdp: 0, color: '#8C93E8', usd: 3000,  net: 'Ethereum',       fee: 0.0012 },
  { s: 'SOL',  name: 'Solana',  bin: 'SOLUSDT', qdp: 3, pdp: 2, color: '#B98AF5', usd: 150,   net: 'Solana',         fee: 0.001 },
  { s: 'XRP',  name: 'XRP',     bin: 'XRPUSDT', qdp: 1, pdp: 3, color: '#8FB3C2', usd: 2.2,   net: 'XRP Ledger',     fee: 0.2 },
  { s: 'USDT', name: 'Tether',  bin: null,      qdp: 2, pdp: 4, color: '#3FB68B', usd: 1,     net: 'Tron (TRC-20)',  fee: 1 },
];
const A = Object.fromEntries(ASSETS.map(a => [a.s, a]));
const TFS = [['1m', '1m'], ['5m', '5m'], ['15m', '15m'], ['1h', '1H'], ['4h', '4H'], ['1d', '1D']];
const TF_SEC = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
const ADDR = {
  BTC: 'bc1qdemo7x4k2h9w3c0lq8m5r6t2y9u4p0s3d7f8g',
  ETH: '0xDe30Ec01A5E57A7E0000000000000000Dem0Add1',
  SOL: 'DemoSo1AddressEcoinsEstate1111111111111111',
  XRP: 'rDEMOecoinsEstateDoNotSend1234567',
  USDT: 'TDemoEcoinsEstateTronAddressDoNotUse1',
};
const EXAMPLE_TO = {
  BTC: 'bc1qexampleexampleexampleexampleexample0q',
  ETH: '0x0000000000000000000000000000000000dEaD01',
  SOL: 'ExampLeSo1anaAddress111111111111111111111',
  XRP: 'rEXAMPLEdemoAddressDoNotSend123456',
  USDT: 'TExampleTronAddressDoNotSendFunds11',
};
const ADDR_RE = {
  BTC: /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/,
  ETH: /^0x[0-9a-fA-F]{40}$/,
  SOL: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  XRP: /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/,
  USDT: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
};

// ---------- helpers
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const fmt = (v, dp) => (isFinite(v) ? v : 0).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }).replace(/,/g, ' ');
const R = (v, dp = 2) => (v < -0.004 ? '−' : '') + 'R' + fmt(Math.abs(v), dp);
const Rsign = (v, dp = 2) => (v >= -0.005 ? '+' : '−') + 'R' + fmt(Math.abs(v), dp);
const pct = v => (v >= -0.005 ? '+' : '−') + fmt(Math.abs(v), 2) + '%';
const qf = (s, v) => fmt(v, A[s].qdp);
const pf = (s, v) => fmt(v, A[s].pdp);
const cls = v => v >= -0.005 ? 'up' : 'down';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const now = () => Date.now();
const uid = () => Math.random().toString(36).slice(2, 9).toUpperCase();
const tstr = t => new Date(t).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const num = v => { let s = String(v).replace(/[\s ]/g, ''); if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.'); s = s.replace(/,/g, ''); const n = parseFloat(s); return isFinite(n) ? n : 0; };
const floorTo = (v, dp) => Math.floor(v * 10 ** dp + 1e-9) / 10 ** dp;
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const tok = s => `<span class="tok" style="background:${A[s] ? A[s].color : '#5E7A70'}">${s}</span>`;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- state (per browser)
const KEY = 'ece-demo-v1';
const fresh = () => ({
  bal: { ZAR: 100000, BTC: 0.02, ETH: 0.5, SOL: 5, XRP: 400, USDT: 0 },
  basis: {}, realized: 0, orders: [], fills: [], moves: [], seeded: false, tourDone: false, pair: 'BTC', tf: '15m', created: now(),
});
let S = null;
try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) { S = null; }
if (!S || !S.bal) S = fresh();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* private mode: demo still works for this visit */ } };

// ---------- market state
const M = Object.fromEntries(ASSETS.map(a => [a.s, { px: 0, open: 0, high: 0, low: 0, vol: 0, h1: [] }]));
let fx = 16.42, live = false, ready = false;
let book = { bids: [], asks: [], step: 1 }, tape = [];
const price = s => s === 'ZAR' ? 1 : (M[s] ? M[s].px : 0);

async function getJSON(u) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
  try { const r = await fetch(u, { signal: ctl.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}

async function loadMarkets() {
  try { const j = await getJSON('https://open.er-api.com/v6/latest/USD'); if (j && j.rates && j.rates.ZAR) fx = j.rates.ZAR; } catch (e) { /* keep default */ }
  try {
    const syms = ASSETS.filter(a => a.bin).map(a => a.bin);
    const tk = await getJSON(`${REST}/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(syms))}`);
    for (const t of tk) {
      const a = ASSETS.find(x => x.bin === t.symbol); if (!a) continue;
      Object.assign(M[a.s], { px: +t.lastPrice * fx, open: +t.openPrice * fx, high: +t.highPrice * fx, low: +t.lowPrice * fx, vol: +t.quoteVolume * fx });
    }
    const h = await Promise.all(ASSETS.filter(a => a.bin).map(a => getJSON(`${REST}/api/v3/klines?symbol=${a.bin}&interval=1h&limit=168`).then(k => [a.s, k])));
    for (const [s, k] of h) M[s].h1 = k.map(c => [Math.floor(c[0] / 1000), +c[4] * fx]);
    live = true;
  } catch (e) {
    live = false; simInit();
  }
  usdtInit();
  ready = true;
}

function walkBack(end, n, vol, revert) {
  const out = [end];
  for (let i = 1; i < n; i++) { let p = out[0] * (1 + gauss() * vol); if (revert) p += (revert - p) * 0.08; out.unshift(p); }
  return out;
}
function simInit() {
  const hourNow = Math.floor(now() / 3600000) * 3600;
  for (const a of ASSETS) {
    if (!a.bin) continue;
    const px = a.usd * fx;
    const series = walkBack(px, 168, 0.007);
    const m = M[a.s];
    m.h1 = series.map((p, i) => [hourNow - (167 - i) * 3600, p]);
    m.px = px; m.open = series[143];
    const last24 = series.slice(-24); m.high = Math.max(...last24) * 1.002; m.low = Math.min(...last24) * 0.998;
    m.vol = (5e6 + Math.random() * 3e7) * (a.s === 'BTC' ? 4 : 1);
  }
}
function usdtInit() {
  const m = M.USDT, hourNow = Math.floor(now() / 3600000) * 3600;
  const series = walkBack(fx, 168, 0.0007, fx);
  m.h1 = series.map((p, i) => [hourNow - (167 - i) * 3600, p]);
  m.px = fx; m.open = series[143];
  const last24 = series.slice(-24); m.high = Math.max(...last24); m.low = Math.min(...last24); m.vol = 3.8e6;
}

// ---------- balances
function locked(a) {
  let x = 0;
  for (const o of S.orders) {
    if (o.status !== 'open') continue;
    if (o.side === 'buy' && a === 'ZAR') x += o.qty * o.price * (1 + TAKER);
    if (o.side === 'sell' && a === o.pair) x += o.qty;
  }
  return x;
}
const avail = a => Math.max(0, S.bal[a] - locked(a));
function seedIfNeeded() {
  if (S.seeded || !ready) return;
  for (const a of ASSETS) { const b = S.bal[a.s]; if (b > 0) S.basis[a.s] = { qty: b, cost: b * price(a.s) }; }
  S.moves.unshift({ id: uid(), t: now(), kind: 'Demo funds', method: 'Demo account', asset: 'ZAR', amt: 100000, status: 'Credited' });
  S.seeded = true; save();
}
function totals() {
  let total = S.bal.ZAR, day = 0, upnl = 0, cost = 0;
  for (const a of ASSETS) {
    const b = S.bal[a.s] || 0, v = b * price(a.s); total += v;
    day += b * (price(a.s) - (M[a.s].open || price(a.s)));
    const bs = S.basis[a.s];
    if (bs && bs.qty > 1e-12) { upnl += v - bs.cost; cost += bs.cost; }
  }
  return { total, day, dayPct: total - day > 0 ? day / (total - day) * 100 : 0, upnl, upnlPct: cost ? upnl / cost * 100 : 0, cash: S.bal.ZAR };
}
function clampDust() { for (const k in S.bal) if (Math.abs(S.bal[k]) < 1e-10) S.bal[k] = 0; }

// ---------- order engine
function bestAsk(s = S.pair) { return s === S.pair && book.asks.length ? book.asks[0][0] : price(s) * 1.0003; }
function bestBid(s = S.pair) { return s === S.pair && book.bids.length ? book.bids[0][0] : price(s) * 0.9997; }

function execute(side, s, qty, px, liq, type) {
  const notional = qty * px;
  const fee = notional * (liq === 'maker' ? MAKER : liq === 'instant' ? INSTANT : TAKER);
  const b = S.basis[s] || (S.basis[s] = { qty: 0, cost: 0 });
  if (side === 'buy') { S.bal.ZAR -= notional + fee; S.bal[s] += qty; b.qty += qty; b.cost += notional + fee; }
  else {
    S.bal.ZAR += notional - fee; S.bal[s] -= qty;
    if (b.qty > 0) { const avg = b.cost / b.qty, take = Math.min(qty, b.qty); S.realized += (notional - fee) - avg * take; b.qty -= take; b.cost -= avg * take; }
  }
  clampDust();
  const f = { id: uid(), t: now(), pair: s, side, type, px, qty, fee, liq, total: side === 'buy' ? notional + fee : notional - fee };
  S.fills.unshift(f);
  return f;
}

function matchOrders(s) {
  const px = price(s); let changed = false;
  for (const o of S.orders) {
    if (o.status !== 'open' || o.pair !== s) continue;
    if (o.type === 'stop' && !o.triggered) {
      if ((o.side === 'buy' && px >= o.stop) || (o.side === 'sell' && px <= o.stop)) {
        o.triggered = true; changed = true;
        toast(`Stop triggered: ${o.side} ${qf(s, o.qty)} ${s} limit at R${pf(s, o.price)}`);
      } else continue;
    }
    if ((o.side === 'buy' && px <= o.price) || (o.side === 'sell' && px >= o.price)) {
      if (o.side === 'buy' && S.bal.ZAR < o.qty * o.price * (1 + MAKER) - 0.01) continue;
      if (o.side === 'sell' && S.bal[s] < o.qty - 1e-12) continue;
      const f = execute(o.side, s, o.qty, o.price, 'maker', o.type === 'stop' ? 'stop-limit' : 'limit');
      o.status = 'filled'; o.filledAt = f.t; changed = true;
      toast(`Filled: ${o.side === 'buy' ? 'bought' : 'sold'} ${qf(s, o.qty)} ${s} at R${pf(s, o.price)}`, 'good');
    }
  }
  if (changed) { save(); renderAfterTrade(); }
}

// ---------- market feed (live)
let ws = null, wsId = 1, wsSubs = [], wsFails = 0;
function connectWS() {
  const streams = ASSETS.filter(a => a.bin).map(a => a.bin.toLowerCase() + '@miniTicker');
  try { ws = new WebSocket(`${WSS}?streams=${streams.join('/')}`); } catch (e) { return; }
  ws.onopen = () => { wsFails = 0; wsSubs = []; subscribePair(); setFeed(); };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } if (m && m.stream) onStream(m.stream, m.data); };
  ws.onclose = () => { ws = null; setFeed(); if (++wsFails < 20) setTimeout(connectWS, Math.min(30000, 2000 * wsFails)); };
  ws.onerror = () => { try { ws.close(); } catch (_) {} };
}
function subscribePair() {
  if (!ws || ws.readyState !== 1) return;
  if (wsSubs.length) ws.send(JSON.stringify({ method: 'UNSUBSCRIBE', params: wsSubs, id: wsId++ }));
  const a = A[S.pair]; wsSubs = [];
  if (a.bin) {
    const b = a.bin.toLowerCase();
    wsSubs = [`${b}@kline_${S.tf}`, `${b}@aggTrade`];
    ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: wsSubs, id: wsId++ }));
  }
}
function onStream(stream, d) {
  stream = stream.toLowerCase();
  if (stream.endsWith('@miniticker')) {
    const a = ASSETS.find(x => x.bin === d.s); if (!a) return;
    const m = M[a.s]; m.px = +d.c * fx; m.open = +d.o * fx; m.high = +d.h * fx; m.low = +d.l * fx; m.vol = +d.q * fx;
    matchOrders(a.s); dirty = true;
  } else if (stream.includes('@kline_')) {
    const k = d.k, a = ASSETS.find(x => x.bin === d.s);
    if (!a || a.s !== S.pair || k.i !== S.tf) return;
    const c = { time: Math.floor(k.t / 1000) + SAST, open: +k.o * fx, high: +k.h * fx, low: +k.l * fx, close: +k.c * fx };
    pushCandle(c, +k.v);
    M[a.s].px = c.close; matchOrders(a.s); dirty = true;
  } else if (stream.endsWith('@aggtrade')) {
    const a = ASSETS.find(x => x.bin === d.s); if (!a || a.s !== S.pair) return;
    tape.unshift({ p: +d.p * fx, q: +d.q, t: d.T, sell: d.m }); if (tape.length > 40) tape.length = 40;
  }
}
async function pollDepth() {
  const a = A[S.pair];
  if (!live || !a.bin || view !== 'trade') return;
  try {
    const d = await getJSON(`${REST}/api/v3/depth?symbol=${a.bin}&limit=100`);
    if (A[S.pair] !== a) return;
    book = bucketBook(d.bids.map(([p, q]) => [+p * fx, +q]), d.asks.map(([p, q]) => [+p * fx, +q]), price(a.s));
    dirty = true;
  } catch (e) { /* keep last book */ }
}
async function pollPrices() {
  if (!live || (ws && ws.readyState === 1)) return;
  try {
    const syms = ASSETS.filter(a => a.bin).map(a => a.bin);
    const tk = await getJSON(`${REST}/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(syms))}`);
    for (const t of tk) { const a = ASSETS.find(x => x.bin === t.symbol); if (a) { M[a.s].px = +t.price * fx; matchOrders(a.s); } }
    dirty = true;
  } catch (e) { /* try again next round */ }
}
function niceStep(x) { const p = 10 ** Math.floor(Math.log10(x)); const n = x / p; return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p; }
function bucketBook(bids, asks, px) {
  const step = niceStep(px * 0.00002);
  const agg = (lv, up) => {
    const m = new Map();
    for (const [p, q] of lv) { const k = up ? Math.ceil(p / step) * step : Math.floor(p / step) * step; m.set(k, (m.get(k) || 0) + q); }
    return [...m.entries()].sort((x, y) => up ? x[0] - y[0] : y[0] - x[0]).slice(0, 12);
  };
  return { bids: agg(bids, false), asks: agg(asks, true), step };
}

// ---------- market feed (simulated: everything when offline, USDT always)
function synthBook(px) {
  const step = niceStep(px * 0.00002), bids = [], asks = [];
  const mid = Math.round(px / step) * step;
  for (let i = 1; i <= 12; i++) {
    const size = (25000 / px) * (0.3 + Math.random() * 1.4) * (1 + i * 0.12);
    asks.push([mid + step * i, size * (0.7 + Math.random() * 0.6)]);
    bids.push([mid - step * (i - 1), size * (0.7 + Math.random() * 0.6)]);
  }
  return { bids, asks, step };
}
function synthTick() {
  if (!ready) return;
  if (!live) for (const a of ASSETS) {
    if (!a.bin) continue;
    const m = M[a.s]; m.px *= 1 + gauss() * 0.0006; m.high = Math.max(m.high, m.px); m.low = Math.min(m.low, m.px); m.vol += Math.random() * 20000;
    matchOrders(a.s);
  }
  const u = M.USDT; u.px += (fx - u.px) * 0.05 + gauss() * fx * 0.00012; u.high = Math.max(u.high, u.px); u.low = Math.min(u.low, u.px);
  matchOrders('USDT');
  if (!live || S.pair === 'USDT') {
    const px = price(S.pair);
    book = synthBook(px);
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) tape.unshift({ p: px * (1 + gauss() * 0.00008), q: (2000 + Math.random() * 30000) / px, t: now(), sell: Math.random() < 0.5 });
    if (tape.length > 40) tape.length = 40;
    if (candles.length) {
      const step = TF_SEC[S.tf], t = Math.floor(now() / 1000 / step) * step + SAST, last = candles[candles.length - 1];
      const c = t > last.time ? { time: t, open: last.close, high: Math.max(last.close, px), low: Math.min(last.close, px), close: px }
        : { time: last.time, open: last.open, high: Math.max(last.high, px), low: Math.min(last.low, px), close: px };
      pushCandle(c, (last.vol || 0) * (t > last.time ? 0.1 : 1) + Math.random() * 3000 / px);
    }
  }
  dirty = true;
}

// ---------- charts
let chart = null, cSeries = null, vSeries = null, candles = [], priceLines = [], pfChart = null, pfSeries = null, pfLastTime = 0;
const LC = window.LightweightCharts;
const chartTheme = {
  layout: { background: { type: 'solid', color: '#0F1C19' }, textColor: '#8BA096', fontFamily: 'IBM Plex Mono, monospace', fontSize: 11 },
  grid: { vertLines: { color: 'rgba(30,50,44,.55)' }, horzLines: { color: 'rgba(30,50,44,.55)' } },
  rightPriceScale: { borderColor: '#1E322C' },
  timeScale: { borderColor: '#1E322C', timeVisible: true, secondsVisible: false },
  crosshair: { mode: 0 },
  autoSize: true,
};
function initCharts() {
  if (!LC) {
    $('#chart').innerHTML = '<p class="empty">The chart library didn\'t load. Check your connection and refresh.</p>';
    $('#pf-chart').innerHTML = '<p class="empty">The chart library didn\'t load.</p>';
    return;
  }
  chart = LC.createChart($('#chart'), chartTheme);
  cSeries = chart.addCandlestickSeries({ upColor: '#2EBD85', downColor: '#F0616D', borderVisible: false, wickUpColor: '#2EBD85', wickDownColor: '#F0616D' });
  vSeries = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });

  pfChart = LC.createChart($('#pf-chart'), Object.assign({}, chartTheme, { handleScroll: false, handleScale: false, timeScale: { borderColor: '#1E322C', timeVisible: true } }));
  pfChart.applyOptions({ localization: { priceFormatter: p => 'R' + fmt(p, 0) } });
  pfSeries = pfChart.addAreaSeries({ lineColor: '#E2B357', topColor: 'rgba(226,179,87,.28)', bottomColor: 'rgba(226,179,87,0)', lineWidth: 2, priceFormat: { type: 'price', precision: 0, minMove: 1 } });
}
function pushCandle(c, vol) {
  if (!cSeries) return;
  const last = candles[candles.length - 1];
  if (last && c.time < last.time) return;
  c.vol = vol;
  if (last && c.time === last.time) candles[candles.length - 1] = c; else candles.push(c);
  cSeries.update({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close });
  vSeries.update({ time: c.time, value: vol || 0, color: c.close >= c.open ? 'rgba(46,189,133,.35)' : 'rgba(240,97,109,.35)' });
}
let candleReq = 0;
async function loadCandles() {
  if (!cSeries) return;
  const a = A[S.pair], tf = S.tf, req = ++candleReq;
  cSeries.applyOptions({ priceFormat: { type: 'price', precision: a.pdp, minMove: 1 / 10 ** a.pdp } });
  chart.applyOptions({ localization: { priceFormatter: p => fmt(p, a.pdp) } });
  let data = null;
  if (live && a.bin) {
    try {
      const k = await getJSON(`${REST}/api/v3/klines?symbol=${a.bin}&interval=${tf}&limit=500`);
      data = k.map(c => ({ time: Math.floor(c[0] / 1000) + SAST, open: +c[1] * fx, high: +c[2] * fx, low: +c[3] * fx, close: +c[4] * fx, vol: +c[5] }));
    } catch (e) { data = null; }
  }
  if (!data) {
    const step = TF_SEC[tf], n = 300, last = Math.floor(now() / 1000 / step) * step;
    const vol = (a.bin ? 0.0022 : 0.0003) * Math.sqrt(step / 300);
    const closes = walkBack(price(a.s), n, vol, a.bin ? 0 : fx);
    data = closes.map((c, i) => {
      const o = i ? closes[i - 1] : c * (1 + gauss() * vol);
      const hi = Math.max(o, c) * (1 + Math.abs(gauss()) * vol * 0.5), lo = Math.min(o, c) * (1 - Math.abs(gauss()) * vol * 0.5);
      return { time: last - (n - 1 - i) * step + SAST, open: o, high: hi, low: lo, close: c, vol: (20000 + Math.random() * 200000) / price(a.s) * Math.sqrt(step / 60) };
    });
  }
  if (req !== candleReq) return;
  candles = data;
  cSeries.setData(data.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
  vSeries.setData(data.map(c => ({ time: c.time, value: c.vol, color: c.close >= c.open ? 'rgba(46,189,133,.35)' : 'rgba(240,97,109,.35)' })));
  chart.timeScale().fitContent();
  const visible = Math.min(data.length, 120);
  chart.timeScale().setVisibleLogicalRange({ from: data.length - visible, to: data.length + 3 });
  drawOrderLines();
}
function drawOrderLines() {
  if (!cSeries) return;
  priceLines.forEach(l => cSeries.removePriceLine(l));
  priceLines = S.orders.filter(o => o.status === 'open' && o.pair === S.pair).map(o => {
    const pending = o.type === 'stop' && !o.triggered;
    return cSeries.createPriceLine({
      price: pending ? o.stop : o.price, color: o.side === 'buy' ? '#2EBD85' : '#F0616D', lineWidth: 1, lineStyle: 2, axisLabelVisible: true,
      title: `${o.side.toUpperCase()} ${pending ? 'STOP' : 'LMT'} ${qf(o.pair, o.qty)}`,
    });
  });
}
function pfData() {
  const base = M.BTC.h1; if (!base.length) return [];
  const out = [];
  for (let i = 0; i < base.length; i++) {
    let v = S.bal.ZAR;
    for (const a of ASSETS) { const h = M[a.s].h1, j = h.length - base.length + i; v += (S.bal[a.s] || 0) * (h[j] ? h[j][1] : price(a.s)); }
    out.push({ time: base[i][0] + SAST, value: v });
  }
  return out;
}
function renderPF() {
  if (!pfSeries) return;
  const d = pfData(); if (!d.length) return;
  d[d.length - 1].value = totals().total;
  pfSeries.setData(d); pfLastTime = d[d.length - 1].time;
  pfChart.timeScale().fitContent();
}

// ---------- canvases
function drawSpark(cv, pts, up) {
  const dpr = devicePixelRatio || 1, w = cv.clientWidth || 70, h = cv.clientHeight || 26;
  cv.width = w * dpr; cv.height = h * dpr; const x = cv.getContext('2d'); x.scale(dpr, dpr);
  if (pts.length < 2) return;
  const lo = Math.min(...pts), hi = Math.max(...pts), Y = v => 2 + (1 - (v - lo) / (hi - lo || 1)) * (h - 4);
  x.beginPath(); pts.forEach((v, i) => { const X = i * (w - 2) / (pts.length - 1) + 1; i ? x.lineTo(X, Y(v)) : x.moveTo(X, Y(v)); });
  x.strokeStyle = up ? '#2EBD85' : '#F0616D'; x.lineWidth = 1.5; x.stroke();
}
function drawAlloc() {
  const cv = $('#alloc'); const dpr = devicePixelRatio || 1, size = 150;
  cv.width = size * dpr; cv.height = size * dpr; const x = cv.getContext('2d'); x.scale(dpr, dpr);
  const parts = [['ZAR', S.bal.ZAR, '#5E7A70', 'Rands']].concat(ASSETS.map(a => [a.s, S.bal[a.s] * price(a.s), a.color, a.name])).filter(p => p[1] > 0.5);
  const tot = parts.reduce((s, p) => s + p[1], 0) || 1;
  let a0 = -Math.PI / 2;
  for (const p of parts) {
    const a1 = a0 + p[1] / tot * Math.PI * 2;
    x.beginPath(); x.arc(75, 75, 66, a0, a1); x.arc(75, 75, 46, a1, a0, true); x.closePath(); x.fillStyle = p[2]; x.fill();
    x.strokeStyle = '#0F1C19'; x.lineWidth = 2; x.stroke(); a0 = a1;
  }
  x.fillStyle = '#8BA096'; x.font = '11px "IBM Plex Sans", sans-serif'; x.textAlign = 'center'; x.fillText('Crypto', 75, 70);
  x.fillStyle = '#E3ECE7'; x.font = '600 15px "IBM Plex Mono", monospace';
  x.fillText(fmt((tot - S.bal.ZAR) / tot * 100, 0) + '%', 75, 89);
  $('#alloc-legend').innerHTML = parts.map(p => `<li><i style="background:${p[2]}"></i><span>${p[3]}</span><span class="num">${fmt(p[1] / tot * 100, 1)}%</span></li>`).join('');
}

// ---------- routing
let view = 'dashboard';
const VIEWS = ['dashboard', 'trade', 'wallet', 'history'];
function route() {
  let v = (location.hash || '#dashboard').slice(1);
  if (!VIEWS.includes(v)) v = 'dashboard';
  view = v;
  VIEWS.forEach(x => { $('#v-' + x).hidden = x !== v; });
  $$('#side a').forEach(a => a.setAttribute('aria-current', a.dataset.v === v ? 'page' : 'false'));
  renderView(true);
  if (v === 'trade') pollDepth();
}
function go(v) { if (location.hash !== '#' + v) location.hash = v; else route(); window.scrollTo(0, 0); }
function setPair(s) {
  if (!A[s]) return;
  S.pair = s; save(); book = { bids: [], asks: [], step: 1 }; tape = [];
  F.priceTouched = false;
  subscribePair(); loadCandles(); pollDepth(); buildPairPick(); syncForm(true);
}

// ---------- render
let dirty = true;
function renderView(full) {
  if (!ready) return;
  renderTop();
  if (view === 'dashboard') renderDashboard(full);
  if (view === 'trade') renderTrade(full);
  if (view === 'wallet') renderWallet();
  if (view === 'history') renderHistory();
}
function renderAfterTrade() { drawOrderLines(); renderPF(); renderView(true); if (view === 'trade') renderOrdersTable(); }

function renderTop() {
  const t = totals();
  $('#top-total').textContent = R(t.total);
  $('#ticker').innerHTML = ASSETS.map(a => {
    const m = M[a.s], ch = m.open ? (m.px - m.open) / m.open * 100 : 0;
    return `<button data-pair="${a.s}"><b>${a.s}/ZAR</b><span class="num">R${pf(a.s, m.px)}</span><span class="num ${cls(ch)}">${pct(ch)}</span></button>`;
  }).join('');
}
function setFeed() {
  const el = $('#feed'), lbl = el.querySelector('span');
  el.classList.toggle('live', live); el.classList.toggle('sim', !live);
  lbl.textContent = live ? (ws && ws.readyState === 1 ? 'Live prices' : 'Live prices (polling)') : 'Simulated prices';
  el.title = live ? `Live global prices (Binance USDT pairs) converted at USD/ZAR ${fmt(fx, 4)}. Indicative only.` : 'Market data couldn\'t be reached, so prices are simulated.';
}

function renderDashboard(full) {
  const t = totals();
  $('#st-total').textContent = R(t.total);
  $('#st-total-sub').textContent = `${Rsign(t.total - startValue())} since you opened the account`;
  $('#st-day').innerHTML = `<span class="${cls(t.day)}">${Rsign(t.day)}</span>`;
  $('#st-day-sub').innerHTML = `<span class="${cls(t.day)}">${pct(t.dayPct)}</span> on current holdings`;
  $('#st-pnl').innerHTML = `<span class="${cls(t.upnl)}">${Rsign(t.upnl)}</span>`;
  $('#st-pnl-sub').innerHTML = `<span class="${cls(t.upnl)}">${pct(t.upnlPct)}</span> vs average cost · realised ${Rsign(S.realized)}`;
  $('#st-cash').textContent = R(avail('ZAR'));
  $('#st-cash-sub').textContent = locked('ZAR') > 0.01 ? `${R(locked('ZAR'))} reserved for open orders` : 'Nothing reserved for orders';

  $('#holdings tbody').innerHTML = ASSETS.filter(a => S.bal[a.s] > 0 || (S.basis[a.s] && S.basis[a.s].qty > 0)).map(a => {
    const m = M[a.s], b = S.bal[a.s], v = b * m.px, bs = S.basis[a.s], avg = bs && bs.qty > 0 ? bs.cost / bs.qty : 0, pl = bs ? v - bs.cost : 0;
    const ch = m.open ? (m.px - m.open) / m.open * 100 : 0;
    return `<tr><td><div class="asset">${tok(a.s)}<div><b>${a.name}</b><small>${a.s}</small></div></div></td>
      <td class="num">${qf(a.s, b)}</td><td class="num">R${pf(a.s, m.px)}</td><td class="num ${cls(ch)}">${pct(ch)}</td>
      <td class="num">${R(v)}</td><td class="num">${avg ? 'R' + pf(a.s, avg) : '—'}</td>
      <td class="num ${cls(pl)}">${Rsign(pl)}<br><small>${bs && bs.cost ? pct(pl / bs.cost * 100) : ''}</small></td>
      <td class="r"><button class="btn sm" data-pair="${a.s}">Trade</button></td></tr>`;
  }).join('') || '<tr><td colspan="8" class="empty">No crypto yet. Use Quick buy or the Trade screen.</td></tr>';

  const w = $('#watch');
  if (full || !w.children.length) {
    w.innerHTML = ASSETS.map(a => `<button data-pair="${a.s}"><div class="asset">${tok(a.s)}<div><b>${a.s}/ZAR</b><small>${a.name}</small></div></div><canvas data-spark="${a.s}"></canvas><span class="r"></span></button>`).join('');
  }
  ASSETS.forEach(a => {
    const m = M[a.s], ch = m.open ? (m.px - m.open) / m.open * 100 : 0, btn = w.querySelector(`[data-pair="${a.s}"]`);
    btn.querySelector('.r').innerHTML = `R${pf(a.s, m.px)}<br><span class="${cls(ch)}">${pct(ch)}</span>`;
    if (full) drawSpark(btn.querySelector('canvas'), m.h1.slice(-24).map(p => p[1]).concat(m.px), ch >= 0);
  });

  if (full) { drawAlloc(); renderActivity(); renderPF(); }
  else if (pfSeries && pfLastTime) pfSeries.update({ time: pfLastTime, value: t.total });
  quickCalc();
}
function startValue() { return 100000 + ASSETS.reduce((s, a) => s + (fresh().bal[a.s] || 0) * ((S.seedPx && S.seedPx[a.s]) || 0), 0); }
function renderActivity() {
  const items = S.fills.map(f => ({ t: f.t, h: `<b class="${f.side === 'buy' ? 'up' : 'down'}">${f.side === 'buy' ? 'Bought' : 'Sold'}</b> ${qf(f.pair, f.qty)} ${f.pair}`, r: R(f.total), s: `${f.type} · R${pf(f.pair, f.px)}` }))
    .concat(S.moves.map(m => ({ t: m.t, h: `<b>${m.kind}</b> ${m.asset === 'ZAR' ? '' : qf(m.asset, m.amt) + ' ' + m.asset}`, r: m.asset === 'ZAR' ? R(m.amt) : '', s: `${m.method || ''} · ${moveStatus(m)}` })))
    .sort((a, b) => b.t - a.t).slice(0, 7);
  $('#activity').innerHTML = items.map(i => `<li><span>${i.h}</span><span class="num">${i.r}</span><span class="t">${tstr(i.t)}</span><span class="t r">${esc(i.s)}</span></li>`).join('') || '<li class="empty">Nothing yet.</li>';
}

// quick buy (simple mode)
let quickAsset = 'BTC';
function buildQuick() {
  $('#quick-asset').innerHTML = ASSETS.map(a => `<button type="button" class="chip" data-qa="${a.s}" aria-pressed="${a.s === quickAsset}">${a.name}</button>`).join('');
}
function quickCalc() {
  const z = num($('#quick-amt').value), fee = z * INSTANT, qty = (z - fee) / bestAsk(quickAsset);
  $('#quick-get').textContent = z > 0 ? `${qf(quickAsset, Math.max(0, qty))} ${quickAsset}` : '—';
  $('#quick-fee').textContent = z > 0 ? `Includes ${R(fee)} fee (0.75%) · price R${pf(quickAsset, bestAsk(quickAsset))}` : '';
}

// trade view
const F = { side: 'buy', type: 'limit', priceTouched: false };
function buildPairPick() {
  $('#pair-pick').innerHTML = ASSETS.map(a => `<button data-pair="${a.s}" aria-pressed="${a.s === S.pair}">${a.s}/ZAR</button>`).join('');
  $('#tf').innerHTML = TFS.map(([k, l]) => `<button class="chip" data-tf="${k}" aria-pressed="${k === S.tf}">${l}</button>`).join('');
}
function renderTrade(full) {
  const a = A[S.pair], m = M[S.pair], ch = m.open ? (m.px - m.open) / m.open * 100 : 0;
  $('#px-last').textContent = 'R' + pf(a.s, m.px);
  $('#px-last').className = 'num big-px ' + cls(ch);
  $('#px-chg').innerHTML = `<span class="${cls(ch)}">${Rsign(m.px - m.open, a.pdp)} (${pct(ch)})</span>`;
  $('#px-high').textContent = 'R' + pf(a.s, m.high);
  $('#px-low').textContent = 'R' + pf(a.s, m.low);
  $('#px-vol').textContent = 'R' + fmt(m.vol / 1e6, 1) + 'm';
  renderBook();
  if (full) { renderOrdersTable(); syncForm(); }
  else { updateFormSummary(); if (otTab === 'bal' || otTab === 'open') renderOrdersTable(); }
}
let bookTab = 'book';
function renderBook() {
  const a = A[S.pair];
  if (bookTab === 'book') {
    const dp = Math.max(0, -Math.floor(Math.log10(book.step || 1)));
    const max = Math.max(1e-12, ...book.asks.map(l => l[1]), ...book.bids.map(l => l[1]));
    const row = (l, kind) => `<div class="lv ${kind}" data-px="${l[0]}"><i style="width:${Math.min(100, l[1] / max * 100)}%"></i><span>${fmt(l[0], dp)}</span><span>${qf(a.s, l[1])}</span><span>${fmt(l[0] * l[1], 0)}</span></div>`;
    const spread = book.asks.length && book.bids.length ? book.asks[0][0] - book.bids[0][0] : 0;
    $('#book').innerHTML = book.asks.length ? `<div class="hd"><span>Price (R)</span><span>Amount (${a.s})</span><span>Total (R)</span></div>
      ${book.asks.slice(0, 10).reverse().map(l => row(l, 'ask')).join('')}
      <div class="mid"><b class="${cls(M[a.s].px - M[a.s].open)}">R${pf(a.s, M[a.s].px)}</b><span class="small muted">Spread R${fmt(spread, dp)}</span></div>
      ${book.bids.slice(0, 10).map(l => row(l, 'bid')).join('')}` : '<p class="empty">Loading the order book…</p>';
  } else {
    $('#trades').innerHTML = `<div class="hd"><span>Price (R)</span><span>Amount</span><span>Time</span></div>` +
      (tape.length ? tape.slice(0, 26).map(t => `<div class="row"><span class="${t.sell ? 'down' : 'up'}">${pf(a.s, t.p)}</span><span>${qf(a.s, t.q)}</span><span class="muted">${new Date(t.t).toLocaleTimeString('en-ZA', { hour12: false })}</span></div>`).join('') : '<p class="empty">Waiting for trades…</p>');
  }
}

// order form
function refPx() {
  if (F.type === 'market') return F.side === 'buy' ? bestAsk() : bestBid();
  return num($('#o-price').value);
}
function syncForm(resetPrice) {
  const a = A[S.pair];
  $$('#o-side button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.side === F.side)));
  $$('#o-type button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.type === F.type)));
  $('#f-price').hidden = F.type === 'market';
  $('#f-mkt').hidden = F.type !== 'market';
  $('#f-stop').hidden = F.type !== 'stop';
  $('#o-amt-lbl').textContent = `Amount (${a.s})`;
  if (resetPrice || !F.priceTouched || !$('#o-price').value) { $('#o-price').value = price(a.s) ? price(a.s).toFixed(a.pdp) : ''; F.priceTouched = false; }
  if (resetPrice) { $('#o-amt').value = ''; $('#o-total').value = ''; $('#o-stop').value = ''; }
  const btn = $('#o-submit');
  btn.className = 'btn ' + F.side;
  btn.textContent = `${F.side === 'buy' ? 'Buy' : 'Sell'} ${a.s}${F.type === 'market' ? ' at market' : ''}`;
  updateFormSummary();
}
function updateFormSummary() {
  const a = A[S.pair];
  $('#o-avail').textContent = F.side === 'buy' ? R(avail('ZAR')) : `${qf(a.s, avail(a.s))} ${a.s}`;
  const amt = num($('#o-amt').value), p = refPx();
  if (F.type === 'market' && amt > 0 && document.activeElement !== $('#o-total')) $('#o-total').value = (amt * p).toFixed(2);
  const marketable = F.type === 'market' || (F.type === 'limit' && ((F.side === 'buy' && p >= bestAsk()) || (F.side === 'sell' && p <= bestBid())));
  const rate = marketable ? TAKER : MAKER, notional = amt * p, fee = notional * rate;
  $('#o-sum').innerHTML = amt > 0 && p > 0 ? `
    <dt>${F.type === 'market' ? 'Est. price' : 'Price'}</dt><dd>R${pf(a.s, p)}</dd>
    <dt>Fee (${marketable ? 'taker 0.18%' : 'maker 0.10%'})</dt><dd>${R(fee)}</dd>
    <dt><b>${F.side === 'buy' ? 'You pay' : 'You receive'}</b></dt><dd><b>${R(F.side === 'buy' ? notional + fee : notional - fee)}</b></dd>`
    : `<dt>Fees</dt><dd>maker 0.10% · taker 0.18%</dd>`;
}
function onAmt() { const p = refPx(), amt = num($('#o-amt').value); $('#o-total').value = amt > 0 && p > 0 ? (amt * p).toFixed(2) : ''; $('#o-err').textContent = ''; updateFormSummary(); }
function onTotal() { const p = refPx(), t = num($('#o-total').value); $('#o-amt').value = t > 0 && p > 0 ? floorTo(t / p, A[S.pair].qdp).toString() : ''; $('#o-err').textContent = ''; updateFormSummary(); }
function onPct(pc) {
  const a = A[S.pair], p = refPx(); if (!(p > 0)) return;
  const amt = F.side === 'buy' ? avail('ZAR') * pc / 100 / (1 + TAKER) / p : avail(a.s) * pc / 100;
  $('#o-amt').value = floorTo(amt, a.qdp).toString(); onAmt();
}
function submitOrder(e) {
  e.preventDefault();
  const a = A[S.pair], s = a.s, err = $('#o-err');
  const amt = floorTo(num($('#o-amt').value), a.qdp), lim = num($('#o-price').value), stop = num($('#o-stop').value);
  const p = F.type === 'market' ? (F.side === 'buy' ? bestAsk() : bestBid()) : lim;
  const fail = m => { err.textContent = m; };
  if (!(amt > 0)) return fail(`Enter an amount of ${s}.`);
  if (F.type !== 'market' && !(lim > 0)) return fail('Enter a limit price.');
  if (F.type === 'stop' && !(stop > 0)) return fail('Enter a stop price.');
  if (amt * p < 10) return fail('The minimum order is R10.');
  if (F.side === 'buy' && amt * p * (1 + TAKER) > avail('ZAR') + 0.005) return fail(`Not enough rands. You have ${R(avail('ZAR'))} available. Lower the amount, or deposit more.`);
  if (F.side === 'sell' && amt > avail(s) + 1e-12) return fail(`You have ${qf(s, avail(s))} ${s} available. Lower the amount.`);
  if (F.type === 'stop') {
    if (F.side === 'buy' && stop <= price(s)) return fail(`A buy stop has to be above the current price (R${pf(s, price(s))}).`);
    if (F.side === 'sell' && stop >= price(s)) return fail(`A sell stop has to be below the current price (R${pf(s, price(s))}).`);
  }
  err.textContent = '';
  if (F.type === 'market') {
    const f = execute(F.side, s, amt, p, 'taker', 'market');
    toast(`${F.side === 'buy' ? 'Bought' : 'Sold'} ${qf(s, amt)} ${s} at R${pf(s, f.px)} · fee ${R(f.fee)}`, 'good');
  } else if (F.type === 'limit' && ((F.side === 'buy' && lim >= bestAsk()) || (F.side === 'sell' && lim <= bestBid()))) {
    const fp = F.side === 'buy' ? bestAsk() : bestBid();
    const f = execute(F.side, s, amt, fp, 'taker', 'limit');
    toast(`Your limit crossed the market and filled at once: ${qf(s, amt)} ${s} at R${pf(s, f.px)}`, 'good');
  } else {
    const o = { id: uid(), t: now(), pair: s, side: F.side, type: F.type, price: lim, stop: F.type === 'stop' ? stop : null, triggered: false, qty: amt, status: 'open' };
    S.orders.unshift(o);
    toast(F.type === 'stop' ? `Stop-limit placed: triggers at R${pf(s, stop)}` : `Limit order placed: ${F.side} ${qf(s, amt)} ${s} at R${pf(s, lim)}. It's on the chart.`);
  }
  save();
  $('#o-amt').value = ''; $('#o-total').value = '';
  otTab = 'open'; $$('#ot button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ot === otTab)));
  renderAfterTrade();
}

// orders table
let otTab = 'open';
function renderOrdersTable() {
  const open = S.orders.filter(o => o.status === 'open');
  $('#open-n').textContent = open.length ? `(${open.length})` : '';
  const el = $('#ot-body');
  if (otTab === 'open') {
    el.innerHTML = open.length ? `<table class="tbl"><thead><tr><th>Placed</th><th>Pair</th><th>Side</th><th>Type</th><th class="r">Price</th><th class="r">Trigger</th><th class="r">Amount</th><th class="r">Total</th><th class="r">Distance</th><th class="r"><button class="x-btn" data-cancel-all>Cancel all</button></th></tr></thead><tbody>
      ${open.map(o => { const ref = o.type === 'stop' && !o.triggered ? o.stop : o.price, dist = (ref - price(o.pair)) / price(o.pair) * 100;
        return `<tr><td>${tstr(o.t)}</td><td>${o.pair}/ZAR</td><td><span class="pill ${o.side}">${o.side}</span></td><td>${o.type === 'stop' ? 'Stop-limit' + (o.triggered ? ' (triggered)' : '') : 'Limit'}</td>
        <td class="num">R${pf(o.pair, o.price)}</td><td class="num">${o.stop ? 'R' + pf(o.pair, o.stop) : '—'}</td><td class="num">${qf(o.pair, o.qty)}</td><td class="num">${R(o.qty * o.price)}</td>
        <td class="num muted">${pct(dist)}</td><td class="r"><button class="x-btn" data-cancel="${o.id}">Cancel</button></td></tr>`; }).join('')}</tbody></table>`
      : '<p class="empty">No open orders. Place a limit order a little below the price and watch it fill when the market dips.</p>';
  } else if (otTab === 'hist') {
    const h = S.orders.filter(o => o.status !== 'open').slice(0, 50);
    el.innerHTML = h.length ? `<table class="tbl"><thead><tr><th>Placed</th><th>Pair</th><th>Side</th><th>Type</th><th class="r">Price</th><th class="r">Amount</th><th>Status</th></tr></thead><tbody>
      ${h.map(o => `<tr><td>${tstr(o.t)}</td><td>${o.pair}/ZAR</td><td><span class="pill ${o.side}">${o.side}</span></td><td>${o.type === 'stop' ? 'Stop-limit' : 'Limit'}</td><td class="num">R${pf(o.pair, o.price)}</td><td class="num">${qf(o.pair, o.qty)}</td><td><span class="pill ${o.status === 'filled' ? 'open' : 'done'}">${o.status}</span></td></tr>`).join('')}</tbody></table>`
      : '<p class="empty">Filled and cancelled limit orders show here.</p>';
  } else if (otTab === 'fills') {
    el.innerHTML = fillsTable(S.fills.slice(0, 50)) || '<p class="empty">No trades yet.</p>';
  } else {
    el.innerHTML = balancesTable(false);
  }
}
function fillsTable(fills) {
  if (!fills.length) return '';
  return `<table class="tbl"><thead><tr><th>Time</th><th>Pair</th><th>Side</th><th>Type</th><th class="r">Price</th><th class="r">Amount</th><th class="r">Fee</th><th class="r">Total</th><th>Role</th></tr></thead><tbody>
    ${fills.map(f => `<tr><td>${tstr(f.t)}</td><td>${f.pair}/ZAR</td><td><span class="pill ${f.side}">${f.side}</span></td><td>${f.type}</td><td class="num">R${pf(f.pair, f.px)}</td><td class="num">${qf(f.pair, f.qty)}</td><td class="num">${R(f.fee)}</td><td class="num">${R(f.total)}</td><td class="muted">${f.liq}</td></tr>`).join('')}</tbody></table>`;
}
function balancesTable(actions) {
  const rows = [['ZAR', 'South African rand']].concat(ASSETS.map(a => [a.s, a.name]));
  return `<table class="tbl"><thead><tr><th>Asset</th><th class="r">Total</th><th class="r">In orders</th><th class="r">Available</th><th class="r">Value (ZAR)</th>${actions ? '<th class="r">Actions</th>' : ''}</tr></thead><tbody>
    ${rows.map(([s, n]) => {
      const dp = s === 'ZAR' ? 2 : A[s].qdp, b = S.bal[s] || 0, l = locked(s);
      const act = !actions ? '' : s === 'ZAR'
        ? `<td class="r"><span class="acts"><button class="btn sm" data-modal="deposit">Deposit</button><button class="btn sm" data-modal="withdraw">Withdraw</button></span></td>`
        : `<td class="r"><span class="acts"><button class="btn sm" data-receive="${s}">Receive</button><button class="btn sm" data-send="${s}">Send</button><button class="btn sm" data-pair="${s}">Trade</button></span></td>`;
      return `<tr><td><div class="asset">${tok(s)}<div><b>${n}</b><small>${s}</small></div></div></td><td class="num">${fmt(b, dp)}</td><td class="num">${l > 0 ? fmt(l, dp) : '—'}</td><td class="num">${fmt(Math.max(0, b - l), dp)}</td><td class="num">${R(b * price(s))}</td>${act}</tr>`;
    }).join('')}</tbody></table>`;
}

// wallet + history
function renderWallet() { $('#wallet-tbl').outerHTML = balancesTable(true).replace('<table class="tbl">', '<table class="tbl" id="wallet-tbl">'); }
function moveStatus(m) {
  if (m.kind === 'Withdrawal') return now() - m.t > 20000 ? 'Paid out' : 'Processing';
  if (m.kind === 'Send') { if (m.test) return 'Test sent · rest waiting for your OK'; return now() < m.t + 3600000 ? `Security hold until ${new Date(m.t + 3600000).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}` : 'Sent'; }
  return m.status || 'Credited';
}
function renderHistory() {
  const vol = S.fills.reduce((s, f) => s + f.qty * f.px, 0), fees = S.fills.reduce((s, f) => s + f.fee, 0);
  $('#hist-stats').innerHTML = `
    <div class="stat"><span class="lbl">Trades</span><b class="num">${S.fills.length}</b></div>
    <div class="stat"><span class="lbl">Volume traded</span><b class="num">${R(vol)}</b></div>
    <div class="stat"><span class="lbl">Fees paid</span><b class="num">${R(fees)}</b></div>
    <div class="stat"><span class="lbl">Realised P&amp;L</span><b class="num ${cls(S.realized)}">${Rsign(S.realized)}</b></div>`;
  $('#hist-trades').innerHTML = fillsTable(S.fills) || '<p class="empty">No trades yet. Head to Trade and place your first order.</p>';
  $('#hist-moves').innerHTML = S.moves.length ? `<table class="tbl"><thead><tr><th>Time</th><th>Type</th><th>Method</th><th>Asset</th><th class="r">Amount</th><th class="r">Fee</th><th>Detail</th><th>Status</th></tr></thead><tbody>
    ${S.moves.map(m => `<tr><td>${tstr(m.t)}</td><td>${esc(m.kind)}</td><td>${esc(m.method || '')}</td><td>${m.asset}</td><td class="num">${m.asset === 'ZAR' ? R(m.amt) : qf(m.asset, m.amt)}</td><td class="num">${m.fee ? (m.asset === 'ZAR' ? R(m.fee) : qf(m.asset, m.fee)) : '—'}</td><td class="muted">${esc(m.detail || '')}</td><td>${esc(moveStatus(m))}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">Nothing yet.</p>';
}

// ---------- modals
function modal(html, mount) {
  const box = $('#modal-box'); box.innerHTML = html; $('#modal').hidden = false;
  if (mount) mount(box);
  const f = box.querySelector('input:not([type=checkbox]), select, .btn.gold'); if (f) f.focus();
}
function closeModal() { $('#modal').hidden = true; $('#modal-box').innerHTML = ''; }
const head = t => `<div class="modal-head"><h2 style="font-size:19px">${t}</h2><button class="x" data-close aria-label="Close">×</button></div>`;

const BANKS = ['Capitec', 'FNB', 'Standard Bank', 'Absa', 'Nedbank', 'TymeBank', 'Discovery'];
function depositModal(tab = 'instant') {
  const body = {
    instant: `<div class="field"><span>Your bank</span><div class="chips" id="banks">${BANKS.map((b, i) => `<button type="button" class="chip" data-bank="${b}" aria-pressed="${i === 0}">${b}</button>`).join('')}</div></div>
      <label class="field"><span>Amount (ZAR)</span><input class="input num" id="dep-amt" inputmode="decimal" value="5000"></label>
      <div class="note">Arrives in seconds. Free. You approve the payment in your own banking app.</div>
      <button class="btn gold" id="dep-go">Pay with Capitec</button>`,
    eft: `<div class="bank-dl"><dl class="kv"><dt>Bank</dt><dd>Demo Bank</dd><dt>Account name</dt><dd>eCoins Estate Client Account</dd><dt>Account number</dt><dd>000 000 0000 (demo)</dd><dt>Branch code</dt><dd>000000 (demo)</dd><dt><b style="color:var(--ink)">Your reference</b></dt><dd><b style="color:var(--gold);font-size:15px">ECE7K2Q9</b></dd></dl></div>
      <div class="note warn"><b>Use this reference exactly.</b> It's how we match your money to your account. EFTs take 1–2 business days, or arrive the same day from most banks.</div>
      <button class="btn" id="dep-copy">Copy bank details</button>
      <button class="btn gold" id="dep-sim">Simulate an R5 000 EFT arriving</button>`,
    card: `<label class="field"><span>Amount (ZAR)</span><input class="input num" id="dep-amt" inputmode="decimal" value="1000"></label>
      <div class="note">Visa or Mastercard in your own name. Fee 2.9%, processed by our payment partner.</div>
      <button class="btn gold" id="dep-go">Pay by card</button>`,
  }[tab];
  modal(`${head('Deposit rands')}
    <div class="seg" id="dep-tabs"><button data-dt="instant" aria-pressed="${tab === 'instant'}">Instant EFT</button><button data-dt="eft" aria-pressed="${tab === 'eft'}">Bank EFT</button><button data-dt="card" aria-pressed="${tab === 'card'}">Card</button></div>
    ${body}<p class="o-err" id="dep-err"></p>`, box => {
    box.querySelector('#dep-tabs').onclick = e => { const b = e.target.closest('[data-dt]'); if (b) depositModal(b.dataset.dt); };
    let bank = BANKS[0];
    const banks = box.querySelector('#banks');
    if (banks) banks.onclick = e => { const b = e.target.closest('[data-bank]'); if (!b) return; bank = b.dataset.bank; banks.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); box.querySelector('#dep-go').textContent = `Pay with ${bank}`; };
    const goBtn = box.querySelector('#dep-go');
    if (goBtn) goBtn.onclick = () => {
      const amt = num(box.querySelector('#dep-amt').value);
      if (amt < 50) { box.querySelector('#dep-err').textContent = 'The minimum deposit is R50.'; return; }
      if (amt > 50000) { box.querySelector('#dep-err').textContent = 'Your Level 2 limit is R50 000 a day. Verify your source of funds to raise it.'; return; }
      goBtn.disabled = true; goBtn.textContent = tab === 'card' ? 'Processing card payment…' : `Approve the payment in your ${bank} app…`;
      setTimeout(() => {
        const fee = tab === 'card' ? amt * 0.029 : 0;
        S.bal.ZAR += amt - fee;
        S.moves.unshift({ id: uid(), t: now(), kind: 'Deposit', method: tab === 'card' ? 'Card' : `Instant EFT · ${bank}`, asset: 'ZAR', amt: amt - fee, fee, status: 'Credited' });
        save(); closeModal(); toast(`${R(amt - fee)} added to your account`, 'good'); renderAfterTrade();
      }, reduceMotion ? 400 : 1800);
    };
    const cp = box.querySelector('#dep-copy');
    if (cp) cp.onclick = () => copy('Demo Bank\neCoins Estate Client Account\nAccount: 000 000 0000 (demo)\nBranch: 000000\nReference: ECE7K2Q9', 'Bank details copied');
    const sim = box.querySelector('#dep-sim');
    if (sim) sim.onclick = () => {
      S.bal.ZAR += 5000; S.moves.unshift({ id: uid(), t: now(), kind: 'Deposit', method: 'Bank EFT · ref ECE7K2Q9', asset: 'ZAR', amt: 5000, status: 'Credited' });
      save(); closeModal(); toast('R5 000 EFT matched by reference and credited', 'good'); renderAfterTrade();
    };
  });
}
function withdrawModal() {
  modal(`${head('Withdraw rands')}
    <div class="note">To <b style="color:var(--ink)">Demo Bank ••••4821</b> (L. Mokoena). For your safety, withdrawals only go to a verified account in your own name.</div>
    <label class="field"><span>Amount (ZAR) · available ${R(avail('ZAR'))}</span><input class="input num" id="wd-amt" inputmode="decimal" value="2000"></label>
    <dl class="kv small"><dt>Fee</dt><dd>R8.50</dd><dt>Arrives</dt><dd>Same day if requested before 15:00</dd></dl>
    <p class="o-err" id="wd-err"></p>
    <button class="btn gold" id="wd-go">Withdraw</button>`, box => {
    box.querySelector('#wd-go').onclick = () => {
      const amt = num(box.querySelector('#wd-amt').value);
      if (amt < 50) { box.querySelector('#wd-err').textContent = 'The minimum withdrawal is R50.'; return; }
      if (amt + 8.5 > avail('ZAR')) { box.querySelector('#wd-err').textContent = `You have ${R(avail('ZAR'))} available, including the R8.50 fee.`; return; }
      S.bal.ZAR -= amt + 8.5;
      S.moves.unshift({ id: uid(), t: now(), kind: 'Withdrawal', method: 'Bank ••••4821', asset: 'ZAR', amt, fee: 8.5 });
      save(); closeModal(); toast(`Withdrawal of ${R(amt)} is processing`, 'good'); renderAfterTrade();
    };
  });
}
function receiveModal(s) {
  const a = A[s];
  modal(`${head('Receive ' + a.name)}
    <div class="note warn"><b>Demo address.</b> Don't send real funds here.</div>
    <div class="qr" id="qr"></div>
    <div class="field"><span>Your ${s} address · network: ${a.net}</span><div class="addr">${ADDR[s]}</div></div>
    ${s === 'XRP' ? '<div class="field"><span>Your destination tag (required)</span><div class="addr">4810233</div></div><div class="note">Always include this tag when sending XRP to us. Without it, we can\'t tell the XRP belongs to you.</div>' : ''}
    <div class="note">Only send <b>${s}</b> on the <b>${a.net}</b> network to this address. Coins sent on another network can be lost.</div>
    <div class="row-btns" style="display:grid;gap:8px"><button class="btn" id="rc-copy">Copy address</button><button class="btn gold" id="rc-sim">Simulate an incoming deposit</button></div>`, box => {
    try { if (window.QRCode) new QRCode(box.querySelector('#qr'), { text: ADDR[s], width: 148, height: 148, colorDark: '#0A1311', colorLight: '#ffffff' }); else box.querySelector('#qr').hidden = true; } catch (e) { box.querySelector('#qr').hidden = true; }
    box.querySelector('#rc-copy').onclick = () => copy(ADDR[s], 'Address copied');
    box.querySelector('#rc-sim').onclick = () => {
      const qty = floorTo(2500 / price(s), a.qdp);
      S.bal[s] += qty; const b = S.basis[s] || (S.basis[s] = { qty: 0, cost: 0 }); b.qty += qty; b.cost += qty * price(s);
      S.moves.unshift({ id: uid(), t: now(), kind: 'Receive', method: a.net, asset: s, amt: qty, status: 'Confirmed', detail: 'From external wallet' });
      save(); closeModal(); toast(`Received ${qf(s, qty)} ${s} (about R2 500)`, 'good'); renderAfterTrade();
    };
  });
}
function sendModal(s) {
  const st = { s: s || 'XRP', addr: '', tag: '', noTag: false, who: '', name: '', amt: '', test: true };
  const draw = () => {
    const a = A[st.s];
    modal(`${head('Send crypto')}
      <div class="chips" id="sd-asset">${ASSETS.map(x => `<button type="button" class="chip" data-sa="${x.s}" aria-pressed="${x.s === st.s}">${x.s}</button>`).join('')}</div>
      <div class="small muted">Network: <b style="color:var(--ink)">${a.net}</b> · available ${qf(st.s, avail(st.s))} ${st.s}</div>
      <label class="field"><span>Recipient address</span><input class="input num" id="sd-addr" value="${esc(st.addr)}" placeholder="Paste the address" autocomplete="off"></label>
      <button type="button" class="chip" id="sd-ex" style="justify-self:start">Use an example exchange address</button>
      <div id="sd-addr-msg"></div>
      ${st.s === 'XRP' ? `<label class="field"><span>Destination tag (memo)</span><input class="input num" id="sd-tag" inputmode="numeric" value="${esc(st.tag)}" placeholder="e.g. 104882" ${st.noTag ? 'disabled' : ''}></label>
        <label class="check"><input type="checkbox" id="sd-notag" ${st.noTag ? 'checked' : ''}> This is my own private wallet and it doesn't use tags</label><div id="sd-tag-msg"></div>` : ''}
      <div class="field"><span>Who owns this wallet? (required by the Travel Rule)</span>
        <div class="chips" id="sd-who">${[['me', 'Me'], ['person', 'Another person'], ['exchange', 'An exchange']].map(([k, l]) => `<button type="button" class="chip" data-who="${k}" aria-pressed="${st.who === k}">${l}</button>`).join('')}</div>
        ${st.who === 'person' ? `<input class="input" id="sd-name" placeholder="Their full name" value="${esc(st.name)}">` : ''}
        ${st.who === 'exchange' ? `<input class="input" id="sd-name" placeholder="Which exchange? e.g. VALR, Luno, Binance" value="${esc(st.name)}">` : ''}</div>
      <label class="field"><span>Amount (${st.s})</span><div style="display:flex;gap:8px"><input class="input num" id="sd-amt" inputmode="decimal" value="${esc(st.amt)}"><button type="button" class="btn sm" id="sd-max">Max</button></div></label>
      <label class="check"><input type="checkbox" id="sd-test" ${st.test ? 'checked' : ''}> Send a small test first (recommended for new addresses)</label>
      <dl class="kv small" id="sd-sum"></dl>
      <p class="o-err" id="sd-err"></p>
      <button class="btn gold" id="sd-go">Review and send</button>`, box => {
      const msgs = () => {
        const addr = st.addr.trim(); let m = '';
        if (addr) {
          if (st.s === 'USDT' && /^0x/i.test(addr)) m = '<div class="note bad"><b>Wrong network.</b> This is an Ethereum address, but your USDT is sent over Tron (TRC-20). Coins sent to the wrong network are usually lost. Ask the recipient for a TRC-20 address.</div>';
          else if (st.s === 'ETH' && /^T/.test(addr)) m = '<div class="note bad"><b>Wrong network.</b> This looks like a Tron address. ETH needs an Ethereum address starting with 0x.</div>';
          else if (!ADDR_RE[st.s].test(addr)) m = `<div class="note bad">This doesn't look like a valid ${a.net} address. Check for missing characters.</div>`;
          else m = '<div class="note">New address. For your security it will be held for 1 hour, and we\'ll SMS you to confirm.</div>';
        }
        box.querySelector('#sd-addr-msg').innerHTML = m;
        const tm = box.querySelector('#sd-tag-msg');
        if (tm) tm.innerHTML = addr && !st.tag.trim() && !st.noTag ? '<div class="note bad"><b>Add the destination tag.</b> Exchanges use it to know whose account the XRP is for. If it\'s missing, the XRP can be lost. You\'ll find it on the exchange\'s deposit page.</div>' : '';
        const amt = num(st.amt), z = amt * price(st.s);
        box.querySelector('#sd-sum').innerHTML = `<dt>Network fee</dt><dd>${a.fee} ${st.s} (${R(a.fee * price(st.s))})</dd><dt>Recipient gets</dt><dd>${amt > 0 ? qf(st.s, amt) + ' ' + st.s + ' (' + R(z) + ')' : '—'}</dd><dt>Arrives in</dt><dd>${st.s === 'BTC' ? 'about 30 minutes' : 'about 2 minutes'} after the hold</dd>`;
      };
      box.querySelector('#sd-asset').onclick = e => { const b = e.target.closest('[data-sa]'); if (b) { st.s = b.dataset.sa; st.addr = ''; st.tag = ''; st.noTag = false; st.amt = ''; draw(); } };
      box.querySelector('#sd-who').onclick = e => { const b = e.target.closest('[data-who]'); if (b) { st.who = b.dataset.who; st.name = ''; draw(); } };
      box.querySelector('#sd-ex').onclick = () => { st.addr = EXAMPLE_TO[st.s]; st.who = 'exchange'; st.name = 'VALR'; draw(); };
      box.querySelector('#sd-addr').oninput = e => { st.addr = e.target.value; msgs(); };
      const tag = box.querySelector('#sd-tag'); if (tag) tag.oninput = e => { st.tag = e.target.value; msgs(); };
      const nt = box.querySelector('#sd-notag'); if (nt) nt.onchange = e => { st.noTag = e.target.checked; draw(); };
      const nm = box.querySelector('#sd-name'); if (nm) nm.oninput = e => { st.name = e.target.value; };
      box.querySelector('#sd-amt').oninput = e => { st.amt = e.target.value; msgs(); };
      box.querySelector('#sd-max').onclick = () => { st.amt = String(floorTo(Math.max(0, avail(st.s) - a.fee), a.qdp)); box.querySelector('#sd-amt').value = st.amt; msgs(); };
      box.querySelector('#sd-test').onchange = e => { st.test = e.target.checked; };
      box.querySelector('#sd-go').onclick = () => {
        const err = box.querySelector('#sd-err'), amt = num(st.amt), addr = st.addr.trim();
        if (!ADDR_RE[st.s].test(addr) || (st.s === 'USDT' && /^0x/i.test(addr))) return void (err.textContent = 'Enter a valid address for this network.');
        if (st.s === 'XRP' && !st.tag.trim() && !st.noTag) return void (err.textContent = 'Add the destination tag, or confirm this is your own wallet.');
        if (!st.who) return void (err.textContent = 'Tell us who owns this wallet.');
        if ((st.who === 'person' || st.who === 'exchange') && !st.name.trim()) return void (err.textContent = st.who === 'person' ? 'Enter the recipient\'s full name.' : 'Enter the exchange\'s name.');
        if (!(amt > 0)) return void (err.textContent = 'Enter an amount.');
        if (amt + a.fee > avail(st.s) + 1e-12) return void (err.textContent = `You have ${qf(st.s, avail(st.s))} ${st.s} available, including the ${a.fee} ${st.s} network fee.`);
        const out = amt + a.fee; S.bal[st.s] -= out;
        const b = S.basis[st.s]; if (b && b.qty > 0) { const take = Math.min(out, b.qty); b.cost -= b.cost / b.qty * take; b.qty -= take; }
        clampDust();
        S.moves.unshift({ id: uid(), t: now(), kind: 'Send', method: a.net, asset: st.s, amt, fee: a.fee, test: st.test, detail: `To ${addr.slice(0, 6)}…${addr.slice(-4)}${st.tag ? ' tag ' + st.tag : ''} · ${st.who === 'me' ? 'own wallet' : st.name}` });
        save(); closeModal();
        toast(st.test ? `Test send on its way. Confirm it arrived to release the rest.` : `Send scheduled. New address held for 1 hour; we've sent you an SMS.`, 'good');
        renderAfterTrade();
      };
      msgs();
    });
  };
  draw();
}
function resetModal() {
  modal(`${head('Reset the demo account?')}<p class="muted">This clears your trades, orders and transfers, and starts again with R100 000 and the starter portfolio.</p>
    <div style="display:flex;gap:8px"><button class="btn" data-close style="flex:1">Keep my account</button><button class="btn gold" id="rs-go" style="flex:1">Reset</button></div>`, box => {
    box.querySelector('#rs-go').onclick = () => { const td = S.tourDone; S = fresh(); S.tourDone = td; seedIfNeeded(); recordSeedPx(); save(); closeModal(); toast('Demo account reset'); setPair('BTC'); renderAfterTrade(); };
  });
}
function taxModal() {
  const start = new Date(new Date().getMonth() >= 2 ? new Date().getFullYear() : new Date().getFullYear() - 1, 2, 1);
  const fills = S.fills.filter(f => f.t >= start.getTime());
  const proceeds = fills.filter(f => f.side === 'sell').reduce((s, f) => s + f.total, 0);
  modal(`${head('SARS tax statement')}<p class="muted">Tax year ${start.getFullYear()}/${String(start.getFullYear() + 1).slice(2)} (1 March – end of February).</p>
    <div class="bank-dl"><dl class="kv"><dt>Trades this tax year</dt><dd>${fills.length}</dd><dt>Disposal proceeds</dt><dd>${R(proceeds)}</dd><dt>Realised gain / loss</dt><dd class="${cls(S.realized)}">${Rsign(S.realized)}</dd><dt>Fees paid</dt><dd>${R(fills.reduce((s, f) => s + f.fee, 0))}</dd></dl></div>
    <div class="note">The full statement lists every disposal with its base cost (weighted average method), ready for your ITR12 or your tax practitioner. Demo figures only. This isn't tax advice.</div>
    <button class="btn gold" id="tx-csv">Download trades (CSV)</button>`, box => { box.querySelector('#tx-csv').onclick = exportCSV; });
}
function welcomeModal() {
  modal(`<div class="welcome" style="display:grid;gap:14px">
    <span class="coin" style="width:44px;height:44px;font-size:16px">eC</span>
    <h2>Welcome to your eCoins Estate demo account</h2>
    <ul><li><b style="color:var(--ink)">R100 000 in demo funds</b> plus a small starter portfolio</li><li><b style="color:var(--ink)">Live market prices</b> converted to rands</li><li>Market, limit and stop-limit orders that really fill</li><li>Deposits, withdrawals and sends you can try safely</li></ul>
    <p class="muted small">Nothing here is real money. Your demo account is saved in this browser.</p>
    <div style="display:grid;gap:8px"><button class="btn gold" id="wl-tour">Take the 2-minute tour</button><button class="btn" id="wl-skip">Skip, I'll explore</button></div></div>`, box => {
    box.querySelector('#wl-tour').onclick = () => { closeModal(); startTour(); };
    box.querySelector('#wl-skip').onclick = () => { S.tourDone = true; save(); closeModal(); };
  });
}

function exportCSV() {
  const rows = [['Date (ISO)', 'Pair', 'Side', 'Type', 'Price (ZAR)', 'Amount', 'Fee (ZAR)', 'Total (ZAR)', 'Role']]
    .concat(S.fills.map(f => [new Date(f.t).toISOString(), f.pair + '/ZAR', f.side, f.type, f.px.toFixed(4), f.qty, f.fee.toFixed(2), f.total.toFixed(2), f.liq]));
  const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ecoinsestate-demo-trades.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(S.fills.length ? 'CSV downloaded' : 'CSV downloaded (no trades yet)');
}
async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); } catch (e) { toast('Copy isn\'t available here. Select the text and copy it manually.', 'bad'); }
}
function toast(msg, kind = '') {
  const el = document.createElement('div'); el.className = 'toast ' + kind; el.textContent = msg;
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), 4200);
  while ($('#toasts').children.length > 3) $('#toasts').firstChild.remove();
}

// ---------- support chat
const chatLog = [{ me: false, t: 'Hi Lerato, I\'m Thandi from eCoins Estate support. Ask me anything about deposits, trading or your account. I\'m a real person and I usually reply within a couple of minutes.' }];
const QUICK = ['How do the fees work?', 'When will my deposit arrive?', 'How does a stop-limit work?', 'Is my money safe?'];
function answer(q) {
  q = q.toLowerCase();
  if (/fee|cost|charge/.test(q)) return 'Quick buy (simple mode) is a flat 0.75%. On the trading screen it\'s 0.10% when your order rests on the book (maker) and 0.18% when it fills straight away (taker). Rand deposits by EFT are free and withdrawals are R8.50. You always see the exact fee before you confirm.';
  if (/deposit|eft|arriv|money in/.test(q)) return 'Instant EFT arrives in seconds. A normal bank EFT takes 1–2 business days, or the same day from most banks. Just use your reference, ECE7K2Q9. If it\'s been longer, send me the proof of payment and I\'ll find it.';
  if (/stop/.test(q)) return 'A stop-limit waits until the price reaches your stop, then places a limit order at your limit price. A sell stop below the market protects you against a drop. A buy stop above the market catches a breakout. It shows on the chart as a dashed line.';
  if (/safe|secur|hack|custod/.test(q)) return 'Your rands sit in a separate client account at our bank, apart from company money. Coins are held by a regulated custody partner, mostly in cold storage. We use 2FA, an address whitelist and a 1-hour hold on new addresses. (This is the planned setup. The demo has no real funds.)';
  if (/withdraw/.test(q)) return 'Withdrawals go to your verified bank account in your own name. They arrive the same day if you request before 15:00, and the fee is R8.50.';
  if (/login|log in|locked|password|recover/.test(q)) return 'If you\'re locked out, start recovery with your ID and a selfie, and I\'ll call you to confirm. You won\'t be stuck behind an email link.';
  return 'Thanks, I\'m checking that for you now. In the real app, your ticket number and reply time show at the top of this chat, so you always know where things stand.';
}
function renderChat() {
  $('#chat-log').innerHTML = chatLog.map(m => `<div class="msg ${m.me ? 'me' : m.typing ? 'them typing' : 'them'}">${esc(m.t)}</div>`).join('');
  $('#chat-log').scrollTop = 1e9;
  $('#chat-q').innerHTML = QUICK.map(q => `<button type="button" class="chip" data-cq="${esc(q)}">${esc(q)}</button>`).join('');
}
function sendChat(t) {
  chatLog.push({ me: true, t }); const typing = { me: false, typing: true, t: 'Thandi is typing…' }; chatLog.push(typing); renderChat();
  setTimeout(() => { chatLog.splice(chatLog.indexOf(typing), 1); chatLog.push({ me: false, t: answer(t) }); renderChat(); }, reduceMotion ? 300 : 1300);
}
function toggleChat(open) { const c = $('#chat'); c.hidden = open === undefined ? !c.hidden : !open; if (!c.hidden) { renderChat(); $('#chat-input').focus(); } }

// ---------- guided tour
const TOUR = [
  { v: 'dashboard', el: '#bal-pill', t: 'Your demo account', b: 'You start with R100 000 in demo rands and a small starter portfolio. Prices are live from the market, and nothing here is real money. Trade as much as you like.' },
  { v: 'dashboard', el: '#stats', t: 'Everything in rands', b: 'Total value, the 24-hour move, unrealised profit and loss against your average cost, and the cash you can spend right now.' },
  { v: 'dashboard', el: '#pf-panel', t: 'Performance you can actually see', b: 'Your current holdings, valued hour by hour over the last 7 days. Reviews show users dislike it when apps remove performance charts.' },
  { v: 'dashboard', el: '#holdings-panel', t: 'Holdings with cost basis', b: 'Average cost and profit or loss for each coin, updated with every fill. This is the basis for the SARS statement later.' },
  { v: 'dashboard', el: '#quick-panel', t: 'Simple mode for everyday buyers', b: 'Type an amount in rands and buy at one clear 0.75% fee. Beginners never need to see an order book.' },
  { v: 'trade', el: '#pair-bar', t: 'Pro trading on ZAR markets', b: 'BTC, ETH, SOL, XRP and USDT against the rand, with live 24-hour stats. Maker fee 0.10%, taker fee 0.18%.' },
  { v: 'trade', el: '#chart-panel', t: 'Live candles', b: '1-minute to daily candles in South African time. Your open orders appear on the chart as dashed lines.' },
  { v: 'trade', el: '#book-panel', t: 'Live order book', b: 'Market depth refreshes every couple of seconds. Click any level to copy its price into your order. The Trades tab shows a live list of trades.' },
  { v: 'trade', el: '#order-panel', t: 'Try it: place an order', b: 'Market, Limit or Stop-limit, with 25%, 50%, 75% and Max buttons. You see the exact fee and total before you submit. Try a limit buy just below the price.' },
  { v: 'trade', el: '#orders-panel', t: 'Orders that really fill', b: 'Open orders fill automatically when the live price reaches them. You can cancel them, and every fill lands in your trade history.' },
  { v: 'wallet', el: '#wallet-tbl', t: 'Wallet: rands and coins', b: 'Deposit by Instant EFT, bank EFT or card. Receive with a QR code. The Send screen blocks a missing XRP tag and the wrong network, and holds new addresses for an hour.' },
  { v: 'history', el: '#csv', t: 'Records and SARS', b: 'Export every trade as a CSV file, or get a capital gains summary for the tax year (1 March to end of February).' },
  { v: null, el: '#chat-fab', t: 'A real person, one tap away', b: 'Support is the most common complaint in reviews of SA crypto apps. Here you chat with a named agent and see the reply time.' },
];
let tourI = -1;
function startTour() { tourI = 0; $('#tour').hidden = false; toggleChat(false); showStep(); }
function endTour() { tourI = -1; $('#tour').hidden = true; S.tourDone = true; save(); }
function showStep() {
  const st = TOUR[tourI]; if (!st) return endTour();
  if (st.v && view !== st.v) go(st.v);
  const pop = $('#tour-pop');
  pop.innerHTML = `<span class="step">Step ${tourI + 1} of ${TOUR.length}</span><h3>${st.t}</h3><p>${st.b}</p>
    <div class="tour-nav"><button class="btn sm" id="tr-skip" style="background:none;border:0;color:var(--muted)">End tour</button>
    <span style="display:flex;gap:6px">${tourI ? '<button class="btn" id="tr-back">Back</button>' : ''}<button class="btn gold" id="tr-next">${tourI === TOUR.length - 1 ? 'Start trading' : 'Next'}</button></span></div>`;
  pop.querySelector('#tr-next').onclick = () => { if (tourI === TOUR.length - 1) { endTour(); go('trade'); } else { tourI++; showStep(); } };
  const bk = pop.querySelector('#tr-back'); if (bk) bk.onclick = () => { tourI--; showStep(); };
  pop.querySelector('#tr-skip').onclick = endTour;
  setTimeout(() => {
    const el = $(st.el); if (!el) return;
    if (st.v) el.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
    setTimeout(placeTour, reduceMotion ? 30 : 380);
  }, 60);
  pop.querySelector('#tr-next').focus();
}
function placeTour() {
  if (tourI < 0) return;
  const el = $(TOUR[tourI].el); if (!el) return;
  const r = el.getBoundingClientRect(), pad = 6, vw = innerWidth, vh = innerHeight;
  const top = Math.max(4, r.top - pad), bottom = Math.min(vh - 4, r.bottom + pad);
  Object.assign($('#tour-spot').style, { left: (r.left - pad) + 'px', top: top + 'px', width: (r.width + pad * 2) + 'px', height: Math.max(0, bottom - top) + 'px' });
  const pop = $('#tour-pop'), pw = pop.offsetWidth, ph = pop.offsetHeight;
  let x = Math.min(Math.max(16, r.left), vw - pw - 16), y;
  if (bottom + 12 + ph < vh) y = bottom + 12;
  else if (top - 12 - ph > 0) y = top - 12 - ph;
  else if (r.right + 16 + pw < vw) { x = r.right + 16; y = Math.min(Math.max(16, r.top), vh - ph - 16); }
  else if (r.left - 16 - pw > 0) { x = r.left - 16 - pw; y = Math.min(Math.max(16, r.top), vh - ph - 16); }
  else y = vh - ph - 16;
  Object.assign(pop.style, { left: x + 'px', top: y + 'px' });
}

// ---------- events
document.addEventListener('click', e => {
  const t = e.target.closest('button, a'); if (!t) return;
  const d = t.dataset;
  if (d.pair) { e.preventDefault(); if (d.pair !== S.pair) setPair(d.pair); else syncForm(); go('trade'); return; }
  if (d.modal === 'deposit') return depositModal();
  if (d.modal === 'withdraw') return withdrawModal();
  if (d.receive) return receiveModal(d.receive);
  if (d.send) return sendModal(d.send);
  if ('help' in d) return toggleChat();
  if (d.cancel) { const o = S.orders.find(x => x.id === d.cancel); if (o && o.status === 'open') { o.status = 'cancelled'; save(); toast('Order cancelled'); renderAfterTrade(); } return; }
  if ('cancelAll' in d) { S.orders.forEach(o => { if (o.status === 'open') o.status = 'cancelled'; }); save(); toast('All open orders cancelled'); renderAfterTrade(); return; }
  if (d.tf) { S.tf = d.tf; save(); buildPairPick(); subscribePair(); loadCandles(); return; }
  if (d.qa) { quickAsset = d.qa; buildQuick(); quickCalc(); return; }
  if (d.bt) { bookTab = d.bt; $$('#book-tabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.bt === bookTab))); $('#book').hidden = bookTab !== 'book'; $('#trades').hidden = bookTab !== 'trades'; renderBook(); return; }
  if (d.ot) { otTab = d.ot; $$('#ot button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ot === otTab))); renderOrdersTable(); return; }
  if (d.side) { F.side = d.side; syncForm(); return; }
  if (d.type) { F.type = d.type; syncForm(); onAmt(); return; }
  if (d.p) { onPct(+d.p); return; }
  if (d.cq) { sendChat(d.cq); return; }
});
$('#book').addEventListener('click', e => {
  const lv = e.target.closest('.lv'); if (!lv) return;
  if (F.type === 'market') { F.type = 'limit'; syncForm(); }
  $('#o-price').value = (+lv.dataset.px).toFixed(Math.max(A[S.pair].pdp, Math.max(0, -Math.floor(Math.log10(book.step || 1)))));
  F.priceTouched = true; onAmt(); $('#o-amt').focus();
});
$('#o-amt').addEventListener('input', onAmt);
$('#o-total').addEventListener('input', onTotal);
$('#o-price').addEventListener('input', () => { F.priceTouched = true; onAmt(); });
$('#o-stop').addEventListener('input', updateFormSummary);
$('#o-form').addEventListener('submit', submitOrder);
$('#quick-amt').addEventListener('input', quickCalc);
$('#quick').addEventListener('submit', e => {
  e.preventDefault();
  const z = num($('#quick-amt').value), s = quickAsset;
  if (z < 10) return toast('The minimum buy is R10.', 'bad');
  if (z > avail('ZAR') + 0.005) return toast(`You have ${R(avail('ZAR'))} available. Lower the amount, or deposit more.`, 'bad');
  const px = bestAsk(s), fee = z * INSTANT, qty = (z - fee) / px;
  S.bal.ZAR -= z; S.bal[s] += qty;
  const b = S.basis[s] || (S.basis[s] = { qty: 0, cost: 0 }); b.qty += qty; b.cost += z;
  S.fills.unshift({ id: uid(), t: now(), pair: s, side: 'buy', type: 'instant', px, qty, fee, liq: 'instant', total: z });
  clampDust(); save(); toast(`Bought ${qf(s, qty)} ${s} for ${R(z)} (fee ${R(fee)})`, 'good'); renderAfterTrade();
});
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal(); });
$('#chat-x').addEventListener('click', () => toggleChat(false));
$('#chat-form').addEventListener('submit', e => { e.preventDefault(); const v = $('#chat-input').value.trim(); if (v) { $('#chat-input').value = ''; sendChat(v); } });
$('#btn-tour').addEventListener('click', startTour);
$('#btn-reset').addEventListener('click', resetModal);
$('#csv').addEventListener('click', exportCSV);
$('#tax').addEventListener('click', taxModal);
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#modal').hidden) closeModal(); else if (tourI >= 0) endTour(); else if (!$('#chat').hidden) toggleChat(false);
});
addEventListener('hashchange', route);
addEventListener('resize', () => { placeTour(); if (view === 'dashboard') drawAlloc(); });
addEventListener('scroll', () => { if (tourI >= 0) placeTour(); }, { passive: true });

// ---------- boot
function recordSeedPx() { S.seedPx = Object.fromEntries(ASSETS.map(a => [a.s, price(a.s)])); save(); }
async function boot() {
  buildQuick(); buildPairPick(); initCharts(); route();
  await loadMarkets();
  if (!S.seeded) { seedIfNeeded(); recordSeedPx(); }
  if (!S.seedPx) recordSeedPx();
  setFeed();
  syncForm(true);
  loadCandles();
  if (live) connectWS();
  route();
  setInterval(synthTick, 1000);
  setInterval(() => { if (dirty) { dirty = false; renderView(false); } }, 1000);
  setInterval(pollDepth, 2500);
  setInterval(pollPrices, 10000);
  setInterval(() => { if (view === 'dashboard') { renderActivity(); renderPF(); } if (view === 'history') renderHistory(); }, 30000);
  setInterval(setFeed, 5000);
  if (!S.tourDone && !/notour/.test(location.search)) welcomeModal();
}
boot();
})();
