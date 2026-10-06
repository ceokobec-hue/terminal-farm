/**
 * What a terminal session is doing, read off its transcript — and where its couriers walk.
 *
 * The transcript is append-only and can be huge, so the reader keeps a cursor per file; the
 * test that matters most is that a second read picks up only what was appended.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { activityOf, describeTool, touchesOf, withoutWrittenText } from '../server/activity.mjs'
import { tripsFor, repoOfPath, reposUsed } from '../server/trips.mjs'
import { dday, statusTag } from '../src/farm/render.js'

const line = (o) => JSON.stringify(o) + '\n'
const user = (text, ts) => line({ type: 'user', timestamp: ts, message: { role: 'user', content: text } })
const tool = (name, input, ts, id = `tu_${Math.random()}`) =>
  line({ type: 'assistant', timestamp: ts, message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } })
const result = (id, text, ts) => line({ type: 'user', timestamp: ts, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } })
const say = (text, ts) => line({ type: 'assistant', timestamp: ts, message: { role: 'assistant', content: [{ type: 'text', text }] } })

test('a tool call reads the way a person would say it', () => {
  assert.equal(describeTool('Edit', { file_path: '/x/y/render.js' }), '파일 수정: render.js')
  assert.equal(describeTool('Bash', { command: 'npm test', description: '시험 돌리기' }), '명령 실행: 시험 돌리기')
  assert.equal(describeTool('Skill', { skill: 'insert-order' }), '스킬 사용: insert-order')
})

test('the turn, its steps, the last thing said and the task list come out of the transcript', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'farm-act-'))
  const file = path.join(dir, 's.jsonl')
  await fsp.writeFile(
    file,
    user('first ask', '2026-10-05T10:00:00Z') +
      tool('TaskCreate', { subject: 'Read code', activeForm: 'Reading code' }, '2026-10-05T10:00:05Z', 'c1') +
      result('c1', 'Task #1 created successfully: Read code', '2026-10-05T10:00:06Z') +
      tool('TaskCreate', { subject: 'Write tests', activeForm: 'Writing tests' }, '2026-10-05T10:00:07Z', 'c2') +
      result('c2', 'Task #2 created successfully: Write tests', '2026-10-05T10:00:08Z') +
      user('second ask', '2026-10-05T11:00:00Z') +
      tool('TaskUpdate', { taskId: '1', status: 'completed' }, '2026-10-05T11:00:01Z') +
      tool('TaskUpdate', { taskId: '2', status: 'in_progress' }, '2026-10-05T11:00:02Z') +
      tool('Read', { file_path: '/repo/a.js' }, '2026-10-05T11:00:03Z') +
      say('Here is what I found.', '2026-10-05T11:00:04Z'),
  )
  const a = await activityOf(file)
  assert.equal(a.turnStartedAt, Date.parse('2026-10-05T11:00:00Z'))
  assert.equal(a.toolsInTurn, 3)
  assert.equal(a.lastTool.label, '파일 읽기: a.js')
  assert.equal(a.lastText, 'Here is what I found.')
  assert.deepEqual(a.tasks, { total: 2, done: 1, current: 'Writing tests' })

  // Appended later: only the new lines are read, and they move the state on.
  await fsp.appendFile(file, tool('TaskUpdate', { taskId: '2', status: 'completed' }, '2026-10-05T11:05:00Z'))
  const b = await activityOf(file)
  assert.deepEqual(b.tasks, { total: 2, done: 2, current: '' })
  assert.equal(b.toolsInTurn, 4)
})

test('touches outside the session\'s own plot become trips, newest first, until they expire', async () => {
  const root = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'farm-trip-')), 'repos')
  for (const r of ['work', 'skills', 'memory-repo', 'other']) await fsp.mkdir(path.join(root, r), { recursive: true })
  const now = Date.now()
  const thread = {
    id: 't1',
    activity: {
      // Oldest first, the way the transcript appends them.
      touches: [
        { kind: 'read', path: path.join(root, 'other', 'old.txt'), label: 'old.txt 읽기', at: now - 60 * 60000 },
        { kind: 'read', path: path.join(root, 'other', 'notes.txt'), label: 'notes.txt 읽기', at: now - 60000 },
        { kind: 'edit', write: true, path: path.join(root, 'other', 'out.json'), label: 'out.json 수정', at: now - 30000 },
        { kind: 'read', path: path.join(root, 'work', 'mine.js'), label: 'mine.js 읽기', at: now - 20000 },
      ],
    },
  }
  const trips = await tripsFor(thread, 'work', [root], now)
  // Newest first; a touch inside the session's own plot is not a trip; an hour-old one has expired.
  assert.deepEqual(trips.map((t) => [t.kind, t.from, t.to]), [['edit', 'work', 'other'], ['read', 'other', 'work']])
  assert.equal(await repoOfPath(path.join(root, 'skills', 'x', 'SKILL.md'), [root]), 'skills')
})

test('every repo a session reaches into is counted, a command naming two repos counting both', async () => {
  const root = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'farm-uses-')), 'repos')
  for (const r of ['work', 'video', 'promo']) await fsp.mkdir(path.join(root, r), { recursive: true })
  const file = path.join(root, '..', 's.jsonl')
  await fsp.writeFile(
    file,
    user('make the multicam cut and the promo posts', '2026-10-05T10:00:00Z') +
      tool('Read', { file_path: path.join(root, 'video', 'cuts', 'a.srt') }, '2026-10-05T10:00:01Z') +
      tool('Read', { file_path: path.join(root, 'video', 'cuts', 'b.srt') }, '2026-10-05T10:00:02Z') +
      tool('Edit', { file_path: path.join(root, 'promo', 'posts', 'reel.md') }, '2026-10-05T10:00:03Z'),
  )
  const a = await activityOf(file)
  const seen = {}
  for (const u of a.uses) {
    const r = await repoOfPath(u.key, [root])
    seen[r] = seen[r] || { edits: 0, reads: 0 }
    seen[r].edits += u.edits
    seen[r].reads += u.reads
  }
  assert.deepEqual(seen, { video: { edits: 0, reads: 2 }, promo: { edits: 1, reads: 0 } })
  // A command that names two repos sends one courier but counts as using both.
  const [run, ...more] = touchesOf('Bash', { command: 'python /Users/me/repos/tools/cut.py /Users/me/repos/video/out.mp4', description: 'cut' })
  assert.equal(more.length, 0)
  assert.equal(run.path, '/Users/me/repos/tools/cut.py')
  assert.deepEqual(run.also, ['/Users/me/repos/video/out.mp4'])
})

test('a path in text written to a file is not a place the session went; a script that runs is', () => {
  const write = "cat > /Users/me/repos/work/shot.mjs <<'EOF'\nconst repo = '/Users/me/repos/video'\nEOF\nnode /Users/me/repos/work/shot.mjs"
  assert.equal(withoutWrittenText(write), "cat > /Users/me/repos/work/shot.mjs <<'EOF'\nnode /Users/me/repos/work/shot.mjs")
  const [t] = touchesOf('Bash', { command: write })
  assert.deepEqual([t.path, ...t.also], ['/Users/me/repos/work/shot.mjs'])
  const run = "python3 - <<'EOF'\nopen('/Users/me/repos/video/a.txt').read()\nEOF"
  assert.equal(withoutWrittenText(run), run)
})

test('each compaction is counted as a harvest, auto or manual, with what it freed', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'farm-compact-'))
  const file = path.join(dir, 's.jsonl')
  const compact = (trigger, pre, post, ts) => line({ type: 'system', subtype: 'compact_boundary', timestamp: ts, compactMetadata: { trigger, preTokens: pre, postTokens: post } })
  await fsp.writeFile(file, user('go', '2026-10-05T10:00:00Z') + compact('auto', 969893, 14926, '2026-10-05T11:00:00Z') + compact('manual', 300000, 9000, '2026-10-05T12:00:00Z'))
  const a = await activityOf(file)
  assert.equal(a.compacts.count, 2)
  assert.deepEqual(a.compacts.list.map((c) => c.trigger), ['auto', 'manual'])
  assert.deepEqual([a.compacts.last.pre, a.compacts.last.post], [300000, 9000])
})

test("the repos a terminal is using: this hour's and this turn's, newest first, its own and unknown ones left out", async () => {
  const root = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'farm-used-')), 'repos')
  for (const r of ['work', 'video', 'promo', 'old']) await fsp.mkdir(path.join(root, r), { recursive: true })
  const now = Date.now()
  const use = (repo, at, extra = {}) => ({ key: path.join(root, repo, 'x'), edits: 0, reads: 1, runs: 0, skills: 0, firstAt: at, lastAt: at, label: `${repo} 읽기`, ...extra })
  const thread = {
    activity: {
      turnStartedAt: now - 3 * 3600000,
      uses: [
        use('work', now - 1000),
        use('video', now - 5 * 60000, { edits: 2 }),
        use('promo', now - 2 * 3600000),
        use('old', now - 5 * 3600000),
        use('$r', now - 1000),
      ],
    },
  }
  const used = await reposUsed(thread, 'work', [root], now)
  // promo is two hours old but belongs to the turn still running; old is from before it.
  assert.deepEqual(used.map((u) => [u.repo, u.edits, u.reads]), [['video', 2, 1], ['promo', 0, 1]])
  // Once the turn is recent, only the last hour counts.
  thread.activity.turnStartedAt = now - 60000
  assert.deepEqual((await reposUsed(thread, 'work', [root], now)).map((u) => u.repo), ['video'])
})

test('deadlines count calendar days', () => {
  const now = new Date(2026, 9, 5, 22, 0).getTime()
  assert.equal(dday('2026-10-07', now).text, 'D-2')
  assert.equal(dday('2026-10-05', now).text, '오늘 마감')
  assert.equal(dday('2026-10-03', now).text, '마감 2일 지남')
  assert.equal(dday('nonsense', now), null)
})

test("a farmhand's tag says working, your turn, or only its deadline", () => {
  const now = Date.now()
  assert.match(statusTag({ status: 'working', activity: { turnStartedAt: now - 6 * 60000 } }, now).text, /^작업 중 6분/)
  assert.match(statusTag({ status: 'waiting', terminal: { since: now - 30 * 60000 } }, now).text, /^내 차례 · 30분째/)
  assert.equal(statusTag({ status: 'idle' }, now), null)
  const named = statusTag({ status: 'idle', terminal: { tab: { index: 5, title: '여행 사진 앨범 정리하기 하네스' } } }, now)
  assert.equal(named.text, '탭5 여행 사진 앨범 정리… · 쉬는 중')
  assert.ok(statusTag({ status: 'idle' }, now, '2099-01-01').text.startsWith('D-'))
})
