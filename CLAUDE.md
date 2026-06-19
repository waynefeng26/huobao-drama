# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Huobao Drama — AI-powered short-drama/video production tool. Full TypeScript stack (Hono + Drizzle + Mastra on the backend, Nuxt 3 SPA on the frontend). End-to-end pipeline: novel/script → formatted script → character/scene extraction → storyboarding → grid/image generation → video generation → TTS → per-shot FFmpeg compose → episode merge.

## 调研与 PoC 文档

选型与可行性调研归档在 `docs/short-drama-research/`（独立于上游、未纳入 git 跟踪，避免 pull 冲突）：
- `README.md` — 调研索引 + 一句话结论 + 推荐路径（先 PoC → fork → 按需自建）
- `02-huobao-deep-dive.md` — 火宝部署 / 成本模型 / 角色一致性（宫格图）原理 / 已知 bug
- `03-poc-checklist-mushroom-drama.md` — 首个 PoC（《香菇收购风波》6 镜子集）操作清单 + 验收标准

当前阶段：先跑通 PoC 量化「质量 / 成本 / 一致性」三角，再决定是否 fork 或自建。涉及一致性、成本、bug 时先查这些文档。

## Structure

```
backend/   — Hono + Drizzle ORM + Mastra (AI agents) + better-sqlite3 + fluent-ffmpeg
frontend/  — Nuxt 3 (SPA, srcDir app/) + Vue 3 + TypeScript (pure CSS, lucide-vue-next + vue-sonner)
configs/   — config.yaml (AI provider defaults, server/storage/database)
data/      — SQLite DB (huobao_drama.db) + generated assets under data/static/
skills/    — Per-agent SKILL.md definitions, loaded at runtime (one dir per agent type)
```

## Commands

There is **no test suite and no linter** — `typecheck` is the quality gate before committing.

### Backend (`backend/`)
- `npm run dev` — dev server with tsx watch (port 5679)
- `npm start` — production server (`tsx src/index.ts`)
- `npm run typecheck` — `tsc --noEmit` (the main check; run before frontend build)
- `npm run build` — `tsc` emit
- `npm run db:generate` / `npm run db:push` — drizzle-kit schema sync. Tables auto-create on boot from `src/db/schema.ts`, so these are only needed when changing the schema, not for normal startup.

### Frontend (`frontend/`)
- `npm run dev` — Nuxt dev server (port 3013; proxies `/api` and `/static` to 5679)
- `npm run build` / `npm run generate` — production build / static site generation (`generate` emits `frontend/dist`, served by backend in single-service mode)

## Architecture

### Request flow & response envelope
All API routes mount under `/api/v1` in `src/index.ts`; webhooks mount under `/webhooks` (outside `/api/v1`) for async provider callbacks (e.g. Vidu). Static assets mount at `/static/*` rooted at the `data/` dir; in production the backend also serves `frontend/dist` as a SPA fallback.

**Every JSON response uses the envelope `{ code, data, message }`** via helpers in `src/utils/response.ts` (`success`/`created`/`badRequest`/`notFound`/`serverError`). The frontend client (`useApi.ts`) unwraps this: it returns `json.data` and treats `code >= 400` (or non-2xx HTTP) as an error thrown with `message`. When adding routes, always use these helpers so the client contract holds.

