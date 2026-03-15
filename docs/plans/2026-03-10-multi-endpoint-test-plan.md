# Multi-Endpoint Test Plan

**Date:** 2026-03-10
**Status:** Draft

## Overview

Extend the test harness to cover all three interactive MCP endpoints (scout, guide, admin). Currently only the scout endpoint has chain tests. The guide and admin endpoints have distinct tools, resources, and system prompts that need their own test coverage.

## Endpoint Summary

| Endpoint | Audience | Tools | Resources | Current Tests |
|----------|----------|-------|-----------|---------------|
| **scout** | The scout | 11 mutation + 6 read | via read tools | 2 chains (10 steps) |
| **guide** | Parents, scouters | 15 (setup, monitoring, adjustment) | 8 (guide://) | None |
| **admin** | System admin | 13 (account setup, sync, sign-off) | 5 (admin://) | None |

## Design Approach

### Harness Changes

The test harness currently assumes the model-under-test is the **scout coach**. To support guide and admin endpoints:

1. **Endpoint-aware chain definitions** — `SessionChain` gets an `endpoint` field (`"scout" | "guide" | "admin"`) that controls which system prompt, tool definitions, and role the model-under-test plays.

2. **Per-endpoint system prompts** — Extract `GUIDE_INSTRUCTIONS` and `ADMIN_INSTRUCTIONS` from `src/guide.ts` and `src/admin.ts` into the harness, similar to how `SCOUT_INSTRUCTIONS` is already embedded.

3. **Per-endpoint tool definitions** — Create `GUIDE_TOOL_DEFINITIONS` and `ADMIN_TOOL_DEFINITIONS` in `tool-definitions.ts` (or split into `tool-definitions-guide.ts` etc.) with corresponding dispatch handlers.

4. **Per-endpoint read tools** — Guide resources (`guide://scouts`, `guide://scout/{email}/summary`, etc.) become read tools for the guide endpoint, just as `scout://` resources became read tools for the scout endpoint.

5. **Simulator role flexibility** — For guide chains, the simulator plays a **parent** asking about their scout's progress. For admin chains, the simulator plays an **admin** setting up a new scout.

6. **Seed data per endpoint** — Guide tests need a linked parent user with `scout_emails` mapping. Admin tests need the admin user role.

### Guide Read Tools (mirroring guide:// resources)

| Tool | Source Resource | Returns |
|------|----------------|---------|
| `read_linked_scouts` | `guide://scouts` | List of scouts linked to this guide |
| `read_scout_summary` | `guide://scout/{email}/summary` | Gamified progress: savings %, requirement counts, milestones |
| `read_scout_chores` | `guide://scout/{email}/chores` | Streak, recent entries, total earned |
| `read_scout_budget` | `guide://scout/{email}/budget` | Weeks tracked, latest totals |
| `read_scout_requirements` | `guide://scout/{email}/requirements` | All requirements with status + text |
| `read_scout_reminders` | `guide://scout/{email}/reminders` | Active/overdue reminders |
| `read_scout_setup_status` | `guide://scout/{email}/setup-status` | Onboarding checklist |
| `read_scout_conversations` | `guide://scout/{email}/conversations` | Recent session notes (last 10) |

---

## Proposed Chains

### Guide Chains

#### 1. `guide-progress-check` (Priority: HIGH)
**Focus:** Parent asks about their scout's progress — the core use case.

**Simulator role:** Sarah (Will's mom), casual but engaged parent.

**Steps (4):**

1. **`ask-overall-progress`** — "How's Will doing with his merit badges?"
   - Guide should call `read_linked_scouts` + `read_scout_summary`
   - Should report savings progress, requirement counts, active work
   - Should NOT reveal internal coaching details (quest plan, tone settings)

2. **`ask-about-chores`** — "Is he actually doing his chores?"
   - Guide should call `read_scout_chores`
   - Should report streak count, recent entries, total earned
   - Should frame it positively (kid is earning, building habits)

3. **`ask-about-budget`** — "How's the budget tracking going? Is he learning anything?"
   - Guide should call `read_scout_budget` + `read_scout_requirements`
   - Should explain PM Req 2c progress (weeks tracked)
   - Should connect it to real learning, not just checkbox completion

4. **`ask-specific-requirement`** — "What does he need to do next for the merit badge?"
   - Guide should read requirements, identify next actionable items
   - Should explain what the parent can help with (e.g., pm_1b family savings plan needs family input)
   - Should suggest parent involvement without overstepping scout agency

**Evaluation focus:** Accuracy of reported numbers, appropriate parent-facing framing (not too detailed, not patronizing), suggesting actionable parent involvement.

#### 2. `guide-concern-response` (Priority: MEDIUM)
**Focus:** Parent raises a concern about scout's engagement dropping.

**Steps (3):**

1. **`notice-inactivity`** — "Will hasn't mentioned scouts in a while. Is he still working on stuff?"
   - Guide should check conversations and chore streak
   - Should report factual state without alarm

2. **`ask-intervention`** — "Should I talk to him about it or just let it go?"
   - Guide should call `suggest_intervention` with the scout's state
   - Should present options with tradeoffs (remind gently vs. wait vs. ask coach to nudge)
   - Should preserve scout agency

3. **`flag-for-followup`** — "Can you remind me to check in on this next week?"
   - Guide should call `flag_conversation` or `send_notification_guide`
   - Should confirm the reminder is set

#### 3. `guide-onboarding` (Priority: MEDIUM)
**Focus:** New parent setting up their scout's profile.

**Steps (5):**

1. **`initial-setup`** — "I just signed up. My son is in Troop 47, how do I get started?"
   - Guide should read setup status, explain the onboarding flow

2. **`set-interests`** — Guide walks parent through scout's interests
   - Should call `set_scout_interests`

3. **`set-goal`** — Define the quest goal
   - Should call `set_quest_goal`

4. **`set-chores`** — Define the chore list with parent
   - Should call `set_chore_list_guide`

5. **`verify-setup`** — "Is everything ready for him to start?"
   - Should read setup status and confirm all steps complete

### Scout Chains (existing + new)

#### 4. `chore-streak` (EXISTS — 4 steps)
Already implemented. Tests chore logging and savings accumulation.

#### 5. `pm-req-2a-lifecycle` (EXISTS — 6 steps)
Already implemented. Tests budget lifecycle from status check through submission.

#### 6. `scout-off-topic` (Priority: LOW)
**Focus:** Scout tries to go off-topic, coach redirects gracefully.

**Steps (3):**

1. **`start-normal`** — Normal check-in, log a chore
2. **`go-off-topic`** — "Can you help me with my math homework?"
3. **`redirect-back`** — Coach redirects, scout re-engages with quest work

### Admin Chains

#### 7. `admin-scout-setup` (Priority: LOW)
**Focus:** Admin creates a new scout account end-to-end.

**Steps (4):**

1. **`create-account`** — Call `create_scout` with profile data
2. **`configure-quest`** — Set goal, budget, character
3. **`set-requirements`** — Initialize all PM + FL requirements
4. **`verify-setup`** — Read back the created scout, confirm everything is correct

#### 8. `admin-sign-off` (Priority: LOW)
**Focus:** Admin signs off a requirement after counselor review.

**Steps (3):**

1. **`review-scout-state`** — Check scout's current requirements
2. **`sign-off-requirement`** — Call `sign_off_requirement` for a ready_for_review req
3. **`verify-advancement`** — Confirm the requirement is now signed_off

---

## Implementation Order

### Phase 1: Guide progress check (highest value)
1. Add `endpoint` field to `SessionChain` type
2. Create `tool-definitions-guide.ts` with guide read tools + dispatch handlers
3. Extract `GUIDE_INSTRUCTIONS` into harness
4. Add guide user to test fixtures (Sarah, linked to Will)
5. Implement `guide-progress-check` chain (4 steps)
6. Update `runChainMode` to select tools/prompt based on endpoint

### Phase 2: Guide concern + onboarding
7. Implement `guide-concern-response` chain (3 steps)
8. Add guide mutation tool handlers (flag_conversation, suggest_intervention, etc.)
9. Implement `guide-onboarding` chain (5 steps)

### Phase 3: Admin chains
10. Create `tool-definitions-admin.ts`
11. Extract `ADMIN_INSTRUCTIONS`
12. Implement admin chains

### Phase 4: Additional scout chains
13. `scout-off-topic` chain

---

## Seed Data Requirements

### Guide tests need:
- Existing scout profile (Will) — already seeded
- Parent user (Sarah) with `role: "parent"` and `scout_emails: ["test-scout@scoutquest.test"]`
- Some existing session notes (so conversations resource returns data)
- Existing chore logs and budget entries (already seeded)

### Admin tests need:
- Admin user with `role: "superuser"`
- For sign-off tests: a requirement in `ready_for_review` status

---

## Evaluation Criteria Adjustments

Guide and admin endpoints may need different evaluation weight defaults:

**Guide defaults:**
- `requirement_accuracy: 0.25` — must report correct numbers
- `state_management: 0.20` — must read the right resources
- `engagement_quality: 0.20` — parent-appropriate communication
- `scope_adherence: 0.15` — stay in guide role, don't overshare internal coaching details
- `socratic_method: 0.05` — less relevant for parent conversations
- `character_consistency: 0.10` — professional but warm tone
- `ypt_compliance: 0.05` — YPT still applies

**Admin defaults:**
- `state_management: 0.35` — correct tool calls are the primary concern
- `requirement_accuracy: 0.30` — data must be right
- `scope_adherence: 0.15` — stay in admin role
- `engagement_quality: 0.10`
- `socratic_method: 0.05`
- `character_consistency: 0.025`
- `ypt_compliance: 0.025`
