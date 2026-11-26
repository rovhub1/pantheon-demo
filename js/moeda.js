// js/moeda.js — dinheiro do painel em real brasileiro (R$ por padrão), com interruptor R$ / US$
// A contabilidade do robô continua em dólar: aqui só mora a taxa e a escolha de exibição.
// A taxa vem do robô (/api/state → moeda: { taxa, atualizadoEm, antigo }), sem chave e sem custo.

(function () {
  const TAXA_PADRAO = 5.40;   // usada só se o robô nunca trouxer uma taxa
  const LS = (k, d) => { try { const v = localStorage.getItem('btca.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const SV = (k, v) => { try { localStorage.setItem('btca.' + k, JSON.stringify(v)); } catch (e) {} };

  const Moeda = {
    taxa: TAXA_PADRAO,
    antigo: true,
    atualizadoEm: null,
    modo: LS('moeda', 'BRL') === 'USD' ? 'USD' : 'BRL',   // R$ por padrão
    aoTrocar: [],

    // Converte um valor em dólar para a moeda escolhida (em US$ não converte nada)
    converter(v) {
      if (v == null || !isFinite(v)) return v;
      return this.modo === 'BRL' ? v * this.taxa : v;
    },

    // "R$ 1.234,56" ou "US$ 234,56"
    // d = casas decimais (número = mesma coisa no mínimo e no máximo);
    //     ou {min, max} para quem não quer zeros à direita ("R$ 40,53", não "R$ 40,5300")
    formatar(v, d) {
      if (v == null || !isFinite(v)) return '—';
      const o = (d && typeof d === 'object') ? d : { min: d == null ? 2 : d, max: d == null ? 2 : d };
      const x = this.converter(v);
      return (this.modo === 'BRL' ? 'R$ ' : 'US$ ') +
        x.toLocaleString('pt-BR', { minimumFractionDigits: o.min, maximumFractionDigits: o.max });
    },

    simbolo() { return this.modo === 'BRL' ? 'R$ ' : 'US$ '; },

    // Formata SEM converter: para os preços de mercado que ficam sempre em dólar
    // (cotações do cabeçalho, ticker e eixo do gráfico).
    formatarUSD(v, d) {
      if (v == null || !isFinite(v)) return '—';
      const dd = d == null ? 2 : d;
      return 'US$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: dd, maximumFractionDigits: dd });
    },

    // Formata um valor que JÁ está em real, sem converter (ex.: o capital nominal
    // da conta, "R$ 1.000,00 iniciais" — que é uma verdade em reais, não um dólar).
    formatarReal(v, d) {
      if (v == null || !isFinite(v)) return '—';
      const dd = d == null ? 2 : d;
      return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: dd, maximumFractionDigits: dd });
    },

    // Recebe o bloco "moeda" do /api/state
    aplicar(dados) {
      if (!dados) return;
      const t = Number(dados.taxa);
      if (isFinite(t) && t > 0) this.taxa = t;
      this.antigo = !!dados.antigo;
      this.atualizadoEm = dados.atualizadoEm || null;
    },

    definirModo(m) {
      this.modo = m === 'USD' ? 'USD' : 'BRL';
      SV('moeda', this.modo);
      for (const f of this.aoTrocar) { try { f(this.modo); } catch (e) {} }
    },

    alternar() { this.definirModo(this.modo === 'BRL' ? 'USD' : 'BRL'); },

    // "R$ 5,42 / US$" (a taxa que vale agora)
    rotuloTaxa() {
      const t = this.taxa.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return `R$ ${t} / US$`;
    }
  };

  window.Moeda = Moeda;
})();
