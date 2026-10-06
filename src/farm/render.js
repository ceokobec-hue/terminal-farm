/**
 * The farm, drawn tile by tile on a 2D canvas.
 *
 * Art is Kenney's Tiny Town and Tiny Farm (CC0, 16 px tiles, see public/assets/CREDITS.md).
 * Paths, water, signs, bubbles and the mailbox are drawn in code in the same palette, because
 * neither pack has them in the shapes a farm of repos needs.
 *
 * Everything is drawn at 1 px per art pixel into an offscreen "world" canvas, then copied to the
 * screen at a whole-number zoom with smoothing off — the only way pixel art stays crisp. The
 * ground, plots, roads and trees only change when the layout or the links do, so they are baked
 * once into a base layer and the per-frame work is the farmhands, bubbles and light.
 */
import { T, PAL, tile, sprite, BUBBLE_WAIT, BUBBLE_BLOCK, SPARKLE, MAILBOX, FLAG, LILY, TRACTOR, TRAILER_FULL, TRAILER_EMPTY, HELPER, BOARD, BOARD_BIG, BADGE_GEAR, BADGE_HAND, shade, tinted } from './art.js'
import { gateOf } from './routes.js'
import { SHARED_ROLE } from './land.js'

const hash = (x, y = 0, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
const strHash = (s) => [...String(s)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7) >>> 0

/**
 * One colour per Terminal tab, so a terminal's plot, its tractors and its helpers in other repos'
 * plots can be matched at a glance. Picked to stand out on grass and from each other.
 */
export const TAB_COLORS = ['#3b7ddd', '#e8772e', '#9b59d0', '#14a394', '#d6457f', '#c9a000', '#d64535', '#5a6b8c']
export const tabColor = (tab) => (tab > 0 && tab < 99 ? TAB_COLORS[(tab - 1) % TAB_COLORS.length] : '#8a8f9c')

/** Crops by repo: carrot, turnip, corn, tomato, cabbage, wheat (Tiny Farm rows). */
const CROPS = [4, 16, 28, 40, 52, 64]
/** The crate of each crop, full — one per compaction beside a terminal's field. */
const CRATES = [11, 23, 35, 47, 59, 71]
/** A terminal's crop, by its tab: 탭1 carrots, 탭2 turnips, 탭3 corn, 탭4 tomatoes, 탭5 cabbages, 탭6 wheat. */
export const cropOfTab = (tab, key = '') => (tab > 0 && tab < 99 ? (tab - 1) % CROPS.length : strHash(key) % CROPS.length)
/** Past this much of the context window, a red flag: a compaction is near. */
const FLAG_AT = 80
const SLOT_COLS = [3, 1, 5, 2, 4]

export class FarmRenderer {
  constructor(canvas, sheets) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.sheets = sheets
    this.world = document.createElement('canvas')
    this.base = document.createElement('canvas')
    // Three art pixels per CSS pixel by default: big enough that a plot holds its farmhands'
    // tags and info lines without them spilling onto the neighbours.
    this.cam = { x: 0, y: 0, zoom: 3 }
    this.onZoomChange = null
    // Until the person pans or zooms, the view keeps itself on the active zone — the threads and
    // the links arrive separately at boot, and the layout settles over the first few polls.
    this.userMoved = false
    this.scene = null
    this.baseKey = ''
    this.hits = []
    this.tick = 0
    // Sprites drawn once per colour and direction, then stamped.
    this.spriteCache = new Map()
  }

  /** A sprite as a small canvas, cached under `key`; mirrored when facing left. */
  spriteImg(def, key, flip = false) {
    const k = `${key}|${flip ? 1 : 0}`
    let c = this.spriteCache.get(k)
    if (!c) {
      c = document.createElement('canvas')
      c.width = def.rows[0].length
      c.height = def.rows.length
      const g = c.getContext('2d')
      if (flip) {
        g.translate(c.width, 0)
        g.scale(-1, 1)
      }
      sprite(g, def, 0, 0)
      this.spriteCache.set(k, c)
    }
    return c
  }

  // ---------- camera ----------
  get dpr() {
    return window.devicePixelRatio || 1
  }
  resize() {
    const r = this.canvas.getBoundingClientRect()
    this.canvas.width = Math.round(r.width * this.dpr)
    this.canvas.height = Math.round(r.height * this.dpr)
    this.clamp()
  }
  /**
   * Device pixels per art pixel. Continuous while a pinch is under way — stepping through a few
   * fixed sizes made a trackpad pinch jump straight from one end to the other — and settled on a
   * whole number a moment after it stops, so every art pixel ends up the same size.
   */
  get scale() {
    return this.cam.zoom * this.dpr
  }
  get fitZoom() {
    if (!this.scene) return 1
    const { W, H } = this.scene.layout
    return Math.min(this.canvas.width / (W * T), (this.canvas.height - 90 * this.dpr) / (H * T)) / this.dpr
  }
  clamp() {
    if (!this.scene) return
    const s = this.scale
    const ww = this.scene.layout.W * T
    const wh = this.scene.layout.H * T
    const vw = this.canvas.width / s
    const vh = this.canvas.height / s
    this.cam.x = vw >= ww ? (ww - vw) / 2 : Math.min(Math.max(this.cam.x, 0), ww - vw)
    this.cam.y = vh >= wh ? (wh - vh) / 2 : Math.min(Math.max(this.cam.y, 0), wh - vh)
  }
  centerOn(tx, ty) {
    this.userMoved = true
    const s = this.scale
    this.cam.x = tx * T - this.canvas.width / s / 2
    this.cam.y = ty * T - this.canvas.height / s / 2
    this.clamp()
  }
  panBy(dxCss, dyCss) {
    this.userMoved = true
    const s = this.scale / this.dpr
    this.cam.x -= dxCss / s
    this.cam.y -= dyCss / s
    this.clamp()
  }
  /** Zoom by a factor around a point on screen (CSS px), then settle on a crisp size. */
  zoomBy(factor, cssX, cssY) {
    this.userMoved = true
    const before = this.toWorld(cssX, cssY)
    this.cam.zoom = Math.min(6, Math.max(this.fitZoom * 0.85, this.cam.zoom * factor))
    const s = this.scale
    this.cam.x = before.x - (cssX * this.dpr) / s
    this.cam.y = before.y - (cssY * this.dpr) / s
    this.clamp()
    clearTimeout(this.snapTimer)
    this.snapTimer = setTimeout(() => this.snap(cssX, cssY), 260)
  }
  /** A step for keys and buttons. */
  zoomAt(cssX, cssY, dir) {
    this.zoomBy(dir > 0 ? 1.25 : 0.8, cssX, cssY)
  }
  snap(cssX, cssY) {
    const s = this.scale
    this.onZoomChange?.(this.cam.zoom)
    if (s < 1) return
    const target = Math.round(s) / this.dpr
    if (Math.abs(target - this.cam.zoom) < 1e-3) return
    const before = this.toWorld(cssX, cssY)
    this.cam.zoom = target
    this.cam.x = before.x - (cssX * this.dpr) / this.scale
    this.cam.y = before.y - (cssY * this.dpr) / this.scale
    this.clamp()
    this.onZoomChange?.(this.cam.zoom)
  }
  fit() {
    if (!this.scene) return
    this.userMoved = true
    this.cam.zoom = this.fitZoom
    this.clamp()
  }
  /**
   * Glide to frame a rectangle of tiles, leaving `margin` CSS px clear at the top, right, bottom
   * and left (for the tour card and the panels), and settle on a crisp zoom.
   */
  flyTo(rect, { margin = [70, 40, 230, 40], maxZoom = 4, ms = 800 } = {}) {
    if (!this.scene) return
    this.userMoved = true
    const [mt, mr, mb, ml] = margin
    const cw = this.canvas.width / this.dpr
    const ch = this.canvas.height / this.dpr
    const fitW = (cw - ml - mr) / (rect.w * T)
    const fitH = (ch - mt - mb) / (rect.h * T)
    let zoom = Math.max(0.6, Math.min(maxZoom, fitW, fitH))
    if (zoom * this.dpr >= 1) zoom = Math.max(1, Math.floor(zoom * this.dpr)) / this.dpr
    // Where the camera's top-left must be for the rectangle's centre to sit in the free area's centre.
    const cx = (rect.x + rect.w / 2) * T
    const cy = (rect.y + rect.h / 2) * T
    const to = { zoom, x: cx - (ml + (cw - ml - mr) / 2) / zoom, y: cy - (mt + (ch - mt - mb) / 2) / zoom }
    this.anim = { from: { ...this.cam }, to, t0: performance.now(), ms }
  }
  get animating() {
    return Boolean(this.anim)
  }
  stepAnim(now) {
    const a = this.anim
    if (!a) return
    const k = Math.min(1, (now - a.t0) / a.ms)
    const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2
    // Zoom glides in log space so a big change does not lurch at one end.
    this.cam.zoom = Math.exp(Math.log(a.from.zoom) + (Math.log(a.to.zoom) - Math.log(a.from.zoom)) * e)
    this.cam.x = a.from.x + (a.to.x - a.from.x) * e
    this.cam.y = a.from.y + (a.to.y - a.from.y) * e
    if (k >= 1) {
      this.anim = null
      this.cam = { ...this.cam, ...a.to }
    }
  }
  toWorld(cssX, cssY) {
    const s = this.scale
    return { x: this.cam.x + (cssX * this.dpr) / s, y: this.cam.y + (cssY * this.dpr) / s }
  }
  toScreen(wx, wy) {
    const s = this.scale / this.dpr
    return { x: (wx - this.cam.x) * s, y: (wy - this.cam.y) * s }
  }

  // ---------- scene ----------
  /**
   * scene: { layout, routes, plots: Map<name, {threads, info}>, home: {threads}, night, dusk,
   *          showLinks, selectedPlot, selectedThread, waiting }
   */
  setScene(scene) {
    const first = !this.scene
    this.scene = scene
    const key = JSON.stringify([
      scene.layout.W,
      scene.layout.H,
      [...scene.layout.plots].map(([n, p]) => [n, p.x, p.y, p.land, p.active, p.role, (scene.plots.get(n)?.threads.length || 0) > 0, crop(scene.plots.get(n)), Boolean(scene.repoWork?.has(n))]),
      scene.routes ? [scene.routes.path.size, scene.routes.water.size, scene.routes.stones.size] : 0,
      scene.showLinks,
      scene.night,
      scene.dusk,
    ])
    if (key !== this.baseKey) {
      this.baseKey = key
      this.drawBase()
    }
    if (first) this.resize()
    if (!this.userMoved) {
      // The active zone's top-left corner (and the tags that hang past it) at the top-left of the
      // screen; the farmhouse when nobody is working.
      const a = scene.layout.zones.find((zone) => zone.land === 'active') || scene.layout.home
      this.cam.x = (a.x - 2.5) * T
      this.cam.y = (a.y - 1) * T
      this.clamp()
    }
  }

  // ---------- base layer ----------
  drawBase() {
    const { layout, routes, showLinks } = this.scene
    const W = layout.W * T
    const H = layout.H * T
    for (const c of [this.base, this.world]) {
      c.width = W
      c.height = H
    }
    const g = this.base.getContext('2d')
    g.imageSmoothingEnabled = false
    const town = this.sheets.town
    const farm = this.sheets.farm

    // Grass, with the odd tuft and flower.
    for (let y = 0; y < layout.H; y++) {
      for (let x = 0; x < layout.W; x++) {
        const r = hash(x, y, 1)
        tile(g, town, r < 0.08 ? 1 : r < 0.11 ? 2 : 0, x * T, y * T)
      }
    }

    const occupied = new Uint8Array(layout.W * layout.H)
    const mark = (r, pad = 0) => {
      for (let y = r.y - pad; y < r.y + r.h + pad; y++) for (let x = r.x - pad; x < r.x + r.w + pad; x++) if (x >= 0 && y >= 0 && x < layout.W && y < layout.H) occupied[y * layout.W + x] = 1
    }
    for (const p of layout.plots.values()) mark(p, 1)
    for (const z of layout.zones) mark({ x: z.x, y: z.y, w: Math.min(z.w, 12), h: 2 })
    mark(layout.home, 1)
    mark(layout.pond, 1)

    this.drawPond(g, layout.pond)

    if (showLinks && routes) {
      for (const i of routes.path) occupied[i] = 1
      for (const i of routes.water) occupied[i] = 1
      for (const i of routes.stones) occupied[i] = 1
      this.drawStones(g, routes.stones, layout.W)
      this.drawPaths(g, routes.path, layout.W)
      this.drawWater(g, routes.water, routes.path, layout.W)
    }

    // A wooded border, then trees scattered over whatever is still open grass.
    for (let y = 0; y < layout.H; y++) {
      for (let x = 0; x < layout.W; x++) {
        if (occupied[y * layout.W + x]) continue
        const edge = x < 2 || y < 2 || x >= layout.W - 2 || y >= layout.H - 2
        const r = hash(x, y, 7)
        if (edge ? r < 0.85 : r < 0.05) tile(g, town, [16, 28, 16, 5, 27][Math.floor(hash(x, y, 8) * 5)], x * T, y * T)
      }
    }

    for (const [name, p] of layout.plots) this.drawPlot(g, name, p, this.scene.plots.get(name))
    this.drawHome(g, layout.home)
  }

  drawPond(g, r) {
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    const inPond = (x, y) => ((x + 0.5 - cx) / (r.w / 2)) ** 2 + ((y + 0.5 - cy) / (r.h / 2)) ** 2 < 1
    const cells = new Set()
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (inPond(x, y)) cells.add(y * 10000 + x)
    for (const k of cells) {
      const x = k % 10000
      const y = Math.floor(k / 10000)
      pondTile(g, x, y, (dx, dy) => cells.has((y + dy) * 10000 + x + dx))
      if (hash(x, y, 4) < 0.08) sprite(g, LILY, x * T + 4, y * T + 5)
    }
  }

  drawPaths(g, set, W) {
    const has = (x, y) => set.has(y * W + x)
    for (const i of set) {
      const x = i % W
      const y = (i - x) / W
      const px = x * T
      const py = y * T
      g.fillStyle = PAL.path
      g.fillRect(px, py, T, T)
      for (let k = 0; k < 4; k++) {
        g.fillStyle = k % 2 ? PAL.pathDark : PAL.pathLight
        g.fillRect(px + Math.floor(hash(x, y, k) * 14) + 1, py + Math.floor(hash(y, x, k) * 14) + 1, 2, 1)
      }
      g.fillStyle = PAL.pathEdge
      if (!has(x, y - 1)) g.fillRect(px, py, T, 1)
      if (!has(x, y + 1)) g.fillRect(px, py + T - 1, T, 1)
      if (!has(x - 1, y)) g.fillRect(px, py, 1, T)
      if (!has(x + 1, y)) g.fillRect(px + T - 1, py, 1, T)
      g.fillStyle = PAL.grass
      if (!has(x, y - 1) && !has(x - 1, y)) g.fillRect(px, py, 2, 2)
      if (!has(x, y - 1) && !has(x + 1, y)) g.fillRect(px + T - 2, py, 2, 2)
      if (!has(x, y + 1) && !has(x - 1, y)) g.fillRect(px, py + T - 2, 2, 2)
      if (!has(x, y + 1) && !has(x + 1, y)) g.fillRect(px + T - 2, py + T - 2, 2, 2)
    }
  }

  drawWater(g, set, paths, W) {
    // Two passes: every channel's dark lip first, then every channel's water. Done tile by
    // tile, each tile's lip was painted across the end of its neighbour's water and the channel
    // read as a dotted line.
    for (const pass of ['lip', 'water']) {
      for (const i of set) {
        const x = i % W
        const y = (i - x) / W
        canalTile(g, x * T, y * T, (dx, dy) => set.has((y + dy) * W + x + dx), pass)
      }
    }
    for (const i of set) {
      const x = i % W
      const y = (i - x) / W
      if (paths.has(i)) {
        // A track crossing a channel gets a little bridge.
        const across = paths.has(i - 1) || paths.has(i + 1)
        g.fillStyle = PAL.outline
        if (across) g.fillRect(x * T, y * T + 2, T, 12)
        else g.fillRect(x * T + 2, y * T, 12, T)
        g.fillStyle = PAL.wood
        for (let k = 0; k < 4; k++) {
          if (across) g.fillRect(x * T + k * 4, y * T + 3, 3, 10)
          else g.fillRect(x * T + 3, y * T + k * 4, 10, 3)
        }
        g.fillStyle = PAL.woodDark
        if (across) g.fillRect(x * T, y * T + 12, T, 1)
        else g.fillRect(x * T + 12, y * T, 1, T)
      }
    }
  }

  drawStones(g, set, W) {
    for (const i of set) {
      const x = i % W
      const y = (i - x) / W
      if ((x + y) % 2) continue
      tile(g, this.sheets.town, 43, x * T, y * T)
    }
  }

  drawPlot(g, name, p, model) {
    const town = this.sheets.town
    const farm = this.sheets.farm
    const x0 = p.x
    const y0 = p.y
    const ix = x0 + 1
    const iy = y0 + 1
    const iw = p.w - 2
    const ih = p.h - 2
    // A repo some terminal is using is a working field too, though nobody stands on it.
    const has = (model?.threads.length || 0) > 0 || Boolean(this.scene.repoWork?.has(name))

    if (model?.tabPlot) {
      // A terminal's plot is a field of its context window: dark, watered soil, planted per frame.
      for (let y = iy; y < iy + ih; y++) {
        for (let x = ix; x < ix + iw; x++) tile(g, farm, x === ix ? 48 : x === ix + iw - 1 ? 51 : (x + y) % 2 ? 49 : 50, x * T, y * T)
      }
      g.fillStyle = 'rgba(70,35,25,.2)'
      g.fillRect(ix * T, iy * T, iw * T, ih * T)
    } else if (p.land === 'shared') {
      // A storehouse: the building on the left, what it keeps on the right.
      yard(g, town, ix, iy, iw, ih)
      ;[[48, 49, 50], [76, 90, 79]].forEach((row, r) => row.forEach((id, c) => tile(g, town, id, (ix + c) * T, (iy + r) * T)))
      const goods = { skills: [[farm, 9], [farm, 21], [farm, 33], [farm, 45]], memory: [[farm, 85], [farm, 74], [farm, 85], [farm, 75]], tools: [[town, 115], [town, 128], [town, 127], [town, 116]] }[p.role] || [[farm, 85], [farm, 97], [farm, 85], [farm, 97]]
      goods.forEach(([sheet, id], k) => tile(g, sheet, id, (ix + 3 + (k % 2)) * T, (iy + Math.floor(k / 2)) * T))
    } else if (p.land === 'field') {
      const base = CROPS[strHash(name) % CROPS.length]
      for (let y = iy; y < iy + ih; y++) {
        for (let x = ix; x < ix + iw; x++) {
          const id = x === ix ? 48 : x === ix + iw - 1 ? 51 : (x + y) % 2 ? 49 : 50
          tile(g, farm, id, x * T, y * T)
          const stage = has ? (hash(x, y, 3) < 0.35 ? 1 : 2) : hash(x, y, 3) < 0.5 ? 0 : -1
          if (stage >= 0) tile(g, farm, base + stage, x * T, y * T)
        }
      }
    } else if (p.land === 'orchard') {
      const trees = [16, 15, 27]
      for (let i = 0; i < iw; i += 2) tile(g, i % 4 ? farm : town, i % 4 ? 78 : trees[(i / 2 + strHash(name)) % 3], (ix + i) * T, iy * T)
      for (let i = 1; i < iw; i += 2) if (hash(ix + i, iy) < 0.6) tile(g, farm, 83, (ix + i) * T, iy * T)
    } else if (p.land === 'market') {
      yard(g, town, ix, iy, iw, ih)
      const goods = [11, 23, 35, 47, 59, 71]
      for (let i = 0; i < iw; i++) tile(g, farm, goods[(i + strHash(name)) % goods.length], (ix + i) * T, iy * T)
    } else if (p.land === 'barn') {
      ;[[52, 53, 54], [72, 85, 75]].forEach((row, r) => row.forEach((id, c) => tile(g, town, id, (ix + c) * T, (iy + r) * T)))
      tile(g, farm, 96, (ix + 3) * T, iy * T)
      tile(g, farm, [121, 120, 122][strHash(name) % 3], (ix + 4) * T, iy * T)
      tile(g, farm, 110, (ix + 3) * T, (iy + 1) * T)
      tile(g, farm, 111, (ix + 4) * T, (iy + 1) * T)
    } else if (p.land === 'forge') {
      for (let y = iy; y < iy + ih; y++) for (let x = ix; x < ix + iw; x++) {
        g.fillStyle = (x + y) % 2 ? PAL.stone : PAL.stoneDark
        g.fillRect(x * T, y * T, T, T)
        g.fillStyle = PAL.stoneLine
        g.fillRect(x * T, y * T + T - 1, T, 1)
        g.fillRect(x * T + ((y % 2) ? 7 : 0), y * T, 1, T)
      }
      ;[[48, 49, 50], [76, 90, 79]].forEach((row, r) => row.forEach((id, c) => tile(g, town, id, (ix + c) * T, (iy + r) * T)))
      tile(g, town, 128, (ix + 3) * T, iy * T)
      tile(g, town, 115, (ix + 4) * T, iy * T)
      tile(g, farm, 85, (ix + 3) * T, (iy + 1) * T)
      tile(g, farm, 89, (ix + 4) * T, (iy + 1) * T)
    } else {
      g.fillStyle = 'rgba(30,70,40,.18)'
      g.fillRect(ix * T, iy * T, iw * T, ih * T)
      for (let i = 0; i < iw; i += 2) tile(g, town, [28, 16, 5][(i + strHash(name)) % 3], (ix + i) * T, iy * T)
      tile(g, town, 29, (ix + 1) * T, iy * T)
      tile(g, town, 29, (ix + 3) * T, (iy + ih - 1) * T)
    }

    // Fence, with a gate where the track leaves.
    const gate = gateOf(p, 'path').x
    for (let x = x0; x < x0 + p.w; x++) {
      const top = x === x0 ? 44 : x === x0 + p.w - 1 ? 46 : x % 2 ? 45 : 81
      const bottom = x === x0 ? 68 : x === x0 + p.w - 1 ? 70 : x === gate ? -1 : x % 2 ? 45 : 81
      tile(g, town, top, x * T, y0 * T)
      if (bottom >= 0) tile(g, town, bottom, x * T, (y0 + p.h - 1) * T)
    }
    for (let y = y0 + 1; y < y0 + p.h - 1; y++) {
      tile(g, town, 58, x0 * T, y * T)
      tile(g, town, 58, (x0 + p.w - 1) * T, y * T)
    }
  }

  drawHome(g, h) {
    const town = this.sheets.town
    const farm = this.sheets.farm
    yard(g, town, h.x, h.y, h.w, h.h)
    // The farmhouse: six wide, red roof, two windows and a door.
    const hx = h.x + 1
    const hy = h.y + 1
    const rows = [
      [52, 53, 53, 53, 53, 54],
      [64, 65, 65, 65, 65, 66],
      [72, 84, 73, 73, 84, 75],
      [72, 73, 86, 73, 73, 75],
    ]
    rows.forEach((row, r) => row.forEach((id, c) => tile(g, town, id, (hx + c) * T, (hy + r) * T)))
    if (this.scene.night || this.scene.dusk) {
      g.fillStyle = 'rgba(255,214,110,.75)'
      for (const c of [1, 4]) g.fillRect((hx + c) * T + 4, (hy + 2) * T + 4, 8, 7)
    }
    tile(g, town, 104, (hx + 8) * T, (hy + 1) * T)
    tile(g, town, 94, (hx + 10) * T, (hy + 1) * T)
    for (const [dx, dy] of [[7, 3], [11, 3], [-1, 3]]) tile(g, farm, 83, (hx + dx) * T, (hy + dy) * T)
    tile(g, farm, 97, (hx + 10) * T, (hy + 3) * T)
    this.mailbox = { x: (hx + 6) * T + 3, y: (hy + 3) * T - 4 }
    sprite(g, MAILBOX, this.mailbox.x, this.mailbox.y)
  }

  // ---------- per frame ----------
  frame() {
    if (!this.scene) return
    const now = performance.now()
    this.stepAnim(now)
    // Time, not frame count, drives the little animations, so the frame rate can change freely.
    this.tick = Math.floor(now / 125)
    const w = this.world.getContext('2d')
    w.imageSmoothingEnabled = false
    w.drawImage(this.base, 0, 0)
    this.hits = []
    const { layout } = this.scene

    if (this.scene.selectedPlot) this.drawSelection(w)
    this.drawFields(w, now)

    for (const [name, p] of layout.plots) {
      const model = this.scene.plots.get(name)
      if (model?.threads.length) this.drawHands(w, model.threads, slotsFor(p))
    }
    const h = layout.home
    const homeSlots = []
    for (const r of [6, 8]) for (const c of [1, 3, 5, 7, 9, 11, 13]) homeSlots.push([h.x + c, h.y + r])
    for (const c of [1, 3, 5, 7, 9, 11, 13]) homeSlots.push([h.x + c, h.y + 7])
    this.drawHands(w, this.scene.home.threads, homeSlots)
    this.drawRepoWork(w, now)
    this.drawBoards(w)
    this.drawCouriers(w, now)
    this.drawTractors(w, now)

    // Mailbox flag: up while anything is waiting on you.
    if (this.scene.waiting > 0 && this.mailbox) {
      sprite(w, FLAG, this.mailbox.x + 9, this.mailbox.y - 6)
      sprite(w, BUBBLE_WAIT, this.mailbox.x - 2, this.mailbox.y - 20 - (this.tick % 8 < 4 ? 0 : 1))
    }
    if (this.mailbox) this.hits.push({ kind: 'mailbox', x: this.mailbox.x - 4, y: this.mailbox.y - 22, w: 22, h: 40 })

    this.light(w)

    const c = this.ctx
    c.imageSmoothingEnabled = false
    c.fillStyle = PAL.outline
    c.fillRect(0, 0, this.canvas.width, this.canvas.height)
    const s = this.scale
    c.imageSmoothingEnabled = s < 1
    c.drawImage(this.world, Math.round(-this.cam.x * s), Math.round(-this.cam.y * s), Math.round(layout.W * T * s), Math.round(layout.H * T * s))
    this.drawOverlay(c)
  }

  /**
   * The active zone's fields: a terminal's context window as a crop. Every 5 % plants one more
   * square, the oldest squares ripest; past 80 % a red flag says a compaction is near. Each
   * compaction so far is a crate of the harvest beside the field — a gear on it when Claude Code
   * compacted on its own, a hand when somebody typed /compact — and when a new one lands, the
   * crop flies into it, once.
   */
  drawFields(w, now) {
    const farm = this.sheets.farm
    const { layout, plots } = this.scene
    this.fieldsDrawn = []
    this.seenCompacts ||= new Map()
    this.harvests ||= new Map()
    for (const [name, p] of layout.plots) {
      const m = plots.get(name)
      if (!m?.tabPlot) continue
      const ix = p.x + 1
      const iy = p.y + 1
      const iw = p.w - 2
      const ih = p.h - 2
      const base = CROPS[m.crop % CROPS.length]
      const pct = m.contextPct
      if (pct != null) {
        const planted = Math.max(0, Math.min(iw * ih, Math.ceil(pct / 5)))
        for (let i = 0; i < planted; i++) {
          const age = pct - 5 * i
          tile(w, farm, base + (age < 15 ? 0 : age < 35 ? 1 : 2), (ix + (i % iw)) * T, (iy + Math.floor(i / iw)) * T)
        }
        if (pct >= FLAG_AT) {
          const fx = (p.x + p.w - 1) * T + 3
          const fy = p.y * T - 9
          sprite(w, FLAG, fx, fy)
          this.hits.push({ kind: 'flag', name, x: fx - 2, y: fy - 2, w: 10, h: 14 })
        }
      }
      const count = m.compacts?.count || 0
      const seen = this.seenCompacts.get(name)
      if (seen != null && count > seen) this.harvests.set(name, now)
      this.seenCompacts.set(name, count)
      const shown = Math.min(count, 4)
      const list = m.compacts?.list || []
      const cx = (p.x - 1) * T
      for (let k = 0; k < shown; k++) {
        const cy = (p.y + p.h - 1 - k) * T - 2
        tile(w, farm, CRATES[m.crop % CRATES.length], cx, cy)
        const entry = list[list.length - shown + k]
        sprite(w, entry?.trigger === 'manual' ? BADGE_HAND : BADGE_GEAR, cx + 8, cy - 3)
      }
      const topY = (p.y + p.h - shown) * T - 2
      if (count) this.hits.push({ kind: 'crates', name, x: cx - 2, y: topY - 4, w: 22, h: shown * T + 6 })
      this.fieldsDrawn.push({ name, x: cx + 8, y: topY - 4, count, pct, flag: pct != null && pct >= FLAG_AT, fx: (p.x + p.w) * T, fy: p.y * T - 10 })
      // The harvest itself: the crop arcs from the field into the new crate, then a sparkle.
      const t0 = this.harvests.get(name)
      if (t0 != null) {
        const k = (now - t0) / 1800
        if (k >= 1) this.harvests.delete(name)
        else {
          const tx = cx + 2
          const ty = topY - 6
          for (let j = 0; j < 6; j++) {
            const s = Math.min(1, Math.max(0, k * 1.6 - j * 0.1))
            if (s <= 0 || s >= 1) continue
            const sx = (ix + (j % iw) + 0.5) * T - 8
            const sy = (iy + Math.floor(j / iw) + 0.5) * T - 8
            const x = sx + (tx - sx) * s
            const y = sy + (ty - sy) * s - Math.sin(s * Math.PI) * 26
            tile(w, farm, base + 4, x, y)
          }
          if (k > 0.55) sprite(w, SPARKLE, cx + 3, topY - 14 - Math.round((k - 0.55) * 10))
        }
      }
    }
  }

  /**
   * Notice boards: the rule files each terminal was actually given (its transcript says which),
   * on a board beside its plot; the global ones on the big board in the farmhouse yard.
   */
  drawBoards(w) {
    this.boards = []
    const { layout, plots } = this.scene
    for (const [name, p] of layout.plots) {
      const m = plots.get(name)
      if (!m?.tabPlot || !m.rules?.length) continue
      const x = (p.x + p.w) * T
      const y = (p.y + p.h - 2) * T - 2
      w.fillStyle = 'rgba(40,20,30,.22)'
      w.fillRect(x + 2, y + 16, 12, 3)
      w.drawImage(this.spriteImg(BOARD, 'board'), x, y)
      this.hits.push({ kind: 'board', name, x: x - 2, y: y - 4, w: 20, h: 24 })
      this.boards.push({ x: x + 8, y, name, count: m.rules.filter((r) => r.kind !== 'AutoMem').length })
    }
    const global = this.scene.globalRules || []
    if (global.length) {
      const h = layout.home
      const x = (h.x + 9) * T + 2
      const y = (h.y + 4) * T + 10
      w.fillStyle = 'rgba(40,20,30,.22)'
      w.fillRect(x + 2, y + 16, 22, 3)
      w.drawImage(this.spriteImg(BOARD_BIG, 'boardBig'), x, y)
      this.hits.push({ kind: 'board', home: true, x: x - 2, y: y - 4, w: 30, h: 24 })
      this.boards.push({ x: x + 13, y, home: true, count: global.length })
    }
  }

  /**
   * Helpers in the repos a terminal is using — the one it works in and the ones it brought in: one
   * per terminal, wearing that terminal's colour, walking the rows while it works and standing by
   * while it does not.
   */
  drawRepoWork(w, now) {
    const { layout, repoWork } = this.scene
    if (!repoWork) return
    for (const [name, works] of repoWork) {
      const p = layout.plots.get(name)
      if (!p) continue
      // Below whatever is built on the plot; fields have nothing built, so two rows to use.
      const rows = ['barn', 'forge', 'shared'].includes(p.land) ? [3, 3, 3] : [2, 3, 2]
      works.slice(0, 3).forEach((wk, k) => {
        const x0 = (p.x + 1) * T
        const span = (p.w - 3) * T + 4
        let x = x0 + span * [0.5, 0.1, 0.9][k]
        let flip = false
        let step = 0
        if (wk.working) {
          // Fourteen art pixels a second, there and back, each helper at its own point of the walk.
          const period = (span / 14) * 2
          const ph = ((now / 1000 + (strHash(name + wk.plot) % 50) / 7 + k * period * 0.37) % period) / period
          const out = ph < 0.5
          x = x0 + span * (out ? ph * 2 : (1 - ph) * 2)
          flip = !out
          step = Math.floor(now / 170) % 2
        }
        const y = (p.y + rows[k]) * T - 3
        const color = wk.color
        const def = tinted(HELPER[step], { c: color, C: shade(color, -0.3) })
        w.fillStyle = 'rgba(40,20,30,.22)'
        w.fillRect(Math.round(x) + 2, y + 13, 9, 3)
        w.drawImage(this.spriteImg(def, `helper${step}${color}`, flip), Math.round(x), y)
        this.hits.push({ kind: 'helper', name, work: wk, x: Math.round(x) - 1, y: y - 2, w: 14, h: 18 })
      })
    }
  }

  /**
   * A tractor for every repo a terminal brought in, painted that terminal's colour: while the
   * terminal works it hauls a crate from the repo to the terminal's plot and goes back for more;
   * while it does not, it stands parked in the repo's plot.
   */
  drawTractors(w, now) {
    this.tractorsDrawn = []
    const { layout } = this.scene
    const parked = new Map()
    for (const tr of this.scene.tractors || []) {
      const p = layout.plots.get(tr.from)
      if (!p) continue
      const cells = tr.cells
      const color = tr.color
      const tint = { r: color, R: shade(color, -0.3), f: shade(color, -0.3), l: shade(color, 0.35) }
      let x
      let y
      let flip = false
      let loaded = false
      let moving = false
      if (tr.working && cells && cells.length > 1) {
        const L = cells.length - 1
        // A little quicker than a courier on foot.
        const seconds = L / 3
        const ph = ((now / 1000 + (strHash(tr.key) % 97) / 7) % (seconds * 2)) / (seconds * 2)
        loaded = ph < 0.5
        const f = (loaded ? ph * 2 : (1 - ph) * 2) * L
        const i = Math.min(L - 1, Math.floor(f))
        const k = f - i
        const dir = loaded ? 1 : -1
        const dx = (cells[i + 1][0] - cells[i][0]) * dir
        flip = (dx || (cells[L][0] - cells[0][0]) * dir) < 0
        x = (cells[i][0] + (cells[i + 1][0] - cells[i][0]) * k) * T - 3
        y = (cells[i][1] + (cells[i + 1][1] - cells[i][1]) * k) * T - 9
        moving = true
      } else {
        const n = parked.get(tr.from) || 0
        parked.set(tr.from, n + 1)
        x = (p.x + p.w - 1) * T - 23 - n * 25
        y = (p.y + p.h - 2) * T - 1
      }
      x = Math.round(x)
      y = Math.round(y)
      const bump = moving && Math.floor(now / 140) % 2 ? -1 : 0
      w.fillStyle = 'rgba(40,20,30,.22)'
      w.fillRect(x + 2, y + 14, 18, 3)
      if (moving) {
        // The trailer rides behind: to the left facing right, to the right facing left.
        const trailer = loaded ? tinted(TRAILER_FULL, { L: color }) : TRAILER_EMPTY
        const tx = flip ? x + 21 : x - 12
        w.fillRect(tx + 2, y + 14, 9, 3)
        w.drawImage(this.spriteImg(trailer, `trailer${loaded ? color : ''}`, flip), tx, y + 4)
      }
      w.drawImage(this.spriteImg(tinted(TRACTOR, tint), `tractor${color}`, flip), x, y + bump)
      if (moving) {
        // Puffs from the exhaust, rising and fading.
        const ex = flip ? x + 6 : x + 15
        for (let j = 0; j < 2; j++) {
          const t = ((now / 700 + j * 0.5) % 1)
          w.fillStyle = `rgba(230,230,235,${0.75 * (1 - t)})`
          const r = 2 + Math.round(t * 2)
          w.fillRect(ex - r / 2 + Math.round((flip ? 1 : -1) * t * 4), y - 2 - Math.round(t * 9), r, r)
        }
      }
      this.hits.push({ kind: 'tractor', tractor: tr, x: x - 1, y: y - 1, w: 24, h: 18 })
      this.tractorsDrawn.push({ x: x + 11, y, tr, moving, loaded })
    }
  }

  /**
   * Couriers walk the tracks between a session's plot and whatever it just reached into — a
   * skill, the memory repo, another repo's file — out with a parcel and back without one.
   */
  drawCouriers(w, now) {
    this.couriers = []
    const farm = this.sheets.farm
    for (const trip of this.scene.trips || []) {
      const cells = trip.cells
      if (!cells || cells.length < 2) continue
      const L = cells.length - 1
      const seconds = L / 2.2
      const phase = ((now / 1000 + (strHash(trip.key) % 97) / 7) % (seconds * 2)) / (seconds * 2)
      const going = phase < 0.5
      const f = (going ? phase * 2 : (1 - phase) * 2) * L
      const i = Math.min(L - 1, Math.floor(f))
      const k = f - i
      const x = (cells[i][0] + (cells[i + 1][0] - cells[i][0]) * k) * T
      const y = (cells[i][1] + (cells[i + 1][1] - cells[i][1]) * k) * T - 6
      const step = Math.floor(now / 160) % 2
      w.fillStyle = 'rgba(40,20,30,.22)'
      w.fillRect(x + 3, y + 14, 10, 3)
      tile(w, farm, 108, x, y - step)
      if (going) {
        const color = KIND_COLOR[trip.kind] || PAL.wood
        w.fillStyle = PAL.outline
        w.fillRect(x + 3, y - 7 - step, 10, 8)
        w.fillStyle = color
        w.fillRect(x + 4, y - 6 - step, 8, 6)
        w.fillStyle = 'rgba(255,255,255,.55)'
        w.fillRect(x + 5, y - 5 - step, 3, 1)
      }
      this.couriers.push({ x: x + 8, y: y - 8, trip, going })
    }
  }

  /**
   * Text drawn on the screen canvas rather than into the art, so names and tags stay the same
   * readable size at every zoom.
   */
  drawOverlay(c) {
    const dpr = this.dpr
    const { layout, plots, home } = this.scene
    const at = (wx, wy) => {
      const p = this.toScreen(wx, wy)
      return { x: p.x * dpr, y: p.y * dpr }
    }
    const onScreen = (p) => p.x > -300 * dpr && p.y > -60 * dpr && p.x < this.canvas.width + 300 * dpr && p.y < this.canvas.height + 60 * dpr
    const px = (n) => n * dpr

    for (const z of layout.zones) {
      const p = at(z.x * T, z.y * T + 4)
      if (onScreen(p)) plate(c, p.x, p.y, ZONE_TEXT[z.land], { size: px(13), bold: true, bg: z.land === 'active' ? '#2f6f3a' : z.land === 'shared' ? '#2f4f8f' : PAL.woodDark, fg: '#fff6dc', pad: px(7) })
    }
    const z = this.scale / dpr
    const zoomFont = Math.max(10, Math.min(15, 9 + z * 1.6))
    const tagFont = Math.max(10, Math.min(13, 8.5 + z * 1.3))
    const infoFont = Math.max(9, Math.min(12, 7.5 + z * 1.3))
    // Close up, each farmhand gets its own tag. Further out the tags would sit on the plot names,
    // so the plot's name plate carries the summary instead.
    const close = this.scale / dpr >= 1.6
    const nameBoxes = []
    for (const [name, p] of layout.plots) {
      const model = plots.get(name)
      const n = model?.threads.length || 0
      const busy = model?.threads.filter((t) => t.status === 'working' && !t.parentId).length || 0
      const waiting = model?.threads.filter((t) => t.status === 'waiting').length || 0
      const pos = at((p.x + p.w / 2) * T, p.y * T + 2)
      if (!onScreen(pos)) continue
      // A plate may be as wide as its plot and the lane beside it, never wider — neighbours'
      // names used to run into each other at overview zoom.
      const maxW = Math.max(px(70), (p.w + 1.6) * T * this.scale)
      const bold = Boolean(p.active)
      const font = `${bold ? 'bold ' : ''}${Math.round(px(zoomFont))}px ${bold ? '"Galmuri11 Bold", Galmuri11' : 'Galmuri11'}, sans-serif`
      const tabs = (model?.threads || []).map(tabLabel).filter(Boolean).join('·')
      const full = close
        ? (n ? ` · ${n}` : '')
        : [tabs, busy && `작업 중 ${busy}`, waiting && `내 차례 ${waiting}`].filter(Boolean).map((x) => ` · ${x}`).join('')
      c.font = font
      const summary = c.measureText(`${name}${full}`).width + px(30) <= maxW ? full : ''
      const role = p.role ? `${SHARED_ROLE[p.role]} · ` : ''
      // A tab's plot: the tab on top, the repo it works in on a small sign by the gate.
      const label = model?.tabPlot ? model.short : name
      // A repo some terminal is using lights up like the plots in the active zone.
      const works = this.scene.repoWork?.get(name)
      const lit = Boolean(p.active || works)
      const busyHere = busy || works?.some((wk) => wk.working)
      // Which terminals a repo is working for: 📍 the one running in it, 🚜 the ones that brought
      // it in. Kept whole when the plate is too narrow — the name gives way instead.
      const tail = works ? ` · ${works.map((wk) => `${wk.role === 'home' ? '📍' : '🚜'}${wk.tabName}`).join(' ')}` : ''
      const nameBox = plate(c, pos.x, pos.y, `${role}${label}${model?.tabPlot || works ? '' : summary}`, {
        size: px(zoomFont),
        bold: lit,
        center: true,
        bg: p.role ? '#cfe0ff' : lit ? '#fff1c4' : n ? PAL.wood : '#d9b48a',
        fg: PAL.outline,
        maxW: works ? Math.max(maxW, px(200)) : maxW,
        chip: model?.tabPlot ? model.color : works?.[0].color || null,
        dot: busyHere ? '#38a838' : waiting ? '#e0433a' : null,
        blink: Boolean(busyHere),
        pad: px(6),
        tail,
      })
      if (nameBox) nameBoxes.push(nameBox)
      if (model?.tabPlot) {
        const signSize = px(Math.max(9, zoomFont - 2))
        const gate = at((p.x + p.w / 2) * T, (p.y + p.h) * T - 3)
        const repoBox = plate(c, gate.x, gate.y, `📍 ${model.repoLabel}`, { size: signSize, center: true, bg: '#efe6cf', fg: PAL.outline, pad: px(4), maxW, alpha: 0.95 })
        if (repoBox) nameBoxes.push(repoBox)
        // The repos it brought in, each with a tractor working for it, on a sign just above.
        if (model.uses?.length && repoBox) {
          const usesBox = plate(c, gate.x, repoBox.y - px(3), `🚜 ${model.uses.map((u) => u.repo).join(' · ')}`, { size: signSize, center: true, bold: true, bg: '#fffbea', fg: PAL.outline, pad: px(4), maxW: close ? Math.max(maxW, px(240)) : maxW, chip: model.color, alpha: 0.95 })
          if (usesBox) nameBoxes.push(usesBox)
        }
      }
    }
    const hp = at(layout.home.x * T + 2, layout.home.y * T - 4)
    if (onScreen(hp)) plate(c, hp.x, hp.y, `${this.scene.homeLabel || '농가'}${home.threads.length ? ` · ${home.threads.length}` : ''}`, { size: px(13), bold: true, bg: PAL.woodDark, fg: '#fff6dc', pad: px(7) })

    // Farmhands' tags: what each terminal is doing, then what it runs on. Two terminals in one
    // plot stand close together, so a tag that would land on another steps up or down instead.
    const nowMs = Date.now()
    // Plot names are already on the screen; tags step around them too.
    const placed = [...nameBoxes]
    const overlaps = (r) => placed.some((q) => r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h)
    for (const h of this.hits) {
      if (h.kind !== 'thread' || h.thread.parentId) continue
      const t = h.thread
      const full = statusTag(t, nowMs, this.scene.deadlines?.[t.id])
      if (!full) continue
      // Every farmhand is named at every zoom — from far out, just "탭3 테스트" in its status
      // colour; close up, the full tag and the line of what it runs on. Hiding them when zoomed
      // out left five terminals looking like four plots.
      // On its own tab plot the plot already says which tab it is; the tag just says what it is doing.
      const name = t.tabPlot ? '' : [tabLabel(t), shortName(t.terminal?.tab?.title || t.terminal?.name || '')].filter(Boolean).join(' ')
      const word = { working: '작업 중', waiting: '내 차례', blocked: '오류', idle: '쉬는 중' }[t.status] || ''
      const tag = close ? full : { ...full, text: name || word }
      const p = at(h.x + 9, h.y + 6)
      if (!onScreen(p)) continue
      // What it runs on — model, effort, mode, context — in full close up, as icons further out.
      let info = close ? statsLine(t) : compactStats(t)
      const tagOpts = { size: px(close ? tagFont : 10), bold: true, center: true, bg: tag.bg, fg: tag.fg, pad: px(close ? 5 : 4), dot: tag.dot, blink: tag.blink, maxW: px(280) }
      const infoOpts = { size: px(close ? infoFont : 10), center: true, bg: '#fffbea', fg: PAL.outline, pad: px(4), dot: contextColor(t.terminal?.stats?.contextPct), maxW: px(380), alpha: 0.95 }
      const a = measurePlate(c, tag.text, tagOpts)
      const gap = px(t.activity?.tasks ? 9 : 3)
      const fit = (withInfo) => {
        const b = withInfo ? measurePlate(c, info, infoOpts) : { w: 0, h: 0 }
        const blockW = Math.max(a.w, b.w)
        const blockH = a.h + (withInfo ? gap + b.h : 0)
        for (const k of [0, -1, 1, -2, 2, -3, 3]) {
          const r = { x: p.x - blockW / 2, y: p.y - a.h + k * (blockH + px(4)), w: blockW, h: blockH }
          if (!overlaps(r)) return { r, dy: k * (blockH + px(4)), b }
        }
        return null
      }
      // Close up the info line always shows; far out only where it has room.
      let spot = info ? fit(true) : null
      if (!spot && info && !close) info = ''
      if (!spot) spot = fit(Boolean(info)) || { r: { x: p.x - a.w / 2, y: p.y - a.h, w: a.w, h: a.h }, dy: 0, b: info ? measurePlate(c, info, infoOpts) : { w: 0, h: 0 } }
      const { dy, b } = spot
      placed.push(spot.r)
      const box = plate(c, p.x, p.y + dy, tag.text, tagOpts)
      if (info) plate(c, p.x, box.y + box.h + gap + b.h, info, infoOpts)
      if (t.activity?.tasks && box) {
        const { done, total } = t.activity.tasks
        c.fillStyle = PAL.outline
        c.fillRect(box.x, box.y + box.h + px(1), box.w, px(5))
        c.fillStyle = '#fff6dc'
        c.fillRect(box.x + px(1), box.y + box.h + px(2), box.w - px(2), px(3))
        c.fillStyle = '#38a838'
        c.fillRect(box.x + px(1), box.y + box.h + px(2), Math.round((box.w - px(2)) * (done / Math.max(1, total))), px(3))
      }
    }
    // Where each courier is headed, in plain words: out to the repo it is fetching from or
    // delivering to, then back to the plot that sent it.
    const placeName = (n) => (n === '__home' ? '농가' : layout.plots.get(n)?.role ? SHARED_ROLE[layout.plots.get(n).role] : plots.get(n)?.short || n)
    for (const k of this.couriers || []) {
      const p = at(k.x, k.y)
      if (!onScreen(p)) continue
      // A fetch (skill, memory, a file, a tool) walks empty to the store and back with the parcel;
      // a delivery (an edit elsewhere) walks out with it and comes home empty.
      const fetch = k.trip.kind !== 'edit'
      const text = k.going ? `→ ${placeName(k.trip.to)} · ${k.trip.label}` : `→ ${placeName(k.trip.from)} · ${fetch ? '가지러 가는 길' : '돌아가는 길'}`
      plate(c, p.x, p.y - px(14), text, { size: px(11), bold: k.going, center: true, bg: k.going ? '#fffbea' : '#efe6cf', fg: PAL.outline, pad: px(4), dot: KIND_COLOR[k.trip.kind], maxW: px(280), alpha: k.going ? 0.95 : 0.8 })
    }
    // A field's harvest so far, and its flag when a compaction is near.
    for (const f of this.fieldsDrawn || []) {
      if (f.count) {
        const p = at(f.x, f.y)
        if (onScreen(p)) {
          const text = `🧺 ${f.count}`
          const opts = { size: px(10), bold: true, center: true, bg: '#fffbea', fg: PAL.outline, pad: px(3), alpha: 0.95 }
          const m = measurePlate(c, text, opts)
          const r = { x: p.x - m.w / 2, y: p.y - m.h, w: m.w, h: m.h }
          if (!overlaps(r)) {
            placed.push(r)
            plate(c, p.x, p.y, text, opts)
          }
        }
      }
      if (f.flag && close) {
        const p = at(f.fx + 2, f.fy + 6)
        const opts = { size: px(10), bold: true, bg: '#e0433a', fg: '#ffffff', pad: px(3), alpha: 0.95 }
        const m = measurePlate(c, '곧 압축', opts)
        const r = { x: p.x, y: p.y - m.h, w: m.w, h: m.h }
        if (onScreen(p) && !overlaps(r)) {
          placed.push(r)
          plate(c, p.x, p.y, '곧 압축', opts)
        }
      }
    }
    // Each board says how many rule files are pinned to it.
    for (const b of this.boards || []) {
      const p = at(b.x, b.y - 1)
      if (!onScreen(p)) continue
      const text = b.home ? `📜 전역 규칙 ${b.count}` : `📜 ${b.count}`
      const opts = { size: px(10), bold: true, center: true, bg: '#fffbea', fg: PAL.outline, pad: px(3), alpha: 0.95 }
      const m = measurePlate(c, text, opts)
      const r = { x: p.x - m.w / 2, y: p.y - m.h, w: m.w, h: m.h }
      if (!b.home && overlaps(r)) continue
      placed.push(r)
      plate(c, p.x, p.y, text, opts)
    }
    // Tractors on the road say what they haul and for whom; parked ones are named by their plot's sign.
    for (const k of this.tractorsDrawn || []) {
      if (!k.moving) continue
      const p = at(k.x, k.y)
      if (!onScreen(p)) continue
      const text = k.loaded ? `🚜 ${k.tr.repo} → ${k.tr.tabName}` : `🚜 ${k.tr.repo}로 가지러`
      const opts = { size: px(10.5), bold: k.loaded, center: true, bg: '#fffbea', fg: PAL.outline, pad: px(4), chip: k.tr.color, maxW: px(260), alpha: k.loaded ? 0.95 : 0.8 }
      const m = measurePlate(c, text, opts)
      const r = { x: p.x - m.w / 2, y: p.y - px(6) - m.h, w: m.w, h: m.h }
      if (overlaps(r)) continue
      placed.push(r)
      plate(c, p.x, p.y - px(6), text, opts)
    }
    if (this.tour?.rect) this.drawSpotlight(c, at, px)
  }

  /** The tour's spotlight: everything but the rectangle it is talking about goes dim. */
  drawSpotlight(c, at, px) {
    const r = this.tour.rect
    const a = at((r.x - 0.4) * T, (r.y - 0.9) * T)
    const b = at((r.x + r.w + 0.4) * T, (r.y + r.h + 0.4) * T)
    const W = this.canvas.width
    const H = this.canvas.height
    const rad = px(14)
    c.save()
    c.beginPath()
    c.rect(0, 0, W, H)
    c.roundRect(a.x, a.y, b.x - a.x, b.y - a.y, rad)
    c.fillStyle = 'rgba(20,12,18,.45)'
    c.fill('evenodd')
    const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 260)
    c.lineWidth = px(4)
    c.strokeStyle = `rgba(255,225,77,${0.6 + 0.4 * pulse})`
    c.beginPath()
    c.roundRect(a.x, a.y, b.x - a.x, b.y - a.y, rad)
    c.stroke()
    c.restore()
  }

  drawHands(w, threads, slots) {
    const farm = this.sheets.farm
    threads.forEach((t, k) => {
      const [sx, sy] = slots[k % slots.length]
      const x = sx * T
      const y = sy * T - 4
      const sel = this.scene.selectedThread === t.id
      w.fillStyle = 'rgba(40,20,30,.22)'
      w.fillRect(x + 3, y + 14, 10, 3)
      if (t.parentId) {
        tile(w, farm, 122, x, y + 2)
      } else {
        tile(w, farm, t.harness === 'codex' ? 108 : 109, x, y)
      }
      if (t.status === 'working' && !t.parentId) {
        const up = (this.tick + strHash(t.id)) % 6 < 3
        tile(w, farm, 86, x + 9, y + (up ? -5 : -2))
      }
      const bob = (this.tick + strHash(t.id)) % 10 < 5 ? 0 : -1
      if (t.status === 'waiting') sprite(w, BUBBLE_WAIT, x + 2, y - 14 + bob)
      if (t.status === 'blocked') sprite(w, BUBBLE_BLOCK, x + 2, y - 14 + bob)
      if (t.status === 'celebrating') sprite(w, SPARKLE, x + 3, y - 10 + bob)
      if (sel) {
        w.fillStyle = PAL.select
        w.fillRect(x + 6, y - 20 + bob, 4, 2)
        w.fillRect(x + 7, y - 18 + bob, 2, 2)
      }
      this.hits.push({ kind: 'thread', thread: t, x: x - 1, y: y - 14, w: 18, h: 32 })
    })
  }

  drawSelection(w) {
    const { layout, routes, selectedPlot, showLinks } = this.scene
    const p = layout.plots.get(selectedPlot)
    if (p) {
      w.strokeStyle = PAL.select
      w.lineWidth = 2
      w.setLineDash([4, 3])
      w.strokeRect(p.x * T - 3, p.y * T - 3, p.w * T + 6, p.h * T + 6)
      w.setLineDash([])
    }
    if (!routes || !showLinks) return
    for (const r of routes.routes) {
      if (r.from !== selectedPlot && r.to !== selectedPlot) continue
      w.strokeStyle = r.from === selectedPlot ? PAL.select : PAL.incoming
      w.lineWidth = 3
      w.setLineDash(r.weak ? [5, 4] : [])
      w.beginPath()
      r.cells.forEach(([x, y], k) => (k ? w.lineTo(x * T + 8, y * T + 8) : w.moveTo(x * T + 8, y * T + 8)))
      w.stroke()
      w.setLineDash([])
      const [ex, ey] = r.cells[r.cells.length - 1]
      w.fillStyle = w.strokeStyle
      w.fillRect(ex * T + 4, ey * T + 4, 8, 8)
    }
  }

  light(w) {
    const { night, dusk, layout } = this.scene
    if (!night && !dusk) return
    w.save()
    w.globalCompositeOperation = 'multiply'
    w.fillStyle = night ? '#9aa2d8' : '#f7dcbc'
    w.fillRect(0, 0, layout.W * T, layout.H * T)
    w.globalCompositeOperation = 'lighter'
    const h = layout.home
    for (const c of [1, 4]) {
      const x = (h.x + 1 + c) * T + 8
      const y = (h.y + 3) * T + 8
      const grad = w.createRadialGradient(x, y, 2, x, y, 40)
      grad.addColorStop(0, night ? 'rgba(255,200,110,.45)' : 'rgba(255,200,110,.2)')
      grad.addColorStop(1, 'rgba(255,200,110,0)')
      w.fillStyle = grad
      w.fillRect(x - 40, y - 40, 80, 80)
    }
    w.restore()
  }

  // ---------- picking ----------
  hitTest(cssX, cssY) {
    const p = this.toWorld(cssX, cssY)
    const hit = [...this.hits].reverse().find((h) => p.x >= h.x && p.x < h.x + h.w && p.y >= h.y && p.y < h.y + h.h)
    if (hit) return hit
    if (!this.scene) return null
    for (const [name, r] of this.scene.layout.plots) {
      if (p.x >= r.x * T && p.x < (r.x + r.w) * T && p.y >= r.y * T - 14 && p.y < (r.y + r.h) * T) return { kind: 'plot', name }
    }
    const h = this.scene.layout.home
    if (p.x >= h.x * T && p.x < (h.x + h.w) * T && p.y >= h.y * T && p.y < (h.y + h.h) * T) return { kind: 'home' }
    return null
  }

  /** Where a thread's farmhand stands, in tiles — for the journal's "take me there". */
  whereIs(id) {
    const { layout, plots, home } = this.scene
    for (const [name, p] of layout.plots) {
      const k = plots.get(name)?.threads.findIndex((t) => t.id === id) ?? -1
      if (k >= 0) {
        const [x, y] = slotsFor(p)[k % slotsFor(p).length]
        return { x, y, plot: name }
      }
    }
    const k = home.threads.findIndex((t) => t.id === id)
    if (k >= 0) return { x: layout.home.x + 1 + (k % 7) * 2, y: layout.home.y + [6, 8, 7][Math.floor(k / 7) % 3], plot: null }
    return null
  }
}

