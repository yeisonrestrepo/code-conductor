import type { FlowSummary, LaneRow, RecentRow, Verdict } from '../types'

type FlowEvent = { ts: number; tool: string; verdict: Verdict; guard: number | null; code: string | null; target: string; passed?: number[] }

// Mirrors the hook's DISPATCH table (spec D3), as the browser viewer and flow-cli.mjs do.
const LANES: [string, string[], number[]][] = [
  ['Read', ['Read'], [4, 1]],
  ['Write', ['Write', 'create_file', 'write_file'], [5, 6, 2]],
  ['Edit', ['Edit'], [5, 6]],
  ['Bash', ['Bash'], [7, 3]],
  ['Agent', ['Agent', 'SendMessage'], [6]],
]

export const GUARD_NAMES: Record<number, string> = {
  1: 'Large read', 2: 'Duplicate write', 3: 'Bash scan', 4: 'Blocked read',
  5: 'Band scope', 6: 'Orchestrator run', 7: 'Role shell',
}

// Same transport as the browser viewer, but a bad line is skipped here instead of blanking everything.
export function parseEvents(text: string): { events: FlowEvent[]; unreadable: number } {
  const events: FlowEvent[] = []
  let unreadable = 0
  for (const line of text.split('\n')) {
    if (!line) continue
    try { events.push(JSON.parse(line.slice(10, -2))) } catch { unreadable++ }
  }
  return { events, unreadable }
}

export function chainOf(e: FlowEvent): string {
  const mark = { allow: '✓', deny: '✕', ask: '?' }
  const steps = (e.passed ?? []).map(g => `G${g}✓`)
  if (e.guard) steps.push(`G${e.guard}${mark[e.verdict]}`)
  return steps.join(' → ')
}

function laneRow([name, tools, guards]: [string, string[], number[]], events: FlowEvent[]): LaneRow {
  const mine = events.filter(e => tools.includes(e.tool))
  return {
    name,
    calls: mine.length,
    guards: guards.map(guard => {
      const reached = mine.filter(e => e.guard === guard || (e.passed ?? []).includes(guard))
      const deny = reached.filter(e => e.guard === guard && e.verdict === 'deny').length
      const ask = reached.filter(e => e.guard === guard && e.verdict === 'ask').length
      return { guard, name: GUARD_NAMES[guard], passed: reached.length - deny - ask, deny, ask }
    }),
  }
}

export function summarize(text: string, recentCount = 6): FlowSummary {
  const { events, unreadable } = parseEvents(text)
  const count = (v: Verdict) => events.filter(e => e.verdict === v).length
  const recent: RecentRow[] = events.slice(-recentCount).reverse().map(e => ({
    tool: e.tool, verdict: e.verdict, target: String(e.target).slice(0, 48), chain: chainOf(e), code: e.code ?? '',
  }))
  return {
    total: events.length, allow: count('allow'), deny: count('deny'), ask: count('ask'), unreadable,
    lanes: LANES.map(lane => laneRow(lane, events)), recent,
  }
}