### Backend modules
- **HTTP**: Hono with CORS (allowed origins `localhost:3013`/`5679`), `requestLogger`, `errorHandler` middleware (`src/middleware/logger.ts`, pino).
- **Database**: Drizzle ORM + better-sqlite3, WAL mode, 17 tables in `src/db/schema.ts`. Core domain tables (`dramas`, `episodes`, `characters`, `scenes`, `storyboards`) are linked through junction tables (`episode_characters`, `episode_scenes`, `storyboard_characters`) — an episode owns its own character/scene set via these joins, which is why extraction does per-episode dedup. Config tables: `ai_service_configs`, `ai_service_providers`, `ai_voices`, `agent_configs`. Generation/task history: `image_generations`, `video_generations`, `video_merges`. Tables auto-create on first boot; no migration step needed.
- **AI Agents** (`src/agents/`): a **factory**, not singletons. `createAgent(type, episodeId, dramaId)` builds a fresh Mastra `Agent` per request, injecting `episodeId`/`dramaId` into **tool closures** (`src/agents/tools/*.ts`) so tools can read/write the right episode's data. Five agent types: `script_rewriter`, `extractor`, `storyboard_breaker`, `voice_assigner`, `grid_prompt_generator`. Per-agent `systemPrompt`/`model`/`name` are read from the `agent_configs` DB table (falling back to `DEFAULT_PROMPTS` in code); a matching `skills/<type>/SKILL.md` is appended at runtime via `loadAgentSkills`. Text model/provider/baseURL resolve through `src/services/ai.ts` (OpenAI-compatible endpoint). Agent chat is a plain `POST /api/v1/agent/:type/chat` that calls `agent.generate(...)` and returns JSON — **no SSE/streaming**.
- **Media adapters** (`src/services/adapters/`): a **provider registry**. `getImageAdapter` / `getVideoAdapter` / `getTTSAdapter` (in `registry.ts`) return the adapter for a provider name, **defaulting to MiniMax for any unknown provider**. Image: openai, gemini, minimax, volcengine, ali, chatfire(alias→openai). Video: minimax, volcengine(Seedance), vidu, ali. TTS: minimax. Each adapter implements a common interface (`types.ts`); add a provider by writing an adapter + registering it.
- **FFmpeg services**: `ffmpeg-compose.ts` (per-shot: video + TTS audio + subtitle → one shot clip) and `ffmpeg-merge.ts` (concat all shots in an episode into the final video). `grid-split.ts` splits a generated grid image into per-cell frames.
- **Storage** (`src/utils/storage.ts`): files are written to `data/static/<subDir>/` and referenced by the relative path `static/<subDir>/<file>`, served by the `/static/*` route. Reference images are often passed inline as base64 data URLs (helpers `toDataUrl`/`parseDataUrl`).
- **Other utils**: `task-logger.ts` (`logTaskProgress` writes a shared task log DB rows/agents read), `transform.ts`.

### Frontend
- **Nuxt 3** SPA (`ssr: false`, `srcDir: app/`) + Vue 3 + TypeScript + Vite. Pure CSS in `app/assets/studio.css` (dark theme, CSS variables); `lucide-vue-next` icons + `vue-sonner` toasts. No UI component framework.
- **Routing**: file-based, 4 pages in `app/pages/`: `index.vue` (drama list), `drama/[id]/index.vue` (episode workbench), `drama/[id]/episode/[episodeNumber].vue` (single-episode production console), `settings.vue`. Layouts in `app/layouts/` (`default`, `studio`).
- **Composables** (`app/composables/`): `useApi.ts` is the unified REST client (auto-unwraps the response envelope, see above) plus typed API namespaces (`dramaAPI`, `episodeAPI`, `storyboardAPI`, `characterAPI`, `sceneAPI`, `imageAPI`, `gridAPI`, `videoAPI`, `composeAPI`, `mergeAPI`, `aiConfigAPI`, `agentConfigAPI`, `skillsAPI`, `voicesAPI`). `useAgent.ts` wraps the agent chat endpoint. No SSE.

## The production pipeline (domain flow)

This is the core sequence a single episode goes through; each step is an agent run or a media-generation call, persisted back to the DB:

1. **Script rewrite** (`script_rewriter`) — novel/raw input → formatted script saved to the episode.
2. **Extract** (`extractor`) — parse script → dedup/merge characters & scenes against the project, link them to this episode via the junction tables.
3. **Voice assignment** (`voice_assigner`) — match each character to a TTS voice.
4. **Storyboard** (`storyboard_breaker`) — break the script into shots (10–15s each), each fully specified (shot_type, angle, movement, prompts, character bindings, scene_id).
5. **Image generation** — character/scene stills and **grid images** (`grid_prompt_generator` + grid generate/split) for first/last frames.
6. **Video generation** — image→video per shot via the registered video adapter.
7. **Compose** (`/compose`) — FFmpeg combines each shot's video + TTS audio + subtitle into a finished shot clip.
8. **Merge** (`/merge`) — concatenate all shot clips into the final episode video.

`episodeAPI.pipelineStatus(id)` surfaces the per-episode progress through these stages for the workbench UI.

## Key Config
- `configs/config.yaml` — `app`, `server` (port/host/cors), `database` (sqlite path), `storage`, `ai` default providers. AI service credentials/keys and model params are **not** in this file — they live in the DB (`ai_service_configs`) and are configured via the web **Settings** page.
- `ai_service_configs` (DB) — per-service-type (text/image/video/tts) provider + baseURL + apiKey + model.
- `agent_configs` (DB) — per-agent-type system prompt / model / temperature overrides.
- Env overrides: `PORT`, `DB_PATH`, `STORAGE_PATH`.

## Editing conventions
- **Backend is ESM** (`"type": "module"`): relative imports inside `.ts` files must use the `.js` extension (e.g. `import { db } from '../db/index.js'`) — NodeNext resolution. Follow this when adding files; `npm run typecheck` will surface mistakes.
- Match the existing response-envelope helpers; don't return raw `c.json(...)` from route handlers.
- Frontend API calls go through `useApi.ts` namespaces — add new endpoints there rather than calling `fetch` directly.
