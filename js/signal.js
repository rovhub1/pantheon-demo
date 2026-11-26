// js/signal.js — Estratégias de sinal
//
// Cada estratégia tem filtros (todos obrigatórios), gatilho (todos obrigatórios) e confirmações (mínimo exigido).
// Sempre avaliada num candle FECHADO: o sinal não muda depois.
// Saída: stop fixo + alvo (estratégias de alvo) ou stop móvel que acompanha a tendência (trail).

// Parâmetros escolhidos em histórico longo (60% para escolher, 40% para conferir), out/2026:
//  - rompimento foi a única positiva nos dois trechos: 4h +0,55R / +0,25R por operação, 1d +0,74R / +0,57R
//  - em 5m e 15m todas as estratégias perderam (as taxas comem o movimento)
const SIGNAL_CFG = {
  pullback:   { adx: 25, minConf: 2, stopAtr: 2.5, targetR: 2, htfRequired: true },
  supertrend: { htfRequired: false, ema200: false, minConf: 0 },
  breakout:   { htfRequired: false, stopAtr: 2, minConf: 0 },
  reversal:   { targetR: 2, minConf: 2 }
};
const DEFAULT_STRATEGY = 'breakout';

const STRATEGIES = {
  supertrend: {
    name: 'Virada do Supertrend',
    desc: 'Entra quando o Supertrend vira a favor da tendência maior e acompanha com stop móvel até virar de novo.',
    maxBars: 2000, side: supertrendSide
  },
  breakout: {
    name: 'Rompimento de 20 candles',
    desc: 'Entra no fechamento acima da máxima (ou abaixo da mínima) dos últimos 20 candles e sai pela mínima de 10 (Turtle).',
    maxBars: 2000, side: breakoutSide
  },
  pullback: {
    name: 'Pullback na tendência',
    desc: 'Em tendência forte (ADX ≥ 25), compra a correção até a EMA 21. Stop 2,5 ATR, alvo 2R.',
    maxBars: 48, side: pullbackSide
  },
  reversal: {
    name: 'Reversão (CHoCH + divergência)',
    desc: 'Tenta pegar a virada: quebra da estrutura contrária (CHoCH) com divergência no RSI. Alvo 2R.',
    maxBars: 48, side: reversalSide
  }
};

function evaluateSignal(S, i, htf, key) {
  const strat = STRATEGIES[key];
  const ready = i >= 201 && S.ema200[i] != null && S.adx[i] != null && S.macd.hist[i - 1] != null && S.st.dir[i - 1] != null;
  if (!ready) return { ready: false, direction: 'NEUTRO', checks: [], passed: 0, total: 0, strategy: key };

  const long = strat.side(S, i, htf, 1), short = strat.side(S, i, htf, -1);

  // Filtro opcional de taxa: só entra se o stop estiver a pelo menos minStopPct% do preço
  // (stop muito curto = posição grande = a taxa vira uma fatia grande do risco)
  const minStop = SIGNAL_CFG[key] && SIGNAL_CFG[key].minStopPct;
  if (minStop) {
    for (const sd of [long, short]) {
      const ok = Math.abs(S.close[i] - sd.stop) / S.close[i] * 100 >= minStop;
      sd.checks.unshift({ group: 'filtro', label: `Stop a pelo menos ${minStop}% do preço (taxa não come o lucro)`, ok });
      sd.total++;
      if (ok) sd.passed++;
      sd.fired = sd.fired && ok;
    }
  }
  // Filtro opcional de regime de volatilidade (estudo de 20/10, skill volatility-modeling):
  // compara o ATR atual com a média do ATR dos últimos 100 candles. 'expanding' = só entra com a volatilidade
  // acima da média; 'calm' = só abaixo; 'noExtreme' = evita volatilidade mais de 1,8× acima do normal.
  const volMode = SIGNAL_CFG[key] && SIGNAL_CFG[key].volRegime;
  if (volMode) {
    let s = 0, n = 0;
    for (let k = Math.max(0, i - 100); k < i; k++) if (S.atr[k] != null) { s += S.atr[k]; n++; }
    const ratio = n ? S.atr[i] / (s / n) : 1;
    const ok = volMode === 'expanding' ? ratio >= 1 : volMode === 'calm' ? ratio <= 1 : ratio <= 1.8;
    const label = volMode === 'expanding' ? 'Volatilidade acima do normal (mercado acordando)' : volMode === 'calm' ? 'Volatilidade abaixo do normal' : 'Volatilidade não está extrema';
    for (const sd of [long, short]) {
      sd.checks.unshift({ group: 'filtro', label: `${label} · ATR ${ratio.toFixed(2)}× a média`, ok });
      sd.total++; if (ok) sd.passed++; sd.fired = sd.fired && ok;
    }
  }
  let pick;
  if (long.fired && !short.fired) pick = long;
  else if (short.fired && !long.fired) pick = short;
  else pick = (long.passed / long.total) >= (short.passed / short.total) ? long : short;

  const c = S.close[i];
  return {
    ready: true,
    strategy: key,
    direction: pick.fired ? (pick.dir > 0 ? 'COMPRA' : 'VENDA') : 'NEUTRO',
    side: pick.dir,
    checks: pick.checks,
    passed: pick.passed,
    total: pick.total,
    entry: c,
    stop: pick.stop,
    target: pick.target,
    trail: pick.trail,
    maxBars: strat.maxBars,
    rr: pick.target == null ? null : Math.abs(pick.target - c) / Math.abs(c - pick.stop)
  };
}

