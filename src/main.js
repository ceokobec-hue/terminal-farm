/**
 * Terminal Farm — every coding-agent thread on this machine as a farmhand, working the plot of
 * the repo it is busy in.
 *
 * This file is the glue: it polls the server, turns threads into a farm model, hands that to
 * the renderer and the UI, and carries out what the UI asks for. The server half (harness
 * adapters, deep links, colony.json) is the original Bot Crossing's, unchanged.
 */
import './farm/farm.css'
import { fetchThreads, fetchState, fetchLinks, saveState, openThread, newSession, revealFolder } from './game/api.js'
import { withErrands } from './game/errands.js'
import { hideProject, unhideProject } from './game/hidden-projects.js'
import { statusFor, terminalStatus, inTerminal, STATUS_ORDER, applyViewed } from './farm/status.js'
import { layoutFarm, landOf } from './farm/land.js'
import { planRoutes, drawableLinks, errandRoute } from './farm/routes.js'
import { FarmRenderer, tabColor, cropOfTab, fmtTokens } from './farm/render.js'
import { FarmUI } from './farm/ui.js'
import { TOUR, tourContext, stepText } from './farm/tour.js'

const POLL_MS = 15000
/** Terminals change by the second; the scan behind this costs ~30 ms. */
const TERMINAL_POLL_MS = 5000
const LINKS_MS = 5 * 60 * 1000
const SETTINGS_KEY = 'terminalfarm.settings.v1'
const DEFAULTS = { terminalOnly: true, showBackground: false, boardOpen: true, openIn: 'terminal', sound: true, showSleeping: false, showLinks: true, dayNight: 'real', showTemp: false, showLegend: true }

// ---------- state ----------
let state = null
let rawThreads = []
let planUsage = null
/** A terminal that has not yet said which repo it works in gets a plot of its own, top left. */
const NEW_PLOT = '새 터미널'
/** With terminals only, every tab gets a plot of its own: `탭:<thread id>`. */
const TAB_PLOT = '탭:'
const isTabPlot = (name) => typeof name === 'string' && name.startsWith(TAB_PLOT)
let links = null
let model = null
let layoutKey = ''
let layout = null
let routes = null
let routesKey = ''
let selectedPlot = null
let selectedThread = null
let journalOpen = false
let settings = loadSettings()

/**
 * The zoom is not a setting: a farm opened fresh starts at the size it was made for. It used to be
 * kept, and one zoom-out to look around left the farm small — and the model/effort line, which
 * needs room, hidden — from then on. Only the page's own reload after a rebuild keeps the view.
 */
const VIEW_KEY = 'terminalfarm.view'
// A function declaration on purpose: `settings` is loaded above, before a `const` here would
// exist, and the error that caused was swallowed — every saved setting came back as the default.
function withoutZoom({ zoom, ...rest }) {
  return rest
}

function loadSettings() {
  try {
    return { ...DEFAULTS, ...withoutZoom(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')) }
  } catch {
    return { ...DEFAULTS }
  }
}
function storeSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    /* private window — settings just will not persist */
  }
  if (state) {
    state.settings = withoutZoom(settings)
    queueSave()
  }
}

let saveTimer = null
function queueSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      state = await saveState(state)
    } catch (err) {
      console.warn('[farm] save failed', err)
    }
  }, 500)
}

