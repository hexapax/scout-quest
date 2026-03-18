# Scout-Quest Application Architecture

## The Core Decision

Scout-quest uses **three surfaces**, each handling what it does best:

1. **LibreChat** — the conversational interface (chat, file uploads, images, conversation history)
2. **Custom API backend** — the intelligence layer (cached knowledge, prompt construction, tool execution, scout context)
3. **Micro-apps** — bespoke workflow UIs for things that don't belong in a chat bubble

The agent thinks in chat. It acts through tools. When a workflow needs a richer experience than text, the agent hands off to a micro-app.

---

## Why This Split

| Capability | LibreChat | Custom Backend | Micro-app |
|---|---|---|---|
| Chat UX, message rendering | ✓ | | |
| File uploads, image handling | ✓ | | |
| Multi-user auth | ✓ | | |
| Mobile-responsive interface | ✓ | | |
| Conversation history | ✓ | | |
| BSA knowledge caching (200K tokens) | | ✓ | |
| Per-scout context injection | | ✓ | |
| Prompt construction + persona | | ✓ | |
| MCP tool execution | | ✓ | |
| Anthropic API calls with cache_control | | ✓ | |
| FalkorDB graph queries | | ✓ | |
| Hybrid vector + BM25 search | | ✓ | |
| Email review + send (YPT enforced) | | | ✓ |
| Visual advancement tracker | | | ✓ |
| Counselor session prep | | | ✓ |
| Guided workflows (multi-step forms) | | | ✓ |

**Rule of thumb:** If the interaction is conversational (asking questions, getting advice, discussing plans), it stays in LibreChat. If the interaction needs precise visual layout, confirmation steps, or an action with consequences (sending an email, marking a requirement complete), it goes to a micro-app.

---

## Request Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                          LIBRECHAT                                   │
│  scout-quest.hexapax.com                                            │
│                                                                      │
│  Configured with custom OpenAI-compatible endpoint                   │
│  pointing to the custom backend                                      │
│                                                                      │
│  Scout types message → LibreChat sends to backend                    │
│  Backend responds → LibreChat renders response                       │
│  Agent returns micro-app link → LibreChat renders as clickable link  │
└──────────────────────┬───────────────────────────────────────────────┘
                       │
                       │ OpenAI-compatible API format
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      CUSTOM API BACKEND                              │
│  scout-quest.hexapax.com/api (or separate port behind CF Tunnel)     │
│                                                                      │
│  1. Receive OpenAI-format request from LibreChat                     │
│  2. Identify scout from auth context                                 │
│  3. Load scout's profile + active badges from MongoDB                │
│  4. Construct Anthropic API payload:                                 │
│     ┌─────────────────────────────────────────────────────────┐      │
│     │ system[0]: BSA_KNOWLEDGE (200K tokens, cache_control)   │      │
│     │ system[1]: AGENT_PERSONA (instructions, persona)        │      │
│     │ system[2]: SCOUT_CONTEXT (profile, active badges,       │      │
│     │            preferences, recent session notes)            │      │
│     │ tools: [get_my_status, log_requirement_work,            │      │
│     │         advance_requirement, compose_email,              │      │
│     │         search_bsa_reference, query_bsa_graph, ...]     │      │
│     │ messages: [conversation history from LibreChat]          │      │
│     └─────────────────────────────────────────────────────────┘      │
│  5. Call Anthropic API with cache_control                            │
│  6. Handle tool calls:                                               │
│     - Execute against FalkorDB / MongoDB / external services         │
│     - Feed results back to Claude for continued generation           │
│     - Loop until Claude returns a final text response                │
│  7. Translate response back to OpenAI format                         │
│  8. Return to LibreChat                                              │
└──────────────────────┬───────────────────────────────────────────────┘
                       │
          ┌────────────┼────────────────┐
          ▼            ▼                ▼
   ┌────────────┐ ┌────────────┐ ┌──────────────┐
   │  FalkorDB  │ │  MongoDB   │ │ Micro-apps   │
   │            │ │            │ │              │
   │ Knowledge  │ │ Scout      │ │ /email       │
   │ graph      │ │ profiles   │ │ /progress    │
   │ Vectors    │ │ Sessions   │ │ /prep        │
   │ Full-text  │ │ Quest data │ │ /review      │
   └────────────┘ └────────────┘ └──────────────┘
```

---

## Custom Backend Design

### OpenAI-to-Anthropic Translation

LibreChat sends requests in OpenAI chat completion format. The backend translates:

```
OpenAI format (from LibreChat):
{
  model: "scout-quest",        // LibreChat preset name
  messages: [
    {role: "system", content: "..."},   // LibreChat's system prompt (persona)
    {role: "user", content: "..."},
    {role: "assistant", content: "..."},
    {role: "user", content: "what do I need for camping 5a?"}
  ],
  max_tokens: 4096
}

