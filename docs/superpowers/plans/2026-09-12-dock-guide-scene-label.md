# Dock Scene Label + Chinese Scaffolds Implementation Plan

> **For agentic workers:** Task-by-task; PR scoped to Dock labels + catalog Chinese templates.

**Goal:** Align Dock header with Refine (show scene name); prefill Chinese scaffolds for domestic UX; keep English systemOverlay.

## Task 1: Dock header labels

- [x] `PromptDockPanel.vue` / `ImageDockPanel.vue`: icon + label, chip layout, ellipsis
- [x] `getGenerationScene` for active label

## Task 2: Chinese scaffolds (G + E)

- [x] Translate all `promptScaffold` and `changePreserveTemplate` to Chinese; keep `{{PLACEHOLDERS}}`
- [x] Leave `systemOverlay` English
- [x] Update any tests that assert English scaffold substrings

## Task 3: Verify + PR

- [x] vitest shared catalog + guideSceneApply + guideEditIntentApply
- [ ] mydev: branch commit PR CI