// ---------- model ----------
const byStatus = (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || b.lastActivityAt - a.lastActivityAt

function buildModel() {
  const now = Date.now()
  const archived = new Set(state.archived || [])
  const hidden = new Set(state.hiddenProjects || [])
  const viewed = state.viewedAt || {}
  const all = withErrands(applyViewed(rawThreads, viewed))
    .filter((t) => !t.archived && !archived.has(t.id))
    .filter((t) => !settings.terminalOnly || inTerminal(t))
    .filter((t) => settings.showBackground || t.terminal?.kind !== 'bg')
    .map((t) => ({
      ...t,
      status: settings.terminalOnly && t.terminal ? terminalStatus(t, viewed) : statusFor(t, now),
      plot: t.place?.plot ?? null,
      how: t.place?.how ?? 'unknown',
      share: t.place?.share,
    }))
    .filter((t) => settings.showTemp || t.how !== 'temp')

  const shown = all.filter((t) => (settings.terminalOnly || settings.showSleeping || t.status !== 'sleeping') && !(t.plot && hidden.has(t.plot)))

  const repoPath = new Map((links?.repos || []).map((r) => [r.name, r.path]))
  const names = new Set([...repoPath.keys(), ...shown.map((t) => t.plot).filter(Boolean)])
  for (const n of hidden) names.delete(n)

  const tabPlots = new Map()
  if (settings.terminalOnly) {
    // One plot per Terminal tab — the rule the person farming asked for. The plot is named after
    // the tab and says which repo the session works in; its subagents' chicks stay with it.
    const leads = new Map(shown.filter((t) => !t.parentId).map((t) => [t.id, t]))
    for (const t of shown) {
      const lead = leads.get(t.parentId || t.id) || t
      const key = TAB_PLOT + lead.id
      t.repo = t.plot
      t.tabPlot = true
      t.plot = key
      if (!tabPlots.has(key)) {
        const title = lead.terminal?.tab?.title || lead.terminal?.name || lead.title || '새 대화'
        const tab = lead.terminal?.tab?.index
        const short = `${tab ? `탭${tab} ` : ''}${title}`
        const repoLabel = (lead === t ? t.repo : lead.repo ?? lead.place?.plot) || '레포 미정'
        tabPlots.set(key, {
          name: key,
          tabPlot: true,
          short,
          repoLabel,
          label: `${short} · ${repoLabel}`,
          repo: t.repo || null,
          tab: tab ?? 99,
          tabName: tab ? `탭${tab}` : shortTitle(title),
          color: tabColor(tab),
          working: lead.status === 'working',
          lead,
          leadId: lead.id,
          threads: [],
          folder: lead.projectPath || null,
          uses: [],
          // The rule files this session was actually given, from its transcript.
          rules: lead.activity?.rules || [],
          // Its field: how full the context window is, and the compactions so far.
          contextPct: lead.terminal?.stats?.contextPct ?? null,
          compacts: lead.activity?.compacts || null,
          crop: cropOfTab(tab, key),
        })
      }
    }
    // The other repos each terminal reached into lately. Skills and memory are left to the
    // couriers — every session leans on them, so a tractor there would say nothing.
    const ambient = new Set([links?.shared?.skills, links?.shared?.memory].filter(Boolean))
    for (const p of tabPlots.values()) {
      p.uses = (p.lead.uses || []).filter((u) => u.repo !== p.repo && !ambient.has(u.repo) && !hidden.has(u.repo) && names.has(u.repo)).slice(0, 4)
      p.lead.brought = p.uses
    }
  } else {
    // A live terminal with no repo yet is new work, not farmhouse clutter: it gets its own plot in
    // the active zone, where the person is looking.
    for (const t of shown) if (t.terminal && !t.plot) t.plot = NEW_PLOT
    if (shown.some((t) => t.plot === NEW_PLOT)) names.add(NEW_PLOT)
  }
  for (const k of tabPlots.keys()) names.add(k)
  const plots = new Map([...names].map((n) => [n, tabPlots.get(n) || { name: n, threads: [], folder: repoPath.get(n) || null }]))
  const homeThreads = []
  for (const t of shown) {
    const p = t.plot && plots.get(t.plot)
    if (p) {
      p.threads.push(t)
      if (!p.folder || (!repoPath.has(p.name) && t.projectPath && t.projectPath.length < p.folder.length)) p.folder = repoPath.get(p.name) || t.projectPath
    } else homeThreads.push(t)
  }
  for (const p of plots.values()) p.threads.sort(byStatus)
  homeThreads.sort(byStatus)

  // Which terminals each repo plot is working for, for its helpers and its sign, and a tractor
  // for every repo a terminal brought in.
  const repoWork = new Map()
  const tractors = []
  for (const p of [...tabPlots.values()].sort((a, b) => a.tab - b.tab)) {
    const work = { plot: p.name, tab: p.tab, tabName: p.tabName, color: p.color, working: p.working, leadId: p.leadId, short: p.short }
    const add = (repo, role) => {
      if (!plots.has(repo) || tabPlots.has(repo)) return
      repoWork.set(repo, [...(repoWork.get(repo) || []), { ...work, role }])
    }
    if (p.repo) add(p.repo, 'home')
    for (const u of p.uses) {
      add(u.repo, 'brought')
      if (plots.has(u.repo)) tractors.push({ ...work, key: `${p.name}>${u.repo}`, from: u.repo, to: p.name, repo: u.repo, use: u })
    }
  }

  // Counted per terminal: a subagent's chick is not another tab, and counting it made the clock
  // say six when the tab bar showed five.
  const counts = {}
  for (const t of shown) if (!t.parentId) counts[t.status] = (counts[t.status] || 0) + 1
  return {
    all,
    shown,
    plots,
    home: { threads: homeThreads, folder: links?.roots?.[0] || null },
    counts,
    hidden: [...hidden],
    repoWork,
    tractors,
    // The global rules every terminal was given — the big board at the farmhouse.
    globalRules: [...new Map([...tabPlots.values()].flatMap((p) => p.rules).filter((r) => r.kind === 'User').map((r) => [r.path, r])).values()],
  }
}

const shortTitle = (s) => (s.length > 10 ? `${s.slice(0, 9)}…` : s)

function rebuild() {
  if (!state) return
  model = buildModel()
  const names = [...model.plots.keys()]
  // Plots with somebody in them go top left.
  const active = new Set(model.shown.map((t) => t.plot).filter((n) => n && model.plots.has(n)))
  // The repos every session leans on — skills, memory, the tool shed — sit in the shared store.
  const shared = new Map(Object.entries(links?.shared || {}).filter(([, n]) => n && model.plots.has(n)).map(([role, n]) => [n, role]))
  // A tab's plot looks like the land of the repo it works in (a storehouse look stays with the
  // real storehouses), and tab plots line up in tab-bar order.
  const lands = { [NEW_PLOT]: 'field', ...(state.lands || {}) }
  const rank = new Map()
  for (const p of model.plots.values()) {
    if (!p.tabPlot) continue
    const land = p.repo ? landOf(p.repo, state.lands || {}, shared) : 'field'
    lands[p.name] = land === 'shared' ? 'forge' : land
    rank.set(p.name, p.tab)
  }
  const key = JSON.stringify([names.sort(), lands, [...active].sort(), [...shared], [...rank]])
  if (key !== layoutKey) {
    layoutKey = key
    layout = layoutFarm(names, lands, active, shared, rank)
    errandCache.clear()
    for (const [n, p] of layout.plots) model.plots.get(n).land = p.land
    routesKey = ''
  } else {
    for (const [n, p] of layout.plots) model.plots.get(n).land = p.land
  }
  const drawable = drawableLinks(links?.links, new Set(layout.plots.keys()), state.hiddenLinks)
  const rKey = layoutKey + JSON.stringify(drawable.map((l) => [l.from, l.to, l.kind]))
  if (rKey !== routesKey) {
    routesKey = rKey
    routes = planRoutes(layout, drawable)
  }
  const trips = errands()
  const tractors = []
  for (const tr of model.tractors) {
    if (!layout.plots.has(tr.from) || !layout.plots.has(tr.to)) continue
    if (!errandCache.has(tr.key)) errandCache.set(tr.key, errandRoute(layout, routes, tr.from, tr.to))
    tractors.push({ ...tr, cells: errandCache.get(tr.key) })
  }
  const hour = new Date().getHours()
  const night = settings.dayNight === 'real' && (hour >= 19 || hour < 6)
  const dusk = settings.dayNight === 'real' && (hour >= 17 && hour < 19)
  renderer.setScene({
    layout,
    routes,
    plots: model.plots,
    home: model.home,
    night,
    dusk,
    showLinks: settings.showLinks,
    selectedPlot,
    selectedThread,
    waiting: model.counts.waiting || 0,
    trips,
    tractors,
    repoWork: model.repoWork,
    globalRules: model.globalRules,
    // With one plot per tab nobody is left over for the farmhouse; it is where the global rules
    // and the mailbox are.
    homeLabel: settings.terminalOnly ? '농가 · 전역 규칙 게시판 · 우편함' : '농가 · 어느 레포인지 모르는 대화창',
    deadlines: state.deadlines || {},
  })
  ui.setLegend(settings.showLegend)
  if (tour) refreshTour(false)
  if (pendingNew) welcomeNewSession()
  // In Terminal's own tab order when it is known, so the board reads like the tab bar.
  const tabOf = (t) => t.terminal?.tab?.index ?? 99
  const terminals = model.shown.filter((t) => !t.parentId).sort((a, b) => tabOf(a) - tabOf(b) || byStatus(a, b))
  ui.setBoard(terminals, state.deadlines || {}, settings.boardOpen)
  ui.setClock({ counts: model.counts, night, total: model.shown.filter((t) => !t.parentId).length, unit: settings.terminalOnly ? '터미널' : '일꾼', usage: planUsage })
  ui.setToolbar({ waiting: model.counts.waiting || 0, showLinks: settings.showLinks, showSleeping: settings.showSleeping, sound: settings.sound, hidden: model.hidden.length })
  if (journalOpen) ui.setJournal(true, model.shown.slice().sort(byStatus))
  chimeForNewWaiting()
}

// ---------- errands ----------
const errandCache = new Map()
/** Couriers for what sessions reached into lately, routed along the tracks. A dozen at most. */
function errands() {
  const out = []
  const known = (n) => n === '__home' || layout.plots.has(n)
  const hauled = new Set(model.tractors.map((tr) => `${tr.to}|${tr.from}`))
  for (const t of model.shown) {
    for (let trip of t.trips || []) {
      if (t.plot === NEW_PLOT) trip = { ...trip, from: trip.from === '__home' ? NEW_PLOT : trip.from, to: trip.to === '__home' ? NEW_PLOT : trip.to }
      if (t.tabPlot) {
        const side = t.repo || '__home'
        trip = { ...trip, from: trip.from === side ? t.plot : trip.from, to: trip.to === side ? t.plot : trip.to }
      }
      if (!known(trip.from) || !known(trip.to) || trip.from === trip.to) continue
      if (t.tabPlot && (hauled.has(`${t.plot}|${trip.from}`) || hauled.has(`${t.plot}|${trip.to}`))) continue
      const key = `${trip.from}>${trip.to}`
      if (!errandCache.has(key)) errandCache.set(key, errandRoute(layout, routes, trip.from, trip.to))
      const cells = errandCache.get(key)
      if (cells) out.push({ ...trip, cells, key: `${t.id}|${trip.kind}|${key}` })
      if (out.length >= 12) return out
    }
  }
  return out
}

/** What a field's crates say when pointed at: how many compactions, and the last one. */
function harvestTip(p) {
  const c = p?.compacts
  if (!c) return ''
  const last = c.last || {}
  const how = last.trigger === 'manual' ? '직접 /compact' : '자동 압축'
  const mins = Math.max(0, Math.round((Date.now() - (last.at || 0)) / 60000))
  const when = mins < 60 ? `${mins}분 전` : mins < 1440 ? `${Math.round(mins / 60)}시간 전` : `${Math.round(mins / 1440)}일 전`
  return `🧺 수확 ${c.count}회 = 압축(대화 요약) 횟수 · 마지막: ${how} ${fmtTokens(last.pre)}→${fmtTokens(last.post)} 토큰 · ${when}`
}

// ---------- a new session ----------
/** Set when [새 대화] is pressed: the plots there were then, so the new one can be told apart. */
let pendingNew = null
function welcomeNewSession() {
  if (Date.now() - pendingNew.at > 90000) {
    pendingNew = null
    return
  }
  const fresh = [...model.plots.values()].filter((p) => p.tabPlot && !pendingNew.before.has(p.name))
  const mine = fresh.find((p) => p.folder === pendingNew.folder) || fresh[0]
  if (!mine || !layout.plots.has(mine.name)) return
  pendingNew = null
  const at = layout.plots.get(mine.name)
  renderer.centerOn(at.x + at.w / 2, at.y + at.h / 2)
  selectedPlot = mine.name
  ui.toast(`새 대화가 들어왔습니다 — ${mine.short} · 📍 ${mine.repoLabel}`)
}

// ---------- chime ----------
let waitingBefore = null
let audio = null
function chimeForNewWaiting() {
  const now = new Set(model.shown.filter((t) => t.status === 'waiting').map((t) => t.id))
  const fresh = waitingBefore ? [...now].filter((id) => !waitingBefore.has(id)) : []
  waitingBefore = now
  if (!fresh.length || !settings.sound) return
  try {
    audio = audio || new AudioContext()
    const t0 = audio.currentTime
    for (const [i, f] of [[0, 784], [1, 1175]]) {
      const o = audio.createOscillator()
      const g = audio.createGain()
      o.type = 'triangle'
      o.frequency.value = f
      g.gain.setValueAtTime(0, t0 + i * 0.12)
      g.gain.linearRampToValueAtTime(0.18, t0 + i * 0.12 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.001, t0 + i * 0.12 + 0.5)
      o.connect(g).connect(audio.destination)
      o.start(t0 + i * 0.12)
      o.stop(t0 + i * 0.12 + 0.55)
    }
  } catch {
    /* no audio until the page has been interacted with */
  }
}

// ---------- the harness tour ----------
let tour = null
function tourCtx() {
  return tourContext(layout, model)
}
/** Show the current step: its card, its spotlight, and (when asked) fly the camera there. */
function refreshTour(fly = true) {
  const step = TOUR[tour.step]
  const ctx = tourCtx()
  const rect = step.focus(ctx) || ctx.whole()
  renderer.tour = { rect }
  if (fly) renderer.flyTo(rect, { margin: [70, settings.boardOpen ? 360 : 40, 250, settings.showLegend ? 270 : 40] })
  ui.showTour({ ...stepText(step, ctx), index: tour.step, count: TOUR.length, clock: Boolean(step.clock) })
  if (fly) ui.closeDialog()
}

// ---------- actions ----------
const findThread = (id) => model?.all.find((t) => t.id === id)
const plotModel = (name) => {
  const p = model.plots.get(name)
  if (!p) return null
  const mine = (routes?.routes || []).filter((r) => r.from === name || r.to === name).map((r) => ({ ...r, out: r.from === name }))
  return { ...p, land: layout.plots.get(name)?.land || landOf(name, state.lands), links: mine, works: model.repoWork.get(name) || [] }
}

function selectThread(t) {
  selectedThread = t.id
  selectedPlot = t.plot && layout.plots.has(t.plot) ? t.plot : null
  rebuild()
  const folder = t.plot ? model.plots.get(t.plot)?.folder : model.home.folder
  ui.showThread(t, { folder: t.projectPath || folder, deadline: state.deadlines?.[t.id] })
}
function selectPlot(name) {
  selectedPlot = name
  selectedThread = null
  rebuild()
  const p = plotModel(name)
  if (p) ui.showPlot(p)
}

const actions = {
  startTour() {
    if (tour) return actions.endTour()
    actions.closeDialog()
    ui.closePanel()
    tour = { step: 0 }
    refreshTour()
  },
  tourNext() {
    if (!tour) return
    if (tour.step >= TOUR.length - 1) return actions.endTour()
    tour.step++
    refreshTour()
  },
  tourPrev() {
    if (!tour || tour.step === 0) return
    tour.step--
    refreshTour()
  },
  endTour() {
    tour = null
    renderer.tour = null
    ui.showTour(null)
  },
  toggleLegend: () => actions.setSetting('showLegend', !settings.showLegend),
  showRules(target) {
    if (target === 'home') return ui.showRules({ title: '농가 게시판 — 전역 규칙', note: '모든 대화에 붙는 규칙입니다. 터미널마다 대화 기록에 남은 것을 모았습니다.', rules: model.globalRules })
    const p = model.plots.get(target)
    if (!p) return
    ui.showRules({ title: `${p.short} 게시판`, note: '이 터미널이 실제로 읽은 규칙 파일입니다(대화 기록 기준). 위에서 아래로 겹겹이 쌓입니다.', rules: p.rules, back: () => selectThread(findThread(p.leadId)) })
  },
  closeDialog() {
    selectedPlot = null
    selectedThread = null
    ui.closeDialog()
    rebuild()
  },
  closePanel: () => ui.closePanel(),
  async openThread(t) {
    try {
      const r = await openThread(t, settings.openIn)
      ui.toast(r.focused ? '그 터미널 탭을 앞으로 가져왔습니다' : r.note || (settings.openIn === 'terminal' ? '터미널에서 여는 중…' : '원래 앱에서 여는 중…'))
      setTimeout(poll, 1800)
    } catch (err) {
      ui.toast(`열지 못했습니다 — ${err.message}`)
    }
  },
  async reveal(folder) {
    try {
      await revealFolder(folder)
    } catch (err) {
      ui.toast(`폴더를 열지 못했습니다 — ${err.message}`)
    }
  },
  markViewed(t) {
    state.viewedAt = { ...(state.viewedAt || {}), [t.id]: Date.now() }
    queueSave()
    ui.toast('확인함으로 표시했습니다')
    rebuild()
    const again = findThread(t.id)
    if (again) ui.showThread(again, { folder: again.projectPath, deadline: state.deadlines?.[t.id] })
  },
  archive(t) {
    state.archived = [...new Set([...(state.archived || []), t.id])]
    state.archivedAt = { ...(state.archivedAt || {}), [t.id]: Date.now() }
    queueSave()
    ui.closeDialog()
    ui.toast('보관했습니다 — 지도에서 빠집니다')
    selectedThread = null
    rebuild()
  },
  async newSession(plot) {
    const counts = {}
    for (const t of plot.threads || []) counts[t.harness] = (counts[t.harness] || 0) + 1
    const harness = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0]
    try {
      pendingNew = { at: Date.now(), folder: plot.folder, before: new Set([...model.plots.values()].filter((p) => p.tabPlot).map((p) => p.name)) }
      const r = await newSession(plot.folder, harness, settings.openIn)
      ui.toast(r.note || `${plot.name}에서 새 대화를 여는 중…`)
      // Claude Code registers itself within a few seconds; look a few times rather than wait 5 s.
      for (const ms of [1500, 3000, 4500, 7000, 10000]) setTimeout(poll, ms)
    } catch (err) {
      pendingNew = null
      ui.toast(`새 대화를 열지 못했습니다 — ${err.message}`)
    }
  },
  setLand(name, land) {
    state.lands = { ...(state.lands || {}), [name]: land }
    queueSave()
    rebuild()
    const p = plotModel(name)
    if (p) {
      const at = layout.plots.get(name)
      renderer.centerOn(at.x + at.w / 2, at.y + at.h / 2)
      ui.showPlot(p)
    }
  },
  hidePlot(name) {
    state.hiddenProjects = hideProject(state.hiddenProjects || [], name)
    queueSave()
    actions.closeDialog()
    ui.toast(`${name} 땅을 지도에서 숨겼습니다 — 도구 막대 「숨긴 땅」에서 다시 보이기`)
  },
  unhidePlot(name) {
    state.hiddenProjects = unhideProject(state.hiddenProjects || [], name)
    queueSave()
    rebuild()
    ui.showHidden(model.hidden)
  },
  nextWaiting() {
    const list = model.shown.filter((t) => t.status === 'waiting')
    if (!list.length) return ui.toast('지금 나를 기다리는 대화창이 없습니다')
    const i = (list.findIndex((t) => t.id === selectedThread) + 1) % list.length
    actions.focusThread(list[i].id)
  },
  focusPlot(name) {
    const at = layout.plots.get(name)
    if (!at) return ui.toast(`${name} 땅이 지도에 없습니다 (숨겼을 수 있음)`)
    renderer.centerOn(at.x + at.w / 2, at.y + at.h / 2)
    const p = model.plots.get(name)
    if (p?.tabPlot) {
      const lead = findThread(p.leadId)
      if (lead) return selectThread(lead)
    }
    selectPlot(name)
  },
  focusThread(id) {
    const t = findThread(id)
    if (!t) return
    const at = renderer.whereIs(id)
    if (at) renderer.centerOn(at.x + 0.5, at.y)
    selectThread(t)
  },
  newSessionHere() {
    if (selectedPlot) return actions.newSession(plotModel(selectedPlot))
    if (model.home.folder) return actions.newSession({ name: '농가', folder: model.home.folder, threads: model.home.threads })
    ui.toast('먼저 땅을 고르세요')
  },
  toggleJournal() {
    journalOpen = !journalOpen
    ui.setJournal(journalOpen, model.shown.slice().sort(byStatus))
  },
  setDeadline(id, value) {
    const next = { ...(state.deadlines || {}) }
    if (value) next[id] = value
    else delete next[id]
    state.deadlines = next
    queueSave()
    rebuild()
    ui.toast(value ? `마감을 ${value}로 정했습니다` : '마감을 지웠습니다')
    if (selectedThread === id && !ui.dialog.hidden) {
      const t = findThread(id)
      if (t) ui.showThread(t, { folder: t.projectPath, deadline: state.deadlines?.[id] })
    }
  },
  toggleBoard: () => actions.setSetting('boardOpen', !settings.boardOpen),
  toggleLinks: () => actions.setSetting('showLinks', !settings.showLinks),
  toggleSleeping: () => actions.setSetting('showSleeping', !settings.showSleeping),
  toggleSound: () => actions.setSetting('sound', !settings.sound),
  fit() {
    renderer.fit()
  },
  showHidden: () => ui.showHidden(model.hidden),
  showSettings: () => ui.showSettings(settings),
  showHelp: () => ui.showHelp(),
  setSetting(key, value) {
    settings = { ...settings, [key]: value }
    storeSettings()
    rebuild()
    if (!ui.panel.hidden && ui.panel.querySelector('.srow')) ui.showSettings(settings)
    const label = { showLinks: ['길·수로를 숨깁니다', '길·수로를 보여 줍니다'], showSleeping: ['잠든 대화창을 숨깁니다', '잠든 대화창도 보여 줍니다'], sound: ['소리를 끕니다', '소리를 켭니다'] }[key]
    if (label) ui.toast(label[value ? 1 : 0])
  },
}

