/**
 * Everything on screen that is not the farm itself: the clock box, the toolbar, the wooden
 * dialog box, the journal, settings and help. Plain DOM — the canvas is for the world.
 *
 * Nothing here talks to the server. It renders what main.js hands it and calls back into
 * `actions` when somebody clicks.
 */
import { tile, sprite, BUBBLE_WAIT, ICON_FIT, ICON_GEAR, ICON_BELL, ICON_HELP, ICON_EYE, MOON, SUN, TRACTOR, HELPER, BOARD, ICON_MAP, BADGE_GEAR, tinted, shade } from './art.js'
import { LANDS, LAND_ORDER } from './land.js'
import { STATUS_LABEL } from './status.js'
import { dday, tabLabel, statsLine, contextColor, tabColor, fmtTokens } from './render.js'

const $ = (sel) => document.querySelector(sel)
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v)
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k)
  return e
}

export const HARNESS_LABEL = {
  'claude-code': '클로드 코드',
  codex: '코덱스',
  cursor: '커서',
  antigravity: '안티그래비티',
  hermes: '헤르메스',
  kilocode: '킬로코드',
  opencode: '오픈코드',
}
/** Where a thread works: its repo on a tab plot, else the plot it stands on. */
const whereOf = (t) => (t.tabPlot ? t.repo || '레포 미정' : t.plot || '농가')

const HOW_LABEL = {
  folder: '레포 폴더에서 연 대화창',
  transcript: '대화 기록으로 찾은 레포',
  outside: '레포 밖 작업 폴더',
  unknown: '어느 레포인지 모름',
  temp: '임시 폴더',
}

export function ago(ms) {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000))
  if (m < 1) return '방금'
  if (m < 60) return `${m}분 전`
  if (m < 1440) return `${Math.round(m / 60)}시간 전`
  return `${Math.round(m / 1440)}일 전`
}

/** A tile or sprite as a small crisp canvas, for portraits and toolbar icons. */
function icon(draw, size = 16, scale = 2) {
  const c = el('canvas', { width: size, height: size, class: 'px' })
  c.style.width = c.style.height = `${size * scale}px`
  const g = c.getContext('2d')
  g.imageSmoothingEnabled = false
  draw(g)
  return c
}

export class FarmUI {
  constructor(sheets, actions) {
    this.sheets = sheets
    this.actions = actions
    this.root = $('#hud')
    this.clock = el('div', { class: 'clock frame' })
    this.toolbar = el('div', { class: 'toolbar frame' })
    this.dialog = el('div', { class: 'dialog frame', hidden: true })
    this.journal = el('aside', { class: 'journal frame', hidden: true })
    this.panel = el('div', { class: 'panel frame', hidden: true })
    this.toastEl = el('div', { class: 'toast frame', hidden: true })
    this.board = el('aside', { class: 'board frame' })
    this.tipEl = el('div', { class: 'tip' })
    this.legend = el('aside', { class: 'legend frame', hidden: true })
    this.tourEl = el('div', { class: 'tour frame', hidden: true })
    this.root.append(this.clock, this.board, this.legend, this.toolbar, this.dialog, this.journal, this.panel, this.tourEl, this.toastEl, this.tipEl)
    this.buildLegend()
    this.buildToolbar()
  }

  // ---------- clock box ----------
  setClock({ counts, night, total, unit = '일꾼', usage = null }) {
    const now = new Date()
    const wd = '일월화수목금토'[now.getDay()]
    const h = now.getHours()
    const m = String(now.getMinutes()).padStart(2, '0')
    this.clock.replaceChildren(
      el('div', { class: 'clock-top' },
        el('div', { class: 'date' }, `${now.getMonth() + 1}월 ${now.getDate()}일`, el('small', {}, ` (${wd})`)),
        icon((g) => sprite(g, night ? MOON : SUN, night ? 1 : 0, 0), 8, 3),
      ),
      el('div', { class: 'time' }, `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${m}`),
      el('div', { class: 'clock-rows' },
        el('button', { class: 'row waiting', onclick: () => this.actions.nextWaiting(), title: '다음 기다리는 대화창으로 (N)' }, el('span', {}, '나를 기다림'), el('b', {}, String(counts.waiting || 0))),
        el('div', { class: 'row' }, el('span', {}, '일하는 중'), el('b', {}, String(counts.working || 0))),
        el('div', { class: 'row' }, el('span', {}, '쉬는 중'), el('b', {}, String(counts.idle || 0))),
      ),
      el('div', { class: 'gold' }, el('span', {}, unit), el('b', {}, unit === '터미널' ? `${total}개` : `${total}명`)),
      usage ? usageRows(usage) : null,
    )
    // The board hangs under the clock, however tall the clock has grown.
    requestAnimationFrame(() => (this.board.style.top = `${this.clock.offsetTop + this.clock.offsetHeight + 10}px`))
  }

