'use strict'

/**
 * Extract http(s) URLs from HTML and AsciiDoc sources.
 */

const HTML_ATTR_RE = /\b(?:href|src|data-src|poster)=["'](https?:\/\/[^"'>\s]+)["']/gi

// AsciiDoc: link:URL[...], https://..., image::https://..., video::https://...
const ADOC_LINK_RE = /\blink:(https?:\/\/[^\s\[\]]+)(?:\[[^\]]*\])?/gi
const ADOC_IMAGE_RE = /\b(?:image|video|audio)::(https?:\/\/[^\s\[\]]+)(?:\[[^\]]*\])?/gi
const ADOC_BARE_RE = /(?<![\w/:])(https?:\/\/[^\s\[\]<>"'`)]+)/gi
const HTML_BARE_RE = /(?<![\w/])(https?:\/\/[^\s<>"'`)\]]+)/gi

function normalizeUrl (raw) {
  if (!raw || typeof raw !== 'string') return null
  let u = raw.trim()
  u = u.replace(/[.,;:!?)]+$/, '')
  if (!/^https?:\/\//i.test(u)) return null
  try {
    const parsed = new URL(u)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.href
  } catch {
    return null
  }
}

function pushUnique (list, seen, url, meta) {
  const n = normalizeUrl(url)
  if (!n) return
  if (seen.has(n)) {
    const existing = seen.get(n)
    if (meta?.sourcePage && !existing.sources.includes(meta.sourcePage)) {
      existing.sources.push(meta.sourcePage)
    }
    return
  }
  const entry = {
    url: n,
    sources: meta?.sourcePage ? [meta.sourcePage] : [],
    kind: meta?.kind || 'link',
  }
  seen.set(n, entry)
  list.push(entry)
}

function extractUrlsFromHtml (html, { sourcePage, checkImages = true } = {}) {
  const list = []
  const seen = new Map()
  const skippedImages = new Set()
  if (!html) return list

  let m
  const attrRe = new RegExp(HTML_ATTR_RE.source, 'gi')
  while ((m = attrRe.exec(html)) !== null) {
    const isImg = /(?:src|data-src|poster)=/i.test(m[0])
    if (isImg && !checkImages) {
      const n = normalizeUrl(m[1])
      if (n) skippedImages.add(n)
      continue
    }
    pushUnique(list, seen, m[1], {
      sourcePage,
      kind: isImg ? 'image' : 'link',
    })
  }

  // Bare URLs from text — skip any image URLs we intentionally ignored
  const bareRe = new RegExp(HTML_BARE_RE.source, 'gi')
  while ((m = bareRe.exec(html)) !== null) {
    const n = normalizeUrl(m[1])
    if (n && skippedImages.has(n)) continue
    pushUnique(list, seen, m[1], { sourcePage, kind: 'bare' })
  }

  return list
}

function extractUrlsFromAsciiDoc (text, { sourcePage, checkImages = true } = {}) {
  const list = []
  const seen = new Map()
  if (!text) return list

  let m
  const linkRe = new RegExp(ADOC_LINK_RE.source, 'gi')
  while ((m = linkRe.exec(text)) !== null) {
    pushUnique(list, seen, m[1], { sourcePage, kind: 'link' })
  }

  const mediaRe = new RegExp(ADOC_IMAGE_RE.source, 'gi')
  while ((m = mediaRe.exec(text)) !== null) {
    if (!checkImages) continue
    pushUnique(list, seen, m[1], { sourcePage, kind: 'image' })
  }

  const bareRe = new RegExp(ADOC_BARE_RE.source, 'gi')
  while ((m = bareRe.exec(text)) !== null) {
    pushUnique(list, seen, m[1], { sourcePage, kind: 'bare' })
  }

  return list
}

/**
 * Merge HTML + AsciiDoc extractions for one logical page.
 */
function extractFromContent ({ html, asciidoc, sourcePage, checkImages = true } = {}) {
  const map = new Map()
  for (const e of extractUrlsFromHtml(html, { sourcePage, checkImages })) {
    map.set(e.url, e)
  }
  for (const e of extractUrlsFromAsciiDoc(asciidoc, { sourcePage, checkImages })) {
    if (map.has(e.url)) {
      const cur = map.get(e.url)
      for (const s of e.sources) {
        if (!cur.sources.includes(s)) cur.sources.push(s)
      }
    } else {
      map.set(e.url, e)
    }
  }
  return [...map.values()]
}

module.exports = {
  extractUrlsFromHtml,
  extractUrlsFromAsciiDoc,
  extractFromContent,
  normalizeUrl,
}
