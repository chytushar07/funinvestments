// Market-data plug point. The app reads prices and fundamentals ONLY through this interface.
// Swap MockProvider for a licensed feed later (same three methods).
import { rng } from './data.js';

export class MockProvider {
  constructor(state) { this.state = state; }
  name() { return 'Mock provider (seeded from NSE closes, 9 Nov 2026)'; }
  getQuote(symbol) {
    if (symbol === 'NIFTY') return { symbol, price: this.state.nifty, prev: this.state.niftyPrev, asOf: this.state.clock, mock: true };
    const price = this.state.prices[symbol];
    if (price == null) return null;
    return { symbol, price, prev: this.state.prevPrices[symbol] ?? price, asOf: this.state.clock, mock: true };
  }
  getFundamentals(symbol) {
    const s = this.state.universe[symbol];
    return s ? { symbol, metrics: { ...s.metrics }, events: { ...s.events }, themes: { ...s.themes }, historyYears: s.historyYears, mock: true } : null;
  }
  getHistory(symbol) { return this.state.__priceHistory?.[symbol] || []; }

  // Demo scheduler: one trading day of mock price moves.
  step(dateStr) {
    const st = this.state;
    st.prevPrices = { ...st.prices };
    for (const sym of Object.keys(st.prices)) {
      const r = rng(dateStr + sym);
      const volPct = st.universe[sym]?.metrics?.vol ?? 30;
      const z = (r() + r() + r() - 1.5) * 2; // ~N(0,1)
      const move = 1 + z * (volPct / 100) / Math.sqrt(252) + 0.0003;
      st.prices[sym] = Math.round(st.prices[sym] * move * 100) / 100;
    }
    const r = rng(dateStr + 'NIFTY');
    st.niftyPrev = st.nifty;
    st.nifty = Math.round(st.nifty * (1 + ((r() + r() + r() - 1.5) * 2) * 0.009 + 0.0004));
  }
}
