// js/backtest.js — Mede a assertividade real de uma estratégia nos candles carregados
//
// Regras da simulação:
//  - sinal no fechamento do candle i, entrada na ABERTURA do candle seguinte (sem olhar o futuro)
//  - stop móvel (trail) só aperta, usando o valor do candle anterior
//  - se o candle abre além do stop, sai na abertura (gap); stop e alvo no mesmo candle conta como stop
//  - sem sair em maxBars candles, sai no fechamento
//  - uma operação por vez; desconta a taxa de entrada e saída

var FEE_PER_SIDE = 0.0005; // 0,05% (futuros, taker). Spot sem desconto = 0,10%. var: os estudos de Forex trocam pela taxa de corretora

function runBacktest(candles, S, trendAt, lastIdx, key) {
  const trades = [];
  let i = 201;
  while (i < lastIdx) {
    const sig = evaluateSignal(S, i, trendAt(candles[i].closeTime), key);
    if (sig.direction === 'NEUTRO') { i++; continue; }

    const dir = sig.side;
    const entry = S.open[i + 1];
    const target = sig.target;
    let stop = sig.stop;
    // Abriu além do stop ou do alvo: a operação não existe
    if (dir > 0 ? entry <= stop || (target != null && entry >= target) : entry >= stop || (target != null && entry <= target)) { i++; continue; }

    const risk = Math.abs(entry - stop);
    const feeR = entry * FEE_PER_SIDE * 2 / risk;
    let result = null, j = i + 1;
    // Saída por tempo (opcional): se em stallBars candles a operação não chegou a stallR a favor, sai no fechamento
    const stallBars = SIGNAL_CFG[key] && SIGNAL_CFG[key].stallBars, stallR = (SIGNAL_CFG[key] && SIGNAL_CFG[key].stallR) || 0.5;
    let best = 0;
    for (; j <= lastIdx && j <= i + sig.maxBars; j++) {
      if (sig.trail && j > i + 1 && sig.trail[j - 1] != null) {
        stop = dir > 0 ? Math.max(stop, sig.trail[j - 1]) : Math.min(stop, sig.trail[j - 1]);
      }
      const hitStop   = dir > 0 ? S.low[j] <= stop : S.high[j] >= stop;
      const hitTarget = target != null && (dir > 0 ? S.high[j] >= target : S.low[j] <= target);
      if (hitStop) {
        const px = dir > 0 ? Math.min(stop, S.open[j]) : Math.max(stop, S.open[j]);
        result = { r: dir * (px - entry) / risk, exit: px, why: 'stop' };
        break;
      }
      if (hitTarget) { result = { r: Math.abs(target - entry) / risk, exit: target, why: 'alvo' }; break; }
      best = Math.max(best, dir * ((dir > 0 ? S.high[j] : S.low[j]) - entry) / risk);
      if (stallBars && j - i >= stallBars && best < stallR) { result = { r: dir * (S.close[j] - entry) / risk, exit: S.close[j], why: 'parada' }; break; }
    }
    if (!result) {
      if (j > lastIdx) {
        trades.push({ open: true, dir, entryIdx: i + 1, entry, stop, target, r: dir * (S.close[lastIdx] - entry) / risk });
        break;
      }
      j = i + sig.maxBars;
      result = { r: dir * (S.close[j] - entry) / risk, exit: S.close[j], why: 'tempo' };
    }
    trades.push({ dir, entryIdx: i + 1, exitIdx: j, entry, stop, target, ...result, r: result.r - feeR });
    i = j + 1;
  }
  return { key, trades, ...summarize(trades.filter(t => !t.open)) };
}

function summarize(closed) {
  const wins = closed.filter(t => t.r > 0), losses = closed.filter(t => t.r <= 0);
  const sumW = wins.reduce((s, t) => s + t.r, 0);
  const sumL = -losses.reduce((s, t) => s + t.r, 0);
  const avgW = wins.length ? sumW / wins.length : 0;
  const avgL = losses.length ? sumL / losses.length : 0;
  return {
    count: closed.length,
    wins: wins.length,
    winRate: closed.length ? wins.length / closed.length : null,
    breakeven: wins.length && avgW + avgL > 0 ? avgL / (avgW + avgL) : null,
    avgWin: avgW,
    profitFactor: sumL > 0 ? sumW / sumL : (sumW > 0 ? Infinity : null),
    totalR: sumW - sumL,
    avgR: closed.length ? (sumW - sumL) / closed.length : null
  };
}
