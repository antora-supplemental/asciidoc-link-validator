'use strict'

/**
 * Validate URLs: HEAD then GET fallback, redirects, timeout, per-host throttling, retries.
 */

const { resolveHostPolicy, resolveGlobalConcurrency } = require('./host-policy.js')
const { HostQueue } = require('./host-queue.js')
const {
  normalizeCacheKey,
  loadCacheFile,
  saveCacheFile,
  isCacheFresh,
  entryFromCheck,
  resultFromCacheEntry,
} = require('./cache.js')
const { resolveInvalidationLists, entryForceLive } = require('./invalidate.js')

const DEFAULT_TIMEOUT_MS = 10000
const DEFAULT_CONCURRENCY = 8
const DEFAULT_RETRIES = 2
const MAX_RETRIES_CAP = 8
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504])
const DEFERRED_CLASSIFICATIONS = new Set(['rate-limited', 'unreachable'])

const PKG_VERSION = (() => {
  try {
    return require('../package.json').version
  } catch {
    return '0.2'
  }
})()

function classifyStatus (status, errorCode, { exhausted429 = false } = {}) {
  if (exhausted429 || status === 429) return 'rate-limited'
  if (errorCode === 'ENOTFOUND' || errorCode === 'EAI_AGAIN') return 'dns'
  if (errorCode === 'CERT_HAS_EXPIRED' || errorCode === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
      errorCode === 'ERR_TLS_CERT_ALTNAME_INVALID' || (errorCode && String(errorCode).includes('SSL'))) {
    return 'ssl'
  }
  if (errorCode === 'ABORT_ERR' || errorCode === 'UND_ERR_CONNECT_TIMEOUT' ||
      errorCode === 'UND_ERR_HEADERS_TIMEOUT' || errorCode === 'ETIMEDOUT' || errorCode === 'timeout') {
    return 'unreachable'
  }
  if (status == null) return 'unreachable'
  if (status >= 200 && status < 400) return 'ok'
  if (status === 404 || status === 410) return '404'
  if (status === 401 || status === 403) return 'forbidden'
  if (status >= 500) return 'server-error'
  return 'other'
}

function isDeferredClassification (classification) {
  return DEFERRED_CLASSIFICATIONS.has(classification)
}

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseRetryAfterMs (headerValue) {
  if (headerValue == null || headerValue === '') return null
  const asNum = Number(headerValue)
  if (Number.isFinite(asNum) && asNum >= 0) return Math.ceil(asNum * 1000)
  const asDate = Date.parse(String(headerValue))
  if (Number.isFinite(asDate)) {
    const delta = asDate - Date.now()
    return delta > 0 ? delta : 0
  }
  return null
}

function buildRequestHeaders (url, { githubToken = null } = {}) {
  const headers = {
    'user-agent': `asciidoc-link-validator/${PKG_VERSION} (+https://github.com/antora-supplemental/asciidoc-link-validator)`,
    accept: '*/*',
  }
  if (!githubToken) return headers
  let hostname
  try { hostname = new URL(url).hostname.toLowerCase() } catch { return headers }
  if (hostname === 'github.com' || hostname === 'www.github.com' ||
      hostname === 'api.github.com' || hostname === 'raw.githubusercontent.com') {
    headers.authorization = `Bearer ${githubToken}`
    if (hostname === 'api.github.com') {
      headers.accept = 'application/vnd.github+json'
    }
  }
  return headers
}

async function fetchOnce (url, { method, timeoutMs, redirect, githubToken, etag }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const headers = buildRequestHeaders(url, { githubToken })
  if (etag) headers['if-none-match'] = etag
  try {
    const res = await fetch(url, {
      method,
      redirect: redirect || 'follow',
      signal: controller.signal,
      headers,
    })
    const retryAfter = parseRetryAfterMs(res.headers.get('retry-after'))
    const resEtag = res.headers.get('etag')
    try { await res.body?.cancel?.() } catch (_) {}
    return {
      status: res.status,
      ok: res.ok,
      finalUrl: res.url,
      redirected: res.redirected,
      retryAfter,
      etag: resEtag,
    }
  } finally {
    clearTimeout(timer)
  }
}

function resolveGitHubToken (opts = {}) {
  if (opts.githubToken) return String(opts.githubToken)
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN
  return null
}

/**
 * Check a single URL. Returns { url, status, classification, ok, error, finalUrl, redirected }
 */
