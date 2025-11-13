const crypto = require('crypto');

// batchInvoke: accept array of {id, prompt}, check cache via provided callModel, and run parallel calls with throttling
async function batchInvoke(items, callModel, opts = {}) {
  // naive concurrency control
  const concurrency = opts.concurrency || 6;
  const results = [];
  let idx = 0;

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) break;
      const it = items[i];
      try {
        const out = await callModel(it.prompt, opts);
        results.push({ id: it.id, text: out.text, _cached: out._cached || false });
      } catch (err) {
        results.push({ id: it.id, error: String(err) });
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

module.exports = { batchInvoke };
