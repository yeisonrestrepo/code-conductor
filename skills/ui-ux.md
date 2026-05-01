# UI/UX Design Skill

**Activate for frontend projects.** Loaded by `/stack` when React, Angular, Next.js, or similar is detected.

## Core Design Principles

### Visual Hierarchy
Every screen has one primary action. Size, weight, and color guide the eye. Never give everything the same visual weight.

### Whitespace as Signal
Empty space communicates grouping and separation. Use it intentionally, not as padding.

### Consistency System
Same action → same appearance, always. Design tokens are the source of truth.

### Motion with Purpose
Animation communicates state change, not decoration. Entrance: 150–200ms ease-out. Exit: 100ms ease-in. Never more than one animation at a time.

---

## Component Approach

Before writing any component:
1. Identify its position in the visual hierarchy
2. List all states it must handle
3. Define all variants

**Required states for interactive elements:**
- default
- hover / focus
- active / pressed
- disabled
- loading
- error
- empty (for lists and containers)

---

## Design Tokens

### Spacing (4px base grid)
```
4px  — xs   tight grouping
8px  — sm   within components
12px — md   between related elements
16px — lg   section padding
24px — xl   between sections
32px — 2xl  page margins
48px — 3xl  major sections
```

### Typography Scale
```
12px / 0.75rem  — caption
14px / 0.875rem — body-sm
16px / 1rem     — body (base)
18px / 1.125rem — body-lg
20px / 1.25rem  — heading-sm
24px / 1.5rem   — heading-md
30px / 1.875rem — heading-lg
36px / 2.25rem  — display
```

### Semantic Color Tokens
```
--color-primary           main brand action
--color-primary-hover
--color-secondary         secondary actions
--color-surface           card/panel backgrounds
--color-surface-raised    elevated surfaces
--color-border            dividers, inputs
--color-text              primary text
--color-text-muted        secondary text
--color-error             destructive, validation
--color-success           confirmation, completed
--color-warning           caution
```

---

## Common Patterns

### Cards
- Consistent border-radius (8px or 12px — pick one per project, use it everywhere)
- Surface background, not white
- Subtle border or shadow — not both
- Clear hierarchy within: title > meta > content > actions

### Forms
- Labels above inputs, always
- Placeholder ≠ label — never rely on placeholder as the only label
- Error messages below the field, in `--color-error`, with an icon
- One primary submit button, visually distinct from secondary actions
- Disable + show spinner when submitting

### Tables
- Fixed column widths for numeric data
- Alternating row backgrounds only for dense data
- Sortable columns: show sort icon always, filled when active
- Empty state: message + CTA (not just a blank table)

### Navigation
- Active state is visually unambiguous
- Hover state gives feedback on every interactive element
- Breadcrumbs for > 2 levels deep
- Mobile: bottom nav or hamburger — not both

### Feedback (Toast / Alert)
- Success: auto-dismiss after 4s
- Error: persist until user dismisses
- Position: top-right or bottom-center — pick one per project
- Never block primary content

---

## Anti-Patterns

- **Flat gray cards** — no contrast, no hierarchy; looks broken
- **All buttons the same weight** — primary/secondary/ghost distinction is mandatory
- **No hover states** — every interactive element needs visual feedback
- **Color as sole differentiator** — always pair with shape, icon, or text
- **Modal for everything** — use inline, toast, or side panel first; modal only for destructive confirms
- **Submit with no loading state** — always disable + show spinner during async operations

---

## Accessibility Baseline

- **Contrast:** 4.5:1 for normal text, 3:1 for large text (WCAG AA)
- **Keyboard nav:** all interactive elements reachable and operable by keyboard
- **Focus indicators:** visible ring on every interactive element — never `outline: none` without a custom replacement
- **Images:** `alt` text on all `<img>`; decorative images use `alt=""`
- **Forms:** every input has an associated `<label>` via `for`/`id` or `aria-label`

---

## Tailwind Conventions

- **Design tokens:** defined in `tailwind.config.js` — never use raw hex in class attributes
- **Group/peer modifiers:** `group-hover:`, `peer-checked:` for dependent state styling
- **Gap over margin:** use `gap-*` on flex/grid containers, not margin between children
- **Dark mode:** `dark:` variant driven by `class="dark"` on `<html>`
- **Variants:** use `cva()` (class-variance-authority) for component variants — not ternaries in JSX