async function checkUrl (url, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = DEFAULT_RETRIES,
  softFail403 = true,
  githubToken = null,
  hostQueue = null,
  hostPolicy = null,
} = {}) {
  const token = githubToken ?? resolveGitHubToken()
  const policy = hostPolicy || resolveHostPolicy(url, { githubToken: token })
  const maxAttempts = Math.min(MAX_RETRIES_CAP, Math.max(retries, policy.maxRetries ?? retries))

  const runCheck = async () => {
    let lastError = null
    let lastStatus = null
    let lastMeta = {}
    let lastEtag = null

    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      try {
        let result
        try {
          result = await fetchOnce(url, { method: 'HEAD', timeoutMs, githubToken: token, etag: lastEtag })
        } catch (headErr) {
          result = null
          lastError = headErr
        }

        if (!result || result.status === 405 || result.status === 501 ||
            (result.status >= 400 && result.status !== 404 && result.status !== 403 && result.status !== 401)) {
          try {
            result = await fetchOnce(url, { method: 'GET', timeoutMs, githubToken: token, etag: lastEtag })
          } catch (getErr) {
            lastError = getErr
            result = null
          }
        }

        if (result) {
          lastStatus = result.status
          lastMeta = result
          if (result.etag) lastEtag = result.etag

          if (result.status === 304) {
            return {
              url,
              status: 200,
              classification: 'ok',
              ok: true,
              softOk: false,
              error: null,
              finalUrl: result.finalUrl || url,
              redirected: Boolean(result.redirected),
              etag: lastEtag,
            }
          }

          const classification = classifyStatus(result.status)
          const softOk = softFail403 && classification === 'forbidden'
          const ok = classification === 'ok' || softOk

          if (RETRY_STATUSES.has(result.status) && attempt < maxAttempts) {
            const waitMs = result.retryAfter ?? (500 * Math.pow(2, attempt))
            await sleep(waitMs)
            continue
          }

          if (result.status === 429 && attempt >= maxAttempts) {
            return {
              url,
              status: result.status,
              classification: 'rate-limited',
              ok: false,
              softOk: false,
              error: null,
              finalUrl: result.finalUrl || url,
              redirected: Boolean(result.redirected),
              deferred: true,
              etag: lastEtag,
            }
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
            deferred: isDeferredClassification(classification),
            etag: lastEtag,
          }
        }
      } catch (err) {
        lastError = err
      }

      if (attempt < maxAttempts) {
        await sleep(400 * (attempt + 1))
      }
    }

    const code = lastError?.cause?.code || lastError?.code ||
      (lastError?.name === 'AbortError' ? 'timeout' : null)
    const classification = classifyStatus(lastStatus, code, {
      exhausted429: lastStatus === 429,
    })
    return {
      url,
      status: lastStatus,
      classification,
      ok: false,
      softOk: false,
      error: lastError ? String(lastError.message || lastError) : 'unknown',
      finalUrl: lastMeta.finalUrl || url,
      redirected: Boolean(lastMeta.redirected),
      deferred: isDeferredClassification(classification),
      etag: lastEtag,
    }
  }

  if (hostQueue) {
    let hostname
    try { hostname = new URL(url).hostname } catch { hostname = null }
    return hostQueue.run(hostname, policy, runCheck)
  }
  return runCheck()
}

/**
 * Simple concurrency pool (global cap across hosts).
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
  githubToken = null,
  cacheEnabled = false,
  cachePath = null,
  cacheMaxAgeMs = null,
  cacheBypass = false,
  invalidateSources = [],
  invalidateUrls = [],
  reportRateLimited = false,
} = {}) {
  const token = resolveGitHubToken({ githubToken })
  const list = entries.map((e) => (typeof e === 'string' ? { url: e } : e))
  const invalidation = resolveInvalidationLists({ invalidateSources, invalidateUrls })
  invalidation.cacheBypass = Boolean(cacheBypass)

  const cacheStore = cacheEnabled && cachePath && !cacheBypass
    ? loadCacheFile(cachePath)
    : { entries: {} }

  const hostQueue = new HostQueue()
  const globalConcurrency = resolveGlobalConcurrency(list, {
    githubToken: token,
    override: concurrency,
  })

  let done = 0
  let cachedCount = 0

  const results = await mapPool(list, globalConcurrency, async (entry) => {
    const forceLive = entryForceLive(entry, invalidation)
    const policy = resolveHostPolicy(entry.url, { githubToken: token })
    const maxAge = cacheMaxAgeMs ?? policy.cacheMaxAgeMs

    if (cacheEnabled && cachePath && !forceLive) {
      const key = normalizeCacheKey(entry.url, 'HEAD')
      const hit = cacheStore.entries[key]
      if (hit && isCacheFresh(hit, maxAge)) {
        cachedCount += 1
        done += 1
        const checked = resultFromCacheEntry(hit, entry.url)
        if (typeof onProgress === 'function') onProgress(done, list.length, checked)
        return {
          ...entry,
          ...checked,
          sources: entry.sources || [],
          kind: entry.kind || 'link',
        }
      }
    }

    const checked = await checkUrl(entry.url, {
      timeoutMs,
      retries,
      softFail403,
      githubToken: token,
      hostQueue,
      hostPolicy: policy,
    })

    if (!reportRateLimited && checked.classification === 'rate-limited') {
      checked.deferred = true
    }
    if (checked.classification === 'unreachable') {
      checked.deferred = true
    }

    if (cacheEnabled && cachePath && checked.classification !== 'rate-limited') {
      const key = normalizeCacheKey(entry.url, 'HEAD')
      cacheStore.entries[key] = entryFromCheck(checked, { etag: checked.etag, method: 'HEAD' })
    }

    done += 1
    if (typeof onProgress === 'function') onProgress(done, list.length, checked)
    return {
      ...entry,
      ...checked,
      sources: entry.sources || [],
      kind: entry.kind || 'link',
    }
  })

  if (cacheEnabled && cachePath) {
    try { saveCacheFile(cachePath, cacheStore) } catch (_) {}
  }

  results._meta = { cached: cachedCount, githubAuth: Boolean(token) }
  return results
}

module.exports = {
  checkUrl,
  checkUrls,
  classifyStatus,
  isDeferredClassification,
  resolveGitHubToken,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_CONCURRENCY,
  DEFAULT_RETRIES,
  DEFERRED_CLASSIFICATIONS,
}
