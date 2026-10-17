'use strict'

/**
 * Surgical cache bypass: force live checks for listed source pages or URLs.
 */

function splitList (value) {
  if (value == null) return []
  if (Array.isArray(value)) return value.flatMap(splitList)
  return String(value)
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function normalizePathLike (s) {
  return String(s)
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase()
}

function sourceMatchesInvalidation (sourcePage, patterns) {
  if (!sourcePage || !patterns?.length) return false
  const page = normalizePathLike(sourcePage)
  const pageNoLead = page.replace(/^\//, '')
  for (const raw of patterns) {
    const pat = normalizePathLike(raw)
    const patNoLead = pat.replace(/^\//, '')
    if (page === pat || pageNoLead === patNoLead) return true
    if (page.endsWith('/' + patNoLead) || pageNoLead.endsWith(patNoLead)) return true
    if (patNoLead && (page.includes(patNoLead) || pageNoLead.includes(patNoLead))) return true
  }
  return false
}

function urlMatchesInvalidation (url, patterns) {
  if (!url || !patterns?.length) return false
  let normalized
  try {
    const u = new URL(url)
    u.hash = ''
    normalized = u.href
  } catch {
    normalized = String(url).trim()
  }
  for (const raw of patterns) {
    const p = String(raw).trim()
    if (!p) continue
    if (normalized === p) return true
    try {
      const u2 = new URL(p)
      u2.hash = ''
      if (normalized === u2.href) return true
    } catch (_) {}
  }
  return false
}

function resolveInvalidationLists ({
  invalidateSources = [],
  invalidateUrls = [],
  env = process.env,
} = {}) {
  const sources = [
    ...splitList(invalidateSources),
    ...splitList(env.LINK_VALIDATOR_INVALIDATE_SOURCES),
  ]
  const urls = [
    ...splitList(invalidateUrls),
    ...splitList(env.LINK_VALIDATOR_INVALIDATE_URLS),
  ]
  return { invalidateSources: sources, invalidateUrls: urls }
}

function entryForceLive (entry, lists) {
  if (lists.cacheBypass) return true
  if (urlMatchesInvalidation(entry.url, lists.invalidateUrls)) return true
  const sources = entry.sources || []
  for (const src of sources) {
    if (sourceMatchesInvalidation(src, lists.invalidateSources)) return true
  }
  if (entry.sourceMap?.page && sourceMatchesInvalidation(entry.sourceMap.page, lists.invalidateSources)) {
    return true
  }
  return false
}

module.exports = {
  splitList,
  sourceMatchesInvalidation,
  urlMatchesInvalidation,
  resolveInvalidationLists,
  entryForceLive,
}