  // ---------- toolbar ----------
  buildToolbar() {
    const town = this.sheets.town
    const farm = this.sheets.farm
    // Each slot shows the key that really does the same thing — numbered 1…0 like the game's
    // hotbar, the help slot said 0 while 0 meant "whole farm".
    const slots = [
      ['nextWaiting', 'N', '다음 내 차례 터미널로 (N)', () => icon((g) => sprite(g, BUBBLE_WAIT, 2, 2), 16)],
      ['newSessionHere', 'C', '새 대화 — 고른 땅의 레포에서 Terminal 새 탭으로 (C)', () => icon((g) => tile(g, farm, 9, 0, 0))],
      ['toggleJournal', 'J', '일지 — 대화창 전체 목록 (J)', () => icon((g) => tile(g, town, 83, 0, 0))],
      ['toggleLinks', 'L', '길·수로 보기/숨기기 — 레포끼리 연결 (L)', () => icon((g) => tile(g, town, 43, 0, 0))],
      ['fit', '0', '농장 전체 보기 (0)', () => icon((g) => sprite(g, ICON_FIT, 2, 2), 16)],
      ['toggleBoard', 'B', '터미널 현황판 열기/닫기 (B)', () => icon((g) => tile(g, town, 57, 0, 0))],
      ['showHidden', 'H', '숨긴 땅 목록 (H)', () => icon((g) => sprite(g, ICON_EYE, 2, 2), 16)],
      ['toggleSound', 'M', '알림 소리 켜기/끄기 (M)', () => icon((g) => sprite(g, ICON_BELL, 2, 2), 16)],
      ['showSettings', 'S', '설정 (S)', () => icon((g) => sprite(g, ICON_GEAR, 2, 2), 16)],
      ['startTour', 'T', '구조 투어 — 에이전트가 일하는 구조를 농장으로 설명 (T)', () => icon((g) => sprite(g, BOARD, 1, 0), 18, 1.8)],
      ['toggleLegend', 'K', '대응표 — 농장 = 실제 (K)', () => icon((g) => sprite(g, ICON_MAP, 2, 2), 16)],
      ['showHelp', '?', '보는 법·단축키 (?)', () => icon((g) => sprite(g, ICON_HELP, 2, 2), 16)],
    ]
    this.slots = {}
    this.toolbar.replaceChildren(
      ...slots.map(([action, key, title, draw]) => {
        const b = el('button', { class: 'slot', title, onclick: () => this.actions[action]() }, el('span', { class: 'key' }, key), draw(), el('span', { class: 'badge', hidden: true }))
        this.slots[action] = b
        return b
      }),
    )
  }
  setToolbar({ waiting, showLinks, showSleeping, sound, hidden }) {
    const badge = (action, n) => {
      const b = this.slots[action].querySelector('.badge')
      b.hidden = !n
      b.textContent = n
    }
    badge('nextWaiting', waiting)
    badge('showHidden', hidden)
    this.slots.toggleLinks.classList.toggle('on', showLinks)
    this.slots.toggleBoard.classList.toggle('on', !this.board.hidden)
    this.slots.toggleSound.classList.toggle('off', !sound)
    this.slots.toggleLegend.classList.toggle('on', !this.legend.hidden)
  }

  // ---------- 농장 = 실제 ----------
  /** The legend in the corner: each thing on the farm next to what it really is. */
  buildLegend() {
    const farm = this.sheets.farm
    const town = this.sheets.town
    const orange = { r: '#e8772e', R: shade('#e8772e', -0.3), f: shade('#e8772e', -0.3), l: shade('#e8772e', 0.35) }
    const row = (draw, thing, real) => el('li', {}, icon(draw, 24, 1), el('span', { class: 'thing' }, thing), el('span', { class: 'eq' }, '='), el('span', { class: 'real' }, real))
    this.legend.replaceChildren(
      el('div', { class: 'lhead' }, el('b', {}, '농장 = 실제'), el('button', { class: 'x', title: '대응표 숨기기 (K)', onclick: () => this.actions.toggleLegend() }, '✕')),
      el('ul', {},
        row((g) => tile(g, farm, 109, 4, 4), '일꾼', '에이전트(터미널 탭)'),
        row((g) => tile(g, farm, 6, 4, 4), '탭 밭', '컨텍스트(찬 만큼 자람)'),
        row((g) => (tile(g, farm, 11, 4, 4), sprite(g, BADGE_GEAR, 12, 1)), '상자', '압축 횟수(톱니=자동)'),
        row((g) => tile(g, farm, 78, 4, 4), '땅', '레포(작업 폴더)'),
        row((g) => sprite(g, BOARD, 4, 3), '게시판', '규칙 파일(CLAUDE.md)'),
        row((g) => tile(g, farm, 85, 4, 4), '창고', '스킬·메모리·도구'),
        row((g) => tile(g, farm, 108, 4, 4), '심부름꾼', '스킬·메모리 꺼내 씀'),
        row((g) => sprite(g, tinted(TRACTOR, orange), 1, 4), '트랙터', '다른 레포를 씀'),
        row((g) => tile(g, town, 43, 4, 4), '흙길·수로', '레포끼리 연결'),
        el('li', {}, el('span', { class: 'emo' }, '🐮'), el('span', { class: 'thing' }, '정보 줄'), el('span', { class: 'eq' }, '='), el('span', { class: 'real' }, '모델·★노력·🧠기억')),
      ),
    )
  }
  setLegend(open) {
    this.legend.hidden = !open
    this.slots?.toggleLegend?.classList.toggle('on', open)
  }