function finish(dir, checks, minConf, stop, target, trail = null) {
  const groupOk = g => checks.filter(c => c.group === g).every(c => c.ok);
  const conf = checks.filter(c => c.group === 'confirmação' && c.ok).length;
  const passed = checks.filter(c => c.ok).length;
  const total = checks.length;
  if (minConf > 0) checks.push({ group: 'confirmação', label: `Mínimo de ${minConf} confirmação(ões)`, ok: conf >= minConf, meta: true });
  return {
    dir, checks, stop, target, trail, passed, total,
    fired: groupOk('filtro') && groupOk('gatilho') && conf >= minConf
  };
}

// ===== Leitura do candle (price action) =====
// Padrões clássicos de vela no candle do sinal (e nos anteriores), sempre a favor do lado da entrada.
// Modos (parâmetro `candle` de cada estratégia):
//  - 'close':   filtro — o candle fecha no terço a favor e não tem pavio grande de rejeição contra
//  - 'pattern': filtro — precisa de um padrão de força (engolfo, martelo/estrela cadente, candle de força, estrela da manhã/tarde)
//  - 'conf':    o padrão entra como mais uma confirmação (conta para o mínimo de confirmações)
function candlePattern(S, i, dir) {
  const o = S.open[i], c = S.close[i], h = S.high[i], l = S.low[i], a = S.atr[i] || 0;
  const range = h - l;
  if (!(range > 0)) return null;
  const body = Math.abs(c - o), up = dir > 0;
  const bull = up ? c > o : c < o;                                  // candle na cor do lado
  const wickFor = up ? Math.min(o, c) - l : h - Math.max(o, c);     // pavio que mostra rejeição a favor
  const wickAgainst = up ? h - Math.max(o, c) : Math.min(o, c) - l;
  const po = S.open[i - 1], pc = S.close[i - 1];
  const prevAgainst = up ? pc < po : pc > po;
  if (bull && prevAgainst && body > Math.abs(pc - po) && (up ? c >= po && o <= pc : c <= po && o >= pc)) return up ? 'Engolfo de alta' : 'Engolfo de baixa';
  if (wickFor >= 2 * body && wickAgainst <= Math.max(body, 0.15 * range) && range >= 0.7 * a) return up ? 'Martelo (rejeição embaixo)' : 'Estrela cadente (rejeição em cima)';
  if (bull && body >= 0.6 * range && range >= 1.0 * a) return up ? 'Candle de força comprador' : 'Candle de força vendedor';
  const o2 = S.open[i - 2], c2 = S.close[i - 2];
  if (bull && (up ? c2 < o2 : c2 > o2) && Math.abs(c2 - o2) >= 0.6 * a && Math.abs(pc - po) <= 0.35 * Math.abs(c2 - o2) &&
      (up ? c > (o2 + c2) / 2 : c < (o2 + c2) / 2)) return up ? 'Estrela da manhã' : 'Estrela da tarde';
  return null;
}

function candleChecks(S, i, dir, mode) {
  if (!mode) return [];
  const up = dir > 0, c = S.close[i], h = S.high[i], l = S.low[i], o = S.open[i];
  const range = (h - l) || 1;
  if (mode === 'close') {
    const pos = (c - l) / range; // 0 = fechou na mínima, 1 = na máxima
    const wickAgainst = up ? h - Math.max(o, c) : Math.min(o, c) - l;
    return [
      { group: 'filtro', label: `Candle fechou no terço ${up ? 'de cima' : 'de baixo'} (sem rejeição contra)`, ok: (up ? pos >= 0.66 : pos <= 0.34) && wickAgainst <= 0.4 * range }
    ];
  }
  const name = candlePattern(S, i, dir);
  return [{ group: mode === 'pattern' ? 'filtro' : 'confirmação', label: name ? `Leitura do candle: ${name}` : `Leitura do candle: padrão de ${up ? 'alta' : 'baixa'} (engolfo, martelo, força ou estrela)`, ok: !!name }];
}

const htfCheck = (htf, dir, required) => required
  ? { group: 'filtro', label: 'Tendência maior (HTF) a favor', ok: htf === dir }
  : { group: 'filtro', label: 'Tendência maior (HTF) não está contra', ok: htf !== -dir };

function supertrendSide(S, i, htf, dir) {
  const cfg = SIGNAL_CFG.supertrend, up = dir > 0, c = S.close[i];
  const checks = [
    ...(cfg.ema200 ? [{ group: 'filtro', label: `Preço ${up ? 'acima' : 'abaixo'} da EMA 200`, ok: up ? c > S.ema200[i] : c < S.ema200[i] }] : []),
    htfCheck(htf, dir, cfg.htfRequired),
    { group: 'gatilho', label: `Supertrend virou para ${up ? 'ALTA' : 'BAIXA'} neste candle`, ok: S.st.dir[i] === dir && S.st.dir[i - 1] === -dir },
    { group: 'confirmação', label: 'Volume ≥ média de 20', ok: S.volume[i] >= S.volSma[i] },
    { group: 'confirmação', label: 'ADX ≥ 20 (há tendência)', ok: S.adx[i] >= 20 },
    ...candleChecks(S, i, dir, cfg.candle)
  ];
  return finish(dir, checks, cfg.minConf, S.st.line[i], null, S.st.line);
}

