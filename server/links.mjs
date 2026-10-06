/**
 * Which repos lean on which — read off the repos themselves, never written to.
 *
 * Measured on a real ~/repos of 31 folders, the "official" signals found nothing: no shared
 * Firebase project, no `file:` dependency, no submodule, no common root commit. What does carry
 * the relationships is plainer: one repo's scripts name another by absolute path
 * (`~/repos/<other>/some_tool.py`), or its code talks to another repo's backend by
 * Firebase project id or `*.web.app` host. So those are the two kinds of link:
 *
 *   path — A reads or runs B's files            (drawn as a dirt track)
 *   data — A talks to the site or store B owns   (drawn as a water channel)
 *
 * Each link also says whether any of its evidence is code (`code`) or only notes, briefs and
 * reports (`docs`). On that machine 80 pairs turned up and most were a document mentioning a
 * site in passing; the ones a script actually depends on are the ones worth a road.
 *
 * Three things on that same machine would have drawn false links, and each has a rule here:
 *   - a notes repo that mentions every other repo (a "hub") — its outgoing links are dropped
 *   - guard code that names a project only to refuse deploying to it — skipped by file and line
 *   - a repo borrowed only for its node_modules (a Playwright install) — kept, marked weak
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { listDirs, exists } from './lib/fsutil.mjs'

const SCAN_EXT = /\.(json|md|sh|py|js|mjs|cjs|ts|yml|yaml|toml|html)$/i
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.firebase', '.cache', 'venv', '.venv',
  '__pycache__', 'coverage', 'out', '.vercel', '.turbo',
])
const MAX_DEPTH = 3
const MAX_FILES = 3000
const MAX_BYTES = 400 * 1024
const EVIDENCE_PER_LINK = 4

/** Files that name another project only to refuse it. */
const GUARD_FILE = /(^\.firebaserc$|assert|guard|deploy-rules|check-?project|wrong-?project)/i
/** Lines that name another project only to refuse it. */
const GUARD_LINE = /(!==|!=|금지|막|거부|않게|못 박|wrong|refus|block|never|not allowed|forbid)/i

/**
 * Notes, briefs, logs and reports: a mention there is not a dependency. Agent instructions are
 * the exception — a SKILL.md or an agents/*.md is what actually runs the other repo's tools.
 */
const DOC_FILE = /(\.(md|html)$|(^|\/)(_[^/]*|docs?|00_dashboard|reports?|logs?)\/)/i
const AGENT_DOC = /(^|\/)(SKILL|CLAUDE|AGENTS)\.md$|(^|\/)agents\/[^/]+\.md$/

/** A repo whose outgoing links reach at least this share of all repos is a hub, not a neighbour. */
const HUB_SHARE = 0.4
const HUB_MIN = 6

const CACHE_MS = 5 * 60 * 1000

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The folders that hold repos side by side. A thread opened at `~/repos` itself is the usual
 * case on this machine, so a project path qualifies when at least three of its children are
 * git checkouts. `BOT_CROSSING_WORKSPACES` (path-delimited) overrides the guess.
 */
export async function workspaceRoots(projectPaths) {
  const env = process.env.BOT_CROSSING_WORKSPACES
  if (env) return env.split(path.delimiter).filter(Boolean)
  const roots = []
  for (const p of new Set(projectPaths.filter(Boolean))) {
    let gits = 0
    for (const child of await listDirs(p)) {
      if (await exists(path.join(child, '.git'))) gits++
      if (gits >= 3) break
    }
    if (gits >= 3) roots.push(p)
  }
  return roots
}

/** Every repo-like folder directly under the workspace roots, with the names it answers to. */
async function listRepos(roots) {
  const repos = []
  for (const root of roots) {
    for (const dir of await listDirs(root)) {
      const name = path.basename(dir)
      if (name.startsWith('.') || SKIP_DIRS.has(name)) continue
      repos.push({ name, path: dir, ...(await firebaseIdentity(dir)) })
    }
  }
  return repos
}

/** The Firebase project ids and hosting sites this repo owns, from its own config. */
async function firebaseIdentity(dir) {
  const projects = new Set()
  const sites = new Set()
  try {
    const rc = JSON.parse(await fsp.readFile(path.join(dir, '.firebaserc'), 'utf8'))
    for (const v of Object.values(rc?.projects || {})) if (typeof v === 'string') projects.add(v)
  } catch {
    /* no firebase here */
  }
  try {
    const fb = JSON.parse(await fsp.readFile(path.join(dir, 'firebase.json'), 'utf8'))
    for (const h of [].concat(fb?.hosting || [])) if (typeof h?.site === 'string') sites.add(h.site)
  } catch {
    /* no hosting config */
  }
  return { projects: [...projects], sites: [...sites] }
}

async function* walk(dir, depth = 0) {
  let entries
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (depth < MAX_DEPTH && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) yield* walk(full, depth + 1)
    } else if (e.isFile() && (SCAN_EXT.test(e.name) || e.name === '.firebaserc')) {
      yield full
    }
  }
}

/** One file's text, or null when it is too big or unreadable. Cached on mtime and size. */
const fileCache = new Map()
async function readSmall(file) {
  let st
  try {
    st = await fsp.stat(file)
  } catch {
    return null
  }
  if (st.size > MAX_BYTES) return null
  const hit = fileCache.get(file)
  if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.text
  let text
  try {
    text = await fsp.readFile(file, 'utf8')
  } catch {
    return null
  }
  fileCache.set(file, { mtime: st.mtimeMs, size: st.size, text })
  return text
}

