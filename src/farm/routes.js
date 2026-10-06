/**
 * Repo links → dirt tracks and water channels laid across the farm.
 *
 * A link from the server says repo A uses repo B, by file path (`path`) or by sharing a site or
 * data store (`data`). Each becomes a route between the two plots' gates, found with A* over
 * the tile grid. Routes of the same kind are cheaper to share than to cut fresh, so forty-odd
 * links settle into a handful of trunk roads instead of forty parallel lines; the other kind is
 * expensive to cross, so tracks and channels run side by side and only meet at a bridge.
 *
 * Pure: layout and links in, cell sets out.
 */

const SHARE = 0.35
const CROSS = 6

class Heap {
  constructor() {
    this.a = []
  }
  push(item, pri) {
    const a = this.a
    a.push([pri, item])
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p][0] <= a[i][0]) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }
  pop() {
    const a = this.a
    const top = a[0]
    const last = a.pop()
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < a.length && a[l][0] < a[m][0]) m = l
        if (r < a.length && a[r][0] < a[m][0]) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top[1]
  }
  get size() {
    return this.a.length
  }
}

/** The cell just outside a plot's bottom edge — its gate. Water leaves two tiles to the side. */
export const gateOf = (p, kind) => ({ x: p.x + Math.floor(p.w / 2) + (kind === 'data' ? 2 : 0), y: p.y + p.h })

function blockedGrid(layout) {
  const { W, H } = layout
  const blocked = new Uint8Array(W * H)
  const mark = (r, pad = 0) => {
    for (let y = r.y - pad; y < r.y + r.h + pad; y++) for (let x = r.x - pad; x < r.x + r.w + pad; x++) if (x >= 0 && y >= 0 && x < W && y < H) blocked[y * W + x] = 1
  }
  for (const p of layout.plots.values()) mark(p)
  if (layout.home) mark(layout.home)
  if (layout.pond) mark(layout.pond)
  for (let x = 0; x < W; x++) for (const y of [0, 1, H - 1, H - 2]) blocked[y * W + x] = 1
  for (let y = 0; y < H; y++) for (const x of [0, 1, W - 1, W - 2]) blocked[y * W + x] = 1
  return blocked
}

function astar(layout, blocked, start, goal, same, other) {
  const { W, H } = layout
  const idx = (x, y) => y * W + x
  const s = idx(start.x, start.y)
  const g = idx(goal.x, goal.y)
  const cost = new Float32Array(W * H).fill(Infinity)
  const from = new Int32Array(W * H).fill(-1)
  const heap = new Heap()
  cost[s] = 0
  heap.push(s, 0)
  while (heap.size) {
    const cur = heap.pop()
    if (cur === g) break
    const cx = cur % W
    const cy = (cur - cx) / W
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx
      const ny = cy + dy
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const n = idx(nx, ny)
      if (blocked[n] && n !== g) continue
      const step = same.has(n) ? SHARE : other.has(n) ? CROSS : 1
      const c = cost[cur] + step
      if (c >= cost[n]) continue
      cost[n] = c
      from[n] = cur
      heap.push(n, c + (Math.abs(nx - goal.x) + Math.abs(ny - goal.y)) * SHARE)
    }
  }
  if (from[g] === -1 && s !== g) return null
  const cells = []
  for (let c = g; c !== -1; c = from[c]) cells.push([c % W, Math.floor(c / W)])
  return cells.reverse()
}

/**
 * links: server links (`/api/links`), already filtered to the ones worth drawing.
 * Returns `{ routes, path: Set<idx>, water: Set<idx>, stones: Set<idx> }` with idx = y*W + x.
 */
export function planRoutes(layout, links) {
  const blocked = blockedGrid(layout)
  const sets = { path: new Set(), data: new Set(), weak: new Set() }
  const pairs = new Map()
  for (const l of links) {
    const key = `${l.from}>${l.to}`
    const p = pairs.get(key) || { from: l.from, to: l.to, kinds: new Map(), weak: true, code: 0 }
    p.kinds.set(l.kind, l)
    if (!l.weak) p.weak = false
    p.code += l.code || 0
    pairs.set(key, p)
  }
  const routes = []
  const ordered = [...pairs.values()].sort((a, b) => b.code - a.code)
  for (const pair of ordered) {
    const a = layout.plots.get(pair.from)
    const b = layout.plots.get(pair.to)
    if (!a || !b) continue
    for (const [kind, link] of pair.kinds) {
      const bucket = pair.weak ? 'weak' : kind
      const other = kind === 'data' ? sets.path : sets.data
      const cells = astar(layout, blocked, gateOf(a, kind), gateOf(b, kind), sets[bucket], other)
      if (!cells) continue
      for (const [x, y] of cells) sets[bucket].add(y * layout.W + x)
      routes.push({ from: pair.from, to: pair.to, kind, weak: pair.weak, link, cells })
    }
  }
  return { routes, path: sets.path, water: sets.data, stones: sets.weak, blocked }
}

/** The farmhouse's gate, for errands that start or end there. */
export const homeGate = (layout) => ({ x: layout.home.x + Math.floor(layout.home.w / 2), y: layout.home.y + layout.home.h })

/**
 * A courier's (or a tractor's) way between two plots (`'__home'` for the farmhouse), along the
 * dirt tracks where it can: a track costs a third of open grass, and a water channel is crossed
 * rather than followed — a tractor driving down a canal looked like a boat.
 */
export function errandRoute(layout, plan, from, to) {
  const gate = (name) => (name === '__home' ? homeGate(layout) : layout.plots.get(name) && gateOf(layout.plots.get(name), 'path'))
  const a = gate(from)
  const b = gate(to)
  if (!a || !b) return null
  const roads = new Set([...(plan?.path || []), ...(plan?.stones || [])])
  const water = new Set([...(plan?.water || [])].filter((i) => !roads.has(i)))
  return astar(layout, plan?.blocked || blockedGrid(layout), a, b, roads, water)
}

/** Pair the server's links down to the ones the farm draws: code evidence, both ends on the map. */
export function drawableLinks(links, plotNames, hidden = []) {
  const off = new Set(hidden)
  return (links || []).filter((l) => l.source === 'code' && plotNames.has(l.from) && plotNames.has(l.to) && !off.has(`${l.from}>${l.to}`))
}