function breakoutSide(S, i, htf, dir) {
  const cfg = SIGNAL_CFG.breakout, up = dir > 0, c = S.close[i];
  const lvl = up ? S.dcHigh : S.dcLow;
  const fresh = up ? c > lvl[i] && S.close[i - 1] <= lvl[i - 1] : c < lvl[i] && S.close[i - 1] >= lvl[i - 1];
  const checks = [
    { group: 'filtro', label: `Preço ${up ? 'acima' : 'abaixo'} da EMA 200`, ok: up ? c > S.ema200[i] : c < S.ema200[i] },
    htfCheck(htf, dir, cfg.htfRequired),
    { group: 'gatilho', label: `Fechou ${up ? 'acima da máxima' : 'abaixo da mínima'} dos últimos 20 candles`, ok: fresh },
    { group: 'confirmação', label: 'Volume ≥ média de 20', ok: S.volume[i] >= S.volSma[i] },
    { group: 'confirmação', label: 'ADX ≥ 20 (há tendência)', ok: S.adx[i] >= 20 },
    ...candleChecks(S, i, dir, cfg.candle)
  ];
  return finish(dir, checks, cfg.minConf, c - dir * cfg.stopAtr * S.atr[i], null, up ? S.low10 : S.high10);
}

function pullbackSide(S, i, htf, dir) {
  const cfg = SIGNAL_CFG.pullback, up = dir > 0, c = S.close[i], a = S.atr[i];
  const gt = (x, y) => x != null && y != null && (up ? x > y : x < y);
  let touched = false;
  for (let k = i - 2; k <= i; k++) {
    if (up ? S.low[k] <= S.ema21[k] + 0.25 * S.atr[k] : S.high[k] >= S.ema21[k] - 0.25 * S.atr[k]) touched = true;
  }
  const r = S.rsi[i];
  const checks = [
    { group: 'filtro', label: `ADX ≥ ${cfg.adx} (tendência forte)`, ok: S.adx[i] >= cfg.adx },
    { group: 'filtro', label: `Preço ${up ? 'acima' : 'abaixo'} da EMA 200`, ok: gt(c, S.ema200[i]) },
    { group: 'filtro', label: `EMA 21 ${up ? 'acima' : 'abaixo'} da EMA 50`, ok: gt(S.ema21[i], S.ema50[i]) },
    { group: 'filtro', label: `${up ? '+DI > −DI' : '−DI > +DI'} (força direcional)`, ok: up ? S.plusDI[i] > S.minusDI[i] : S.minusDI[i] > S.plusDI[i] },
    htfCheck(htf, dir, cfg.htfRequired),
    { group: 'gatilho', label: 'Pullback até a EMA 21 (últimos 3 candles)', ok: touched },
    { group: 'gatilho', label: `Candle ${up ? 'de alta fechando acima' : 'de baixa fechando abaixo'} da EMA 9`, ok: gt(c, S.ema9[i]) && gt(c, S.open[i]) },
    { group: 'confirmação', label: `Histograma MACD ${up ? 'subindo' : 'caindo'}`, ok: gt(S.macd.hist[i], S.macd.hist[i - 1]) },
    { group: 'confirmação', label: `RSI em ${up ? 'força (45–70)' : 'fraqueza (30–55)'}`, ok: up ? r >= 45 && r <= 70 : r >= 30 && r <= 55 },
    { group: 'confirmação', label: S.vwap[i] == null ? 'VWAP (não se aplica neste TF)' : `Preço ${up ? 'acima' : 'abaixo'} da VWAP`, ok: gt(c, S.vwap[i]) },
    { group: 'confirmação', label: 'Volume ≥ média de 20', ok: S.volume[i] >= S.volSma[i] },
    ...candleChecks(S, i, dir, cfg.candle)
  ];
  const risk = cfg.stopAtr * a;
  return finish(dir, checks, cfg.minConf, c - dir * risk, c + dir * risk * cfg.targetR);
}

// Reversão: estrutura contrária (topos e fundos na direção oposta) quebrada por fechamento (CHoCH),
// com divergência no RSI no último swing. Usa só swings já confirmados.
function reversalSide(S, i, htf, dir) {
  const cfg = SIGNAL_CFG.reversal, up = dir > 0, c = S.close[i], a = S.atr[i];
  const st = S.struct;
  const h1 = st.sh1[i], h2 = st.sh2[i], l1 = st.sl1[i], l2 = st.sl2[i];
  const ok = h1 && h2 && l1 && l2;
  const priorTrend = ok && (up ? h1.price < h2.price && l1.price < l2.price : h1.price > h2.price && l1.price > l2.price);
  const level = ok ? (up ? h1.price : l1.price) : null;
  const choch = ok && (up ? c > level && S.close[i - 1] <= level : c < level && S.close[i - 1] >= level);
  const div = ok && (up
    ? l1.price < l2.price && S.rsi[l1.i] > S.rsi[l2.i]
    : h1.price > h2.price && S.rsi[h1.i] < S.rsi[h2.i]);
  const anchor = ok ? (up ? l1.price - 0.2 * a : h1.price + 0.2 * a) : c - dir * 2 * a;
  const dist = Math.max(Math.abs(c - anchor), 0.5 * a);
  const checks = [
    { group: 'filtro', label: `Estrutura anterior de ${up ? 'BAIXA (topos e fundos caindo)' : 'ALTA (topos e fundos subindo)'}`, ok: priorTrend },
    { group: 'filtro', label: 'Stop até 4 ATR (risco controlado)', ok: dist <= 4 * a },
    ...(cfg.htfRequired ? [htfCheck(htf, dir, true)] : []),
    { group: 'gatilho', label: `CHoCH: fechou ${up ? 'acima do último topo' : 'abaixo do último fundo'}`, ok: choch },
    { group: 'confirmação', label: `Divergência ${up ? 'de alta' : 'de baixa'} no RSI`, ok: div },
    { group: 'confirmação', label: 'Volume ≥ média de 20', ok: S.volume[i] >= S.volSma[i] },
    ...(cfg.htfRequired ? [] : [{ group: 'confirmação', label: 'Tendência maior (HTF) não está contra', ok: htf !== -dir }]),
    ...candleChecks(S, i, dir, cfg.candle)
  ];
  return finish(dir, checks, cfg.minConf, c - dir * dist, c + dir * dist * cfg.targetR);
}