/**
 * The matchers: each pattern names one target repo and one kind of link.
 * `aliases` maps an old path fragment (a folder the repo used to live in) to today's repo name.
 */
function buildMatchers(repos, aliases) {
  const names = new Set(repos.map((r) => r.name))
  const matchers = []
  for (const r of repos) {
    const n = escapeRe(r.name)
    matchers.push({
      to: r.name,
      kind: 'path',
      re: new RegExp(`(?:~|\\$HOME|/Users/[^/\\s'"\`]+|/home/[^/\\s'"\`]+)/[^\\s'"\`]*?repos/${n}(?![A-Za-z0-9._-])`),
    })
    for (const site of r.sites) {
      matchers.push({ to: r.name, kind: 'data', re: new RegExp(`(?<![A-Za-z0-9-])${escapeRe(site)}\\.(?:web\\.app|firebaseapp\\.com)`) })
    }
    for (const id of r.projects) {
      // A bare id that is also some folder's name would match every sentence about that folder.
      if (names.has(id)) {
        matchers.push({ to: r.name, kind: 'data', re: new RegExp(`(?<![A-Za-z0-9-])${escapeRe(id)}\\.(?:web\\.app|firebaseapp\\.com)`) })
      } else {
        matchers.push({ to: r.name, kind: 'data', re: new RegExp(`(?<![A-Za-z0-9-])${escapeRe(id)}(?![A-Za-z0-9-])`) })
      }
    }
  }
  for (const [fragment, to] of Object.entries(aliases || {})) {
    if (!names.has(to) || !fragment) continue
    matchers.push({ to, kind: 'path', re: new RegExp(`${escapeRe(fragment)}(?![A-Za-z0-9._-])`) })
  }
  return matchers
}

/**
 * Scan one repo's files for mentions of the others. Returns
 * Map<"to|kind", { code, docs, codeEvidence[], docEvidence[], weakOnly }>.
 */
async function outgoing(repo, matchers) {
  const found = new Map()
  let files = 0
  for await (const file of walk(repo.path)) {
    if (++files > MAX_FILES) break
    const base = path.basename(file)
    if (GUARD_FILE.test(base)) continue
    const text = await readSmall(file)
    if (!text) continue
    const rel = path.relative(repo.path, file)
    const isDoc = DOC_FILE.test(rel) && !AGENT_DOC.test(rel)
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.length > 2000) continue
      for (const m of matchers) {
        if (m.to === repo.name) continue
        if (!m.re.test(line)) continue
        if (m.kind === 'data' && GUARD_LINE.test(line)) continue
        const key = `${m.to}|${m.kind}`
        const entry = found.get(key) || { code: 0, docs: 0, codeEvidence: [], docEvidence: [], weakOnly: true }
        entry[isDoc ? 'docs' : 'code']++
        if (!/node_modules/.test(line)) entry.weakOnly = false
        const bucket = isDoc ? entry.docEvidence : entry.codeEvidence
        if (bucket.length < EVIDENCE_PER_LINK) bucket.push({ file: rel, line: i + 1, text: line.trim().slice(0, 160) })
        found.set(key, entry)
      }
    }
  }
  return found
}

/**
 * The whole map: `{ repos, links, hubs }`.
 * links: [{ from, to, kind: 'path'|'data', source: 'code'|'docs', count, code, docs, weak,
 *           evidence: [{file, line, text}] }]   — code evidence first
 */
export async function findLinks(roots, { aliases = {} } = {}) {
  const repos = await listRepos(roots)
  const matchers = buildMatchers(repos, aliases)
  const raw = []
  for (const repo of repos) {
    for (const [key, v] of await outgoing(repo, matchers)) {
      const [to, kind] = key.split('|')
      raw.push({
        from: repo.name,
        to,
        kind,
        source: v.code ? 'code' : 'docs',
        count: v.code + v.docs,
        code: v.code,
        docs: v.docs,
        weak: v.weakOnly,
        evidence: [...v.codeEvidence, ...v.docEvidence].slice(0, EVIDENCE_PER_LINK),
      })
    }
  }
  const reach = new Map()
  for (const l of raw) reach.set(l.from, (reach.get(l.from) || new Set()).add(l.to))
  const hubLimit = Math.max(HUB_MIN, Math.ceil(repos.length * HUB_SHARE))
  const hubs = [...reach].filter(([, to]) => to.size >= hubLimit).map(([name]) => name)
  const links = raw
    .filter((l) => !hubs.includes(l.from))
    .sort((a, b) => b.code - a.code || b.count - a.count)
  return {
    repos: repos.map(({ name, path: p, projects, sites }) => ({ name, path: p, projects, sites })),
    links,
    hubs,
  }
}

let cached = null
let refreshing = null
/**
 * `findLinks` behind a five-minute cache, keyed on the roots and aliases asked for.
 *
 * Stale-while-revalidate: once there is an answer, a stale one is handed back at once and the
 * rescan runs behind it. The thread list waits on this (it needs the hub list to place threads)
 * and a two-second scan every five minutes is not something a 15-second poll should feel.
 */
export async function linksFor(projectPaths, aliases = {}) {
  const roots = await workspaceRoots(projectPaths)
  const key = JSON.stringify([roots, aliases])
  const scan = async () => {
    const value = { roots, ...(await findLinks(roots, { aliases })), scannedAt: Date.now() }
    cached = { key, at: Date.now(), value }
    return value
  }
  if (cached && cached.key === key) {
    if (Date.now() - cached.at >= CACHE_MS && !refreshing) {
      refreshing = scan().catch(() => {}).finally(() => (refreshing = null))
    }
    return cached.value
  }
  return scan()
}