  // ---------- the harness tour ----------
  showTour(step) {
    this.clock.classList.toggle('tour-focus', Boolean(step?.clock))
    if (!step) {
      this.tourEl.hidden = true
      return
    }
    const last = step.index === step.count - 1
    this.tourEl.replaceChildren(
      el('div', { class: 'thead' }, el('span', { class: 'tstep' }, `구조 투어 ${step.index + 1} / ${step.count}`), el('button', { class: 'x', title: '투어 끝내기 (Esc)', onclick: () => this.actions.endTour() }, '✕')),
      el('h3', {}, step.title),
      el('p', { class: 'tbody' }, step.body),
      el('p', { class: 'treal' }, el('b', {}, '실제로는 '), step.real),
      el('div', { class: 'tbtns' },
        el('button', { class: 'btn', disabled: step.index === 0 || undefined, onclick: () => this.actions.tourPrev() }, '◀ 이전'),
        el('span', { class: 'dots' }, Array.from({ length: step.count }, (_, i) => el('i', { class: i === step.index ? 'on' : '' }))),
        el('button', { class: 'btn primary', onclick: () => this.actions.tourNext() }, last ? '끝 ✓' : '다음 ▶'),
      ),
    )
    this.tourEl.hidden = false
  }

  // ---------- rules ----------
  /** The rule files on a board, in the order they stack: global, folder, repo, then the memory index. */
  showRules({ title, note, rules = [], back = null }) {
    const groups = [
      ['🌐 전역 규칙', '모든 대화에 붙음', (r) => r.kind === 'User'],
      ['📁 폴더 규칙', '이 폴더(와 그 위 폴더)에서 연 대화에 붙음', (r) => (r.kind === 'Project' || r.kind === 'Local') && !r.nested],
      ['🏷 레포 규칙', '그 레포의 파일을 열 때 더 읽음', (r) => r.nested],
      ['🧠 메모리 목차', '시작할 때 같이 읽음 — 창고의 메모리', (r) => r.kind === 'AutoMem'],
    ]
    const short = (p) => p.replace(/^\/Users\/[^/]+/, '~')
    const sections = groups
      .map(([name, what, test]) => {
        const list = rules.filter(test)
        if (!list.length) return null
        return el('section', { class: 'rgroup' },
          el('h4', {}, `${name} `, el('small', {}, what)),
          list.map((r) => el('div', { class: 'rfile' },
            el('code', {}, short(r.path)), el('small', {}, ` ${r.lines}줄`),
            r.headings?.length ? el('div', { class: 'heads' }, r.headings.map((h) => el('span', {}, h))) : null,
          )),
        )
      })
      .filter(Boolean)
    this.dialog.replaceChildren(
      el('button', { class: 'x', onclick: () => this.actions.closeDialog(), title: '닫기 (Esc)' }, '✕'),
      this.portrait((g) => sprite(g, BOARD, 0, 0), '게시판'),
      el('div', { class: 'dbody' },
        el('h3', {}, title),
        el('div', { class: 'meta' }, note),
        sections.length ? sections : el('div', { class: 'meta' }, '아직 대화 기록에 규칙 파일이 남지 않았습니다.'),
        back ? el('div', { class: 'btns' }, el('button', { class: 'btn', onclick: back }, '← 터미널로 돌아가기')) : null,
      ),
    )
    this.dialog.hidden = false
  }