// ===================================================================================================
// Estratégias clássicas portadas do material de estudo (je-suis-tm/quant-trading, Apache-2.0), 20/10/2026.
// Reescritas no padrão deste arquivo; cada uma tem a hipótese ao lado. Em estudo: só entram num robô depois
// de passar no método da skill estudo-estrategias (60/40, walk-forward, ≥100 operações, vizinhos, Monte Carlo).
// ===================================================================================================
Object.assign(SIGNAL_CFG, {
  psar:    { step: 0.02, maxStep: 0.2, htfRequired: false, minConf: 0 },
  heikin:  { htfRequired: false, stopAtr: 2, minConf: 0 },
  dthrust: { days: 4, k: 0.5, htfRequired: false, minConf: 0 },
  london:  { targetR: 1.5, htfRequired: false, minConf: 0 },
  bbrev:   { rsiMax: 35, adxMax: 25, minConf: 0 },
  macdx:   { htfRequired: true, stopAtr: 2, minConf: 0 }
});
Object.assign(STRATEGIES, {
  psar:    { name: 'Parabolic SAR', desc: 'Entra quando o SAR vira para o lado da tendência longa; o próprio SAR é o stop móvel.', maxBars: 2000, side: psarSide },
  heikin:  { name: 'Virada Heikin-Ashi', desc: 'Entra na primeira vela Heikin-Ashi forte (sem pavio contra) depois de velas contrárias; stop móvel na mínima de 3 velas.', maxBars: 2000, side: heikinSide },
  dthrust: { name: 'Dual Thrust', desc: 'Rompimento de volatilidade: compra quando o preço passa da abertura do dia + metade da faixa dos últimos dias.', maxBars: 2000, side: dthrustSide },
  london:  { name: 'Rompimento de Londres', desc: 'Faixa da madrugada asiática (00h–07h UTC) rompida entre 07h e 12h UTC. Alvo 1,5× o risco; sai no fim do dia.', maxBars: 12, side: londonSide },
  bbrev:   { name: 'Volta à média (Bollinger)', desc: 'Sem tendência forte, compra quando o preço volta para dentro da banda de baixo com RSI fraco. Alvo na média de 20.', maxBars: 30, side: bbrevSide },
  macdx:   { name: 'Cruzamento do MACD', desc: 'Linha do MACD cruza a de sinal a favor da EMA 200 e da tendência maior; stop móvel na mínima de 10.', maxBars: 2000, side: macdxSide }
});

