import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { FlowSummary, RecentRow, Verdict } from '../types'
import { summarize } from './summary'

const EVENTS_FILE = '.claude/flow-events.js'
const POLL_MS = 1500
const summary = atom({ plugin: 'cc-flow', key: 'summary' } as const, null)
const isExpanded = atom({ plugin: 'cc-flow', key: 'isExpanded' } as const, false)
const COLOR: Record<Verdict, 'success' | 'error' | 'warning'> = { allow: 'success', deny: 'error', ask: 'warning' }
const MARK: Record<Verdict, string> = { allow: '✓', deny: '✕', ask: '?' }

export const register: Register = on => {
  let lastText: string | null = null

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'cc-flow', description: 'Expand or collapse the code-conductor guard flow above the prompt' })
    // Re-read only when the file changed, so an idle session does not redraw.
    $.clock.every(POLL_MS, async () => {
      const text = await $.fs.read(EVENTS_FILE).catch(() => null)
      if (text === null || text === lastText) return
      lastText = text
      await update($, summary, () => summarize(text))
    })
    return next(e)
  })

  on('command.run', { command: 'cc-flow' }, async $ => {
    const now = await update($, isExpanded, v => !v)
    return { text: now ? 'Flow expanded above the prompt. Press e or run /cc-flow to collapse.' : 'Flow collapsed to one line.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, summary)
    if (e.props.hasSurvey || s === null || s.total === 0) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const expanded = await read($, isExpanded)
    const toggle = (
      <Button key="toggle" label={expanded ? 'collapse' : 'expand'} hotkey="e" plain dimColor
        onPress={() => update($, isExpanded, v => !v)} />
    )
    return (
      <Box flexDirection="column">
        <Box>
          <Text dimColor>flow </Text>
          <Text color="success">✓{s.allow} </Text>
          <Text color={s.deny ? 'error' : 'subtle'}>✕{s.deny} </Text>
          <Text color={s.ask ? 'warning' : 'subtle'}>?{s.ask} </Text>
          {lastLine(Text, s.recent[0])}
          <Text>  </Text>
          {toggle}
        </Box>
        {expanded ? expandedRows(Box, Text, s) : null}
      </Box>
    )
  })
}

function lastLine(Text: any, last: RecentRow | undefined) {
  if (!last) return null
  const detail = `${last.tool} ${last.target}${last.code ? ' ' + last.code : ''}`
  return <Text dimColor>· last <Text color={COLOR[last.verdict]}>{MARK[last.verdict]}</Text> {detail.slice(0, 50)}</Text>
}

function expandedRows(Box: any, Text: any, s: FlowSummary) {
  return (
    <Box flexDirection="column" marginTop={1}>
      {s.lanes.map(lane => (
        <Box key={lane.name}>
          <Text bold>{lane.name.padEnd(6)}</Text>
          <Text dimColor>{String(lane.calls).padStart(3)} </Text>
          {lane.guards.map(g => (
            <Text key={g.guard}>  <Text bold>G{g.guard}</Text> {g.name} <Text color="success">✓{g.passed}</Text> <Text color={g.deny ? 'error' : 'subtle'}>✕{g.deny}</Text> <Text color={g.ask ? 'warning' : 'subtle'}>?{g.ask}</Text></Text>
          ))}
        </Box>
      ))}
      <Text dimColor>recent</Text>
      {s.recent.map((r, i) => (
        <Box key={String(i)}>
          <Text color={COLOR[r.verdict]}> {MARK[r.verdict]} </Text>
          <Text>{r.tool.padEnd(6)} {r.target.padEnd(30)} </Text>
          <Text dimColor>{r.chain}</Text>
          {r.code ? <Text color="error"> {r.code}</Text> : null}
        </Box>
      ))}
      {s.unreadable ? <Text color="warning">{s.unreadable} unreadable line(s) skipped</Text> : null}
    </Box>
  )
}