  // ---------- dialog ----------
  closeDialog() {
    this.dialog.hidden = true
  }
  portrait(draw, caption) {
    return el('div', { class: 'portrait' }, el('div', { class: 'portrait-pic' }, icon(draw, 16, 5)), el('div', { class: 'portrait-name' }, caption))
  }
  showThread(t, ctx) {
    const farm = this.sheets.farm
    const btns = [
      el('button', { class: 'btn primary', disabled: t.canOpen === false || undefined, onclick: () => this.actions.openThread(t) }, t.terminal ? '터미널로 가기' : '열기'),
      ctx.folder && el('button', { class: 'btn', onclick: () => this.actions.reveal(ctx.folder) }, '폴더 열기'),
      t.status === 'waiting' && el('button', { class: 'btn', onclick: () => this.actions.markViewed(t) }, '확인함'),
      !t.parentId && el('button', { class: 'btn', onclick: () => this.actions.archive(t) }, '보관'),
    ]
    const where = whereOf(t)
    const how = t.how === 'transcript' && t.share ? `대화 기록으로 찾음 (${Math.round(t.share * 100)}%)` : HOW_LABEL[t.how] || ''
    this.dialog.replaceChildren(
      el('button', { class: 'x', onclick: () => this.actions.closeDialog(), title: '닫기 (Esc)' }, '✕'),
      this.portrait((g) => tile(g, farm, t.parentId ? 122 : t.harness === 'codex' ? 108 : 109, 0, 0), t.parentId ? '보조 일꾼' : HARNESS_LABEL[t.harness] || t.harnessName || t.harness),
      el('div', { class: 'dbody' },
        el('h3', {}, t.title || '(제목 없음)'),
        el('div', { class: 'meta' },
          el('span', { class: `chip s-${t.status}` }, STATUS_LABEL[t.status] || t.status),
          ` ${ago(t.lastActivityAt)} · 땅: ${where} · ${how}`,
          t.gitBranch ? ` · 가지: ${t.gitBranch}` : '',
        ),
        t.terminal ? el('div', { class: 'meta' }, `Terminal ${t.terminal.tab?.index ? `탭 ${t.terminal.tab.index}` : t.terminal.kind === 'bg' ? '(백그라운드)' : ''} · ${t.terminal.tab?.title || t.terminal.name || '—'} · ${t.terminal.status === 'busy' ? '지금 작업 중' : '입력을 기다림'}`) : null,
        statsLine(t) ? el('div', { class: 'meta stats' }, statsLine(t)) : null,
        rulesLine(t, () => this.actions.showRules(t.plot)),
        harvestLine(t),
        broughtBlock(t, (repo) => this.actions.focusPlot(repo)),
        activityBlock(t),
        deadlineRow(t, ctx.deadline, (v) => this.actions.setDeadline(t.id, v)),
        t.preview ? el('div', { class: 'pv' }, t.preview) : null,
        t.canOpen === false ? el('div', { class: 'meta' }, '이 대화창은 원래 프로그램에서 직접 열어야 합니다.') : null,
        el('div', { class: 'btns' }, btns),
      ),
    )
    this.dialog.hidden = false
  }
  showPlot(plot) {
    const town = this.sheets.town
    const farm = this.sheets.farm
    const LAND_ICON = { shared: [farm, 85], field: [farm, 6], orchard: [farm, 78], market: [farm, 11], barn: [farm, 121], forge: [town, 128], forest: [town, 28] }
    const [sheet, id] = LAND_ICON[plot.land] || [town, 16]
    const counts = {}
    for (const t of plot.threads) counts[t.status] = (counts[t.status] || 0) + 1
    const summary = Object.entries(counts).map(([s, n]) => `${STATUS_LABEL[s]} ${n}`).join(' · ') || '최근 일꾼 없음'
    const linkItems = (plot.links || []).map((r) =>
      el('li', {},
        el('b', { class: r.out ? 'out' : 'in' }, r.out ? `→ ${r.to}` : `← ${r.from}`),
        ` ${r.kind === 'data' ? '수로(사이트·데이터)' : '흙길(파일)'}${r.weak ? ' · 약함' : ''} · 근거 ${r.link.code}곳 `,
        r.link.evidence?.[0] ? el('code', {}, `${r.from}/${r.link.evidence[0].file}:${r.link.evidence[0].line}`) : null,
      ),
    )
    this.dialog.replaceChildren(
      el('button', { class: 'x', onclick: () => this.actions.closeDialog(), title: '닫기 (Esc)' }, '✕'),
      this.portrait((g) => tile(g, sheet, id, 0, 0), `${LANDS[plot.land].label} · ${LANDS[plot.land].work}`),
      el('div', { class: 'dbody' },
        el('h3', {}, plot.name),
        el('div', { class: 'meta' }, plot.works?.length ? `터미널 ${plot.works.length}개가 쓰는 중` : summary, plot.folder ? ` · ${plot.folder.replace(/^\/Users\/[^/]+/, '~')}` : ''),
        plot.works?.length
          ? el('ul', { class: 'works' }, plot.works.map((wk) =>
              el('li', {},
                el('span', { class: 'tabno', style: `background:${wk.color}` }, wk.tabName),
                ` ${wk.role === 'home' ? '📍 여기서 일하는 터미널' : '🚜 가져다 쓰는 터미널'} · `,
                el('b', {}, wk.short),
                wk.working ? el('span', { class: 'chip s-working live' }, '작업 중') : null,
                el('button', { class: 'btn mini', onclick: () => this.actions.focusPlot(wk.plot) }, '보기'),
              )))
          : null,
        el('div', { class: 'lands' }, el('span', {}, '땅 종류'),
          LAND_ORDER.map((l) => el('button', { class: `land${l === plot.land ? ' on' : ''}`, onclick: () => this.actions.setLand(plot.name, l) }, LANDS[l].label)),
        ),
        linkItems.length ? el('div', { class: 'links' }, el('div', { class: 'meta' }, `연결 ${linkItems.length}개 — 노랑 = 이 땅이 쓰는 곳 · 분홍 = 이 땅을 쓰는 곳`), el('ul', {}, linkItems)) : el('div', { class: 'meta' }, '코드로 확인된 연결 없음'),
        el('div', { class: 'btns' },
          plot.folder && el('button', { class: 'btn primary', onclick: () => this.actions.newSession(plot) }, '새 대화'),
          plot.folder && el('button', { class: 'btn', onclick: () => this.actions.reveal(plot.folder) }, '폴더 열기'),
          el('button', { class: 'btn', onclick: () => this.actions.hidePlot(plot.name) }, '지도에서 숨기기'),
        ),
      ),
    )
    this.dialog.hidden = false
  }
  showHome(home, { terminalMode = false, waiting = 0, rules = 0 } = {}) {
    const text = terminalMode
      ? `모든 터미널의 본부입니다. 큰 게시판 = 모든 대화에 붙는 전역 규칙 ${rules}개(누르면 목록). 우편함 = 나를 기다리는 터미널이 있으면 깃발이 서고, 누르면 차례로 그 터미널로 갑니다(지금 ${waiting}개).`
      : `어느 레포에서 일했는지 대화 기록으로 확실히 알 수 없는 대화창 ${home.threads.length}개가 여기 모입니다. 우편함을 누르면 나를 기다리는 대화창으로 차례로 갑니다.`
    this.dialog.replaceChildren(
      el('button', { class: 'x', onclick: () => this.actions.closeDialog() }, '✕'),
      this.portrait((g) => tile(g, this.sheets.town, 86, 0, 0), '농가'),
      el('div', { class: 'dbody' },
        el('h3', {}, '농가'),
        el('div', { class: 'meta' }, text),
        el('div', { class: 'btns' },
          rules ? el('button', { class: 'btn', onclick: () => this.actions.showRules('home') }, '전역 규칙 보기') : null,
          waiting ? el('button', { class: 'btn', onclick: () => this.actions.nextWaiting() }, '내 차례 터미널로 (N)') : null,
          home.folder && el('button', { class: 'btn primary', onclick: () => this.actions.newSession({ name: '농가', folder: home.folder, threads: home.threads }) }, '새 대화'),
          home.folder && el('button', { class: 'btn', onclick: () => this.actions.reveal(home.folder) }, '폴더 열기'),
        ),
      ),
    )
    this.dialog.hidden = false
  }

