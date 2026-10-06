/**
 * Repo links, read off a fake ~/repos.
 *
 * Every rule in server/links.mjs exists because a real folder of repos produced a wrong link
 * without it, so each gets a fixture here: guard code naming a project only to refuse it, a
 * notes repo that mentions everything, a dependency on another repo's node_modules, and a
 * mention in a brief rather than in code.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { findLinks, workspaceRoots } from '../server/links.mjs'

async function write(file, text) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.writeFile(file, text)
}

async function fixture() {
  const root = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'farm-links-')), 'repos')
  const repo = (name) => path.join(root, name)
  for (const name of ['alpha', 'beta', 'gamma', 'd1', 'd2', 'd3', 'd4', 'd5', 'notes']) await fsp.mkdir(path.join(repo(name), '.git'), { recursive: true })
  await write(path.join(repo('beta'), '.firebaserc'), JSON.stringify({ projects: { default: 'beta-proj-01' } }))
  await write(path.join(repo('beta'), 'firebase.json'), JSON.stringify({ hosting: [{ site: 'beta-site' }] }))
  // alpha runs beta's tool and talks to beta's site — both in code.
  await write(path.join(repo('alpha'), 'run.py'), 'TOOL = "~/repos/beta/tool.py"\nURL = "https://beta-site.web.app/x"\n')
  // …and refuses to deploy to beta's project, which is not a link.
  await write(path.join(repo('alpha'), 'scripts/assert-project.mjs'), "if (p === 'beta-proj-01') throw new Error('no')\n")
  await write(path.join(repo('alpha'), 'deploy.sh'), "[ \"$P\" != \"beta-proj-01\" ] || exit 1  # 금지\n")
  // alpha mentions gamma only in a brief.
  await write(path.join(repo('alpha'), 'docs/plan.md'), 'See ~/repos/gamma for the old version.\n')
  // gamma borrows beta's node_modules and nothing else.
  await write(path.join(repo('gamma'), 'shot.mjs'), "import { chromium } from '/Users/someone/repos/beta/node_modules/playwright/index.mjs'\n")
  // notes mentions every other repo — a hub, not a neighbour.
  await write(path.join(repo('notes'), 'index.json'), JSON.stringify(['alpha', 'beta', 'gamma', 'd1', 'd2', 'd3', 'd4', 'd5'].map((n) => `~/repos/${n}/x`)))
  // an old folder name some scripts still use
  await write(path.join(repo('d1'), 'make.py'), 'SRC = "~/Desktop/old/tools/thing.py"\n')
  return root
}

const find = (links, from, to, kind) => links.find((l) => l.from === from && l.to === to && l.kind === kind)

test('a path and a site used in code are both links, from the user to the owner', async () => {
  const root = await fixture()
  const { links } = await findLinks([root])
  const p = find(links, 'alpha', 'beta', 'path')
  const d = find(links, 'alpha', 'beta', 'data')
  assert.ok(p && d)
  assert.equal(p.source, 'code')
  assert.equal(d.source, 'code')
  assert.equal(p.evidence[0].file, 'run.py')
})

test('guard code that names a project to refuse it is not a link', async () => {
  const root = await fixture()
  const { links } = await findLinks([root])
  const d = find(links, 'alpha', 'beta', 'data')
  assert.equal(d.count, 1, 'only the web.app line counts')
  assert.ok(d.evidence.every((e) => !/assert-project|deploy\.sh/.test(e.file)))
})

test('a mention in a brief is a docs link, not a code one', async () => {
  const root = await fixture()
  const { links } = await findLinks([root])
  assert.equal(find(links, 'alpha', 'gamma', 'path').source, 'docs')
})

test('borrowing another repo only for its node_modules is a weak link', async () => {
  const root = await fixture()
  const { links } = await findLinks([root])
  assert.equal(find(links, 'gamma', 'beta', 'path').weak, true)
  assert.equal(find(links, 'alpha', 'beta', 'path').weak, false)
})

test('a repo that mentions nearly every other one is a hub and draws no links', async () => {
  const root = await fixture()
  const { links, hubs } = await findLinks([root])
  assert.deepEqual(hubs, ['notes'])
  assert.ok(!links.some((l) => l.from === 'notes'))
})

test('an old folder name maps to today\'s repo only when told to', async () => {
  const root = await fixture()
  await fsp.mkdir(path.join(root, 'team-tools', '.git'), { recursive: true })
  const plain = await findLinks([root])
  assert.ok(!find(plain.links, 'd1', 'team-tools', 'path'))
  const aliased = await findLinks([root], { aliases: { 'Desktop/old/tools': 'team-tools' } })
  assert.ok(find(aliased.links, 'd1', 'team-tools', 'path'))
})

test('a folder holding three or more git repos is a workspace root; a single repo is not', async () => {
  const root = await fixture()
  assert.deepEqual(await workspaceRoots([root, path.join(root, 'alpha')]), [root])
})
