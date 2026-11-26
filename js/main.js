// js/main.js — Orquestrador: carrega o histórico, liga o WebSocket e reanalisa a cada candle fechado

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'ZECUSDT',
  'TRXUSDT', 'DOTUSDT', 'LTCUSDT', 'BCHUSDT', 'NEARUSDT', 'UNIUSDT', 'APTUSDT', 'SUIUSDT', 'ATOMUSDT', 'FILUSDT',
  'ENAUSDT', 'FETUSDT', 'TAOUSDT', 'ONDOUSDT', 'XLMUSDT', 'AAVEUSDT', 'WLDUSDT', 'PEPEUSDT', 'ARBUSDT', 'TIAUSDT']; // moedas novas (25/10): Futuros 1 e Swing 1
// As 4 moedas do time Forex (EUR/USDT, USDT/BRL, USDT/MXN e ouro) saíram do site em 16/11/2026
// junto com o time: EURUSDT, USDTBRL, USDTMXN e XAUTUSDT não entram mais na lista.
const HTF_OF = { '1m': '15m', '5m': '1h', '15m': '4h', '30m': '4h', '1h': '4h', '4h': '1d', '1d': '1w' };
const HISTORY = { '1m': 3000, '5m': 5000, '15m': 5000, '30m': 5000, '1h': 5000, '4h': 5000, '1d': 3500 };
const SHORT_TFS = ['1m', '5m', '15m'];

const store = {
  get(k, d) { try { const v = localStorage.getItem('btca.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('btca.' + k, JSON.stringify(v)); } catch (e) {} }
};

const state = {
  symbol: SYMBOLS.includes(store.get('symbol', 'BTCUSDT')) ? store.get('symbol', 'BTCUSDT') : 'BTCUSDT',
  tf: store.get('tf', '4h'),
  strategy: STRATEGIES[store.get('strategy', DEFAULT_STRATEGY)] ? store.get('strategy', DEFAULT_STRATEGY) : DEFAULT_STRATEGY,
  candles: [], S: null, trendAt: () => null, closeStream: null,
  loadId: 0, analyzedTime: null, lastAlert: null, tickTimer: null, htfTimer: null
};

const $ = id => document.getElementById(id);
// ===== Moeda: real brasileiro (R$) por padrão, com interruptor R$ / US$ =====
// A contabilidade do robô continua em dólar; aqui só muda a exibição.
// paraMoeda(v) = valor já na moeda escolhida; fmtMoeda(v) = o mesmo, com o símbolo ("R$ 12,34").
const paraMoeda = v => Moeda.converter(v);
const fmtMoeda = (v, d) => Moeda.formatar(v, d);
// Preço de mercado que fica SEMPRE em dólar (cotações do cabeçalho e ticker, de propósito)
const fmtUSD = (v, d) => Moeda.formatarUSD(v, d);
// Casas decimais conforme o tamanho do preço (DOGE a $0,2 precisa de mais casas que BTC a $80 mil)
const decimals = n => { const a = Math.abs(n); return a >= 10 ? 2 : a >= 1 ? 4 : 5; };
// fmt() é a saída de dinheiro do site: sempre passa por fmtMoeda (sem formatar duas vezes)
const fmt = (n, d) => fmtMoeda(n, d ?? (n == null || !isFinite(n) ? 2 : decimals(paraMoeda(n))));
const fmt0 = n => fmt(n, Math.abs(n) >= 100 ? 0 : undefined);
const num = n => n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : decimals(n) });
const FX_NAME = { EURUSDT: 'EUR/USD', USDTBRL: 'USD/BRL', USDTMXN: 'USD/MXN', XAUTUSDT: 'Ouro', PAXGUSDT: 'Ouro' }; // Forex: nomes como no mercado
// Simbolos do time Forex: encerrado em 16/11/2026, saem do site (fita e seletor de moeda).
const SIMBOLOS_FX = ['EURUSDT', 'USDTBRL', 'USDTMXN', 'XAUTUSDT', 'PAXGUSDT'];
const base = s => FX_NAME[s] || s.replace(/USDT$/, '');
const fmtK = n => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n.toFixed(0);
const signed = (n, d = 2) => (n >= 0 ? '+' : '') + n.toFixed(d);
const pctTxt = v => v == null ? '—' : (v * 100).toFixed(0) + '%';
const when = t => new Date(t * 1000).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const hasVwap = () => !['4h', '1d'].includes(state.tf);

// ===== Carregamento =====

async function load(tf) {
  const id = ++state.loadId;
  state.tf = tf;
  store.set('tf', tf);
  state.analyzedTime = null;
  if (state.closeStream) state.closeStream();
  clearInterval(state.htfTimer);
  document.querySelectorAll('.tf-btn').forEach(b => b.classList.toggle('active', b.dataset.tf === tf));
  $('htfNote').textContent = `tendência maior: ${HTF_OF[tf]}`;
  $('logo').textContent = `${base(state.symbol)}/USDT`;
  $('symSelect').value = state.symbol;
  store.set('symbol', state.symbol);
  setLive('carregando');

  try {
    const [candles, htf, t] = await Promise.all([
      getHistory(tf, HISTORY[tf]),
      getHistory(HTF_OF[tf], 1000),
      fetchTicker24h(state.symbol)
    ]);
    if (id !== state.loadId) return; // trocou de timeframe no meio do carregamento

    candles.forEach((c, i) => { c.closed = i < candles.length - 1; });
    state.candles = candles;
    state.trendAt = buildHTFTrend(htf);
    Charts.setPrecision(decimals(candles[candles.length - 1].close));
    renderTicker({ last: +t.lastPrice, open: +t.openPrice, high: +t.highPrice, low: +t.lowPrice, quoteVolume: +t.quoteVolume });
    analyze(true);
    Charts.fit();
    saveHistory(tf, candles, HISTORY[tf]);
    saveHistory(HTF_OF[tf], htf, 1000);

    state.closeStream = openStream(state.symbol, tf, { onKline, onTicker: renderTicker, onStatus: setLive });
    backfill(tf, id);
    // A tendência maior muda devagar: atualiza a cada 5 min
    state.htfTimer = setInterval(async () => {
      try {
        const fresh = await fetchKlines(state.symbol, HTF_OF[tf], 1000);
        if (id === state.loadId) state.trendAt = buildHTFTrend(fresh);
      } catch (e) { /* tenta de novo no próximo ciclo */ }
    }, 5 * 60 * 1000);
  } catch (err) {
    console.error(err);
    setLive('erro');
    $('signalDir').textContent = 'SEM CONEXÃO';
    $('signalEntry').textContent = 'Não consegui falar com a Binance. Verifique a internet e clique em Recarregar.';
  }
}

// ===== Histórico guardado no navegador =====
// Guarda só candles fechados, em formato compacto. Na próxima abertura baixa apenas o que falta.

// Uma entrada por moeda+timeframe; guarda só as 6 usadas mais recentemente (o navegador tem ~5 MB)
const HIST_KEEP = 6;
const histKey = tf => `hist.${state.symbol}.${tf}`;

function readHistory(tf) {
  const rows = store.get(histKey(tf), null);
  if (!Array.isArray(rows)) return [];
  const ms = INTERVAL_MS[tf];
  return rows.map(r => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5], closeTime: r[0] * 1000 + ms - 1 }));
}

function saveHistory(tf, candles, total) {
  const key = histKey(tf);
  const keys = store.get('histKeys', []).filter(k => k !== key);
  keys.unshift(key);
  for (const old of keys.splice(HIST_KEEP)) { try { localStorage.removeItem('btca.' + old); } catch (e) {} }
  store.set('histKeys', keys);
  const closed = candles.filter(c => c.closeTime < Date.now()).slice(-total);
  store.set(key, closed.map(c => [c.time, c.open, c.high, c.low, c.close, Math.round(c.volume * 1000) / 1000]));
}

// Remove o histórico do formato antigo (só BTC, sem a moeda na chave)
try { Object.keys(localStorage).filter(k => /^btca\.hist\.\d+[mhdw]$/.test(k)).forEach(k => localStorage.removeItem(k)); } catch (e) {}

async function getHistory(tf, total) {
  const cached = readHistory(tf);
  if (cached.length) {
    const last = cached[cached.length - 1];
    const fresh = await fetchKlinesSince(state.symbol, tf, last.time * 1000);
    if (fresh.length < 1000) { // sem buraco: junta o guardado com o novo
      const byTime = new Map(cached.map(c => [c.time, c]));
      fresh.forEach(c => byTime.set(c.time, c));
      return [...byTime.values()].sort((a, b) => a.time - b.time).slice(-total);
    }
  }
  return fetchKlines(state.symbol, tf, 1000);
}

// Completa o histórico mais antigo em segundo plano (o gráfico já está na tela)
async function backfill(tf, id) {
  const need = HISTORY[tf] - state.candles.length;
  if (need <= 0) return;
  setLive('ao vivo · baixando histórico');
  try {
    const older = await fetchKlinesBefore(state.symbol, tf, state.candles[0].time * 1000 - 1, need);
    if (id !== state.loadId || !older.length) return;
    older.forEach(c => { c.closed = true; });
    state.candles = older.concat(state.candles);
    state.analyzedTime = null;
    analyze(true, true);
    saveHistory(tf, state.candles, HISTORY[tf]);
  } catch (e) {
    console.warn('histórico antigo não carregou', e);
  } finally {
    if (id === state.loadId) setLive(state.wsStatus || 'ao vivo');
  }
}

function onKline(k, closed) {
  const cs = state.candles;
  const last = cs[cs.length - 1];
  k.closed = closed;
  if (last.time === k.time) cs[cs.length - 1] = k;
  else if (k.time > last.time) {
    last.closed = true; // se a mensagem de fechamento se perdeu, o candle anterior está fechado mesmo assim
    cs.push(k);
    if (cs.length > HISTORY[state.tf] + 500) cs.shift();
  } else return;

  $('priceMain').textContent = fmtUSD(k.close);
  document.title = `${base(state.symbol)} ${fmtUSD(k.close, Math.abs(k.close) >= 100 ? 0 : undefined)} · PANTHEON`;

  if (cs[lastClosedIndex()].time !== state.analyzedTime) analyze(false);
  else scheduleTick();
}

function lastClosedIndex() {
  const n = state.candles.length;
  return state.candles[n - 1].closed ? n - 1 : n - 2;
}

// Ticks chegam várias vezes por segundo: redesenha o candle atual no máximo 4×/s
function scheduleTick() {
  if (state.tickTimer) return;
  state.tickTimer = setTimeout(() => {
    state.tickTimer = null;
    state.S = computeSeries(state.candles, { withVwap: hasVwap() });
    Charts.updateLast(state.candles, state.S);
    if (!hovering) renderHover(null);
  }, 250);
}

// ===== Análise completa (a cada candle fechado) =====

function analyze(initial, keepView = false) {
  const cs = state.candles, n = cs.length;
  const S  = computeSeries(cs, { withVwap: hasVwap() });
  state.S = S;
  const lc = lastClosedIndex();
  state.analyzedTime = cs[lc].time;

  const htf = state.trendAt(cs[lc].closeTime);
  const all = Object.keys(STRATEGIES).map(k => runBacktest(cs, S, state.trendAt, lc, k));
  const bt  = all.find(b => b.key === state.strategy);
  const sig = evaluateSignal(S, lc, htf, state.strategy);
  const smc = detectSMC(cs, S);
  const wy  = detectWyckoffPhase(cs, S);
  const openTrade = bt.trades.length && bt.trades[bt.trades.length - 1].open ? bt.trades[bt.trades.length - 1] : null;

  Charts.setData(cs, S, keepView);
  Charts.setTrades(cs, bt.trades);
  Charts.setStructure(cs, structureMarks(S));
  Charts.setBotTrades(botMarks());
  state.levels = chartLevels(S, lc, smc, sig, openTrade);
  Charts.setLevels(currentLevels());

  renderReadout(S, lc, htf);
  renderSignal(sig, cs[lc], bt, openTrade, S.close[n - 1]);
  renderChecklist(sig);
  renderCompare(all, cs, lc);
  renderTrades(bt, cs);
  renderIndicators(S, lc);
  renderSMC(smc, S.close[n - 1]);
  renderWyckoff(wy);
  if (!hovering) renderHover(null);
  // Guarda o resultado para poder redesenhar na hora (troca de moeda) sem recalcular tudo
  state.ultima = { cs, S, lc, htf, all, bt, sig, smc, wy, openTrade };

  if (sig.direction !== 'NEUTRO' && state.lastAlert !== cs[lc].time) {
    state.lastAlert = cs[lc].time;
    // Com o robô ligado, só apita quando o sinal é de um robô (evita alarme de sinal que não vira operação)
    if (!initial && (!botState.data || botForView())) alertSignal(sig);
  }
}

// Redesenha a análise com os MESMOS números, só trocando a moeda da exibição
// (usado quando o dono mexe no interruptor R$ / US$ — sem recalcular o backtest)
function redrawAnalise() {
  const L = state.ultima;
  if (!L) return;
  const { cs, S, lc, htf, all, bt, sig, smc, wy, openTrade } = L;
  renderReadout(S, lc, htf);
  renderSignal(sig, cs[lc], bt, openTrade, S.close[cs.length - 1]);
  renderChecklist(sig);
  renderCompare(all, cs, lc);
  renderTrades(bt, cs);
  renderIndicators(S, lc);
  renderSMC(smc, S.close[cs.length - 1]);
  renderWyckoff(wy);
  if (!hovering) renderHover(null);
}