/** Which crop a plot shows depends on whether anyone is working it, so the base layer keys on it. */
function crop(model) {
  if (!model?.threads.length) return 0
  return model.threads.some((t) => t.status === 'working') ? 2 : 1
}

/** Where farmhands stand in a plot: rows below anything built on it, spread from the middle out. */
export function slotsFor(p) {
  const rows = p.land === 'field' ? [2, 4, 3, 1] : [3, 4, 2]
  const out = []
  for (const r of rows) for (const c of SLOT_COLS) if (c < p.w - 1 && r < p.h - 1) out.push([p.x + c, p.y + r])
  return out
}

const ZONE_TEXT = {
  active: '지금 일하는 땅',
  shared: '공용 창고 · 스킬·메모리·도구',
  field: '밭 · 강의·교육',
  orchard: '과수원 · 영상·이미지',
  market: '장터 · SNS·홍보·뉴스레터',
  barn: '헛간 · 업무 운영',
  forge: '대장간 · 도구·스킬',
  forest: '숲 · 실험·신사업',
}

function yard(g, town, x, y, w, h) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const top = yy === y
      const bottom = yy === y + h - 1
      const left = xx === x
      const right = xx === x + w - 1
      const id = top ? (left ? 12 : right ? 14 : 13) : bottom ? (left ? 36 : right ? 38 : 37) : left ? 24 : right ? 26 : 25
      tile(g, town, id, xx * T, yy * T)
    }
  }
}

