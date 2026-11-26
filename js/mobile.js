// js/mobile.js — Painel simples para o celular: operadores, posições, entradas/saídas e quem está perto de entrar
const $ = id => document.getElementById(id);
const STRAT = { breakout: 'Rompimento', reversal: 'Reversão', supertrend: 'Supertrend', pullback: 'Pullback', macdx: 'MACD', twogreen: 'Dois candles da abertura', psar: 'Parabolic SAR', heikin: 'Heikin-Ashi', dthrust: 'Dual Thrust', london: 'Londres', bbrev: 'Volta à média', macross: 'Médias 9/20/50', dayext: 'Topo/fundo do dia' };
const FX_NAME = { EURUSDT: 'EUR/USD', USDTBRL: 'USD/BRL', USDTMXN: 'USD/MXN', XAUTUSDT: 'Ouro', PAXGUSDT: 'Ouro' };
const base = s => FX_NAME[s] || s.replace(/USDT$/, '');
const pct = v => v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%';
const cls = v => v > 0 ? 'g' : v < 0 ? 'r' : 'm';
// ===== Moeda: real brasileiro (R$) por padrão, com interruptor R$ / US$ =====
// A contabilidade do robô continua em dólar; aqui só muda a exibição.
// paraMoeda(v) = valor já na moeda escolhida; fmtMoeda(v) = o mesmo, com o símbolo ("R$ 12,34").
const paraMoeda = v => Moeda.converter(v);
const fmtMoeda = (v, d) => Moeda.formatar(v, d);
const money = v => (v < 0 ? '−' : '') + fmtMoeda(Math.abs(v), 2);
// Preço de mercado: casas conforme o tamanho do valor já convertido (sem zeros à direita)
const price = v => { const x = paraMoeda(v); return fmtMoeda(v, { min: 0, max: x >= 100 ? 2 : x >= 1 ? 4 : 6 }); };
const when = ms => new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const el = (tag, c, text) => { const e = document.createElement(tag); if (c) e.className = c; if (text != null) e.textContent = text; return e; };
const tradePct = t => t.pct ?? (t.pnl / ((t.equityAfter - t.pnl) || 1) * 100);

let data = null;
let team = localStorage.getItem('btca.m.team') || 'spot';

// ===== Interruptor de moeda (R$ / US$) =====
// R$ por padrão; a troca é imediata (sem recarregar a página).
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

function ligarInterruptorMoeda() {
  const b = $('moedaBRL'), u = $('moedaUSD');
  const trocar = m => { Moeda.definirModo(m); atualizarRotuloMoeda(); if (data) render(); };
  if (b) b.addEventListener('click', () => trocar('BRL'));
  if (u) u.addEventListener('click', () => trocar('USD'));
  atualizarRotuloMoeda();
}

async function load() {
  try {
    const r = await fetch('/api/state', { cache: 'no-store' });
    if (r.status === 401) { location.href = '/login'; return; }
    data = await r.json();
    // O time Forex foi encerrado em 16/11/2026: some do site mesmo que o processo
    // antigo do robô ainda o reporte (o config já não tem mais esses operadores).
    if (data.bots) data.bots = data.bots.filter(b => b.team !== 'forex');
    if (data.teams) delete data.teams.forex;
    if (data.symbols) data.symbols = data.symbols.filter(s => !['EURUSDT', 'USDTBRL', 'USDTMXN', 'XAUTUSDT', 'PAXGUSDT'].includes(s));
    Moeda.aplicar(data.moeda);   // taxa US$ → R$ (vem do robô, sem chave)
    atualizarRotuloMoeda();
    render();
  } catch (e) {
    $('live').className = 'live err';
    $('liveTxt').textContent = 'sem resposta do robô';
  }
}