function chartLevels(S, i, smc, sig, openTrade) {
  const LS = Charts.LineStyle;
  const lv = [
    { layer: 'levels', price: smc.res2?.price, color: 'rgba(224,64,96,0.5)', title: 'R2' },
    { layer: 'levels', price: smc.res1?.price, color: 'rgba(224,64,96,0.75)', title: 'R1' },
    { layer: 'levels', price: smc.sup1?.price, color: 'rgba(46,189,133,0.75)', title: 'S1' },
    { layer: 'levels', price: smc.sup2?.price, color: 'rgba(46,189,133,0.5)', title: 'S2' }
  ];
  if (smc.ob) {
    lv.push({ layer: 'levels', price: smc.ob.top,    color: 'rgba(74,144,217,0.7)', title: 'OB', style: LS.Dotted });
    lv.push({ layer: 'levels', price: smc.ob.bottom, color: 'rgba(74,144,217,0.7)', title: '',   style: LS.Dotted });
  }
  const ch = chochLevels(S, i);
  if (ch.bear != null) lv.push({ layer: 'structure', price: ch.bear, color: '#F2B544', title: 'CHoCH ↓', style: LS.LargeDashed });
  if (ch.bull != null) lv.push({ layer: 'structure', price: ch.bull, color: '#50c8dc', title: 'CHoCH ↑', style: LS.LargeDashed });
  if (sig.direction !== 'NEUTRO') {
    lv.push({ price: sig.stop, color: '#e04060', title: 'STOP', width: 2, style: LS.Solid });
    if (sig.target != null) lv.push({ price: sig.target, color: '#2ebd85', title: 'ALVO', width: 2, style: LS.Solid });
  } else if (openTrade) {
    lv.push({ price: openTrade.entry, color: '#FFB000', title: 'ENTRADA', width: 2, style: LS.Solid });
    lv.push({ price: openTrade.stop, color: '#e04060', title: 'STOP ATUAL', width: 2, style: LS.Solid });
    if (openTrade.target != null) lv.push({ price: openTrade.target, color: '#2ebd85', title: 'ALVO', width: 2, style: LS.Solid });
  }
  return lv;
}

// Níveis cuja perda/recuperação quebra a estrutura atual (CHoCH)
function chochLevels(S, i) {
  const { sh1, sh2, sl1, sl2 } = S.struct;
  const h1 = sh1[i], h2 = sh2[i], l1 = sl1[i], l2 = sl2[i];
  if (!h1 || !h2 || !l1 || !l2) return {};
  const up = h1.price > h2.price && l1.price > l2.price;
  const down = h1.price < h2.price && l1.price < l2.price;
  return { bear: up || !down ? l1.price : null, bull: down || !up ? h1.price : null, up, down };
}

// ===== Renderização =====

function setLive(status) {
  if (!status.includes('histórico')) state.wsStatus = status;
  $('liveText').textContent = status;
  $('liveStatus').className = 'live ' + (status.startsWith('ao vivo') ? 'on' : status === 'erro' ? 'err' : 'wait');
}

function renderTicker(t) {
  const pct = (t.last - t.open) / t.open * 100;
  // Cotações do cabeçalho ficam sempre em dólar (de propósito, pedido do dono)
  $('priceMain').textContent = fmtUSD(t.last);
  const el = $('priceChange');
  el.textContent = signed(pct) + '% 24h';
  el.className = 'price-change ' + (pct >= 0 ? 'up' : 'down');
  $('high24').textContent = fmtUSD(t.high);
  $('low24').textContent = fmtUSD(t.low);
  $('vol24').textContent = fmtK(t.quoteVolume);
}

function setRo(id, text, cls, sub) {
  $(id).textContent = text;
  $(id).className = 'ro-val ' + (cls || '');
  $(id + 'Sub').textContent = sub || '';
}

function renderReadout(S, i, htf) {
  const c = S.close[i], a = S.atr[i];
  const stUp = S.st.dir[i] === 1, above = c > S.ema200[i];
  let since = 0;
  while (i - since - 1 >= 0 && S.st.dir[i - since - 1] === S.st.dir[i]) since++;
  const force = S.adx[i] >= 25 ? 'forte' : S.adx[i] >= 20 ? 'moderada' : 'fraca';
  if (stUp && above) setRo('roTrend', 'ALTA', 'bull', `Supertrend verde há ${since + 1} candles, preço acima da EMA 200 · força ${force} (ADX ${S.adx[i].toFixed(0)})`);
  else if (!stUp && !above) setRo('roTrend', 'BAIXA', 'bear', `Supertrend vermelho há ${since + 1} candles, preço abaixo da EMA 200 · força ${force} (ADX ${S.adx[i].toFixed(0)})`);
  else setRo('roTrend', 'TRANSIÇÃO', 'neut', `Supertrend ${stUp ? 'verde' : 'vermelho'} há ${since + 1} candles, mas preço ${above ? 'acima' : 'abaixo'} da EMA 200 (sinais conflitantes)`);

  setRo('roHtf', htf === 1 ? 'ALTA' : htf === -1 ? 'BAIXA' : 'INDEFINIDA', htf === 1 ? 'bull' : htf === -1 ? 'bear' : 'neut',
    `${HTF_OF[state.tf]}: preço vs EMA 50 e EMA 200 (alinhadas = tendência)`);

  const ch = chochLevels(S, i);
  const h1 = S.struct.sh1[i], l1 = S.struct.sl1[i];
  if (ch.up) setRo('roStruct', 'ALTA (HH + HL)', 'bull', `topos e fundos subindo · último fundo ${fmt0(l1.price)}`);
  else if (ch.down) setRo('roStruct', 'BAIXA (LH + LL)', 'bear', `topos e fundos caindo · último topo ${fmt0(h1.price)}`);
  else setRo('roStruct', 'MISTA', 'neut', h1 && l1 ? `range entre ${fmt0(l1.price)} e ${fmt0(h1.price)}` : '');

  const r = S.rsi[i], h = S.macd.hist[i], hp = S.macd.hist[i - 1];
  const acc = Math.abs(h) > Math.abs(hp) ? 'acelerando' : 'perdendo força';
  if (r > 55 && h > 0) setRo('roMom', 'COMPRADOR', 'bull', `RSI ${r.toFixed(0)} · MACD positivo ${acc}`);
  else if (r < 45 && h < 0) setRo('roMom', 'VENDEDOR', 'bear', `RSI ${r.toFixed(0)} · MACD negativo ${acc}`);
  else setRo('roMom', 'NEUTRO', 'neut', `RSI ${r.toFixed(0)} · MACD ${h >= 0 ? 'positivo' : 'negativo'} ${acc}`);

  // Gatilhos: preços que, se fecharem do outro lado, mudam a leitura
  const ul = $('roTriggers');
  ul.replaceChildren();
  const add = (cls, text) => { const li = document.createElement('li'); li.className = cls; li.textContent = text; ul.appendChild(li); };
  const st = S.st.line[i], dist = Math.abs(c - st) / a;
  add(stUp ? 'bear' : 'bull', `${stUp ? 'Fechar abaixo' : 'Fechar acima'} de ${fmt0(st)} vira o Supertrend para ${stUp ? 'BAIXA' : 'ALTA'} (a ${dist.toFixed(1)} ATR do preço)`);
  let hi20 = -Infinity, lo20 = Infinity;
  for (let k = i - 19; k <= i; k++) { hi20 = Math.max(hi20, S.high[k]); lo20 = Math.min(lo20, S.low[k]); }
  add('bull', `Fechar acima de ${fmt0(hi20)} = rompimento de ALTA do canal 20` + (above ? '' : ' (estratégia só compra acima da EMA 200)'));
  add('bear', `Fechar abaixo de ${fmt0(lo20)} = rompimento de BAIXA do canal 20` + (!above ? '' : ' (estratégia só vende abaixo da EMA 200)'));
  if (ch.bear != null) add('bear', `Perder ${fmt0(ch.bear)} (último fundo) = CHoCH de baixa, primeiro aviso de virada`);
  if (ch.bull != null) add('bull', `Recuperar ${fmt0(ch.bull)} (último topo) = CHoCH de alta, primeiro aviso de virada`);
  const marks = structureMarks(S).filter(m => m.div && m.i >= i - 30);
  const lastDiv = marks[marks.length - 1];
  if (lastDiv) add(lastDiv.high ? 'bear' : 'bull', lastDiv.high
    ? `Divergência de baixa no RSI há ${i - lastDiv.i} candles: topo mais alto com RSI mais fraco (compradores perdendo força)`
    : `Divergência de alta no RSI há ${i - lastDiv.i} candles: fundo mais baixo com RSI mais forte (vendedores perdendo força)`);
  add('neut', `EMA 200 em ${fmt0(S.ema200[i])}: ${above ? 'perder' : 'recuperar'} esse nível muda o viés de longo prazo`);
}

let hovering = false;
function renderHover(i) {
  const S = state.S, cs = state.candles;
  if (!S || !cs.length) return;
  hovering = i != null;
  if (i == null) i = cs.length - 1;
  const c = cs[i];
  const ch = (c.close - c.open) / c.open * 100;
  const v = (label, val, cls = '') => `<span class="hl-k">${label}</span> <span class="hl-v ${cls}">${val}</span>`;
  const n = num;
  const stCls = S.st.dir[i] === 1 ? 'g' : 'r';
  $('hoverLegend').innerHTML = [
    `<span class="hl-t">${when(c.time)}${c.closed ? '' : ' · em formação'}</span>`,
    v('A', n(c.open)), v('M', n(c.high)), v('m', n(c.low)), v('F', n(c.close), ch >= 0 ? 'g' : 'r'), v('', signed(ch) + '%', ch >= 0 ? 'g' : 'r'),
    v('ST', n(S.st.line[i]), stCls), v('EMA50', n(S.ema50[i])), v('EMA200', n(S.ema200[i])),
    v('RSI', S.rsi[i] == null ? '—' : S.rsi[i].toFixed(1)), v('ADX', S.adx[i] == null ? '—' : S.adx[i].toFixed(1))
  ].join(' ');
}

function renderSignal(sig, candle, bt, openTrade, livePrice) {
  const box = $('signalBox');
  if (!sig.ready) {
    box.className = 'signal-box neutral';
    $('signalDir').textContent = 'DADOS INSUFICIENTES';
    $('signalEntry').textContent = 'São necessários pelo menos 200 candles para a EMA 200.';
    return;
  }
  const strat = STRATEGIES[state.strategy];
  const cls = { COMPRA: 'buy', VENDA: 'sell', NEUTRO: 'neutral' }[sig.direction];
  box.className = 'signal-box ' + cls;
  const icon = { COMPRA: '⬆', VENDA: '⬇', NEUTRO: '→' }[sig.direction];
  $('signalDir').textContent = sig.direction === 'NEUTRO'
    ? `${icon} SEM SINAL NOVO · ${strat.name}`
    : `${icon} SINAL DE ${sig.direction} · ${strat.name}`;
  $('signalWhen').textContent = `candle fechado em ${when(candle.time)} · ${state.tf}`;
  renderOwner();

  if (sig.direction !== 'NEUTRO') {
    const pStop = (sig.stop - sig.entry) / sig.entry * 100;
    $('signalEntry').textContent = `Entrada ≈ ${fmt(sig.entry)} · Stop ${fmt(sig.stop)} (${signed(pStop)}%)` +
      (sig.target != null
        ? ` · Alvo ${fmt(sig.target)} (${signed((sig.target - sig.entry) / sig.entry * 100)}%) · R/R 1:${sig.rr.toFixed(2)}`
        : ' · sem alvo fixo: o stop sobe junto com a tendência (stop móvel)');
  } else if (openTrade) {
    const pnl = openTrade.dir * (livePrice - openTrade.entry) / openTrade.entry * 100;
    $('signalEntry').textContent =
      `Operação em andamento: ${openTrade.dir > 0 ? 'COMPRA' : 'VENDA'} desde ${when(state.candles[openTrade.entryIdx].time)} @ ${fmt0(openTrade.entry)} · ` +
      `stop atual ${fmt0(openTrade.stop)} · resultado ${signed(pnl)}% (${signed(openTrade.r, 1)}R no último fechamento)`;
  } else {
    const lado = sig.side > 0 ? 'compra' : 'venda';
    $('signalEntry').textContent = `Nenhuma operação aberta. Lado mais próximo: ${lado}, com ${sig.passed}/${sig.total} condições ok.`;
  }
  const pct = sig.total ? sig.passed / sig.total * 100 : 0;
  $('strengthFill').style.width = pct + '%';
  $('strengthFill').className = 'strength-fill ' + cls;
  $('strengthTxt').textContent = `condições ${sig.passed}/${sig.total}`;

  const warns = [];
  if (SHORT_TFS.includes(state.tf)) warns.push(`Em ${state.tf}, todas as estratégias perderam no teste de histórico longo (as taxas comem o movimento). Prefira 4h ou 1d para operar.`);
  if (bt.count >= 10 && bt.totalR < 0) warns.push(`Neste timeframe, "${strat.name}" PERDEU no histórico carregado (${bt.count} operações, ${signed(bt.totalR, 1)}R).`);
  $('signalWarn').hidden = !warns.length;
  $('signalWarn').textContent = warns.join(' · ');
}

// Deixa claro se o sinal da caixa é de um robô ou só leitura do painel
function renderOwner() {
  const el = $('signalOwner');
  if (!botState.data) { el.hidden = true; return; }
  const bot = botForView();
  el.hidden = false;
  if (bot) {
    el.className = 'signal-owner robot';
    el.textContent = `🤖 Este é o mesmo sinal que o robô ${bot.name} usa. Se aparecer COMPRA/VENDA aqui, ele entra na abertura do próximo candle.`;
  } else {
    el.className = 'signal-owner';
    const names = botState.data.bots.map(b => `${b.name} (${STRATEGIES[b.strategy]?.name} · ${b.tf})`).join(', ');
    el.textContent = `ℹ Leitura só do painel: nenhum robô opera "${STRATEGIES[state.strategy].name}" no ${state.tf} em ${base(state.symbol)}, então um sinal aqui NÃO vira operação. ` +
      `Robôs ativos: ${names}. Clique num robô no card "Robô simulado" para ver o gráfico dele.`;
  }
}

