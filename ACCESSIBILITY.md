# Accessibility

## Commitment

code-conductor is committed to being usable by everyone. As a CLI tool that
runs inside terminal emulators, its accessibility depends on both its own
design choices and the capabilities of the host terminal.

## Current state

### What works well

- **Pure text interface.** All output is plain text rendered by the user's
  terminal and is compatible with screen readers that support terminal
  applications (e.g. NVDA, JAWS, VoiceOver, Orca).
- **No colour-only signalling.** Blocked and allowed outcomes are
  communicated through words (`BLOCKED`, `DENIED`, `allowed`), not colour
  alone.
- **No mouse requirement.** Every interaction is keyboard-driven.
- **No audio or visual-only cues.** The tool never relies on sound, animation
  or images to convey information.
- **Structured documentation.** README, CONTRIBUTING and all docs use heading
  hierarchy, lists and tables that assistive technology can navigate.

### Known limitations

- **Terminal dependency.** Accessibility features (font size, contrast, cursor
  behaviour) are controlled by the terminal emulator, not by code-conductor.
  If your terminal does not support high contrast or screen reader integration,
  code-conductor cannot compensate.
- **Long output lines.** Some guard-denial messages and SNAP envelopes produce
  long single lines. Terminals without automatic line wrapping may require
  horizontal scrolling.
- **No internationalisation.** All output is in English. There is no
  localisation layer.

## Supported environments

code-conductor is tested on:

- **Windows:** Windows Terminal, PowerShell, Git Bash
- **macOS:** Terminal.app, iTerm2
- **Linux:** GNOME Terminal, Konsole, common xterm-compatible emulators

Screen reader compatibility has been verified with:

- NVDA (Windows)
- VoiceOver (macOS)

## Reporting barriers

If you encounter an accessibility barrier — something that prevents you from
installing, configuring or using code-conductor effectively — please open an
issue with the label **accessibility**, or email
**yeison.restrepo.r@gmail.com**.

Include:

1. What you were trying to do
2. What barrier you encountered
3. Your terminal emulator and operating system
4. Your assistive technology, if applicable

We treat accessibility barriers as bugs: they enter the normal intake process
and receive a minted id.

## Guidelines we follow

- [WCAG 2.1](https://www.w3.org/WAI/WCAG21/quickref/) principles where
  applicable to CLI tools (Perceivable, Operable, Understandable, Robust)
- Semantic, structured Markdown in all documentation
- Plain language over jargon where possible