  // ---------- terminal board ----------
  /** The always-there list of open terminals: who is working, whose turn, how far, when due. */
  setBoard(threads, deadlines, open) {
    this.board.hidden = !open
    if (!open) return
    // Re-rendering under a date picker that is open would close it; wait for the next poll.
    if (this.board.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return
    const rows = threads.map((t) => {
      const st = { working: '작업 중', waiting: '내 차례', blocked: '오류', idle: '쉬는 중', celebrating: '합쳐짐', sleeping: '잠듦' }[t.status]
      const a = t.activity
      const now = Date.now()
      const since = t.terminal?.since || 0
      const head = t.status === 'working' && a?.lastTool ? `지금: ${a.lastTool.label}` : a?.lastText ? `마지막 말: ${a.lastText}` : ''
      const turn = a?.turnStartedAt ? `이번 차례 ${ago(a.turnStartedAt).replace(' 전', '')}째 · 단계 ${a.toolsInTurn}개` : ''
      const tasks = a?.tasks
      return el('li', { class: `brow s-${t.status}`, onclick: (e) => !e.target.closest('input, button') && this.actions.focusThread(t.id) },
        el('div', { class: 'btop' },
          tabLabel(t) ? el('span', { class: 'tabno', style: `background:${tabColor(t.terminal.tab.index)}` }, tabLabel(t)) : null,
          el('span', { class: `chip s-${t.status}${t.status === 'working' ? ' live' : ''}` }, st),
          el('b', { class: 'bname', title: t.title }, t.terminal?.tab?.title || t.terminal?.name || t.title || '(제목 없음)'),
          el('button', { class: 'btn mini', title: '그 터미널 탭으로', onclick: () => this.actions.openThread(t) }, '가기'),
        ),
        el('div', { class: 'bline' }, `📍 ${whereOf(t)}${t.status === 'waiting' && since ? ` · ${ago(since).replace(' 전', '')}째 기다림` : ''}`),
        t.brought?.length
          ? el('div', { class: 'bline tractors', title: '이 터미널이 가져다 쓰는 레포 — 누르면 그 땅으로' }, '🚜 ', t.brought.flatMap((u, i) => [i ? ' · ' : '', el('a', { class: 'repo', onclick: (e) => (e.stopPropagation(), this.actions.focusPlot(u.repo)) }, u.repo)]))
          : null,
        statsLine(t) ? el('div', { class: 'bline stats', title: statsLine(t) }, statsLine(t)) : null,
        t.terminal?.stats?.contextPct != null ? contextBar(t.terminal.stats, t.activity?.compacts?.count || 0) : null,
        head ? el('div', { class: 'bline dim', title: head }, head) : null,
        tasks
          ? el('div', { class: 'bprog' }, el('div', { class: 'bar' }, el('i', { style: `width:${Math.round((tasks.done / Math.max(1, tasks.total)) * 100)}%` })), el('span', {}, `할 일 ${tasks.done}/${tasks.total}${tasks.current ? ` · ${tasks.current}` : ''}`))
          : turn ? el('div', { class: 'bline dim' }, turn) : null,
        deadlineRow(t, deadlines?.[t.id], (v) => this.actions.setDeadline(t.id, v), true),
      )
    })
    const working = threads.filter((t) => t.status === 'working').length
    this.board.replaceChildren(
      el('div', { class: 'jhead' }, el('h3', {}, `터미널 현황판 `, el('small', {}, `${threads.length}개 · 작업 중 ${working}`)), el('button', { class: 'x', onclick: () => this.actions.toggleBoard() }, '✕')),
      rows.length ? el('ul', { class: 'blist' }, rows) : el('div', { class: 'meta' }, '지금 터미널에 열린 클로드 코드가 없습니다.'),
    )
  }

  // ---------- journal ----------
  get journalOpen() {
    return !this.journal.hidden
  }
  setJournal(open, threads) {
    this.journal.hidden = !open
    if (!open) return
    const groups = ['waiting', 'blocked', 'working', 'celebrating', 'idle', 'sleeping']
    const farm = this.sheets.farm
    this.journal.replaceChildren(
      el('div', { class: 'jhead' }, el('h3', {}, '일지'), el('button', { class: 'x', onclick: () => this.actions.toggleJournal() }, '✕')),
      ...groups.filter((s) => threads.some((t) => t.status === s)).map((s) => {
        const list = threads.filter((t) => t.status === s)
        return el('section', {},
          el('h4', { class: `s-${s}` }, `${STATUS_LABEL[s]} `, el('span', {}, String(list.length))),
          el('ul', {}, list.map((t) =>
            el('li', { onclick: () => this.actions.focusThread(t.id), title: t.title },
              icon((g) => tile(g, farm, t.parentId ? 122 : t.harness === 'codex' ? 108 : 109, 0, 0), 16, 1.5),
              el('div', {}, el('div', { class: 'jt' }, t.title || '(제목 없음)'), el('div', { class: 'jm' }, `${whereOf(t)} · ${ago(t.lastActivityAt)}`)),
            ),
          )),
        )
      }),
    )
  }

  // ---------- panels ----------
  closePanel() {
    this.panel.hidden = true
  }
  showSettings(settings) {
    const row = (label, opts, key) =>
      el('div', { class: 'srow' }, el('span', {}, label), el('div', { class: 'seg' }, opts.map(([v, t]) => el('button', { class: `land${settings[key] === v ? ' on' : ''}`, onclick: () => this.actions.setSetting(key, v) }, t))))
    this.panel.replaceChildren(
      el('div', { class: 'jhead' }, el('h3', {}, '설정'), el('button', { class: 'x', onclick: () => this.actions.closePanel() }, '✕')),
      row('보여 줄 대화창', [[true, '터미널에 띄운 것만'], [false, '앱 포함 전부']], 'terminalOnly'),
      row('백그라운드 세션', [[false, '숨김'], [true, '보기']], 'showBackground'),
      row('대화창 열 곳', [['terminal', '터미널'], ['app', '원래 앱']], 'openIn'),
      row('알림 소리', [[true, '켬'], [false, '끔']], 'sound'),
      row('잠든 대화창(3일↑)', [[false, '숨김'], [true, '보기']], 'showSleeping'),
      row('길·수로', [[true, '보기'], [false, '숨김']], 'showLinks'),
      row('낮과 밤', [['real', '실제 시각'], ['day', '항상 낮']], 'dayNight'),
      row('임시 폴더 대화창', [[false, '숨김'], [true, '보기']], 'showTemp'),
    )
    this.panel.hidden = false
  }
  showHidden(names) {
    this.panel.replaceChildren(
      el('div', { class: 'jhead' }, el('h3', {}, '숨긴 땅'), el('button', { class: 'x', onclick: () => this.actions.closePanel() }, '✕')),
      names.length
        ? el('ul', { class: 'hidden-list' }, names.map((n) => el('li', {}, el('span', {}, n), el('button', { class: 'btn', onclick: () => this.actions.unhidePlot(n) }, '다시 보이기'))))
        : el('div', { class: 'meta' }, '숨긴 땅이 없습니다.'),
    )
    this.panel.hidden = false
  }
  showHelp() {
    const farm = this.sheets.farm
    // 16-px tiles sit in the middle of a 24-px square; the tractor fills it.
    const item = (draw, text, wide = false) => el('li', {}, icon((g) => (wide || g.translate(4, 4), draw(g)), 24, 1.4), el('span', {}, text))
    const line = (text) => el('li', {}, el('span', { class: 'hicon' }, text.split(' ')[0]), el('span', {}, text.split(' ').slice(1).join(' ')))
    this.panel.replaceChildren(
      el('div', { class: 'jhead' }, el('h3', {}, '터미널 농장 보는 법'), el('button', { class: 'x', onclick: () => this.actions.closePanel() }, '✕')),
      el('h4', { class: 'hsec' }, '땅'),
      el('ul', { class: 'help' },
        line('🟩 「지금 일하는 땅」 = Terminal 탭 1개당 땅 1개, 탭 순서대로. 위 이름표 = 탭 이름(/rename 하면 바뀜), 색 네모 = 그 탭의 색'),
        line('📍 터미널 땅 아래 푯말 = 그 터미널이 일하는 레포'),
        line('🚜 그 위 푯말 = 그 터미널이 가져다 쓰는 다른 레포(최근 1시간·이번 차례)'),
        line('🥕 터미널 땅의 작물 = 컨텍스트 — 5%마다 한 칸씩 심기고 먼저 심은 칸부터 자람 · 🚩 80% 넘으면 「곧 압축」 깃발'),
        item((g) => (tile(g, farm, 11, 0, 0), sprite(g, BADGE_GEAR, 8, -3)), '땅 왼쪽 상자 = 압축(대화를 요약해 비운) 횟수 — 톱니 = 자동 압축, 손 = 직접 /compact. 압축되는 순간 작물이 상자로 들어갑니다'),
        line('🌾 아래 구역 = 레포 땅(밭·과수원·헛간·대장간·장터·숲). 이름표 끝 「📍탭2」 = 탭2가 여기서 일함, 「🚜탭1」 = 탭1이 가져다 씀'),
        item((g) => sprite(g, BOARD, 0, 0), '게시판 = 규칙 파일(CLAUDE.md·AGENTS.md). 땅 옆 = 그 터미널이 실제로 읽은 규칙, 농가의 큰 게시판 = 전역 규칙. 누르면 목록', true),
      ),
      el('h4', { class: 'hsec' }, '일꾼·탈것'),
      el('ul', { class: 'help' },
        item((g) => tile(g, farm, 109, 0, 0), '밀짚모자 일꾼 = 클로드 코드 터미널 1개 (모자 없는 일꾼 = 코덱스)'),
        item((g) => sprite(g, BUBBLE_WAIT, 2, 2), '느낌표·빨간 「내 차례」 = 내 입력을 기다림 → 눌러서 [터미널로 가기]'),
        item((g) => tile(g, farm, 86, 0, 0), '초록 「작업 중 N분」 = 일하는 중 · 「쉬는 중」 = 할 일 끝남'),
        item((g) => sprite(g, tinted(TRACTOR, { r: '#e8772e', R: shade('#e8772e', -0.3), f: shade('#e8772e', -0.3), l: shade('#e8772e', 0.35) }), 1, 4), '트랙터(탭 색) = 그 탭이 다른 레포를 가져다 쓰는 중. 일할 땐 레포 땅 ↔ 터미널 땅을 오가며 짐을 나르고, 쉴 땐 레포 땅에 세워 둠', true),
        item((g) => sprite(g, tinted(HELPER[0], { c: '#3b7ddd', C: shade('#3b7ddd', -0.3) }), 6, 4), '색 모자 도우미 = 그 탭이 쓰는 레포 땅에서 일하는 중 — 일할 땐 계속 왔다갔다, 쉴 땐 서 있음', true),
        item((g) => tile(g, farm, 108, 0, 0), '짐 든 심부름꾼 = 스킬·메모리 창고에 다녀오는 중'),
        item((g) => tile(g, farm, 122, 0, 0), '병아리 = 보조 일꾼(서브에이전트)'),
      ),
      el('h4', { class: 'hsec' }, '일꾼 아래 정보 줄'),
      el('ul', { class: 'help' },
        line('🐮 모델: 🐮 Opus · 🐑 Sonnet · 🐤 Haiku · 🦄 Fable'),
        line('★ 힘(노력): ★ low · ★★ medium · ★★★ high · ★★★★ xhigh · ★★★★★ max'),
        line('🤖 모드: 🤖 자동 · 📜 계획 · ✍️ 바로 수정 · 🙋 물어봄 · ⚡ 무제한 (표시 없음 = 기본)'),
        line('🧠 컨텍스트: 찬 비율(쓴 토큰) — 초록 50% 미만 · 노랑 80% 미만 · 빨강 그 이상'),
        line('🔎 멀리서 보면 아이콘만(🐮★★★★ 🤖 52%), 가까이 보면 글자로 다 나옵니다'),
      ),
      el('h4', { class: 'hsec' }, '길'),
      el('ul', { class: 'help' },
        item((g) => tile(g, this.sheets.town, 43, 0, 0), '흙길 = 파일을 가져다 씀 · 파란 수로 = 사이트·데이터를 같이 씀 · 징검돌 = 약한 연결 (L로 보기/숨기기)'),
      ),
      el('h4', { class: 'hsec' }, '설명할 때'),
      el('ul', { class: 'help' },
        line('🧭 T = 구조 투어 — 일꾼 → 땅 → 게시판 → 창고 → 트랙터 → 계기판 → 전체 구조 순서로 화면이 따라가며 설명(← → 로 넘기기)'),
        line('🗺 K = 대응표 — 왼쪽 아래 「농장 = 실제」 표 켜기/끄기'),
      ),
      el('h4', { class: 'hsec' }, '단축키 (아래 도구 막대 칸의 글자와 같음)'),
      el('div', { class: 'meta keys' }, 'N 다음 내 차례 · C 새 대화 · J 일지 · L 길·수로 · 0 전체 보기 · B 현황판 · H 숨긴 땅 · M 소리 · S 설정 · T 구조 투어 · K 대응표 · ? 이 도움말 · +/− 확대·축소 · 방향키 이동 · Esc 닫기'),
      el('div', { class: 'meta' }, '끌어서 이동 · 두 손가락으로 쓸어 이동 · 손가락 벌리기/모으기로 확대·축소. 새로 열면 늘 기본 크기(3배)로 시작합니다.'),
      el('div', { class: 'meta' }, '지금 터미널에 띄워 둔 클로드 코드만 보입니다(설정에서 바꿀 수 있음). [새 대화]는 Terminal 새 탭으로 열립니다.'),
      el('div', { class: 'meta' }, '원작: Bot Crossing — Jarren Rocks (MIT) · 터미널 농장은 그 코드를 고쳐 만들었습니다'),
      el('div', { class: 'meta' }, '그림: Kenney Tiny Town·Tiny Farm (CC0) · 트랙터·도우미·게시판은 직접 그림 · 글꼴: 갈무리 (OFL)'),
    )
    this.panel.hidden = false
  }

  // ---------- small things ----------
  toast(msg) {
    this.toastEl.textContent = msg
    this.toastEl.hidden = false
    clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => (this.toastEl.hidden = true), 2600)
  }
  tip(text, x, y) {
    if (!text) {
      this.tipEl.style.display = 'none'
      return
    }
    this.tipEl.textContent = text
    this.tipEl.style.display = 'block'
    this.tipEl.style.left = `${Math.min(x + 14, window.innerWidth - 300)}px`
    this.tipEl.style.top = `${y + 16}px`
  }
}