function pondTile(g, x, y, has) {
  const px = x * T
  const py = y * T
  g.fillStyle = PAL.water
  g.fillRect(px, py, T, T)
  g.fillStyle = PAL.waterLight
  if (hash(x, y, 5) < 0.5) g.fillRect(px + 3 + Math.floor(hash(x, y, 6) * 6), py + 5, 4, 1)
  if (hash(x, y, 9) < 0.35) g.fillRect(px + 8, py + 11, 3, 1)
  g.fillStyle = PAL.waterDark
  if (!has(0, -1)) g.fillRect(px, py, T, 3)
  g.fillStyle = PAL.outline
  if (!has(0, -1)) g.fillRect(px, py, T, 1)
  if (!has(0, 1)) g.fillRect(px, py + T - 1, T, 1)
  if (!has(-1, 0)) g.fillRect(px, py, 1, T)
  if (!has(1, 0)) g.fillRect(px + T - 1, py, 1, T)
  g.fillStyle = PAL.grass
  if (!has(0, -1) && !has(-1, 0)) g.fillRect(px, py, 3, 3)
  if (!has(0, -1) && !has(1, 0)) g.fillRect(px + T - 3, py, 3, 3)
  if (!has(0, 1) && !has(-1, 0)) g.fillRect(px, py + T - 3, 3, 3)
  if (!has(0, 1) && !has(1, 0)) g.fillRect(px + T - 3, py + T - 3, 3, 3)
}