// Séries extras calculadas uma vez por conjunto de candles e guardadas no próprio S
function extraSeries(S) {
  if (S._extra) return S._extra;
  const n = S.close.length, o = S.open, h = S.high, l = S.low, c = S.close;
  // Parabolic SAR (Wilder)
  const cfg = SIGNAL_CFG.psar;
  const sar = new Array(n).fill(null), sdir = new Array(n).fill(null);
  if (n > 2) {
    let up = c[1] >= c[0], ep = up ? h[1] : l[1], af = cfg.step, s = up ? l[0] : h[0];
    for (let i = 1; i < n; i++) {
      if (i > 1) {
        s = s + af * (ep - s);
        s = up ? Math.min(s, l[i - 1], l[i - 2]) : Math.max(s, h[i - 1], h[i - 2]);
        if (up ? l[i] < s : h[i] > s) { up = !up; s = ep; ep = up ? h[i] : l[i]; af = cfg.step; }
        else if (up ? h[i] > ep : l[i] < ep) { ep = up ? h[i] : l[i]; af = Math.min(cfg.maxStep, af + cfg.step); }
      }
      sar[i] = s; sdir[i] = up ? 1 : -1;
    }
  }
  // Heikin-Ashi
  const haO = new Array(n).fill(null), haC = new Array(n).fill(null), haH = new Array(n).fill(null), haL = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    haC[i] = (o[i] + h[i] + l[i] + c[i]) / 4;
    haO[i] = i ? (haO[i - 1] + haC[i - 1]) / 2 : (o[i] + c[i]) / 2;
    haH[i] = Math.max(h[i], haO[i], haC[i]); haL[i] = Math.min(l[i], haO[i], haC[i]);
  }
  const low3 = lowestPrev(l, 3), high3 = highestPrev(h, 3);
  // Dias (UTC): abertura do dia de cada candle e faixa Dual Thrust dos dias anteriores
  const dayIdx = S.time.map(t => Math.floor(t / 86400));
  // Extremos do dia ATÉ o candle i (máxima/mínima acumuladas do dia corrente) e em que candle foram FEITOS.
  // O mapa `days` abaixo guarda o dia inteiro; aqui o que importa é o extremo já alcançado no momento do sinal.
  const dayHi = new Array(n).fill(null), dayLo = new Array(n).fill(null);
  const dayHiIdx = new Array(n).fill(null), dayLoIdx = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (i === 0 || dayIdx[i] !== dayIdx[i - 1]) {
      dayHi[i] = h[i]; dayLo[i] = l[i]; dayHiIdx[i] = i; dayLoIdx[i] = i;
    } else {
      dayHi[i] = h[i] >= dayHi[i - 1] ? h[i] : dayHi[i - 1];
      dayHiIdx[i] = h[i] >= dayHi[i - 1] ? i : dayHiIdx[i - 1];
      dayLo[i] = l[i] <= dayLo[i - 1] ? l[i] : dayLo[i - 1];
      dayLoIdx[i] = l[i] <= dayLo[i - 1] ? i : dayLoIdx[i - 1];
    }
  }
  const days = new Map();
  for (let i = 0; i < n; i++) {
    const d = days.get(dayIdx[i]);
    if (!d) days.set(dayIdx[i], { o: o[i], h: h[i], l: l[i], c: c[i] });
    else { d.h = Math.max(d.h, h[i]); d.l = Math.min(d.l, l[i]); d.c = c[i]; }
  }
  // Faixa asiática (00h–07h UTC) de cada dia
  const asia = new Map();
  for (let i = 0; i < n; i++) {
    const hr = new Date(S.time[i] * 1000).getUTCHours();
    if (hr < 7) { const a = asia.get(dayIdx[i]) || { h: -Infinity, l: Infinity, k: 0 }; a.h = Math.max(a.h, h[i]); a.l = Math.min(a.l, l[i]); a.k++; asia.set(dayIdx[i], a); }
  }
  return (S._extra = { sar, sdir, haO, haC, haH, haL, low3, high3, dayIdx, days, asia,
    dayHi, dayLo, dayHiIdx, dayLoIdx,
    // Médias simples 9/20/50 do fechamento (cruzamento de médias)
    sma9: sma(c, 9), sma20: sma(c, 20), sma50: sma(c, 50) });
}

// Hipótese: o SAR acompanha a tendência e só vira quando ela acaba; virar a favor da EMA 200 pega tendências novas.
function psarSide(S, i, htf, dir) {
  const cfg = SIGNAL_CFG.psar, up = dir > 0, c = S.close[i], X = extraSeries(S);
  const checks = [
    { group: 'filtro', label: `Preço ${up ? 'acima' : 'abaixo'} da EMA 200`, ok: up ? c > S.ema200[i] : c < S.ema200[i] },
    htfCheck(htf, dir, cfg.htfRequired),
    { group: 'gatilho', label: `Parabolic SAR virou para ${up ? 'ALTA' : 'BAIXA'} neste candle`, ok: X.sdir[i] === dir && X.sdir[i - 1] === -dir },
    { group: 'confirmação', label: 'ADX ≥ 20 (há tendência)', ok: S.adx[i] >= 20 },
    { group: 'confirmação', label: 'Volume ≥ média de 20', ok: S.volume[i] >= S.volSma[i] },
    ...candleChecks(S, i, dir, cfg.candle)
  ];
  return finish(dir, checks, cfg.minConf, X.sar[i], null, X.sar);
}

// Hipótese: a vela Heikin-Ashi tira o ruído; a primeira vela forte (sem pavio contra) depois de velas contrárias marca o início do movimento.
function heikinSide(S, i, htf, dir) {
  const cfg = SIGNAL_CFG.heikin, up = dir > 0, c = S.close[i], X = extraSeries(S), a = S.atr[i];
  const col = k => Math.sign(X.haC[k] - X.haO[k]);
  const strong = up ? X.haL[i] >= Math.min(X.haO[i], X.haC[i]) - 1e-12 : X.haH[i] <= Math.max(X.haO[i], X.haC[i]) + 1e-12;
  const flip = col(i - 1) === -dir && col(i - 2) === -dir && col(i) === dir;
  const checks = [
    { group: 'filtro', label: `Preço ${up ? 'acima' : 'abaixo'} da EMA 200`, ok: up ? c > S.ema200[i] : c < S.ema200[i] },
    htfCheck(htf, dir, cfg.htfRequired),
    { group: 'gatilho', label: `Heikin-Ashi virou ${up ? 'de alta' : 'de baixa'} (2 velas contrárias antes)`, ok: flip },
    { group: 'gatilho', label: `Vela Heikin-Ashi forte (sem pavio ${up ? 'embaixo' : 'em cima'})`, ok: strong },
    { group: 'confirmação', label: 'ADX ≥ 20 (há tendência)', ok: S.adx[i] >= 20 },
    ...candleChecks(S, i, dir, cfg.candle)
  ];
  return finish(dir, checks, cfg.minConf, c - dir * cfg.stopAtr * a, null, up ? X.low3 : X.high3);
}