Translated to Anthropic format (by backend):
{
  model: "claude-sonnet-4-6",
  max_tokens: 4096,
  system: [
    {
      type: "text",
      text: <BSA_KNOWLEDGE_200K>,           // ← injected by backend
      cache_control: {type: "ephemeral"}    // ← cache boundary
    },
    {
      type: "text",
      text: <AGENT_PERSONA>                 // ← from LibreChat's system prompt or overridden
    },
    {
      type: "text",
      text: <SCOUT_CONTEXT>                 // ← injected by backend from MongoDB
    }
  ],
  tools: [...],                             // ← injected by backend (per-persona tool set)
  messages: [
    {role: "user", content: "..."},
    {role: "assistant", content: "..."},
    {role: "user", content: "what do I need for camping 5a?"}
  ]
}
```

Key transformations the backend performs:

1. **Strips LibreChat's system prompt** and replaces with the three-block structure (knowledge + persona + scout context). LibreChat's preset can still set persona-level config, but the backend is authoritative.
2. **Injects the cached BSA knowledge block** — loaded once from disk on startup, the same 200K token block goes into every request.
3. **Looks up the authenticated scout** from the request headers or session token and loads their context from MongoDB.
4. **Adds the correct tool set** for this persona (scout-facing vs. parent-facing vs. admin).
5. **Handles the tool execution loop** — if Claude returns a tool_use block, the backend executes it, feeds the result back, and continues until Claude returns a text response.
6. **Translates the response** back to OpenAI format for LibreChat to render.

### File and Image Handling

LibreChat handles file uploads and sends them as base64-encoded content in the message. The backend passes these through to the Anthropic API as-is — Claude natively supports image and PDF content blocks. No special handling needed for the common case (scout takes a photo of their completed knot board).

For files that need processing (a PDF of a merit badge pamphlet the scout uploads), the backend can intercept, extract text, and include it as a text content block instead of relying on Claude's native PDF handling.

### Authentication and Scout Identification

LibreChat supports multiple auth methods. The backend needs to map a LibreChat user to a scout profile in MongoDB. Options:

- **LibreChat user ID → MongoDB scout profile** via a mapping table
- **Email-based matching** if LibreChat users register with the same email as their scout profile
- **Header-based** if using an auth proxy (Cloudflare Access, etc.)

The admin persona should have access to all scout profiles. The scout persona should only see their own data. The parent/guide persona should see their linked scouts. This access control lives in the backend, not in LibreChat.

### Streaming

LibreChat expects SSE (Server-Sent Events) streaming responses. The Anthropic API also supports SSE streaming. The backend needs to stream-proxy: receive SSE events from Anthropic, translate from Anthropic's event format to OpenAI's, and forward to LibreChat. This is the most technically fiddly part of the translation layer, but well-documented patterns exist (several open-source OpenAI-to-Anthropic proxies handle this).

**Exception:** During tool execution loops, the backend buffers the tool call, executes it, and sends the result back to Claude before resuming the stream to LibreChat. The user sees a brief pause (tool execution latency) then the continued response streams in.

---

## Micro-App Architecture

### Design Principles

1. **Thin presentation, no intelligence.** Micro-apps render data and capture user input. They don't make decisions. All intelligence stays in the chat agent.
2. **State passes through the backend.** The agent creates a "pending action" in MongoDB (e.g., a draft email). The micro-app reads it by ID. The scout confirms. The micro-app tells the backend to execute. No direct agent-to-micro-app communication.
3. **Each micro-app is a single HTML page** with minimal JS. Hosted as static files at `scout-quest.hexapax.com/{app-name}`. No build step, no React, no framework. Progressive enhancement — they work on a phone browser.
4. **Links from chat to micro-apps** are the handoff mechanism. The agent returns a message like "I've prepared the email. [Review and send →](https://scout-quest.hexapax.com/email?id=abc123)" and LibreChat renders it as a clickable link.

### Pending Action Pattern

When the agent decides a micro-app handoff is needed, it calls a tool that creates a pending action:

```json
{
  "name": "create_pending_action",
  "description": "Create a pending action that will be completed in a micro-app. Returns a URL the scout can click to review and execute the action.",
  "input_schema": {
    "type": "object",
    "properties": {
      "action_type": {
        "type": "string",
        "enum": ["send_email", "confirm_advancement", "session_prep"]
      },
      "payload": {
        "type": "object",
        "description": "Action-specific data. For send_email: {to, cc, subject, body, context}. For confirm_advancement: {requirement_id, evidence_summary}."
      },
      "expires_minutes": {
        "type": "integer",
        "description": "How long the pending action is valid. Default 30 minutes."
      }
    },
    "required": ["action_type", "payload"]
  }
}
```

The backend:
1. Stores the pending action in MongoDB with a unique ID and expiration
2. Returns the micro-app URL: `https://scout-quest.hexapax.com/email?action=abc123`
3. The agent includes this URL in its response to the scout

