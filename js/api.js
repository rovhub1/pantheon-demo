// js/api.js — Binance: REST para histórico, WebSocket para tempo real
// Sem autenticação. Se o host principal falhar, tenta o espelho público data-api.binance.vision.

const REST_HOSTS = ['https://api.binance.com/api/v3', 'https://data-api.binance.vision/api/v3'];
const WS_HOSTS   = ['wss://stream.binance.com:9443', 'wss://data-stream.binance.vision'];

async function getJSON(path) {
  let lastErr;
  for (const host of REST_HOSTS) {
    try {
      const res = await fetch(host + path, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function parseKline(k) {
  return {
    time:      Math.floor(k[0] / 1000), // segundos (formato do gráfico)
    open:      parseFloat(k[1]),
    high:      parseFloat(k[2]),
    low:       parseFloat(k[3]),
    close:     parseFloat(k[4]),
    volume:    parseFloat(k[5]),
    closeTime: k[6]                       // ms
  };
}

async function fetchKlines(symbol, interval, limit = 1000) {
  const data = await getJSON(`/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  return data.map(parseKline);
}

const INTERVAL_MS = { '1m': 6e4, '5m': 3e5, '15m': 9e5, '30m': 18e5, '1h': 36e5, '4h': 144e5, '1d': 864e5, '1w': 6048e5 };

// Candles a partir de um instante (para completar um histórico guardado)
async function fetchKlinesSince(symbol, interval, startMs) {
  const data = await getJSON(`/klines?symbol=${symbol}&interval=${interval}&limit=1000&startTime=${startMs}`);
  return data.map(parseKline);
}

// Candles ANTERIORES a um instante, em páginas de 1000 baixadas em paralelo
async function fetchKlinesBefore(symbol, interval, endMs, count) {
  const pages = Math.ceil(count / 1000), span = 1000 * INTERVAL_MS[interval];
  const reqs = [];
  for (let k = 0; k < pages; k++) {
    reqs.push(getJSON(`/klines?symbol=${symbol}&interval=${interval}&limit=1000&endTime=${endMs - k * span}`));
  }
  const byTime = new Map();
  for (const data of await Promise.all(reqs)) for (const k of data) if (k[0] <= endMs) byTime.set(k[0], k);
  return [...byTime.values()].sort((a, b) => a[0] - b[0]).slice(-count).map(parseKline);
}

async function fetchTicker24h(symbol) {
  return getJSON(`/ticker/24hr?symbol=${symbol}`);
}

// Stream combinado: candle do timeframe + mini ticker 24h.
// Reconecta sozinho alternando entre os hosts. Retorna uma função para fechar.
function openStream(symbol, interval, { onKline, onTicker, onStatus }) {
  const s = symbol.toLowerCase();
  const path = `/stream?streams=${s}@kline_${interval}/${s}@miniTicker`;
  let ws, hostIdx = 0, closed = false, retryTimer;

  function connect() {
    onStatus('conectando');
    ws = new WebSocket(WS_HOSTS[hostIdx] + path);
    ws.onopen = () => onStatus('ao vivo');
    ws.onmessage = ev => {
      const { data } = JSON.parse(ev.data);
      if (data.e === 'kline') {
        const k = data.k;
        onKline({
          time:      Math.floor(k.t / 1000),
          open:      parseFloat(k.o),
          high:      parseFloat(k.h),
          low:       parseFloat(k.l),
          close:     parseFloat(k.c),
          volume:    parseFloat(k.v),
          closeTime: k.T
        }, k.x);
      } else if (data.e === '24hrMiniTicker') {
        onTicker({
          last:  parseFloat(data.c),
          open:  parseFloat(data.o),
          high:  parseFloat(data.h),
          low:   parseFloat(data.l),
          quoteVolume: parseFloat(data.q)
        });
      }
    };
    ws.onclose = () => {
      if (closed) return;
      onStatus('reconectando');
      hostIdx = (hostIdx + 1) % WS_HOSTS.length;
      retryTimer = setTimeout(connect, 2000);
    };
    ws.onerror = () => ws.close();
  }

  connect();
  return () => { closed = true; clearTimeout(retryTimer); ws && ws.close(); };
}
