# Launch checklist

**Posting is the owner's act.** No agent session publishes anything from this file.

## The one rule

**Every reply in every thread cites the repository rather than asserting from memory.**

Not "I think it was around 40 commands" but "47 events, 43 unique, `project.md:991`". Not "we fixed all of them" but "36 of 43, zero unplanned regressions, same table". If a claim cannot be traced to a commit, a record entry or a re-runnable measurement within the time it takes to answer, **the honest reply is that you will check and come back.**

This is not modesty. The entire pitch is that the project's claims are checkable, so a single hand-waved reply in a thread costs more than the thread is worth.

Corollary: **when someone finds something wrong, confirm it in the open and link the fix.** The README already names three known defects. A reader who finds a fourth has done the project a favour and the reply should say so.

## Before anything is posted

- [ ] `npm test` green on `main` (996 passed / 12 skipped at `1.33.0`)
- [ ] `node tools/version-gate.mjs` reports `VERSION_GATE_OK`
- [ ] `node tools/record-parity.mjs` reports `RECORD_PARITY_OK`
- [ ] Every figure in the Show HN body re-verified against the sources listed at the end of `SHOW-HN-DRAFT.md`
- [ ] The recording made, watched once end to end, and scene 3 confirmed to allow
- [ ] **README's Quickstart transcript re-verified against a pristine scratch install, on the day of posting.** Not a remembered run, not a run from last week: a fresh `mktemp -d`, a fresh `HOME`, one invocation. **The cheapest claim for a reader to falsify must be the best-verified one.** This line exists because the Quickstart shipped once with output a fresh install does not produce, after an agent ran the installer twice and attributed the second run's output to the first.
- [ ] `[FEAT-038]` shipped: GitHub topics set, `package.json` keywords published, About line written
- [ ] The deny, adapt, allow GIF exported from the recording and embedded at the top of the README
- [ ] `[BUG-045]` published as a GitHub issue, verbatim from its backlog entry including the priced ritual, labeled `help wanted`: it is the exemplar of how this project files a defect, and an open, honest, well-specified issue is an invitation to contribute

## Channels

| Channel | What goes there | Notes |
|---|---|---|
| **Show HN** | `SHOW-HN-DRAFT.md` body, title candidate 1 | Post it yourself, in your own voice. Be present for the first two hours; a Show HN with an absent author reads as a drive-by. |
| **r/ClaudeAI** | A shorter version leading with the Guard 3 arc and the GIF | This audience wants the demo first and the discipline second. Invert the Show HN's order. |
| **awesome-claude-code PR** | One line in the appropriate section, linking the repo | Read their contribution guidelines first and match the existing entries' format exactly. A PR that ignores the house style is a bad first impression in a curated list. |

## Ordering

Show HN first, on its own, and let it run. The other two are follow-ups, not a simultaneous blast: a coordinated push across three channels on one day reads as marketing, which is the opposite of the thing being claimed.

## What not to do

- **Do not quote a number from the post while replying.** Re-read it from the source. The post is a snapshot; the repository is the truth.
- **Do not defend the known defects.** They are in the README because they are real. "Yes, that one is still open, here is the entry" is a complete answer.
- **Do not describe it as a security tool.** It is advisory tooling against context exhaustion and sloppy habits. Someone will ask, and the honest answer is in the README under *What this is not*.
- **Do not let an agent post.** Including replies.

## After the posts: sustain, do not campaign

The launch is not the marketing. The record is. Three standing practices, all owner acts:

- **Answer where the conversation already happens.** Threads about guardrail friction in Claude Code get a reply that links the denial record and the fix commit, not a pitch. If the answer is not in the repo, say you will check and come back.
- **One technical post per notable release**, written from the release's own spec and plan, published only when the release is out and the claims are bisectable. No cadence quota: a release with nothing to teach gets no post.
- **When a reader finds a defect, confirm it in the open, thank them, and link the fix when it lands.** The known-limits section of the README is the template for the tone.
