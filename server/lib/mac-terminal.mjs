/**
 * macOS Terminal.app plumbing: front the tab a live session is already running in, or open a
 * new tab running a command.
 *
 * The sibling of `windows.mjs`. Fronting matters more than opening: a Claude Code session that
 * is alive in a terminal tab must not be resumed a second time somewhere else — two processes on
 * one transcript fork the conversation. So "open" for a live session means "show me that tab",
 * found by the tty of the session's own process.
 *
 * Both go through `osascript` with the variable part passed as an argument, never spliced into
 * the script, so a folder name with quotes in it cannot become AppleScript. The first time,
 * macOS asks whether this may control Terminal; until that is allowed both simply fail and the
 * caller falls back.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const TIMEOUT_MS = 5000

/** `/dev/ttys008` for a pid that has a terminal, '' otherwise. */
export async function ttyOfPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return ''
  try {
    const { stdout } = await run('ps', ['-o', 'tty=', '-p', String(pid)], { timeout: TIMEOUT_MS })
    const tty = stdout.trim()
    return tty && tty !== '??' ? `/dev/${tty}` : ''
  } catch {
    return ''
  }
}

const FRONT_TAB = `on run argv
  set target to item 1 of argv
  if application "Terminal" is not running then return "none"
  set winName to ""
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is target then
          -- A window in the Dock comes back; then its tab, then the window, then the app.
          if miniaturized of w then set miniaturized of w to false
          set selected of t to true
          set frontmost of w to true
          set index of w to 1
          set winName to name of w
          exit repeat
        end if
      end repeat
      if winName is not "" then exit repeat
    end repeat
    activate
  end tell
  if winName is "" then return "none"
  return winName
end run`

/**
 * macOS can merge Terminal windows into one window with a tab bar. AppleScript still sees one
 * window per tab, and raising that window does not change which tab the tab bar shows — only
 * pressing the tab does. That takes System Events (Accessibility), so it is the second step,
 * and when it is not allowed the first step's raise is what you get.
 */
const TAB_TITLES = `set sep to character id 9
tell application "System Events" to tell process "Terminal"
  set out to ""
  set wi to 0
  repeat with w in windows
    set wi to wi + 1
    try
      set bi to 0
      repeat with b in (radio buttons of tab group 1 of w)
        set bi to bi + 1
        set out to out & wi & sep & bi & sep & (title of b) & linefeed
      end repeat
    end try
  end repeat
  return out
end tell`

const PRESS_TAB = `on run argv
  set wi to (item 1 of argv) as integer
  set bi to (item 2 of argv) as integer
  tell application "System Events" to tell process "Terminal"
    click radio button bi of tab group 1 of window wi
  end tell
  tell application "Terminal" to activate
  return "pressed"
end run`

/**
 * The part of a Terminal title that names the session — the segment after the folder, without
 * the spinner Claude Code puts in front of it while it works.
 */
export function sessionPartOf(title) {
  // Only the session's own title: the process shown after it ("python", "caffeinate") changes
  // from one second to the next and would make the same tab read differently twice.
  const parts = String(title || '').replace(/ — \d+×\d+$/, '').split(' — ')
  return (parts.length > 1 ? parts[1] : parts[0]).replace(/^[^\p{L}\p{N}~]+/u, '').trim()
}

async function pressMatchingTab(winName) {
  const want = sessionPartOf(winName)
  if (!want) return false
  let listing
  try {
    listing = (await run('osascript', ['-e', TAB_TITLES], { timeout: TIMEOUT_MS })).stdout
  } catch {
    return false // no Accessibility permission, or no tab bar at all
  }
  const tabs = listing
    .split('\n')
    .map((l) => l.split('\t'))
    .filter((f) => f.length >= 3)
    .map(([w, b, ...title]) => ({ w, b, part: sessionPartOf(title.join('\t')) }))
  const hit = tabs.find((t) => t.part === want) || tabs.find((t) => t.part && (t.part.startsWith(want) || want.startsWith(t.part)))
  if (!hit) return false
  try {
    await run('osascript', ['-e', PRESS_TAB, hit.w, hit.b], { timeout: TIMEOUT_MS })
    return true
  } catch {
    return false
  }
}

// "tab" inside a Terminal or System Events block means their tab class, not a tab character —
// so the separator is made before either is addressed.
const LIST_WINDOWS = `set sep to character id 9
if application "Terminal" is not running then return ""
tell application "Terminal"
  set out to ""
  repeat with w in windows
    repeat with t in tabs of w
      set out to out & (tty of t) & sep & (name of w) & linefeed
    end repeat
  end repeat
  return out
end tell`

let tabsCache = { at: 0, value: new Map() }

/**
 * `pid → { title, index }` for sessions running in Terminal.app: the title the person sees on
 * the tab and, when windows are merged into a tab bar, the tab's position in it (1 = leftmost).
 * Read at most every few seconds; the page polls often and AppleScript is not free.
 */