function renderChecklist(sig) {
  const ul = $('checklist');
  ul.replaceChildren();
  $('stratDesc').textContent = STRATEGIES[state.strategy].desc;
  $('checkSide').textContent = sig.ready ? `· ${sig.side > 0 ? 'lado COMPRA' : 'lado VENDA'}` : '';
  let group = null;
  for (const c of sig.checks) {
    if (c.group !== group) {
      group = c.group;
      const h = document.createElement('li');
      h.className = 'check-group';
      h.textContent = { filtro: 'Filtros (todos)', gatilho: 'Gatilho (todos)', 'confirmação': 'Confirmações' }[group];
      ul.appendChild(h);
    }
    const li = document.createElement('li');
    li.className = 'check ' + (c.ok ? 'ok' : 'no') + (c.meta ? ' meta' : '');
    const mark = document.createElement('span');
    mark.className = 'check-mark';
    mark.textContent = c.ok ? '✔' : '✘';
    li.append(mark, document.createTextNode(c.label));
    ul.appendChild(li);
  }
}

function renderCompare(all, cs, lc) {
  const body = $('cmpBody');
  body.replaceChildren();
  for (const b of all) {
    const tr = document.createElement('tr');
    tr.className = (b.key === state.strategy ? 'sel ' : '') + (b.totalR > 0 ? 'pos' : b.totalR < 0 ? 'neg' : '');
    tr.title = 'Clique para usar esta estratégia';
    const cells = [
      STRATEGIES[b.key].name + (b.key === DEFAULT_STRATEGY ? ' ★' : ''),
      b.count, pctTxt(b.winRate),
      b.count ? signed(b.avgWin, 1) + 'R' : '—',
      b.profitFactor == null ? '—' : b.profitFactor === Infinity ? '∞' : b.profitFactor.toFixed(2),
      b.count ? signed(b.totalR, 1) + 'R' : '—',
      b.avgR == null ? '—' : signed(b.avgR) + 'R'
    ];
    cells.forEach((v, k) => { const td = document.createElement('td'); td.textContent = v; if (k >= 5) td.className = 'num'; tr.appendChild(td); });
    tr.addEventListener('click', () => setStrategy(b.key));
    body.appendChild(tr);
  }
  $('cmpHint').textContent = `· ${lc - 201} candles de ${state.tf} (${when(cs[201].time)} → ${when(cs[lc].time)})`;
  $('cmpFoot').textContent =
    `★ = padrão. No teste em histórico longo (até 4 anos), o rompimento foi a única estratégia positiva tanto no trecho usado para escolher quanto no trecho que ela nunca viu (4h e 1d). ` +
    `R = quanto o stop arriscava. Estratégias de tendência acertam pouco (30–45%) mas ganham bem mais do que perdem. ` +
    `Taxa de ${(FEE_PER_SIDE * 100).toFixed(2)}% por lado já descontada. Resultado passado não garante resultado futuro.`;
}

function renderTrades(bt, cs) {
  const ul = $('btList');
  ul.replaceChildren();
  bt.trades.slice(-10).reverse().forEach(t => {
    const li = document.createElement('li');
    const why = t.why === 'stop' && t.r > 0 ? 'stop móvel' : t.why;
    const res = t.open ? `em aberto (${signed(t.r, 2)}R)` : `${signed(t.r, 2)}R (${why})`;
    li.className = t.open ? 'open' : t.r > 0 ? 'pos' : 'neg';
    li.textContent = `${when(cs[t.entryIdx].time)} · ${t.dir > 0 ? 'COMPRA' : 'VENDA'} @ ${fmt0(t.entry)} → ${res}`;
    ul.appendChild(li);
  });
  if (!bt.trades.length) {
    const li = document.createElement('li');
    li.textContent = 'Nenhuma operação no período carregado.';
    ul.appendChild(li);
  }
  $('btFoot').textContent = `${bt.count} operações fechadas · acerto ${pctTxt(bt.winRate)} · total ${bt.count ? signed(bt.totalR, 1) + 'R' : '—'}. As setas no gráfico são estas operações.`;
}

function setBadge(id, type, text) {
  const el = $(id);
  el.className = 'badge ' + type;
  el.textContent = text;
}

function renderIndicators(S, i) {
  const c = S.close[i];
  const k0 = num;

  $('stVal').textContent = fmt0(S.st.line[i]);
  setBadge('stBadge', S.st.dir[i] === 1 ? 'bull' : 'bear', S.st.dir[i] === 1 ? 'Alta' : 'Baixa');

  $('dcVal').textContent = `${k0(S.dcHigh[i])} / ${k0(S.dcLow[i])}`;
  if (c > S.dcHigh[i]) setBadge('dcBadge', 'bull', 'Rompeu alta');
  else if (c < S.dcLow[i]) setBadge('dcBadge', 'bear', 'Rompeu baixa');
  else setBadge('dcBadge', 'neut', 'Dentro');

  $('ema200Val').textContent = fmt(S.ema200[i]);
  setBadge('ema200Badge', c > S.ema200[i] ? 'bull' : 'bear', c > S.ema200[i] ? 'Preço acima' : 'Preço abaixo');

  const e9 = S.ema9[i], e21 = S.ema21[i], e50 = S.ema50[i];
  $('emaVal').textContent = `${k0(e9)} / ${k0(e21)} / ${k0(e50)}`;
  if (e9 > e21 && e21 > e50) setBadge('emaBadge', 'bull', 'Alinhadas ↑');
  else if (e9 < e21 && e21 < e50) setBadge('emaBadge', 'bear', 'Alinhadas ↓');
  else setBadge('emaBadge', 'neut', 'Mistas');

  const ax = S.adx[i], pdi = S.plusDI[i], mdi = S.minusDI[i];
  $('adxVal').textContent = `${ax.toFixed(1)} (${pdi.toFixed(0)} / ${mdi.toFixed(0)})`;
  if (ax < 20) setBadge('adxBadge', 'neut', 'Sem tendência');
  else setBadge('adxBadge', pdi > mdi ? 'bull' : 'bear', (ax >= 30 ? 'Forte ' : '') + (pdi > mdi ? 'alta' : 'baixa'));

  const r = S.rsi[i];
  $('rsiVal').textContent = r.toFixed(1);
  if (r >= 70) setBadge('rsiBadge', 'bear', 'Sobrecomprado');
  else if (r <= 30) setBadge('rsiBadge', 'bull', 'Sobrevendido');
  else setBadge('rsiBadge', r >= 50 ? 'bull' : 'bear', r >= 50 ? 'Força' : 'Fraqueza');

  const h = S.macd.hist[i], hp = S.macd.hist[i - 1];
  $('macdVal').textContent = h.toFixed(1);
  if (h >= 0) setBadge('macdBadge', h >= hp ? 'bull' : 'neut', h >= hp ? 'Alta ↑' : 'Alta perdendo');
  else setBadge('macdBadge', h <= hp ? 'bear' : 'neut', h <= hp ? 'Baixa ↓' : 'Baixa perdendo');

  const pb = (c - S.bb.lower[i]) / (S.bb.upper[i] - S.bb.lower[i]) * 100;
  $('bbVal').textContent = pb.toFixed(0) + '%';
  if (pb > 100) setBadge('bbBadge', 'bear', 'Acima da banda');
  else if (pb < 0) setBadge('bbBadge', 'bull', 'Abaixo da banda');
  else setBadge('bbBadge', 'neut', pb >= 50 ? 'Metade de cima' : 'Metade de baixo');

  if (S.vwap[i] == null) { $('vwapVal').textContent = '—'; setBadge('vwapBadge', 'neut', 'n/a neste TF'); }
  else {
    $('vwapVal').textContent = fmt(S.vwap[i]);
    setBadge('vwapBadge', c > S.vwap[i] ? 'bull' : 'bear', c > S.vwap[i] ? 'Preço acima' : 'Preço abaixo');
  }

  $('atrVal').textContent = fmt(S.atr[i]);
  $('atrBadge').textContent = (S.atr[i] / c * 100).toFixed(2) + '% do preço';

  const vr = S.volume[i] / S.volSma[i];
  $('volVal').textContent = vr.toFixed(2) + '×';
  setBadge('volBadge', vr >= 1 ? 'bull' : 'neut', vr >= 1.5 ? 'Forte' : vr >= 1 ? 'Acima da média' : 'Abaixo da média');
}

function renderSMC(smc, price) {
  const lvl = l => l ? `${fmt0(l.price)} · ${l.touches}×` : '—';
  $('res2').textContent = lvl(smc.res2);
  $('res1').textContent = lvl(smc.res1);
  $('sup1').textContent = lvl(smc.sup1);
  $('sup2').textContent = lvl(smc.sup2);
  $('curSMC').textContent = fmt(price);
  const zone = z => z ? `${fmt0(z.bottom)} – ${fmt0(z.top)} ${z.type === 'bullish' ? '🟢' : '🔴'}` : 'nenhum ativo';
  $('obLevel').textContent = zone(smc.ob);
  $('fvgLevel').textContent = zone(smc.fvg);
  const b = smc.lastBreak;
  $('structure').textContent = `Estrutura: ${smc.structure}` +
    (b ? ` · Última quebra: ${b.kind} de ${b.dir > 0 ? 'alta' : 'baixa'} em ${fmt0(b.swing.price)}` : '');
}

function renderWyckoff(w) {
  $('phaseDot').style.background = w.color;
  $('phaseName').textContent = w.phase;
  $('phaseDesc').textContent = w.desc;
  $('phaseAction').textContent = w.action;
}

// ===== Controles =====

function setStrategy(key) {
  restoreDefaults();
  state.strategy = key;
  store.set('strategy', key);
  $('stratSelect').value = key;
  if (state.candles.length) { state.analyzedTime = null; analyze(true); }
}

function buildControls() {
  const sym = $('symSelect');
  for (const s of SYMBOLS) {
    const o = document.createElement('option');
    o.value = s; o.textContent = `${base(s)}/USDT`;
    sym.appendChild(o);
  }
  sym.value = state.symbol;
  sym.addEventListener('change', () => { state.symbol = sym.value; load(state.tf); });

  const sel = $('stratSelect');
  for (const [k, v] of Object.entries(STRATEGIES)) {
    const o = document.createElement('option');
    o.value = k; o.textContent = v.name + (k === DEFAULT_STRATEGY ? ' ★' : '');
    sel.appendChild(o);
  }
  sel.value = state.strategy;
  sel.addEventListener('change', () => setStrategy(sel.value));

  const box = $('layers'), on = Charts.state();
  for (const [k, v] of Object.entries(Charts.layers())) {
    const b = document.createElement('button');
    b.className = 'chip' + (on[k] ? ' on' : '');
    const dot = document.createElement('span');
    dot.className = 'chip-dot';
    dot.style.background = v.color;
    b.append(dot, document.createTextNode(v.label));
    b.addEventListener('click', () => {
      const st = Charts.toggle(k);
      store.set('layers', st);
      b.classList.toggle('on', st[k]);
    });
    box.appendChild(b);
  }

  $('tfBar').addEventListener('click', e => {
    if (!e.target.dataset.tf) return;
    restoreDefaults();
    store.set('followBot', 'none');
    load(e.target.dataset.tf);
  });
  $('reloadBtn').addEventListener('click', () => load(state.tf));
  $('fitBtn').addEventListener('click', () => Charts.fit());
  $('fsBtn').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else $('chartBox').requestFullscreen?.();
  });
  document.addEventListener('fullscreenchange', () => {
    $('fsBtn').textContent = document.fullscreenElement ? 'Sair da tela cheia' : 'Tela cheia';
  });
  Charts.onHover(i => renderHover(i));
}

// ===== Robô simulado (só quando o painel é servido pelo bot em http://localhost) =====

// CÓPIA ESTÁTICA: esta cópia é publicada num host estático (sem o servidor do robô).
// Com MODO_DEMO ligado, nada é pedido a /api/* (não existe servidor): os dados vêm
// de dados-demo.json, que é o estado do robô com o capital mascarado.
const MODO_DEMO = true;

const botState = { data: null };

async function pollBot() {
  if (botState.busy) return; // rede lenta: não empilha consultas
  botState.busy = true;
  try {
    if (MODO_DEMO) throw new Error('cópia estática: sem servidor do robô');
    const res = await fetch('/api/state', { cache: 'no-store' });
    const first = !botState.followed;
    botState.followed = true;
    botState.data = await res.json();
    // O time Forex foi encerrado em 16/11/2026: some do site mesmo que o processo
    // antigo do robô ainda o reporte (o config já não tem mais esses operadores).
    if (botState.data.bots) botState.data.bots = botState.data.bots.filter(b => b.team !== 'forex');
    if (botState.data.teams) delete botState.data.teams.forex;
    if (botState.data.symbols) botState.data.symbols = botState.data.symbols.filter(s => !SIMBOLOS_FX.includes(s));
    if (botState.data.prices) for (const s of SIMBOLOS_FX) delete botState.data.prices[s];
    Moeda.aplicar(botState.data.moeda);   // taxa US$ → R$ (vem do robô, sem chave)
    atualizarRotuloMoeda();
    renderBot(botState.data);
    if (first && !botForView()) {
      const saved = store.get('followBot', null);
      const bots = botState.data.bots;
      const pick = saved === 'none' ? null : bots.find(b => b.id === saved) || bots.find(b => b.id === 'scalper-5m') || bots[0];
      if (pick) followBot(pick);
    }
  } catch (e) {
    // CÓPIA ESTÁTICA: não há servidor do robô, então usa os dados de demonstração
    // que acompanham a pasta (dados-demo.json). Se nem isso existir, aí sim avisa.
    try {
      if (!botState.demoDados) {
        const res2 = await fetch('dados-demo.json', { cache: 'no-store' });
        if (!res2.ok) throw new Error('sem dados de demonstração');
        botState.demoDados = await res2.json();
      }
      const dados = botState.demoDados;
      botState.data = dados;
      Moeda.aplicar(dados.moeda);
      atualizarRotuloMoeda();
      renderBot(dados);
      $('botHint').textContent = 'Dados de demonstração (cópia estática do PANTHEON).';
    } catch (e2) {
      $('botHint').textContent = 'Sem resposta do robô. Confira se a janela do start-bot.bat está aberta.';
    }
  } finally {
    botState.busy = false;
  }
}

