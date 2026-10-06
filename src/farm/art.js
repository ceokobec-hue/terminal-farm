/**
 * The farm's palette, tile lookup and the handful of sprites drawn in code.
 *
 * Colours are sampled from Kenney's Tiny Town / Tiny Farm so anything drawn here sits in the
 * same world as the tiles: the same dark plum outline, the same grass and path.
 */

export const T = 16

export const PAL = {
  outline: '#3f2631',
  grass: '#84c669',
  path: '#eaa56c',
  pathLight: '#f4c08d',
  pathDark: '#d08b55',
  pathEdge: '#c47a45',
  water: '#5fb6e6',
  waterLight: '#c6edff',
  waterDark: '#3f93cf',
  wood: '#e7a35f',
  woodLight: '#f6c891',
  woodDark: '#b9693a',
  stone: '#c4c9d6',
  stoneDark: '#b6bccb',
  stoneLine: '#9aa1b4',
  paper: '#fbe7b9',
  select: '#ffe14d',
  incoming: '#ff8ad8',
}

/** Kenney's packed tilemaps: 12 tiles across, 16 px each, no spacing. */
export function tile(ctx, sheet, id, x, y) {
  ctx.drawImage(sheet, (id % 12) * T, Math.floor(id / 12) * T, T, T, Math.round(x), Math.round(y), T, T)
}

/** A sprite written as rows of palette letters; '.' is transparent. */
export function sprite(ctx, def, x, y, scale = 1) {
  def.rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const c = def.pal[row[i]]
      if (!c) continue
      ctx.fillStyle = c
      ctx.fillRect(Math.round(x) + i * scale, Math.round(y) + j * scale, scale, scale)
    }
  })
}

const O = PAL.outline

export const BUBBLE_WAIT = {
  pal: { o: O, w: '#fffbea', s: '#e9dcc0', r: '#e0433a' },
  rows: [
    '.ooooooooo.',
    'owwwwwwwwwo',
    'owwwwrwwwwo',
    'owwwwrwwwwo',
    'owwwwrwwwwo',
    'owwwwrwwwwo',
    'owwwwwwwwwo',
    'owwwwrwwwwo',
    'ossssssssso',
    '.oooo.oooo.',
    '.....o.....',
  ],
}

export const BUBBLE_BLOCK = {
  pal: { o: O, w: '#ffe3de', s: '#f0c3bb', r: '#9b1e2a' },
  rows: [
    '.ooooooooo.',
    'owwwwwwwwwo',
    'owwrwwwrwwo',
    'owwwrwrwwwo',
    'owwwwrwwwwo',
    'owwwrwrwwwo',
    'owwrwwwrwwo',
    'owwwwwwwwwo',
    'ossssssssso',
    '.oooo.oooo.',
    '.....o.....',
  ],
}

export const SPARKLE = {
  pal: { y: '#ffe14d', w: '#ffffff' },
  rows: ['...y......', '..ywy...y.', '...y...ywy', '........y.', '.y........', 'ywy.......', '.y........'],
}

export const MAILBOX = {
  pal: { o: O, b: '#5d8fd6', l: '#8fb6ee', d: '#3e6bb0', p: '#8a5a33', q: '#6b4325' },
  rows: [
    '.oooooooo.',
    'olllllllbo',
    'obbbbbbbbo',
    'obbbbbbbdo',
    'obdddddddo',
    '.oooooooo.',
    '....oqo...',
    '....opo...',
    '....opo...',
    '....opo...',
    '....opo...',
    '...ooooo..',
  ],
}

export const FLAG = {
  pal: { o: O, r: '#e0433a', d: '#a92a2a', p: '#8a5a33' },
  rows: ['oooooo', 'orrrro', 'orrddo', 'oooooo', 'op....', 'op....', 'op....', 'op....', 'op....', 'oo....'],
}

export const LILY = {
  pal: { g: '#4f9a4a', l: '#77c06a' },
  rows: ['..gg..', '.glgg.', 'gglggg', '.gg.g.'],
}

export const MOON = {
  pal: { y: '#f5c842', o: '#a07a1f' },
  rows: ['..yyy.', '.yy...', 'yy....', 'yy....', 'yy...o', '.yyyy.', '..yy..'],
}

export const SUN = {
  pal: { y: '#ffd23f', o: '#f29b1d' },
  rows: ['..y..y..', '...yy...', '.yyyyyy.', 'yyyooyyy', 'yyyooyyy', '.yyyyyy.', '...yy...', '..y..y..'],
}

