// js/wyckoff.js — Leitura de fase de Wyckoff (contexto, não entra no score)
// Lateralização = range dos últimos 40 candles estreito em relação ao ATR.
// A direção do movimento ANTERIOR ao range separa acumulação de distribuição.
// Spring / upthrust = rompimento falso da borda do range nos últimos 5 candles.

const WY_RANGE = 40;

function detectWyckoffPhase(candles, S) {
  const n = S.close.length;
  if (n < WY_RANGE * 2 + 10 || S.ema50[n - 1] == null) return phaseUnknown();

  const a = S.atr[n - 1];
  const last = S.close[n - 1];
  const body = { from: n - WY_RANGE, to: n - 6 }; // range sem os últimos 5 candles
  let rHigh = -Infinity, rLow = Infinity;
  for (let i = body.from; i <= body.to; i++) { rHigh = Math.max(rHigh, S.high[i]); rLow = Math.min(rLow, S.low[i]); }
  const widthAtr = (rHigh - rLow) / a;

  const prior = (S.close[n - WY_RANGE] - S.close[n - 2 * WY_RANGE]) / S.close[n - 2 * WY_RANGE];
  const volIn  = avg(S.volume, n - WY_RANGE, n - 1);
  const volOut = avg(S.volume, n - 2 * WY_RANGE, n - WY_RANGE - 1);
  const volTxt = `volume ${volIn >= volOut ? 'maior' : 'menor'} que antes (${(volIn / volOut).toFixed(2)}×)`;

  let lo5 = Infinity, hi5 = -Infinity;
  for (let i = n - 5; i < n; i++) { lo5 = Math.min(lo5, S.low[i]); hi5 = Math.max(hi5, S.high[i]); }
  const spring   = lo5 < rLow && last > rLow;
  const upthrust = hi5 > rHigh && last < rHigh;

  const e50 = S.ema50[n - 1], e50Prev = S.ema50[n - 11];
  const isRange = widthAtr <= 10;

  if (isRange && prior < 0) {
    return {
      phase: spring ? 'Acumulação — Spring' : 'Acumulação',
      color: '#2ebd85',
      desc: `Lateral depois de queda (range de ${widthAtr.toFixed(1)} ATR), ${volTxt}.${spring ? ' Fundo do range rompido e recuperado.' : ''}`,
      action: spring ? 'Spring confirmado: compra ganha força acima de ' + fmtUsd(rLow) : 'Aguardar rompimento de ' + fmtUsd(rHigh) + ' ou um spring abaixo de ' + fmtUsd(rLow),
      score: spring ? 2 : 1
    };
  }
  if (isRange && prior > 0) {
    return {
      phase: upthrust ? 'Distribuição — Upthrust' : 'Distribuição',
      color: '#e09030',
      desc: `Lateral depois de alta (range de ${widthAtr.toFixed(1)} ATR), ${volTxt}.${upthrust ? ' Topo do range rompido e devolvido.' : ''}`,
      action: upthrust ? 'Upthrust confirmado: venda ganha força abaixo de ' + fmtUsd(rHigh) : 'Atenção à perda de ' + fmtUsd(rLow) + ' (início de markdown)',
      score: upthrust ? -2 : -1
    };
  }
  if (last > e50 && e50 > e50Prev) {
    return {
      phase: 'Markup (alta)', color: '#4a90d9',
      desc: `Preço acima da EMA 50, que está subindo. ${volTxt}.`,
      action: 'Buscar compras em pullback (EMA 21 / suporte)', score: 2
    };
  }
  if (last < e50 && e50 < e50Prev) {
    return {
      phase: 'Markdown (baixa)', color: '#e04060',
      desc: `Preço abaixo da EMA 50, que está caindo. ${volTxt}.`,
      action: 'Evitar compras; vendas em repique até a EMA 21 / resistência', score: -2
    };
  }
  return phaseUnknown();
}

function avg(arr, from, to) {
  let s = 0;
  for (let i = from; i <= to; i++) s += arr[i];
  return s / (to - from + 1);
}

function fmtUsd(n) {
  return '$' + n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function phaseUnknown() {
  return {
    phase: 'Indefinido', color: '#555a6a',
    desc: 'Sem padrão de Wyckoff claro no momento',
    action: 'Aguardar formação de range ou tendência', score: 0
  };
}
