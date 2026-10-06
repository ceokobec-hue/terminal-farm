/**
 * Errands between plots: a session that loads a skill from one repo, writes to the memory
 * repo, or runs another repo's tool, sends a courier along the farm's tracks to fetch or
 * deliver it. This turns the raw touches `activity.mjs` collected into `{ from, to, kind,
 * label }` trips between plot names.
 *
 * Paths are resolved through symlinks, because the interesting ones are links: `~/.claude/skills`
 * is a checkout of the skills repo and the memory folder lives inside the memory repo, so a
 * Skill call or a memory write is a trip to those repos even though no path says `~/repos`.
 */
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const HOME = os.homedir()
const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude')
const SKILLS = path.join(CLAUDE_HOME, 'skills')

/** How long after a touch its courier keeps walking. */
export const TRIP_WINDOW_MS = 10 * 60 * 1000
const PER_THREAD = 3
/**
 * How far back "the repos this terminal is using" reaches: the last hour, and the whole of the
 * current turn — an idle terminal still has its last job's repos on the table.
 */
export const USE_WINDOW_MS = 60 * 60 * 1000
/** …but a turn left standing for days is not "now": twelve hours at most. */
const USE_TURN_MAX_MS = 12 * 60 * 60 * 1000
const USES_PER_THREAD = 6

const realCache = new Map()
async function realOf(p) {
  if (realCache.has(p)) return realCache.get(p)
  let out = ''
  for (let cur = p, rest = ''; cur && cur !== path.dirname(cur); rest = path.join(path.basename(cur), rest), cur = path.dirname(cur)) {
    try {
      out = path.join(await fsp.realpath(cur), rest)
      break
    } catch {
      /* not there — try the parent */
    }
  }
  realCache.set(p, out)
  return out
}

const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep)

const dirCache = new Map()
async function isDir(p) {
  if (!dirCache.has(p)) dirCache.set(p, await fsp.stat(p).then((s) => s.isDirectory(), () => false))
  return dirCache.get(p)
}

/**
 * The repo (folder name under a workspace root) a path belongs to, or null. The folder has to be
 * there: a command's `~/repos/$name/…` names no repo.
 */
export async function repoOfPath(p, roots) {
  if (typeof p !== 'string' || !p) return null
  const rp = await realOf(p)
  if (!rp) return null
  for (const root of roots) {
    const rr = (await realOf(root)) || root
    if (rp === rr || !inside(rp, rr)) continue
    const name = path.relative(rr, rp).split(path.sep)[0]
    return name && !name.startsWith('.') && (await isDir(path.join(rr, name))) ? name : null
  }
  return null
}

const isMemoryPath = (p) => typeof p === 'string' && /\/\.claude\/projects\/[^/]+\/memory(\/|$)/.test(p)

/**
 * Trips for one thread: the newest touch per (repo, kind), within the window, that left the
 * thread's own plot. `plot` null means the farmhouse.
 */
export async function tripsFor(thread, plot, roots, now = Date.now()) {
  const touches = thread.activity?.touches || []
  const here = plot || '__home'
  const seen = new Set()
  const out = []
  for (let i = touches.length - 1; i >= 0 && out.length < PER_THREAD; i--) {
    const t = touches[i]
    if (!t.at || now - t.at > TRIP_WINDOW_MS) break
    const repo = t.kind === 'skill' ? await repoOfPath(path.join(SKILLS, t.skill), roots) : await repoOfPath(t.path, roots)
    if (!repo || repo === plot) continue
    const memory = isMemoryPath(t.path)
    const kind = t.kind === 'skill' ? 'skill' : memory ? 'memory' : t.kind
    const key = `${repo}|${kind}`
    if (seen.has(key) || seen.has(`label|${t.label}`)) continue
    seen.add(key)
    seen.add(`label|${t.label}`)
    let label = t.label
    if (memory) {
      const what = path.basename(t.path).replace(/\.md$/, '')
      label = `메모리 ${t.write ? '기록' : t.kind === 'run' ? '사용' : '읽기'}: ${/^(memory|MEMORY)$/.test(what) ? '목차' : what}`
    }
    // Loading a skill, reading, running a tool: something comes *to* the session. Writing goes out.
    const outward = t.kind === 'edit'
    out.push({ thread: thread.id, from: outward ? here : repo, to: outward ? repo : here, kind, label, at: t.at })
  }
  return out
}

/**
 * The other repos a terminal is using: every repo whose files it read, changed or ran, or whose
 * skill it loaded, within the window — newest first, its own plot left out. Counts are over the
 * whole session.
 */
export async function reposUsed(thread, plot, roots, now = Date.now()) {
  const a = thread.activity
  if (!a?.uses?.length) return []
  const since = Math.max(now - USE_TURN_MAX_MS, Math.min(now - USE_WINDOW_MS, a.turnStartedAt || now))
  const byRepo = new Map()
  for (const u of a.uses) {
    if (!u.lastAt || u.lastAt < since) continue
    const repo = u.key.startsWith('skill:') ? await repoOfPath(path.join(SKILLS, u.key.slice(6)), roots) : await repoOfPath(u.key, roots)
    if (!repo || repo === plot) continue
    const r = byRepo.get(repo) || { repo, edits: 0, reads: 0, runs: 0, skills: 0, memory: false, firstAt: u.firstAt, lastAt: 0, label: '' }
    r.edits += u.edits
    r.reads += u.reads
    r.runs += u.runs
    r.skills += u.skills
    r.memory ||= isMemoryPath(u.key)
    r.firstAt = Math.min(r.firstAt, u.firstAt)
    if (u.lastAt > r.lastAt) {
      r.lastAt = u.lastAt
      r.label = u.label
    }
    byRepo.set(repo, r)
  }
  return [...byRepo.values()].sort((x, y) => y.lastAt - x.lastAt).slice(0, USES_PER_THREAD)
}

/**
 * The repos every session leans on: where `~/.claude/skills` really lives, where the memory
 * folder really lives, and the repo the most other repos call into by path (the tool shed).
 * Measured on the machine this was built for, over three days of sessions: tools 844 uses,
 * skills 534, memory 456 — more than any project of its own.
 */
export async function sharedRepos(roots, links = []) {
  const skills = await repoOfPath(SKILLS, roots)
  let memory = null
  try {
    for (const dir of await fsp.readdir(path.join(CLAUDE_HOME, 'projects'))) {
      memory = await repoOfPath(path.join(CLAUDE_HOME, 'projects', dir, 'memory'), roots)
      if (memory) break
    }
  } catch {
    /* no projects folder */
  }
  const callers = new Map()
  for (const l of links) {
    if (l.kind !== 'path' || l.source !== 'code' || l.to === skills || l.to === memory) continue
    callers.set(l.to, (callers.get(l.to) || new Set()).add(l.from))
  }
  const [tools, by] = [...callers].sort((a, b) => b[1].size - a[1].size)[0] || []
  return { skills: skills || null, memory: memory || null, tools: by && by.size >= 3 ? tools : null }
}
