import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'statusline.mjs')

function run(input, { args = [], wrapFile } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-status-'))
  const env = { ...process.env, TERMINAL_FARM_STATUS: dir, TERMINAL_FARM_WRAP_FILE: wrapFile || path.join(dir, 'none.json') }
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { input, env, encoding: 'utf8' })
  return { ...r, dir }
}

test('the status line copy lands per session, and the short line shows model and context', () => {
  const input = JSON.stringify({ session_id: 'abc-123', model: { display_name: 'Opus 5.5' }, context_window: { used_percentage: 52.4 } })
  const r = run(input)
  assert.equal(r.status, 0)
  assert.equal(r.stdout, 'Opus 5.5 · 🧠 52%\n')
  assert.equal(fs.readFileSync(path.join(r.dir, 'abc-123.json'), 'utf8'), input)
})

test('a session id that is not a plain name is never used as a file name', () => {
  const r = run(JSON.stringify({ session_id: '../escape', model: { display_name: 'Opus' } }))
  assert.equal(r.status, 0)
  assert.deepEqual(fs.readdirSync(r.dir), [])
})

test('input that is not JSON leaves the status line quiet and unbroken', () => {
  const r = run('not json')
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
})

test('--wrap runs the person’s own status line with the same input and keeps its output', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-wrap-'))
  const wrapFile = path.join(dir, 'statusline-wrap.json')
  fs.writeFileSync(wrapFile, JSON.stringify({ command: "printf 'mine:'; cat | head -c 15" }))
  const input = JSON.stringify({ session_id: 'wrap-1', model: { display_name: 'Opus' } })
  const r = run(input, { args: ['--wrap'], wrapFile })
  assert.equal(r.stdout, `mine:${input.slice(0, 15)}`)
  assert.equal(fs.readFileSync(path.join(r.dir, 'wrap-1.json'), 'utf8'), input)
})

test('--wrap with nothing to wrap falls back to the short line', () => {
  const r = run(JSON.stringify({ session_id: 'w2', model: { display_name: 'Sonnet' } }), { args: ['--wrap'] })
  assert.equal(r.stdout, 'Sonnet\n')
})
