'use strict'

const { baselineUrlSet } = require('./baseline.js')

/**
 * Build report JSON with delta vs baseline.
 *
 * Schema:
 * {
 *   version, generatedAt, meta,
 *   links: [...],
 *   invalid: [...],
 *   suppressed: [...],
 *   summary: { total, ok, invalid, suppressed, ... },
 *   newlyInvalid, stillInvalid, recovered
 * }
 */
function buildReport ({
  results = [],
  suppressed = [],
  baseline = null,
  meta = {},
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
    },
    links: results,
    invalid,
    suppressed,
    newlyInvalid,
    stillInvalid,
    recovered,
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

function mailtoHref (report) {
  const email = report.meta?.reportEmail || 'support@devcentr.org'
  const s = report.summary
  const subject = encodeURIComponent(`Link Validator — ${s.invalid} invalid link(s)`)
  const body = encodeURIComponent(formatTextEmail(report))
  return `mailto:${email}?subject=${subject}&body=${body}`
}

module.exports = {
  buildReport,
  formatMarkdown,
  formatTextEmail,
  mailtoHref,
}