/** How many rule files the session read, by layer, and a way to the board. */
function rulesLine(t, open) {
  const rules = t.activity?.rules || []
  if (!t.terminal || t.parentId || !rules.length) return null
  const n = (test) => rules.filter(test).length
  const parts = [['전역', n((r) => r.kind === 'User')], ['폴더', n((r) => r.kind !== 'User' && r.kind !== 'AutoMem' && !r.nested)], ['레포', n((r) => r.nested)]].filter(([, k]) => k)
  const files = rules.filter((r) => r.kind !== 'AutoMem').length
  return el('div', { class: 'meta rulesline' },
    `📜 규칙 파일 ${files}개 읽음 (${parts.map(([a, k]) => `${a} ${k}`).join(' · ')})${rules.some((r) => r.kind === 'AutoMem') ? ' + 메모리 목차' : ''} `,
    el('button', { class: 'btn mini', onclick: open }, '게시판 보기'),
  )
}

/** The other repos a terminal is using, each with what it did there — the tractors, in words. */
function broughtBlock(t, go) {
  if (!t.terminal || t.parentId) return null
  const list = t.brought || []
  if (!list.length) return el('div', { class: 'meta dim' }, '🚜 가져다 쓰는 다른 레포 없음 (최근 1시간·이번 차례 기준)')
  return el('div', { class: 'brought' },
    el('div', { class: 'meta' }, `🚜 가져다 쓰는 레포 ${list.length}곳`),
    el('ul', {}, list.map((u) =>
      el('li', {},
        el('b', {}, u.repo),
        ` — ${[u.edits && `수정 ${u.edits}`, u.reads && `읽기 ${u.reads}`, u.runs && `실행 ${u.runs}`, u.skills && `스킬 ${u.skills}`].filter(Boolean).join(' · ')} · ${ago(u.lastAt)}`,
        u.label ? el('span', { class: 'dim' }, ` · 최근: ${u.label}`) : null,
        el('button', { class: 'btn mini', onclick: () => go(u.repo) }, '땅 보기'),
      ))),
  )
}