// ===== Interruptor de moeda (R$ / US$) =====
// R$ por padrão. A troca é imediata: redesenha tudo que mostra dinheiro, sem recarregar a página.
function atualizarRotuloMoeda() {
  const t = $('moedaTaxa');
  if (t) {
    t.textContent = Moeda.rotuloTaxa() + (Moeda.antigo ? ' · taxa antiga' : '');
    t.classList.toggle('antigo', !!Moeda.antigo);
    t.title = Moeda.atualizadoEm
      ? `Taxa US$ → R$ de ${new Date(Moeda.atualizadoEm).toLocaleString('pt-BR')}` + (Moeda.antigo ? ' (a busca falhou: taxa antiga)' : '')
      : 'Taxa US$ → R$ (ainda não veio do robô)';
  }
  for (const [id, m] of [['moedaBRL', 'BRL'], ['moedaUSD', 'USD']]) {
    const b = $(id);
    if (!b) continue;
    b.classList.toggle('on', Moeda.modo === m);
    b.setAttribute('aria-pressed', Moeda.modo === m ? 'true' : 'false');
  }
}

// Redesenha o que mostra dinheiro depois da troca de moeda
function redesenharMoeda() {
  atualizarRotuloMoeda();
  redrawAnalise();
  if (botState.data) renderBot(botState.data);
}

function ligarInterruptorMoeda() {
  const b = $('moedaBRL'), u = $('moedaUSD');
  if (b) b.addEventListener('click', () => { Moeda.definirModo('BRL'); redesenharMoeda(); });
  if (u) u.addEventListener('click', () => { Moeda.definirModo('USD'); redesenharMoeda(); });
  atualizarRotuloMoeda();
}

// ===== Times (Spot / Futuros) =====
botState.team = store.get('team', 'spot');
botState.tradeFilter = 'all';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const pctS = (v, d = 2) => v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d) + '%';
const usdS = v => (v >= 0 ? '+' : '−') + fmtMoeda(Math.abs(v), 2);
const hhmm = ms => new Date(ms).toLocaleTimeString('pt-BR').slice(0, 5);
const ddhhmm = ms => new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const dayLabel = day => new Date((day * 86400 + 3 * 3600) * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const STRAT = s => STRATEGIES[s]?.name || s;
const tradePct = t => t.pct ?? (t.pnl / ((t.equityAfter - t.pnl) || 1) * 100);

// Cada estratégia tem um número e uma cor fixos (iguais no placar, nos cards e no radar)
const SNUM = { breakout: 1, reversal: 2, supertrend: 3, pullback: 4 };
const SCOL = { 1: '#8EA2FF', 2: '#D08CFF', 3: '#6FE3FF', 4: '#FFB86B' };
// Cor por estratégia (as 4 originais + as clássicas estudadas em 20/10)
const SCOL_S = { breakout: '#8EA2FF', reversal: '#D08CFF', supertrend: '#6FE3FF', pullback: '#FFB86B', macdx: '#F28FB8', psar: '#9BE7C4', heikin: '#E8D27A', dthrust: '#B7A4FF', london: '#7FD0FF', bbrev: '#FFA3A3' };
// Número do operador = o número no nome (Spot 1, Futuros 3...): é a posição dele no time
const slot = b => +((b.name || '').match(/(\d+)$/) || [])[1] || 9;
const sCol = b => SCOL_S[b.strategy] || '#93AAC2';
// O resultado do operador, em % do dinheiro TOTAL da conta (modo compartilhado).
// Fora dele, continua o % da conta de papel de cada robô, como sempre.
const retOf = b => b.compartilhado
  ? (b.pctConta ?? 0)
  : ((b.equity + b.openPnl) / b.startEquity - 1) * 100;
const signCls = v => Math.abs(v) < 0.005 ? 'zero' : v > 0 ? 'pos' : 'neg';
const tgtOf = b => ((b.leverage || b.lock)?.dailyTargetPct || 0) * 100;
const svgEl = (tag, attrs) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

function renderTeamTabs(d) {
  const box = $('teamTabs');
  box.replaceChildren();
  for (const [id, t] of Object.entries(d.teams || {})) {
    const bots = d.bots.filter(b => b.team === id).sort((x, y) => slot(x) - slot(y));
    if (!bots.length) continue;
    const open = bots.reduce((s, b) => s + (b.positions || []).length, 0);
    // Placar do time: o quanto o TIME vale do dinheiro total da conta. A régua é a
    // conta (a carteira), não a soma das fatias — os robôs ocultos também disputam.
    const cart = d.carteira;
    const contaBase = cart?.saldoInicial ?? bots.reduce((s, b) => s + b.startEquity, 0);
    const teamPnl = bots.reduce((s, b) => s + ((b.equity + b.openPnl) - b.startEquity), 0);
    const teamPnlHoje = bots.reduce((s, b) => s + (b.days?.[0]?.pnl || 0), 0);
    const ret = contaBase ? teamPnl / contaBase * 100 : 0;
    const todayPct = contaBase ? teamPnlHoje / contaBase * 100 : 0;
    // Acertos: so da conta atual (desde o ultimo reset), nao do historico antigo
    const wins = bots.reduce((s, b) => s + (b.cur ? b.cur.wins : b.wins), 0), n = bots.reduce((s, b) => s + (b.cur ? b.cur.trades : b.trades), 0);
    const btn = el('button', 'team-tab' + (id === botState.team ? ' on' : ''));
    // Mini-barras: uma por operador, na cor da estratégia; para cima = lucro, para baixo = prejuízo
    const bars = el('div', 'tt-bars');
    const rets = bots.map(retOf), max = Math.max(1, ...rets.map(Math.abs));
    bots.forEach((b, k) => {
      const bar = el('span', 'tt-bar');
      const col = el('span', 'tt-col');            // area do desenho (linha do zero compartilhada no grupo)
      const fill = el('i');
      const h = Math.max(3, Math.abs(rets[k]) / max * 21);
      fill.style.height = h + 'px';
      fill.style.background = sCol(b);
      if (rets[k] >= 0) fill.style.bottom = '24px'; else fill.style.top = '24px';
      if (rets[k] < 0) fill.style.opacity = 0.55;
      col.append(fill);
      bar.append(col, el('span', 'tt-n', String(slot(b))));
      bar.title = `${b.name} – ${STRAT(b.strategy)}: ${pctS(rets[k])}`;
      bars.appendChild(bar);
    });
    btn.append(
      el('div', 'tt-name', t.name),
      el('div', 'tt-big ' + signCls(ret), pctS(ret)),
      bars,
      el('div', 'tt-sub', `Hoje ${pctS(todayPct)} · ${wins} de ${n} no lucro · ${open} ${open === 1 ? 'posição aberta' : 'posições abertas'}`)
    );
    btn.addEventListener('click', () => {
      botState.team = id;
      store.set('team', id);
      botState.tradeFilter = 'all';
      $('tradeFilter').replaceChildren();
      renderBot(botState.data);
    });
    box.appendChild(btn);
  }
  $('teamDesc').textContent = d.teams?.[botState.team]?.desc || '';
}

// Curva suave que passa por todos os pontos sem ultrapassar o maior/menor valor (cúbica monotônica, Fritsch–Carlson)
function smoothPath(p) {
  const n = p.length;
  if (n < 3) return 'M' + p.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' L');
  const d = [], m = [];
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1][1] - p[i][1]) / (p[i + 1][0] - p[i][0]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  let out = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = (p[i + 1][0] - p[i][0]) / 3;
    out += ` C${(p[i][0] + h).toFixed(1)},${(p[i][1] + m[i] * h).toFixed(1)} ${(p[i + 1][0] - h).toFixed(1)},${(p[i + 1][1] - m[i + 1] * h).toFixed(1)} ${p[i + 1][0].toFixed(1)},${p[i + 1][1].toFixed(1)}`;
  }
  return out;
}