export async function terminalTabsFor(pids) {
  const out = new Map()
  if (process.platform !== 'darwin' || !pids.length) return out
  if (Date.now() - tabsCache.at < 4000 && pids.every((p) => tabsCache.value.has(p))) {
    for (const p of pids) out.set(p, tabsCache.value.get(p))
    return out
  }
  let ttyByPid = new Map()
  try {
    const { stdout } = await run('ps', ['-o', 'pid=,tty=', '-p', pids.join(',')], { timeout: TIMEOUT_MS })
    for (const line of stdout.split('\n')) {
      const [pid, tty] = line.trim().split(/\s+/)
      if (pid && tty && tty !== '??') ttyByPid.set(Number(pid), `/dev/${tty}`)
    }
  } catch {
    return out
  }
  const nameByTty = new Map()
  try {
    const { stdout } = await run('osascript', ['-e', LIST_WINDOWS], { timeout: TIMEOUT_MS })
    for (const line of stdout.split('\n')) {
      const [tty, ...name] = line.split('\t')
      if (tty) nameByTty.set(tty, name.join('\t'))
    }
  } catch {
    return out
  }
  // Tab-bar order, when there is a tab bar and Accessibility lets us read it.
  const order = new Map()
  try {
    const { stdout } = await run('osascript', ['-e', TAB_TITLES], { timeout: TIMEOUT_MS })
    for (const line of stdout.split('\n')) {
      const [w, b, ...title] = line.split('\t')
      if (!b) continue
      const part = sessionPartOf(title.join('\t'))
      if (part && !order.has(part)) order.set(part, { index: Number(b), group: Number(w) })
    }
  } catch {
    /* no tab bar, or not allowed to read it — titles still work */
  }
  for (const pid of pids) {
    const name = nameByTty.get(ttyByPid.get(pid))
    if (!name) continue
    const title = sessionPartOf(name)
    out.set(pid, { title, index: order.get(title)?.index ?? null })
  }
  tabsCache = { at: Date.now(), value: out }
  return out
}

/** Bring the Terminal.app tab hosting `pid` to the front. True only if a tab was found. */
export async function frontTerminalTab(pid) {
  if (process.platform !== 'darwin') return false
  const tty = await ttyOfPid(pid)
  if (!tty) return false
  let winName
  try {
    winName = (await run('osascript', ['-e', FRONT_TAB, tty], { timeout: TIMEOUT_MS })).stdout.trim()
  } catch {
    return false
  }
  if (!winName || winName === 'none') return false
  await pressMatchingTab(winName)
  return true
}

/**
 * A new Terminal tab in the tab bar the person's sessions are in — or a new window when that
 * cannot be done. AppleScript cannot make a tab; Shell ▸ New Tab (⌘T) can, and it adds one to
 * the *front* window, so the window holding one of the sessions (by tty, items 2… of argv) comes
 * forward first — a stray window left in front used to get the tab instead. The menu is pressed
 * only once Terminal is in front. The command then goes to the window that was not there before
 * and to no other: typed into an existing tab it would land in somebody's running Claude Code as
 * a message.
 */
const NEW_TAB = `on run argv
  set cmd to item 1 of argv
  set ttys to {}
  if (count of argv) > 1 then set ttys to items 2 thru -1 of argv
  tell application "Terminal" to set oldIds to id of every window
  if (count of oldIds) > 0 then
    if (count of ttys) > 0 then
      tell application "Terminal"
        set found to false
        repeat with w in windows
          repeat with t in tabs of w
            if ttys contains (tty of t) then
              if miniaturized of w then set miniaturized of w to false
              set index of w to 1
              set found to true
              exit repeat
            end if
          end repeat
          if found then exit repeat
        end repeat
      end tell
    end if
    tell application "Terminal" to activate
    set ready to false
    repeat 20 times
      tell application "System Events"
        if (name of first application process whose frontmost is true) is "Terminal" then set ready to true
      end tell
      if ready then exit repeat
      delay 0.1
    end repeat
    if ready then
      -- Shell ▸ New Tab ▸ the ⌘T item, pressed through the menu: found by its shortcut, not its
      -- name, so it works in any language. A synthetic ⌘T keystroke was silently dropped.
      set pressed to false
      tell application "System Events" to tell process "Terminal"
        repeat with mbi in (menu bar items 2 thru -1 of menu bar 1)
          try
            repeat with mi in menu items of menu 1 of mbi
              try
                repeat with sub in menu items of menu 1 of mi
                  if (value of attribute "AXMenuItemCmdChar" of sub) is "T" and (value of attribute "AXMenuItemCmdModifiers" of sub) is 0 then
                    click sub
                    set pressed to true
                    exit repeat
                  end if
                end repeat
              end try
              if pressed then exit repeat
            end repeat
          end try
          if pressed then exit repeat
        end repeat
      end tell
      if not pressed then tell application "System Events" to keystroke "t" using command down
      repeat 30 times
        delay 0.1
        tell application "Terminal"
          repeat with w in windows
            if oldIds does not contain (id of w) then
              do script cmd in selected tab of w
              return "tab"
            end if
          end repeat
        end tell
      end repeat
    end if
  end if
  tell application "Terminal"
    activate
    do script cmd
  end tell
  return "window"
end run`

/** Waiting for Terminal to come forward and for the new tab can take a few seconds. */
const NEW_TAB_TIMEOUT_MS = 12000

/** Single-quote for the shell Terminal runs the command in. */
const sh = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`

/**
 * A new Terminal.app tab (or window) in `cwd`, running `argv` — next to the sessions running
 * as `nearPids`, when there are any.
 */
export async function openInAppleTerminal(argv, cwd, nearPids = []) {
  const line = `cd ${sh(cwd)} && ${argv.map(sh).join(' ')}`
  const ttys = (await Promise.all(nearPids.map(ttyOfPid))).filter(Boolean)
  try {
    const how = (await run('osascript', ['-e', NEW_TAB, line, ...ttys], { timeout: NEW_TAB_TIMEOUT_MS })).stdout.trim()
    return { ok: true, how }
  } catch (err) {
    return { ok: false, error: `Terminal 앱을 열지 못했습니다 (${String(err.message || err).split('\n')[0]})` }
  }
}
