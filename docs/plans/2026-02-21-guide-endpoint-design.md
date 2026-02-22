# Scout Guide Endpoint — Design

## Summary

A third MCP server entry point (`guide.js`) on the scout-quest LibreChat instance that serves parents, scoutmasters, and other trusted adults ("guides"). It provides a guided onboarding quest to set up a scout's profile, ongoing monitoring of scout conversations and progress, and coaching that helps guides support their scouts while preserving scout agency.

## Architecture

### Entry Point

```
mcp-servers/scout-quest/src/
├── scout.ts   → dist/scout.js   (scout-facing, 9 tools)
├── admin.ts   → dist/admin.js   (admin-facing, 11 tools)
└── guide.ts   → dist/guide.js   (guide-facing, ~13 tools)
```

`guide.ts` follows the same pattern as `scout.ts` and `admin.ts`:
- Creates `McpServer` with `GUIDE_INSTRUCTIONS`
- Resolves `GUIDE_EMAIL` from environment (LibreChat passes `{{user.email}}`)
- Calls `registerGuideResources(server, guideEmail)` and `registerGuideTools(server, guideEmail)`
- Always registers all tools (no startup auth check — auth enforced per-call)

### Auth Changes

The `parent` role type is renamed to `guide`. The `scout_emails[]` array remains — it links a guide to the scouts they oversee.

```typescript
export type Role =
  | { type: "superuser" }
  | { type: "admin"; troop: string }
  | { type: "adult_readonly"; troop: string }
  | { type: "guide"; scout_emails: string[] }   // was "parent"
  | { type: "scout" }
  | { type: "test_scout"; test_account: true };
```

New `GUIDE_WRITE_ACTIONS` array in `auth.ts` for parent-specific mutations (profile updates, delegation, character adjustments). Guides cannot do admin-only operations like `sign_off_requirement` or `override_requirement`.

### Scout Document Changes

```typescript
// ScoutDocument gains guide_email
parent_guardian: ContactInfo;     // unchanged — factual contact info
guide_email: string;             // new — defaults to parent_guardian.email
```

The `parent_guardian` field stays as-is — it's factual. `guide_email` identifies who is actively guiding this scout through the quest. Defaults to the parent but can point to a scoutmaster or counselor.

### LibreChat Config

Second MCP server on the scout-quest instance:

```yaml
mcpServers:
  scout-quest:        # existing — scout-facing
    command: node
    args: ["/app/mcp-servers/scout-quest/dist/scout.js"]
    env:
      SCOUT_EMAIL: "{{user.email}}"
      MONGO_URI: "mongodb://mongodb:27017/scoutquest"
      NTFY_TOPIC: "${NTFY_TOPIC}"
    timeout: 30000
    serverInstructions: true
  scout-guide:        # new — guide-facing
    command: node
    args: ["/app/mcp-servers/scout-quest/dist/guide.js"]
    env:
      GUIDE_EMAIL: "{{user.email}}"
      MONGO_URI: "mongodb://mongodb:27017/scoutquest"
      NTFY_TOPIC: "${NTFY_TOPIC}"
    timeout: 30000
    serverInstructions: true
```

New model spec "Scout Guide" with `mcpServers: ["scout-guide"]`.

### Hybrid Onboarding

- **Parent-guides** can self-serve: `setup_scout_profile` creates the scout record, sets `parent_guardian` to the guide, sets `guide_email` to the guide, and auto-assigns the `guide` role.
- **Non-parent guides** (scoutmaster, counselor): admin creates the scout with `create_scout`, sets `guide_email` to the leader's email, and grants the `guide` role.

## Resources

All resources use the `guide://` URI prefix.

| Resource | Description |
|----------|-------------|
| `guide://scouts` | List all scouts linked to this guide |
| `guide://scout/{email}/summary` | Gamified quest progress overview |
| `guide://scout/{email}/chores` | Chore streak and income summary |
| `guide://scout/{email}/budget` | Budget tracking snapshot |
| `guide://scout/{email}/requirements` | All requirement states with progress |
| `guide://scout/{email}/conversations` | Recent conversation summaries (not full transcripts) |
| `guide://scout/{email}/reminders` | Pending/overdue items |
| `guide://scout/{email}/setup-status` | Onboarding checklist progress |
| `guide://character` | Guide's own character/persona config |

## Tools

### Onboarding Tools

| Tool | Purpose |
|------|---------|
| `setup_scout_profile` | Set name, age, troop, patrol. Creates scout record for parent-guides. |
| `set_scout_interests` | Seed interests, likes/dislikes, motivations |
| `set_quest_goal` | Goal item, target budget, description |
| `set_chore_list` | Define chores, frequencies, income amounts |
| `set_budget_plan` | Income sources, expense categories, savings target |
| `set_character_preferences` | Base character, overlay, tone bounds, avoid list |
| `set_session_limits` | Max time per day, allowed days |

