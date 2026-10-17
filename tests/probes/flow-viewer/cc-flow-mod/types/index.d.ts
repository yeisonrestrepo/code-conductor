export type Verdict = 'allow' | 'deny' | 'ask'

export type GuardCell = { guard: number; name: string; passed: number; deny: number; ask: number }

export type LaneRow = { name: string; calls: number; guards: GuardCell[] }

export type RecentRow = { tool: string; verdict: Verdict; target: string; chain: string; code: string }

export type FlowSummary = {
  total: number
  allow: number
  deny: number
  ask: number
  unreadable: number
  lanes: LaneRow[]
  recent: RecentRow[]
}

declare module 'claude-code' {
  interface PluginState {
    'cc-flow': { summary: FlowSummary | null; isExpanded: boolean }
  }
}
