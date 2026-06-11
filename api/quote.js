// api/quote.js
// 用法: /api/quote?symbols=2330.TW,2313.TW,3481.TW
// 回傳: { "2330.TW": { price, prev, ma20, vol, chg, bias }, ... }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: 'symbols required' });

  const syms = symbols.split(',').map(s => s.trim()).filter(Boolean).slice(0, 40);

  const results = await Promise.allSettled(syms.map(sym => fetchOne(sym)));

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

  // 用歷史收盤陣列的最後兩筆算漲跌，避免 meta.chartPreviousClose 偶爾給錯
  const closes = (res.indicators.quote[0].close || []).filter(v => v != null && v > 0);
  const vols   = (res.indicators.quote[0].volume || []).filter(v => v != null);

  const price = meta.regularMarketPrice;

  // 昨收：優先用歷史收盤倒數第二筆，fallback 到 meta
  let prev = meta.chartPreviousClose;
  if (closes.length >= 2) {
    const hist_prev = closes[closes.length - 2];
    // 合理性檢查：prev 應在 price 的 ±30% 以內，超過就捨棄用 meta
    if (hist_prev > 0 && Math.abs(hist_prev - price) / price < 0.3) {
      prev = hist_prev;
    }
  }

  // 漲跌幅：必須在合理範圍（台股漲跌停約 ±10%，ETF/指數較寬給 ±25%）
  let chg = 0;
  if (prev && prev > 0) {
    const raw = (price - prev) / prev * 100;
    chg = (Math.abs(raw) < 30) ? raw : 0;  // 超過 30% 視為異常，歸零
  }

  // 20MA
  const ma20 = closes.length >= 20
    ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20
    : closes.length > 0 ? closes.reduce((a, b) => a + b, 0) / closes.length : null;

  // 乖離率：合理範圍 ±50%
  let bias = null;
  if (ma20 && ma20 > 0) {
    const rawBias = (price - ma20) / ma20 * 100;
    bias = Math.abs(rawBias) < 50 ? rawBias : null;
  }

  return {
    price,
    prev,
    ma20,
    vol: vols[vols.length - 1] || null,
    chg,
    bias,
  };
}