// Hipótese: quando o preço se afasta da abertura do dia mais que metade da faixa recente, o dia tende a seguir naquela direção.
function dthrustSide(S, i, htf, dir) {
  const cfg = SIGNAL_CFG.dthrust, up = dir > 0, c = S.close[i], X = extraSeries(S), a = S.atr[i];
  const d = X.dayIdx[i], today = X.days.get(d);
  const prev = [];
  for (let k = 1; k <= cfg.days; k++) { const p = X.days.get(d - k); if (p) prev.push(p); }
  let lvl = null, opp = null;
  if (prev.length === cfg.days && today) {
    const HH = Math.max(...prev.map(p => p.h)), LL = Math.min(...prev.map(p => p.l));
    const HC = Math.max(...prev.map(p => p.c)), LC = Math.min(...prev.map(p => p.c));
    const range = Math.max(HH - LC, HC - LL);
    lvl = today.o + dir * cfg.k * range; opp = today.o - dir * cfg.k * range;
  }
  const fresh = lvl != null && (up ? c > lvl && S.close[i - 1] <= lvl : c < lvl && S.close[i - 1] >= lvl);
  const stop = opp != null && Math.abs(c - opp) <= 3 * a ? opp : c - dir * 2 * a;
  const checks = [
    htfCheck(htf, dir, cfg.htfRequired),
    { group: 'gatilho', label: `Passou da abertura do dia ${up ? 'mais' : 'menos'} ${cfg.k} × a faixa de ${cfg.days} dias`, ok: fresh },
    { group: 'confirmação', label: `Preço ${up ? 'acima' : 'abaixo'} da EMA 200`, ok: up ? c > S.ema200[i] : c < S.ema200[i] },
    { group: 'confirmação', label: 'Volume ≥ média de 20', ok: S.volume[i] >= S.volSma[i] },
    ...candleChecks(S, i, dir, cfg.candle)
  ];
  return finish(dir, checks, cfg.minConf, stop, null, up ? S.low10 : S.high10);
}

// Hipótese: a faixa da madrugada asiática concentra o "acordo" da noite; a liquidez de Londres rompe essa faixa e puxa o dia.
function londonSide(S, i, htf, dir) {
  const cfg = SIGNAL_CFG.london, up = dir > 0, c = S.close[i], X = extraSeries(S), a = S.atr[i];
  const hr = new Date(S.time[i] * 1000).getUTCHours();
  const as = X.asia.get(X.dayIdx[i]);
  const ok = !!as && as.k >= 3 && hr >= 7 && hr < 12;
  const lvl = ok ? (up ? as.h : as.l) : null;
  const fresh = ok && (up ? c > lvl && S.close[i - 1] <= lvl : c < lvl && S.close[i - 1] >= lvl);
  const stopLvl = ok ? (up ? as.l : as.h) : c - dir * 2 * a;
  const dist = Math.min(Math.max(Math.abs(c - stopLvl), 0.5 * a), 3 * a);
  const checks = [
    htfCheck(htf, dir, cfg.htfRequired),
    { group: 'filtro', label: 'Entre 07h e 12h UTC (abertura de Londres)', ok },
    { group: 'gatilho', label: `Rompeu a ${up ? 'máxima' : 'mínima'} da madrugada asiática`, ok: fresh },
    { group: 'confirmação', label: 'Volume ≥ média de 20', ok: S.volume[i] >= S.volSma[i] },
    ...candleChecks(S, i, dir, cfg.candle)
  ];
  return finish(dir, checks, cfg.minConf, c - dir * dist, c + dir * dist * cfg.targetR);
}

// Hipótese: sem tendência forte (ADX baixo), o preço que sai da banda e volta para dentro tende a ir até a média.
function bbrevSide(S, i, htf, dir) {
  const cfg = SIGNAL_CFG.bbrev, up = dir > 0, c = S.close[i], a = S.atr[i], bb = S.bb;
  const band = up ? bb.lower : bb.upper;
  const reentry = band[i - 1] != null && (up ? S.close[i - 1] < band[i - 1] && c > band[i] : S.close[i - 1] > band[i - 1] && c < band[i]);
  const rsiOk = up ? S.rsi[i - 1] <= cfg.rsiMax : S.rsi[i - 1] >= 100 - cfg.rsiMax;
  const ext = up ? Math.min(S.low[i], S.low[i - 1], S.low[i - 2]) : Math.max(S.high[i], S.high[i - 1], S.high[i - 2]);
  const dist = Math.max(Math.abs(c - ext) + 0.2 * a, 0.5 * a);
  const target = bb.mid[i];
  const checks = [
    { group: 'filtro', label: `ADX < ${cfg.adxMax} (sem tendência forte)`, ok: S.adx[i] < cfg.adxMax },
    { group: 'filtro', label: 'Alvo (média de 20) a pelo menos 1× o risco', ok: target != null && dir * (target - c) >= dist },
    { group: 'gatilho', label: `Voltou para dentro da banda ${up ? 'de baixo' : 'de cima'}`, ok: reentry },
    { group: 'gatilho', label: `RSI ${up ? 'fraco' : 'forte'} no candle anterior (${up ? '≤ ' + cfg.rsiMax : '≥ ' + (100 - cfg.rsiMax)})`, ok: rsiOk },
    { group: 'confirmação', label: 'Tendência maior (HTF) não está contra', ok: htf !== -dir },
    ...candleChecks(S, i, dir, cfg.candle)
  ];
  return finish(dir, checks, cfg.minConf, c - dir * dist, target);
}

