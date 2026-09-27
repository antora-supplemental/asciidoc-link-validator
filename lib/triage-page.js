'use strict'

const { triageClientConfig } = require('./triage-actions.js')

/**
 * Generate a static HTML triage page that loads report.json.
 * Supports report groupings + shared triage actions (mailto / copy / CI trigger).
 */
function buildTriageHtml ({
  title = 'Link Validator',
  reportPath = './report.json',
  cssHref = '../_/css/link-validator.css',
  jsHref = '../_/js/link-validator.js',
  reportEmail = 'support@devcentr.org',
  ciTrigger = null,
} = {}) {
  const client = triageClientConfig({ reportPath, reportEmail, ciTrigger })
  const ciEnabled = client.ciTrigger && client.ciTrigger.enabled
  const ciLabel = (client.ciTrigger && client.ciTrigger.label) || 'Check now (CI)'

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${escapeHtml(cssHref)}">
</head>
<body class="lv-triage">
  <header class="lv-header">
    <h1>${escapeHtml(title)}</h1>
    <p class="lv-lede">Broken and suspicious outbound links found during the last site build.</p>
    <div class="lv-toolbar" id="lv-toolbar">
      <label class="lv-select-label">Group by
        <select id="lv-group-by" class="lv-select" aria-label="Group findings by">
          <option value="auto">Auto (default)</option>
          <option value="byDestination">Destination URL</option>
          <option value="bySourcePage">Source page</option>
          <option value="byStatus">Status</option>
          <option value="byHost">Host</option>
          <option value="flat">Flat list</option>
        </select>
      </label>
      <button type="button" id="lv-filter-page" class="lv-btn">Validate this page</button>
      <label class="lv-toggle"><input type="checkbox" id="lv-newly-only"> Newly invalid since last deployment</label>
      <button type="button" id="lv-copy" class="lv-btn">Copy report</button>
      <a id="lv-mailto" class="lv-btn lv-btn-primary" href="mailto:${escapeHtml(reportEmail)}">Email report</a>
      ${ciEnabled ? `<button type="button" id="lv-ci-trigger" class="lv-btn lv-btn-ci">${escapeHtml(ciLabel)}</button>
      <span id="lv-ci-status" class="lv-ci-status" aria-live="polite"></span>` : ''}
    </div>
  </header>
  <main>
    <section id="lv-summary" class="lv-summary" aria-live="polite">Loading report…</section>
    <section id="lv-history" class="lv-history" hidden></section>
    <div id="lv-groups" class="lv-groups"></div>
    <table class="lv-table" id="lv-table" hidden>
      <thead>
        <tr>
          <th>URL</th>
          <th>Status</th>
          <th>Classification</th>
          <th>Source page</th>
          <th>Delta</th>
        </tr>
      </thead>
      <tbody id="lv-tbody"></tbody>
    </table>
  </main>
  <script>
    window.LINK_VALIDATOR_CONFIG = ${JSON.stringify(client)};
    window.LINK_VALIDATOR_REPORT_URL = ${JSON.stringify(client.reportUrl)};
    window.LINK_VALIDATOR_REPORT_EMAIL = ${JSON.stringify(client.reportEmail)};
  </script>
  <script src="${escapeHtml(jsHref)}" defer></script>
</body>
</html>
`
}

function escapeHtml (s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

module.exports = { buildTriageHtml, escapeHtml }
