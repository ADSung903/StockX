// api/fundamental.js
// 用法: /api/fundamental?symbols=2330.TW,2313.TW
// 回傳: { "2330.TW": { roe, inst, de, eps, rev }, ... }
// 快取較長，財務面變化慢

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  // 財務面快取 1 小時
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: 'symbols required' });

  const syms = symbols.split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);

  const results = await Promise.allSettled(
    syms.map(sym => fetchFund(sym))
  );

  const data = {};
  results.forEach((r, i) => {
    data[syms[i]] = r.status === 'fulfilled' ? r.value : null;
  });

  res.status(200).json(data);
}

async function fetchFund(sym) {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${sym}?modules=defaultKeyStatistics%2CfinancialData`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  const res = d.quoteSummary.result[0];
  const ks = res.defaultKeyStatistics || {};
  const fd = res.financialData || {};
  return {
    roe:  fd.returnOnEquity?.raw  ?? null,
    inst: ks.heldPercentInstitutions?.raw ?? null,
    de:   ks.debtToEquity?.raw   ?? null,
    eps:  ks.trailingEps?.raw    ?? null,
    rev:  fd.revenueGrowth?.raw  ?? null,
  };
}