/** Toolbar icons that neither tile pack has. */
export const ICON_FIT = {
  pal: { o: O, w: '#fffbea' },
  rows: ['oooo....oooo', 'owwo....owwo', 'owo......owo', 'oo........oo', '............', '............', '............', '............', 'oo........oo', 'owo......owo', 'owwo....owwo', 'oooo....oooo'],
}
export const ICON_GEAR = {
  pal: { o: O, g: '#c4c9d6', d: '#8d93a6' },
  rows: ['....oooo....', '..o.oggo.o..', '.ogooggoogo.', '..oggggggo..', 'oogggoogggoo', 'oggdo..odggo', 'oggdo..odggo', 'oogggoogggoo', '..oggggggo..', '.ogooggoogo.', '..o.oggo.o..', '....oooo....'],
}
export const ICON_BELL = {
  pal: { o: O, y: '#ffd23f', d: '#d99a1d' },
  rows: ['.....oo.....', '....oyyo....', '...oyyyyo...', '...oyyyyo...', '..oyyyyyyo..', '..oyyyyyyo..', '..oyyyyydo..', '.oyyyyyyddo.', 'oooooooooooo', '....oddo....', '.....oo.....', '............'],
}
export const ICON_HELP = {
  pal: { o: O, w: '#fffbea' },
  rows: ['...oooooo...', '..owwwwwwo..', '.owwooooowo.', '.owo....owo.', '..o....owo..', '......owo...', '.....owo....', '.....owo....', '......o.....', '.....owo....', '.....owo....', '......o.....'],
}
export const ICON_ZZ = {
  pal: { o: O, b: '#9db7ff' },
  rows: ['......oooooo', '......obbbbo', '.........obo', '........obo.', '.......obbbo', 'ooooo..ooooo', 'obbbo.......', '...obo......', '..obo.......', '.obo........', 'obbbo.......', 'ooooo.......'],
}
export const ICON_EYE = {
  pal: { o: O, w: '#fffbea', b: '#5d8fd6' },
  rows: ['............', '....oooo....', '..oowwwwoo..', '.owwwoowwwo.', 'owwwobbowwwo', 'owwobbbbowwo', 'owwobbbbowwo', 'owwwobbowwwo', '.owwwoowwwo.', '..oowwwwoo..', '....oooo....', '............'],
}

/**
 * A tractor facing right. r/R/l/f (body, shade, highlight, fender) take the colour of the
 * terminal it works for — see `tinted`. The driver wears the farmer's straw hat.
 */
export const TRACTOR = {
  pal: { o: O, r: '#3b7ddd', R: '#2a5aa6', l: '#7fb0f0', f: '#2a5aa6', w: '#c6edff', h: '#f2c23b', s: '#f2c79a', k: '#2b2230', g: '#c4c9d6', y: '#ffd23f', p: '#6b6b7a', G: '#c4c9d6' },
  rows: ['.oRRRRRRRRo....o......', '..orwwhwwro...opo.....', '..orwhhhwro...opo.....', '..orwssswrooooopoooo..', '..orwssswrllllllllllo.', '.oorrrrrrrrrrrrrrrGGo.', 'offfffffffffrrrrrrGGo.', 'ofokkkkkkrrfrrrrrrrro.', 'ofkkkkkkkkrfrrrrrrrro.', '.okkggggkkRRRRRRRRRRo.', 'okkkgyygkkkooooooooo..', 'okkkgyygkkko..okkkko..', 'okkkggggkkko.okkggkko.', '.okkkggkkko..okkggkko.', '..okkkkkko....okkkko..', '...okkkko......okko...'],
}

/** The trailer hitched behind it, with a crate (labelled in the terminal's colour, L) or empty. */
const TRAILER_PAL = { o: O, B: '#f6c891', b: '#b9693a', L: '#3b7ddd', W: '#e7a35f', D: '#b9693a', k: '#2b2230', g: '#c4c9d6' }
export const TRAILER_FULL = {
  pal: TRAILER_PAL,
  rows: ['..oooooooo...', '.oBLLbBLLBo..', '.oBLLbBLLBo..', '.obbbbbbbbo..', '.oBBBbBBBBo..', '.oBBBbBBBBo..', 'oWWWWWWWWWWo.', 'oWWWWWWWWWWoo', 'oDDDkkkDDDDDD', '.oookgkoooooo', '...okgko.....', '...okkko.....'],
}
export const TRAILER_EMPTY = {
  pal: TRAILER_PAL,
  rows: ['.............', '.............', '.............', '.............', '.............', '.oooooooooo..', 'oWWWWWWWWWWo.', 'oWWWWWWWWWWoo', 'oDDDkkkDDDDDD', '.oookgkoooooo', '...okgko.....', '...okkko.....'],
}

