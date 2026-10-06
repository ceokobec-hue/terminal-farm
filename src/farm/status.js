/**
 * Thread → what its farmhand is doing. Lifted out of the old 3D colony unchanged, so the farm
 * and the colony it replaced agree on every thread: first match wins.
 */

/** Three days without a word and a thread is asleep. */
export const STALE_MS = 3 * 24 * 60 * 60 * 1000

export const STATUS_ORDER = ['blocked', 'waiting', 'working', 'celebrating', 'idle', 'sleeping']

export const STATUS_LABEL = {
  working: '일하는 중',
  waiting: '나를 기다림',
  blocked: '오류',
  celebrating: '합쳐짐',
  idle: '쉬는 중',
  sleeping: '잠듦',
}

export function statusFor(thread, now = Date.now()) {
  if (thread.hasError) return 'blocked'
  if (thread.running) return 'working'
  if (thread.prState === 'MERGED') return 'celebrating'
  if (thread.unread) return 'waiting'
  if (now - thread.lastActivityAt > STALE_MS) return 'sleeping'
  return 'idle'
}

/** How far along a thread is, on a log scale over its transcript size. */
export function transcriptProgress(thread) {
  const size = Math.max(1, thread.sizeBytes || 0)
  return Math.min(1, Math.max(0.05, (Math.log10(size) - 3) / 3.5))
}

/** A thread you said you looked at stops counting as unread until it moves on again. */
export function applyViewed(threads, viewedAt = {}) {
  return threads.map((t) => {
    const at = viewedAt[t.id]
    return at && t.lastActivityAt <= at ? { ...t, unread: false } : t
  })
}

/**
 * A session open in a terminal answers for itself: `busy` is mid-turn, anything else is the
 * person's turn. "확인함" quiets that until the terminal's status changes again.
 */
export function terminalStatus(thread, viewedAt = {}) {
  if (thread.hasError) return 'blocked'
  if (thread.parentId) return 'working'
  const term = thread.terminal
  if (!term) return statusFor(thread)
  if (term.status === 'busy') return 'working'
  const seen = viewedAt[thread.id] || 0
  return seen && seen >= term.since ? 'idle' : 'waiting'
}

/** Only what is open in a terminal: live CLI sessions, and any harness's CLI runs. */
export const inTerminal = (t) => Boolean(t.terminal) || (t.harness !== 'claude-code' && t.source === 'cli')
