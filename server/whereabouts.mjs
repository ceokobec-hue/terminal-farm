/**
 * Which plot a thread belongs on.
 *
 * The scan names a thread's project after the folder it was opened in, which is right when that
 * folder is a repo and wrong when it is the folder *holding* the repos. On the machine this was
 * built against, 244 of 635 threads were opened at `~/repos` itself and then went off to work in
 * one repo or another — so grouping by folder put two fifths of the work on a single plot that
 * meant nothing. Codex's desktop app does the same from `~/Documents/Codex/<date>/<slug>`.
 *
 * For those threads the transcript says where the work went: a session that edited
 * `~/repos/tools/…` four thousand times was working in tools. So for a thread opened
 * at a workspace root, a Codex scratch folder or the home folder, the repo named most often in
 * its transcript wins — when it clearly wins. Measured on that machine, 32 of 40 recent root
 * threads had a clear winner; the rest stay at the farmhouse rather than being guessed.
 *
 * Read-only, like everything else here, and cached on each transcript's size and mtime.
 */
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { listDirs, listFiles, readHead, readTail } from './lib/fsutil.mjs'

const HOME = os.homedir()
const CLAUDE_PROJECTS = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude'), 'projects')
const CODEX_SESSIONS = path.join(process.env.CODEX_HOME || path.join(HOME, '.codex'), 'sessions')
const CODEX_SCRATCH = path.join(HOME, 'Documents', 'Codex')

/** Only threads touched this recently are worth reading a transcript for. */
const RECENT_MS = 3 * 24 * 60 * 60 * 1000
/** A winner needs this many mentions and this share of all repo mentions. */
const MIN_MENTIONS = 3
const MIN_SHARE = 0.3
/** Where the work is now matters more than where it started: the tail is read in full. */
const HEAD_BYTES = 256 * 1024
const TAIL_BYTES = 2 * 1024 * 1024
const INDEX_MS = 60 * 1000

const TEMP = /^(\/private)?\/tmp\/|^\/var\/folders\/|\/scratch-workspaces\//

const inside = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep)

/** Transcript files by session id, rebuilt at most once a minute. */
let index = { at: 0, claude: new Map(), codex: new Map() }
async function transcriptIndex() {
  if (Date.now() - index.at < INDEX_MS) return index
  const claude = new Map()
  for (const dir of await listDirs(CLAUDE_PROJECTS)) {
    for (const file of await listFiles(dir, (n) => n.endsWith('.jsonl'))) claude.set(path.basename(file, '.jsonl'), file)
  }
  const codex = new Map()
  for (const y of await listDirs(CODEX_SESSIONS)) {
    for (const m of await listDirs(y)) {
      for (const d of await listDirs(m)) {
        for (const file of await listFiles(d, (n) => n.startsWith('rollout-') && n.endsWith('.jsonl'))) {
          const id = /([0-9a-f-]{36})\.jsonl$/i.exec(file)?.[1]
          if (id) codex.set(id, file)
        }
      }
    }
  }
  index = { at: Date.now(), claude, codex }
  return index
}

function transcriptOf(thread, idx) {
  const ref = thread.ref || {}
  if (thread.harness === 'claude-code') return idx.claude.get(ref.cliSessionId)
  if (thread.harness === 'codex') return idx.codex.get(ref.sessionId)
  return undefined
}

/** The transcript file behind a thread, when its harness keeps one this module can find. */
export async function transcriptFileOf(thread) {
  return transcriptOf(thread, await transcriptIndex()) || ''
}

