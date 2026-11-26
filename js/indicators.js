// js/indicators.js — Indicadores como séries completas (um valor por candle, null no aquecimento)
// Fórmulas no padrão do TradingView: EMA semeada com SMA; RSI, ATR e ADX com suavização de Wilder.

function sma(values, p) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= p) sum -= values[i - p];
    if (i >= p - 1) out[i] = sum / p;
  }
  return out;
}

// Média exponencial genérica: começa no primeiro valor não-nulo, semente = SMA dos p primeiros
function smooth(values, p, k) {
  const out = new Array(values.length).fill(null);
  const start = values.findIndex(v => v != null);
  if (start < 0 || values.length - start < p) return out;
  let prev = 0;
  for (let i = start; i < start + p; i++) prev += values[i];
  prev /= p;
  out[start + p - 1] = prev;
  for (let i = start + p; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

const ema = (values, p) => smooth(values, p, 2 / (p + 1));
const rma = (values, p) => smooth(values, p, 1 / p); // Wilder

function rsi(closes, p = 14) {
  const gains = [null], losses = [null];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(Math.max(d, 0));
    losses.push(Math.max(-d, 0));
  }
  const ag = rma(gains, p), al = rma(losses, p);
  return closes.map((_, i) => {
    if (ag[i] == null) return null;
    if (al[i] === 0) return 100;
    return 100 - 100 / (1 + ag[i] / al[i]);
  });
}

function macd(closes, fast = 12, slow = 26, sig = 9) {
  const ef = ema(closes, fast), es = ema(closes, slow);
  const line = closes.map((_, i) => (ef[i] == null || es[i] == null) ? null : ef[i] - es[i]);
  const signal = ema(line, sig);
  const hist = line.map((v, i) => (v == null || signal[i] == null) ? null : v - signal[i]);
  return { line, signal, hist };
}

function bollinger(closes, p = 20, mult = 2) {
  const mid = sma(closes, p);
  const upper = mid.slice(), lower = mid.slice();
  for (let i = p - 1; i < closes.length; i++) {
    let v = 0;
    for (let j = i - p + 1; j <= i; j++) v += (closes[j] - mid[i]) ** 2;
    const sd = Math.sqrt(v / p);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
  }
  return { upper, mid, lower };
}

function trueRange(candles) {
  return candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const pc = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  });
}

const atr = (candles, p = 14) => rma(trueRange(candles), p);

function adx(candles, p = 14) {
  const n = candles.length;
  const tr = trueRange(candles);
  const trS = [null], pdm = [null], mdm = [null];
  for (let i = 1; i < n; i++) {
    const up   = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    pdm.push(up > down && up > 0 ? up : 0);
    mdm.push(down > up && down > 0 ? down : 0);
    trS.push(tr[i]);
  }
  const sTR = rma(trS, p), sP = rma(pdm, p), sM = rma(mdm, p);
  const plusDI = [], minusDI = [], dx = [];
  for (let i = 0; i < n; i++) {
    if (sTR[i] == null || sTR[i] === 0) { plusDI.push(null); minusDI.push(null); dx.push(null); continue; }
    const pdi = 100 * sP[i] / sTR[i], mdi = 100 * sM[i] / sTR[i];
    plusDI.push(pdi); minusDI.push(mdi);
    dx.push(pdi + mdi === 0 ? 0 : 100 * Math.abs(pdi - mdi) / (pdi + mdi));
  }
  return { adx: rma(dx, p), plusDI, minusDI };
}

// VWAP que reinicia a cada dia UTC (sessão da Binance)
function vwap(candles) {
  let day = null, pv = 0, vol = 0;
  return candles.map(c => {
    const d = Math.floor(c.time / 86400);
    if (d !== day) { day = d; pv = 0; vol = 0; }
    const tp = (c.high + c.low + c.close) / 3;
    pv += tp * c.volume;
    vol += c.volume;
    return vol > 0 ? pv / vol : tp;
  });
}

