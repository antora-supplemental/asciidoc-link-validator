'use strict'

const fs = require('node:fs')
const path = require('node:path')

/**
 * Baseline shape: { version, generatedAt, invalid: [{ url, classification, status }] }
 */
function readBaseline (filePath) {
  if (!filePath) return null
  const abs = path.resolve(filePath)
  if (!fs.existsSync(abs)) return null
  try {
    const data = JSON.parse(fs.readFileSync(abs, 'utf8'))
    if (!data || typeof data !== 'object') return null
    return data
  } catch {
    return null
  }
}

function writeBaseline (filePath, reportOrBaseline) {
  if (!filePath) throw new Error('baseline path required')
  const abs = path.resolve(filePath)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  const invalid = (reportOrBaseline.invalid || reportOrBaseline.links || [])
    .filter((l) => l.ok === false || l.classification)
    .map((l) => ({
      url: l.url,
      classification: l.classification,
      status: l.status ?? null,
    }))
  // Prefer explicit invalid list from report
  let list
  if (reportOrBaseline.invalid) {
    list = reportOrBaseline.invalid.map((l) => ({
      url: l.url,
      classification: l.classification,
      status: l.status ?? null,
    }))
  } else if (Array.isArray(reportOrBaseline.links)) {
    list = reportOrBaseline.links
      .filter((l) => !l.ok && !l.suppressed)
      .map((l) => ({
        url: l.url,
        classification: l.classification,
        status: l.status ?? null,
      }))
  } else if (Array.isArray(reportOrBaseline)) {
    list = reportOrBaseline
  } else {
    list = invalid
  }

  const baseline = {
    version: 1,
    generatedAt: new Date().toISOString(),
    invalid: list,
  }
  fs.writeFileSync(abs, JSON.stringify(baseline, null, 2) + '\n', 'utf8')
  return baseline
}

function baselineUrlSet (baseline) {
  const set = new Set()
  if (!baseline) return set
  const list = baseline.invalid || baseline.links || []
  for (const item of list) {
    const url = typeof item === 'string' ? item : item?.url
    if (url) set.add(url)
  }
  return set
}

module.exports = {
  readBaseline,
  writeBaseline,
  baselineUrlSet,
}
