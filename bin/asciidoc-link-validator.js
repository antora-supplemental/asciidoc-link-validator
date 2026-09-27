#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { scanFilesystem } = require('../lib/scan-fs.js')
const { checkUrls } = require('../lib/check.js')
const { loadSuppressions, filterSuppressed } = require('../lib/suppressions.js')
const { buildReport, formatMarkdown, formatTextEmail } = require('../lib/report.js')
const { readBaseline, writeBaseline } = require('../lib/baseline.js')
const { createProgress } = require('../lib/progress.js')

const TOOL = 'asciidoc-link-validator'

const HELP = `Usage: asciidoc-link-validator [options]

Scan AsciiDoc trees and/or built HTML for outbound http(s) links and validate them
without requiring Antora or Asciidoctor.

Options:
  --root <dir>           Root directory to scan for .adoc files
  --html <dir>           Root directory to scan for .html files
  --suppressions <file>  Path to .antora-link-suppressions.yml
  --baseline <file>      Baseline JSON for delta (newlyInvalid / recovered)
  --write-baseline       Write/update baseline from current invalid set
  --out <file>           Write report JSON to this path
  --fail                 Exit 1 when invalid (non-suppressed) links remain
  --concurrency <n>      Parallel checks (default 8)
  --timeout <ms>         Per-request timeout (default 10000)
  --format <fmt>         Output format: json | md | text (default json to stdout
                         when --out is omitted; with --out always writes JSON)
  --no-images            Skip image/video/audio http(s) URLs
  --soft-fail-403        Treat 403 as soft-ok (default)
  --no-soft-fail-403     Treat 403 as invalid
  -h, --help             Show this help

Examples:
  asciidoc-link-validator --root ./docs --format md
  asciidoc-link-validator --html ./build/site --baseline .link-baseline.json --fail
  node bin/asciidoc-link-validator.js --root . --out report.json
`

function parseArgs (argv) {
  const opts = {
    root: null,
    html: null,
    suppressions: null,
    baseline: null,
    writeBaseline: false,
    out: null,
    fail: false,
    concurrency: 8,
    timeoutMs: 10000,
    format: 'json',
    checkImages: true,
    softFail403: true,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    switch (a) {
      case '-h': case '--help': opts.help = true; break
      case '--root': opts.root = next(); break
      case '--html': opts.html = next(); break
      case '--suppressions': opts.suppressions = next(); break
      case '--baseline': opts.baseline = next(); break
      case '--write-baseline': opts.writeBaseline = true; break
      case '--out': opts.out = next(); break
      case '--fail': opts.fail = true; break
      case '--concurrency': opts.concurrency = Number(next()) || 8; break
      case '--timeout': opts.timeoutMs = Number(next()) || 10000; break
      case '--format': opts.format = (next() || 'json').toLowerCase(); break
      case '--no-images': opts.checkImages = false; break
      case '--soft-fail-403': opts.softFail403 = true; break
      case '--no-soft-fail-403': opts.softFail403 = false; break
      default:
        if (a.startsWith('-')) {
          throw new Error(`Unknown option: ${a}`)
        }
    }
  }
  return opts
}

async function main (argv = process.argv.slice(2)) {
  let opts
  try {
    opts = parseArgs(argv)
  } catch (err) {
    process.stderr.write(String(err.message || err) + '\n')
    return 1
  }

  if (opts.help) {
    process.stdout.write(HELP)
    return 0
  }

  if (!opts.root && !opts.html) {
    process.stderr.write('Provide --root and/or --html\n\n')
    process.stdout.write(HELP)
    return 1
  }

  const progress = createProgress({ id: TOOL, stream: process.stderr })
  progress.starting('starting outbound link check')
  progress.enumStart('files')

  const entries = scanFilesystem({
    root: opts.root,
    htmlRoot: opts.html,
    checkImages: opts.checkImages,
    onFile (n) { progress.enumTick(n) },
  })

  progress.enumDone(undefined, entries.length + ' links')

  const rules = loadSuppressions(opts.suppressions || '.antora-link-suppressions.yml')
  const checked = await checkUrls(entries, {
    concurrency: opts.concurrency,
    timeoutMs: opts.timeoutMs,
    softFail403: opts.softFail403,
    onProgress (done, total) {
      progress.tick(done, total)
    },
  })

  const { active, suppressed } = filterSuppressed(checked, rules)
  const baseline = readBaseline(opts.baseline)
  const report = buildReport({
    results: active,
    suppressed,
    baseline,
    meta: {
      reportEmail: 'support@devcentr.org',
      root: opts.root,
      html: opts.html,
    },
  })

  progress.done(
    'done (invalid=' + report.summary.invalid +
    ', newly=' + report.summary.newlyInvalid +
    ', links=' + entries.length + ')'
  )

  if (opts.out) {
    const abs = path.resolve(opts.out)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, JSON.stringify(report, null, 2) + '\n', 'utf8')
    process.stderr.write(TOOL + ': Wrote ' + abs + '\n')
  }

  if (opts.writeBaseline && opts.baseline) {
    writeBaseline(opts.baseline, report)
    process.stderr.write(TOOL + ': Wrote baseline ' + opts.baseline + '\n')
  }

  let formatted
  if (opts.format === 'md') formatted = formatMarkdown(report)
  else if (opts.format === 'text') formatted = formatTextEmail(report)
  else formatted = JSON.stringify(report, null, 2) + '\n'

  if (!opts.out || opts.format !== 'json') {
    process.stdout.write(formatted.endsWith('\n') ? formatted : formatted + '\n')
  }

  if (opts.fail && report.invalid.length) {
    process.stderr.write(TOOL + ': ' + report.invalid.length + ' invalid link(s)\n')
    return 1
  }
  return 0
}

module.exports = { main, parseArgs }

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code
  }).catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}
