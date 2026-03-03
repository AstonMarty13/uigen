# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server (Next.js + Turbopack)
npm run build        # Production build
npm run lint         # ESLint
npm run test         # Vitest (unit tests)
npm run setup        # First-time setup: install deps + Prisma migrate
npm run db:reset     # Reset SQLite database
npx prisma studio    # Browse database
```

Run a single test file: `npx vitest run src/components/chat/__tests__/ChatInterface.test.tsx`

## Environment Variables

```
ANTHROPIC_API_KEY=   # Optional — falls back to mock provider if missing
JWT_SECRET=          # JWT signing key for sessions
```

## Architecture

**UIGen** is an AI-powered React component generator with live preview. Users describe components in chat, Claude generates code via tool calls, and the result renders instantly in an iframe.

### Three-Panel UI

`src/app/main-content.tsx` orchestrates the layout:
- **Left (35%)**: Chat interface (`/components/chat/`)
- **Right (65%)**: Preview tab (live iframe) or Code tab (file tree + Monaco editor)

### State Management

Two React Context providers drive the app:

- **`ChatProvider`** (`src/lib/contexts/chat-context.tsx`): Manages messages, AI streaming, and tool call orchestration. Calls `/api/chat` and dispatches file operations to the file system context.
- **`FileSystemProvider`** (`src/lib/contexts/file-system-context.tsx`): In-memory virtual file system. No files are ever written to disk during generation.

### AI / Tool System

- API route: `src/app/api/chat/route.ts` — streams responses via Vercel AI SDK
- Provider: `src/lib/provider.ts` — uses `@ai-sdk/anthropic` (Claude Haiku), falls back to mock if no API key
- System prompt: `src/lib/prompts/generation.tsx`
- Claude is given two tools:
  - `str_replace_editor` (`src/lib/tools/str-replace.ts`) — create/modify file content
  - `file_manager` (`src/lib/tools/file-manager.ts`) — rename/delete files

### Virtual File System

`src/lib/file-system.ts` — `VirtualFileSystem` class manages in-memory files. Serialized to JSON and persisted in the `Project.data` column (SQLite via Prisma).

### Preview

`src/components/preview/PreviewFrame.tsx` renders an iframe. `src/lib/transform/jsx-transformer.ts` compiles JSX to HTML using Babel Standalone before injecting it.

### Persistence

- DB: SQLite — schema defined in `prisma/schema.prisma` (reference it to understand data structure), client generated at `src/generated/prisma`
- `Project.messages` — serialized chat history (JSON array)
- `Project.data` — serialized virtual file system (JSON object)
- Server actions live in `src/actions/`

### Auth

JWT-based (`src/lib/auth.ts` + `jose`), bcrypt for passwords. Middleware at `src/middleware.ts`. Anonymous sessions are tracked via `src/lib/anon-work-tracker.ts`.

## Tech Stack

- **Framework**: Next.js 15 (App Router), React 19
- **Styling**: Tailwind CSS v4, shadcn/ui (New York style, Radix UI, Lucide icons)
- **Editor**: Monaco Editor (`@monaco-editor/react`)
- **ORM**: Prisma + SQLite
- **AI**: Vercel AI SDK + `@ai-sdk/anthropic`
- **Testing**: Vitest + React Testing Library
- **Path alias**: `@/*` → `src/*`