### Monitoring Tools

| Tool | Purpose |
|------|---------|
| `get_conversation_detail` | Pull full transcript for a specific session (opt-in) |
| `flag_conversation` | Mark a conversation for follow-up |
| `send_notification` | Push alert to scout via ntfy |

### Adjustment Tools

| Tool | Purpose |
|------|---------|
| `adjust_scout_profile` | Update age, troop, patrol, interests |
| `adjust_quest_goal` | Change goal or budget targets |
| `adjust_character` | Tweak tone bounds, avoid words, overlay |
| `adjust_delegation` | Set which setup tasks scout handles vs. guide |
| `suggest_intervention` | Coach proposes ways the guide can help — options with tradeoffs |

## Onboarding Quest Flow

### Setup Status

```typescript
interface SetupStatus {
  scout_email: string;
  steps: {
    id: string;
    label: string;
    status: "pending" | "complete" | "skipped" | "delegated_to_scout";
    completed_at?: Date;
    delegated_at?: Date;
  }[];
}
```

### Steps with Age-Aware Defaults

| # | Step | Age <12 | Age 12-14 | Age 15+ |
|---|------|---------|-----------|---------|
| 1 | Scout profile | Guide | Guide | Guide |
| 2 | Interests & preferences | Guide (asks scout) | Guide (asks scout) | Delegated |
| 3 | Quest goal & budget target | Guide (with input) | Guide (with input) | Delegated |
| 4 | Chore list & income | Guide | Guide | Guide reviews draft |
| 5 | Budget plan | Guide | Delegated | Delegated |
| 6 | Character personality | Guide | Guide | Delegated |
| 7 | Session limits | Guide | Guide | Guide |
| 8 | Notification setup (ntfy) | Guide helps | Delegated | Delegated |
| 9 | Counselor & leader contacts | Guide | Guide | Delegated |
| 10 | Blue card request | Guide | Guide | Delegated |

Guides can override any default. The coach works through incomplete steps one at a time, suggesting the next logical step.

### Dependencies

**Hard dependencies** (enforced):
- Step 1 (profile) must complete before any other step
- Step 5 (budget) requires Step 3 (quest goal) and Step 4 (chore list)

**Soft order** (suggested, not enforced):
- All other steps can be done in any order or deferred
- The coach suggests table order but allows skipping

### Delegation Handoff

When a step is delegated to the scout:
1. Marked `delegated_to_scout` in setup status
2. Reminder created on scout's profile
3. Scout's coach picks it up in the next session
4. Guide can check progress via `guide://scout/{email}/setup-status`

## Monitoring & Coaching

### Conversation Monitoring

LibreChat stores conversations in its MongoDB (`librechat` database). Guide endpoint reads these read-only.

**Default: summaries.** `guide://scout/{email}/conversations` returns recent sessions with date, duration, model, and auto-generated summary.

**Opt-in: full transcripts.** `get_conversation_detail` pulls the complete conversation. Guide must explicitly request it.

### Auto-Flagging

The coach suggests flagging when it detects:
- Scout inactive for 3+ days
- Budget significantly off-track
- Chore streak broken after 7+ days
- Requirement stuck for 2+ weeks
- Scout explicitly asked for parent help

Flags generate reminders visible via `guide://scout/{email}/reminders`.

### Intervention Coaching

`suggest_intervention` provides structured options:

```typescript
{
  situation: "Chore streak broken after 12-day streak",
  options: [
    {
      approach: "Ask Will what happened",
      description: "Casual check-in: 'noticed your chores paused, everything OK?'",
      preserves_agency: true,
      recommended: true,
      why: "Lets Will own the problem and propose solutions"
    },
    {
      approach: "Send a notification reminder",
      description: "Push notification to scout's device",
      preserves_agency: false,
      recommended: false,
      why: "Quick but feels like surveillance — use sparingly"
    },
    {
      approach: "Adjust chore list",
      description: "Review and simplify if list is too ambitious",
      preserves_agency: true,
      recommended: false,
      why: "Good if consistently struggling, premature for first break"
    }
  ]
}
```

The coach recommends an option and explains why. The guide decides.

### Conflict Coaching Flow

When a scout hits a blocker:
1. Scout's coach notices the problem
2. Suggests scout talk to their guide, helps practice the conversation
3. Scout brings the problem (and potential solutions) to the guide
4. Guide's coach sees context via flagged summary, helps guide respond constructively

This preserves scout agency — the scout initiates, the guide responds.

### Session Limits

Time caps set during onboarding. Enforced via the scout coach's prompt (checks elapsed time, wraps up at limit). Cooperative enforcement — effective for a scout engaged in the quest.
