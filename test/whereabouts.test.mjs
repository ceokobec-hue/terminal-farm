/**
 * Which plot a thread lands on — especially a thread opened at the folder that holds the repos,
 * which is where most of the work on the machine this was built for actually starts.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'farm-where-'))
const claudeHome = path.join(tmp, 'claude')
const codexHome = path.join(tmp, 'codex')
process.env.CLAUDE_CONFIG_DIR = claudeHome
process.env.CODEX_HOME = codexHome
const { placeThreads } = await import('../server/whereabouts.mjs')

const root = path.join(tmp, 'repos')
const repos = ['alpha', 'beta', 'notes'].map((name) => ({ name, path: path.join(root, name) }))

async function transcript(id, text) {
  const dir = path.join(claudeHome, 'projects', '-tmp-repos')
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(path.join(dir, `${id}.jsonl`), text)
}
async function rollout(id, text) {
  const dir = path.join(codexHome, 'sessions', '2026', '10', '05')
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(path.join(dir, `rollout-2026-10-05T10-00-00-${id}.jsonl`), text)
}

const now = Date.now()
const thread = (id, projectPath, extra = {}) => ({ id, harness: 'claude-code', project: path.basename(projectPath), projectPath, lastActivityAt: now - 60000, ref: {}, ...extra })

test('threads land on the right plot, and say how that was decided', async () => {
  const U1 = '11111111-1111-1111-1111-111111111111'
  const U2 = '22222222-2222-2222-2222-222222222222'
  const U3 = '33333333-3333-3333-3333-333333333333'
  const C1 = '019a0000-0000-7000-8000-000000000001'
  await transcript(U1, `edit ${root}/alpha/a.js\n`.repeat(20) + `read ${root}/notes/memo.md\n`.repeat(50) + `read ${root}/beta/b.js\n`.repeat(2))
  await transcript(U2, `${root}/alpha/x\n${root}/beta/y\n${root}/alpha/z\n${root}/beta/w\n`)
  await transcript(U3, `nothing about repos at all\n`)
  await rollout(C1, `{"cmd":"cd ~/repos/beta && npm test"}\n`.repeat(5))

  const threads = [
    thread('root-clear', root, { ref: { cliSessionId: U1 } }),
    thread('root-tie', root, { ref: { cliSessionId: U2 } }),
    thread('root-silent', root, { ref: { cliSessionId: U3 } }),
    thread('codex-root', root, { harness: 'codex', ref: { sessionId: C1 } }),
    thread('in-repo', path.join(root, 'beta', 'sub', 'dir')),
    thread('temp', '/private/tmp/scratch/x'),
    thread('news', '/work/newsletter', { project: 'newsletter' }),
    thread('news-images', '/work/newsletter/out/images', { project: 'images' }),
    thread('old-root', root, { ref: { cliSessionId: U1 }, lastActivityAt: now - 30 * 864e5 }),
  ]
  const placed = await placeThreads(threads, { roots: [root], repos, hubs: ['notes'], now })
  const at = (id) => placed.get(id)

  // The memory repo is named most often, but it is a hub — alpha wins among the rest.
  assert.deepEqual(at('root-clear'), { plot: 'alpha', how: 'transcript', share: 0.91 })
  // Two mentions each: below the three-mention floor, so nobody wins.
  assert.deepEqual(at('root-tie'), { plot: null, how: 'unknown' })
  assert.deepEqual(at('root-silent'), { plot: null, how: 'unknown' })
  assert.equal(at('codex-root').plot, 'beta')
  assert.deepEqual(at('in-repo'), { plot: 'beta', how: 'folder' })
  assert.equal(at('temp').how, 'temp')
  // A sub-folder of an outside work folder lands with that folder's own threads.
  assert.deepEqual(at('news'), { plot: 'newsletter', how: 'outside' })
  assert.deepEqual(at('news-images'), { plot: 'newsletter', how: 'outside' })
  // Transcripts are only read for recent work; an old root thread stays at the farmhouse.
  assert.deepEqual(at('old-root'), { plot: null, how: 'unknown' })
})