// ---------- boot ----------
const canvas = document.getElementById('farm')
let renderer
let ui

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

const myBuild = document.querySelector('script[type="module"][src]')?.getAttribute('src') || ''
async function checkForNewBuild() {
  if (!myBuild.includes('/assets/')) return // the dev server has no hashed build to compare
  try {
    const html = await (await fetch('/', { cache: 'no-store' })).text()
    const latest = /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(html)?.[1]
    if (latest && latest !== myBuild) {
      try {
        sessionStorage.setItem(VIEW_KEY, JSON.stringify({ zoom: renderer.cam.zoom, cam: { x: renderer.cam.x, y: renderer.cam.y }, userMoved: renderer.userMoved }))
      } catch {
        /* reload all the same */
      }
      location.reload()
    }
  } catch {
    /* server restarting — try again next time */
  }
}

let polling = false
let lastFullPoll = 0
async function poll() {
  if (polling) return
  polling = true
  lastFullPoll = Date.now()
  try {
    const body = await fetchThreads()
    rawThreads = body.threads || []
    planUsage = body.usage || null
    rebuild()
  } catch (err) {
    ui?.toast(`대화창을 읽지 못했습니다 — ${err.message}`)
  } finally {
    polling = false
  }
}
async function pollLinks() {
  try {
    links = await fetchLinks()
    rebuild()
  } catch (err) {
    console.warn('[farm] links failed', err)
  }
}