/** A farmhand helping out in a repo's plot, two steps of a walk. c/C: cap in the terminal's colour. */
const HELPER_PAL = { o: O, c: '#e8772e', C: '#b85a1c', s: '#f2c79a', S: '#d9a273', h: '#6b4325', w: '#fffbea', q: '#8a5a33', z: O }
export const HELPER = [
  { pal: HELPER_PAL, rows: ['...ooooo....', '..occcccoo..', '.oCCCCCCCCo.', '..ohssssso..', '..ohsssoso..', '..ohssssso..', '..oSSSSSSo..', '..owwwwwwo..', '.owwqwwqwwo.', '.oswqwwqwso.', '..oqqqqqqo..', '..oqqqqqqo..', '..oqqooqqo..', '.ozzzoozzzo.', '..ooo..ooo..'] },
  { pal: HELPER_PAL, rows: ['...ooooo....', '..occcccoo..', '.oCCCCCCCCo.', '..ohssssso..', '..ohsssoso..', '..ohssssso..', '..oSSSSSSo..', '..owwwwwwo..', '.owwqwwqwwo.', '.oswqwwqwso.', '..oqqqqqqo..', '..oqqqqqqo..', '...oqqqqo...', '...ozzzzo...', '....oooo....'] },
]

/** `#rrggbb` made lighter (amt > 0) or darker (amt < 0), by a fraction. */
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16)
  const ch = (v) => Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)
  return `#${[n >> 16, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, '0')).join('')}`
}

/** A sprite with some of its palette letters repainted. */
export const tinted = (def, colors) => ({ pal: { ...def.pal, ...colors }, rows: def.rows })

/** A notice board on two posts, rules pinned to it: by each terminal's plot, and a big one at the farmhouse. */
const BOARD_PAL = { o: O, R: '#b9693a', W: '#e7a35f', D: '#b9693a', p: '#fffbea', l: '#b9b2a6', r: '#e0433a', P: '#8a5a33' }
export const BOARD = {
  pal: BOARD_PAL,
  rows: ['.oooooooooooooo.', 'oRRRRRRRRRRRRRRo', 'oWWWWWWWWWWWWWWo', 'oWWpprppWWWWWWWo', 'oWWpppppWprppWWo', 'oWWplllpWppppWWo', 'oWWpppppWpllpWWo', 'oWWplllpWppppWWo', 'oWWpppppWppppWWo', 'oWWWWWWWWWWWWWWo', 'oDDDDDDDDDDDDDDo', '.ooPPooooooPPoo.', '..oPPo....oPPo..', '..oPPo....oPPo..', '..oPPo....oPPo..', '..oPPo....oPPo..', '..oPPo....oPPo..', '...oo......oo...'],
}
export const BOARD_BIG = {
  pal: BOARD_PAL,
  rows: ['.oooooooooooooooooooooooo.', 'oRRRRRRRRRRRRRRRRRRRRRRRRo', 'oWWWWWWWWWWWWWWWWWWWWWWWWo', 'oWWpprpppWWWWWWWWpprpppWWo', 'oWWppppppWpprpppWppppppWWo', 'oWWpllllpWppppppWpllllpWWo', 'oWWppppppWpllllpWppppppWWo', 'oWWpllllpWppppppWpllllpWWo', 'oWWppppppWpllllpWppppppWWo', 'oWWWWWWWWWppppppWWWWWWWWWo', 'oDDDDDDDDDDDDDDDDDDDDDDDDo', '.ooPPooooooooooooooooPPoo.', '..oPPo..............oPPo..', '..oPPo..............oPPo..', '..oPPo..............oPPo..', '..oPPo..............oPPo..', '..oPPo..............oPPo..', '...oo................oo...'],
}

/** The legend's toolbar icon: a little key card. */
export const ICON_MAP = {
  pal: { o: O, w: '#fffbea', g: '#5fae4f', b: '#5fb6e6', y: '#f2c23b', l: '#b9b2a6' },
  rows: ['oooooooooooo', 'owwwwwwwwwwo', 'owggwllllllo', 'owggwwwwwwwo', 'owwwwwwwwwwo', 'owbbwllllllo', 'owbbwwwwwwwo', 'owwwwwwwwwwo', 'owyywllllllo', 'owyywwwwwwwo', 'owwwwwwwwwwo', 'oooooooooooo'],
}

/** On a harvest crate: Claude Code compacted on its own (a gear) or somebody typed /compact (a hand). */
export const BADGE_GEAR = {
  pal: { o: O, g: '#c4c9d6' },
  rows: ['....ooo....', '..oogggoo..', '.ogogggogo.', '.oogggggoo.', 'oggggoggggo', 'ogggo.ogggo', 'oggggoggggo', '.oogggggoo.', '.ogogggogo.', '..oogggoo..', '....ooo....'],
}
export const BADGE_HAND = {
  pal: { o: O, h: '#f2c79a' },
  rows: ['..o.o.o..', '.ohohoho.', '.ohohoho.', '.ohohoho.', '.ohhhhhoo', '.ohhhhhho', '.ohhhhho.', '..ohhho..', '...ooo...'],
}
