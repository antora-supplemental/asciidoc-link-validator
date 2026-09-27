'use strict'

/**
 * Validate URLs: HEAD then GET fallback, redirects, timeout, concurrency, retries.
 */

const DEFAULT_TIMEOUT_MS = 10000
const DEFAULT_CONCURRENCY = 8
const DEFAULT_RETRIES = 2
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504])

function classifyStatus (status, errorCode) {
  if (errorCode === 'ENOTFOUND' || errorCode === 'EAI_AGAIN') return 'dns'
  if (errorCode === 'CERT_HAS_EXPIRED' || errorCode === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
      errorCode === 'ERR_TLS_CERT_ALTNAME_INVALID' || (errorCode && String(errorCode).includes('SSL'))) {
    return 'ssl'
  }
  if (errorCode === 'ABORT_ERR' || errorCode === 'UND_ERR_CONNECT_TIMEOUT' ||
      errorCode === 'UND_ERR_HEADERS_TIMEOUT' || errorCode === 'ETIMEDOUT' || errorCode === 'timeout') {
    return 'timeout'
  }
  if (status == null) return 'other'
  if (status >= 200 && status < 400) return 'ok'
  if (status === 404 || status === 410) return '404'
  if (status === 401 || status === 403) return 'forbidden'
  if (status === 429) return 'other'
  if (status >= 500) return 'other'
  return 'other'
}

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchOnce (url, { method, timeoutMs, redirect }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method,
      redirect: redirect || 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'asciidoc-link-validator/0.1 (+https://github.com/antora-supplemental/asciidoc-link-validator)',
        accept: '*/*',
      },
    })
    // Drain/cancel body to free the socket
    try { await res.body?.cancel?.() } catch (_) {}
    return { status: res.status, ok: res.ok, finalUrl: res.url, redirected: res.redirected }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Check a single URL. Returns { url, status, classification, ok, error, finalUrl, redirected }
 */
async function checkUrl (url, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = DEFAULT_RETRIES,
  softFail403 = true,
} = {}) {
  let lastError = null
  let lastStatus = null
  let lastMeta = {}

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let result
      try {
        result = await fetchOnce(url, { method: 'HEAD', timeoutMs })
      } catch (headErr) {
        // Some hosts reject HEAD — fall through to GET
        result = null
        lastError = headErr
      }

      if (!result || result.status === 405 || result.status === 501 ||
          (result.status >= 400 && result.status !== 404 && result.status !== 403 && result.status !== 401)) {
        try {
          result = await fetchOnce(url, { method: 'GET', timeoutMs })
        } catch (getErr) {
          lastError = getErr
          result = null
        }
      }

      if (result) {
        lastStatus = result.status
        lastMeta = result
        const classification = classifyStatus(result.status)
        const softOk = softFail403 && classification === 'forbidden'
        const ok = classification === 'ok' || softOk
        // Retry on 429/5xx
        if (RETRY_STATUSES.has(result.status) && attempt < retries) {
          await sleep(250 * (attempt + 1))
          continue
        }
        return {
          url,
          status: result.status,
          classification: softOk ? 'forbidden' : classification,
          ok,
          softOk,
          error: null,
          finalUrl: result.finalUrl || url,
          redirected: Boolean(result.redirected),
        }
      }
    } catch (err) {
      lastError = err
    }

    if (attempt < retries) await sleep(250 * (attempt + 1))
  }

  const code = lastError?.cause?.code || lastError?.code || (lastError?.name === 'AbortError' ? 'timeout' : null)
  const classification = classifyStatus(lastStatus, code)
  return {
    url,
    status: lastStatus,
    classification,
    ok: false,
    softOk: false,
    error: lastError ? String(lastError.message || lastError) : 'unknown',
    finalUrl: lastMeta.finalUrl || url,
    redirected: Boolean(lastMeta.redirected),
  }
}

/**
 * Simple concurrency pool.
 */
async function mapPool (items, concurrency, fn) {
  const results = new Array(items.length)
  let next = 0
  async function worker () {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1))
  await Promise.all(Array.from({ length: n }, () => worker()))
  return results
}

/**
 * Check many URL entries (objects with .url or plain strings).
 */
async function checkUrls (entries, {
  concurrency = DEFAULT_CONCURRENCY,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = DEFAULT_RETRIES,
  softFail403 = true,
  onProgress,
} = {}) {
  const list = entries.map((e) => (typeof e === 'string' ? { url: e } : e))
  let done = 0
  const results = await mapPool(list, concurrency, async (entry) => {
    const checked = await checkUrl(entry.url, { timeoutMs, retries, softFail403 })
    done += 1
    if (typeof onProgress === 'function') onProgress(done, list.length, checked)
    return {
      ...entry,
      ...checked,
      sources: entry.sources || [],
      kind: entry.kind || 'link',
    }
  })
  return results
}

module.exports = {
  checkUrl,
  checkUrls,
  classifyStatus,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_CONCURRENCY,
  DEFAULT_RETRIES,
}
