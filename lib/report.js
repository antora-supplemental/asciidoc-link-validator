'use strict'

const fs = require('node:fs')
const path = require('node:path')

const { baselineUrlSet } = require('./baseline.js')
const { buildGroupings } = require('./groupings.js')

/**
 * Build report JSON with delta vs baseline + groupings.
 *
 * Schema:
 * {
 *   version, generatedAt, meta,
 *   links, invalid, suppressed, summary,
 *   newlyInvalid, stillInvalid, recovered,
 *   groupings: { default, byDestination, bySourcePage, byStatus, byHost }
 * }
 */
function buildReport ({
  results = [],
  suppressed = [],
  baseline = null,
  meta = {},
  groupingDefault = null,
} = {}) {
  const invalid = results.filter((r) => !r.ok && !r.suppressed)
  const okLinks = results.filter((r) => r.ok)
  const prior = baselineUrlSet(baseline)
  const currentInvalidUrls = new Set(invalid.map((r) => r.url))

  const newlyInvalid = invalid.filter((r) => !prior.has(r.url))
  const stillInvalid = invalid.filter((r) => prior.has(r.url))
  const recovered = [...prior].filter((url) => !currentInvalidUrls.has(url)).map((url) => {
    const found = results.find((r) => r.url === url)
    return {
      url,
      classification: found?.classification || 'ok',
      status: found?.status ?? 200,
      ok: true,
      recovered: true,
    }
  })

  const byClassification = {}
  for (const r of invalid) {
    byClassification[r.classification] = (byClassification[r.classification] || 0) + 1
  }

  const groupings = buildGroupings(invalid, { defaultMode: groupingDefault || undefined })

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    meta: {
      reportEmail: meta.reportEmail || 'support@devcentr.org',
      ...meta,
    },
    summary: {
      total: results.length + suppressed.length,
      checked: results.length,
      ok: okLinks.length,
      invalid: invalid.length,
      suppressed: suppressed.length,
      newlyInvalid: newlyInvalid.length,
      stillInvalid: stillInvalid.length,
      recovered: recovered.length,
      byClassification,
      groupingDefault: groupings.default,
    },
    links: results,
    invalid,
    suppressed,
    newlyInvalid,
    stillInvalid,
    recovered,
    groupings,
  }
}