function render() {
  const d = data;
  const ago = d.lastCycleAt ? Math.round((d.now - d.lastCycleAt) / 1000) : null;
  const ok = d.net?.ok && ago != null && ago < 120;
  $('live').className = 'live ' + (ok ? 'on' : 'err');
  $('liveTxt').textContent = ok ? `ao vivo · ${ago}s` : (d.net?.ok ? 'robô parado?' : 'sem conexão com a Binance');

  // Abas
  const tabs = $('tabs');
  tabs.replaceChildren();
  for (const [id, t] of Object.entries(d.teams || {})) {
    if (!d.bots.some(b => b.team === id)) continue;
    const open = d.bots.filter(b => b.team === id).reduce((s, b) => s + (b.positions || []).length, 0);
    const b = el('button', 'tab' + (id === team ? ' on' : ''), t.name.replace('Time ', '') + (open ? ` · ${open}` : ''));
    b.onclick = () => { team = id; localStorage.setItem('btca.m.team', id); render(); };
    tabs.appendChild(b);
  }
  if (!d.bots.some(b => b.team === team)) team = d.bots[0]?.team;
  const bots = d.bots.filter(b => b.team === team);

  // Resumo do time: o quanto o TIME vale do dinheiro total da conta.
  const cart = d.carteira;
  const today = bots.reduce((s, b) => s + (b.days?.[0]?.pnl || 0), 0);
  const contaBase = cart?.saldoInicial ?? bots.reduce((s, b) => s + b.startEquity, 0);
  const teamPnl = bots.reduce((s, b) => s + ((b.equity + b.openPnl) - b.startEquity), 0);
  const todayPct = contaBase ? today / contaBase * 100 : 0;
  // Acertos: so da conta atual (desde o ultimo reset), nao do historico antigo
  const wins = bots.reduce((s, b) => s + (b.cur ? b.cur.wins : b.wins), 0), n = bots.reduce((s, b) => s + (b.cur ? b.cur.trades : b.trades), 0);
  const open = bots.reduce((s, b) => s + (b.positions || []).length, 0);
  const sum = $('summary');
  sum.replaceChildren();
  const box = (label, val, c) => { const x = el('div', 'sum'); x.append(el('span', '', label), el('b', c, val)); sum.appendChild(x); };
  box('Hoje (time)', pct(todayPct), cls(today));
  box('Desde o início', pct(contaBase ? teamPnl / contaBase * 100 : 0), cls(teamPnl));
  box('Acertos', `${wins}/${n}`, '');

  // Operadores
  const ops = $('ops');
  ops.replaceChildren();
  // O resultado do operador, em % do dinheiro TOTAL da conta (modo compartilhado).
  const totalOf = b => b.compartilhado ? (b.pctConta ?? 0) : ((b.equity + b.openPnl) / b.startEquity - 1) * 100;
  const ranked = bots.map(b => ({ b, total: totalOf(b) })).sort((x, y) => y.total - x.total);
  const comp = bots.some(b => b.compartilhado);
  for (const { b, total } of ranked) {
    const card = el('div', 'op');
    // Mesma cor por estratégia do painel do PC (1 Rompimento, 2 Reversão, 3 Supertrend, 4 Pullback)
    card.style.boxShadow = 'inset 0 2px 0 ' + ({ breakout: '#8EA2FF', reversal: '#D08CFF', supertrend: '#6FE3FF', pullback: '#FFB86B', macdx: '#F28FB8' }[b.strategy] || 'transparent');
    const head = el('div', 'op-head');
    const left = el('div');
    left.append(el('div', 'op-name', `${b.name} – ${STRAT[b.strategy] || b.strategy}`), el('div', 'op-sub', `${b.tf} · ${b.symbols.length} moedas${b.leverage ? ` · até ${b.leverage.maxLev}x` : ''}${b.allIn ? ' · 100% do saldo' : ''}${b.paused ? ' · pausado' : ''}`));
    const right = el('div', 'op-ret ' + cls(total), pct(total));
    right.appendChild(el('small', '', comp ? 'da conta · desde o início' : 'desde o início'));
    head.append(left, right);
    card.appendChild(head);

    const td = b.days?.[0]?.pct || 0;
    const stats = el('div', 'stats');
    const st = (k, v, c) => { const s = el('span', '', k + ' '); s.appendChild(el('b', c || '', v)); stats.appendChild(s); };
    st('Hoje', pct(td), cls(td));
    // Acertos: só do mês em curso (o mês anterior fica na linha "Mêspassedado")
    const mc = (b.months || []).find(m => m.isCurrent);
    st('Acertos', mc ? `${mc.wins}/${mc.trades}` : '0/0');
    st(comp ? 'Fatia' : 'Saldo', money(b.equity));
    st('Abertas', String((b.positions || []).length));
    // Resultado do mês passado (o mês em curso começa do zero depois do reinício da conta)
    const meses = b.months || [];
    const mesAtual = meses.find(m => m.isCurrent);
    const mesPassado = mesAtual ? meses.find(m => m.month < mesAtual.month) : meses[meses.length - 1];
    if (mesPassado && mesPassado.trades) st('Mês passado', pct(mesPassado.pct), cls(mesPassado.pct));
    card.appendChild(stats);

    const tgt = ((b.leverage || b.lock)?.dailyTargetPct || 0) * 100;
    if (tgt) {
      const bar = el('div', 'meta');
      const fill = el('i', td >= tgt ? 'done' : '');
      fill.style.width = Math.max(0, Math.min(100, td / tgt * 100)) + '%';
      bar.appendChild(fill);
      card.appendChild(bar);
      card.appendChild(el('div', 'near', td >= tgt ? `meta de +${tgt}% batida` : `meta do dia +${tgt}% · faltam ${Math.max(0, tgt - td).toFixed(2)}%`));
    }

    if ((b.positions || []).length) {
      const pos = el('div', 'pos');
      for (const p of b.positions) {
        const row = el('div');
        row.append(
          el('span', '', `${base(p.symbol)} ${p.dir > 0 ? '▲ COMPRA' : '▼ VENDA'}${p.leverage ? ` ${p.leverage.toFixed(1)}x` : ''}${p.locked ? ' · travado' : ''}`),
          el('span', cls(p.pnl), `${pct(p.pct)} (${money(p.pnl)})`)
        );
        row.title = `entrada ${price(p.entry)} · stop ${price(p.stop)}`;
        pos.appendChild(row);
      }
      card.appendChild(pos);
    } else if (b.closest?.[0]) {
      const c = b.closest[0];
      card.appendChild(el('div', 'near', `aguardando · mais perto: ${base(c.symbol)} ${c.passed}/${c.total}${c.missing?.length ? ' · falta: ' + c.missing.slice(0, 2).join(', ') : ''}`));
    }
    ops.appendChild(card);
  }

  // Mais perto de entrar (todas as moedas do time)
  const near = $('near');
  near.replaceChildren();
  const cands = bots.flatMap(b => (b.radar || []).filter(r => r.evaluated && !r.inPosition && !r.used).map(r => ({ b, r })))
    .sort((x, y) => y.r.passed / y.r.total - x.r.passed / x.r.total).slice(0, 5);
  for (const { b, r } of cands) {
    const ev = el('div', 'ev');
    const top = el('div', 'ev-top');
    top.append(el('span', '', `${b.name} – ${STRAT[b.strategy]} · ${base(r.symbol)}`), el('span', r.passed / r.total >= 0.75 ? 'a' : 'm', `${r.passed}/${r.total}`));
    ev.append(top, el('div', 'ev-sub', r.missing?.length ? 'falta: ' + r.missing.join(' · ') : 'sinal completo — entra na abertura do próximo candle'));
    near.appendChild(ev);
  }
  if (!cands.length) near.appendChild(el('div', 'empty', 'Ninguém perto de entrar agora.'));

  // Entradas e saídas (abertas + últimas fechadas)
  const feed = $('feed');
  feed.replaceChildren();
  const rows = [];
  for (const b of bots) {
    for (const p of b.positions || []) rows.push({ b, t: p, open: true, at: p.entryTime * 1000 });
    for (const t of b.recentTrades || []) rows.push({ b, t, open: false, at: t.exitTime * 1000 });
  }
  rows.sort((x, y) => y.at - x.at);
  for (const { b, t, open } of rows.slice(0, 30)) {
    const p = open ? t.pct : tradePct(t);
    const ev = el('div', 'ev ' + (open ? 'entry' : t.pnl > 0 ? 'win' : 'loss'));
    const top = el('div', 'ev-top');
    top.append(
      el('span', '', `${open ? (t.dir > 0 ? '▲' : '▼') : (t.pnl > 0 ? 'ganho' : 'perda')} ${b.name} – ${STRAT[b.strategy]} · ${base(t.symbol)} ${t.dir > 0 ? 'COMPRA' : 'VENDA'}${t.tradeNo ? ' #' + t.tradeNo : ''}`),
      el('span', cls(t.pnl), pct(p))
    );
    const sub = open
      ? `aberta desde ${when(t.entryTime * 1000)} · entrada ${price(t.entry)} · stop ${price(t.stop)}${t.locked ? ' · travado' : ''}`
      : `${when(t.entryTime * 1000)} → ${when(t.exitTime * 1000)} · ${price(t.entry)} → ${price(t.exit)} · ${t.why} · ${money(t.pnl)}`;
    ev.append(top, el('div', 'ev-sub', sub));
    feed.appendChild(ev);
  }
  if (!rows.length) feed.appendChild(el('div', 'empty', 'Nenhuma operação ainda neste time.'));

  // Mesa de operações: a conversa entre os robôs (de todos os times), mais nova em cima
  const desk = $('desk');
  desk.replaceChildren();
  const msgs = (d.desk?.msgs || []).slice(-12).reverse();
  for (const m of msgs) {
    const ev = el('div', 'ev desk-' + m.kind);
    const top = el('div', 'ev-top');
    top.append(el('span', '', m.who), el('span', 'm', when(m.at)));
    ev.append(top, el('div', 'ev-sub', m.text));
    desk.appendChild(ev);
  }
  if (!msgs.length) desk.appendChild(el('div', 'empty', 'Ninguém falou ainda. Quando um robô fechar uma operação, ele conta aqui.'));
}

