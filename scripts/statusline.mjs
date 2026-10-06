#!/usr/bin/env node
/**
 * 터미널 농장 ↔ 클로드 코드 상태줄 연결.
 *
 * 클로드 코드는 상태줄을 새로 그릴 때마다 세션 정보(JSON)를 상태줄 명령의 표준 입력으로 넘깁니다.
 * 이 스크립트는 그 JSON 을 세션마다 `~/.claude/terminal-farm-status/<session_id>.json` 에 그대로 두고
 * (농장이 모델·노력·컨텍스트 %를 여기서 읽습니다 — server/status.mjs), 상태줄에 보일 한 줄을 출력합니다.
 *
 *   node scripts/statusline.mjs          저장 + 짧은 상태줄 「모델 · 🧠 컨텍스트 %」
 *   node scripts/statusline.mjs --wrap   저장 + 원래 쓰던 상태줄 명령을 같은 입력으로 실행해 그 출력을 그대로
 *                                        (원래 명령은 data/statusline-wrap.json 의 "command" — INSTALL.md 4단계)
 *
 * 무엇이 잘못돼도 상태줄을 깨뜨리지 않도록 조용히 넘어갑니다. 아무것도 밖으로 보내지 않습니다.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = process.env.TERMINAL_FARM_STATUS || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'terminal-farm-status')
const WRAP_FILE = process.env.TERMINAL_FARM_WRAP_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'statusline-wrap.json')

function readInput() {
  try {
    return fs.readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

/** One copy per session, swapped in whole so the farm never reads half a file. */
function save(input, data) {
  const sid = typeof data?.session_id === 'string' ? data.session_id : ''
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sid)) return
  try {
    fs.mkdirSync(DIR, { recursive: true })
    const file = path.join(DIR, `${sid}.json`)
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, input)
    fs.renameSync(tmp, file)
  } catch {
    /* 저장이 안 돼도 상태줄은 그대로 */
  }
}

function shortLine(data) {
  const model = data?.model?.display_name || data?.model?.id || ''
  const pct = data?.context_window?.used_percentage
  return [model, Number.isFinite(pct) ? `🧠 ${Math.round(pct)}%` : ''].filter(Boolean).join(' · ')
}

/** The person's own status line, run as before: same input, same shell, its output untouched. */
function runWrapped(input) {
  let command = ''
  try {
    command = JSON.parse(fs.readFileSync(WRAP_FILE, 'utf8')).command || ''
  } catch {
    return false
  }
  if (typeof command !== 'string' || !command.trim()) return false
  const shell = process.platform === 'win32' ? true : fs.existsSync('/bin/bash') ? '/bin/bash' : true
  const r = spawnSync(command, { shell, input, encoding: 'utf8', timeout: 5000 })
  if (r.stdout) process.stdout.write(r.stdout)
  return true
}

const input = readInput()
let data = null
try {
  data = JSON.parse(input)
} catch {
  /* JSON 이 아니면 저장만 건너뜀 */
}
save(input, data)

if (!(process.argv.includes('--wrap') && runWrapped(input))) {
  const line = shortLine(data)
  if (line) process.stdout.write(`${line}\n`)
}
