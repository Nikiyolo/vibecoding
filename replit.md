# AI Performance Insight Assistant

## Overview

This is a full-stack web application called **AI Performance Insight Assistant** that allows users to ask natural language questions about business performance metrics. The system interprets queries using OpenAI, retrieves relevant data from a PostgreSQL database, and presents results as interactive charts with AI-generated explanations and root cause analysis.

Key capabilities:
- Natural language query input (e.g., "Why did revenue drop last month?")
- Automatic metric/intent extraction using OpenAI GPT
- Trend charts and breakdown charts with drill-down support
- Root cause analysis with AI-generated descriptions and suggestions
- Product hierarchy drill-down (category → subcategory → material → SKU)

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Project Structure

The project follows a monorepo layout with three main areas:
- `client/` — React frontend (Vite)
- `server/` — Express backend (Node.js)
- `shared/` — Shared types, schemas, and route definitions used by both sides

### Frontend Architecture

- **Framework**: React 18 with TypeScript, bundled by Vite
- **Routing**: `wouter` (lightweight client-side router); currently one main route at `/`
- **State/Data Fetching**: TanStack Query (React Query v5) for server state; mutations for analyze and drill-down API calls
- **UI Components**: shadcn/ui component library built on Radix UI primitives, styled with Tailwind CSS
- **Charts**: Recharts (`ResponsiveContainer`, `LineChart`, `BarChart`) for trend and breakdown visualizations
- **Animations**: Framer Motion for loading states and transitions
- **Icons**: Lucide React
- **Markdown Rendering**: `react-markdown` with `remark-gfm` for AI-generated descriptions
- **Font**: DM Sans (body) and Epilogue (display) via Google Fonts

Key frontend files:
- `client/src/pages/Home.tsx` — Main page: query input, results display, drill-down interaction
- `client/src/components/MetricCharts.tsx` — TrendChart and BreakdownChart components
- `client/src/components/DrillDownPanel.tsx` — Context menu for chart bar drill-down
- `client/src/hooks/use-analyze.ts` — Mutation hook for the `/api/analyze` endpoint
- `client/src/hooks/use-metrics.ts` — Query hook for `/api/metrics`

### Backend Architecture

- **Framework**: Express 5 (Node.js), TypeScript via `tsx`
- **Entry point**: `server/index.ts` creates an HTTP server; routes registered in `server/routes.ts`
- **Development**: Vite dev server runs as middleware (`server/vite.ts`) for hot module reloading
- **Production**: Static files served from `dist/public/`; server bundled via esbuild (`script/build.ts`)

Key API endpoints:
- `GET /api/metrics` — Fetch all performance metrics from DB
- `POST /api/analyze` — Accept a natural language query; call OpenAI to parse intent/metric/timeRange; retrieve and aggregate data; return trend data, breakdown data, root causes, and AI-generated text
- `POST /api/drilldown` — Accept drill-down parameters and return detailed breakdown for a specific dimension/value

### Data Layer

- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Database**: PostgreSQL (connection via `DATABASE_URL` environment variable)
- **Schema** (`shared/schema.ts`):
  - `product_categories` — Top-level product groupings
  - `product_subcategories` — Sub-groupings linked to categories
  - `material_codes` — Material codes linked to subcategories
  - `skus` — Individual SKUs linked to material codes
  - `performance_metrics` — Core fact table: date, skuId, region, revenue, cost, profit
  - `conversations` / `messages` — Chat history tables (defined in `shared/models/chat.ts`)
- **Seeding**: `storage.seedMetrics()` runs on server startup to populate product hierarchy and sample metrics if the DB is empty
- **Migrations**: Drizzle Kit manages migrations in `./migrations/`; run with `npm run db:push`

### Shared Contract Layer

`shared/routes.ts` defines the full API contract using Zod schemas — method, path, input shape, and response shapes — consumed by both the server (for validation) and the client (for type-safe fetching and response parsing).

### AI Integration

- **Provider**: OpenAI API (accessed via `AI_INTEGRATIONS_OPENAI_API_KEY` and `AI_INTEGRATIONS_OPENAI_BASE_URL` environment variables — Replit AI Integrations routing)
- **Client**: Shared OpenAI client instantiated in `server/replit_integrations/image/client.ts`, reused in `server/routes.ts`
- **Usage in analyze endpoint**:
  1. GPT parses the query to extract `metric`, `timeRange`, and `intent` (as JSON)
  2. Data is retrieved and aggregated from the DB
  3. GPT generates trend descriptions, root cause explanations, and suggestions in markdown

### Replit Integrations Modules

The project includes pre-built Replit integration modules under `server/replit_integrations/` and `client/replit_integrations/`:
- **Chat** (`chat/`): Conversation + message storage, chat routes
- **Audio** (`audio/`): Voice recording (MediaRecorder), PCM16 playback via AudioWorklet, SSE streaming, speech-to-text, TTS
- **Image** (`image/`): Image generation/editing via `gpt-image-1`
- **Batch** (`batch/`): Generic rate-limited batch processing with p-limit and p-retry

These modules are available but not all are actively wired into the main application routes.

## External Dependencies

### Required Environment Variables
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (required at startup) |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | OpenAI API key via Replit AI Integrations |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | OpenAI base URL via Replit AI Integrations |

### Key Third-Party Services
- **OpenAI API** — Natural language understanding, metric extraction, explanation generation, image generation, voice features
- **PostgreSQL** — Primary data store for metrics, product hierarchy, and chat history

### Key NPM Dependencies
| Package | Role |
|---|---|
| `drizzle-orm` / `drizzle-kit` | ORM and migration tooling |
| `pg` + `connect-pg-simple` | PostgreSQL client and session store |
| `openai` | OpenAI SDK |
| `express` | HTTP server framework |
| `@tanstack/react-query` | Client-side server state management |
| `recharts` | Chart rendering |
| `framer-motion` | UI animations |
| `wouter` | Client-side routing |
| `zod` + `drizzle-zod` | Schema validation and type inference |
| `react-hook-form` + `@hookform/resolvers` | Form state management |
| Radix UI (full suite) | Accessible UI primitives |
| `tailwindcss` | Utility-first CSS |
| `lucide-react` | Icon set |
| `react-markdown` + `remark-gfm` | Render AI markdown responses |
| `p-limit` + `p-retry` | Concurrency and retry for batch processing |
| `nanoid` | ID generation |