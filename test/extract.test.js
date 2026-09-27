'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
  extractUrlsFromHtml,
  extractUrlsFromAsciiDoc,
  extractFromContent,
  normalizeUrl,
} = require('../lib/extract.js')

describe('normalizeUrl', () => {
  it('accepts https URLs', () => {
    assert.equal(normalizeUrl('https://example.com/a'), 'https://example.com/a')
  })
  it('strips trailing punctuation', () => {
    assert.equal(normalizeUrl('https://example.com/a.'), 'https://example.com/a')
  })
  it('rejects non-http', () => {
    assert.equal(normalizeUrl('ftp://example.com'), null)
  })
})

describe('extractUrlsFromHtml', () => {
  it('finds href and src', () => {
    const html = '<a href="https://a.example/x">x</a><img src="https://b.example/i.png">'
    const urls = extractUrlsFromHtml(html, { sourcePage: '/p/' }).map((e) => e.url).sort()
    assert.deepEqual(urls, ['https://a.example/x', 'https://b.example/i.png'])
  })
  it('respects checkImages=false', () => {
    const html = '<a href="https://a.example/x">x</a><img src="https://b.example/i.png">'
    const urls = extractUrlsFromHtml(html, { checkImages: false }).map((e) => e.url)
    assert.deepEqual(urls, ['https://a.example/x'])
  })
})

describe('extractUrlsFromAsciiDoc', () => {
  it('finds link:, bare URL, image::, video::', () => {
    const adoc = `
See link:https://docs.example/guide[Guide] and https://bare.example/path.
image::https://cdn.example/a.png[Alt]
video::https://cdn.example/v.mp4[]
`
    const urls = extractUrlsFromAsciiDoc(adoc, { sourcePage: 'ROOT:page.adoc' })
      .map((e) => e.url)
      .sort()
    assert.ok(urls.includes('https://docs.example/guide'))
    assert.ok(urls.includes('https://bare.example/path'))
    assert.ok(urls.includes('https://cdn.example/a.png'))
    assert.ok(urls.includes('https://cdn.example/v.mp4'))
  })
})

describe('extractFromContent', () => {
  it('merges sources for the same URL', () => {
    const entries = extractFromContent({
      html: '<a href="https://shared.example/x">x</a>',
      asciidoc: 'link:https://shared.example/x[X]',
      sourcePage: '/a/',
    })
    assert.equal(entries.length, 1)
    assert.equal(entries[0].url, 'https://shared.example/x')
  })
})
