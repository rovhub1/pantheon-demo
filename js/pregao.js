// js/pregao.js — PREGÃO: rolagem suave (Lenis), faixa de cotações e Mesa de operações (25/10).
//
// A abertura de LED (o nome PREGÃO virando o gráfico do BTC ao rolar) foi removida a pedido do usuário no mesmo dia.
// O código dela continua abaixo e só roda se o #hero voltar ao index.html.
// Sem animação só com ?calmo no endereço.

(() => {
  // O usuário pediu animação (25/10). O Windows dele está com os efeitos de animação desligados, e o navegador
  // repassa isso como 'menos movimento'; por isso o painel anima mesmo assim. Para desligar: ?calmo no endereço.
  const RM = /[?&]calmo/.test(location.search);
  const hasGsap = typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined';
  const AMBER = [255, 176, 0], GAIN = [61, 220, 132], LOSS = [255, 77, 77];
  const $ = id => document.getElementById(id);

  // ===== Rolagem suave =====
  let lenis = null;
  if (hasGsap) gsap.registerPlugin(ScrollTrigger);
  if (hasGsap && !RM && typeof Lenis !== 'undefined') {
    lenis = new Lenis({ lerp: 0.11, wheelMultiplier: 1 });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(t => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }
  document.querySelectorAll('[data-scrollto]').forEach(a => a.addEventListener('click', e => {
    const t = document.querySelector(a.getAttribute('data-scrollto'));
    if (!t) return;
    e.preventDefault();
    lenis ? lenis.scrollTo(t, { offset: -72 }) : t.scrollIntoView({ behavior: RM ? 'auto' : 'smooth' });
  }));

  // ===== Placar de LED =====
  const cv = $('heroBoard');
  const ctx = cv && cv.getContext('2d');
  const board = { w: 0, h: 0, g: 10, dpr: 1, from: [], to: [], col: [], delay: [], seed: [], bg: null, p: 0, intro: RM ? 1 : 0, mx: -1e9, my: -1e9, raf: 0, ready: false };

  async function btcCandles() {
    try {
      const r = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=48', { cache: 'no-store' });
      const k = await r.json();
      if (Array.isArray(k) && k.length > 20) return k.map(x => ({ o: +x[1], h: +x[2], l: +x[3], c: +x[4] }));
    } catch (e) {}
    // Sem internet: um caminho aleatório só para a cena não ficar vazia
    let p = 100; return Array.from({ length: 48 }, () => { const o = p; p *= 1 + (Math.random() - 0.48) * 0.02; return { o, c: p, h: Math.max(o, p) * 1.004, l: Math.min(o, p) * 0.996 }; });
  }

  // Pontos acesos de uma máscara desenhada num canvas fora da tela
  function sample(draw, w, h, g) {
    const m = document.createElement('canvas'); m.width = w; m.height = h;
    const c = m.getContext('2d', { willReadFrequently: true });
    const meta = draw(c, w, h) || {};
    const px = c.getImageData(0, 0, w, h).data, pts = [];
    for (let y = g / 2; y < h; y += g) for (let x = g / 2; x < w; x += g) {
      const i = (Math.floor(y) * w + Math.floor(x)) * 4;
      if (px[i + 3] > 110) pts.push([x, y, px[i], px[i + 1], px[i + 2]]);
    }
    return { pts, meta };
  }

  async function buildBoard() {
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(r.width), h = Math.round(r.height);
    if (w < 50 || h < 50) return;
    const g = w < 700 ? 6 : w < 1200 ? 8 : 10;
    Object.assign(board, { w, h, g, dpr });
    cv.width = w * dpr; cv.height = h * dpr;

    try { await document.fonts.load('900 100px "Archivo"'); } catch (e) {}
    const word = sample((c, W, H) => {
      let fs = 100; c.font = `900 ${fs}px "Archivo", "Arial Black", sans-serif`;
      if ('fontStretch' in c) c.fontStretch = 'ultra-expanded';
      const tw = c.measureText('PREGÃO').width;
      fs = Math.min(W * 0.9 / tw * 100, H * 0.42);
      c.font = `900 ${fs}px "Archivo", "Arial Black", sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff';
      c.fillText('PREGÃO', W / 2, H * 0.44);
    }, w, h, g).pts;

    const cs = await btcCandles();
    const chart = sample((c, W, H) => {
      const hi = Math.max(...cs.map(k => k.h)), lo = Math.min(...cs.map(k => k.l));
      const x0 = W * 0.05, x1 = W * 0.95, y0 = H * 0.2, y1 = H * 0.74;
      const step = (x1 - x0) / cs.length, Y = v => y1 - (v - lo) / (hi - lo || 1) * (y1 - y0);
      cs.forEach((k, i) => {
        const x = x0 + i * step, up = k.c >= k.o;
        c.fillStyle = up ? 'rgb(61,220,132)' : 'rgb(255,77,77)';
        c.fillRect(x + step * 0.42, Y(k.h), Math.max(2, step * 0.16), Math.max(2, Y(k.l) - Y(k.h)));
        const top = Y(Math.max(k.o, k.c)), bot = Y(Math.min(k.o, k.c));
        c.fillRect(x + step * 0.12, top, step * 0.76, Math.max(g, bot - top));
      });
    }, w, h, g).pts;

    // Pareia letra → gráfico da esquerda para a direita (o ponto viaja pouco e a cena fica legível)
    word.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    chart.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const n = Math.max(word.length, chart.length);
    board.from = []; board.to = []; board.col = []; board.delay = []; board.seed = [];
    for (let i = 0; i < n; i++) {
      const a = word[Math.floor(i * word.length / n)], b = chart[Math.floor(i * chart.length / n)];
      board.from.push(a); board.to.push(b);
      board.col.push(b[2] > b[3] ? LOSS : GAIN);
      board.delay.push(a[0] / w);
      board.seed.push(Math.random());
    }

    // Fundo: a grade de LEDs apagados (desenhada uma vez)
    const bg = document.createElement('canvas'); bg.width = cv.width; bg.height = cv.height;
    const bc = bg.getContext('2d'); bc.scale(dpr, dpr); bc.fillStyle = 'rgba(255,176,0,0.07)';
    const d = g * 0.42;
    for (let y = g / 2; y < h; y += g) for (let x = g / 2; x < w; x += g) bc.fillRect(x - d / 2, y - d / 2, d, d);
    board.bg = bg;
    board.ready = true;
    draw();
  }

  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const clamp = v => v < 0 ? 0 : v > 1 ? 1 : v;

  function draw() {
    board.raf = 0;
    if (!board.ready) return;
    const { w, h, g, dpr } = board;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(board.bg, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const P = board.p, d = g * 0.6, R2 = (g * 9) ** 2, t = performance.now() / 1000;
    for (let i = 0; i < board.from.length; i++) {
      const a = board.from[i], b = board.to[i], dl = board.delay[i];
      // Acende da esquerda para a direita na abertura
      const lit = clamp((board.intro * 1.35 - dl * 0.35) * 2.2);
      if (lit <= 0) continue;
      const q = ease(clamp((P - dl * 0.35) / 0.65));
      const arc = Math.sin(q * Math.PI) * (40 + board.seed[i] * 120);
      let x = a[0] + (b[0] - a[0]) * q, y = a[1] + (b[1] - a[1]) * q - arc;
      const c = board.col[i];
      let r = AMBER[0] + (c[0] - AMBER[0]) * q, gg = AMBER[1] + (c[1] - AMBER[1]) * q, bb = AMBER[2] + (c[2] - AMBER[2]) * q;
      // Cintilação leve, como lâmpada de placar
      let al = lit * (0.82 + 0.18 * Math.sin(t * 2 + board.seed[i] * 40));
      const dx = x - board.mx, dy = y - board.my, dd = dx * dx + dy * dy;
      if (dd < R2) { const k = 1 - dd / R2; al = Math.min(1, al + k * 0.5); x += dx * k * 0.25; y += dy * k * 0.25; }
      ctx.fillStyle = `rgba(${r | 0},${gg | 0},${bb | 0},${al.toFixed(3)})`;
      ctx.fillRect(x - d / 2, y - d / 2, d, d);
    }
    if (!RM && board.inView) board.raf = requestAnimationFrame(draw); // cintilação contínua só com a cena visível
  }
  const redraw = () => { if (!board.raf) board.raf = requestAnimationFrame(draw); };

  if (cv) {
    buildBoard().then(() => {
      if (hasGsap && !RM) gsap.to(board, { intro: 1, duration: 1.8, ease: 'power2.out', onUpdate: redraw });
      else { board.intro = 1; redraw(); }
    });
    let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { buildBoard(); hasGsap && ScrollTrigger.refresh(); }, 250); });
    cv.addEventListener('pointermove', e => { const r = cv.getBoundingClientRect(); board.mx = e.clientX - r.left; board.my = e.clientY - r.top; redraw(); });
    cv.addEventListener('pointerleave', () => { board.mx = board.my = -1e9; redraw(); });
    new IntersectionObserver(es => { board.inView = es[0].isIntersecting; if (board.inView) redraw(); }).observe(cv);
  }

  // ===== Cena presa: o nome vira o gráfico =====
  if (hasGsap && !RM && $('hero')) {
    const tl = gsap.timeline({
      scrollTrigger: { trigger: '#hero', start: 'top top', end: '+=130%', pin: true, scrub: 0.6,
        onUpdate: s => { board.p = clamp(s.progress / 0.8); redraw(); } }
    });
    tl.to('.hero-sub, .hero-cue', { opacity: 0, y: -24, duration: 0.25, ease: 'none' }, 0)
      .to('.hero-stats', { opacity: 0, y: 24, duration: 0.25, ease: 'none' }, 0)
      .fromTo('.hero-caption', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.2, ease: 'none' }, 0.62)
      .to({}, { duration: 0.2 });
    // Barra superior só aparece depois da abertura
    ScrollTrigger.create({ trigger: '.canvas', start: 'top 90px', end: 'max', onToggle: s => document.body.classList.toggle('past-hero', s.isActive) });
    // Entrada da abertura (uma vez, ao abrir)
    gsap.from('.hero-top > *, .hero-sub, .hero-stats > *, .hero-cue', { opacity: 0, y: 14, duration: 0.8, stagger: 0.06, ease: 'power3.out', delay: 0.5 });
  } else {
    document.body.classList.add('past-hero');
  }

  // ===== Faixa de cotações (a fita do pregão) =====
  const NAMES = { EURUSDT: 'EUR/USD', USDTBRL: 'USD/BRL', USDTMXN: 'USD/MXN', XAUTUSDT: 'OURO' };
  const lastPx = {};
  const fmtPx = v => v.toLocaleString('pt-BR', { minimumFractionDigits: v >= 10 ? 2 : v >= 1 ? 4 : 6, maximumFractionDigits: v >= 10 ? 2 : v >= 1 ? 4 : 6 });
  function renderTape(prices) {
    const tape = $('tape');
    if (!tape || !prices) return;
    const items = Object.entries(prices).filter(([, v]) => v > 0).map(([s, v]) => {
      const prev = lastPx[s], dir = prev == null || prev === v ? 0 : v > prev ? 1 : -1;
      lastPx[s] = v;
      return `<span class="tk${dir > 0 ? ' up' : dir < 0 ? ' dn' : ''}"><b>${NAMES[s] || s.replace(/USDT$/, '')}</b>${fmtPx(v)}<i>${dir > 0 ? '▲' : dir < 0 ? '▼' : '•'}</i></span>`;
    }).join('');
    tape.innerHTML = `<div class="tape-run">${items}</div><div class="tape-run" aria-hidden="true">${items}</div>`;
    const secs = Math.max(40, Object.keys(prices).length * 2.4);
    tape.style.setProperty('--tape-s', secs + 's');
  }

  // ===== Números da abertura =====
  function renderHeroStats(d) {
    const bots = d.bots || [];
    const ret = b => (b.equity + (b.openPnl || 0)) / b.startEquity - 1;
    const set = (id, v) => { const e = $(id); if (e && e.textContent !== v) { e.textContent = v; flash(e); } };
    const btc = d.prices?.BTCUSDT;
    set('hsBtc', btc ? '$' + fmtPx(btc) : '—');
    set('hsWin', `${bots.filter(b => ret(b) > 0).length} de ${bots.length}`);
    set('hsOpen', String(bots.reduce((s, b) => s + (b.positions?.length || 0), 0)));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    set('hsTalk', document.getElementById('kpiTrades')?.textContent || '—');
  }
  function flash(e) {
    if (!hasGsap || RM) return;
    gsap.fromTo(e, { color: '#FFB000' }, { color: '', duration: 1.2, ease: 'power2.out', clearProps: 'color' });
  }

  // ===== Mesa de operações: a conversa entre os robôs =====
  const SNUM = { breakout: 1, reversal: 2, supertrend: 3, pullback: 4 };
  const SCOL = { breakout: '#8EA2FF', reversal: '#D08CFF', supertrend: '#6FE3FF', pullback: '#FFB86B', macdx: '#F28FB8', psar: '#9BE7C4', heikin: '#E8D27A', dthrust: '#B7A4FF', london: '#7FD0FF', bbrev: '#FFA3A3' };
  const KIND = { loss: 'avisou', win: 'comemorou', skip: 'ouviu a mesa' };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hm = ms => new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  let seen = 0;
  function renderDesk(d) {
    const box = $('deskFeed');
    if (!box) return;
    const desk = d.desk || { msgs: [], alerts: [] };
    const byName = Object.fromEntries((d.bots || []).map(b => [b.name, b]));
    const msgs = desk.msgs.slice(-40);
    $('deskHint').textContent = desk.msgs.length ? `${desk.msgs.length} mensagens guardadas. A mais nova fica embaixo.` : '';
    if (!msgs.length) {
      box.innerHTML = '<li class="desk-empty">Ninguém falou ainda. Quando um robô fechar uma operação, ele conta aqui como foi, e os outros ajustam a entrada.</li>';
    } else {
      const last = msgs[msgs.length - 1].at;
      if (last !== seen) {
        const fresh = seen ? msgs.filter(m => m.at > seen).length : 0;
        box.innerHTML = msgs.map(m => {
          const b = byName[m.who] || {};
          const n = (m.who.match(/(\d+)$/) || [])[1] || '•';
          return `<li class="msg ${m.kind}"><span class="av" style="--sc:${SCOL[b.strategy] || '#8A847A'}">${esc(n)}</span>` +
            `<div class="msg-body"><div class="msg-top"><b>${esc(m.who)}</b><span>${KIND[m.kind] || ''}</span><time>${hm(m.at)}</time></div><p>${esc(m.text)}</p></div></li>`;
        }).join('');
        box.scrollTop = box.scrollHeight;
        if (fresh && hasGsap && !RM) gsap.from([...box.children].slice(-fresh), { opacity: 0, x: -18, duration: 0.6, stagger: 0.08, ease: 'power3.out' });
        seen = last;
      }
    }
    const al = $('deskAlerts');
    const act = (desk.alerts || []).filter(a => a.until > Date.now());
    al.innerHTML = act.length ? act.map(a => `<li><b>${esc(NAMES[a.symbol] || a.symbol.replace(/USDT$/, ''))} ${a.dir > 0 ? 'na compra' : 'na venda'}</b><span>aviso de ${esc(a.name)}, vale até ${hm(a.until).slice(-5)}</span></li>`).join('')
      : '<li class="desk-empty">Nenhum aviso agora. Todo mundo pode entrar normalmente.</li>';
  }

  window.Pregao = {
    update(d) { renderTape(d.prices); renderHeroStats(d); renderDesk(d); },
    refresh() { hasGsap && ScrollTrigger.refresh(); }
  };
  // O main.js pode já ter recebido o estado do robô antes deste arquivo carregar
  try { if (botState.data) window.Pregao.update(botState.data); } catch (e) {}
})();