/** What a session is doing and how far it has got, for the dialog. */
function activityBlock(t) {
  const a = t.activity
  if (!a) return null
  const lines = []
  if (a.lastTool && t.status === 'working') lines.push(el('div', {}, `지금: ${a.lastTool.label}`))
  if (a.tasks) {
    lines.push(el('div', { class: 'bprog' }, el('div', { class: 'bar' }, el('i', { style: `width:${Math.round((a.tasks.done / Math.max(1, a.tasks.total)) * 100)}%` })), el('span', {}, `할 일 ${a.tasks.done}/${a.tasks.total}${a.tasks.current ? ` · 지금 할 일: ${a.tasks.current}` : ''}`)))
  } else if (a.turnStartedAt) {
    lines.push(el('div', {}, `이번 차례 ${ago(a.turnStartedAt).replace(' 전', '')}째 · 단계 ${a.toolsInTurn}개 (할 일 목록을 만들지 않은 세션이라 단계 수로 표시)`))
  }
  if (a.lastText && t.status !== 'working') lines.push(el('div', { class: 'pv small' }, `마지막 말: ${a.lastText}`))
  return lines.length ? el('div', { class: 'activity' }, lines) : null
}

/** A date for when this terminal's work is due, kept in the colony file. */
function deadlineRow(t, value, onChange, compact = false) {
  if (t.parentId) return null
  const dd = dday(value)
  const input = el('input', { type: 'date', value: value || '', onchange: (e) => onChange(e.target.value || null) })
  return el('div', { class: `deadline${compact ? ' compact' : ''}` },
    el('span', {}, '마감'),
    input,
    dd ? el('span', { class: `dd${dd.days < 0 ? ' over' : dd.days <= 1 ? ' soon' : ''}` }, dd.text) : null,
    value ? el('button', { class: 'clear', title: '마감 지우기', onclick: () => onChange(null) }, '✕') : null,
  )
}