// Linha do saldo (% desde o início) desenhada em SVG, sem biblioteca
function sparkline(b) {
  const W = 240, H = 54, pad = 3;
  const pts = [{ t: 0, eq: b.startEquity }, ...(b.curve || []).map(p => ({ t: p.t, eq: p.eq })), { t: Infinity, eq: b.equity + b.openPnl }];
  const ys = pts.map(p => p.eq), lo = Math.min(...ys, b.startEquity), hi = Math.max(...ys, b.startEquity);
  const span = (hi - lo) || 1;
  const X = k => pad + k / (pts.length - 1) * (W - 2 * pad);
  const Y = v => pad + (1 - (v - lo) / span) * (H - 2 * pad);
  const col = sCol(b);
  const svg = svgEl('svg', { class: 'spark', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  const gid = 'sg-' + b.id;
  const defs = svgEl('defs', {}), grad = svgEl('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.append(svgEl('stop', { offset: '0', 'stop-color': col, 'stop-opacity': '0.28' }), svgEl('stop', { offset: '1', 'stop-color': col, 'stop-opacity': '0' }));
  defs.appendChild(grad);
  const xy = pts.map((p, k) => [X(k), Y(p.eq)]);
  const curve = smoothPath(xy);
  svg.append(
    defs,
    svgEl('line', { x1: 0, x2: W, y1: Y(b.startEquity), y2: Y(b.startEquity), stroke: 'rgba(120,180,240,0.25)', 'stroke-dasharray': '3 4', 'vector-effect': 'non-scaling-stroke' }),
    svgEl('path', { d: `${curve} L${X(pts.length - 1).toFixed(1)},${H} L${X(0).toFixed(1)},${H} Z`, fill: `url(#${gid})` }),
    svgEl('path', { d: curve, fill: 'none', stroke: col, 'stroke-width': 1.8, 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }),
    svgEl('circle', { cx: X(pts.length - 1), cy: Y(pts[pts.length - 1].eq), r: 2.6, fill: col })
  );
  return svg;
}

function opCard(b) {
  const ps = b.positions || [];
  const ret = retOf(b);
  const today = b.days?.[0] || { pct: 0, trades: 0 };
  const card = el('article', 'op' + (state.followBot === b.id ? ' sel' : ''));
  card.style.setProperty('--sc', sCol(b));
  card.title = 'Clique para abrir o gráfico com o tempo e as regras deste operador';

  const head = el('div', 'op-head');
  const id = el('div', 'op-id');
  id.append(el('span', 'op-name', b.name), el('span', 'op-strat', STRAT(b.strategy)));
  head.append(el('span', 'op-badge'), id, el('span', 'op-tf', b.tf));
  if (b.paused) head.append(el('span', 'op-paused', 'pausado'));

  const retRow = el('div', 'op-ret');
  // Todos começam com US$ 200: mostra também quanto teria começando com essa mesma grana (na moeda escolhida).
  // Na conta compartilhada a porcentagem é do dinheiro total da conta, e o saldo mostrado é a fatia do robô.
  const in200 = (!b.compartilhado && b.startEquity !== 200) ? `\nem ${fmtMoeda(200, 0)}: ${fmtMoeda(200 * (b.equity + b.openPnl) / b.startEquity, 2)}` : '';
  const rotulo = b.compartilhado
    ? `da conta · desde o início\nfatia ${fmtMoeda(b.equity, 2)}`
    : `desde o início\nsaldo ${fmtMoeda(b.equity, 2)}`;
  retRow.append(el('b', signCls(ret), pctS(ret)), el('small', '', rotulo + in200));
  retRow.lastChild.style.whiteSpace = 'pre-line';

  const stats = el('div', 'op-stats');
  const stat = (label, val, cls = '') => { const d = el('div'); d.append(el('span', '', label), el('b', cls, val)); return d; };
  // Numeros da conta atual (desde o ultimo reset): e o que conta como "acertos" do operador
  const cur = b.cur || { wins: b.wins, trades: b.trades };
  stats.append(
    stat('Hoje', pctS(today.pct), signCls(today.pct)),
    stat('Acertos', cur.trades ? `${cur.wins}/${cur.trades}` : '0/0'),
    stat('Abertas', String(ps.length))
  );

  card.append(head, retRow, sparkline(b), stats);

  const tg = tgtOf(b);
  if (tg) {
    const meta = el('div', 'op-meta');
    const bar = el('div', 'meta-bar'), fill = el('div', 'meta-fill' + (today.pct >= tg ? ' done' : ''));
    fill.style.width = Math.max(0, Math.min(100, today.pct / tg * 100)) + '%';
    bar.appendChild(fill);
    meta.append(el('span', '', today.pct >= tg ? `Meta do dia batida (+${tg}%)` : `Meta do dia +${tg}% · faltam ${Math.max(0, tg - today.pct).toFixed(2)}%`), bar);
    card.appendChild(meta);
  }

  const st = el('div', 'op-status ' + (b.error ? 'err' : ps.length ? 'on' : ''));
  const c0 = b.closest?.[0];
  if (b.error) st.append(el('b', '', 'Erro: '), document.createTextNode(b.error));
  else if (ps.length) st.append(el('b', '', `Em operação (${ps.length})`));
  else {
    st.append(el('b', '', 'Aguardando sinal'));
    if (c0) st.append(document.createTextNode(` · mais perto: ${base(c0.symbol)} ${c0.passed}/${c0.total}`));
  }
  card.appendChild(st);

  if (ps.length) {
    const box = el('div', 'op-pos');
    for (const p of ps) {
      const chip = el('div', 'pos-chip');
      chip.append(
        el('span', '', `${p.dir > 0 ? '▲' : '▼'} ${base(p.symbol)} ${p.dir > 0 ? 'compra' : 'venda'}${p.leverage ? ` ${p.leverage.toFixed(1)}x` : ''}${p.locked ? ' · travado' : ''}`),
        el('span', 'pnl ' + signCls(p.pct), `${pctS(p.pct)} · ${usdS(p.pnl)}`)
      );
      chip.title = `Entrada ${fmt(p.entry)} · stop ${fmt(p.stop)}` + (p.liq ? `\nLiquidação simulada: ${fmt(p.liq)}` : '') + (p.locked ? '\nLucro travado: o stop não deixa voltar abaixo disso' : '') + '\nClique para ver no gráfico';
      chip.addEventListener('click', ev => { ev.stopPropagation(); followBot(b, p.symbol); });
      box.appendChild(chip);
    }
    card.appendChild(box);
  }
  card.addEventListener('click', () => followBot(b));
  return card;
}

// Faixa de números do topo: todos os times juntos
function renderKpis(d) {
  const bots = d.bots;
  const set = (id, v, cls = '') => { $(id).textContent = v; $(id).className = 'kpi-v' + (cls ? ' ' + cls : ''); };
  // "Hoje" do topo: na conta compartilhada, o resultado de hoje da CONTA inteira
  // (a carteira sabe de todos, inclusive dos robôs ocultos). Fora dela, é a média
  // dos robôs, como sempre.
  const cart0 = d.carteira;
  const comp = bots.some(b => b.compartilhado);
  const todayAvg = cart0?.dia?.pct ?? (comp
    ? bots.reduce((s, b) => s + (b.days?.[0]?.pct || 0), 0)
    : bots.reduce((s, b) => s + (b.days?.[0]?.pct || 0), 0) / (bots.length || 1));
  if (comp) {
    const l = $('kpiToday').parentElement.querySelector('.kpi-l');
    if (l) l.textContent = 'Hoje da conta';
    if ($('kpiTodayS')) $('kpiTodayS').textContent = 'dinheiro total da conta';
  }
  set('kpiToday', pctS(todayAvg), signCls(todayAvg) === 'zero' ? '' : signCls(todayAvg));
  const open = bots.reduce((s, b) => s + (b.positions || []).length, 0);
  set('kpiOpen', String(open), open ? 'lit' : '');
  $('kpiOpenS').textContent = open ? [...new Set(bots.flatMap(b => (b.positions || []).map(p => base(p.symbol))))].join(', ') : 'nenhuma agora';
  const tradesToday = bots.reduce((s, b) => s + (b.days?.[0]?.trades || 0), 0);
  set('kpiTrades', String(tradesToday));
  $('kpiTradesS').textContent = 'fechadas hoje';
  // Acerto geral: só do mês em curso (pedido do usuário em 11/11) — o histórico antigo fica em "Mês passado"
  const cur = bots.map(b => (b.months || []).find(m => m.isCurrent)).filter(Boolean);
  const wins = cur.reduce((s, m) => s + (m.wins || 0), 0), n = cur.reduce((s, m) => s + (m.trades || 0), 0);
  const mesNome = cur.length ? MON_LABEL[(cur[0].month || '').slice(5)] : null;
  set('kpiHit', n ? Math.round(wins / n * 100) + '%' : '—');
  $('kpiHitS').textContent = n ? `${wins} de ${n} em ${(mesNome || '').toLowerCase()}` : 'sem operação no mês';

  // A CONTA: o valor real, em reais, do que está em jogo agora.
  // Sem a carteira compartilhada ligada, é a soma das contas de papel dos robôs;
  // com ela ligada, é o saldo da carteira única (R$ 1.000). O mês vem do histórico
  // de cada operador (pnl do mês corrente), também em reais.
  const cart = d.carteira;
  const kw = $('kpiWallet');
  const kwL = $('kpiWalletL');
  const pnlDoMes = bots.reduce((s, b) => { const m = (b.months || []).find(x => x.isCurrent); return s + (m?.pnl || 0); }, 0);
  const mesEmReais = usdS(pnlDoMes);
  if (cart && cart.saldo != null) {
    kw.hidden = false;
    kwL.textContent = 'Carteira compartilhada';
    const inicial = cart.saldoInicial ?? cart.inicial ?? 0;
    const pctC = inicial ? (cart.saldo / inicial - 1) * 100 : 0;
    const wal = fmtMoeda(cart.saldo, 2);
    set('kpiWalletV', wal, pctC > 0 ? 'g' : pctC < 0 ? 'r' : '');
    const v = cart.vagas;
    const usadas = typeof v === 'number' ? v : (v?.ocupadas ?? v?.usadas ?? v?.ativas ?? 0);
    const total = typeof v === 'object' && v ? (v.total ?? v.max ?? 0) : (cart.maxPosicoes ?? 0);
    // O risco em aberto vem em dólar; mostramos também o quanto isso é do saldo.
    const r = typeof cart.riscoAberto === 'number' ? cart.riscoAberto : 0;
    const riscoPct = cart.saldo ? r / cart.saldo * 100 : 0;
    const riscoTxt = r ? `${fmtMoeda(r, 2)} (${riscoPct.toFixed(1)}%)` : fmtMoeda(0, 2);
    const recusas = (cart.recusas || []).length;
    const ultima = (cart.recusas || []).slice(-1)[0];
    // O capital nominal da conta ("R$ 1.000,00 iniciais") é uma verdade em reais:
    // não passa pelo conversor, senão viraria R$ 5.709 (o conversor trataria como dólar).
    const nominal = Number.isFinite(cart.saldoInicialBRL)
      ? (Moeda.modo === 'BRL' ? ' · de ' + Moeda.formatarReal(cart.saldoInicialBRL, 2) + ' iniciais'
                               : ' · de ' + fmtMoeda(cart.saldoInicial, 2) + ' iniciais')
      : '';
    // O resultado mostrado aqui é o DA CONTA (a carteira), não o das contas de papel
    // antigas — senão mistura dois modelos diferentes no mesmo cartão.
    const resConta = Number.isFinite(cart.resultadoPct) ? cart.resultadoPct : 0;
    const resultadoConta = (resConta >= 0 ? '+' : '−') + fmtMoeda(Math.abs(resConta), 2) + ' (' + Math.abs(resConta).toFixed(2) + '%)';
    const detalhe = `${usadas}${total ? '/' + total : ''} vagas · risco ${riscoTxt}${nominal} · resultado ${resultadoConta}${recusas ? ' · ' + recusas + ' recusa' + (recusas > 1 ? 's' : '') : ''}`;
    $('kpiWalletS').textContent = detalhe;
    $('kpiWalletS').title = ultima ? `Última recusa: ${ultima.operador || ''} — ${ultima.motivo || ''}` : detalhe;

    // A faixa de NOTÍNCIA FORTE: só no painel (o dono não quer aviso no celular).
    // A operação continua — quem decide o que fazer com a posição aberta é o dono.
    const box = $('alertaNoticia');
    const alertas = d.alertasNoticia || [];
    if (box) {
      if (alertas.length) {
        const a = alertas[0];
        box.hidden = false;
        $('alertaTitulo').textContent = a.texto || a.titulo || 'Notícia forte';
        const pos = (a.posicoes || []).length;
        $('alertaDetalhe').textContent = pos
          ? `${pos} posição(ões) em jogo agora: ${a.posicoes.slice(0, 3).map(p => `${p.nome} ${p.symbol}`).join(' · ')}${pos > 3 ? '…' : ''} — a operação continua`
          : 'Nenhuma posição aberta agora — a operação continua normalmente';
        $('alertaQuando').textContent = a.quandoTexto || '';
      } else {
        box.hidden = true;
      }
    }
  } else {
    // A carteira compartilhada ainda não subiu no robô (falta reiniciar). Nesse caso
    // mostramos a conta QUE ESTÁ CONFIGURADA (R$ 1.214,43 = R$ 1.000 + novembro) em vez
    // da soma das contas de papel antigas — que é um número de outro modelo e só confunde.
    kw.hidden = false;
    const cc = window.CONTA_COMPARTILHADA;
    if (cc && cc.saldoInicialBRL) {
      kwL.textContent = 'Conta compartilhada';
      set('kpiWalletV', Moeda.modo === 'BRL' ? Moeda.formatarReal(cc.saldoInicialBRL, 2) : fmtMoeda(cc.saldoInicial, 2), '');
      $('kpiWalletS').textContent = `${cc.vagas} vagas · ${cc.porOperador} por operador · risco ${cc.riscoPct}% · entra no reinício`;
      $('kpiWalletS').title = 'Conta compartilhada configurada (R$ 1.000 + o resultado de novembro). O robô precisa ser reiniciado para ela entrar em operação.';
    } else {
      kwL.textContent = 'Conta (simulação)';
      const totalUsd = bots.reduce((s, b) => s + (b.equity || 0), 0);
      set('kpiWalletV', fmtMoeda(totalUsd, 2), '');
      $('kpiWalletS').textContent = `mês ${mesEmReais} · ${bots.length} operadores`;
      $('kpiWalletS').title = 'Soma das contas de papel dos robôs (simulação).';
    }
  }
}

// Coluna "Ao vivo": só as operações abertas agora, de todos os times (as encerradas ficam em "Entradas e saídas")
function renderFeed(d) {
  const open = d.bots.flatMap(b => (b.positions || []).map(p => ({ b, p }))).sort((x, y) => y.p.entryTime - x.p.entryTime);
  const ol = $('liveFeed');
  ol.replaceChildren();
  if (!open.length) { ol.appendChild(el('li', 'feed-empty', 'Nenhuma operação aberta agora.')); return; }
  for (const { b, p } of open) {
    const hrs = (d.now / 1000 - p.entryTime) / 3600;
    const li = el('li', 'entry');
    li.append(
      el('span', 'feed-ic', p.dir > 0 ? '▲' : '▼'),
      el('span', 'feed-t', `${b.name} · ${base(p.symbol)} ${p.dir > 0 ? 'compra' : 'venda'}${p.locked ? ' · travado' : ''}`),
      el('span', 'feed-v ' + (p.pct > 0 ? 'g' : p.pct < 0 ? 'r' : ''), pctS(p.pct)),
      el('span', 'feed-s', `entrou ${ddhhmm(p.entryTime * 1000)} a ${fmt(p.entry)} · há ${hrs < 1 ? Math.round(hrs * 60) + ' min' : hrs.toFixed(1).replace('.', ',') + ' h'} · stop ${fmt(p.stop)}`)
    );
    li.title = 'Clique para ver no gráfico';
    li.style.cursor = 'pointer';
    li.addEventListener('click', () => followBot(b, p.symbol));
    ol.appendChild(li);
  }
}

// Coluna "Perto de entrar": as combinações operador × moeda com mais condições já cumpridas
function renderNear(d) {
  const list = d.bots.flatMap(b => (b.radar || []).filter(r => r.evaluated && !r.inPosition && !r.used && r.total).map(r => ({ b, r })))
    .sort((x, y) => (y.r.passed / y.r.total - x.r.passed / x.r.total) || (y.r.passed - x.r.passed)).slice(0, 6);
  const ol = $('nearList');
  ol.replaceChildren();
  if (!list.length) { ol.appendChild(el('li', 'feed-empty', 'Nenhuma leitura ainda.')); return; }
  for (const { b, r } of list) {
    const li = el('li');
    const top = el('div', 'near-top');
    top.append(el('span', '', `${b.name} · ${base(r.symbol)} ${r.side > 0 ? '▲' : '▼'}`), el('span', 's', `${r.passed}/${r.total}`));
    const bar = el('div', 'near-bar'), fill = el('i');
    fill.style.width = (r.passed / r.total * 100) + '%';
    bar.appendChild(fill);
    li.append(top, bar, el('div', 'near-s', r.missing?.length ? 'Falta: ' + r.missing[0] + (r.missing.length > 1 ? ` (+${r.missing.length - 1})` : '') : 'Tudo pronto: entra na abertura do próximo candle'));
    li.addEventListener('mouseenter', ev => showTip(ev, r, b));
    li.addEventListener('mousemove', moveTip);
    li.addEventListener('mouseleave', hideTip);
    li.addEventListener('click', () => { hideTip(); followBot(b, r.symbol); });
    ol.appendChild(li);
  }
}

// Relógio de Brasília e contagem até o fechamento do candle aberto no gráfico
function tickClock() {
  const now = Date.now();
  $('clock').textContent = new Date(now).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const ms = INTERVAL_MS[state.tf];
  if (!ms) return;
  const end = Math.ceil(now / ms) * ms, left = Math.max(0, end - now);
  const h = Math.floor(left / 3600000), m = Math.floor(left % 3600000 / 60000), sec = Math.floor(left % 60000 / 1000);
  const pad = v => String(v).padStart(2, '0');
  $('kpiNext').textContent = h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  $('kpiNextS').textContent = `candle de ${state.tf} fecha às ${new Date(end).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}`;
  document.querySelector('.kpi-clock')?.style.setProperty('--progress', ((1 - left / ms) * 100).toFixed(1) + '%');
}
setInterval(tickClock, 1000);

function renderBot(d) {
  $('botOff').hidden = true;
  $('botOn').hidden = false;
  $('botHint').textContent = `Simulado, com dinheiro fictício. Atualiza a cada ${d.pollSeconds} s.`;
  const nb = $('botNet');
  if (d.net && !d.net.ok) {
    const mins = Math.round((d.now - d.net.downSince) / 60000);
    nb.hidden = false;
    nb.textContent = `Os robôs estão sem conexão com a Binance há ${mins} min` + (d.net.wifi ? ` (Wi-Fi: ${d.net.wifi})` : '') +
      `. Enquanto isso não conseguem entrar nem sair. Se a rede bloqueia a Binance, troque de Wi-Fi ou use o 4G do celular. ` +
      `Eles tentam de novo a cada ${d.pollSeconds}s e se reiniciam sozinhos. Erro: ${d.net.lastError || '—'}`;
  } else nb.hidden = true;

  if (!d.bots.some(b => b.team === botState.team)) botState.team = d.bots[0]?.team || 'spot';
  renderKpis(d);
  renderFeed(d);
  renderNear(d);
  renderTeamTabs(d);
  const bots = d.bots.filter(b => b.team === botState.team).sort((x, y) => slot(x) - slot(y));
  const dv = { ...d, bots };

  const grid = $('opGrid');
  grid.replaceChildren(...bots.map(opCard));

  if (state.candles.length) Charts.setLevels(currentLevels());
  renderOwner();
  renderBotStatus(dv);
  renderRadar(dv);
  renderBotTrades(dv);
  renderDiary(d);
  if (state.candles.length) Charts.setBotTrades(botMarks());
  if (window.Pregao) Pregao.update(d); // abertura, fita de cotações e Mesa de operações (js/pregao.js)
  if (window.renderShell) window.renderShell(d); // casca do PANTHEON: faixas de cada tela e a colunata
}

// ===== Dia a dia: uma linha por dia, colunas = times e operadores (tipo planilha) =====
const CHANGE_DAYS = { '20/10': 'escalação nova' }; // dias em que as regras mudaram
// Chave do mês (YYYY-MM) de um dia no formato de Brasília
const dayMonth = day => new Date((day * 86400 + 3 * 3600) * 1000).toISOString().slice(0, 7);
const MON_LABEL = { '01': 'Janeiro', '02': 'Fevereiro', '03': 'Março', '04': 'Abril', '05': 'Maio', '06': 'Junho', '07': 'Julho', '08': 'Agosto', '09': 'Setembro', '10': 'Outubro', '11': 'Novembro', '12': 'Dezembro' };
// O mês anterior ao que está em curso (pedido do usuário em 11/11): vira a linha "Mês passado" do Dia a dia
function prevMonth(d) {
  let cur = null;
  for (const b of (d.bots || [])) for (const m of (b.months || [])) if (m.isCurrent) cur = m.month;
  if (!cur) return null;
  const [y, mo] = cur.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 2, 1)); // mês anterior
  const key = dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0');
  return { month: key, label: MON_LABEL[key.slice(5)] || key };
}
// Mês anterior a uma chave YYYY-MM
function prevMonthKey(key) {
  const [y, mo] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 2, 1));
  return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0');
}
const monLabel = key => (MON_LABEL[key.slice(5)] || key).toLowerCase() + '/' + key.slice(0, 4);
// Mês que o "Dia a dia" está mostrando (aba). O pedido do usuário (11/11): um mês por vez, não tudo junto.
const diaryState = { month: null };

