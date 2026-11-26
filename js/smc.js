// js/smc.js — Smart Money Concepts
// Swings confirmados, zonas de S/R agrupadas por toques, estrutura (BOS/CHoCH),
// order block não mitigado e FVG ainda aberto.

const SWING_LEN = 3;

function findSwings(S, len = SWING_LEN) {
  const highs = [], lows = [];
  const n = S.close.length;
  for (let i = len; i < n - len; i++) {
    let isH = true, isL = true;
    for (let k = i - len; k <= i + len; k++) {
      if (k === i) continue;
      if (S.high[k] > S.high[i] || (k < i && S.high[k] === S.high[i])) isH = false;
      if (S.low[k] < S.low[i] || (k < i && S.low[k] === S.low[i])) isL = false;
    }
    if (isH) highs.push({ i, price: S.high[i] });
    if (isL) lows.push({ i, price: S.low[i] });
  }
  return { highs, lows };
}

// Agrupa preços próximos (tolerância em ATR) e conta toques
function clusterLevels(prices, tol) {
  const sorted = [...prices].sort((a, b) => a - b);
  const groups = [];
  for (const p of sorted) {
    const g = groups[groups.length - 1];
    if (g && p - g.last <= tol) { g.sum += p; g.n++; g.last = p; }
    else groups.push({ sum: p, n: 1, last: p });
  }
  return groups.map(g => ({ price: g.sum / g.n, touches: g.n }));
}

function detectSMC(candles, S) {
  const n = S.close.length;
  const price = S.close[n - 1];
  const a = S.atr[n - 1] || price * 0.003;
  const { highs, lows } = findSwings(S);

  // Zonas usando os últimos 300 candles
  const recent = [...highs, ...lows].filter(s => s.i >= n - 300).map(s => s.price);
  const levels = clusterLevels(recent, 0.5 * a);
  const res = levels.filter(l => l.price > price + 0.1 * a).sort((x, y) => x.price - y.price);
  const sup = levels.filter(l => l.price < price - 0.1 * a).sort((x, y) => y.price - x.price);

  // Estrutura: últimos dois topos e fundos
  const [h1, h2] = highs.slice(-2), [l1, l2] = lows.slice(-2);
  let structure = 'Mista / indefinida', structDir = 0;
  if (h1 && h2 && l1 && l2) {
    if (h2.price > h1.price && l2.price > l1.price) { structure = 'Alta (topos e fundos ascendentes)'; structDir = 1; }
    else if (h2.price < h1.price && l2.price < l1.price) { structure = 'Baixa (topos e fundos descendentes)'; structDir = -1; }
  }

  // Quebra de estrutura mais recente
  const bull = findBreak(S, highs, 1), bear = findBreak(S, lows, -1);
  const lastBreak = [bull, bear].filter(Boolean).sort((x, y) => y.at - x.at)[0] || null;
  if (lastBreak) {
    lastBreak.kind = lastBreak.dir === -structDirBefore(highs, lows, lastBreak) ? 'CHoCH' : 'BOS';
  }

  const obBull = bull && orderBlock(S, bull, 1);
  const obBear = bear && orderBlock(S, bear, -1);
  const obs = [obBull, obBear].filter(Boolean).sort((x, y) => Math.abs(mid(x) - price) - Math.abs(mid(y) - price));

  return {
    res1: res[0] || null, res2: res[1] || null,
    sup1: sup[0] || null, sup2: sup[1] || null,
    structure, lastBreak,
    ob: obs[0] || null,
    fvg: openFVG(S, price)
  };
}

const mid = z => (z.top + z.bottom) / 2;

