/**
 * What Claude Code's own status line knows about each session: model, effort, fast mode,
 * how full the context window is, and the plan's 5-hour / 7-day usage.
 *
 * Claude Code hands that JSON to the status line command on every refresh. Pointing the status
 * line at `scripts/statusline.mjs` (on its own, or with `--wrap` around the person's own command)
 * saves a copy per session in `~/.claude/terminal-farm-status/<session_id>.json`; this reads
 * those copies. Nothing is sent anywhere, and with no copies the farm falls back to what
 * transcripts say.
 */
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const DIR = process.env.TERMINAL_FARM_STATUS || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'terminal-farm-status')
/** Plan usage older than this is not shown as "now". */
const USAGE_FRESH_MS = 6 * 60 * 60 * 1000

const cache = new Map()
async function readOne(file) {
  let st
  try {
    st = await fsp.stat(file)
  } catch {
    return null
  }
  const hit = cache.get(file)
  if (hit && hit.mtime === st.mtimeMs) return hit.value
  let raw
  try {
    raw = JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch {
    return hit?.value || null
  }
  const cw = raw.context_window || {}
  const rl = raw.rate_limits || {}
  const win = (w) => (w && Number.isFinite(w.used_percentage) ? { pct: w.used_percentage, resetsAt: (w.resets_at || 0) * 1000 } : null)
  const value = {
    model: raw.model?.display_name || raw.model?.id || '',
    modelId: raw.model?.id || '',
    effort: raw.effort?.level || '',
    fast: raw.fast_mode === true,
    contextPct: Number.isFinite(cw.used_percentage) ? cw.used_percentage : null,
    contextTokens: cw.total_input_tokens || 0,
    windowSize: cw.context_window_size || 0,
    cost: raw.cost?.total_cost_usd || 0,
    fiveHour: win(rl.five_hour),
    sevenDay: win(rl.seven_day),
    updatedAt: st.mtimeMs,
  }
  cache.set(file, { mtime: st.mtimeMs, value })
  return value
}

/** The status line's last word on one session, or null. */
export const statusOf = (sessionId) => (sessionId ? readOne(path.join(DIR, `${sessionId}.json`)) : Promise.resolve(null))

/** The plan's usage right now: whichever session's status line reported it most recently. */
export async function planUsage(now = Date.now()) {
  let names
  try {
    names = (await fsp.readdir(DIR)).filter((n) => n.endsWith('.json'))
  } catch {
    return null
  }
  let best = null
  for (const n of names) {
    const v = await readOne(path.join(DIR, n))
    if (!v || (!v.fiveHour && !v.sevenDay) || now - v.updatedAt > USAGE_FRESH_MS) continue
    if (!best || v.updatedAt > best.updatedAt) best = v
  }
  return best && { fiveHour: best.fiveHour, sevenDay: best.sevenDay, updatedAt: best.updatedAt }
}
