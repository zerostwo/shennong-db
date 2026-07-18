# Agent-first WebUI design QA

## Comparison target

- Source visual truth: `/home/duansq/.codex/attachments/b19af5b7-5604-490c-9d9f-68aef68551b4/codex-clipboard-360d4962-e6a5-4226-8043-d38500f66179.png`
- Settings source: `/home/duansq/.codex/attachments/bfddf6fc-0623-4385-bcd5-a80a833af112/codex-clipboard-541b9649-dfd5-4b78-b022-1e272bde732f.png`
- Implementation: `docs/screenshots/webui/agent-chat-1512x801.png`
- Settings implementation: `docs/screenshots/webui/settings-model-live-1512x801.png`
- Viewport: `1512 x 801` CSS pixels, device scale factor 1
- State: light theme; guest Agent new-chat home for the full view; authenticated model-provider settings for the focused view

## Evidence

- Full-view combined comparison: `docs/screenshots/webui/design-qa-comparison-1512x801.png`
- Focused settings comparison: `docs/screenshots/webui/design-qa-settings-comparison-1512x801.png`
- Additional rendered states: centered Search, persisted Agent thread with tool events and citations, and authenticated private Resource views under `docs/screenshots/webui/*-live-1512x801.png`

These screenshots are the prior `0.7.0` visual-comparison baseline. No replacement
browser screenshot was captured for `0.8.0`; they remain evidence for the shell,
spacing, responsive layout, and settings-dialog direction, not a claim that the
new `0.8.0` states were visually recaptured. The focused settings comparison is
included because the provider form, sidebar alignment, controls, and warning
copy are too small to judge reliably in the full view alone.

Current `0.8.0` evidence is implementation and automated-check based:

- `webui/components/chat-markdown.tsx` and its component test cover formatted
  Markdown, GitHub-flavored tables, and safe link rendering.
- `webui/components/chat-view.tsx` covers reasoning disclosure, per-turn token
  usage, reasoning effort, and per-thread Skill selection.
- `webui/lib/settings-route.ts` and its tests cover hash-addressed Settings
  routes such as `/#settings/Account` while preserving the active workspace.
- `webui/components/memory-manager.tsx`, `project-memory-view.tsx`,
  `project-tabs.tsx`, and the Project Chat route cover global Memory, Project
  Memory, and Project-bound conversations.
- The current frontend type check, lint, 35-test suite, and production build
  completed successfully. These checks verify rendering and interaction
  contracts, but they do not replace a new visual screenshot comparison.

## Findings

No actionable P0, P1, or P2 visual differences remain.

- Fonts and typography: the system sans-serif stack, neutral weights, zero letter spacing, compact navigation labels, and restrained heading scale match the reference language. Text wraps without clipping at every checked width.
- Spacing and layout rhythm: the fixed desktop sidebar, unframed workspace, centered composer, low-radius controls, and settings split pane preserve the reference's quiet density. The simpler sidebar and centered new-chat state are intentional product changes for the Agent-first scope.
- Colors and visual tokens: the interface stays within the reference's white, soft gray, charcoal, and semantic warning palette. Borders and shadows remain subtle and accessible.
- Image and icon fidelity: the reference does not depend on editorial imagery. Familiar outline icons come from the existing Lucide library; no placeholder art or hand-drawn SVG substitute is visible.
- Copy and content: `Resources` replaces `Catalog`; guest users see both `Sign in` and `Create account`; model settings use provider-and-key discovery followed by a model dropdown and explicit private-data policy copy; ordinary users do not see Admin navigation.
- Intentional deviations: the source shows a project history surface and a narrower general-settings modal. ShennongDB instead presents the requested Agent new-chat task first and uses a wider settings dialog so provider URLs, models, data policy, and warnings remain legible.

## Comparison history

1. Earlier responsive pass: at `761-900px`, the desktop sidebar offset could leave the main workspace narrower than the viewport. The responsive main-column rule was extended through `900px`; post-fix browser checks passed at `761`, `800`, and `900` pixels with no hidden composer or overlapping controls.
2. Final visual pass: the revised implementation was captured again at `1512 x 801` and compared in one combined image with the source. No new P0-P2 issue was found.

## Prior browser checks

- Guest Agent home, ordinary registration entry, sign-in entry, centered and focused Search dialog, live `toil` result, and public Resources passed.
- Authenticated Agent history, tool activity, citations, model editing, explicit private-data warning, and private Resource visibility passed.
- Admin authentication and the live User Management API passed; ordinary users cannot see the Admin center.
- Responsive checks passed at widths `375`, `761`, `800`, `900`, and `1440`.
- No framework error overlay, visible request failure, or API `5xx` was observed in the completed browser flows.

These browser checks belong to the prior visual baseline. The `0.8.0` additions
were validated by the current automated interaction and build checks listed
above; a fresh browser capture was intentionally not claimed here.

## Implementation checklist

- [x] Match the reference's neutral ChatGPT-style shell and interaction density.
- [x] Keep Search centered and keyboard-focused.
- [x] Include ordinary registration, Resources, Agent model settings, and Admin User Management.
- [x] Render Agent Markdown and expose reasoning, reasoning effort, token usage, and Skills without shifting the conversation layout.
- [x] Preserve Chat or Project state behind hash-routed Settings.
- [x] Add Project Chat, global Memory, and Project Memory with tested routes and stable navigation.
- [x] Verify desktop, mobile, and intermediate responsive widths.
- [x] Verify core live API-backed flows and clean temporary QA data afterward.

final result: passed
