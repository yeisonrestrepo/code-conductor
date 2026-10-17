import { expect, mock, test } from 'claude-code/testing'

const line = (e: object) => 'flowEvent(' + JSON.stringify(e) + ');\n'
const FIXTURE =
  line({ ts: 1, tool: 'Read', verdict: 'allow', guard: null, code: null, target: 'src/app.js', passed: [4, 1] }) +
  line({ ts: 2, tool: 'Bash', verdict: 'deny', guard: 3, code: 'P9', target: 'for', passed: [7] }) +
  line({ ts: 3, tool: 'Write', verdict: 'ask', guard: 2, code: 'ALREADY', target: 'src/app.js', passed: [5, 6] })

const PROPS = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 110, scroll: { offset: 0, bodyRows: 20 }, view: {} }
const SURFACES = ['terminal', 'desktop'] as const

async function startWith($: any, on: any, text: string | null) {
  const clock = mock.clock(on)
  on('session.start', async (_$: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', async (_$: any, e: any) => ({ value: { command: e.name } }))
  on('fs.read', async () => {
    if (text === null) throw new Error('ENOENT')
    return { value: text }
  })
  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
  await clock.advance(1600)
}

for (const surface of SURFACES) {
  test(`${surface}: collapsed to one line by default`, async ($, on) => {
    await startWith($, on, FIXTURE)
    const ui = await $.ui.mount({ plugin: 'cc-flow', surface, component: 'AbovePrompt', props: PROPS as any })
    expect((await ui.find({ text: /✓1/ }))).toBeDefined()
    expect((await ui.find({ text: /✕1/ }))).toBeDefined()
    expect((await ui.find({ text: /Write src\/app\.js ALREADY/ }))).toBeDefined()
    expect(await ui.find({ text: /Bash scan/ })).toBeUndefined()
  })

  test(`${surface}: the toggle expands to lanes and guard chains, and collapses back`, async ($, on) => {
    await startWith($, on, FIXTURE)
    const ui = await $.ui.mount({ plugin: 'cc-flow', surface, component: 'AbovePrompt', props: PROPS as any })
    await ui.press({ key: 'toggle' })
    expect(await ui.find({ text: /Bash scan/ })).toBeDefined()
    expect(await ui.find({ text: /G7✓ → G3✕/ })).toBeDefined()
    await ui.press({ key: 'toggle' })
    expect(await ui.find({ text: /Bash scan/ })).toBeUndefined()
  })
}

test('/cc-flow toggles the same state', async ($, on) => {
  await startWith($, on, FIXTURE)
  const first = await $.command.run({ command: 'cc-flow', args: '' } as any)
  expect(first.text).toMatch(/expanded/)
  const second = await $.command.run({ command: 'cc-flow', args: '' } as any)
  expect(second.text).toMatch(/collapsed/)
})

test('no event file: the band stays out of the way', async ($, on) => {
  // Stands for the engine's own band: what the person sees when the mod yields.
  on('ui.render', async ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
  await startWith($, on, null)
  const ui = await $.ui.mount({ plugin: 'cc-flow', surface: 'terminal', component: 'AbovePrompt', props: PROPS as any })
  expect(await ui.find({ text: /engine band/ })).toBeDefined()
  expect(await ui.find({ text: /flow/ })).toBeUndefined()
})

test('a torn line is skipped and counted, the rest still shows', async ($, on) => {
  await startWith($, on, FIXTURE + 'flowEvent({"ts":4,"tool":"Ba')
  const ui = await $.ui.mount({ plugin: 'cc-flow', surface: 'terminal', component: 'AbovePrompt', props: PROPS as any })
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ text: /1 unreadable line/ })).toBeDefined()
  expect(await ui.find({ text: /✕1/ })).toBeDefined()
})