function renderDiary(d) {
  const teams = Object.entries(d.teams || {}).map(([id, t]) => [id, t, d.bots.filter(b => b.team === id).sort((x, y) => slot(x) - slot(y))]).filter(x => x[2].length);
  let days = [...new Set(d.bots.flatMap(b => (b.history || b.days || []).map(x => x.day)))].sort((a, b) => b - a);
  if (!days.length) return;
  $('diaryCard').hidden = false;

  // Abas de mês
  const months = [...new Set(days.map(dayMonth))].sort().reverse();
  if (!diaryState.month || !months.includes(diaryState.month)) {
    let cur = null;
    for (const b of (d.bots || [])) for (const m of (b.months || [])) if (m.isCurrent) cur = m.month;
    diaryState.month = (cur && months.includes(cur)) ? cur : months[0];
  }
  const mf = $('diaryMonths');
  mf.replaceChildren();
  for (const mk of months) {
    const btn = el('button', 'chip' + (mk === diaryState.month ? ' on' : ''), monLabel(mk));
    btn.addEventListener('click', () => { diaryState.month = mk; renderDiary(botState.data); });
    mf.appendChild(btn);
  }
  days = days.filter(dd => dayMonth(dd) === diaryState.month);
  const mSel = diaryState.month;
  const monthOf = b => (b.months || []).find(x => x.month === mSel);

  const stat = (b, day) => (b.history || b.days || []).find(x => x.day === day);
  const t = $('diaryTable');
  t.replaceChildren();
  const thead = el('thead'), g = el('tr'), h = el('tr');
  g.appendChild(el('th', 'grp', ''));
  h.appendChild(el('th', '', 'Dia'));
  for (const [, tm, bots] of teams) {
    const th = el('th', 'grp', tm.name); th.colSpan = bots.length; g.appendChild(th);
    for (const b of bots) {
      const c = el('th'); const dot = el('span', 'sdot'); dot.style.background = sCol(b);
      c.append(dot, document.createTextNode(b.name.replace(/^\S+ /, '#')));
      c.title = `${b.name} – ${STRAT(b.strategy)} · ${b.tf}`;
      h.appendChild(c);
    }
  }
  // Coluna final: soma das % de todos os operadores no dia (pedido do usuário)
  const gt = el('th', 'grp', 'Resultado do dia'); g.appendChild(gt);
  h.appendChild(el('th', 'team day-total', 'Soma de todos'));
  thead.append(g, h); t.appendChild(thead);
  // Cada quadrado mostra a %, as operações (acertos/total) e o VALOR em dinheiro
  const cell = (pct, w, n, money = 0, cls = '', always = false) => {
    const show = n || always;
    const td = el('td', cls + ' ' + (show ? signCls(pct) : 'zero'), show ? pctS(pct) : '—');
    if (show) td.appendChild(el('small', '', `${w}/${n}` + (money ? ' · ' + usdS(money) : '')));
    return td;
  };
  const tb = el('tbody');
  for (const day of days) {
    const label = dayLabel(day);
    const tr = el('tr', CHANGE_DAYS[label] ? 'mark' : '');
    const dd = el('td', 'day', label);
    dd.appendChild(el('small', '', CHANGE_DAYS[label] || new Date((day * 86400 + 15 * 3600) * 1000).toLocaleDateString('pt-BR', { weekday: 'short' })));
    tr.appendChild(dd);
    // Sem coluna de soma por time (pedido do usuário em 26/10): só os operadores e, no fim, a soma de todos
    for (const [, , bots] of teams) {
      for (const b of bots) {
        const x = stat(b, day);
        tr.appendChild(cell(x?.pct || 0, x?.wins || 0, x?.trades || 0, x?.pnl || 0));
      }
    }
    const all = teams.flatMap(([, , bots]) => bots.map(b => stat(b, day)).filter(Boolean));
    tr.appendChild(cell(all.reduce((s, x) => s + x.pct, 0), all.reduce((s, x) => s + (x.wins || 0), 0), all.reduce((s, x) => s + x.trades, 0), all.reduce((s, x) => s + (x.pnl || 0), 0), 'team day-total'));
    tb.appendChild(tr);
  }
  // Total do mês escolhido na aba
  const tot = el('tr', 'total');
  const td0 = el('td', 'day', 'Total');
  td0.appendChild(el('small', '', monLabel(mSel)));
  tot.appendChild(td0);
  let tw = 0, tn = 0, tp = 0, tmoney = 0;
  for (const [, , bots] of teams) {
    for (const b of bots) {
      const m = monthOf(b);
      tot.appendChild(cell(m ? m.pct : 0, m ? m.wins : 0, m ? m.trades : 0, m ? m.pnl : 0, '', true));
      if (m) { tw += m.wins; tn += m.trades; tp += m.pct; tmoney += m.pnl; }
    }
  }
  tot.appendChild(cell(tp, tw, tn, tmoney, 'team day-total', true));
  tb.appendChild(tot);

  // Mês passado: o mês anterior ao que está na aba (só aparece se houver dados)
  const pKey = prevMonthKey(mSel);
  const hasPrev = d.bots.some(b => (b.months || []).some(x => x.month === pKey));
  if (hasPrev) {
    const pr = el('tr', 'total');
    const pd0 = el('td', 'day', 'Mês passado');
    pd0.appendChild(el('small', '', monLabel(pKey)));
    pr.appendChild(pd0);
    let pw = 0, pn = 0, pp = 0, pmoney = 0;
    for (const [, , bots] of teams) {
      for (const b of bots) {
        const m = (b.months || []).find(x => x.month === pKey);
        pr.appendChild(cell(m ? m.pct : 0, m ? m.wins : 0, m ? m.trades : 0, m ? (m.pnl || 0) : 0));
        if (m) { pw += m.wins; pn += m.trades; pp += m.pct; pmoney += m.pnl || 0; }
      }
    }
    pr.appendChild(cell(pp, pw, pn, pmoney, 'team day-total'));
    tb.appendChild(pr);
  }
  t.appendChild(tb);
  $('diaryHint').textContent = `${days.length} dias · ${monLabel(mSel)}`;
}

// ===== Estudos: o que os operadores testaram hoje + biblioteca de estudos =====
const SHOW_STUDIES = false;
const studyState = { tab: 'today', data: null };
const VERDICT = { keep: ['Manter', 'v-keep'], candidate: ['Candidata', 'v-cand'], weak: ['Precisa de outra estratégia', 'v-weak'], few: ['Poucos dados', 'v-few'] };
const rS = v => v == null ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2).replace('.', ',') + 'R';
async function pollStudies() {
  try {
    if (MODO_DEMO) return; // cópia estática: os estudos ficam no robô, não na cópia
    const res = await fetch('/api/studies', { cache: 'no-store' });
    if (!res.ok) return;
    studyState.data = await res.json();
    renderStudies();
  } catch (e) {}
}
function renderStudies() {
  const d = studyState.data;
  if (!d) return;
  if (!SHOW_STUDIES) return; // estudos seguem rodando no robô; resultados vão para a reunião
  $('studyCard').hidden = false;
  const tabs = $('studyTabs');
  tabs.replaceChildren();
  for (const [id, label] of [['today', 'Estudo de hoje'], ['library', `Biblioteca (${d.library.length})`]]) {
    const b = el('button', 'chip' + (studyState.tab === id ? ' on' : ''), label);
    b.addEventListener('click', () => { studyState.tab = id; renderStudies(); });
    tabs.appendChild(b);
  }
  const box = $('studyBody');
  box.replaceChildren();
  if (studyState.tab === 'library') {
    const grid = el('div', 'lib-grid');
    for (const s of d.library) {
      const card = el('article', 'lib-card');
      const head = el('div', 'lib-head');
      head.append(el('span', 'lib-date', s.date), el('span', 'lib-status st-' + s.status, s.status));
      card.append(head, el('h3', 'lib-title', s.title), el('p', 'lib-q', s.question));
      for (const [k, v] of [['Como testamos', s.method], ['Resultado', s.result], ['Decisão', s.decision]]) {
        const p = el('p', 'lib-p'); p.append(el('b', '', k + ': '), document.createTextNode(v)); card.appendChild(p);
      }
      grid.appendChild(card);
    }
    box.appendChild(grid);
    $('studyHint').textContent = 'Tudo o que já foi testado, o resultado e o que foi decidido.';
    return;
  }
  const run = d.latest;
  if (!run || !run.ops?.length) { box.appendChild(el('p', 'feed-empty', 'O primeiro estudo roda assim que o robô terminar de baixar os dados.')); return; }
  $('studyHint').textContent = `Rodou em ${new Date(run.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}. Todo dia às 04:00 cada operador testa a própria regra nos dados recentes. Nada é mudado sozinho.`;
  const wrap = el('div', 'table-wrap'), t = el('table', 'cmp study-table');
  const head = el('tr');
  ['Operador', 'Regra atual no período', 'Variações testadas (média por operação)', 'Conclusão'].forEach(h => head.appendChild(el('th', '', h)));
  const thead = el('thead'); thead.appendChild(head); t.appendChild(thead);
  const tb = el('tbody');
  const teamOrder = ['spot', 'futuros', 'swing'];
  const ops = [...run.ops].sort((a, b) => teamOrder.indexOf(a.team) - teamOrder.indexOf(b.team) || slot(a) - slot(b));
  for (const o of ops) {
    const tr = el('tr');
    const nm = el('td'); nm.append(el('b', '', o.name), el('div', 'st-sub', `${STRAT(o.strategy)} · ${o.tf}`));
    nm.style.boxShadow = `inset 3px 0 0 ${SCOL_S[o.strategy] || 'transparent'}`;
    const c = o.current;
    const cur = el('td', c.avgR > 0 ? 'pos' : c.avgR < 0 ? 'neg' : '', rS(c.avgR));
    cur.appendChild(el('div', 'st-sub', c.n ? `${c.n} operações, ${Math.round(c.w / c.n * 100)}% de acerto, ${Math.round(c.days)} dias` : 'sem operações'));
    const vars = el('td', 'st-vars');
    for (const v of [...o.variants].sort((a, b) => (b.avgR ?? -9) - (a.avgR ?? -9))) {
      const better = v.avgR != null && c.avgR != null && v.avgR - c.avgR >= 0.1 && v.n >= 20;
      const chip = el('span', 'st-chip' + (better ? ' up' : ''), `${v.label} ${rS(v.avgR)}`);
      chip.title = `${v.n} operações${v.n ? `, ${Math.round(v.w / v.n * 100)}% de acerto` : ''}`;
      vars.appendChild(chip);
    }
    const [vl, vc] = VERDICT[o.verdict.kind] || ['—', ''];
    const ver = el('td', 'st-ver');
    ver.append(el('span', 'verdict ' + vc, vl), el('div', 'st-sub', o.verdict.text));
    tr.append(nm, cur, vars, ver);
    tb.appendChild(tr);
  }
  t.appendChild(tb); wrap.appendChild(t); box.appendChild(wrap);
}
pollStudies();
setInterval(pollStudies, 5 * 60 * 1000);

// Faixa de status: deixa claro que está tudo ligado e vigiando
function renderBotStatus(d) {
  const combos = d.bots.reduce((s, b) => s + b.symbols.length, 0);
  const tfs = [...new Set(d.bots.map(b => b.tf))];
  const next = tfs.map(tf => `${tf} às ${hhmm(Math.ceil(d.now / INTERVAL_MS[tf]) * INTERVAL_MS[tf])}`).join(' · ');
  const ago = d.lastCycleAt ? Math.round((d.now - d.lastCycleAt) / 1000) : null;
  const open = d.bots.reduce((s, b) => s + (b.positions || []).length, 0);
  $('botStatus').className = 'bot-status ' + (d.net && !d.net.ok ? 'err' : 'ok');
  $('botStatus').textContent =
    `${d.net && !d.net.ok ? 'Atenção:' : ''} ${d.teams?.[botState.team]?.name || ''}: ${d.bots.length} operadores ligados · vigiando ${combos} combinações de moeda × operador · ` +
    `${open} posição(ões) aberta(s) · último ciclo ${ago == null ? '—' : `há ${ago}s`} · próximos fechamentos: ${next}`;
}