/**
 * An irrigation channel: eight pixels of water down the middle of the tile with a stone lip,
 * reaching out to whichever neighbours are channel too. Narrow on purpose — a full tile of
 * water per link turned the farm into a lake district.
 */
function canalTile(g, px, py, has, pass = 'both') {
  const a = 4
  const b = 12
  // [neighbour?, x, y, w, h] for the arm reaching that neighbour, and whether it runs across.
  const arms = [
    [has(0, -1), px + a, py, b - a, a, false],
    [has(0, 1), px + a, py + b, b - a, T - b, false],
    [has(-1, 0), px, py + a, a, b - a, true],
    [has(1, 0), px + b, py + a, T - b, b - a, true],
  ]
  if (pass !== 'water') {
    g.fillStyle = PAL.outline
    g.fillRect(px + a - 1, py + a - 1, b - a + 2, b - a + 2)
    for (const [on, x, y, w, h, across] of arms) if (on) g.fillRect(across ? x : x - 1, across ? y - 1 : y, across ? w : w + 2, across ? h + 2 : h)
  }
  if (pass !== 'lip') {
    g.fillStyle = PAL.water
    g.fillRect(px + a, py + a, b - a, b - a)
    for (const [on, x, y, w, h] of arms) if (on) g.fillRect(x, y, w, h)
    g.fillStyle = PAL.waterLight
    g.fillRect(px + a + 1, py + a + 1, 2, 1)
  }
}

