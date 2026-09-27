'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { extractUrlsFromHtml, extractUrlsFromAsciiDoc } = require('./extract.js')

function walkFiles (root, exts, list = []) {
  if (!fs.existsSync(root)) return list
  const st = fs.statSync(root)
  if (st.isFile()) {
    const ext = path.extname(root).toLowerCase()
    if (exts.has(ext)) list.push(root)
    return list
  }
  for (const name of fs.readdirSync(root)) {
    if (name === 'node_modules' || name === '.git' || name === 'build') continue
    walkFiles(path.join(root, name), exts, list)
  }
  return list
}

/**
 * Scan AsciiDoc tree and/or HTML tree; return merged URL entries.
 */
function scanFilesystem ({
  root,
  htmlRoot,
  checkImages = true,
} = {}) {
  const map = new Map()

  function addAll (entries) {
    for (const e of entries) {
      if (map.has(e.url)) {
        const cur = map.get(e.url)
        for (const s of e.sources) {
          if (!cur.sources.includes(s)) cur.sources.push(s)
        }
      } else {
        map.set(e.url, e)
      }
    }
  }

  if (root) {
    const abs = path.resolve(root)
    for (const file of walkFiles(abs, new Set(['.adoc', '.asciidoc']))) {
      const text = fs.readFileSync(file, 'utf8')
      const rel = path.relative(abs, file).split(path.sep).join('/')
      addAll(extractUrlsFromAsciiDoc(text, { sourcePage: rel, checkImages }))
    }
  }

  if (htmlRoot) {
    const abs = path.resolve(htmlRoot)
    for (const file of walkFiles(abs, new Set(['.html', '.htm']))) {
      const text = fs.readFileSync(file, 'utf8')
      const rel = path.relative(abs, file).split(path.sep).join('/')
      addAll(extractUrlsFromHtml(text, { sourcePage: rel, checkImages }))
    }
  }

  return [...map.values()]
}

module.exports = { scanFilesystem, walkFiles }
