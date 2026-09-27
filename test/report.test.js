'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const ospath = require('node:path')
const { buildReport, buildReportHistory, formatMarkdown, formatTextEmail } = require('../lib/report.js')

describe('report diff', () => {
  it('computes newlyInvalid, stillInvalid, recovered', () => {
    const baseline = {
      version: 1,
      invalid: [
        { url: 'https://still.example/x', classification: '404' },
        { url: 'https://fixed.example/y', classification: '404' },
      ],
    }
    const results = [
      { url: 'https://still.example/x', ok: false, classification: '404', status: 404, sources: ['/a/'] },
      { url: 'https://new.example/z', ok: false, classification: 'dns', status: null, sources: ['/b/'] },
      { url: 'https://ok.example/', ok: true, classification: 'ok', status: 200, sources: ['/c/'] },
      { url: 'https://fixed.example/y', ok: true, classification: 'ok', status: 200, sources: ['/d/'] },
    ]
    const report = buildReport({ results, suppressed: [], baseline })
    assert.equal(report.summary.invalid, 2)
    assert.equal(report.newlyInvalid.map((r) => r.url).join(), 'https://new.example/z')
    assert.equal(report.stillInvalid.map((r) => r.url).join(), 'https://still.example/x')
    assert.equal(report.recovered.map((r) => r.url).join(), 'https://fixed.example/y')
  })

  it('formats markdown and text email', () => {
    const report = buildReport({
      results: [
        { url: 'https://bad.example/', ok: false, classification: '404', status: 404, sources: ['/p/'] },
      ],
      suppressed: [],
      baseline: null,
      meta: { reportEmail: 'support@devcentr.org' },
    })
    const md = formatMarkdown(report)
    assert.match(md, /Link Validator report/)
    assert.match(md, /bad\.example/)
    const text = formatTextEmail(report)
    assert.match(text, /support@devcentr\.org/)
    assert.match(text, /Invalid: 1/)
  })
})

describe('report history', () => {
  it('lists archived report-*.json newest first', () => {
    const dir = fs.mkdtempSync(ospath.join(os.tmpdir(), 'lv-hist-'))
    try {
      const older = {
        generatedAt: '2026-01-01T00:00:00.000Z',
        summary: { invalid: 3 },
      }
      const newer = {
        generatedAt: '2026-06-01T12:00:00.000Z',
        summary: { invalid: 1 },
      }
      fs.writeFileSync(ospath.join(dir, 'report-2026-01-01T00-00-00-000Z.json'), JSON.stringify(older))
      fs.writeFileSync(ospath.join(dir, 'report-2026-06-01T12-00-00-000Z.json'), JSON.stringify(newer))
      fs.writeFileSync(ospath.join(dir, 'report.json'), JSON.stringify({ summary: { invalid: 0 } }))
      const hist = buildReportHistory(dir, { limit: 10 })
      assert.equal(hist.length, 2)
      assert.equal(hist[0].invalid, 1)
      assert.equal(hist[1].invalid, 3)
      assert.match(hist[0].href, /report-2026-06-01/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