async function boot() {
  const [town, farm] = await Promise.all([loadImage('/assets/farm/town.png'), loadImage('/assets/farm/farm.png')])
  await Promise.race([Promise.all(['10px Galmuri9', '11px Galmuri11', 'bold 11px "Galmuri11 Bold"'].map((f) => document.fonts.load(f))), new Promise((r) => setTimeout(r, 3000))])
  const sheets = { town, farm }
  renderer = new FarmRenderer(canvas, sheets)
  // Back from a reload after a rebuild: the same view as before it.
  try {
    const view = JSON.parse(sessionStorage.getItem(VIEW_KEY) || 'null')
    sessionStorage.removeItem(VIEW_KEY)
    if (view?.zoom > 0) {
      renderer.cam = { ...renderer.cam, ...view.cam, zoom: view.zoom }
      renderer.userMoved = Boolean(view.userMoved)
    }
  } catch {
    /* no session storage — start fresh */
  }
  ui = new FarmUI(sheets, actions)

  state = await fetchState()
  if (!localStorage.getItem(SETTINGS_KEY) && state.settings) settings = { ...DEFAULTS, ...withoutZoom(state.settings) }
  await Promise.all([pollLinks(), poll()])
  document.getElementById('boot')?.remove()
  if (!localStorage.getItem('terminalfarm.seen-help')) {
    ui.showHelp()
    try {
      localStorage.setItem('terminalfarm.seen-help', '1')
    } catch {
      /* fine */
    }
  }
  setInterval(() => (settings.terminalOnly ? poll() : Date.now() - lastFullPoll > POLL_MS && poll()), TERMINAL_POLL_MS)
  setInterval(pollLinks, LINKS_MS)
  // When the farm is rebuilt, the page notices and reloads itself — an open tab used to keep
  // running yesterday's code and look as if a change had not landed.
  setInterval(checkForNewBuild, 20000)
  setInterval(() => model && rebuild(), 60000)
  window.addEventListener('focus', poll)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && poll())
  loop()
}

