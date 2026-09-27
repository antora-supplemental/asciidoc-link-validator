'use strict'

/**
 * Thin CI dispatch + Link-inator probe proxy.
 *
 * Security: GITHUB_TOKEN (or GH_TOKEN) lives ONLY in this process / host secrets.
 * Never ship that token into Antora static HTML or playbook fragments that reach browsers.
 *
 * Env (required for /dispatch):
 *   GITHUB_TOKEN or GH_TOKEN  - PAT or GitHub App installation token with actions:write
 *   GITHUB_OWNER              - org or user (e.g. antora-supplemental)
 *   GITHUB_REPO               - repository name (e.g. my-docs-site)
 *   WORKFLOW_ID               - workflow file name or numeric id (default: link-validator-writeback.yml)
 *   WORKFLOW_REF              - git ref to run (default: main)
 *
 * Env (optional):
 *   PORT                      - listen port (default: 8787)
 *   CORS_ORIGIN               - Access-Control-Allow-Origin (default: *)
 *   STATUS_ARTIFACT_URL       - optional URL that already serves latest report.json
 *   PROBE_ALLOWLIST           - comma-separated host suffixes allowed for /probe (empty = any http(s))
 *
 * Antora playbook (link-validator extension):
 *   ciTrigger:
 *     enabled: true
 *     provider: github
 *     dispatchUrl: https://YOUR_PROXY/dispatch
 *     statusUrl: https://YOUR_PROXY/status
 */

const express = require('express')

const PORT = Number(process.env.PORT) || 8787
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*'
const OWNER = process.env.GITHUB_OWNER
const REPO = process.env.GITHUB_REPO
const WORKFLOW_ID = process.env.WORKFLOW_ID || 'link-validator-writeback.yml'
const WORKFLOW_REF = process.env.WORKFLOW_REF || 'main'
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
const STATUS_ARTIFACT_URL = process.env.STATUS_ARTIFACT_URL || null
const PROBE_ALLOWLIST = (process.env.PROBE_ALLOWLIST || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

const app = express()
app.use(express.json({ limit: '32kb' }))

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'link-validator-dispatch-proxy',
    dispatchConfigured: Boolean(TOKEN && OWNER && REPO),
    workflowId: WORKFLOW_ID,
    ref: WORKFLOW_REF,
  })
})

/**
 * POST /dispatch
 * Body (optional JSON): { ref?: string, inputs?: object }
 * Triggers workflow_dispatch; token never leaves this server.
 */
app.post('/dispatch', async (req, res) => {
  if (!TOKEN || !OWNER || !REPO) {
    return res.status(503).json({
      ok: false,
      error: 'Proxy not configured (need GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO)',
    })
  }
  const ref = (req.body && req.body.ref) || WORKFLOW_REF
  const inputs = (req.body && req.body.inputs) || { ref_name: ref }
  const url = 'https://api.github.com/repos/' + OWNER + '/' + REPO +
    '/actions/workflows/' + encodeURIComponent(WORKFLOW_ID) + '/dispatches'
  try {
    const gh = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + TOKEN,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'asciidoc-link-validator-dispatch-proxy',
      },
      body: JSON.stringify({ ref, inputs }),
    })
    if (gh.status === 204) {
      return res.json({ ok: true, dispatched: true, ref, workflowId: WORKFLOW_ID })
    }
    const text = await gh.text()
    return res.status(gh.status >= 400 ? gh.status : 502).json({
      ok: false,
      error: 'GitHub workflow_dispatch failed',
      status: gh.status,
      body: text.slice(0, 500),
    })
  } catch (err) {
    return res.status(502).json({ ok: false, error: String(err && err.message ? err.message : err) })
  }
})

/**
 * GET /status
 * Best-effort: latest workflow run conclusion, and/or STATUS_ARTIFACT_URL / report.json.
 */