// ===== Tooltip do radar: checklist completo + explicação dos termos =====
const GLOSSARY = [
  ['EMA 200', 'EMA 200 = média dos últimos 200 candles. Preço acima dela = tendência de fundo de alta; abaixo = de baixa.'],
  ['EMA 21', 'EMA 21 = média dos últimos 21 candles (tendência de curto prazo). No pullback é o "ponto de apoio" da correção.'],
  ['EMA 9', 'EMA 9 = média dos últimos 9 candles (a mais rápida).'],
  ['EMA 50', 'EMA 50 = média dos últimos 50 candles (tendência intermediária).'],
  ['ADX', 'ADX = força da tendência. Abaixo de 20 o mercado anda de lado; acima de 25 há tendência forte.'],
  ['DI', '+DI/−DI = mostram se a força é compradora (+DI) ou vendedora (−DI).'],
  ['HTF', 'Tendência maior (HTF) = a tendência do tempo maior (4h para quem opera 15m, 1h para 5m). Operar a favor dela aumenta a chance.'],
  ['CHoCH', 'CHoCH = quebra de estrutura: o preço fecha além do último topo/fundo contrário. É o primeiro sinal de virada.'],
  ['Estrutura anterior', 'Estrutura = sequência de topos e fundos. Topos e fundos caindo = baixa; subindo = alta.'],
  ['Divergência', 'Divergência = o preço faz um novo topo/fundo mas o RSI não acompanha: a força do movimento está acabando.'],
  ['Supertrend', 'Supertrend = linha que segue o preço; quando o preço a cruza, ela muda de cor e de lado (virada de tendência).'],
  ['RSI', 'RSI = força do movimento de 0 a 100. Acima de 70 está esticado para cima; abaixo de 30, para baixo.'],
  ['MACD', 'MACD = aceleração do movimento. Histograma subindo = acelerando para cima.'],
  ['Volume', 'Volume ≥ média = o movimento tem participação de verdade (mais gente negociando).'],
  ['Pullback', 'Pullback = correção temporária contra a tendência, que costuma ser uma boa hora de entrar a favor dela.'],
  ['20 candles', 'Canal de 20 = máxima e mínima dos últimos 20 candles. Fechar fora dele é um rompimento.'],
  ['ATR', 'ATR = tamanho médio de um candle. O stop é colocado a alguns ATRs de distância para não ser tocado por ruído.'],
  ['VWAP', 'VWAP = preço médio do dia ponderado pelo volume.'],
  ['Candle', 'Candle = cada "vela" do gráfico (5, 15 min ou 1 hora, conforme o operador).']
];
const GROUP_TXT = {
  filtro: 'FILTROS — todos precisam estar ✔ (dizem se o lado é permitido)',
  gatilho: 'GATILHO — o momento exato da entrada (precisa estar ✔)',
  'confirmação': 'CONFIRMAÇÕES — reforçam a entrada'
};

function showTip(ev, r, b) {
  const tip = $('tip');
  tip.replaceChildren();
  tip.appendChild(el('div', 'tip-title', `${b.name} · ${base(r.symbol)} · ${b.tf}`));
  if (r.inPosition) {
    tip.appendChild(el('div', '', `Em posição (${r.dir > 0 ? 'COMPRA' : 'VENDA'}). Clique para ver no gráfico.`));
  } else if (!r.evaluated) {
    tip.appendChild(el('div', '', 'Ainda não fechou o primeiro candle desde que o operador ligou.'));
  } else {
    tip.appendChild(el('div', 'tip-sub', `Candle das ${hhmm(r.time * 1000)} · ${r.passed} de ${r.total} condições ok · lado mais perto: ${r.side > 0 ? 'COMPRA' : 'VENDA'}`));
    if (r.used) tip.appendChild(el('div', 'tip-mem', '✓ Este foi o sinal que gerou a última entrada nesta moeda (já usado). No próximo fechamento de candle aparece a leitura nova.'));
    let g = null;
    for (const c of r.checks || []) {
      if (c.g !== g) { g = c.g; tip.appendChild(el('div', 'tip-group', GROUP_TXT[g] || g)); }
      tip.appendChild(el('div', 'tip-item ' + (c.ok ? 'ok' : 'no'), `${c.ok ? '✔' : '✘'} ${c.l}`));
    }
    const text = (r.checks || []).map(c => c.l).join(' ');
    const terms = GLOSSARY.filter(([k]) => text.includes(k)).map(([, v]) => v);
    if (terms.length) {
      tip.appendChild(el('div', 'tip-group', 'O QUE SIGNIFICA'));
      terms.forEach(t => tip.appendChild(el('div', 'tip-gloss', t)));
    }
  }
  tip.hidden = false;
  moveTip(ev);
}
function moveTip(ev) {
  const tip = $('tip');
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = ev.clientX + 16, y = ev.clientY + 16;
  if (x + w > window.innerWidth - 8) x = ev.clientX - w - 16;
  if (y + h > window.innerHeight - 8) y = Math.max(8, window.innerHeight - h - 8);
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
const hideTip = () => { $('tip').hidden = true; };

// Radar: operadores × moedas, com a última leitura de cada combinação
function renderRadar(d) {
  $('radarCard').hidden = false;
  const t = $('radarTable');
  t.replaceChildren();
  // Colunas = todas as moedas vigiadas por alguém do time (o Time Swing tem operadores com 20 moedas)
  const syms = [...new Set([...d.symbols, ...d.bots.flatMap(b => b.symbols)])];
  const head = el('tr');
  ['Operador', ...syms.map(base)].forEach((h, k) => head.appendChild(el('th', k && syms[k - 1] === state.symbol ? 'cur' : '', h)));
  const thead = el('thead'); thead.appendChild(head); t.appendChild(thead);
  const tb = el('tbody');
  for (const b of d.bots) {
    const tr = el('tr');
    const nm = el('td', 'rd-name', `${b.name} – ${STRAT(b.strategy)} · ${b.tf}`);
    nm.style.boxShadow = `inset 3px 0 0 ${sCol(b)}`;
    nm.style.paddingLeft = '12px';
    tr.appendChild(nm);
    for (const s of syms) {
      const r = (b.radar || []).find(x => x.symbol === s);
      let td;
      if (!r) td = el('td', 'rd-off', '—');
      else if (r.inPosition) td = el('td', r.dir > 0 ? 'rd-buy' : 'rd-sell', r.dir > 0 ? '▲ COMPRA' : '▼ VENDA');
      else if (!r.evaluated) td = el('td', 'rd-wait', 'aguarda');
      else if (r.used) td = el('td', 'rd-wait', '✓ entrou');
      else {
        const ratio = r.passed / r.total;
        td = el('td', ratio >= 0.75 ? 'rd-hi' : ratio >= 0.5 ? 'rd-mid' : 'rd-lo', `${r.passed}/${r.total}`);
      }
      if (s === state.symbol && b.id === state.followBot) td.classList.add('rd-cur');
      if (r) {
        td.addEventListener('mouseenter', ev => showTip(ev, r, b));
        td.addEventListener('mousemove', moveTip);
        td.addEventListener('mouseleave', hideTip);
      }
      td.addEventListener('click', () => { hideTip(); followBot(b, s); });
      tr.appendChild(td);
    }
    tb.appendChild(tr);
  }
  t.appendChild(tb);
  $('radarHint').textContent = 'Todas as moedas vigiadas ao mesmo tempo, com a última leitura de cada uma.';
}

// Todas as operações do time (abertas primeiro), com filtro por operador
function renderBotTrades(d) {
  $('tradesCard').hidden = false;
  const f = $('tradeFilter');
  if (!f.childElementCount) {
    for (const [id, label] of [['all', 'Todos'], ...d.bots.map(b => [b.id, b.name])]) {
      const btn = el('button', 'chip' + (id === botState.tradeFilter ? ' on' : ''), label);
      btn.dataset.id = id;
      btn.addEventListener('click', () => {
        botState.tradeFilter = id;
        botState.tradePage = 0;
        f.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.id === id));
        renderBotTrades({ ...botState.data, bots: botState.data.bots.filter(b => b.team === botState.team) });
      });
      f.appendChild(btn);
    }
  }
  const rows = [];
  for (const b of d.bots) {
    if (botState.tradeFilter !== 'all' && botState.tradeFilter !== b.id) continue;
    for (const p of b.positions || []) rows.push({ b, t: p, open: true });
    for (const t of b.recentTrades || []) rows.push({ b, t, open: false });
  }
  rows.sort((x, y) => (y.open - x.open) || (y.t.entryTime - x.t.entryTime));
  const body = $('tradesBody');
  body.replaceChildren();
  // Paginação: 10 por página (pedido do usuário em 11/11); abertas sempre na primeira
  const PER = 10, pages = Math.max(1, Math.ceil(rows.length / PER));
  botState.tradePage = Math.min(botState.tradePage || 0, pages - 1);
  const pg = $('tradePager');
  pg.replaceChildren();
  if (pages > 1) {
    const go = k => { botState.tradePage = k; renderBotTrades({ ...botState.data, bots: botState.data.bots.filter(b => b.team === botState.team) }); };
    const prev = el('button', 'chip', '‹ Anterior'); prev.disabled = botState.tradePage === 0; prev.addEventListener('click', () => go(botState.tradePage - 1));
    pg.appendChild(prev);
    for (let k = 0; k < pages; k++) { const b = el('button', 'chip' + (k === botState.tradePage ? ' on' : ''), String(k + 1)); b.addEventListener('click', () => go(k)); pg.appendChild(b); }
    const next = el('button', 'chip', 'Próxima ›'); next.disabled = botState.tradePage === pages - 1; next.addEventListener('click', () => go(botState.tradePage + 1));
    pg.appendChild(next);
    pg.appendChild(el('span', 'pager-info', `${rows.length} operações · página ${botState.tradePage + 1} de ${pages}`));
  }
  for (const { b, t, open } of rows.slice(botState.tradePage * PER, botState.tradePage * PER + PER)) {
    const pct = open ? t.pct : tradePct(t);
    const rNow = open ? t.pnl / (Math.abs(t.entry - t.initialStop) * t.qty) : t.r;
    const cells = [
      ddhhmm(t.entryTime * 1000), `${b.name} – ${STRAT(b.strategy)}`, base(t.symbol), t.dir > 0 ? '▲ COMPRA' : '▼ VENDA',
      t.leverage ? t.leverage.toFixed(1) + 'x' : t.allIn ? '100% saldo' : '—',
      fmt(t.entry), fmt(open ? t.stop : t.initialStop) + (t.locked ? ' (travado)' : ''), t.target != null ? fmt(t.target) : (t.leverage || t.allIn ? 'trava de lucro' : 'móvel'),
      open ? (t.price != null ? `agora ${fmt(t.price)}` : '—') : `${fmt(t.exit)} (${ddhhmm(t.exitTime * 1000)})`,
      usdS(t.pnl), pctS(pct), open ? 'ABERTA' : t.why
    ];
    const tr = el('tr', open ? 'open-row' : '');
    const NUMCOL = new Set([4, 5, 6, 7, 9, 10]); // alav., preço, stop, alvo, resultado, % — números à direita
    cells.forEach((v, k) => {
      const td = el('td', NUMCOL.has(k) ? 'num' : '', v);
      if (k === 3) td.className = 'side';
      if (k === 9 || k === 10) td.className = (td.className + ' ' + (t.pnl >= 0 ? 'pos' : 'neg')).trim();
      tr.appendChild(td);
    });
    tr.title = `Clique para ver no gráfico.\nEm R: ${signed(rNow, 2)}R (R = quanto o operador arriscou nesta operação; +2R = ganhou o dobro do que arriscou).`;
    tr.addEventListener('click', () => followBot(b, t.symbol));
    body.appendChild(tr);
  }
  if (!rows.length) {
    const tr = el('tr');
    const td = el('td', 'empty', 'Nenhuma operação ainda neste time. Os operadores só entram quando o padrão completo aparece (veja o radar: quanto mais perto de x/x, mais perto da entrada).');
    td.colSpan = 12;
    tr.appendChild(td);
    body.appendChild(tr);
  }
  const all = d.bots.flatMap(b => b.recentTrades || []);
  const tot = all.reduce((s, t) => s + t.pnl, 0);
  $('tradesHint').textContent = `${d.bots.reduce((s, b) => s + (b.positions || []).length, 0)} abertas, ${all.length} fechadas, resultado das fechadas ${usdS(tot)}`;
}

// Resultado por dia (%), últimos 7 dias
function renderDaily(d) {
  $('dailyCard').hidden = false;
  const t = $('dailyTable');
  t.replaceChildren();
  const days = d.bots[0]?.days || [];
  const head = el('tr');
  ['Operador', ...days.map((x, k) => k === 0 ? `Hoje (${dayLabel(x.day)})` : dayLabel(x.day)), '7 dias'].forEach(h => head.appendChild(el('th', '', h)));
  const thead = el('thead'); thead.appendChild(head); t.appendChild(thead);
  const tb = el('tbody');
  const tgtOf = b => ((b.leverage || b.lock)?.dailyTargetPct || 0) * 100;
  for (const b of d.bots) {
    const tr = el('tr');
    tr.appendChild(el('td', 'rd-name', b.name));
    let sum = 0;
    for (const x of b.days || []) {
      sum += x.pct;
      const td = el('td', x.trades ? (x.pct >= 0 ? 'pos' : 'neg') : 'zero', x.trades ? pctS(x.pct) + (tgtOf(b) && x.pct >= tgtOf(b) ? ' meta' : '') : '—');
      td.title = `${x.trades} operação(ões) fechada(s) · ${usdS(x.pnl)}`;
      tr.appendChild(td);
    }
    tr.appendChild(el('td', sum > 0 ? 'pos' : sum < 0 ? 'neg' : 'zero', pctS(sum)));
    tb.appendChild(tr);
  }
  t.appendChild(tb);
  const tg0 = d.bots.length ? tgtOf(d.bots[0]) : 0;
  $('dailyHint').textContent = tg0 ? `· meta do time: +${tg0}% ao dia (a palavra “‘meta’” marca a meta batida)` : '· este time não tem meta: deixa o lucro correr';
}

// ===== Operações dos robôs desenhadas no gráfico (moeda e tempo abertos) =====
function botMarks() {
  const d = botState.data;
  if (!d) return [];
  const out = [];
  for (const b of d.bots.filter(b => b.tf === state.tf)) {
    for (const p of (b.positions || []).filter(p => p.symbol === state.symbol)) {
      out.push({ time: p.entryTime, kind: 'entry', dir: p.dir, text: `${b.name} ${p.dir > 0 ? 'COMPRA' : 'VENDA'}` });
    }
    for (const t of (b.recentTrades || []).filter(t => t.symbol === state.symbol)) {
      out.push({ time: t.entryTime, kind: 'entry', dir: t.dir, text: `${b.name} ${t.dir > 0 ? 'COMPRA' : 'VENDA'}` });
      out.push({ time: t.exitTime, kind: 'exit', dir: t.dir, win: t.pnl > 0, text: `${b.name} ${pctS(tradePct(t), 1)}` });
    }
  }
  return out;
}

