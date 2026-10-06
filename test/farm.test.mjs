/**
 * The farm's pure pieces: status, land kinds, layout and the routes between plots.
 *
 * Layout and routes are the ones worth pinning down. A layout that shifts when a thread arrives
 * makes the farm jump under the cursor, and a route through a plot draws a road across
 * somebody's crops.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { statusFor, applyViewed, terminalStatus, inTerminal, STALE_MS } from '../src/farm/status.js'
import { guessLand, landOf, layoutFarm, PW, PH } from '../src/farm/land.js'
import { planRoutes, drawableLinks, gateOf } from '../src/farm/routes.js'
import { mergeState } from '../src/game/merge-state.js'

const NAMES = [
  'course-class', 'live-class', 'thinking-lessons', 'online-class',
  'autovideo', 'youtube-videos', 'sns-marketing', 'newsletter-drafts',
  'office-ops', 'assistant-admin', 'team-tools', 'team-skills', 'local-llm-lab', 'side-project',
]

// ── status ────────────────────────────────────────────────────────────────────

test('status: first match wins, in the colony order', () => {
  const now = 10 * STALE_MS
  const base = { lastActivityAt: now - 1000 }
  assert.equal(statusFor({ ...base, hasError: true, running: true }, now), 'blocked')
  assert.equal(statusFor({ ...base, running: true, unread: true }, now), 'working')
  assert.equal(statusFor({ ...base, unread: true }, now), 'waiting')
  assert.equal(statusFor({ ...base, prState: 'MERGED', unread: true }, now), 'celebrating')
  assert.equal(statusFor({ lastActivityAt: now - STALE_MS - 1 }, now), 'sleeping')
  assert.equal(statusFor({ lastActivityAt: now - STALE_MS - 1, unread: true }, now), 'waiting')
  assert.equal(statusFor(base, now), 'idle')
})

test('a thread marked viewed stops waiting until it moves on again', () => {
  const [seen, moved] = applyViewed(
    [{ id: 'a', unread: true, lastActivityAt: 100 }, { id: 'b', unread: true, lastActivityAt: 300 }],
    { a: 200, b: 200 }
  )
  assert.equal(seen.unread, false)
  assert.equal(moved.unread, true)
})

test('a terminal session says whose turn it is, and 확인함 quiets it until that changes', () => {
  const t = (status, since = 1000) => ({ id: 'x', terminal: { status, since } })
  assert.equal(terminalStatus(t('busy')), 'working')
  assert.equal(terminalStatus(t('idle')), 'waiting')
  assert.equal(terminalStatus(t('idle'), { x: 1500 }), 'idle')
  assert.equal(terminalStatus(t('idle', 2000), { x: 1500 }), 'waiting')
  assert.equal(terminalStatus({ ...t('idle'), hasError: true }), 'blocked')
})

test('terminal-only keeps live CLI sessions and drops the desktop apps', () => {
  assert.equal(inTerminal({ harness: 'claude-code', source: 'cli', terminal: { status: 'idle' } }), true)
  assert.equal(inTerminal({ harness: 'claude-code', source: 'cli', terminal: null }), false)
  assert.equal(inTerminal({ harness: 'claude-code', source: 'desktop', terminal: null }), false)
  assert.equal(inTerminal({ harness: 'codex', source: 'vscode' }), false)
  assert.equal(inTerminal({ harness: 'codex', source: 'exec' }), false)
  assert.equal(inTerminal({ harness: 'codex', source: 'cli' }), true)
})

// ── land ──────────────────────────────────────────────────────────────────────

test('land is guessed from the kind of work in the name', () => {
  assert.equal(guessLand('course-class'), 'field')
  assert.equal(guessLand('youtube-videos'), 'orchard')
  assert.equal(guessLand('이미지 생성파일'), 'orchard')
  assert.equal(guessLand('sns-marketing'), 'market')
  assert.equal(guessLand('메일 발송'), 'market')
  assert.equal(guessLand('office-ops'), 'barn')
  assert.equal(guessLand('team-tools'), 'forge')
  assert.equal(guessLand('local-llm-lab'), 'forest')
})

test('a land the person chose beats the guess, and a bogus one is ignored', () => {
  assert.equal(landOf('team-tools', { 'team-tools': 'field' }), 'field')
  assert.equal(landOf('team-tools', { 'team-tools': 'swamp' }), 'forge')
})

// ── layout ────────────────────────────────────────────────────────────────────

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

test('every plot is placed, inside the map, and no two touch', () => {
  const L = layoutFarm(NAMES)
  assert.equal(L.plots.size, NAMES.length)
  const rects = [...L.plots.values(), L.home, L.pond]
  for (const r of rects) {
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= L.W && r.y + r.h <= L.H, `in bounds: ${JSON.stringify(r)}`)
  }
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) assert.ok(!overlaps(rects[i], rects[j]), `${i} vs ${j}`)
  for (const p of L.plots.values()) assert.deepEqual([p.w, p.h], [PW, PH])
})

test('layout does not depend on the order threads arrived in', () => {
  const a = layoutFarm(NAMES)
  const b = layoutFarm([...NAMES].reverse())
  assert.deepEqual([...a.plots].sort(), [...b.plots].sort())
})

test('the shared store sits right under the active zone and keeps its place even while worked in', () => {
  const shared = new Map([['team-skills', 'skills'], ['team-tools', 'tools']])
  const L = layoutFarm(NAMES, {}, new Set(['team-skills', 'course-class']), shared)
  const store = L.zones.find((z) => z.land === 'shared')
  const active = L.zones.find((z) => z.land === 'active')
  assert.equal(store.x, active.x, 'shared store sits in the same column as the active zone')
  assert.ok(store.y > active.y, 'right under it')
  assert.equal(L.plots.get('team-skills').land, 'shared')
  assert.equal(L.plots.get('team-skills').role, 'skills')
  assert.equal(L.plots.get('course-class').active, true)
})

test('moving a plot to another land puts it in that zone', () => {
  const L = layoutFarm(NAMES, { 'team-tools': 'field' })
  assert.equal(L.plots.get('team-tools').land, 'field')
  const field = L.zones.find((z) => z.land === 'field')
  const p = L.plots.get('team-tools')
  assert.ok(p.x >= field.x && p.x + p.w <= field.x + field.w)
})

// ── routes ────────────────────────────────────────────────────────────────────

const link = (from, to, kind = 'path', extra = {}) => ({ from, to, kind, source: 'code', code: 3, weak: false, evidence: [], ...extra })

test('a route runs gate to gate and never through a plot', () => {
  const L = layoutFarm(NAMES)
  const { routes } = planRoutes(L, [link('team-skills', 'team-tools'), link('assistant-admin', 'youtube-videos', 'data')])
  assert.equal(routes.length, 2)
  for (const r of routes) {
    const a = gateOf(L.plots.get(r.from), r.kind)
    const b = gateOf(L.plots.get(r.to), r.kind)
    assert.deepEqual(r.cells[0], [a.x, a.y])
    assert.deepEqual(r.cells.at(-1), [b.x, b.y])
    for (const [x, y] of r.cells) {
      for (const p of L.plots.values()) assert.ok(!(x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h), `cell ${x},${y} inside a plot`)
    }
  }
})

test('two tracks from neighbouring plots to a far one share a trunk instead of running side by side', () => {
  const L = layoutFarm(NAMES)
  const { routes } = planRoutes(L, [link('live-class', 'assistant-admin'), link('thinking-lessons', 'assistant-admin')])
  const [a, b] = routes.map((r) => new Set(r.cells.map(([x, y]) => `${x},${y}`)))
  const shared = [...a].filter((c) => b.has(c)).length
  assert.ok(shared >= 20, `shared ${shared} cells`)
})

test('only code links between plots on the map are drawn, and hidden ones are not', () => {
  const names = new Set(['a', 'b', 'c'])
  const out = drawableLinks(
    [link('a', 'b'), link('a', 'c', 'path', { source: 'docs' }), link('a', 'zzz'), link('b', 'c')],
    names,
    ['b>c']
  )
  assert.deepEqual(out.map((l) => `${l.from}>${l.to}`), ['a>b'])
})

// ── saved farm fields ─────────────────────────────────────────────────────────

test('land choices, plot positions and link edits survive a two-tab merge', () => {
  const out = mergeState(
    { lands: {}, farmPlots: {}, hiddenLinks: [], linkAliases: {} },
    { lands: { 'team-tools': 'field' }, farmPlots: {}, hiddenLinks: ['a>b'], linkAliases: {} },
    { lands: { 'assistant-admin': 'barn' }, farmPlots: { x: [1, 2] }, hiddenLinks: [], linkAliases: { 'old/tools': 'team-tools' } }
  )
  assert.deepEqual(out.lands, { 'assistant-admin': 'barn', 'team-tools': 'field' })
  assert.deepEqual(out.farmPlots, { x: [1, 2] })
  assert.deepEqual(out.hiddenLinks, ['a>b'])
  assert.deepEqual(out.linkAliases, { 'old/tools': 'team-tools' })
})

test('a terminal\'s stats read as one line: animal, effort stars, mode, context', async () => {
  const { statsLine, contextColor, fmtTokens } = await import('../src/farm/render.js')
  const t = { terminal: { stats: { model: 'Opus 5.5', effort: 'xhigh', permissionMode: 'auto', fast: false, contextPct: 87, contextTokens: 866000, estimated: false } } }
  assert.equal(statsLine(t), '🐮 Opus 5.5 · 힘★★★★ · 🤖 자동 · 🧠 87% (866k)')
  const guess = { terminal: { stats: { model: 'Sonnet 5.5', permissionMode: 'plan', contextPct: 35, contextTokens: 70000, estimated: true } } }
  assert.equal(statsLine(guess), '🐑 Sonnet 5.5 · 📜 계획 · 🧠 35% (70k) 추정')
  assert.equal(contextColor(85), '#e0433a')
  assert.equal(contextColor(55), '#f2a33a')
  assert.equal(fmtTokens(1234567), '1.2M')
})
