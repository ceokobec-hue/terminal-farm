/**
 * Which kind of land a plot is, and where every plot sits on the farm.
 *
 * Kinds follow what the work *is*, not what the repo is called: lessons are crops, video is an
 * orchard, the business system is the barn. A name is only a first guess — the person farming
 * can move a plot to another kind and that choice is kept in the colony file (`lands`).
 *
 * Layout is deterministic and deliberately ignores how busy a plot is. Every plot has the same
 * footprint and plots sort by name inside their zone, so a thread arriving or leaving never
 * reshuffles the farm under the cursor.
 */

export const LANDS = {
  shared: { label: '공용 창고', work: '스킬·메모리·도구' },
  field: { label: '밭', work: '강의·교육' },
  orchard: { label: '과수원', work: '영상·이미지' },
  market: { label: '장터', work: 'SNS·홍보·뉴스레터' },
  barn: { label: '헛간', work: '업무 운영' },
  forge: { label: '대장간', work: '도구·스킬' },
  forest: { label: '숲', work: '실험·신사업' },
}
export const LAND_ORDER = ['shared', 'field', 'orchard', 'market', 'barn', 'forge', 'forest']

/** What a shared plot is for, shown on its sign. */
export const SHARED_ROLE = { skills: '스킬 창고', memory: '메모리 창고', tools: '도구 창고' }

const GUESS = [
  ['orchard', /video|youtube|thumbnail|이미지|image|영상|사진/i],
  ['market', /sns|marketing|newsletter|메일|insta|thread|홍보/i],
  ['barn', /ops|archive|admin|업무|운영/i],
  ['forge', /tools|skills|memory|도구|스킬/i],
  ['field', /class|course|lecture|edu|cohort|live|academy|thinking|강의|수업|교육/i],
]

export function guessLand(name) {
  for (const [land, re] of GUESS) if (re.test(name)) return land
  return 'forest'
}

/**
 * A choice the person made wins; then the shared repos (skills, memory, tools) go to the shared
 * store; then the guess from the name.
 */
export const landOf = (name, overrides = {}, shared = new Map()) =>
  LANDS[overrides[name]] ? overrides[name] : shared.has(name) ? 'shared' : guessLand(name)

/** Plot footprint in tiles. Interior is 5 × 4; land with buildings or trees keeps its top row. */
export const PW = 7
export const PH = 6
const GAP = 2
const BANNER = 2

/**
 * Which zone sits where: three columns, the farmhouse and its pond in the middle one. The plots
 * somebody is working in right now come first, top left, whatever kind of land they are; the
 * shared store (skills, memory, tools) sits right under them, a short walk for the couriers —
 * the rest of the farm is where it is when nobody is.
 */
const COLUMNS = [
  ['active', 'shared', 'field', 'forge', 'barn'],
  ['home'],
  ['orchard', 'market', 'forest'],
]
const COLS_IN_ZONE = { active: 3, shared: 3, field: 4, orchard: 4, forge: 3, barn: 3, market: 3, forest: 3 }
const MARGIN = 3
const HOME_W = 15
const HOME_H = 10

/**
 * names → `{ W, H, plots: Map<name, {x,y,w,h,land}>, zones: [{land,x,y,w,h}], home, pond }`.
 * All in tiles.
 */
export function layoutFarm(names, overrides = {}, active = new Set(), shared = new Map(), rank = new Map()) {
  const byLand = new Map(['active', ...LAND_ORDER].map((l) => [l, []]))
  for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
    // The shared store keeps its place on the right even while somebody works in it — that is
    // where the couriers walk to.
    const land = landOf(name, overrides, shared)
    byLand.get(active.has(name) && land !== 'shared' ? 'active' : land).push(name)
  }
  // Active plots in the order given (tab-bar order), then by name.
  byLand.get('active').sort((a, b) => (rank.get(a) ?? 999) - (rank.get(b) ?? 999) || a.localeCompare(b))

  const zoneSize = (land) => {
    const n = byLand.get(land).length
    const cols = Math.max(1, Math.min(COLS_IN_ZONE[land], n))
    const rows = Math.max(1, Math.ceil(n / cols))
    return { cols, rows, w: cols * (PW + GAP) - GAP, h: BANNER + rows * (PH + GAP) - GAP, n }
  }

  const plots = new Map()
  const zones = []
  let x = MARGIN
  let home = null
  let pond = null
  let H = 0
  for (const column of COLUMNS) {
    let y = MARGIN
    let colW = 0
    for (const land of column) {
      if (land === 'home') {
        home = { x, y: y + 1, w: HOME_W, h: HOME_H }
        pond = { x: x + 2, y: home.y + HOME_H + 3, w: HOME_W - 4, h: 9 }
        y = pond.y + pond.h + GAP
        colW = Math.max(colW, HOME_W)
        continue
      }
      const z = zoneSize(land)
      if (!z.n) continue
      zones.push({ land, x, y, w: z.w, h: z.h })
      byLand.get(land).forEach((name, i) => {
        plots.set(name, { x: x + (i % z.cols) * (PW + GAP), y: y + BANNER + Math.floor(i / z.cols) * (PH + GAP), w: PW, h: PH, land: land === 'active' ? landOf(name, overrides, shared) : land, active: land === 'active', role: shared.get(name) || null })
      })
      y += z.h + GAP + 1
      colW = Math.max(colW, z.w)
    }
    H = Math.max(H, y)
    x += colW + GAP + 2
  }
  return { W: x - GAP - 2 + MARGIN, H: H + MARGIN - 1, plots, zones, home, pond }
}