The micro-app:
1. Loads the pending action by ID from the backend API
2. Renders the review UI (email preview, advancement summary, etc.)
3. Scout clicks "Send" / "Confirm" / "Cancel"
4. Micro-app calls the backend API to execute or cancel
5. Backend performs the action (sends email, updates graph, etc.)
6. Micro-app shows confirmation

### Planned Micro-Apps

**Phase 1 (build with tool refactoring):**

| App | Route | Purpose |
|-----|-------|---------|
| Email | `/email` | Review and send emails with YPT enforcement. Shows To, CC (parent auto-added), Subject, Body. Scout can edit before sending. Enforces: parent always CC'd, no direct messaging without parent visibility. |

**Phase 2 (build with knowledge graph):**

| App | Route | Purpose |
|-----|-------|---------|
| Progress | `/progress` | Visual advancement tracker. Shows rank progress, active merit badges, completed requirements. Read-only — links back to chat for questions. |
| Badge View | `/badge` | Single merit badge detail view showing version-correct requirements, completion status per requirement, and next steps. |

**Phase 3 (as workflows mature):**

| App | Route | Purpose |
|-----|-------|---------|
| Session Prep | `/prep` | Counselor meeting preparation: which requirements to present, evidence to bring, questions to expect. |
| Board of Review | `/bor-prep` | BOR preparation checklist: what to expect, what to review, Scout Spirit talking points. |
| Parent Dashboard | `/dashboard` | Parent view: all linked scouts' progress, recent sessions, flags, upcoming milestones. |

---

## Implementation Sequence

### Step 1: Custom Backend MVP (1-2 weeks)

Build the OpenAI-to-Anthropic translation layer with:
- Basic request translation (messages, system prompt)
- BSA knowledge injection with cache_control
- Static scout context (hardcode for testing, then wire to MongoDB)
- Streaming proxy
- No tool execution yet — just cached knowledge + conversation

**Test:** Point LibreChat at the custom backend. Verify that policy questions are answered correctly from cached knowledge, streaming works, and the cache metrics in Anthropic's response show cache hits after the first request.

### Step 2: Tool Execution Loop (1 week)

Add tool definitions and the tool execution loop:
- Receive tool_use from Claude
- Execute against MongoDB / FalkorDB
- Return tool_result and continue generation
- Handle multi-tool sequences

**Test:** Scout can ask "where am I on Personal Management?" and get a real answer from their data.

### Step 3: Per-Scout Context (1 week)

Wire up authentication-based scout identification:
- Map LibreChat user → scout profile
- Load scout context from MongoDB on each request
- Include active badges, preferences, recent notes in the dynamic system prompt block

**Test:** Two different scouts get different answers to "what should I work on next?"

### Step 4: Email Micro-App (1 week)

Build the first micro-app as the template for all others:
- `create_pending_action` tool
- `/email` static page with review UI
- Backend API for executing/cancelling pending actions
- YPT enforcement (parent CC non-negotiable, logged)

**Test:** Scout composes an email through chat, clicks a link, reviews it, and sends it.

### Step 5: Migrate Existing Functionality

Once the new architecture is running:
- Migrate remaining scout-facing tools to the new backend
- Consolidate badge-specific tools into generic `log_requirement_work`
- Add `get_my_status` read-only tool
- Retire the old MCP servers as their tools are absorbed into the backend

---

## What LibreChat Configuration Changes

LibreChat needs minimal changes:

1. **Custom endpoint configuration** in `librechat.yaml` pointing to the custom backend URL
2. **Model name mapping** — LibreChat shows "Scout Coach" in the UI but sends requests to the backend, which uses claude-sonnet-4-6
3. **Persona presets** — keep the existing Scout Coach / Scout Guide / Scout Admin presets, but the persona instructions are now authoritative in the backend, not in LibreChat's prompt prefix
4. **Remove MCP server configuration** from LibreChat — tools are now handled by the custom backend directly

The backend becomes the single point of control for prompt construction, tool management, and knowledge injection. LibreChat is purely a UI layer.

---

## Cost at Troop Scale

| Component | Monthly Cost |
|-----------|-------------|
| LibreChat hosting (existing devbox) | $0 incremental |
| Custom backend (same devbox) | $0 incremental |
| FalkorDB (same devbox, Docker) | $0 incremental |
| MongoDB (existing) | $0 incremental |
| Micro-apps (static files, same host) | $0 incremental |
| Cloudflare Tunnel (existing) | $0 |
| Claude API — Sonnet 4.6, ~100 queries/day, cached context | **$15-40/month** |
| Voyage embeddings — query-time | **<$1/month** |
| **Total incremental** | **$15-40/month** |

The only real cost is Claude API usage. Everything else runs on infrastructure you already have.
