// api/quote.js
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: 'symbols required' });

  const syms = symbols.split(',').map(s => s.trim()).filter(Boolean).slice(0, 40);
  const results = await Promise.allSettled(syms.map(sym => fetchOne(sym)));

  const data = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) {
      data[syms[i]] = r.value;
    } else {
      // 回傳基本結構，讓前端至少知道這支有嘗試但失敗
      data[syms[i]] = null;
      console.error(`[quote] failed: ${syms[i]}`, r.reason?.message || 'unknown');
    }
  });

  res.status(200).json(data);
}

async function fetchOne(sym) {
  // 自動嘗試 .TW 和 .TWO（上市/上櫃）
  const candidates = sym.endsWith('.TWO') ? [sym] :
                     sym.endsWith('.TW')  ? [sym, sym.replace('.TW','.TWO')] :
                     [sym];

  let lastErr;
  for(const s of candidates){
    try{
      const result = await fetchDirect(s);
      if(result) return result;
    }catch(e){ lastErr=e; }
  }
  throw lastErr || new Error(`no data for ${sym}`);
}

async function fetchDirect(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=30d`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${sym}`);

  const d = await r.json();
  const result = d?.chart?.result?.[0];
  if (!result) throw new Error(`no result for ${sym}`);

  const meta = result.meta;
  if (!meta) throw new Error(`no meta for ${sym}`);

  const price = meta.regularMarketPrice;
  if (!price || price <= 0) throw new Error(`invalid price for ${sym}: ${price}`);

  const rawCloses = result.indicators?.quote?.[0]?.close || [];
  const closes = rawCloses.filter(v => v != null && v > 0 && isFinite(v));
  const rawVols = result.indicators?.quote?.[0]?.volume || [];
  const vols = rawVols.filter(v => v != null && v >= 0);

  let prev = meta.chartPreviousClose || 0;
  if (closes.length >= 2) {
    const histPrev = closes[closes.length - 2];
    if (histPrev > 0 && Math.abs(histPrev - price) / price < 0.35) prev = histPrev;
  }

  let chg = 0;
  if (prev > 0) {
    const raw = (price - prev) / prev * 100;
    chg = isFinite(raw) && Math.abs(raw) < 35 ? raw : 0;
  }

  let ma20 = null;
  if (closes.length >= 5) {
    const slice = closes.slice(-20);
    ma20 = slice.reduce((a, b) => a + b, 0) / slice.length;
  }

  let bias = null;
  if (ma20 && ma20 > 0) {
    const raw = (price - ma20) / ma20 * 100;
    bias = isFinite(raw) && Math.abs(raw) < 60 ? raw : null;
  }

  return { price, prev, ma20, vol: vols.length > 0 ? vols[vols.length-1] : null, chg, bias };
}
