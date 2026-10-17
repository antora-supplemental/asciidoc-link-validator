'use strict'

const fs = require('node:fs')
const path = require('node:path')

const CACHE_VERSION = 1

function normalizeCacheKey (url, method = 'HEAD') {
  try {
    const u = new URL(url)
    u.hash = ''
    return `${method.toUpperCase()} ${u.href}`
  } catch {
    return `${method.toUpperCase()} ${String(url).trim()}`
  }
}

function loadCacheFile (cachePath) {
  if (!cachePath || !fs.existsSync(cachePath)) {
    return { version: CACHE_VERSION, entries: {} }
  }
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
    if (!raw || typeof raw !== 'object') return { version: CACHE_VERSION, entries: {} }
    return {
      version: raw.version || CACHE_VERSION,
      entries: raw.entries && typeof raw.entries === 'object' ? raw.entries : {},
      updatedAt: raw.updatedAt || null,
    }
  } catch {
    return { version: CACHE_VERSION, entries: {} }
  }
}

function saveCacheFile (cachePath, store) {
  if (!cachePath) return
  const dir = path.dirname(cachePath)
  fs.mkdirSync(dir, { recursive: true })
  const payload = {
    version: CACHE_VERSION,
    updatedAt: new Date().toISOString(),
    entries: store.entries || {},
  }
  fs.writeFileSync(cachePath, JSON.stringify(payload, null, 2) + '\n', 'utf8')
}

function isCacheFresh (entry, maxAgeMs) {
  if (!entry || !entry.checkedAt) return false
  const age = Date.now() - Date.parse(entry.checkedAt)
  if (!Number.isFinite(age)) return false
  return age >= 0 && age <= maxAgeMs
}

function entryFromCheck (checked, { etag = null, method = 'HEAD' } = {}) {
  return {
    url: checked.url,
    method,
    status: checked.status,
    classification: checked.classification,
    ok: checked.ok,
    softOk: Boolean(checked.softOk),
    finalUrl: checked.finalUrl || checked.url,
    redirected: Boolean(checked.redirected),
    checkedAt: new Date().toISOString(),
    etag: etag || null,
  }
}

function resultFromCacheEntry (entry, keyUrl) {
  return {
    url: keyUrl || entry.url,
    status: entry.status,
    classification: entry.classification,
    ok: entry.ok,
    softOk: entry.softOk,
    error: null,
    finalUrl: entry.finalUrl || entry.url,
    redirected: Boolean(entry.redirected),
    fromCache: true,
    cachedAt: entry.checkedAt,
  }
}

module.exports = {
  CACHE_VERSION,
  normalizeCacheKey,
  loadCacheFile,
  saveCacheFile,
  isCacheFresh,
  entryFromCheck,
  resultFromCacheEntry,
}
