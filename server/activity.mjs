/**
 * What a terminal session is doing right now, read off the end of its transcript.
 *
 * Claude Code writes every step to `~/.claude/projects/<dir>/<session>.jsonl` as it happens, so
 * the transcript can answer three things the live registry cannot:
 *   - what it is doing this second — the last tool it called, in words ("파일 수정: render.js")
 *   - how long this turn has run and how many steps it has taken
 *   - how far along its own task list is, when it keeps one (TaskCreate / TaskUpdate)
 *
 * Transcripts only grow, and a long session's runs past 150 MB, so each file is read once and
 * then only from where the last read stopped. Read-only, like everything else here.
 */
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const HOME = os.homedir()
/** Paths a command names: absolute under a home folder, or `~/…`. */
const PATH_IN_TEXT = /(?:~|\/Users\/[^/\s'"`]+|\/home\/[^/\s'"`]+)\/[^\s'"`;|&)<>]+/g
const TOUCH_KEEP = 40
/** Folders a session has reached into, summed over the whole session. A few hundred at most. */
const USE_KEEP = 400
const expand = (p) => (p.startsWith('~/') ? path.join(HOME, p.slice(2)) : p)

const CHUNK = 4 * 1024 * 1024

/** file → { offset, partial, state } */
const cursors = new Map()

const freshState = () => ({
  turnStartedAt: 0,
  toolsInTurn: 0,
  lastTool: null,
  lastText: '',
  lastTextAt: 0,
  tasks: new Map(),
  pendingCreates: new Map(),
  touches: [],
  uses: new Map(),
  rules: new Map(),
  compacts: [],
  compactCount: 0,
  permissionMode: '',
  mode: '',
  model: '',
  contextTokens: 0,
})

/**
 * What a tool call reached outside the session's own folder: a skill it loaded, a file it read
 * or changed, a tool it ran. Kept raw (paths, skill names); which repo each belongs to is worked
 * out later, by the caller that knows where the repos are.
 */
export function touchesOf(name, input = {}) {
  const i = input && typeof input === 'object' ? input : {}
  if (name === 'Skill' && typeof i.skill === 'string') return [{ kind: 'skill', skill: i.skill, label: `스킬: ${cut(i.skill, 32)}` }]
  const file = i.file_path || i.notebook_path
  if (typeof file === 'string' && file) {
    const write = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(name)
    return [{ kind: write ? 'edit' : 'read', write, path: expand(file), label: `${base(file)} ${write ? '수정' : '읽기'}` }]
  }
  if ((name === 'Grep' || name === 'Glob') && typeof i.path === 'string') return [{ kind: 'read', path: expand(i.path), label: `찾기: ${cut(i.pattern, 24)}` }]
  if (name === 'Bash' && typeof i.command === 'string') {
    // One courier per command: a command that names three repos is still one errand. The other
    // paths still count as places the session used.
    const [first, ...rest] = [...new Set(withoutWrittenText(i.command).match(PATH_IN_TEXT) || [])].slice(0, 4).map(expand)
    return first ? [{ kind: 'run', path: first, also: rest, label: `도구 실행: ${cut(i.description || i.command, 28)}` }] : []
  }
  return []
}

/**
 * The folder a path's repo can be told from, and no deeper: three levels under home
 * (`~/repos/<repo>/<dir>`), four inside Claude's own project folders, where the memory lives
 * (`~/.claude/projects/<dir>/memory`). Keeping whole paths would keep one entry per file.
 * Outside home, where workspaces are rare and sit deeper (`/Volumes/…`, temp folders), eight.
 */
function useKeyOf(p) {
  if (typeof p !== 'string' || !p.startsWith('/')) return null
  const under = p.startsWith(HOME + '/')
  const parts = (under ? p.slice(HOME.length + 1) : p.slice(1)).split('/').filter(Boolean)
  const depth = under ? (parts[0] === '.claude' && parts[1] === 'projects' ? 4 : 3) : 8
  return (under ? HOME : '') + '/' + parts.slice(0, depth).join('/')
}

function countUse(state, key, kind, at, label) {
  if (!key) return
  let u = state.uses.get(key)
  if (!u) {
    u = { key, edits: 0, reads: 0, runs: 0, skills: 0, firstAt: at, lastAt: at, label }
    if (state.uses.size >= USE_KEEP) {
      // Forget the folder used longest ago.
      let oldest = null
      for (const v of state.uses.values()) if (!oldest || v.lastAt < oldest.lastAt) oldest = v
      state.uses.delete(oldest.key)
    }
    state.uses.set(key, u)
  }
  u[{ edit: 'edits', read: 'reads', run: 'runs', skill: 'skills' }[kind] || 'reads']++
  if (at >= u.lastAt) {
    u.lastAt = at
    u.label = label
  }
}

/**
 * A command without the text it writes into a file: the body of a `cat > f <<'EOF'` or `tee`
 * heredoc is that file's content, and a path quoted in it — a script mentioning another repo — is
 * not a place the session went. A heredoc fed to `python3 -` is code that runs, so it stays.
 */
export function withoutWrittenText(command) {
  const out = []
  let end = null
  for (const line of command.split('\n')) {
    if (end !== null) {
      if (line.trim() === end) end = null
      continue
    }
    out.push(line)
    const m = /\b(?:cat|tee)\b[^|;&]*<<-?\s*['"]?([A-Za-z_][\w]*)['"]?/.exec(line)
    if (m) end = m[1]
  }
  return out.join('\n')
}

const base = (p) => (typeof p === 'string' && p ? path.basename(p) : '')
const cut = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** A tool call, said the way a person would: what it is doing, to what. */
export function describeTool(name, input = {}) {
  const i = input && typeof input === 'object' ? input : {}
  switch (name) {
    case 'Bash':
      return `명령 실행: ${cut(i.description || i.command, 48)}`
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `파일 수정: ${base(i.file_path || i.notebook_path)}`
    case 'Write':
      return `파일 작성: ${base(i.file_path)}`
    case 'Read':
      return `파일 읽기: ${base(i.file_path)}`
    case 'Grep':
    case 'Glob':
      return `찾는 중: ${cut(i.pattern, 40)}`
    case 'WebSearch':
      return `웹 검색: ${cut(i.query, 40)}`
    case 'WebFetch':
      return `웹 페이지 읽기: ${cut(i.url, 40)}`
    case 'Agent':
    case 'Task':
      return `보조 일꾼 보냄: ${cut(i.description || i.prompt, 40)}`
    case 'Skill':
      return `스킬 사용: ${cut(i.skill, 40)}`
    case 'TaskCreate':
    case 'TaskUpdate':
    case 'TaskList':
      return '할 일 정리'
    case 'AskUserQuestion':
      return '질문을 띄움'
    case 'ExitPlanMode':
      return '계획 승인 요청'
    default:
      return name?.startsWith('mcp__') ? `도구: ${cut(name.split('__').slice(2).join(' ') || name, 40)}` : `도구: ${cut(name, 40)}`
  }
}

const isHumanTurn = (r) => {
  if (r.type !== 'user' || r.isMeta || r.isSidechain) return false
  const c = r.message?.content
  if (typeof c === 'string') return c.trim().length > 0
  return Array.isArray(c) && c.some((b) => b?.type === 'text') && !c.some((b) => b?.type === 'tool_result')
}

/**
 * A rule file the session was given, as Claude Code records it: `instructions` at the start (and
 * again after a compaction) lists the global, folder and memory-index files; `nested_memory` is a
 * repo's own CLAUDE.md, read the first time the session works in that folder.
 */
function noteRule(state, path, kind, content, at, nested) {
  if (typeof path !== 'string' || !path) return
  const text = typeof content === 'string' ? content : ''
  const headings = text.split('\n').filter((l) => /^#{1,3}\s/.test(l)).map((l) => cut(l.replace(/^#+\s*/, ''), 40)).slice(0, 8)
  const prev = state.rules.get(path)
  state.rules.set(path, { path, kind: kind || prev?.kind || 'Project', nested: Boolean(nested || prev?.nested), lines: text ? text.split('\n').length : prev?.lines || 0, chars: text.length || prev?.chars || 0, headings: headings.length ? headings : prev?.headings || [], at })
}

function apply(state, r) {
  const at = Date.parse(r.timestamp || '') || 0
  // A compaction: the conversation was summarised to free the context window — by Claude Code
  // when it filled up (`auto`) or by /compact (`manual`). Each one is a harvest on the farm.
  if (r.type === 'system' && r.subtype === 'compact_boundary') {
    const m = r.compactMetadata || {}
    state.compactCount++
    state.compacts.push({ at, trigger: m.trigger === 'manual' ? 'manual' : 'auto', pre: Number(m.preTokens) || 0, post: Number(m.postTokens) || 0 })
    if (state.compacts.length > 12) state.compacts.shift()
    return
  }
  if (r.type === 'attachment' && r.attachment) {
    const a = r.attachment
    if (a.type === 'instructions' && Array.isArray(a.files)) for (const f of a.files) noteRule(state, f?.path, f?.type, f?.content, at, false)
    if (a.type === 'nested_memory') noteRule(state, a.path || a.content?.path, a.content?.type, a.content?.content, at, true)
    return
  }
  if (r.type === 'permission-mode' && typeof r.permissionMode === 'string') state.permissionMode = r.permissionMode
  if (r.type === 'mode' && typeof r.mode === 'string') state.mode = r.mode
  if (r.type === 'assistant' && !r.isSidechain && r.message) {
    if (typeof r.message.model === 'string' && !r.message.model.startsWith('<')) state.model = r.message.model
    const u = r.message.usage
    // Everything that was in the window for that call: fresh input, cache writes, cache reads.
    if (u) state.contextTokens = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
  }
  if (isHumanTurn(r)) {
    state.turnStartedAt = at
    state.toolsInTurn = 0
    return
  }
  const content = r.message?.content
  if (!Array.isArray(content) || r.isSidechain) return
  for (const b of content) {
    if (r.type === 'assistant' && b?.type === 'tool_use') {
      state.toolsInTurn++
      state.lastTool = { name: b.name, label: describeTool(b.name, b.input), at }
      for (const t of touchesOf(b.name, b.input)) {
        state.touches.push({ ...t, at })
        if (t.kind === 'skill') countUse(state, `skill:${t.skill}`, 'skill', at, t.label)
        else for (const p of [t.path, ...(t.also || [])]) countUse(state, useKeyOf(p), t.kind, at, t.label)
      }
      if (state.touches.length > TOUCH_KEEP) state.touches.splice(0, state.touches.length - TOUCH_KEEP)
      if (b.name === 'TaskCreate') state.pendingCreates.set(b.id, { subject: cut(b.input?.subject, 60), active: cut(b.input?.activeForm, 60) })
      if (b.name === 'TaskUpdate' && b.input?.taskId) {
        const t = state.tasks.get(String(b.input.taskId))
        if (t && b.input.status) t.status = b.input.status
        if (t && b.input.subject) t.subject = cut(b.input.subject, 60)
      }
    } else if (r.type === 'assistant' && b?.type === 'text' && b.text?.trim()) {
      state.lastText = cut(b.text, 200)
      state.lastTextAt = at
    } else if (r.type === 'user' && b?.type === 'tool_result' && state.pendingCreates.has(b.tool_use_id)) {
      const text = typeof b.content === 'string' ? b.content : JSON.stringify(b.content || '')
      const id = /Task #(\d+)/.exec(text)?.[1]
      const made = state.pendingCreates.get(b.tool_use_id)
      state.pendingCreates.delete(b.tool_use_id)
      if (id) state.tasks.set(id, { ...made, status: 'pending' })
    }
  }
}

/** Read whatever the file has gained since last time and fold it into that file's state. */
async function advance(file) {
  let cur = cursors.get(file)
  let st
  try {
    st = await fsp.stat(file)
  } catch {
    return null
  }
  if (!cur || st.size < cur.offset) cur = { offset: 0, partial: '', state: freshState() }
  if (st.size > cur.offset) {
    const fh = await fsp.open(file, 'r')
    try {
      let pos = cur.offset
      while (pos < st.size) {
        const want = Math.min(CHUNK, st.size - pos)
        const buf = Buffer.allocUnsafe(want)
        const { bytesRead } = await fh.read(buf, 0, want, pos)
        if (!bytesRead) break
        pos += bytesRead
        const text = cur.partial + buf.subarray(0, bytesRead).toString('utf8')
        const lines = text.split('\n')
        cur.partial = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('{')) continue
          try {
            apply(cur.state, JSON.parse(line))
          } catch {
            /* a malformed line — skip it */
          }
        }
      }
      cur.offset = pos
    } finally {
      await fh.close()
    }
  }
  cursors.set(file, cur)
  return cur.state
}

/** The page-facing summary. `tasks` only when the session keeps a list. */
export async function activityOf(file) {
  const s = await advance(file)
  if (!s) return null
  const list = [...s.tasks.values()].filter((t) => t.status !== 'deleted')
  const current = list.find((t) => t.status === 'in_progress')
  return {
    turnStartedAt: s.turnStartedAt,
    toolsInTurn: s.toolsInTurn,
    lastTool: s.lastTool,
    lastText: s.lastText,
    lastTextAt: s.lastTextAt,
    touches: s.touches.slice(),
    uses: [...s.uses.values()].map((u) => ({ ...u })),
    rules: [...s.rules.values()].map((x) => ({ ...x, headings: x.headings.slice() })),
    compacts: s.compactCount ? { count: s.compactCount, list: s.compacts.map((c) => ({ ...c })), last: { ...s.compacts[s.compacts.length - 1] } } : null,
    permissionMode: s.permissionMode,
    mode: s.mode,
    model: s.model,
    contextTokens: s.contextTokens,
    tasks: list.length
      ? { total: list.length, done: list.filter((t) => t.status === 'completed').length, current: current ? current.active || current.subject : '' }
      : null,
  }
}
