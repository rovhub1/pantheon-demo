// js/shell.js — a casca do PANTHEON (25/11)
//
// O PREGÃO era uma página única e longa: tudo empilhado, com o robô subindo e
// descendo. Virou um TERMINAL: uma lateral com as seções e cada seção é uma
// tela de verdade (rota por hash), não uma âncora dentro de uma página só.
//
// O estilo é "data terminal": toda seleção é a MESMA linha de 1px na cor de
// destaque, do tamanho do rótulo, na borda mais próxima; e os números ficam em
// branco ou cinza carregando o sinal no texto. A exceção sancionada: a
// coluna que mostra "o que mudou hoje" (a colunata) pode usar as cores de
// polaridade.
//
// Arquivos: index.html (a casca e as seis telas) · css/style.css (o bloco
// PANTHEON no fim) · este arquivo (rota, colunata e as faixas de cada tela).

(function () {
  'use strict';

  const Telas = ['painel', 'conta-real', 'conta-demo', 'operadores', 'grafico', 'operacoes'];
  const el = id => document.getElementById(id);
  const $ = el; // atalho curto
  // Números no padrão brasileiro (vírgula decimal), com sinal na frente
  const numBR = (v, d = 2) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const pctBR = (v, d = 2) => (v > 0 ? '+' : v < 0 ? '−' : '') + numBR(Math.abs(v), d) + '%';

  // ===== ROTA =====
  // A URL manda: #painel, #conta-real... Voltar do navegador funciona.
  function telaAtual() {
    const h = (location.hash || '').replace(/^#/, '');
    return Telas.includes(h) ? h : 'painel';
  }

  function aplicarRota() {
    const alvo = telaAtual();
    for (const v of document.querySelectorAll('.view')) v.hidden = v.dataset.view !== alvo;
    for (const a of document.querySelectorAll('.nav-item')) a.classList.toggle('on', a.dataset.view === alvo);
    document.body.classList.remove('menu-aberto');
    const t = el('navToggle'); if (t) t.setAttribute('aria-expanded', 'false');
    // O gráfico mede o próprio tamanho (autoSize), mas precisa de um instante
    // depois de aparecer para pegar a largura nova.
    if (alvo === 'grafico') requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    window.scrollTo(0, 0);
    if (window.lenis && typeof window.lenis.scrollTo === 'function') window.lenis.scrollTo(0, { immediate: true });
  }

  // ===== A COLUNATA =====
  // Doze operadores disputando um saldo só. Cada coluna é um operador; a
  // altura é o resultado dele hoje, em % da conta. O zero é a linha de base.
  // Escolhe um passo de escala redondo (0,1 · 0,25 · 0,5 · 1 · 2 · 5 · 10)
  // para as marcas do eixo não saírem quebradas.
  function passoBonito(alcance) {
    const a = Math.abs(alcance) || 0.1;
    for (const p of [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10]) {
      if (a / p <= 5) return p;
    }
    return 10;
  }
  function decimaisDoPasso(p) { return p < 0.1 ? 2 : p < 1 ? 2 : 0; }

  function desenharColunada(d) {
    const cx = el('colonnadeChart');
    if (!cx) return;
    const bots = (d.bots || []).filter(b => !b.hidden);
    const dados = bots.map(b => {
      const dia = (b.days || [])[0] || {};
      const v = Number(dia.pct) || 0;
      return { nome: b.name || b.id || '', v, team: b.team, id: b.id };
    });
    if (!dados.length) { cx.innerHTML = '<p class="panel-foot">Sem operadores reportando.</p>'; return; }

    const W = Math.max(360, cx.clientWidth || 900);
    const padL = 46, padR = 10, padT = 14, padB = 30;
    const H = 178;
    const plotH = H - padT - padB;
    const plotW = W - padL - padR;

    const vs = dados.map(x => x.v);
    const brutoMax = Math.max(0, ...vs), brutoMin = Math.min(0, ...vs);
    // Escala com passos redondos: 3 a 5 marcas, o zero sempre presente.
    const passo = passoBonito(brutoMax - brutoMin);
    const maxV = Math.ceil(brutoMax / passo) * passo;
    const minV = Math.floor(brutoMin / passo) * passo;
    const span = (maxV - minV) || passo;
    const y = v => padT + (maxV - v) / span * plotH;

    const passo2 = plotW / dados.length;
    const largBarra = Math.max(4, Math.min(26, passo2 * 0.44));
    const mostraValor = passo2 >= 46;

    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Resultado de hoje de cada operador, em porcentagem da conta">`;
    // Marcas do eixo: passos redondos, com o zero sempre no meio
    for (let v = maxV; v >= minV - 1e-9; v -= passo) {
      const vv = Math.abs(v) < 1e-9 ? 0 : v;
      const yy = Math.round(y(vv)) + 0.5;
      s += `<line class="${vv === 0 ? 'col-zero' : 'col-grid'}" x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}"/>`;
      s += `<text class="col-tick" x="${padL - 8}" y="${yy + 4}" text-anchor="end">${pctBR(vv, decimaisDoPasso(passo))}</text>`;
    }
    // Colunas
    dados.forEach((x, i) => {
      const cx0 = padL + passo2 * i + passo2 / 2;
      const yZero = y(0), yv = y(x.v);
      const topo = Math.min(yZero, yv);
      const alt = Math.max(1, Math.abs(yZero - yv));
      const cls = x.v >= 0 ? 'col-bar-pos' : 'col-bar-neg';
      const rot = (x.nome + '').length > 11 ? (x.nome + '').slice(0, 10) + '…' : (x.nome + '');
      s += `<title>${x.nome}: ${pctBR(x.v)} hoje</title>`;
      s += `<rect class="${cls}" x="${(cx0 - largBarra / 2).toFixed(1)}" y="${topo.toFixed(1)}" width="${largBarra.toFixed(1)}" height="${alt.toFixed(1)}" rx="2"/>`;
      if (mostraValor) {
        const yTxt = x.v >= 0 ? topo - 5 : topo + alt + 12;
        s += `<text class="col-val" x="${cx0.toFixed(1)}" y="${yTxt.toFixed(1)}" text-anchor="middle">${pctBR(x.v, 1)}</text>`;
      }
      s += `<text class="col-name" x="${cx0.toFixed(1)}" y="${H - padB + 16}" text-anchor="middle">${rot}</text>`;
    });
    s += '</svg>';
    cx.innerHTML = s;

    const nota = el('colonnadeNote');
    if (nota) {
      const comTrade = dados.filter(x => Math.abs(x.v) > 0.005).length;
      nota.textContent = `resultado de hoje de cada operador, em % da conta · ${comTrade} de ${dados.length} mexeram na carteira`;
    }
  }

  // Redesenha a colunata quando a largura muda (o SVG é medido em pixels reais)
  let timerResize = null;
  function agendarRedesenho() {
    clearTimeout(timerResize);
    timerResize = setTimeout(() => { if (window.botState && botState.data) desenharColunada(botState.data); }, 180);
  }

  // ===== FAIXAS DAS TELAS =====
  // Cada tela tem os números que respondem a pergunta dela. Todos vêm do
  // mesmo estado do robô — nenhum número é digitado à mão.
  function mesAtual(d) {
    const bots = d.bots || [];
    let n = 0, w = 0, pnl = 0;
    for (const b of bots) {
      const m = (b.months || []).find(x => x.isCurrent);
      if (!m) continue;
      n += m.trades || 0; w += m.wins || 0; pnl += m.pnl || 0;
    }
    return { n, w, pnl };
  }

  function preencherTelas(d) {
    const bots = d.bots || [];
    const cart = d.carteira;
    const mes = mesAtual(d);

    // --- Conta demo: resultado do mês + vagas, operações, acerto, risco ---
    const leadDemo = el('leadDemo');
    if (leadDemo) {
      if (mes.n) {
        leadDemo.hidden = false;
        const inicial = cart && cart.saldoInicial ? cart.saldoInicial : 0;
        const pct = inicial ? mes.pnl / inicial * 100 : 0;
        const v = el('demoMesV'); if (v) { v.textContent = (mes.pnl >= 0 ? '+' : '−') + fmtMoeda(Math.abs(mes.pnl), 2); v.className = 'kpi-v ' + (mes.pnl > 0 ? 'pos' : mes.pnl < 0 ? 'neg' : ''); }
        const s = el('demoMesS'); if (s) s.textContent = `${pctBR(pct)} da conta · ${mes.n} operações · ${mes.w} acertos`;
      } else leadDemo.hidden = true;
    }
    const dv = el('demoVagas');
    if (dv) {
      const v = cart && cart.vagas;
      const usadas = typeof v === 'number' ? v : (v && (v.ocupadas ?? v.usadas ?? v.ativas)) || 0;
      const total = (v && typeof v === 'object' && (v.total ?? v.max)) || cart?.maxPosicoes || 0;
      dv.textContent = total ? `${usadas}/${total}` : String(usadas);
    }
    const do2 = el('demoOps'); if (do2) do2.textContent = String(mes.n);
    const do2s = el('demoOpsS'); if (do2s) do2s.textContent = mes.n ? `${mes.w} acertos` : 'nenhuma operação no mês';
    const da = el('demoAcerto'); if (da) da.textContent = mes.n ? Math.round(mes.w / mes.n * 100) + '%' : '—';
    const das = el('demoAcertoS'); if (das) das.textContent = mes.n ? `${mes.w} de ${mes.n}` : 'sem operação no mês';
    const dr = el('demoRisco');
    if (dr) {
      const r = cart && Number(cart.riscoAberto) || 0;
      const s = cart && Number(cart.saldo) || 0;
      const pct = s ? r / s * 100 : 0;
      dr.textContent = fmtMoeda(r, 2);
      const drs = dr.nextElementSibling;
      if (drs) drs.textContent = s ? `${numBR(pct, 1)}% do saldo da conta` : 'sem carteira ligada';
    }

    // --- Operações: total, acertos, resultado, abertas ---
    const ot = el('opsTotal'); if (ot) ot.textContent = String(mes.n);
    const ots = el('opsTotalS'); if (ots) ots.textContent = mes.n ? 'fechadas neste mês' : 'nenhuma no mês';
    const ow = el('opsWins'); if (ow) ow.textContent = mes.n ? Math.round(mes.w / mes.n * 100) + '%' : '—';
    const ows = el('opsWinsS'); if (ows) ows.textContent = mes.n ? `${mes.w} de ${mes.n}` : '—';
    const op = el('opsPnl');
    if (op) { op.textContent = (mes.pnl >= 0 ? '+' : '−') + fmtMoeda(Math.abs(mes.pnl), 2); op.className = 'kpi-v ' + (mes.pnl > 0 ? 'pos' : mes.pnl < 0 ? 'neg' : ''); }
    const ops = el('opsPnlS'); if (ops) ops.textContent = 'no mês corrente';
    const oo = el('opsOpen');
    if (oo) oo.textContent = String(bots.reduce((s, b) => s + (b.positions || []).length, 0));

    // --- Operadores: quem está na frente hoje ---
    const lb = el('leadBot');
    if (lb) {
      const comHoje = bots.map(b => ({ b, v: ((b.days || [])[0] || {}).pct || 0 }))
        .filter(x => x.b.trades || ((x.b.days || [])[0] || {}).trades);
      if (comHoje.length) {
        comHoje.sort((x, y) => y.v - x.v);
        const top = comHoje[0];
        lb.hidden = false;
        const l = el('leadBotL'); if (l) l.textContent = `Melhor de hoje · ${top.b.name || top.b.id}`;
        const v = el('leadBotV'); if (v) { v.textContent = pctBR(top.v); v.className = 'kpi-v ' + (top.v > 0 ? 'pos' : top.v < 0 ? 'neg' : ''); }
        const s = el('leadBotS'); if (s) s.textContent = `resultado de hoje na conta · ${comHoje.length} operadores operaram`;
      } else lb.hidden = true;
    }

    // --- Gráfico: qual moeda e qual tempo estão abertos ---
    const gm = el('grafMoeda'), gt = el('grafTempo');
    if (gm) gm.textContent = (typeof state !== 'undefined' && state.symbol) ? state.symbol.replace('USDT', '/USDT') : '—';
    if (gt) gt.textContent = (typeof state !== 'undefined' && state.tf) ? `candle de ${state.tf}` : '—';

    // --- Carimbos de "atualizado há" ---
    const stamp = (id, ms) => {
      const e = el(id); if (!e) return;
      e.textContent = ms ? `atualizado há ${Math.max(0, Math.round((d.now - ms) / 1000))} s` : '—';
    };
    stamp('stampPainel', d.lastCycleAt);
    stamp('stampDemo', d.lastCycleAt);
    stamp('stampBots', d.lastCycleAt);
    stamp('stampChart', d.lastCycleAt);
    stamp('stampTrades', d.lastCycleAt);
    stamp('stampReal', d.lastCycleAt);

    // --- Lateral: o robô está vivo? ---
    const dot = el('sideDot'), st = el('sideStatus');
    if (dot && st) {
      const vivo = d.lastCycleAt && (d.now - d.lastCycleAt) < 120000;
      dot.className = 'side-dot ' + (vivo ? 'ok' : 'ruim');
      st.textContent = vivo ? `Robô no ar · ${d.bots.length} operadores` : 'Robô fora do ar';
    }

    // --- Etiqueta da lateral: a conta real está ligada? ---
    const tag = el('navRealTag');
    if (tag) tag.hidden = !(window.liveState && liveState.data && liveState.data.real);
  }

  // Chamado pelo main.js depois de desenhar o robô
  function renderShell(d) {
    if (!d) return;
    preencherTelas(d);
    desenharColunada(d);
  }

  window.renderShell = renderShell;

  // ===== LIGAÇÃO =====
  document.addEventListener('DOMContentLoaded', () => {
    // A rota responde ao hash
    window.addEventListener('hashchange', aplicarRota);
    if (!location.hash) location.replace('#painel');
    aplicarRota();

    // Menu do celular
    const tog = el('navToggle');
    if (tog) tog.addEventListener('click', () => {
      const aberto = document.body.classList.toggle('menu-aberto');
      tog.setAttribute('aria-expanded', aberto ? 'true' : 'false');
    });
    document.addEventListener('click', e => {
      if (!document.body.classList.contains('menu-aberto')) return;
      if (e.target.closest('.sidebar') || e.target.closest('.nav-toggle')) return;
      document.body.classList.remove('menu-aberto');
    });

    // A colunada é medida em pixels: refaz quando a janela muda de tamanho
    window.addEventListener('resize', agendarRedesenho);
  });
})();
