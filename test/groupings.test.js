'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
  buildGroupings,
  chooseDefaultGrouping,
  groupByHost,
  groupByStatus,
} = require('../lib/groupings.js')
const { buildReport, mailtoHref } = require('../lib/report.js')
const { normalizeCiTrigger, buildTriageActions } = require('../lib/triage-actions.js')
const { buildTriageHtml } = require('../lib/triage-page.js')

describe('groupings', () => {
  it('groups by destination, source, status, host', () => {
    const rows = [
      { url: 'https://old.example/a', classification: '404', status: 404, sources: ['/p1/', '/p2/'] },
      { url: 'https://old.example/b', classification: '404', status: 404, sources: ['/p1/'] },
      { url: 'https://other.example/c', classification: 'timeout', status: null, sources: ['/p3/'] },
    ]
    const g = buildGroupings(rows)
    assert.equal(g.byDestination.length, 3)
    assert.equal(g.byHost[0].key, 'old.example')
    assert.equal(g.byHost[0].count, 2)
    assert.ok(g.bySourcePage.find((x) => x.key === '/p1/' && x.count === 2))
    assert.ok(g.byStatus.find((x) => x.key === '404' && x.count === 2))
    assert.ok(g.byStatus.find((x) => x.key === 'timeout'))
  })

  it('defaults to byDestination when host clusters dominate', () => {
    const clustered = [
      { url: 'https://rebrand.example/1', classification: '404', status: 404, sources: ['/a/'] },
      { url: 'https://rebrand.example/2', classification: '404', status: 404, sources: ['/b/'] },
      { url: 'https://rebrand.example/3', classification: '404', status: 404, sources: ['/c/'] },
    ]
    assert.equal(chooseDefaultGrouping(clustered), 'byDestination')
    const sparse = [
      { url: 'https://a.example/1', classification: '404', status: 404, sources: ['/a/'] },
      { url: 'https://b.example/2', classification: 'dns', status: null, sources: ['/b/'] },
    ]
    assert.equal(chooseDefaultGrouping(sparse), 'bySourcePage')
  })

  it('embeds groupings in buildReport', () => {
    const report = buildReport({
      results: [
        { url: 'https://h.example/x', ok: false, classification: '404', status: 404, sources: ['/s/'] },
        { url: 'https://h.example/y', ok: false, classification: '5xx', status: 503, sources: ['/s/'] },
        { url: 'https://h.example/z', ok: false, classification: 'timeout', status: null, sources: ['/t/'] },
      ],
    })
    assert.equal(report.groupings.default, 'byDestination')
    assert.equal(report.summary.groupingDefault, 'byDestination')
    assert.ok(report.groupings.byHost.length)
  })

  it('statusBucket maps 5xx', () => {
    const g = groupByStatus([
      { url: 'https://x/', classification: 'other', status: 502, sources: [] },
    ])
    assert.equal(g[0].key, '5xx')
  })
})

describe('triage actions', () => {
  it('encodes mailto and normalizes ciTrigger without secrets', () => {
    const report = buildReport({
      results: [{ url: 'https://bad.example/', ok: false, classification: '404', status: 404, sources: ['/p/'] }],
      meta: { reportEmail: 'support@devcentr.org' },
    })
    const href = mailtoHref(report)
    assert.match(href, /^mailto:support@devcentr\.org\?subject=/)
    assert.match(href, /body=/)
    assert.ok(!href.includes('https://bad.example/')) // raw URL should be encoded
    assert.match(href, /bad\.example/)

    const ci = normalizeCiTrigger({
      enabled: true,
      provider: 'github',
      dispatchUrl: 'https://example.com/proxy/dispatch',
      statusUrl: 'https://example.com/proxy/status',
    })
    assert.equal(ci.enabled, true)
    assert.equal(ci.dispatchUrl, 'https://example.com/proxy/dispatch')
    assert.match(ci.note, /do not embed secrets/i)

    const actions = buildTriageActions(report, { ciTrigger: ci })
    assert.equal(actions.ciTrigger.enabled, true)
    assert.match(actions.mailto, /^mailto:/)
  })

  it('buildTriageHtml includes grouping select and optional CI button', () => {
    const html = buildTriageHtml({
      reportEmail: 'support@devcentr.org',
      ciTrigger: { enabled: true, dispatchUrl: 'https://proxy.example/dispatch' },
    })
    assert.match(html, /id="lv-group-by"/)
    assert.match(html, /byDestination/)
    assert.match(html, /id="lv-ci-trigger"/)
    assert.match(html, /LINK_VALIDATOR_CONFIG/)
    assert.ok(!html.includes('token'))
  })
})