// Rótulos de estrutura para o gráfico: cada swing confirmado comparado ao anterior do mesmo tipo,
// mais divergências regulares do RSI entre swings consecutivos.
function structureMarks(S, maxSwings = 80) {
  const { highs, lows } = S.struct;
  const out = [];
  highs.forEach((h, k) => {
    if (k === 0) return;
    const p = highs[k - 1];
    out.push({ i: h.i, high: true, label: h.price > p.price ? 'HH' : 'LH' });
    if (h.price > p.price && S.rsi[h.i] != null && S.rsi[h.i] < S.rsi[p.i]) out.push({ i: h.i, high: true, div: true, label: 'Div−' });
  });
  lows.forEach((l, k) => {
    if (k === 0) return;
    const p = lows[k - 1];
    out.push({ i: l.i, high: false, label: l.price > p.price ? 'HL' : 'LL' });
    if (l.price < p.price && S.rsi[l.i] != null && S.rsi[l.i] > S.rsi[p.i]) out.push({ i: l.i, high: false, div: true, label: 'Div+' });
  });
  out.sort((a, b) => a.i - b.i);
  const minI = (highs.concat(lows).map(s => s.i).sort((a, b) => b - a)[maxSwings]) ?? 0;
  return out.filter(m => m.i >= minI);
}

// Primeiro fechamento além do swing mais recente que ainda não tinha sido rompido
function findBreak(S, swings, dir) {
  const n = S.close.length;
  for (let s = swings.length - 1; s >= Math.max(0, swings.length - 6); s--) {
    const sw = swings[s];
    for (let k = sw.i + SWING_LEN + 1; k < n; k++) {
      if (dir > 0 ? S.close[k] > sw.price : S.close[k] < sw.price) return { dir, at: k, swing: sw };
    }
  }
  return null;
}

// Estrutura vigente antes da quebra, olhando os swings anteriores a ela
function structDirBefore(highs, lows, brk) {
  const hs = highs.filter(h => h.i < brk.swing.i + 1).slice(-2);
  const ls = lows.filter(l => l.i < brk.swing.i + 1).slice(-2);
  if (hs.length < 2 || ls.length < 2) return 0;
  if (hs[1].price > hs[0].price && ls[1].price > ls[0].price) return 1;
  if (hs[1].price < hs[0].price && ls[1].price < ls[0].price) return -1;
  return 0;
}

// Order block: último candle contrário antes do impulso que causou a quebra.
// Descartado se o preço já fechou do outro lado dele (mitigado).
function orderBlock(S, brk, dir) {
  const n = S.close.length;
  let origin = brk.swing.i;
  for (let k = brk.swing.i; k <= brk.at; k++) {
    if (dir > 0 ? S.low[k] < S.low[origin] : S.high[k] > S.high[origin]) origin = k;
  }
  for (let k = origin; k >= Math.max(0, origin - 10); k--) {
    const opposite = dir > 0 ? S.close[k] < S.open[k] : S.close[k] > S.open[k];
    if (!opposite) continue;
    const zone = { top: S.high[k], bottom: S.low[k], type: dir > 0 ? 'bullish' : 'bearish', i: k };
    for (let j = brk.at + 1; j < n; j++) {
      if (dir > 0 ? S.close[j] < zone.bottom : S.close[j] > zone.top) return null;
    }
    return zone;
  }
  return null;
}

// FVG mais próximo do preço que ainda não foi totalmente preenchido (últimos 100 candles)
function openFVG(S, price) {
  const n = S.close.length;
  let best = null;
  for (let i = n - 1; i >= Math.max(2, n - 100); i--) {
    let gap = null;
    if (S.low[i] > S.high[i - 2]) gap = { type: 'bullish', top: S.low[i], bottom: S.high[i - 2], i };
    else if (S.high[i] < S.low[i - 2]) gap = { type: 'bearish', top: S.low[i - 2], bottom: S.high[i], i };
    if (!gap) continue;
    let filled = false;
    for (let j = i + 1; j < n && !filled; j++) {
      filled = gap.type === 'bullish' ? S.low[j] <= gap.bottom : S.high[j] >= gap.top;
    }
    if (filled) continue;
    if (!best || Math.abs(mid(gap) - price) < Math.abs(mid(best) - price)) best = gap;
  }
  return best;
}
