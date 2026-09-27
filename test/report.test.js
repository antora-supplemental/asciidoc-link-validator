'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { buildReport, formatMarkdown, formatTextEmail } = require('../lib/report.js')

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