// Hipótese (controle): o cruzamento do MACD a favor da tendência longa pega a retomada do movimento.
function macdxSide(S, i, htf, dir) {
  const cfg = SIGNAL_CFG.macdx, up = dir > 0, c = S.close[i], m = S.macd;
  const cross = m.line[i - 1] != null && m.signal[i - 1] != null &&
    (up ? m.line[i] > m.signal[i] && m.line[i - 1] <= m.signal[i - 1] : m.line[i] < m.signal[i] && m.line[i - 1] >= m.signal[i - 1]);
  const checks = [
    { group: 'filtro', label: `Preço ${up ? 'acima' : 'abaixo'} da EMA 200`, ok: up ? c > S.ema200[i] : c < S.ema200[i] },
    htfCheck(htf, dir, cfg.htfRequired),
    { group: 'gatilho', label: `MACD cruzou a linha de sinal para ${up ? 'cima' : 'baixo'}`, ok: cross },
    { group: 'confirmação', label: 'ADX ≥ 20 (há tendência)', ok: S.adx[i] >= 20 },
    ...candleChecks(S, i, dir, cfg.candle)
  ];
  return finish(dir, checks, cfg.minConf, c - dir * cfg.stopAtr * S.atr[i], null, up ? S.low10 : S.high10);
}

// ===================================================================================================
// Estratégia do amigo (20/10/2026): "dois candles da abertura na mesma cor"
// Hipótese: na abertura do dia (9h–11h de Brasília) entra o fluxo do Brasil e, em seguida, o dos EUA;
// se as duas primeiras horas fecham na mesma cor, o dia tende a seguir naquela direção.
// Regra: candle de 1h das 9h–10h e das 10h–11h (Brasília = UTC−3) verdes → compra às 11h; vermelhos → venda.
// Stop além da mínima/máxima dos dois candles (entre 0,5 e 3 ATR); alvo targetR × risco (0 = sem alvo);
// sai no máximo 12 candles depois (23h de Brasília).
// ===================================================================================================
Object.assign(SIGNAL_CFG, { twogreen: { hourUTC: 12, targetR: 1.5, htfRequired: false, minConf: 0 } });
Object.assign(STRATEGIES, {
  twogreen: { name: 'Dois candles da abertura', desc: 'Candles de 1h das 9h–10h e 10h–11h (Brasília) na mesma cor: entra a favor às 11h. Stop além dos dois candles, alvo 1,5× o risco, sai até as 23h.', maxBars: 12, side: twogreenSide }
});

function twogreenSide(S, i, htf, dir) {
  const cfg = SIGNAL_CFG.twogreen, up = dir > 0, c = S.close[i], a = S.atr[i];
  const hr = new Date(S.time[i] * 1000).getUTCHours(), hrPrev = new Date(S.time[i - 1] * 1000).getUTCHours();
  const window = hrPrev === cfg.hourUTC && hr === (cfg.hourUTC + 1) % 24;
  const col = k => Math.sign(S.close[k] - S.open[k]);
  const ext = up ? Math.min(S.low[i], S.low[i - 1]) : Math.max(S.high[i], S.high[i - 1]);
  const dist = Math.min(Math.max(Math.abs(c - ext), 0.5 * a), 3 * a);
  const brt = h => String((h + 21) % 24).padStart(2, '0');
  const checks = [
    { group: 'filtro', label: `Candles das ${brt(cfg.hourUTC)}h e ${brt(cfg.hourUTC + 1)}h (Brasília)`, ok: window },
    ...(cfg.htfRequired ? [htfCheck(htf, dir, true)] : []),
    { group: 'gatilho', label: `Os dois candles fecharam ${up ? 'verdes' : 'vermelhos'}`, ok: window && col(i) === dir && col(i - 1) === dir },
    { group: 'confirmação', label: 'Volume ≥ média de 20', ok: S.volume[i] >= S.volSma[i] },
    ...candleChecks(S, i, dir, cfg.candle)
  ];
  return finish(dir, checks, cfg.minConf, c - dir * dist, cfg.targetR ? c + dir * dist * cfg.targetR : null);
}

// ===================================================================================================
// Estratégias novas (11/11/2026): ideias do usuário e de um amigo. Ainda NÃO entram em nenhum robô ao
// vivo — vão ser medidas no replay (tools/replay_cmp2.js) antes de qualquer uso.
// ===================================================================================================
Object.assign(SIGNAL_CFG, {
  macross: { htfRequired: false, minConf: 0, stopAtr: 2 },
  dayext:  { htfRequired: false, minConf: 0, stopAtr: 2 }
});
Object.assign(STRATEGIES, {
  macross: { name: 'Cruzamento de médias 9/20/50', desc: 'Entra quando a média simples de 9 cruza a de 20, com a média de 50 subindo (compra) ou descendo (venda) e o preço do lado certo da EMA 200. Stop de 2 ATR, sem alvo fixo.', maxBars: 48, side: macrossSide },
  dayext:  { name: 'Topo/fundo do dia (reversão)', desc: 'Entra no contrário de quem tomou o extremo do dia: venda quando o fechamento está no topo do dia e o momentum vira, compra no fundo do dia. Só opera sem tendência forte (ADX < 25). Stop de 2 ATR, sem alvo fixo.', maxBars: 48, side: dayextSide }
});

