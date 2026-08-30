// Radovin árfigyelő – újrapróbálkozás (retry) segéd (guide §28 reliability / §20 push retry).
//
// Commit 8 „push retry": a publikálás / deploy-git-push hibája esetén ne adjuk fel
// azonnal – véges, exponenciális háttérvárással újrapróbáljuk (default 3, háttérvárás
// 1s → 2s → 4s). A riasztó a végső kudarcról kap értesítést (push failure jelzés).

'use strict';

const { log } = require('./logger.js');

/**
 * Újrapróbálkozásos művelet. Ha a fn kivételt dob, retries-szor újra próbáljuk,
 * háttérvárással (baseDelay * 2^attempt). So-végső kudarcnál a hibát dobjuk tovább.
 * @param {Function} fn async/null-erős művelet
 * @param {Object} opts { retries, baseDelayMs, label, logFailures }
 * @returns {Promise<*>}
 */
async function withRetry(fn, opts = {}) {
  const retries = opts.retries != null ? opts.retries : 3;
  const baseDelayMs = opts.baseDelayMs != null ? opts.baseDelayMs : 1000;
  const label = opts.label || 'op';
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fn(attempt);
      if (attempt > 0) log('retry_success', { op: label, attempt });
      return r;
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const delay = baseDelayMs * Math.pow(2, attempt);
      if (opts.logFailures !== false) {
        log('retry_wait', { op: label, attempt: attempt + 1, of: retries, delay_ms: delay, error: err && err.message });
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  log('retry_failed', { op: label, error: lastErr && lastErr.message });
  throw lastErr;
}

module.exports = { withRetry };
