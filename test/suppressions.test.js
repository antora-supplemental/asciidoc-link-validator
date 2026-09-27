'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  loadSuppressions,
  filterSuppressed,
  ruleMatches,
  isExpired,
} = require('../lib/suppressions.js')

describe('suppressions', () => {
  it('matches exact, glob, regex', () => {
    assert.equal(ruleMatches({ type: 'exact', pattern: 'https://a.example/x' }, 'https://a.example/x'), true)
    assert.equal(ruleMatches({ type: 'glob', pattern: 'https://b.example/*' }, 'https://b.example/y'), true)
    assert.equal(ruleMatches({ type: 'glob', pattern: 'https://b.example/*' }, 'https://c.example/y'), false)
    assert.equal(ruleMatches({ type: 'regex', pattern: '^https://re\\.example/' }, 'https://re.example/z'), true)
  })

  it('respects expiry', () => {
    assert.equal(isExpired('2000-01-01'), true)
    assert.equal(isExpired('2099-01-01'), false)
    assert.equal(
      ruleMatches({ type: 'exact', pattern: 'https://a.example/x', expires: '2000-01-01' }, 'https://a.example/x'),
      false
    )
  })

  it('loads YAML file and filters results', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-sup-'))
    const file = path.join(dir, 'suppressions.yml')
    fs.writeFileSync(file, `
suppressions:
  - url: https://skip.example/a
    reason: test
  - glob: https://glob.example/*
    reason: glob
`)
    const rules = loadSuppressions(file)
    assert.equal(rules.length, 2)
    const { active, suppressed } = filterSuppressed(
      [
        { url: 'https://skip.example/a', ok: false },
        { url: 'https://glob.example/x', ok: false },
        { url: 'https://keep.example/', ok: false },
      ],
      rules
    )
    assert.equal(suppressed.length, 2)
    assert.equal(active.length, 1)
    assert.equal(active[0].url, 'https://keep.example/')
  })
})
