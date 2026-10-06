/**
 * The structure tour: the farm explained one piece at a time, each piece next to the thing it
 * stands for. The steps follow the order the ideas build on each other — the agent, where it
 * works, the rules it reads, what it reaches for, how far it reaches, how it is running — and
 * end on all of it at once: the shape of the work around an agent, nothing grander.
 *
 * Each step names a rectangle of tiles to frame. `focus` gets a small context with the layout
 * and the farm model, so a step can point at whatever is actually on this farm right now.
 */

const pad = (r, n = 0.5) => r && { x: r.x - n, y: r.y - n, w: r.w + 2 * n, h: r.h + 2 * n }

/** Helpers the steps use to find things on this particular farm. */
export function tourContext(layout, model) {
  const zone = (land) => layout.zones.find((z) => z.land === land) || null
  const plot = (name) => {
    const p = layout.plots.get(name)
    return p ? { x: p.x, y: p.y, w: p.w, h: p.h } : null
  }
  const tabPlots = [...model.plots.values()].filter((p) => p.tabPlot && layout.plots.has(p.name)).sort((a, b) => a.tab - b.tab)
  const whole = () => ({ x: 0, y: 0, w: layout.W, h: layout.H })
  // The biggest repo zone, for "this is where the repos are".
  const repoZone = () => layout.zones.filter((z) => !['active', 'shared'].includes(z.land)).sort((a, b) => b.w * b.h - a.w * a.h)[0] || null
  const brought = model.tractors?.[0] || null
  // For the rules step, the terminal whose board has the most layers on it (a repo's own rules
  // as well as the global and folder ones) shows the stacking best.
  const layers = (p) => new Set((p.rules || []).filter((r) => r.kind !== 'AutoMem').map((r) => (r.nested ? 'repo' : r.kind))).size * 10 + (p.rules || []).length
  const richestRules = tabPlots.slice().sort((a, b) => layers(b) - layers(a) || a.tab - b.tab)[0] || null
  return { layout, model, zone, plot, tabPlots, whole, repoZone, brought, richestRules }
}

export const TOUR = [
  {
    title: '이게 제 AI 에이전트 농장입니다',
    body: '일꾼 한 명 한 명이 지금 터미널에서 일하는 AI 에이전트입니다. 에이전트가 일할 때 어떤 구조로 돌아가는지 농장 그림으로 하나씩 보겠습니다.',
    real: '터미널 농장 = 내 컴퓨터의 에이전트 세션을 그대로 그린 지도',
    focus: (c) => c.whole(),
  },
  {
    title: '일꾼 = 에이전트',
    body: 'Terminal 탭 하나가 에이전트 하나, 땅 하나입니다. 초록 「작업 중」은 일하는 중, 빨간 「내 차례」는 제 답을 기다리는 중입니다.',
    real: '클로드 코드·코덱스 같은 코딩 에이전트가 돌아가는 터미널 탭',
    focus: (c) => pad(c.zone('active'), 0.6),
  },
  {
    title: '땅 = 레포(작업 폴더)',
    body: '에이전트가 일하는 작업장은 레포, 곧 프로젝트 폴더입니다. 업무 성격별로 밭·과수원·장터 같은 구역을 나눴고, 흙길과 수로는 레포끼리 서로 가져다 쓰는 연결입니다.',
    real: '레포 = 코드·문서가 든 폴더(깃 저장소)',
    focus: (c) => pad(c.repoZone(), 0.6),
  },
  {
    title: '게시판 = 규칙 파일',
    body: '에이전트는 일을 시작하면 게시판부터 읽습니다. 농가의 큰 게시판은 모든 일에 붙는 전역 규칙이고, 땅 옆 게시판은 그 터미널이 실제로 읽은 규칙입니다.',
    real: 'CLAUDE.md · AGENTS.md — 전역 → 폴더 → 레포 순서로 겹겹이',
    focus: (c) => {
      const t = c.richestRules && c.plot(c.richestRules.name)
      return t ? { x: t.x - 0.5, y: t.y - 0.5, w: t.w + 2, h: t.h + 1 } : c.whole()
    },
  },
  {
    title: '창고 = 스킬 · 메모리 · 도구',
    body: '스킬은 필요할 때 꺼내 보는 작업 설명서, 메모리는 지난 일을 적어 둔 일지, 도구는 직접 만든 스크립트입니다. 짐 든 심부름꾼이 창고에 다녀오면 그걸 꺼내 쓰는 중입니다.',
    real: '스킬(SKILL.md) · 메모리(MEMORY.md) · 도구(스크립트 저장소)',
    focus: (c) => pad(c.zone('shared') || c.zone('forge'), 0.6),
  },
  {
    title: '트랙터 = 다른 레포를 가져다 쓰기',
    body: (c) =>
      c.brought
        ? `한 에이전트가 다른 레포를 쓰면 그 탭 색 트랙터가 레포 땅과 터미널 땅을 오갑니다. 지금은 ${c.brought.tabName} 트랙터가 ${c.brought.repo} 땅을 오가고 있습니다. 일 하나가 여러 폴더에 걸쳐 있다는 뜻입니다.`
        : '한 에이전트가 다른 레포를 쓰면 그 탭 색 트랙터가 레포 땅과 터미널 땅을 오갑니다. 지금은 다른 레포를 쓰는 터미널이 없어서, 쓰기 시작하면 나타납니다.',
    real: '에이전트가 다른 폴더의 파일을 읽고 · 고치고 · 실행함',
    focus: (c) => (c.brought ? pad(c.plot(c.brought.from), 0.6) : pad(c.zone('active'), 0.6)),
  },
  {
    title: '계기판 = 모델 · 노력 · 모드 · 컨텍스트',
    body: '🐮 누가 일하나(모델) · ★ 얼마나 깊게 생각하나(노력) · 🤖 얼마나 맡기나(모드). 땅의 작물이 차오른 만큼 작업 기억(컨텍스트)이 찬 것이고, 80%를 넘으면 깃발이 섭니다. 옆에 쌓인 상자는 압축(대화를 요약해 비운) 횟수입니다.',
    real: '모델 · effort · 권한 모드 · 컨텍스트 창 · 압축(/compact) · 사용 한도',
    focus: (c) => {
      const t = c.tabPlots[0] && c.plot(c.tabPlots[0].name)
      return t ? { x: t.x - 1.6, y: t.y - 0.6, w: t.w + 2.2, h: t.h + 1 } : c.whole()
    },
    clock: true,
  },
  {
    title: '이게 에이전트가 일하는 구조입니다',
    body: '일꾼(에이전트)이 게시판(규칙)을 읽고, 창고에서 스킬·메모리·도구를 꺼내, 땅(레포)에서 일합니다. 요즘은 이걸 「하네스」라고도 부르는데, 거창하게 짤 것 없이 이 그림 한 장을 머릿속에 두면 충분합니다.',
    real: '에이전트 + 규칙 파일 + 스킬 + 메모리 + 도구 + 레포',
    focus: (c) => c.whole(),
  },
]

/** A step's text, with the parts that depend on the farm filled in. */
export const stepText = (step, ctx) => ({
  title: step.title,
  body: typeof step.body === 'function' ? step.body(ctx) : step.body,
  real: step.real,
})
