'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { createProgress, detectTTY } = require('../lib/progress.js')

function capture (isTTY = false) {
  const chunks = []
  const stream = {
    isTTY,
    write (s) { chunks.push(s); return true },
  }
  return {
    stream,
    text: () => chunks.join(''),
  }
}

describe('createProgress preface', () => {
  it('emits tool id starting line then animated checking N files', () => {
    const cap = capture(false)
    const p = createProgress({ id: 'asciidoc-link-validator', stream: cap.stream, isTTY: false, every: 1 })
    p.starting('starting outbound link check')
    p.enumStart('files')
    p.enumTick(1)
    p.enumTick(2)
    p.enumDone(2, '4 links')
    const text = cap.text()
    assert.match(text, /asciidoc-link-validator: starting outbound link check/)
    assert.match(text, /asciidoc-link-validator: checking 0 files…/)
    assert.match(text, /asciidoc-link-validator: checking 1 files…/)
    assert.match(text, /asciidoc-link-validator: checking 2 files \(4 links\)…/)
  })

  it('throttles check progress on non-TTY and includes final', () => {
    const cap = capture(false)
    const p = createProgress({ id: 'asciidoc-link-validator', stream: cap.stream, isTTY: false, every: 25, everyPct: 50 })
    p.starting('starting outbound link check')
    p.checking(10, 'links')
    for (let i = 1; i <= 10; i++) p.tick(i, 10)
    const text = cap.text()
    assert.match(text, /checking 10 links…/)
    assert.match(text, /checked 10\/10/)
  })

  it('CI=true forces discrete lines even when stream.isTTY', () => {
    const prev = process.env.CI
    process.env.CI = 'true'
    try {
      assert.equal(detectTTY({ isTTY: true }), false)
      const cap = capture(true)
      const p = createProgress({ id: 'asciidoc-link-validator', stream: cap.stream, every: 1 })
      assert.equal(p._tty, false)
      p.starting('starting outbound link check')
      p.enumStart('files')
      p.enumTick(1)
      p.enumDone(1)
      const text = cap.text()
      assert.ok(!text.includes('\r'), 'CI mode must not use carriage returns')
      assert.match(text, /checking 0 files…/)
      assert.match(text, /checking 1 files…/)
    } finally {
      if (prev === undefined) delete process.env.CI
      else process.env.CI = prev
    }
  })

  it('is exported from package index', () => {
    const core = require('../lib/index.js')
    assert.equal(typeof core.createProgress, 'function')
    assert.equal(typeof core.detectTTY, 'function')
  })
})
