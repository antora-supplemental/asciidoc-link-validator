# Thin CI dispatch proxy (+ Link-inator probe)

Minimal **Node/Express** (and optional **Cloudflare Workers**) stub that accepts a **public** POST from the link-validator triage page and calls GitHub `workflow_dispatch` with a **server-side** token.

**The GitHub token must NEVER appear in static HTML, playbook YAML shipped to the browser, or `window.LINK_VALIDATOR_CONFIG`.**

## Why

The triage UI stores only:

```yaml
ciTrigger:
  enabled: true
  provider: github
  dispatchUrl: https://YOUR_PROXY/dispatch
  statusUrl: https://YOUR_PROXY/status
  ref: main
  label: Check now (CI)
  pollIntervalMs: 5000
```

This proxy holds `GITHUB_TOKEN` and performs the authenticated API call.

## Quick start (Express)

```bash
cd examples/dispatch-proxy
cp .env.example .env   # edit values
pnpm install           # or: npm install
pnpm start             # listens on :8787
```

### Environment variables

| Variable | Required | Meaning |
| --- | --- | --- |
| `GITHUB_TOKEN` / `GH_TOKEN` | for `/dispatch` | PAT or app token with `actions:write` |
| `GITHUB_OWNER` | for `/dispatch` | Org or user |
| `GITHUB_REPO` | for `/dispatch` | Docs / site repo that owns the write-back workflow |
| `WORKFLOW_ID` | no | Default `link-validator-writeback.yml` |
| `WORKFLOW_REF` | no | Default `main` |
| `PORT` | no | Default `8787` |
| `CORS_ORIGIN` | no | Default `*` (tighten in production) |
| `STATUS_ARTIFACT_URL` | no | URL of published `report.json` for `/status` |
| `PROBE_ALLOWLIST` | no | Comma-separated host suffixes for `/probe` |

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/dispatch` | `workflow_dispatch` (optional JSON body `{ ref, inputs }`) |
| `GET` | `/status` | Latest run + optional `STATUS_ARTIFACT_URL` report |
| `GET` | `/health` | Liveness / config sanity |
| `GET` | `/probe?url=` | Link-inator live probe (HEAD then GET) |

## Wire into Antora (`link-validator`)

```yaml
antora:
  extensions:
    - require: '@antora-supplemental/link-validator'
      reportEmail: support@devcentr.org
      softFail403: true
      failLevel: none
      ciTrigger:
        enabled: true
        provider: github
        dispatchUrl: https://YOUR_PROXY/dispatch
        statusUrl: https://YOUR_PROXY/status
```

Copy the write-back workflow from the link-validator package:

`.github/workflows/link-validator-writeback.yml`

## Link-inator live probe

In supplemental UI (or a small inline script) set:

```html
<script>
  // Trailing "?url=" — client does fetch(LINKINATOR_PROBE_URL + encodeURIComponent(href))
  window.LINKINATOR_PROBE_URL = 'https://YOUR_PROXY/probe?url='
</script>
```

Mark anchors for live probe with `data-lini-live="true"` (see `@antora-supplemental/linkinator`).

Without `LINKINATOR_PROBE_URL`, Link-inator marks status `unknown` (browsers cannot reliably CORS-HEAD arbitrary sites).

## Cloudflare Workers

Deploy `worker.js` with Wrangler; bind the same secrets/vars as the Express env table. Express `server.js` remains the fuller reference implementation (`/status` run listing).

## Related

* Core package: https://github.com/antora-supplemental/asciidoc-link-validator
* Antora extension: https://github.com/antora-supplemental/link-validator
* Link-inator: https://github.com/antora-supplemental/linkinator
