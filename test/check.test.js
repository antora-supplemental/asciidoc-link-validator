'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { checkUrl, classifyStatus } = require('../lib/check.js')

describe('classifyStatus', () => {
  it('maps common codes', () => {
    assert.equal(classifyStatus(200), 'ok')
    assert.equal(classifyStatus(301), 'ok')
    assert.equal(classifyStatus(404), '404')
    assert.equal(classifyStatus(403), 'forbidden')
    assert.equal(classifyStatus(null, 'ENOTFOUND'), 'dns')
    assert.equal(classifyStatus(null, 'timeout'), 'timeout')
  })
})

describe('checkUrl (local mock server)', () => {
  it('detects 404 and 200', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/ok') {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end('ok')
      } else if (req.url === '/missing') {
        res.writeHead(404)
        res.end('nope')
      } else if (req.url === '/forbid') {
        res.writeHead(403)
        res.end('no')
      } else {
        res.writeHead(500)
        res.end('err')
      }
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()
    const base = `http://127.0.0.1:${port}`
    try {
      const ok = await checkUrl(`${base}/ok`, { timeoutMs: 2000, retries: 0 })
      assert.equal(ok.ok, true)
      assert.equal(ok.classification, 'ok')

      const missing = await checkUrl(`${base}/missing`, { timeoutMs: 2000, retries: 0 })
      assert.equal(missing.ok, false)
      assert.equal(missing.classification, '404')

      const forbidSoft = await checkUrl(`${base}/forbid`, { timeoutMs: 2000, retries: 0, softFail403: true })
      assert.equal(forbidSoft.ok, true)
      assert.equal(forbidSoft.classification, 'forbidden')

      const forbidHard = await checkUrl(`${base}/forbid`, { timeoutMs: 2000, retries: 0, softFail403: false })
      assert.equal(forbidHard.ok, false)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })
})