let last = 0
function loop(t = 0) {
  requestAnimationFrame(loop)
  // Couriers walk; everything else only blinks. Twenty frames a second is plenty for both.
  if (t - last < 50 && !renderer.animating && !tour) return
  last = t
  renderer.frame()
}

// ---------- input ----------
let drag = null
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, moved: 0 }
  canvas.setPointerCapture(e.pointerId)
})
canvas.addEventListener('pointermove', (e) => {
  if (drag) {
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    drag.moved += Math.abs(dx) + Math.abs(dy)
    drag.x = e.clientX
    drag.y = e.clientY
    if (drag.moved > 4) {
      renderer.panBy(dx, dy)
      canvas.classList.add('dragging')
      ui.tip(null)
    }
    return
  }
  const h = renderer?.hitTest(e.offsetX, e.offsetY)
  canvas.style.cursor = h ? 'pointer' : 'grab'
  if (!h) return ui?.tip(null)
  const text =
    h.kind === 'crates' ? harvestTip(model.plots.get(h.name)) :
    h.kind === 'flag' ? `🚩 컨텍스트 ${model.plots.get(h.name)?.contextPct}% — 80%를 넘어 곧 압축(대화 요약)될 수 있습니다` :
    h.kind === 'board' ? (h.home ? '📜 농가 게시판 — 모든 대화에 붙는 전역 규칙' : `📜 게시판 — ${model.plots.get(h.name)?.short || ''} · 읽은 규칙 파일`) :
    h.kind === 'tractor' ? `🚜 ${h.tractor.short} — ${h.tractor.repo}를 가져다 쓰는 중${h.tractor.use?.label ? ` (최근: ${h.tractor.use.label})` : ''}` :
    h.kind === 'helper' ? `${h.work.role === 'home' ? '📍' : '🚜'} ${h.work.short} — ${h.name}${h.work.role === 'home' ? '에서 일하는 중' : '를 가져다 쓰는 중'}` :
    h.kind === 'thread' ? `${h.thread.title || '(제목 없음)'}` :
    h.kind === 'plot' ? `${model.plots.get(h.name)?.label || h.name} · 일꾼 ${model.plots.get(h.name)?.threads.length || 0}` :
    h.kind === 'mailbox' ? `우편함 — 나를 기다림 ${model.counts.waiting || 0}${model.counts.waiting ? ' · 누르면 그 터미널로' : ''}` : '농가 — 전역 규칙 게시판 · 우편함'
  ui.tip(text, e.clientX, e.clientY)
})
canvas.addEventListener('pointerup', (e) => {
  const wasDrag = drag && drag.moved > 4
  drag = null
  canvas.classList.remove('dragging')
  if (wasDrag || !renderer) return
  const h = renderer.hitTest(e.offsetX, e.offsetY)
  if (!h) return actions.closeDialog()
  if (h.kind === 'thread') selectThread(h.thread)
  else if (h.kind === 'board') actions.showRules(h.home ? 'home' : h.name)
  else if (h.kind === 'crates' || h.kind === 'flag') {
    const lead = findThread(model.plots.get(h.name)?.leadId)
    if (lead) selectThread(lead)
  }
  else if (h.kind === 'tractor' || h.kind === 'helper') {
    const lead = findThread(h.kind === 'tractor' ? h.tractor.leadId : h.work.leadId)
    if (lead) selectThread(lead)
  } else if (h.kind === 'plot' && isTabPlot(h.name)) {
    const lead = findThread(model.plots.get(h.name)?.leadId)
    if (lead) selectThread(lead)
  } else if (h.kind === 'plot') selectPlot(h.name)
  else if (h.kind === 'mailbox') actions.nextWaiting()
  else if (h.kind === 'home') {
    selectedPlot = null
    selectedThread = null
    rebuild()
    ui.showHome(model.home, { terminalMode: settings.terminalOnly, waiting: model.counts.waiting || 0, rules: model.globalRules.length })
  }
})
/**
 * A trackpad pinch arrives as wheel events with ctrlKey set; two-finger scrolling arrives as
 * plain wheel events with small deltas and usually some sideways movement. Pinch zooms, smoothly
 * and in proportion; two fingers pan. A mouse wheel — big vertical notches — zooms a step.
 */