const KIND_COLOR = { skill: '#5d8fd6', memory: '#f2c23b', read: '#9b7bd1', edit: '#e07a3c', run: '#7d8fb3' }

const mins = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000))
  return m < 60 ? `${m}분` : m < 1440 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${Math.floor(m / 1440)}일`
}

/** `D-3`, `오늘 마감`, `마감 지남` for a YYYY-MM-DD deadline, measured in calendar days. */
export function dday(deadline, now = Date.now()) {
  if (!deadline) return null
  const [y, m, d] = String(deadline).split('-').map(Number)
  if (!y || !m || !d) return null
  const today = new Date(now)
  const days = Math.round((new Date(y, m - 1, d) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 864e5)
  return { days, text: days > 0 ? `D-${days}` : days === 0 ? '오늘 마감' : `마감 ${-days}일 지남` }
}

/** What floats over a farmhand: working, your turn, error — plus its deadline when it has one. */
export function statusTag(t, now = Date.now(), deadline = null) {
  const dd = dday(deadline, now)
  const due = dd ? ` · ${dd.text}` : ''
  const since = t.terminal?.since || 0
  // "탭2 인스타그램 카드…" first, so a farmhand can be matched to the Terminal tab bar at a
  // glance — and a /rename shows up here as soon as the tab title changes.
  const tab = t.tabPlot ? '' : tabLabel(t)
  const name = t.tabPlot ? '' : shortName(t.terminal?.tab?.title || t.terminal?.name || '')
  const lead = [tab, name].filter(Boolean).join(' ') + (tab || name ? ' · ' : '')
  if (t.status === 'working') {
    const start = Math.max(t.activity?.turnStartedAt || 0, 0) || since
    return { text: `${lead}작업 중${start ? ` ${mins(now - start)}` : ''}${due}`, bg: '#3e8f3a', fg: '#ffffff', dot: '#b8f5a0', blink: true }
  }
  if (t.status === 'waiting') return { text: `${lead}내 차례${since ? ` · ${mins(now - since)}째` : ''}${due}`, bg: '#e0433a', fg: '#ffffff' }
  if (t.status === 'blocked') return { text: `${lead}오류${due}`, bg: '#7a1c22', fg: '#ffffff' }
  if (dd) return { text: `${lead}${dd.text}`, bg: dd.days < 0 ? '#7a1c22' : dd.days <= 1 ? '#f2a33a' : '#fff1c4', fg: dd.days <= 1 ? '#ffffff' : PAL.outline }
  if (t.terminal) return { text: `${lead}쉬는 중`, bg: '#e9dcc0', fg: PAL.outline }
  return null
}

const shortName = (s) => (s.length > 12 ? `${s.slice(0, 11)}…` : s)

/** Which farm animal does the work: the big model is the ox, the quick one the chick. */
const MODEL_ICON = [[/opus/i, '🐮'], [/sonnet/i, '🐑'], [/haiku/i, '🐤'], [/fable/i, '🦄']]
const EFFORT_STARS = { low: 1, medium: 2, high: 3, xhigh: 4, max: 5 }
const MODE_LABEL = { auto: '🤖 자동', plan: '📜 계획', acceptEdits: '✍️ 바로 수정', default: '🙋 물어봄', bypassPermissions: '⚡ 무제한', dontAsk: '🤐 안 물음' }

export const fmtTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n || 0))

/** Green under half, yellow to 80 %, red past it — the same steps the status line uses. */
export const contextColor = (pct) => (pct == null ? '#b9a98a' : pct >= 80 ? '#e0433a' : pct >= 50 ? '#f2a33a' : '#38a838')

/**
 * One line of what a terminal is running on: the model as a farm animal, effort as stars,
 * the permission mode, fast mode, and how full the context window is.
 */
export function statsLine(t) {
  const st = t.terminal?.stats
  if (!st) return ''
  const icon = (MODEL_ICON.find(([re]) => re.test(st.model || st.modelId || '')) || [, '🤖'])[1]
  const stars = EFFORT_STARS[st.effort] ? '★'.repeat(EFFORT_STARS[st.effort]) : ''
  const parts = [`${icon} ${st.model || '모델?'}`]
  if (stars) parts.push(`힘${stars}`)
  if (MODE_LABEL[st.permissionMode]) parts.push(MODE_LABEL[st.permissionMode])
  if (st.fast) parts.push('🏃 빠른 모드')
  if (st.contextTokens) parts.push(`🧠 ${st.contextPct != null ? `${st.contextPct}%` : '?%'} (${fmtTokens(st.contextTokens)})${st.estimated ? ' 추정' : ''}`)
  return parts.join(' · ')
}

const MODE_ICON = { auto: '🤖', plan: '📜', acceptEdits: '✍️', default: '🙋', bypassPermissions: '⚡', dontAsk: '🤐' }

/** The same line as icons, for when the farm is zoomed out: `🐮★★★★ 🤖 52%`. */
export function compactStats(t) {
  const st = t.terminal?.stats
  if (!st) return ''
  const icon = (MODEL_ICON.find(([re]) => re.test(st.model || st.modelId || '')) || [, '🤖'])[1]
  const stars = EFFORT_STARS[st.effort] ? '★'.repeat(EFFORT_STARS[st.effort]) : ''
  const mode = MODE_ICON[st.permissionMode] || ''
  const ctx = st.contextPct != null ? `${st.contextPct}%` : ''
  return [`${icon}${stars}`, mode, st.fast ? '🏃' : '', ctx].filter(Boolean).join(' ')
}

/** `탭2` for a session in the second tab of Terminal's tab bar; '' when that is not known. */
export const tabLabel = (t) => (t.terminal?.tab?.index ? `탭${t.terminal.tab.index}` : '')

/** The size `plate` would draw, without drawing it. */
function measurePlate(c, text, { size, bold = false, pad, maxW = Infinity, dot = null, chip = null }) {
  c.save()
  c.font = `${bold ? 'bold ' : ''}${Math.round(size)}px ${bold ? '"Galmuri11 Bold", Galmuri11' : 'Galmuri11'}, sans-serif`
  const dotW = (dot ? size * 0.9 : 0) + (chip ? size * 0.95 : 0)
  const w = Math.min(maxW, Math.ceil(c.measureText(text).width + pad * 2 + dotW))
  c.restore()
  return { w, h: Math.round(size + pad * 1.3) }
}

/**
 * A rounded label on the screen canvas. Sizes are device pixels. Returns its box, so a caller can
 * hang a progress bar under it.
 */
function plate(c, x, y, text, { size, bold = false, center = false, bg, fg, pad, maxW = Infinity, dot = null, blink = false, alpha = 1, chip = null, tail = '' }) {
  c.save()
  c.globalAlpha = alpha
  c.font = `${bold ? 'bold ' : ''}${Math.round(size)}px ${bold ? '"Galmuri11 Bold", Galmuri11' : 'Galmuri11'}, sans-serif`
  c.textBaseline = 'middle'
  let t = text
  // A square of the terminal's colour leads the text, then the status dot.
  const chipW = chip ? size * 0.95 : 0
  const dotW = (dot ? size * 0.9 : 0) + chipW
  while (c.measureText(t + tail).width + pad * 2 + dotW > maxW && t.length > 3) t = t.slice(0, -2) + '…'
  t += tail
  const w = Math.ceil(c.measureText(t).width + pad * 2 + dotW)
  const h = Math.round(size + pad * 1.3)
  const bx = Math.round(center ? x - w / 2 : x)
  const by = Math.round(y - h)
  const r = Math.min(h / 2.6, size * 0.45)
  c.beginPath()
  c.roundRect(bx, by, w, h, r)
  c.fillStyle = bg
  c.fill()
  c.lineWidth = Math.max(1, size / 9)
  c.strokeStyle = PAL.outline
  c.stroke()
  if (chip) {
    const q = size * 0.62
    c.beginPath()
    c.roundRect(bx + pad - size * 0.08, by + (h - q) / 2, q, q, q * 0.25)
    c.fillStyle = chip
    c.fill()
    c.lineWidth = Math.max(1, size / 12)
    c.strokeStyle = PAL.outline
    c.stroke()
  }
  if (dot) {
    const on = !blink || Math.floor(performance.now() / 500) % 2 === 0
    c.beginPath()
    c.arc(bx + pad + chipW + (dotW - chipW) * 0.35, by + h / 2, size * 0.26, 0, Math.PI * 2)
    c.fillStyle = on ? dot : 'rgba(255,255,255,.25)'
    c.fill()
  }
  c.fillStyle = fg
  c.fillText(t, bx + pad + dotW, by + h / 2 + size * 0.06)
  c.restore()
  return { x: bx, y: by, w, h }
}

