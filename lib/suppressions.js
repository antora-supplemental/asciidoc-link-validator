'use strict'

const fs = require('node:fs')
const path = require('node:path')

let yaml
try {
  yaml = require('js-yaml')
} catch {
  yaml = null
}

/**
 * Load .antora-link-suppressions.yml (or config path).
 * Entries: { url | glob | regex, reason, expires? }
 */
function loadSuppressions (filePath) {
  if (!filePath) return []
  const abs = path.resolve(filePath)
  if (!fs.existsSync(abs)) return []
  const raw = fs.readFileSync(abs, 'utf8')
  let data
  if (yaml) {
    data = yaml.load(raw)
  } else {
    // Minimal fallback: JSON only
    data = JSON.parse(raw)
  }
  if (!data) return []
  const list = Array.isArray(data) ? data : (data.suppressions || data.urls || [])
  if (!Array.isArray(list)) return []
  return list.map(normalizeRule).filter(Boolean)
}

function normalizeRule (entry) {
  if (!entry) return null
  if (typeof entry === 'string') {
    return { type: 'exact', pattern: entry, reason: '', expires: null }
  }
  const reason = entry.reason || entry.note || ''
  const expires = entry.expires || entry.expiry || null
  if (entry.url) return { type: 'exact', pattern: String(entry.url), reason, expires }
  if (entry.exact) return { type: 'exact', pattern: String(entry.exact), reason, expires }
  if (entry.glob) return { type: 'glob', pattern: String(entry.glob), reason, expires }
  if (entry.regex || entry.pattern) {
    return { type: 'regex', pattern: String(entry.regex || entry.pattern), reason, expires }
  }
  return null
}

function isExpired (expires, now = new Date()) {
  if (!expires) return false
  const d = new Date(expires)
  if (Number.isNaN(d.getTime())) return false
  return d.getTime() < now.getTime()
}

function globToRegExp (glob) {
  // Escape regex specials except * and ?
  let s = ''
  for (const ch of glob) {
    if (ch === '*') s += '.*'
    else if (ch === '?') s += '.'
    else if (/[.+^${}()|[\]\\]/.test(ch)) s += '\\' + ch
    else s += ch
  }
  return new RegExp('^' + s + '$', 'i')
}

function ruleMatches (rule, url) {
  if (!rule || !url) return false
  if (isExpired(rule.expires)) return false
  if (rule.type === 'exact') return rule.pattern === url
  if (rule.type === 'glob') return globToRegExp(rule.pattern).test(url)
  if (rule.type === 'regex') {
    try {
      return new RegExp(rule.pattern).test(url)
    } catch {
      return false
    }
  }
  return false
}

function findSuppression (url, rules) {
  for (const rule of rules || []) {
    if (ruleMatches(rule, url)) return rule
  }
  return null
}

/**
 * Annotate / filter check results. Returns { active, suppressed }.
 */
function filterSuppressed (results, rules) {
  const active = []
  const suppressed = []
  for (const r of results || []) {
    const rule = findSuppression(r.url, rules)
    if (rule) {
      suppressed.push({
        ...r,
        suppressed: true,
        suppressionReason: rule.reason || '',
        suppressionExpires: rule.expires || null,
      })
    } else {
      active.push({ ...r, suppressed: false })
    }
  }
  return { active, suppressed }
}

module.exports = {
  loadSuppressions,
  filterSuppressed,
  findSuppression,
  ruleMatches,
  normalizeRule,
  isExpired,
  globToRegExp,
}
