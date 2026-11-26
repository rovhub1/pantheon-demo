// js/chart.js — Gráfico de velas (TradingView Lightweight Charts v4, arquivo local em vendor/)
// Camadas que podem ser ligadas/desligadas, faixa de tendência, rótulos de estrutura e valores no mouse.

const Charts = (() => {
  const LC = window.LightweightCharts;
  const C = {
    up: '#3DDC84', down: '#FF4D4D', text: '#8A847A', grid: 'rgba(242,237,228,0.05)',
    ema9: '#FFB86B', ema21: '#D08CFF', ema50: '#8EA2FF', ema200: '#F2EDE4',
    bb: 'rgba(242,237,228,0.24)', vwap: '#FFC24B', dc: 'rgba(255,176,0,0.45)', rsi: '#FFB000',
    entry: '#FFB000', neutral: '#8A847A'
  };

  // Camadas: rótulo, cor da legenda e se começa ligada
  const LAYERS = {
    st:        { label: 'Supertrend',          color: C.up,     on: true },
    dc:        { label: 'Canal 20 (rompimento)', color: C.dc,   on: true },
    ema50:     { label: 'EMA 50',              color: C.ema50,  on: true },
    ema200:    { label: 'EMA 200',             color: C.ema200, on: true },
    ema9:      { label: 'EMA 9',               color: C.ema9,   on: false },
    ema21:     { label: 'EMA 21',              color: C.ema21,  on: false },
    bb:        { label: 'Bollinger',           color: C.bb,     on: false },
    vwap:      { label: 'VWAP',                color: C.vwap,   on: false },
    structure: { label: 'Estrutura HH/HL',     color: C.neutral, on: true },
    bots:      { label: 'Operações dos robôs', color: C.entry, on: true },
    trades:    { label: 'Backtest',            color: C.up,     on: false },
    levels:    { label: 'Níveis S/R',          color: C.down,   on: true }
  };

  // O gráfico trabalha em UTC; desloca para mostrar a hora local
  const local = t => t - new Date(t * 1000).getTimezoneOffset() * 60;

  let main, sub, candle, volume, strip, rsiLine;
  const s = {};              // séries de linha por camada
  let on = {};
  let priceLines = [], levelDefs = [];
  let marks = { structure: [], trades: [], bots: [] };
  let idxByTime = new Map();
  let hoverCb = () => {};

  const baseOpts = {
    autoSize: true,
    layout: { background: { color: 'transparent' }, textColor: C.text, fontFamily: "'Geist', 'Segoe UI', sans-serif", fontSize: 12 },
    grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
    rightPriceScale: { borderColor: 'rgba(242,237,228,0.12)', minimumWidth: 84 },
    timeScale: { borderColor: 'rgba(242,237,228,0.12)', timeVisible: true, secondsVisible: false, rightOffset: 8 },
    crosshair: { mode: LC.CrosshairMode.Normal }
  };

  function line(color, width = 1, style = LC.LineStyle.Solid) {
    return main.addLineSeries({
      color, lineWidth: width, lineStyle: style,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false
    });
  }

  function init(mainEl, subEl, saved) {
    on = Object.fromEntries(Object.entries(LAYERS).map(([k, v]) => [k, saved && k in saved ? saved[k] : v.on]));
    main = LC.createChart(mainEl, baseOpts);
    sub  = LC.createChart(subEl, { ...baseOpts, timeScale: { ...baseOpts.timeScale, visible: false } });

    volume = main.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    main.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0.03 } });
    // Faixa fina no rodapé: verde = tendência de alta, vermelho = baixa, cinza = sem tendência
    strip = main.addHistogramSeries({ priceScaleId: 'strip', lastValueVisible: false, priceLineVisible: false });
    main.priceScale('strip').applyOptions({ scaleMargins: { top: 0.975, bottom: 0 } });

    s.bbU = line(C.bb); s.bbM = line(C.bb, 1, LC.LineStyle.Dotted); s.bbL = line(C.bb);
    s.dcH = line(C.dc, 1, LC.LineStyle.Dotted); s.dcL = line(C.dc, 1, LC.LineStyle.Dotted);
    s.vwap = line(C.vwap, 1, LC.LineStyle.Dashed);
    s.ema200 = line(C.ema200, 2); s.ema50 = line(C.ema50, 1.5); s.ema21 = line(C.ema21); s.ema9 = line(C.ema9);
    s.st = line(C.up, 2); // cor por ponto: verde em alta, vermelho em baixa

    candle = main.addCandlestickSeries({
      upColor: C.up, downColor: C.down, borderVisible: false, wickUpColor: C.up, wickDownColor: C.down
    });

    rsiLine = sub.addLineSeries({
      color: C.rsi, lineWidth: 1.5, priceLineVisible: false,
      autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } })
    });
    [70, 50, 30].forEach(v => rsiLine.createPriceLine({
      price: v, color: v === 50 ? 'rgba(120,180,240,0.14)' : 'rgba(120,180,240,0.3)',
      lineWidth: 1, lineStyle: LC.LineStyle.Dashed, axisLabelVisible: v !== 50
    }));
    sub.priceScale('right').applyOptions({ scaleMargins: { top: 0.08, bottom: 0.08 }, minimumWidth: 84 });

    // Mantém os dois gráficos alinhados no zoom/scroll
    let syncing = false;
    const link = (from, to) => from.timeScale().subscribeVisibleLogicalRangeChange(r => {
      if (syncing || !r) return;
      syncing = true; to.timeScale().setVisibleLogicalRange(r); syncing = false;
    });
    link(main, sub); link(sub, main);

    main.subscribeCrosshairMove(p => hoverCb(p.time != null ? idxByTime.get(p.time) ?? null : null));
    applyVisibility();
  }

  const groups = {
    st: () => [s.st], dc: () => [s.dcH, s.dcL], bb: () => [s.bbU, s.bbM, s.bbL],
    ema9: () => [s.ema9], ema21: () => [s.ema21], ema50: () => [s.ema50], ema200: () => [s.ema200], vwap: () => [s.vwap]
  };

  function applyVisibility() {
    for (const [k, g] of Object.entries(groups)) g().forEach(x => x.applyOptions({ visible: on[k] }));
    drawMarkers();
    drawLevels();
  }

  function toggle(key) {
    on[key] = !on[key];
    applyVisibility();
    return { ...on };
  }

  const pt = (t, v) => v == null ? { time: t } : { time: t, value: v };
  const stripColor = (S, i) => {
    if (S.st.dir[i] == null || S.ema200[i] == null) return 'rgba(120,180,240,0.10)';
    if (S.st.dir[i] === 1 && S.close[i] > S.ema200[i]) return 'rgba(61,220,132,0.85)';
    if (S.st.dir[i] === -1 && S.close[i] < S.ema200[i]) return 'rgba(255,77,77,0.85)';
    return 'rgba(147,170,194,0.4)';
  };
  const volColor = c => c.close >= c.open ? 'rgba(61,220,132,0.28)' : 'rgba(255,77,77,0.28)';

  function point(candles, S, i) {
    const t = local(candles[i].time), c = candles[i];
    return {
      candle: { time: t, open: c.open, high: c.high, low: c.low, close: c.close },
      volume: { time: t, value: c.volume, color: volColor(c) },
      strip:  { time: t, value: 1, color: stripColor(S, i) },
      lines: {
        ema9: pt(t, S.ema9[i]), ema21: pt(t, S.ema21[i]), ema50: pt(t, S.ema50[i]), ema200: pt(t, S.ema200[i]),
        bbU: pt(t, S.bb.upper[i]), bbM: pt(t, S.bb.mid[i]), bbL: pt(t, S.bb.lower[i]), vwap: pt(t, S.vwap[i]),
        dcH: pt(t, S.dcHigh[i]), dcL: pt(t, S.dcLow[i]),
        st: S.st.line[i] == null ? { time: t } : { time: t, value: S.st.line[i], color: S.st.dir[i] === 1 ? C.up : C.down }
      },
      rsi: pt(t, S.rsi[i])
    };
  }

  // keepView: preserva o trecho de tempo visível (ex.: quando chega histórico antigo no começo da série)
  function setData(candles, S, keepView = false) {
    const view = keepView ? main.timeScale().getVisibleRange() : null;
    const pts = candles.map((_, i) => point(candles, S, i));
    idxByTime = new Map(pts.map((p, i) => [p.candle.time, i]));
    candle.setData(pts.map(p => p.candle));
    volume.setData(pts.map(p => p.volume));
    strip.setData(pts.map(p => p.strip));
    for (const k of Object.keys(pts[0].lines)) s[k].setData(pts.map(p => p.lines[k]));
    rsiLine.setData(pts.map(p => p.rsi));
    if (view) main.timeScale().setVisibleRange(view);
  }

  // Atualiza só o último candle (ticks do WebSocket)
  function updateLast(candles, S) {
    const i = candles.length - 1;
    const p = point(candles, S, i);
    idxByTime.set(p.candle.time, i);
    candle.update(p.candle); volume.update(p.volume); strip.update(p.strip);
    for (const k of Object.keys(p.lines)) s[k].update(p.lines[k]);
    rsiLine.update(p.rsi);
  }

  // Setas das operações do backtest: verde = ganhou, vermelho = perdeu, cinza = em aberto
  function setTrades(candles, trades) {
    marks.trades = trades.map(t => ({
      time: local(candles[t.entryIdx].time),
      position: t.dir > 0 ? 'belowBar' : 'aboveBar',
      shape: t.dir > 0 ? 'arrowUp' : 'arrowDown',
      color: t.open ? C.entry : t.r > 0 ? C.up : C.down,
      text: (t.open ? 'aberta ' : '') + (t.r >= 0 ? '+' : '') + t.r.toFixed(1) + 'R',
      size: 1.4
    }));
    drawMarkers();
  }

  function setStructure(candles, list) {
    marks.structure = list.map(m => ({
      time: local(candles[m.i].time),
      position: m.high ? 'aboveBar' : 'belowBar',
      shape: m.div ? (m.high ? 'arrowDown' : 'arrowUp') : 'circle',
      size: m.div ? 1 : 0.1,
      color: m.div ? (m.high ? '#FFC24B' : '#FFB000') : (m.label === 'HH' || m.label === 'HL' ? 'rgba(61,220,132,0.9)' : 'rgba(255,77,77,0.9)'),
      text: m.label
    }));
    drawMarkers();
  }

  // Entradas e saídas dos operadores ao vivo nesta moeda/tempo: [{ time(seg), kind:'entry'|'exit', dir, text, win }]
  function setBotTrades(list) {
    const known = new Set(candle.data().map(d => d.time));
    marks.bots = list.map(m => ({
      time: local(m.time),
      position: m.kind === 'entry' ? (m.dir > 0 ? 'belowBar' : 'aboveBar') : (m.dir > 0 ? 'aboveBar' : 'belowBar'),
      shape: m.kind === 'entry' ? (m.dir > 0 ? 'arrowUp' : 'arrowDown') : 'circle',
      color: m.kind === 'entry' ? C.entry : m.open ? C.neutral : m.win ? C.up : C.down,
      text: m.text, size: m.kind === 'entry' ? 2 : 1
    })).filter(m => known.has(m.time));
    drawMarkers();
  }

  function drawMarkers() {
    if (!candle) return;
    const all = [...(on.structure ? marks.structure : []), ...(on.trades ? marks.trades : []), ...(on.bots ? marks.bots : [])];
    all.sort((a, b) => a.time - b.time);
    candle.setMarkers(all);
  }

  // Linhas horizontais. Níveis S/R/OB obedecem à camada "levels"; stop/alvo/gatilhos sempre aparecem.
  function setLevels(levels) { levelDefs = levels; drawLevels(); }

  function drawLevels() {
    if (!candle) return;
    priceLines.forEach(pl => candle.removePriceLine(pl));
    priceLines = levelDefs
      .filter(l => l.price != null && isFinite(l.price) && (!l.layer || on[l.layer]))
      .map(l => candle.createPriceLine({
        price: l.price, color: l.color, lineWidth: l.width || 1,
        lineStyle: l.style ?? LC.LineStyle.Dashed, axisLabelVisible: true, title: l.title
      }));
  }

  // Casas decimais do eixo de preço (moedas baratas como DOGE precisam de mais)
  function setPrecision(p) {
    const priceFormat = { type: 'price', precision: p, minMove: Math.pow(10, -p) };
    candle.applyOptions({ priceFormat });
    for (const k of Object.keys(s)) s[k].applyOptions({ priceFormat });
  }

  function fit(bars = 160) {
    const n = candle.data().length;
    main.timeScale().setVisibleLogicalRange({ from: n - bars, to: n + 8 });
  }

  return {
    init, setData, updateLast, setTrades, setStructure, setLevels, fit, toggle, setPrecision, setBotTrades,
    onHover: cb => { hoverCb = cb; },
    layers: () => LAYERS, state: () => ({ ...on }),
    LineStyle: LC.LineStyle
  };
})();