// ===== Curva do saldo (% desde o início), uma linha por operador do time =====
const CURVE_COLORS = ['#e09030', '#4a90d9', '#2ebd85', '#9b6bd4', '#e04060', '#50c8dc', '#d4c34a', '#e8eaf0'];
function renderCurve(d) {
  $('curveCard').hidden = false;
  const LC = window.LightweightCharts;
  if (!botState.curveChart) {
    botState.curveChart = LC.createChart($('curveChart'), {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#8b90a0', fontFamily: 'Courier New, monospace' },
      grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
      timeScale: { borderColor: 'rgba(255,255,255,0.08)', timeVisible: true, secondsVisible: false },
      localization: { priceFormatter: v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%' }
    });
    botState.curveSeries = [];
  }
  botState.curveSeries.forEach(s => botState.curveChart.removeSeries(s));
  botState.curveSeries = [];
  const legend = $('curveLegend');
  legend.replaceChildren();
  const local = t => t - new Date(t * 1000).getTimezoneOffset() * 60;
  d.bots.forEach((b, k) => {
    const color = CURVE_COLORS[k % CURVE_COLORS.length];
    const s = botState.curveChart.addLineSeries({ color, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: b.name });
    const byT = new Map();
    for (const p of b.curve || []) byT.set(local(p.t), (p.eq / b.startEquity - 1) * 100);
    const pts = [...byT.entries()].sort((x, y) => x[0] - y[0]).map(([time, value]) => ({ time, value }));
    if (pts.length) s.setData(pts);
    botState.curveSeries.push(s);
    const last = pts.length ? pts[pts.length - 1].value : 0;
    const chip = el('span', 'curve-chip');
    const dot = el('span', 'chip-dot'); dot.style.background = color; dot.style.opacity = 1;
    chip.append(dot, document.createTextNode(`${b.name} ${pctS(last)}`));
    legend.appendChild(chip);
  });
  botState.curveChart.priceScale('right').applyOptions({ autoScale: true });
  botState.curveChart.timeScale().fitContent();
}

// ===== Ranking do time =====
function renderRanking(d) {
  $('rankCard').hidden = false;
  const rows = d.bots.map(b => ({
    b, today: b.days?.[0]?.pct || 0, week: (b.days || []).reduce((s, x) => s + x.pct, 0),
    total: ((b.equity + b.openPnl) / b.startEquity - 1) * 100
  })).sort((x, y) => y.total - x.total);
  const body = $('rankBody');
  body.replaceChildren();
  rows.forEach((r, k) => {
    const tr = el('tr');
    tr.append(
      el('td', 'rank-medal', ['🥇', '🥈', '🥉'][k] || `${k + 1}º`),
      el('td', 'rd-name', `${r.b.name} · ${r.b.tf}`),
      el('td', r.today > 0 ? 'pos' : r.today < 0 ? 'neg' : '', pctS(r.today)),
      el('td', r.week > 0 ? 'pos' : r.week < 0 ? 'neg' : '', pctS(r.week)),
      el('td', r.total > 0 ? 'pos' : r.total < 0 ? 'neg' : '', pctS(r.total))
    );
    tr.addEventListener('click', () => followBot(r.b));
    body.appendChild(tr);
  });
}

// ===== Esperado (histórico) × realizado (ao vivo) =====
function renderExpect(d) {
  $('expectCard').hidden = false;
  const body = $('expectBody');
  body.replaceChildren();
  for (const b of d.bots) {
    const e = b.expected, l = b.live;
    const toPct = r => r * b.riskPct * 100; // R → % da conta
    let verdict = ['neut', 'poucos dados'];
    if (l && l.n >= 10 && e) {
      const diff = l.avgR - e.avgR;
      verdict = diff >= 0.15 ? ['bull', 'acima do esperado'] : diff <= -0.3 ? ['bear', 'abaixo do esperado'] : ['neut', 'dentro do esperado'];
    }
    const tr = el('tr');
    const badge = el('span', 'badge ' + verdict[0], verdict[1]);
    const tdV = el('td'); tdV.appendChild(badge);
    tr.append(
      el('td', 'rd-name', b.name),
      el('td', '', e ? `${pctTxt(e.winRate)} · ${pctS(toPct(e.avgR), 2)} por op. (${e.n} op. no histórico)` : '—'),
      el('td', l ? (l.avgR >= 0 ? 'pos' : 'neg') : '', l ? `${pctTxt(l.winRate)} · ${pctS(toPct(l.avgR), 2)} por op. (${l.n} op. ao vivo)` : 'sem operações ainda'),
      tdV
    );
    body.appendChild(tr);
  }
}

// O que cada operador aprendeu
function renderMemory(d) {
  $('memoryCard').hidden = false;
  const box = $('memoryBox');
  box.replaceChildren();
  for (const b of d.bots) {
    const m = b.memory || { rules: [], notes: [], samples: 0 };
    const card = el('div', 'mem-item');
    card.appendChild(el('div', 'bot-name', `${b.name} · memória com ${m.samples} operações (histórico + ao vivo)`));
    if (m.rules.length) m.rules.forEach(r => card.appendChild(el('div', 'mem-rule', '🧠 ' + r)));
    else card.appendChild(el('div', 'bot-mind', 'Nenhuma regra ativa: ainda não há um contexto com erros repetidos suficientes para mudar o comportamento.'));
    m.notes.slice(0, 3).forEach(n => card.appendChild(el('div', 'bot-mind', `${ddhhmm(n.at)} · ${n.text}`)));
    box.appendChild(card);
  }
}

const currentLevels = () => (state.levels || []).concat(botLevels());

// Regras padrão do painel (para voltar a elas quando deixar de seguir um robô)
const CFG_DEFAULTS = JSON.parse(JSON.stringify(SIGNAL_CFG));

function restoreDefaults() {
  for (const k of Object.keys(SIGNAL_CFG)) SIGNAL_CFG[k] = { ...CFG_DEFAULTS[k] };
  state.followBot = null;
}

// Mostra no gráfico exatamente o que o robô vê: timeframe, estratégia, parâmetros e moeda
// (sem moeda indicada: a da 1ª posição aberta, ou a atual se o robô opera ela, ou a mais perto de sinal)
function followBot(b, symbol) {
  restoreDefaults();
  if (b.params) Object.assign(SIGNAL_CFG[b.strategy], b.params);
  state.followBot = b.id;
  store.set('followBot', b.id);
  state.strategy = b.strategy;
  $('stratSelect').value = b.strategy;
  state.symbol = symbol || b.positions?.[0]?.symbol ||
    (b.symbols.includes(state.symbol) ? state.symbol : b.closest?.[0]?.symbol || b.symbols[0]);
  load(b.tf);
  $('chartBox').scrollIntoView({ behavior: 'smooth' });
}

// O robô que opera exatamente a combinação aberta no painel (se houver)
function botForView() {
  return botState.data?.bots.find(b => b.tf === state.tf && b.strategy === state.strategy && b.symbols.includes(state.symbol)) || null;
}

// Posições dos robôs na moeda e timeframe abertos aparecem no gráfico
function botLevels() {
  const d = botState.data;
  if (!d) return [];
  return d.bots.filter(b => b.tf === state.tf).flatMap(b => (b.positions || []).filter(p => p.symbol === state.symbol).flatMap(p => [
    { price: p.entry, color: '#FFB000', title: `${b.name}`, width: 2, style: Charts.LineStyle.Solid },
    { price: p.stop, color: '#FF5C7A', title: 'stop', width: 2, style: Charts.LineStyle.Solid },
    ...(p.target != null ? [{ price: p.target, color: '#2FE6A5', title: 'alvo', width: 2, style: Charts.LineStyle.Solid }] : [])
  ]));
}

// ===== Alerta de novo sinal =====
let audioCtx = null;
document.addEventListener('click', () => { try { audioCtx = audioCtx || new AudioContext(); } catch (e) {} });

function alertSignal(sig) {
  try {
    if (audioCtx) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = sig.direction === 'COMPRA' ? 880 : 440;
      g.gain.value = 0.08;
      o.connect(g).connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + 0.3);
    }
  } catch (e) {}
  const box = $('signalBox');
  box.classList.add('flash');
  setTimeout(() => box.classList.remove('flash'), 3000);
}

// ===== Polling do /api/live (conta real MEXC) =====
const liveState = { data: null, busy: false, interval: null };

async function pollLive() {
  if (liveState.busy) return;
  liveState.busy = true;
  try {
    if (MODO_DEMO) return; // cópia estática: não há conta real para consultar
    const res = await fetch('/api/live', { cache: 'no-store' });
    const data = await res.json();
    liveState.data = data;
    renderReal(data);
  } catch (e) {
    // Silencioso: se o endpoint não existir (bot antigo), não quebra nada
  } finally {
    liveState.busy = false;
  }
}

function renderReal(d) {
  const card = $('realCard');
  if (!card) return;
  if (!d) { card.hidden = true; return; }

  // A conta real pode estar desligada — nesse caso o bloco aparece com o aviso
  // do que falta, em vez de sumir (some quando nem existe config de exchange).
  if (!d.real) {
    if (!d.error && d.semConfig) { card.hidden = true; return; }
    card.hidden = false;
    const aviso = $('realAviso'), grid = $('realGrid');
    if (aviso) aviso.hidden = false;
    if (grid) grid.hidden = true;
    const txt = $('realAvisoTexto');
    if (txt) txt.textContent = d.error ? `Motivo: ${d.error}.` : '';
    const hint = $('realHint');
    if (hint) hint.textContent = 'aguardando configuração';
    const $kr = $('kpiReal');
    if ($kr) $kr.hidden = true;
    return;
  }

  card.hidden = false;
  const aviso = $('realAviso'), grid = $('realGrid');
  if (aviso) aviso.hidden = true;
  if (grid) grid.hidden = false;

  // KPI do topo
  const $kr = $('kpiReal'), $krV = $('kpiRealV'), $krS = $('kpiRealS');
  if ($kr) {
    if (d.real && d.account) {
      $kr.hidden = false;
      if ($krV) { $krV.textContent = fmtMoeda(Moeda.converter(d.account.equity || 0), 2); }
      const ops = (d.todayOps || []).length;
      const pnl = d.todayPnl || 0;
      if ($krS) $krS.textContent = `${ops} op. hoje · ${d.positions.length} posição(ões) aberta(s)`;
    } else {
      $kr.hidden = true;
    }
  }

  // Dica no título
  const hint = $('realHint');
  if (hint) hint.textContent = d.error || '';

  // Saldo
  const fmtU = v => v == null || !isFinite(v) ? '—' : '$ ' + Number(v).toFixed(2);
  const $e = $('realEquity'), $f = $('realFree'), $l = $('realLocked'), $u = $('realUnreal');
  if ($e) $e.textContent = d.account ? fmtU(d.account.equity) : '—';
  if ($f) $f.textContent = d.account ? fmtU(d.account.livre) : '—';
  if ($l) $l.textContent = d.account ? fmtU(d.account.vinculado) : '—';
  if ($u) {
    const uVal = d.account ? (d.account.naoRealizado || 0) : null;
    $u.textContent = fmtU(uVal);
    $u.className = 'kpi-v ' + signCls(uVal);
  }
  const $rc = $('realOpsCount');
  if ($rc) $rc.textContent = String((d.todayOps || []).length);

  // P&L de hoje
  const $tp = $('realTodayPnl');
  if ($tp) {
    $tp.textContent = d.todayPnl != null ? (d.todayPnl >= 0 ? '+$ ' : '-$ ') + Math.abs(d.todayPnl).toFixed(2) : '—';
    $tp.className = 'real-bal-val ' + signCls(d.todayPnl);
  }

  // Posições abertas
  const tbody = $('realPosBody');
  if (tbody) {
    const pos = d.positions || [];
    $('realPosCount').textContent = pos.length ? `(${pos.length})` : '';
    tbody.replaceChildren();
    if (!pos.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="feed-empty">Sem posições abertas</td></tr>';
    } else {
      for (const p of pos) {
        const tr = document.createElement('tr');
        const pnl = +(p.pnl || 0);
        tr.innerHTML = `<td><b>${p.symbol || ''}</b></td><td>${p.lado === 'longo' ? 'Longo ▲' : 'Curto ▼'}</td><td>${p.contratos}</td><td>${p.precoMedio}</td><td class="${signCls(pnl)}">${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toFixed(2)}</td><td>${p.alavancagem || '—'}</td>`;
        tbody.appendChild(tr);
      }
    }
  }

  // Operações de hoje
  const otBody = $('realOpsBody');
  if (otBody) {
    const ops = (d.todayOps || []).slice(0, 50);
    otBody.replaceChildren();
    if (!ops.length) {
      otBody.innerHTML = '<tr><td colspan="6" class="feed-empty">Nenhuma operação hoje</td></tr>';
    } else {
      for (const o of ops) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${o.hora}</td><td>${o.simbolo}</td><td>${o.lado === 'compra' ? 'Compra ▲' : 'Venda ▼'}</td><td>${o.contratos}</td><td>${o.preco ? '$ ' + Number(o.preco).toFixed(2) : '—'}</td><td>${o.taxa ? '$ ' + Number(o.taxa).toFixed(4) : '—'}</td>`;
        otBody.appendChild(tr);
      }
    }
  }
}

// ===== Init =====
Charts.init($('mainChart'), $('rsiChart'), store.get('layers', null));
buildControls();
ligarInterruptorMoeda();
load(state.tf);
if (location.protocol.startsWith('http')) {
  pollBot();
  setInterval(pollBot, 15000);
  pollLive();
  setInterval(pollLive, 20000);

  // ===== Fim do polling /api/live =====

  // ===== Clock do próximo candle =====
}