app.get('/status', async (_req, res) => {
  const out = { ok: true, generatedAt: new Date().toISOString() }
  if (STATUS_ARTIFACT_URL) {
    try {
      const r = await fetch(STATUS_ARTIFACT_URL, { headers: { Accept: 'application/json' } })
      if (r.ok) {
        out.report = await r.json()
        out.reportUrl = STATUS_ARTIFACT_URL
      } else {
        out.reportFetchStatus = r.status
      }
    } catch (err) {
      out.reportError = String(err && err.message ? err.message : err)
    }
  }
  if (TOKEN && OWNER && REPO) {
    try {
      const runsUrl = 'https://api.github.com/repos/' + OWNER + '/' + REPO +
        '/actions/workflows/' + encodeURIComponent(WORKFLOW_ID) + '/runs?per_page=1'
      const gh = await fetch(runsUrl, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + TOKEN,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'asciidoc-link-validator-dispatch-proxy',
        },
      })
      if (gh.ok) {
        const data = await gh.json()
        const run = data.workflow_runs && data.workflow_runs[0]
        if (run) {
          out.latestRun = {
            id: run.id,
            status: run.status,
            conclusion: run.conclusion,
            html_url: run.html_url,
            created_at: run.created_at,
            updated_at: run.updated_at,
          }
        }
      } else {
        out.runsFetchStatus = gh.status
      }
    } catch (err) {
      out.runsError = String(err && err.message ? err.message : err)
    }
  }
  res.json(out)
})

/**
 * GET /probe?url=https://example.com
 * Tiny Link-inator live probe. Returns { ok, status, classification }.
 * Client sets window.LINKINATOR_PROBE_URL = 'https://YOUR_PROXY/probe?url='
 * then fetch(LINKINATOR_PROBE_URL + encodeURIComponent(href)).
 */
async function handleProbe (target, res) {
  if (!target) return res.status(400).json({ ok: false, error: 'missing url' })
  let parsed
  try {
    parsed = new URL(target)
  } catch {
    return res.status(400).json({ ok: false, error: 'invalid url' })
  }
  if (!/^https?:$/i.test(parsed.protocol)) {
    return res.status(400).json({ ok: false, error: 'only http(s) allowed' })
  }
  if (PROBE_ALLOWLIST.length) {
    const host = parsed.hostname.toLowerCase()
    const allowed = PROBE_ALLOWLIST.some((suffix) => host === suffix || host.endsWith('.' + suffix))
    if (!allowed) return res.status(403).json({ ok: false, error: 'host not in PROBE_ALLOWLIST' })
  }
  try {
    let r = await fetch(parsed.href, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'linkinator-probe/0.1' },
    })
    if (r.status === 405 || r.status === 501) {
      r = await fetch(parsed.href, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'linkinator-probe/0.1' },
      })
    }
    const ok = r.status >= 200 && r.status < 400
    let classification = 'ok'
    if (r.status === 403) classification = 'forbidden'
    else if (r.status === 404) classification = '404'
    else if (r.status >= 400 && r.status < 500) classification = '4xx'
    else if (r.status >= 500) classification = '5xx'
    else if (!ok) classification = 'invalid'
    return res.json({
      ok,
      status: ok ? 'ok' : (classification === 'forbidden' ? 'invalid' : classification),
      httpStatus: r.status,
      classification,
      url: parsed.href,
    })
  } catch (err) {
    const msg = String(err && err.message ? err.message : err)
    const classification = /timeout|aborted/i.test(msg)
      ? 'timeout'
      : /ENOTFOUND|getaddrinfo/i.test(msg) ? 'dns' : 'unknown'
    return res.json({ ok: false, status: 'unknown', classification, error: msg, url: parsed.href })
  }
}

app.get('/probe', (req, res) => handleProbe(req.query.url, res))
app.use((req, res, next) => {
  if (req.method === 'GET' && req.path.startsWith('/probe/') && req.path.length > '/probe/'.length) {
    let target = req.path.slice('/probe/'.length)
    try { target = decodeURIComponent(target) } catch (_) {}
    return handleProbe(target, res)
  }
  next()
})

app.get('/', (_req, res) => {
  res.type('text').send(
    'link-validator dispatch-proxy\n' +
    'POST /dispatch  GET /status  GET /health  GET /probe?url=\n' +
    'See README.md for env vars and Antora ciTrigger wiring.\n'
  )
})

if (require.main === module) {
  app.listen(PORT, () => {
    console.log('[dispatch-proxy] listening on :' + PORT +
      ' (dispatchConfigured=' + Boolean(TOKEN && OWNER && REPO) + ')')
  })
}

module.exports = { app }