/** 컨텍스트가 얼마나 찼는지 막대로. */
function contextBar(st, compacts = 0) {
  const pct = Math.max(0, Math.min(100, st.contextPct))
  return el('div', { class: 'bprog' },
    el('div', { class: 'bar' }, el('i', { style: `width:${pct}%;background:${contextColor(pct)}` })),
    el('span', {}, `컨텍스트 ${pct}%${st.windowSize ? ` / ${st.windowSize >= 1e6 ? '100만' : `${Math.round(st.windowSize / 1000)}k`}` : ''}${st.estimated ? ' (추정)' : ''}${compacts ? ` · 🧺 압축 ${compacts}회` : ''}`),
  )
}

/** The compactions so far — the crates beside the field — and the last one, for the dialog. */
function harvestLine(t) {
  const c = t.activity?.compacts
  if (!t.terminal || t.parentId || !c) return null
  const last = c.last || {}
  const how = last.trigger === 'manual' ? '직접 /compact' : '자동 압축'
  return el('div', { class: 'meta' }, `🧺 수확(압축) ${c.count}회 · 마지막: ${how} ${fmtTokens(last.pre)}→${fmtTokens(last.post)} 토큰 · ${ago(last.at)}`)
}

/** 플랜 사용량: 5시간·7일 한도 중 얼마나 썼는지, 언제 다시 차는지. */
function usageRows(usage) {
  const at = (ms) => {
    if (!ms) return ''
    const d = new Date(ms)
    const same = d.toDateString() === new Date().toDateString()
    return `${same ? '' : `${d.getMonth() + 1}/${d.getDate()} `}${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')} 초기화`
  }
  const row = (label, w) =>
    w
      ? el('div', { class: 'urow', title: at(w.resetsAt) },
          el('span', {}, label),
          el('div', { class: 'bar' }, el('i', { style: `width:${Math.min(100, w.pct)}%;background:${contextColor(w.pct)}` })),
          el('b', {}, `${Math.round(w.pct)}%`))
      : null
  return el('div', { class: 'usage' }, el('div', { class: 'utitle' }, '클로드 사용량'), row('5시간', usage.fiveHour), row('7일', usage.sevenDay))
}