/* ===== CONTA REAL (MEXC) ===== */
function renderReal(d) {
  const section = $('realSection');
  if (!d || !d.ativo) {
    const motivo = d?.motivo || 'Conta real MEXC nao liberada';
    section.innerHTML = `<div class="m-real-aviso"><b>Conta real MEXC ainda nao liberada</b><p>${motivo}<br>Para liberar: defina BTCA_ALLOW_REAL=1 e crie o arquivo bot\\conta-real.autorizado com LIBERADO=SIM.</p></div>`;
    $('mobileFoot').textContent = 'Simulado — dinheiro ficticio.';
    return;
  }
  const s = d.saldo || {};
  const pos = (d.posicoes || []).slice(0, 3);
  const ops = d.dia?.operacoes || 0;
  const acerto = d.dia?.acertoPct || 0;
  const aviso = d.aviso ? `<div style="margin-top:8px;font-size:12px;color:var(--amber)">${d.aviso}</div>` : '';

  let posHtml = '';
  if (pos.length) {
    posHtml = pos.map(p => `<div><b>${p.simbolo}</b> ${p.lado} · ${p.contratos} · entrada ${preco(p.precoMedio)} · P&L ${pnl(p.pnl)}</div>`).join('');
  } else {
    posHtml = '<div><b>Nenhuma posicao aberta</b></div>';
  }

  section.innerHTML = `
    <div class="m-real">
      <div class="m-real-head">
        <div><div class="m-real-title">Conta real · MEXC</div><div class="m-real-sub">Saldo em tempo real — nao simulacao</div></div>
      </div>
      <div class="m-real-grid">
        <div class="m-real-item"><span>Saldo equity</span><b id="mRealSaldo">${fmtMoeda(s.equity || 0)}</b></div>
        <div class="m-real-item"><span>Lucro do dia</span><b id="mRealLucro">${pnl(d.dia?.lucroUsd || 0)}</b></div>
        <div class="m-real-item"><span>Acerto</span><b id="mRealAcerto">${ops} ops · ${acerto}%</b></div>
        <div class="m-real-item"><span>Posicoes</span><b id="mRealPos">${d.posicoes?.length || 0}</b></div>
      </div>
      <div class="m-real-pos"><b>Posicoes abertas</b>${posHtml}</div>
      ${aviso}
      <div class="m-real-foot">
        <span id="mRealSync"></span><button onclick="fetchLive()">Atualizar</button>
      </div>
    </div>`;
  const sync = $('mRealSync');
  if (sync) sync.textContent = d.ultimoSync ? `Atualizado ha ${Math.max(0, Math.round((Date.now() - d.ultimoSync) / 1000))} s` : '';
  $('mobileFoot').innerHTML = 'Dinheiro real — ordens na MEXC.';
}

async function fetchLive() {
  try {
    const r = await fetch('/api/live');
    const d = await r.json();
    renderReal(d);
  } catch (e) {
    const section = $('realSection');
    section.innerHTML = '<div class="m-real-aviso"><b>Conta real</b><p>Sem resposta da API. Tente novamente.</p></div>';
  }
}

ligarInterruptorMoeda();
load();
fetchLive();
setInterval(load, 20000);
setInterval(fetchLive, 20000);