const mentionCache = new Map()
/** `{ repo: count }` of `/repos/<name>` style mentions, for the names in `repos`. */
async function mentions(file, rootNames, repoNames) {
  let st
  try {
    st = await fsp.stat(file)
  } catch {
    return null
  }
  const key = `${file}|${st.size}|${st.mtimeMs}`
  if (mentionCache.has(key)) return mentionCache.get(key)
  const text =
    st.size <= HEAD_BYTES + TAIL_BYTES
      ? await fsp.readFile(file, 'utf8')
      : (await readHead(file, HEAD_BYTES)) + (await readTail(file, TAIL_BYTES))
  const counts = {}
  const re = new RegExp(`(?:${rootNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})/([A-Za-z0-9._-]+)`, 'g')
  for (const m of text.matchAll(re)) {
    if (repoNames.has(m[1])) counts[m[1]] = (counts[m[1]] || 0) + 1
  }
  for (const k of mentionCache.keys()) if (k.startsWith(file + '|')) mentionCache.delete(k)
  mentionCache.set(key, counts)
  return counts
}

function winner(counts, exclude) {
  const entries = Object.entries(counts || {}).filter(([name]) => !exclude.has(name))
  const total = entries.reduce((n, [, c]) => n + c, 0)
  const [name, n] = entries.sort((a, b) => b[1] - a[1])[0] || []
  if (!name || n < MIN_MENTIONS || n / total < MIN_SHARE) return null
  return { repo: name, share: Math.round((n / total) * 100) / 100 }
}

/**
 * `Map<threadId, { plot, how, share? }>`.
 *   how: 'folder'     — opened inside a repo (or a sub-folder of one)
 *        'transcript' — opened somewhere general; the transcript named the repo
 *        'unknown'    — opened somewhere general and the transcript did not say clearly
 *        'outside'    — a work folder that is not under any workspace root
 *        'temp'       — a scratch or temp folder; not drawn by default
 * `plot` is a repo name, an outside folder's project name, or null for the farmhouse.
 */
export async function placeThreads(threads, { roots = [], repos = [], hubs = [], now = Date.now() } = {}) {
  const repoNames = new Set(repos.map((r) => r.name))
  const exclude = new Set(hubs)
  const rootNames = roots.map((r) => path.basename(r))
  const general = (p) => roots.includes(p) || p === HOME || inside(p, CODEX_SCRATCH)
  const idx = await transcriptIndex()

  // Outside folders group under the shallowest folder another thread was opened in, so a
  // session started in `newsletter/outputs/images` lands with the newsletter's own threads.
  const outsidePaths = [...new Set(threads.map((t) => t.projectPath || t.cwd).filter(Boolean))]
    .filter((p) => !TEMP.test(p + '/') && !general(p) && !roots.some((r) => inside(p, r)))
  const anchorOf = (p) => outsidePaths.filter((q) => inside(p, q)).sort((a, b) => a.length - b.length)[0] || p
  const nameOf = new Map()
  for (const t of threads) {
    const p = t.projectPath || t.cwd
    if (p && !nameOf.has(p)) nameOf.set(p, t.project)
  }

  const out = new Map()
  for (const t of threads) {
    const p = t.projectPath || t.cwd || ''
    if (!p) {
      out.set(t.id, { plot: null, how: 'unknown' })
      continue
    }
    // Roots first: a workspace root that happens to live under a temp folder is still a root.
    const root = roots.find((r) => p !== r && inside(p, r))
    if (root) {
      const repo = path.relative(root, p).split(path.sep)[0]
      out.set(t.id, { plot: repo, how: 'folder' })
      continue
    }
    if (general(p)) {
      const recent = now - (t.lastActivityAt || 0) < RECENT_MS || t.unread || t.running
      const file = recent ? transcriptOf(t, idx) : null
      const found = file && rootNames.length ? winner(await mentions(file, rootNames, repoNames), exclude) : null
      out.set(t.id, found ? { plot: found.repo, how: 'transcript', share: found.share } : { plot: null, how: 'unknown' })
      continue
    }
    if (TEMP.test(p + '/')) {
      out.set(t.id, { plot: null, how: 'temp' })
      continue
    }
    const anchor = anchorOf(p)
    out.set(t.id, { plot: nameOf.get(anchor) || path.basename(anchor), how: 'outside' })
  }
  return out
}