canvas.addEventListener('wheel', (e) => {
  e.preventDefault()
  if (!renderer) return
  if (e.ctrlKey) return renderer.zoomBy(Math.exp(-e.deltaY * 0.012), e.offsetX, e.offsetY)
  const trackpad = e.deltaMode === 0 && (Math.abs(e.deltaX) > 0 || Math.abs(e.deltaY) < 50)
  if (trackpad) return renderer.panBy(-e.deltaX, -e.deltaY)
  renderer.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.offsetX, e.offsetY)
}, { passive: false })
// Safari reports a pinch as gesture events instead.
let gestureScale = 1
canvas.addEventListener('gesturestart', (e) => {
  e.preventDefault()
  gestureScale = 1
})
canvas.addEventListener('gesturechange', (e) => {
  e.preventDefault()
  renderer?.zoomBy(e.scale / gestureScale, e.clientX, e.clientY)
  gestureScale = e.scale
})
window.addEventListener('resize', () => renderer?.resize())
window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea') || e.metaKey || e.ctrlKey) return
  const k = e.key.toLowerCase()
  if (tour) {
    if (k === 'arrowright' || k === ' ' || k === 'enter') return e.preventDefault(), actions.tourNext()
    if (k === 'arrowleft') return actions.tourPrev()
    if (k === 'escape' || k === 't') return actions.endTour()
  }
  const map = { n: 'nextWaiting', j: 'toggleJournal', b: 'toggleBoard', l: 'toggleLinks', z: 'toggleSleeping', m: 'toggleSound', s: 'showSettings', '?': 'showHelp', 0: 'fit', c: 'newSessionHere', h: 'showHidden', t: 'startTour', k: 'toggleLegend' }
  if (k === 'escape') {
    if (!ui.panel.hidden) return ui.closePanel()
    if (journalOpen) return actions.toggleJournal()
    return actions.closeDialog()
  }
  if (k === '+' || k === '=') return renderer.zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1)
  if (k === '-') return renderer.zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, -1)
  const pan = { arrowleft: [80, 0], arrowright: [-80, 0], arrowup: [0, 80], arrowdown: [0, -80] }[k]
  if (pan) return renderer.panBy(...pan)
  if (map[k]) actions[map[k]]()
})

boot().catch((err) => {
  const b = document.getElementById('boot')
  if (b) b.textContent = `시작하지 못했습니다 — ${err.message}`
  console.error(err)
})

// For poking at the farm from the console.
window.terminalFarm = { get model() { return model }, get layout() { return layout }, get routes() { return routes }, actions }
Object.defineProperty(window, 'terminalFarmRenderer', { get: () => renderer })
