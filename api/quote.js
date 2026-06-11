// api/quote.js
// 用法: /api/quote?symbols=2330.TW,2313.TW,3481.TW
// 回傳: { "2330.TW": { price, prev, ma20, vol, chg }, ... }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: 'symbols required' });

  const syms = symbols.split(',').map(s => s.trim()).filter(Boolean).slice(0, 40);

  const results = await Promise.allSettled(
    syms.map(sym => fetchOne(sym))
  );

  const data = {};
  results.forEach((r, i) => {
    data[syms[i]] = r.status === 'fulfilled' ? r.value : null;
  });

  res.status(200).json(data);
}

async function fetchOne(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=30d`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  const res = d.chart.result[0];
  const meta = res.meta;
  const closes = (res.indicators.quote[0].close || []).filter(Boolean);
  const vols = res.indicators.quote[0].volume || [];
  const ma20 = closes.length >= 20
    ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20
    : closes.length > 0 ? closes.reduce((a, b) => a + b, 0) / closes.length : null;
  const price = meta.regularMarketPrice;
  const prev = meta.chartPreviousClose;
  return {
    price,
    prev,
    ma20,
    vol: vols[vols.length - 1] || null,
    chg: prev ? ((price - prev) / prev * 100) : 0,
    bias: ma20 ? ((price - ma20) / ma20 * 100) : null,
  };
}