// Hipótese (ideia do amigo do usuário): médias móveis que cruzam invertem o fluxo. O cruzamento da
// média de 9 pela de 20 é o gatilho; a média de 50 (subindo ou descendo) diz para que lado o fluxo virou.
function macrossSide(S, i, htf, dir) {
  const cfg = SIGNAL_CFG.macross, up = dir > 0, c = S.close[i], X = extraSeries(S);
  const s9 = X.sma9, s20 = X.sma20, s50 = X.sma50;
  // Cruzamento no candle atual: a de 9 passa por cima (ou por baixo) da de 20
  const cross = s9[i] != null && s20[i] != null && s9[i - 1] != null && s20[i - 1] != null &&
    (up ? s9[i] > s20[i] && s9[i - 1] <= s20[i - 1] : s9[i] < s20[i] && s9[i - 1] >= s20[i - 1]);
  // Tendência da média de 50 (o filtro que confirma o lado do fluxo)
  const trend50 = s50[i] != null && s50[i - 1] != null && (up ? s50[i] > s50[i - 1] : s50[i] < s50[i - 1]);
  const checks = [
    { group: 'filtro', label: `Preço ${up ? 'acima' : 'abaixo'} da EMA 200`, ok: up ? c > S.ema200[i] : c < S.ema200[i] },
    { group: 'filtro', label: `Média de 50 ${up ? 'subindo' : 'descendo'} (tendência coerente)`, ok: trend50 },
    htfCheck(htf, dir, cfg.htfRequired),
    { group: 'gatilho', label: `Média de 9 cruzou a de 20 para ${up ? 'cima' : 'baixo'}`, ok: cross },
    { group: 'confirmação', label: 'Volume ≥ média de 20', ok: S.volume[i] >= S.volSma[i] },
    { group: 'confirmação', label: 'ADX ≥ 20 (há tendência)', ok: S.adx[i] >= 20 },
    ...candleChecks(S, i, dir, cfg.candle)
  ];
  return finish(dir, checks, cfg.minConf, c - dir * cfg.stopAtr * S.atr[i], null);
}

// Hipótese (ideia do amigo do usuário): quando o preço toma o topo (ou o fundo) do dia, ele costuma
// virar. A entrada é NO CONTRÁRIO de quem tomou o extremo. Em tendência forte esse "topo do dia"
// é só continuação, por isso a estratégia só opera com ADX baixo.
function dayextSide(S, i, htf, dir) {
  const cfg = SIGNAL_CFG.dayext, up = dir > 0, c = S.close[i], X = extraSeries(S), a = S.atr[i];
  const EDGE = 0.45;   // fração da amplitude do dia que conta como "no extremo"
  const hi = X.dayHi[i], lo = X.dayLo[i], rng = hi - lo;
  // Onde o fechamento está dentro da amplitude do dia (0 = fundo do dia, 1 = topo do dia)
  const pos = rng > 0 ? (c - lo) / rng : 0.5;
  // O extremo do dia (até este candle) e em que candle ele foi feito
  const extremeIdx = up ? X.dayLoIdx[i] : X.dayHiIdx[i];
  const recent = extremeIdx != null && extremeIdx >= i - 2;                 // extremo tomado nas últimas 3 velas
  const atExtreme = up ? pos <= EDGE : pos >= 1 - EDGE;                     // fechamento colado no extremo do dia
  const momTurn = up ? S.macd.hist[i] > S.macd.hist[i - 1] : S.macd.hist[i] < S.macd.hist[i - 1];
  const reject = up ? c > S.open[i] : c < S.open[i];                         // candle fechou contra o extremo
  const shortRef = up ? c > X.low3[i] : c < X.high3[i];                     // referência curta (3 velas)
  const checks = [
    { group: 'filtro', label: 'ADX < 25 (sem tendência forte: em tendência o topo do dia é continuação, não virada)', ok: S.adx[i] < 25 },
    { group: 'filtro', label: 'O dia já tem amplitude (topo e fundo do dia em velas diferentes, a pelo menos 1 ATR)', ok: rng >= a && X.dayHiIdx[i] !== X.dayLoIdx[i] },
    ...(cfg.htfRequired ? [htfCheck(htf, dir, true)] : []),
    { group: 'gatilho', label: up ? `Fechou no fundo do dia (nos ${EDGE * 100}% de baixo da amplitude)` : `Fechou no topo do dia (nos ${EDGE * 100}% de cima da amplitude)`, ok: atExtreme },
    { group: 'gatilho', label: up ? 'O fundo do dia foi tomado nas últimas 3 velas' : 'O topo do dia foi tomado nas últimas 3 velas', ok: recent },
    { group: 'gatilho', label: up ? 'O momento virou: MACD subindo' : 'O momento virou: MACD descendo', ok: momTurn },
    { group: 'gatilho', label: up ? 'O candle fechou acima da abertura (rejeição do fundo)' : 'O candle fechou abaixo da abertura (rejeição do topo)', ok: reject },
    { group: 'confirmação', label: 'Divergência do RSI (o RSI do candle atual virou contra o preço)', ok: up ? S.rsi[i] > S.rsi[i - 1] : S.rsi[i] < S.rsi[i - 1] },
    { group: 'confirmação', label: 'Volume ≥ média de 20', ok: S.volume[i] >= S.volSma[i] },
    { group: 'confirmação', label: up ? 'Passou a mínima das últimas 3 velas (referência curta)' : 'Perdeu a máxima das últimas 3 velas (referência curta)', ok: shortRef },
    ...(cfg.htfRequired ? [] : [{ group: 'confirmação', label: 'Tendência maior (HTF) não está contra', ok: htf !== -dir }]),
    ...candleChecks(S, i, dir, cfg.candle)
  ];
  return finish(dir, checks, cfg.minConf, c - dir * cfg.stopAtr * a, null);
}