// Supertrend (padrão TradingView): linha de stop que segue a tendência e muda de lado quando ela vira
function supertrend(candles, p = 10, mult = 3) {
  const a = atr(candles, p);
  const line = [], dir = [];
  let upPrev = null, dnPrev = null, d = 1;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (a[i] == null) { line.push(null); dir.push(null); continue; }
    const hl2 = (c.high + c.low) / 2;
    let up = hl2 - mult * a[i], dn = hl2 + mult * a[i];
    if (upPrev != null) {
      const pc = candles[i - 1].close;
      if (pc > upPrev) up = Math.max(up, upPrev);
      if (pc < dnPrev) dn = Math.min(dn, dnPrev);
      if (d === -1 && c.close > dnPrev) d = 1;
      else if (d === 1 && c.close < upPrev) d = -1;
    }
    line.push(d === 1 ? up : dn);
    dir.push(d);
    upPrev = up; dnPrev = dn;
  }
  return { line, dir };
}

// Máxima/mínima dos p candles ANTERIORES (sem incluir o atual)
function highestPrev(values, p) {
  return values.map((_, i) => i < p ? null : Math.max(...values.slice(i - p, i)));
}
function lowestPrev(values, p) {
  return values.map((_, i) => i < p ? null : Math.min(...values.slice(i - p, i)));
}

// Swings confirmados até cada candle (sem olhar o futuro: o pivô em k só é conhecido em k + len).
// sh1/sl1 = último topo/fundo confirmado, sh2/sl2 = o anterior.
function structureSeries(high, low, len = 3) {
  const n = high.length;
  const sh1 = new Array(n).fill(null), sh2 = sh1.slice(), sl1 = sh1.slice(), sl2 = sh1.slice();
  const H = [], L = [];
  for (let i = 0; i < n; i++) {
    const k = i - len;
    if (k >= len) {
      let isH = true, isL = true;
      for (let j = k - len; j <= k + len; j++) {
        if (j === k) continue;
        if (high[j] > high[k] || (j < k && high[j] === high[k])) isH = false;
        if (low[j] < low[k] || (j < k && low[j] === low[k])) isL = false;
      }
      if (isH) H.push({ i: k, price: high[k] });
      if (isL) L.push({ i: k, price: low[k] });
    }
    sh1[i] = H[H.length - 1] || null; sh2[i] = H[H.length - 2] || null;
    sl1[i] = L[L.length - 1] || null; sl2[i] = L[L.length - 2] || null;
  }
  return { sh1, sh2, sl1, sl2, highs: H, lows: L };
}

function computeSeries(candles, { withVwap = true } = {}) {
  const close  = candles.map(c => c.close);
  const volume = candles.map(c => c.volume);
  const high   = candles.map(c => c.high);
  const low    = candles.map(c => c.low);
  const dmi = adx(candles, 14);
  return {
    st:     supertrend(candles, 10, 3),
    dcHigh: highestPrev(high, 20),
    dcLow:  lowestPrev(low, 20),
    high10: highestPrev(high, 10),
    low10:  lowestPrev(low, 10),
    struct: structureSeries(high, low, 3),
    time:   candles.map(c => c.time),
    open:   candles.map(c => c.open),
    high:   candles.map(c => c.high),
    low:    candles.map(c => c.low),
    close, volume,
    ema9:   ema(close, 9),
    ema21:  ema(close, 21),
    ema50:  ema(close, 50),
    ema200: ema(close, 200),
    rsi:    rsi(close, 14),
    macd:   macd(close),
    bb:     bollinger(close, 20, 2),
    atr:    atr(candles, 14),
    adx:    dmi.adx,
    plusDI: dmi.plusDI,
    minusDI: dmi.minusDI,
    vwap:   withVwap ? vwap(candles) : candles.map(() => null),
    volSma: sma(volume, 20)
  };
}

// Tendência do timeframe maior: +1 alta, −1 baixa, 0 indefinida.
// Retorna uma função que dá a tendência vigente num instante (ms), usando só candles HTF já fechados.
function buildHTFTrend(htfCandles) {
  const close = htfCandles.map(c => c.close);
  const e50 = ema(close, 50), e200 = ema(close, 200);
  const trend = htfCandles.map((c, i) => {
    if (e200[i] == null) return null;
    if (c.close > e50[i] && e50[i] > e200[i]) return 1;
    if (c.close < e50[i] && e50[i] < e200[i]) return -1;
    return 0;
  });
  return function trendAt(ms) {
    let lo = 0, hi = htfCandles.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (htfCandles[mid].closeTime <= ms) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans < 0 ? null : trend[ans];
  };
}
