# Creator Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add creator-first controls: message edit, swipes/regeneration, Character Card V2 PNG import, richer world book matching/depth, and dynamic memory fact extraction.

**Architecture:** Keep the existing no-framework Node/HTML app. Add small focused modules for character card import and memory fact extraction, extend SessionService/AgentService for message revision workflows, and keep all persisted state in JSON under `data/`.

**Tech Stack:** Node.js ESM, built-in `node:test`, vanilla browser JavaScript, JSON file storage.

---

### Task 1: Failing Tests

**Files:**
- Modify: `tests/agentService.test.js`
- Modify: `tests/httpApi.test.js`
- Modify: `tests/promptAssembler.test.js`
- Create: `tests/characterCardImport.test.js`

- [ ] Add tests for `AgentService.editMessage()` trimming the conversation after an edited user message and regenerating from the new content.
- [ ] Add tests for `AgentService.regenerateAssistantMessage()` preserving assistant swipes and switching the active swipe.
- [ ] Add HTTP tests for `PATCH /api/messages/:messageId`, `POST /api/messages/:messageId/regenerate`, and `POST /api/character-card/import`.
- [ ] Add world book tests for regex matching, selective secondary keys, constant entries, and depth-specific insertion sections.
- [ ] Add Character Card V2 import tests for raw V2 JSON and PNG `Chara/chara` metadata.

Run: `npm test`
Expected before implementation: tests fail because the methods, routes, parser, and new prompt sections do not exist.

### Task 2: Message Editing And Swipes

**Files:**
- Modify: `server/services/agentService.js`
- Modify: `server/app.js`
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `public/styles.css`

- [ ] Add service methods to edit a message, trim later history, then regenerate if editing a user message.
- [ ] Add service method to regenerate the assistant after the previous user turn, store generated variants in `swipes`, and set `activeSwipeIndex`.
- [ ] Add JSON API routes for edit/regenerate.
- [ ] Add UI buttons beside messages for edit and regenerate, with a small inline editor.

Run: `npm test`
Expected after implementation: message workflow and HTTP route tests pass.

### Task 3: Character Card V2 Import

**Files:**
- Create: `server/character/characterCardImport.js`
- Modify: `server/config/configService.js`
- Modify: `server/app.js`
- Modify: `public/app.js`
- Modify: `public/index.html`

- [ ] Parse V2 JSON where `spec === "chara_card_v2"` and card fields live in `data`.
- [ ] Parse PNG chunks `tEXt`, `zTXt`, and `iTXt` for `Chara/chara` base64 JSON metadata.
- [ ] Map V2 `character_book.entries` into local world book entries without destroying unknown card metadata.
- [ ] Add upload/import UI and API.

Run: `npm test`
Expected after implementation: import tests and HTTP import tests pass.

### Task 4: World Book Matching And Depth

**Files:**
- Modify: `server/agent/memoryRetriever.js`
- Modify: `server/agent/promptAssembler.js`
- Modify: `server/config/defaults.js`
- Modify: `public/app.js`

- [ ] Support `matchMode: "keyword" | "regex"`, `logic: "any" | "all" | "selective"`, `secondaryKeywords`, `constant`, and `depth`.
- [ ] Return retrieval metadata with score and target depth.
- [ ] Render depth buckets into prompt sections: before character, after character, before history, after history.
- [ ] Keep existing keyword behavior as the default.

Run: `npm test`
Expected after implementation: old keyword tests and new matching/depth tests pass.

### Task 5: Dynamic Memory Trigger

**Files:**
- Create: `server/agent/factExtractor.js`
- Modify: `server/agent/summaryScheduler.js`
- Modify: `server/services/agentService.js`

- [ ] Add a structured fact extraction prompt separate from rolling summary.
- [ ] Trigger extraction at the same threshold as summary and merge returned JSON into `memory.worldState`.
- [ ] Preserve failure behavior: chat should persist even if memory extraction fails, with `lastFactExtractionError` recorded.

Run: `npm test`
Expected after implementation: memory trigger tests pass.

### Task 6: Verification And Commit

**Files:**
- Modify docs as needed: `README.md`, `outputs/local-roleplay-agent-runbook.md`

- [ ] Run `node --check public/app.js`.
- [ ] Run `npm test`.
- [ ] Smoke `/api/health` on the dev server.
- [ ] Commit with `feat: add creator controls`.
