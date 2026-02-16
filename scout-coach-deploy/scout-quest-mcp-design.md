# Scout Quest MCP Server — Raw Design Plan

## WHAT THIS IS
A TypeScript MCP server for LibreChat that gives the AI "Scout Coach" agent persistent tools to track a Boy Scout's 13-17 week quest combining PC building with merit badge completion. Runs as stdio subprocess inside LibreChat's Docker stack on a GCP VM.

## PRIOR WORK CONTEXT (for the implementing chat)
This project has been developed across 4+ sessions. Key artifacts:
- Tier 1 system prompt (Claude.ai Project) is ALREADY WORKING and defines the Scout Coach persona, rules, and quest structure
- LibreChat is DEPLOYED and RUNNING at https://scout-quest.hexapax.com on GCE e2-medium (Ubuntu 24.04)
- Docker Compose stack: api, mongodb, meilisearch, rag_api, vectordb containers all running
- Caddy reverse proxy handles HTTPS
- Google OAuth working, Jeremy (admin) signed in
- AI providers configured: Anthropic (working), OpenAI (quota issue), DeepSeek, OpenRouter
- MongoDB service name in docker-compose is `mongodb` (NOT `mongo` — this caused bugs during deployment)
- App root on VM: /opt/scoutcoach/librechat
- MCP servers mount: ./mcp-servers → /app/mcp-servers inside api container
- Language choice: TypeScript (Jeremy's preference)

## THE SCOUT (USER)
- Will, age 11, Boy Scout in Troop 2024 at Pace Academy (Atlanta area)
- Has ADHD — system uses gamification, chunking, immediate rewards
- Uses iPad to access LibreChat
- His dad Jeremy is the Scoutmaster of Troop 2024
- Jeremy is also the developer/admin of this system

## THE QUEST
Will earns money through daily chores to "unlock" PC components while simultaneously completing two Eagle-required merit badges (Personal Management and Family Life). The gamification uses gaming metaphors: Loot Drops (buying parts), Boss Fights (big projects), Grinding (daily chores), XP (progress), Quest Save Files (state snapshots).

## HARDWARE BUILD (THE "LOOT TABLE")
Already owned:
- AMD Ryzen 5600X CPU
- Radeon RX 480 GPU

Unlock sequence (earned through chores):
- Week 2: Thermalright Assassin X120 Cooler (~$20)
- Week 4: 16GB DDR4-3200 RAM (~$55-70)
- Week 7: B550M Motherboard (~$80-100)
- Week 8: 1TB NVMe SSD (~$85-100)  
- Week 10: Micro-ATX Mini Tower Case (~$50)
- Week 13+: 600W Power Supply (~$55)
- Stretch goal: Gaming keyboard

Scavenging: Possible case from existing hardware (suitability TBD)
Total budget target: ~$350-400

## MERIT BADGES

### Personal Management (Eagle-required)
Counselor: Mr. Chris McDaid (chrismcdaid@att.net)

Requirements tracked:
- **Req 1** (Major Purchase Strategy): PC is the major purchase. Must define budget, compare prices from 2+ sources (Amazon vs Newegg vs Micro Center), evaluate quality via reviews/specs, explain part choices, write shopping strategy doc, discuss with counselor AND family.
- **Req 2** (13-Week Budget): Track income (chore money) and expenses (PC parts) for 13 weeks. Spreadsheet with weekly income, running total, planned vs actual spending.
- **Req 8** (7-Day Schedule): Create written 7-day schedule (school, homework, Roblox, chores, PC research), ACTUALLY FOLLOW it for a full week, KEEP DAILY DIARY/JOURNAL of when tasks done vs scheduled, review diary with counselor.

### Family Life (Eagle-required)
Counselor: Mrs. Nicole Allen (texnicking@gmail.com) — also the Advancement Chair

Requirements tracked:
- **Req 3** (90-Day Chores): At least 5 regular chores for 90 days (~13 weeks). Must keep a log.
- **Req 4** (Individual Project / "Boss Fight"): One big project (e.g., deep-cleaning garage). Discuss objective/goal and results verbally with counselor (no written report needed per 2025 update).
- **Req 5** (Family Project): Project involving whole family (e.g., clearing Will's room, building desk/setup).

## BSA PROCESS (CORRECTED — these corrections were important)
- Troop 2024 uses Scoutbook Plus virtual blue card system for in-house merit badge counselors
- Jeremy (Scoutmaster) signs virtual blue card in Scoutbook Plus to start a merit badge
- Scoutmaster (or delegated leader) "connects" the Scout to the MBC in Scoutbook — this triggers email notification to parent and unit leader
- Scout contacts MBC to begin work
- MBC approves individual requirements directly in Scoutbook as Scout completes them
- MBC marks badge complete in Scoutbook when all requirements done
- Blue cards are NOT mandatory if MBC uses Scoutbook for records
- There are NO Boards of Review for merit badges (only for rank advancement)
- Mrs. Allen (Advancement Chair) generates reports from Scoutbook before Court of Honor — no manual notification needed if done digitally
- YPT: All digital communications between scout and adult must CC a parent/guardian or registered adult leader. Jeremy (Dad + Scoutmaster) satisfies this.

## CONTACT DATABASE
- Scoutmaster/Dad: Jeremy Bramwell (jebramwell@gmail.com) — MUST be CC'd on all official emails
- Advancement Chair: Mrs. Nicole Allen (texnicking@gmail.com)
- Merit Badge Counselor (PM): Mr. Chris McDaid (chrismcdaid@att.net)
- Merit Badge Counselor (FL): Could be Mrs. Allen or separate — TBD

## QUEST PHASES (THE ROADMAP)
Phase 1 "THE LOBBY & SETUP" (Weeks 1-3): Blue cards, first counselor email, budget spreadsheet, 7-day schedule + diary, start chores, buy Cooler
Phase 2 "MEMORY & THE BOSS FIGHT" (Weeks 4-7): Buy RAM, Individual Project, buy Motherboard, install CPU+RAM+Cooler on mobo ("Engine Block")
Phase 3 "STORAGE & BASE BUILDING" (Weeks 8-10): Family Project, buy SSD, buy Case, install mobo in case
Phase 4 "POWER UP" (Weeks 11-13+): Finalize logs/budget, completion emails, buy PSU, FINAL: install PSU+GPU → boot to BIOS

## CRITICAL SYSTEM RULES (from Tier 1 prompt — MCP must support these)
1. SOCRATIC RULE: Never do work for Will. Never write entire emails/essays/schedules. Guide with fill-in-blanks and multiple choice.
2. YPT ENFORCER: Any email to adult must CC Dad. The compose_email tool must auto-include Dad's email in CC.
3. CHUNKING: One instruction at a time. No lists > 3 items.
4. SCOPE CONTROL: Only PC hardware, building/troubleshooting, Windows/drivers, the two merit badges, budgeting/scheduling/chores related to project.

---

## MCP SERVER ARCHITECTURE

### Tech Stack
- TypeScript
- MCP SDK: `@modelcontextprotocol/sdk` (latest)
- MongoDB driver: `mongodb` npm package (native driver, not Mongoose — keeps it lightweight)
- Transport: stdio (LibreChat spawns as child process)
- Build: tsc → dist/ directory
- Runtime: Node.js (whatever version is in LibreChat's API container)

### File Structure
```
/opt/scoutcoach/librechat/mcp-servers/scout-quest/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # MCP server setup, tool registration
│   ├── db.ts                 # MongoDB connection singleton
│   ├── types.ts              # All TypeScript interfaces
│   ├── constants.ts          # Hardware list, contacts, MB requirements
│   └── tools/
│       ├── getQuestState.ts
│       ├── updateQuestState.ts
│       ├── getQuestSummary.ts
│       ├── composeEmail.ts
│       ├── logChore.ts
│       ├── getChoreStreak.ts
│       ├── checkReminders.ts
│       └── searchHardware.ts
├── dist/                     # compiled output
└── build.sh                  # npm install && npx tsc
```

### LibreChat Config (librechat.yaml)
```yaml
mcpServers:
  scout-quest:
    type: stdio
    command: node
    args:
      - "/app/mcp-servers/scout-quest/dist/index.js"
    env:
      MONGO_URI: "mongodb://mongodb:27017/scoutquest"
      SMTP_HOST: "smtp.gmail.com"
      SMTP_PORT: "587"
      SMTP_USER: "${EMAIL_USERNAME}"
      SMTP_PASS: "${EMAIL_PASSWORD}"
      SMTP_FROM: "${EMAIL_FROM}"
    timeout: 30000
    serverInstructions: true
```

### User Identity
LibreChat may or may not pass user ID to MCP stdio tools. For initial deployment with 1-2 users, use scout_name lookup. Tools that need to identify the scout accept an optional `scout_name` param. If only one scout exists in DB, auto-select. Proper user-ID passthrough is a Phase 2 enhancement.

---

## MONGODB DATA MODEL

Database: `scoutquest`

### Collection: `scouts`
```typescript
interface ScoutDocument {
  _id: ObjectId;
  librechat_user_id?: string;
  scout_name: string;
  troop: string;
  quest_start_date: Date;
  quest_week: number;              // 1-17
  phase: number;                   // 1-4

  merit_badges: {
    personal_management: {
      status: "NOT_STARTED" | "IN_PROGRESS" | "COUNSELOR_REVIEW" | "COMPLETE";
      counselor: { name: string; email: string };
      scoutbook_started: boolean;
      blue_card_signed_date: Date | null;
      requirements: {
        req1: { status: string; notes: string; started_date: Date | null; completed_date: Date | null };
        req2: { status: string; notes: string; started_date: Date | null; completed_date: Date | null; week_count: number };  // week X of 13
        req8: { status: string; notes: string; started_date: Date | null; completed_date: Date | null; day_count: number };   // day X of 7
      }
    };
    family_life: {
      status: "NOT_STARTED" | "IN_PROGRESS" | "COUNSELOR_REVIEW" | "COMPLETE";
      counselor: { name: string; email: string };
      scoutbook_started: boolean;
      blue_card_signed_date: Date | null;
      requirements: {
        req3: { status: string; notes: string; started_date: Date | null; completed_date: Date | null; day_count: number };   // day X of 90
        req4: { status: string; notes: string; started_date: Date | null; completed_date: Date | null };
        req5: { status: string; notes: string; started_date: Date | null; completed_date: Date | null };
      }
    };
  };

  hardware: {
    owned: Array<{ name: string; category: string; price_paid?: number; date_acquired?: Date; notes?: string }>;
    purchased: Array<{ name: string; category: string; price_paid: number; date_purchased: Date; source: string; notes?: string }>;
    installed: Array<{ name: string; category: string; date_installed: Date; notes?: string }>;
    still_needed: Array<{ name: string; category: string; estimated_price: number; unlock_week: number; notes?: string }>;
    scavenging: string[];
    bonus_unlocks: string[];
  };

  budget: {
    total_earned: number;
    total_spent: number;
    target_estimate: number | null;
    weekly_allowance: number;
    transactions: Array<{
      date: Date;
      amount: number;
      description: string;
      type: "earned" | "spent";
      category?: string;          // "chore" | "hardware" | "birthday" | "other"
    }>;
  };

  chores: {
    log: Array<{
      date: Date;
      tasks: string[];            // which chores were done
      earned: number;
      notes?: string;
    }>;
    current_streak: number;
    longest_streak: number;
    daily_chores: string[];       // the 5+ assigned chores for FL Req 3
  };

  emails_sent: Array<{
    date: Date;
    to: string;
    cc: string[];
    subject: string;
    context: string;              // "PM blue card intro" | "FL progress update" etc
  }>;

  key_decisions: Array<{
    date: Date;
    decision: string;
    rationale: string;
  }>;

  diary_entries: Array<{          // for PM Req 8 (7-day schedule diary)
    date: Date;
    scheduled_tasks: string[];
    actual_tasks: string[];
    notes: string;
  }>;

  created_at: Date;
  updated_at: Date;
}
```

### Collection: `reminders`
```typescript
interface ReminderDocument {
  _id: ObjectId;
  scout_id: ObjectId;
  type: "chore" | "deadline" | "check_in" | "diary" | "budget_update";
  message: string;
  schedule: string;               // "daily_6pm" | "weekly_saturday" | "once_2026-03-15"
  last_triggered: Date | null;
  next_trigger: Date | null;
  active: boolean;
  created_at: Date;
}
```

### Default Scout Data (for Will's initial document)
```typescript
const WILL_DEFAULT = {
  scout_name: "Will",
  troop: "2024",
  quest_week: 1,
  phase: 1,
  merit_badges: {
    personal_management: {
      status: "NOT_STARTED",
      counselor: { name: "Mr. Chris McDaid", email: "chrismcdaid@att.net" },
      scoutbook_started: false,
      blue_card_signed_date: null,
      requirements: {
        req1: { status: "NOT_STARTED", notes: "", started_date: null, completed_date: null },
        req2: { status: "NOT_STARTED", notes: "", started_date: null, completed_date: null, week_count: 0 },
        req8: { status: "NOT_STARTED", notes: "", started_date: null, completed_date: null, day_count: 0 },
      }
    },
    family_life: {
      status: "NOT_STARTED",
      counselor: { name: "Mrs. Nicole Allen", email: "texnicking@gmail.com" },
      scoutbook_started: false,
      blue_card_signed_date: null,
      requirements: {
        req3: { status: "NOT_STARTED", notes: "", started_date: null, completed_date: null, day_count: 0 },
        req4: { status: "NOT_STARTED", notes: "", started_date: null, completed_date: null },
        req5: { status: "NOT_STARTED", notes: "", started_date: null, completed_date: null },
      }
    }
  },
  hardware: {
    owned: [
      { name: "AMD Ryzen 5600X CPU", category: "cpu" },
      { name: "Radeon RX 480 GPU", category: "gpu" }
    ],
    purchased: [],
    installed: [],
    still_needed: [
      { name: "Thermalright Assassin X120 Cooler", category: "cooler", estimated_price: 20, unlock_week: 2 },
      { name: "16GB DDR4-3200 RAM", category: "ram", estimated_price: 65, unlock_week: 4 },
      { name: "B550M Motherboard", category: "motherboard", estimated_price: 90, unlock_week: 7 },
      { name: "1TB NVMe SSD", category: "ssd", estimated_price: 95, unlock_week: 8 },
      { name: "Micro-ATX Mini Tower Case", category: "case", estimated_price: 50, unlock_week: 10 },
      { name: "600W Power Supply", category: "psu", estimated_price: 55, unlock_week: 13 }
    ],
    scavenging: ["Possible case from existing hardware — suitability TBD"],
    bonus_unlocks: ["Gaming keyboard — stretch goal"]
  },
  budget: {
    total_earned: 0,
    total_spent: 0,
    target_estimate: 375,
    weekly_allowance: 15,
    transactions: []
  },
  chores: {
    log: [],
    current_streak: 0,
    longest_streak: 0,
    daily_chores: []  // Will sets these up with Scout Coach
  },
  emails_sent: [],
  key_decisions: [],
  diary_entries: []
};
```

---

## MCP TOOLS (8 total)

### 1. get_quest_state
**Purpose:** Retrieve the full quest state for a scout. The AI calls this at the start of every session.
**Params:**
- `scout_name` (string, optional) — defaults to first/only scout if omitted
**Returns:** The full scout document (minus _id), formatted for readability. Include computed fields:
- `days_since_start`: calculated from quest_start_date
- `budget_remaining`: target_estimate - total_spent
- `next_unlock`: next item in still_needed based on quest_week
- `chore_streak_status`: current streak and whether today's chores are logged
**Error:** If no scout found, return message telling AI to run onboarding (ask name, troop, create profile).

### 2. update_quest_state
**Purpose:** Update specific fields in the scout's quest state. Flexible updater — the AI decides what to update based on conversation.
**Params:**
- `scout_name` (string, optional)
- `updates` (object) — a partial/nested update object. Uses MongoDB dot notation internally. Examples:
  - `{ "quest_week": 5 }`
  - `{ "merit_badges.personal_management.requirements.req1.status": "IN_PROGRESS" }`
  - `{ "merit_badges.personal_management.scoutbook_started": true }`
  - `{ "phase": 2 }`
  - `{ "chores.daily_chores": ["dishes", "trash", "dog", "laundry", "vacuum"] }`
- `add_transaction` (object, optional) — `{ amount, description, type, category }` — appends to budget.transactions and updates totals
- `add_hardware_purchase` (object, optional) — `{ name, category, price_paid, source }` — moves item from still_needed to purchased, updates budget
- `add_email_record` (object, optional) — `{ to, cc, subject, context }` — appends to emails_sent
- `add_decision` (object, optional) — `{ decision, rationale }` — appends to key_decisions
- `add_diary_entry` (object, optional) — `{ scheduled_tasks, actual_tasks, notes }` — appends to diary_entries
**Returns:** Confirmation message with what was updated. If a hardware purchase, include celebratory "LOOT DROP" message.
**Side effects:** Always sets `updated_at` to now. If adding transaction of type "earned", increment total_earned. If "spent", increment total_spent.

### 3. get_quest_summary
**Purpose:** Generate a fun, gamified status summary for the scout. This is what the AI shows when Will asks "where am I?" or at session start.
**Params:**
- `scout_name` (string, optional)
**Returns:** A formatted summary string with gaming language:
```
🎮 QUEST STATUS — Week 5, Phase 2: MEMORY & THE BOSS FIGHT

💰 TYCOON STATS: $75 earned / $85 spent / $290 remaining to target
🔥 CHORE STREAK: 12 days! (Longest: 12)
🎒 INVENTORY: CPU ✅ GPU ✅ Cooler ✅ RAM ✅ | Next Loot Drop: Motherboard (~$90, Week 7)

📋 MERIT BADGE PROGRESS:
  Personal Management: IN PROGRESS
    ✅ Req 1 (Shopping Strategy) — Complete
    🔄 Req 2 (13-Week Budget) — Week 5 of 13
    ✅ Req 8 (7-Day Schedule) — Complete
  Family Life: IN PROGRESS
    🔄 Req 3 (90-Day Chores) — Day 34 of 90
    ⬜ Req 4 (Boss Fight Project) — Not Started
    ⬜ Req 5 (Family Project) — Not Started

📧 EMAILS: 2 sent (Mr. McDaid intro, Mrs. Allen FL intro)
🏗️ BUILD STATUS: CPU + RAM + Cooler ready for mobo install!
```

### 4. compose_email
**Purpose:** Generate a mailto: link or email draft for scout-initiated communications. Pre-fills To, CC, Subject, Body. Does NOT actually send — Will clicks the link to open his email client and review before sending.
**Params:**
- `to` (string) — recipient email
- `cc` (string[], optional) — additional CC recipients. **ALWAYS auto-includes jebramwell@gmail.com** (YPT requirement). Tool adds it even if not specified.
- `subject` (string)
- `body` (string) — the email body text
- `context` (string) — what this email is for (logged in emails_sent)
**Returns:** 
- A `mailto:` link with all fields URL-encoded. Format: `mailto:{to}?cc={cc}&subject={subject}&body={body}`
- A human-readable preview of the email
- Reminder: "Tap the link to open in your email app. Make sure your Dad is CC'd before sending!"
**Side effect:** Logs the email in the scout's emails_sent array (date, to, cc, subject, context).
**YPT ENFORCEMENT:** The tool ALWAYS adds Jeremy's email to CC. If the AI somehow doesn't include it, the tool adds it. This is a hard safety rule.

### 5. log_chore
**Purpose:** Record that the scout completed their daily chores.
**Params:**
- `scout_name` (string, optional)
- `tasks` (string[]) — which specific chores were done (e.g., ["dishes", "trash", "walked dog"])
- `earned` (number) — how much money earned for today's chores
- `notes` (string, optional)
**Returns:**
- Confirmation with streak update
- If streak hits milestones (7, 14, 30, 60, 90): celebratory message
- If streak would break (no log yesterday): warning that streak resets
- Current total earned
- Progress toward next Loot Drop
**Side effects:**
- Appends to chores.log
- Adds "earned" transaction to budget
- Updates total_earned
- Recalculates current_streak (check if yesterday had a log entry)
- Updates longest_streak if current > longest
- Increments FL Req 3 day_count

### 6. get_chore_streak
**Purpose:** Quick check on chore streak and earnings without full quest state.
**Params:**
- `scout_name` (string, optional)
**Returns:**
- Current streak (days)
- Longest streak
- Total earned so far
- Today's chores logged? (yes/no)
- Days remaining for FL Req 3 (90 - day_count)
- Amount needed for next hardware unlock
- Motivational message based on streak length

### 7. check_reminders
**Purpose:** Check for any pending reminders or overdue items. AI should call this at session start.
**Params:**
- `scout_name` (string, optional)
**Returns:** Array of reminder objects, each with:
- type, message, urgency ("info" | "warning" | "urgent")
**Logic checks:**
- Did scout log chores today? If not → "Don't forget to log today's chores!"
- Is PM Req 8 diary in progress and no entry today? → "Log your diary entry!"
- Is budget week behind? (quest_week > req2.week_count) → "Time to update your budget spreadsheet!"
- Has it been > 7 days since last email to counselor during active badge? → "Consider sending a progress update to your counselor"
- Is a Loot Drop available? (earned enough for next unlock AND quest_week >= unlock_week) → "🎉 LOOT DROP AVAILABLE! You can unlock [item]!"
- Is chore streak in danger? (yesterday not logged) → "⚠️ Your streak is at risk!"

### 8. search_hardware
**Purpose:** Help the scout research current hardware prices. Wraps a web search or returns cached price data.
**Params:**
- `query` (string) — what to search for, e.g., "DDR4-3200 16GB RAM price"
- `sources` (string[], optional) — preferred sources ["amazon", "newegg", "microcenter"]
**Returns:** 
- Note: This tool may be implemented as a simple passthrough that tells the AI to use its own web search capability, OR it could store/cache price lookups from previous sessions.
- For V1, just return the last known prices from constants.ts and tell the AI to web search for current prices.
- Future: Actually scrape/cache prices.
**V1 Implementation:** Return static price estimates from the hardware list with a note: "These are estimated prices from [date]. Ask me to web search for current prices if you want the latest."

---

## SERVER INSTRUCTIONS (returned to AI via MCP serverInstructions)

The MCP server should return instructions that tell the AI how to use the tools effectively. This gets injected into the AI's context when the MCP server connects:

```
SCOUT QUEST MCP — TOOL USAGE GUIDE

You have access to the Scout Quest tools for tracking Will's PC Build Quest progress.

SESSION START PROTOCOL:
1. Call check_reminders to see if anything needs attention
2. Call get_quest_state (or get_quest_summary for a quick overview) to load current progress
3. Address any urgent reminders first
4. Ask Will what he wants to work on today

WHEN TO USE EACH TOOL:
- get_quest_state: Start of session, or when you need to reference specific details
- update_quest_state: Whenever Will completes something, makes a decision, or status changes
- get_quest_summary: When Will asks "where am I?" or you want to show progress
- compose_email: When Will needs to email a counselor or adult leader. ALWAYS include Dad in CC. Use Socratic method to help Will write the email — don't write it for him. Use compose_email only AFTER Will has drafted the content with your guidance.
- log_chore: When Will reports completing chores. Celebrate streaks!
- get_chore_streak: Quick streak check without loading full state
- check_reminders: Start of session and when discussing what to do next
- search_hardware: When discussing prices or making purchase decisions

IMPORTANT RULES:
- NEVER write complete emails for Will. Help him build the email piece by piece, then use compose_email with HIS words.
- ALWAYS celebrate Loot Drops (hardware purchases) enthusiastically
- If update_quest_state returns a streak milestone, celebrate it
- If Will's chore streak is at risk, make it urgent but encouraging, not punishing
- The compose_email tool ALWAYS adds Dad's email to CC for YPT compliance — you don't need to worry about this, but DO remind Will that Dad is CC'd
```

---

## IMPLEMENTATION NOTES

### MCP SDK Usage (TypeScript)
```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server({
  name: "scout-quest",
  version: "1.0.0",
}, {
  capabilities: {
    tools: {},
  }
});

// Register tools via server.setRequestHandler for "tools/list" and "tools/call"
// Each tool defined with name, description, inputSchema (JSON Schema), and handler function

const transport = new StdioServerTransport();
await server.connect(transport);
```

### MongoDB Connection (db.ts)
```typescript
import { MongoClient, Db } from "mongodb";

let db: Db | null = null;

export async function getDb(): Promise<Db> {
  if (db) return db;
  const uri = process.env.MONGO_URI || "mongodb://mongodb:27017/scoutquest";
  const client = new MongoClient(uri);
  await client.connect();
  db = client.db();  // uses db name from URI
  return db;
}

export async function getScoutsCollection() {
  const database = await getDb();
  return database.collection("scouts");
}

export async function getRemindersCollection() {
  const database = await getDb();
  return database.collection("reminders");
}
```

### Package.json essentials
```json
{
  "name": "scout-quest-mcp",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "mongodb": "^6.0.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/node": "^20.0.0"
  }
}
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"]
}
```

### Build & Deploy
```bash
# On VM, in /opt/scoutcoach/librechat/mcp-servers/scout-quest/
npm install
npm run build
# Then restart LibreChat API container to pick up the new MCP server:
cd /opt/scoutcoach/librechat
sudo -u scoutcoach docker compose restart api
```

---

## DEPLOYMENT CHECKLIST

1. [ ] Create /opt/scoutcoach/librechat/mcp-servers/scout-quest/ directory
2. [ ] Write all source files (package.json, tsconfig.json, src/*.ts)
3. [ ] npm install && npm run build inside that directory
4. [ ] Update librechat.yaml to uncomment/add the mcpServers.scout-quest section
5. [ ] Restart API container: sudo -u scoutcoach docker compose restart api
6. [ ] Check API logs for MCP server connection: sudo -u scoutcoach docker compose logs api -f
7. [ ] In LibreChat UI, create "Scout Coach" Agent with scout-quest MCP tools enabled
8. [ ] Paste adapted Tier 1 system prompt into Agent instructions
9. [ ] Test: say "Hi, I'm Will!" — should trigger get_quest_state, find no scout, prompt onboarding
10. [ ] Test: complete onboarding, verify document created in MongoDB
11. [ ] Test: log a chore, verify streak calculation
12. [ ] Test: compose an email, verify mailto: link and YPT CC enforcement

## KNOWN GOTCHAS FROM DEPLOYMENT
- MongoDB service name is `mongodb` not `mongo` in docker-compose
- The API container runs as user scoutcoach (UID/GID set in .env)
- MeiliSearch has non-critical fetch errors — ignore
- OpenAI has quota issue — may affect any OpenAI-dependent features
- SMTP credentials for Gmail need app password, not regular password (currently failing for password reset — non-critical for MCP)
- Caddy handles HTTPS automatically — no cert management needed
- The override file uses empty user string for mongodb to let it run as default internal user

## FUTURE ENHANCEMENTS (NOT V1)
- Proper LibreChat user ID passthrough for multi-scout support
- Cron-based reminder system that proactively sends emails
- Hardware price caching/comparison via actual web scraping
- Photo upload analysis for build troubleshooting (LibreChat already supports image upload to Claude)
- Budget spreadsheet generation (export to CSV/Excel)
- Progress dashboard web page
- n8n integration for automated workflows
- LibreChat interface lockdown for Will (modelSpecs enforce + interface toggles)
