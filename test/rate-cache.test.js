'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const ospath = require('node:path')

const { checkUrl, checkUrls, classifyStatus } = require('../lib/check.js')
const { buildReport } = require('../lib/report.js')
const { loadCacheFile, saveCacheFile, isCacheFresh, entryFromCheck } = require('../lib/cache.js')
const { entryForceLive, sourceMatchesInvalidation } = require('../lib/invalidate.js')
const { resolveHostPolicy } = require('../lib/host-policy.js')

describe('429 retry and rate-limited classification', () => {
  it('retries 429 silently then classifies rate-limited', async () => {
    let hits = 0
    const server = http.createServer((req, res) => {
      hits += 1
      if (hits <= 2) {
        res.writeHead(429, { 'retry-after': '0' })
        res.end('slow down')
        return
      }
      res.writeHead(200)
      res.end('ok')
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()
    const url = `http://127.0.0.1:${port}/retry-429`
    try {
      const ok = await checkUrl(url, { timeoutMs: 3000, retries: 5 })
      assert.equal(ok.ok, true)
      assert.equal(ok.classification, 'ok')
      assert.ok(hits >= 3)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('exhausted 429 is deferred, not invalid', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(429, { 'retry-after': '0' })
      res.end('nope')
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()
    const url = `http://127.0.0.1:${port}/always-429`
    try {
      const result = await checkUrl(url, { timeoutMs: 2000, retries: 1 })
      assert.equal(result.classification, 'rate-limited')
      assert.equal(result.deferred, true)
      const report = buildReport({
        results: [{ ...result, sources: ['/x/'] }],
        suppressed: [],
      })
      assert.equal(report.summary.invalid, 0)
      assert.equal(report.summary.deferred, 1)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('maps 429 status to rate-limited', () => {
    assert.equal(classifyStatus(429), 'rate-limited')
  })
})

describe('cache', () => {
  it('hit/miss and fresh check', async () => {
    const dir = fs.mkdtempSync(ospath.join(os.tmpdir(), 'lv-cache-'))
    const cachePath = ospath.join(dir, 'cache.json')
    const url = 'https://cache-hit.example/doc'
    const store = loadCacheFile(cachePath)
    const key = 'HEAD https://cache-hit.example/doc'
    store.entries[key] = entryFromCheck({
      url,
      status: 200,
      classification: 'ok',
      ok: true,
      finalUrl: url,
    })
    saveCacheFile(cachePath, store)

    const loaded = loadCacheFile(cachePath)
    assert.ok(isCacheFresh(loaded.entries[key], 60_000))

    const results = await checkUrls([{ url, sources: ['/p/'] }], {
      cacheEnabled: true,
      cachePath,
      concurrency: 1,
      retries: 0,
    })
    assert.equal(results[0].fromCache, true)
    assert.equal(results[0].ok, true)
    assert.equal(results._meta.cached, 1)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('surgical invalidation bypasses cache', async () => {
    const dir = fs.mkdtempSync(ospath.join(os.tmpdir(), 'lv-inv-'))
    const cachePath = ospath.join(dir, 'cache.json')
    let liveCalls = 0
    const server = http.createServer((_req, res) => {
      liveCalls += 1
      res.writeHead(404)
      res.end('missing')
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()
    const url = `http://127.0.0.1:${port}/live`
    const store = loadCacheFile(cachePath)
    store.entries[`HEAD ${url}`] = entryFromCheck({
      url,
      status: 200,
      classification: 'ok',
      ok: true,
      finalUrl: url,
    })
    saveCacheFile(cachePath, store)

    try {
      await checkUrls([{ url, sources: ['/docs/guide.adoc'] }], {
        cacheEnabled: true,
        cachePath,
        retries: 0,
        invalidateSources: ['docs/guide.adoc'],
      })
      assert.ok(liveCalls >= 1)

      liveCalls = 0
      await checkUrls([{ url, sources: ['/docs/other.adoc'] }], {
        cacheEnabled: true,
        cachePath,
        retries: 0,
      })
      assert.equal(liveCalls, 0)
    } finally {
      await new Promise((resolve) => server.close(resolve))
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('invalidate helpers', () => {
  it('matches source pages loosely', () => {
    assert.ok(sourceMatchesInvalidation('/docs/foo/bar.adoc', ['docs/foo/bar.adoc']))
    assert.ok(entryForceLive(
      { url: 'https://x.test/', sources: ['/docs/foo/'] },
      { invalidateSources: ['docs/foo'], invalidateUrls: [], cacheBypass: false }
    ))
  })
})

describe('github host policy', () => {
  it('raises concurrency when token present', () => {
    const unauth = resolveHostPolicy('https://github.com/org/repo/blob/main/README.md', { githubToken: null })
    const auth = resolveHostPolicy('https://github.com/org/repo/blob/main/README.md', { githubToken: 'ghs_test' })
    assert.ok(auth.concurrency > unauth.concurrency)
    assert.ok(auth.minIntervalMs <= unauth.minIntervalMs)
  })
})