function formatMarkdown (report) {
  const lines = []
  lines.push('# Link Validator report')
  lines.push('')
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push('')
  const s = report.summary
  lines.push(`- Checked: **${s.checked}**`)
  lines.push(`- OK: **${s.ok}**`)
  lines.push(`- Invalid: **${s.invalid}**`)
  lines.push(`- Suppressed: **${s.suppressed}**`)
  lines.push(`- Newly invalid: **${s.newlyInvalid}**`)
  lines.push(`- Still invalid: **${s.stillInvalid}**`)
  lines.push(`- Recovered: **${s.recovered}**`)
  lines.push(`- Default grouping: **${s.groupingDefault || report.groupings?.default || 'bySourcePage'}**`)
  lines.push('')

  if (report.newlyInvalid?.length) {
    lines.push('## Newly invalid')
    lines.push('')
    for (const r of report.newlyInvalid) {
      lines.push(`- \`${r.url}\` — ${r.classification}` +
        (r.status != null ? ` (${r.status})` : '') +
        (r.sources?.length ? ` — from ${r.sources.join(', ')}` : ''))
    }
    lines.push('')
  }

  if (report.stillInvalid?.length) {
    lines.push('## Still invalid')
    lines.push('')
    for (const r of report.stillInvalid) {
      lines.push(`- \`${r.url}\` — ${r.classification}` +
        (r.status != null ? ` (${r.status})` : ''))
    }
    lines.push('')
  }

  if (report.recovered?.length) {
    lines.push('## Recovered')
    lines.push('')
    for (const r of report.recovered) {
      lines.push(`- \`${r.url}\``)
    }
    lines.push('')
  }

  if (report.invalid?.length && !report.newlyInvalid?.length && !report.stillInvalid?.length) {
    lines.push('## Invalid links')
    lines.push('')
    for (const r of report.invalid) {
      lines.push(`- \`${r.url}\` — ${r.classification}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

function formatTextEmail (report) {
  const s = report.summary
  const email = report.meta?.reportEmail || 'support@devcentr.org'
  const lines = []
  lines.push(`Subject: Link Validator — ${s.invalid} invalid link(s)`)
  lines.push(`To: ${email}`)
  lines.push('')
  lines.push(`Link Validator report (${report.generatedAt})`)
  lines.push('')
  lines.push(`Checked: ${s.checked}`)
  lines.push(`OK: ${s.ok}`)
  lines.push(`Invalid: ${s.invalid}`)
  lines.push(`Newly invalid: ${s.newlyInvalid}`)
  lines.push(`Still invalid: ${s.stillInvalid}`)
  lines.push(`Recovered: ${s.recovered}`)
  lines.push(`Default grouping: ${s.groupingDefault || report.groupings?.default || 'bySourcePage'}`)
  lines.push('')
  if (report.invalid?.length) {
    lines.push('Invalid links:')
    for (const r of report.invalid) {
      const src = r.sources?.length ? ` [${r.sources.join('; ')}]` : ''
      lines.push(`  - ${r.url} => ${r.classification}` +
        (r.status != null ? ` (${r.status})` : '') + src)
    }
  } else {
    lines.push('No invalid links.')
  }
  lines.push('')
  return lines.join('\n')
}

/** Build a properly percent-encoded mailto: href (subject + body). */
function mailtoHref (report) {
  const email = report.meta?.reportEmail || 'support@devcentr.org'
  const s = report.summary
  const subject = encodeURIComponent(`Link Validator — ${s.invalid} invalid link(s)`)
  // Body only (no Subject:/To: headers) for mail clients that paste the whole body
  const bodyLines = formatTextEmail(report).split('\n').filter((l) => !/^Subject:|^To:/.test(l))
  const body = encodeURIComponent(bodyLines.join('\n').trim() + '\n')
  return `mailto:${email}?subject=${subject}&body=${body}`
}


/**
 * Build triage meta.reportHistory from archived report-*.json files in a directory.
 * Newest first. Skips the current in-memory report if its archive name is passed.
 *
 * @param {string} reportDir absolute path containing report.json + report-*.json archives
 * @param {{ limit?: number, excludeNames?: string[] }} [opts]
 * @returns {{ href: string, label: string, generatedAt: string|null, invalid: number|null, archive: string }[]}
 */
function buildReportHistory (reportDir, { limit = 20, excludeNames = [] } = {}) {
  const out = []
  if (!reportDir || !fs.existsSync(reportDir)) return out
  const exclude = new Set(excludeNames)
  let names
  try {
    names = fs.readdirSync(reportDir).filter((n) => /^report-.+\.json$/i.test(n) && !exclude.has(n))
  } catch {
    return out
  }
  const entries = []
  for (const name of names) {
    const full = path.join(reportDir, name)
    try {
      const st = fs.statSync(full)
      let generatedAt = null
      let invalid = null
      try {
        const raw = JSON.parse(fs.readFileSync(full, 'utf8'))
        generatedAt = raw.generatedAt || null
        invalid = raw.summary && typeof raw.summary.invalid === 'number' ? raw.summary.invalid : null
      } catch (_) {}
      entries.push({
        name,
        mtime: st.mtimeMs,
        generatedAt,
        invalid,
      })
    } catch (_) {}
  }
  entries.sort((a, b) => {
    const ta = a.generatedAt ? Date.parse(a.generatedAt) : a.mtime
    const tb = b.generatedAt ? Date.parse(b.generatedAt) : b.mtime
    return (tb || 0) - (ta || 0)
  })
  for (const e of entries.slice(0, limit)) {
    const label = e.generatedAt
      ? e.generatedAt
      : e.name.replace(/^report-/, '').replace(/\.json$/i, '')
    out.push({
      href: './' + e.name,
      label,
      generatedAt: e.generatedAt,
      invalid: e.invalid,
      archive: e.name,
    })
  }
  return out
}

module.exports = {
  buildReport,
  buildReportHistory,
  formatMarkdown,
  formatTextEmail,
  mailtoHref,
}
