# Safety Flagging & Adult Notification — Design

**Created:** 2026-04-26
**Status:** Design (approved 2026-04-26)
**Related:** `docs/plans/2026-04-26-scout-state-and-summaries.md`, `docs/plans/2026-04-26-alpha-evolution-roadmap.md`

## Problem

Scouts (ages 11–17) talking to an AI coach will sometimes raise topics that warrant adult attention: bullying, family conflict, self-harm signals, substance use, abuse disclosure, or inappropriate adult contact. The system needs to:

1. Detect these reliably without alert-fatiguing parents/leaders.
2. Route notifications to the right adult (parent for personal safety, scoutmaster for troop-wide concerns) under BSA's **two-deep leadership** principle.
3. Comply with **COPPA** data handling and **state mandated-reporter** obligations (Jeremy as registered scoutmaster is a mandated reporter in Georgia).
4. Frame disclosures to adults in a way that *doesn't* re-traumatize a young person who chose to confide in the AI.

We have nothing here today. Building this is a hard prerequisite for alpha — we cannot expose real youth to the system without it.

## Design principles

- **Two-deep digital.** Every flagged conversation surfaces to at least two registered adults (parent + scoutmaster, or two leaders if no parent connected). Mirrors BSA YPT's two-deep principle into the digital channel.
- **Initiator matters.** A scout who *brings up* a topic is a different signal than a scout who *responds to* a coach question that touched the topic. We tier accordingly.
- **Human review before law-enforcement escalation.** The system never auto-files mandated reports. It surfaces with high urgency to a human (Jeremy initially) who decides.
- **Conservative thresholds during alpha.** Better to false-positive 5% than false-negative 0.1%. Tune down with data, not up.
- **Trauma-informed framing.** Notifications are information ("Liam mentioned feeling really down about school last week"), not alarm ("YOUR CHILD IS IN CRISIS").

## Three-tier escalation framework

Adapted from Crisis Text Line's tiered model (cited in research notes), tuned for scouting context.

### Tier 1 — log, no notification

**Trigger**: Concerning topic surfaces in passing, without scout initiation, without indication of personal crisis.

**Examples**:
- Scout overhears older scouts joking about vaping, mentions it casually
- Scout describes a movie scene involving violence
- Scout mentions a friend whose parents are divorcing
- Scout asks a definitional question ("what does anxiety mean?")

**Action**:
- Append `safety_event` to `conversation_summaries.safety_tier = 1` with category + quote
- Visible to admin (Jeremy) on a "recent flags" panel for trend monitoring
- Not surfaced to parent or scoutmaster
- Retained for pattern detection

### Tier 2 — parent notification, contextualized

**Trigger**: Scout explicitly raises a concerning topic in a way suggesting ongoing concern but not imminent crisis.

**Examples**:
- "I keep getting picked on at school"
- "I don't think anyone likes me"
- "My dad and mom have been fighting a lot"
- "I tried [substance] at a party"
- "Sometimes I just feel really sad and I don't know why"
- Questions about sexual orientation in a context suggesting peer pressure or distress
- Repeated Tier 1 events in same category over <30 days

**Action**:
- Email + ntfy push to parent within 1 hour
- Framing template (information, not alarm):
  > "Liam talked with the coach today and brought up [topic]. Here's a piece of what he said: '[quote]'. We thought you'd want to be aware so you can check in with him. Resources: [crisis text line, parent guide for the topic]."
- Conversation summary card in `history.html` gets a soft-yellow banner
- Scoutmaster (Jeremy) sees it in admin dashboard but is NOT individually notified — keeps two-deep present without flooding leader inbox
- Logged with full audit trail

### Tier 3 — multi-channel emergency, multi-adult

**Trigger**: Disclosure of ongoing abuse, active self-harm intent with detail, inappropriate adult contact, imminent risk indicators.

**Examples**:
- "[Adult] touched me in a way that wasn't okay"
- "I've been thinking about killing myself" + any specificity (method, means, timeframe)
- "I have [pills/weapon] right here"
- "[Adult] keeps texting me late at night and asks me not to tell"

**Action**:
- **Immediate** (< 60s): SMS + phone call attempt to parent (Twilio), simultaneous SMS to scoutmaster, ntfy to admin
- Admin dashboard turns red until an adult acknowledges
- If no acknowledgment in 15 minutes, escalation tree (configured per scout):
  - Secondary parent
  - Scoutmaster cell
  - Designated BSA YPT contact
- The **agent itself** (in the live conversation) shifts to a calm, present, supportive mode and surfaces crisis resources (Crisis Text Line: 741741, 988 Suicide & Crisis Lifeline). It does *not* tell the scout "I'm telling your parents" — that can shut down disclosure or cause panic. It says: "I want to make sure you have someone safe to talk to right now. Can we stay connected while you reach out to [parent name]?"
- A human (Jeremy in alpha) reviews within 15 min and decides whether to file a state mandated report (Georgia DFCS for abuse, 911 for active risk)
- Conversation card in `history.html` is red-banner with "URGENT REVIEW REQUIRED"
- Full conversation locked in audit collection with retention per Georgia child-protection record law (typically 5y minimum)

## Detection pipeline

Two-stage classifier. Per the research, general-purpose moderation APIs (OpenAI moderation, Anthropic, Perspective) underperform on youth-specific risks (Perspective F1 ~0.35, OpenAI moderation F1 ~0.09). YouthSafe — a fine-tuned LLaMA-Guard model on the YAIR dataset — hits F1 0.88 on youth contexts.

### Stage 1: every assistant turn → fast classifier

Run on **every** conversation turn (scout message + assistant response). Cost is real but small.

**Options evaluated**:
- **YouthSafe** (open-weight, fine-tuned LLaMA Guard) — best F1 on youth. ~7B params, can self-host on CPU with quantization. Slow (~2s/turn) but acceptable as a side-channel post-response.
- **OpenAI Moderation API** — free, fast, weak on youth-specific. Use as supplementary but not primary.
- **Claude with safety system prompt** — Haiku running a YPT-tuned classifier prompt. ~$0.0002/turn. Best engineering ergonomics; tunable phrasing. Recommended for alpha.

**Alpha decision**: Claude Haiku as primary classifier with a structured-output system prompt that returns `{category, severity, initiator, confidence, quote}`. Re-evaluate against YouthSafe once we have a few weeks of real conversations to calibrate.

Classifier outputs the structured **risk vector** from the research:
```ts
interface RiskVector {
  category: "self_harm" | "abuse_disclosure" | "bullying" | "substance_use"
          | "inappropriate_adult_contact" | "mental_health_crisis"
          | "family_conflict" | "other_concern" | "none";
  severity: 1 | 2 | 3;             // mentionable / important / urgent
  confidence: number;              // 0-1
  initiator: "scout" | "coach" | "external_quote";  // who raised it
  quote: string;                   // exact triggering text
}
```

### Stage 2: rule-based tier assignment

Classifier output → escalation tier via deterministic rules in `backend/src/safety/tier.ts`:

```ts
function assignTier(rv: RiskVector): 1 | 2 | 3 | null {
  if (rv.category === "none" || rv.confidence < 0.5) return null;

  // Hard rules — abuse disclosure or active self-harm always Tier 3
  if (rv.category === "abuse_disclosure" && rv.initiator === "scout") return 3;
  if (rv.category === "inappropriate_adult_contact" && rv.initiator === "scout") return 3;
  if (rv.category === "self_harm" && rv.severity === 3) return 3;
  if (rv.category === "mental_health_crisis" && rv.severity === 3) return 3;

  // Tier 2 — scout-initiated, ongoing concern but not imminent
  if (rv.initiator === "scout" && rv.severity >= 2) return 2;
  if (rv.initiator === "scout" && rv.severity === 1 && rv.confidence > 0.85) return 2;

  // Tier 1 — anything else with category != none
  return 1;
}
```

**False-positive suppression** layered on top:
- If the same `(scoutEmail, category)` already produced a Tier 2 within 7 days, don't re-fire — log as Tier 1 update to the existing case.
- If the quote matches a known coach prompt that mentions the topic (e.g., the coach said "let's talk about handling stress"), classify as `initiator: coach` and downgrade.
- If the conversation transcript shows the scout was asking academic/definitional questions ("for health class, what's the difference between..."), suppress.

### Pattern detection (cross-conversation)

A nightly cron job aggregates Tier 1 events per scout. If a scout has ≥3 Tier 1 events in the same category within 30 days, **promote the latest to Tier 2**. Catches the slow-escalation pattern where each individual mention is benign but the cumulative signal isn't.

## Notification routing

`backend/src/safety/notify.ts`:

```
Tier 1 → admin dashboard only
Tier 2 → email parent + ntfy parent + admin dashboard yellow card
Tier 3 → SMS + phone call parent (Twilio)
       + SMS scoutmaster
       + ntfy admin (red, persistent)
       + admin dashboard red banner
       + 15-min escalation timer if not acknowledged
```

Channels:
- **Email**: Resend (already in `project_communication_strategy.md`)
- **SMS + phone**: Twilio (new — needs onboarding)
- **Push (admin/parent app)**: ntfy (already in stack)

## Compliance

### COPPA (federal)

- **Parental consent** captured at alpha onboarding via Google sign-in flow. The "Welcome / Consent" page lists what we collect, why, retention policy, and the safety-flagging system. No use of data for model training.
- **Data minimization**: only store what's needed. Conversation logs default 90-day retention; safety-flagged Tier 3 cases retained 5y per Georgia child-protection norms.
- **Parental access**: parent can export and delete their scout's data via admin request → manual workflow during alpha; build an "export my data" button later.

### Georgia mandated reporting

Jeremy (registered scoutmaster) is a mandated reporter under Georgia law for suspected child abuse. The system must:

- **Surface candidates, not auto-report.** A flagged Tier 3 abuse disclosure goes to Jeremy's queue with full context. He decides if it rises to "reasonable suspicion."
- **Make non-reporting visible.** If Jeremy reviews and decides not to report, the system records his rationale (free-text) for audit. This protects against later claims of negligence and forces conscious decision-making.
- **Provide direct DFCS contact info** in the review UI: 1-855-422-4453 (Georgia Child Abuse and Neglect Reporting), with "I have filed a report" button that locks the case file.

### BSA YPT alignment

- **Two-deep digital**: Tier 2/3 always notify ≥2 registered adults (parent + scoutmaster minimum).
- **No one-on-one private channel**: the agent never has a "secret" conversation. All conversations are accessible to parent/scoutmaster per role rules. UI makes this visible to the scout ("your parent and scoutmaster can see what we talk about").
- **Audit trail**: every notification, every adult acknowledgment, every reporting decision logged in `safety_audit` collection.

## Data model

### `safety_events` collection

```ts
interface SafetyEvent {
  _id: ObjectId;
  scoutEmail: string;
  conversationId: ObjectId;
  ts: Date;
  tier: 1 | 2 | 3;
  riskVector: RiskVector;            // see above
  classifierVersion: string;         // for retraining/recalibration
  suppressedReason?: string;         // if false-positive rule fired

  // Notification delivery state
  notifications: Array<{
    channel: "email" | "sms" | "phone" | "ntfy" | "dashboard";
    recipient: string;               // email or phone
    recipientRole: "parent" | "scoutmaster" | "admin";
    sentAt: Date;
    deliveredAt?: Date;
    acknowledgedAt?: Date;
    acknowledgedBy?: string;
  }>;

  // Review state
  reviewedAt?: Date;
  reviewedBy?: string;
  reviewDecision?: "no_action" | "parent_followup" | "scoutmaster_followup"
                 | "mandated_report_filed" | "emergency_services_called";
  reviewNotes?: string;              // free-text rationale
  caseClosed: boolean;
}
```

### `safety_audit` collection

Append-only log of every safety-system action: notifications sent, reviews completed, reports filed. For audit/legal use only.

## Implementation plan

| Step | Deliverable | Est |
|------|-------------|-----|
| 1 | Haiku safety classifier in `backend/src/safety/classifier.ts` with prompt + structured output | 0.5d |
| 2 | Tier-assignment + suppression rules in `backend/src/safety/tier.ts` | 0.25d |
| 3 | Pipe classifier into chat.ts (post-response, fire-and-forget like episodes) | 0.25d |
| 4 | `safety_events` collection + writer | 0.25d |
| 5 | Notification routing — email (Resend), ntfy, dashboard. Twilio deferred to step 11 | 0.5d |
| 6 | Pattern-detection nightly cron (Tier 1 promotion) | 0.25d |
| 7 | Admin "Safety Queue" dashboard — list flagged events, filter by tier, ack button | 1d |
| 8 | Parent-facing notification email templates (Tier 2) | 0.25d |
| 9 | In-conversation crisis response (agent system prompt addition for Tier 3 detection) | 0.5d |
| 10 | Review/decide/document UI for Jeremy: log mandated-report decisions | 0.5d |
| 11 | Twilio integration for Tier 3 SMS/phone | 0.5d |
| 12 | Tests: fixture conversations covering each tier, false-positive suppression cases | 1d |
| 13 | Documentation: parent-facing "what we flag and why" page | 0.5d |

**Total: ~6 agent-days.**

## Out of scope for alpha

- **Self-hosted YouthSafe**: revisit after we have 4-8 weeks of Haiku classifier data to evaluate quality.
- **Per-state legal compliance variations**: alpha is single-state (Georgia) — generalize when expanding.
- **Auto-filed reports**: never. Always human-in-the-loop.
- **ML-trained suppression**: hand-coded rules until data exists.

## Risks

1. **Haiku misclassification.** Safety classifiers fail unpredictably on slang, sarcasm, code-switching common to teens. Mitigation: aggressively conservative — alpha tunes for low false-negative even at cost of false-positive overhead. Manual review queue catches errors.
2. **Notification overload on Jeremy.** Single admin reviewing all flags. Mitigation: Tier 1 is silent, Tier 2 trickle, Tier 3 rare. If Jeremy is overwhelmed, that's data — adjust thresholds or recruit a second YPT-trained reviewer.
3. **Trust break from over-flagging.** If a parent gets flagged about benign content, they lose trust. Mitigation: pre-launch, manually review the first ~50 Tier 2 candidates before sending — measure false-positive rate, calibrate before parents see anything. Once <5% FPR, automate.
4. **Mandated-reporter liability if system misses a real abuse signal.** Mitigation: cannot eliminate; documented system + conservative tuning + transparent review trail is the legal posture. Consult with BSA Atlanta Council legal before alpha launch.

## Open questions

1. Does BSA Atlanta Council want a copy/visibility into Tier 3 events directly, or only at Jeremy's discretion? **Action: schedule conversation with council registrar before alpha launch.**
2. How does Twilio per-call cost scale for the alpha cohort? Negligible (<10 calls expected over alpha) but verify pricing.
3. For Tier 3 cases where the parent IS the suspected abuser, the parent notification is exactly the wrong move. Need a "pre-screen" question at onboarding ("is the parent appropriate to notify in safety events?") with fallback to scoutmaster-only. Default: notify both anyway to preserve two-deep, but make the routing configurable per scout.

## Decisions (answered 2026-04-26)

1. **Claude Haiku classifier for alpha**, evaluate YouthSafe replacement at week 8.
2. **Tier 3 always two-deep** by default — parent + scoutmaster simultaneously. Configurable per-scout if exception needed.
3. **System never files reports**, only surfaces with full context.
4. **Calibrate before launch**: pre-launch dry-run with synthetic transcripts plus the past 30 days of Jeremy's son's conversations (with consent) to measure baseline FPR.
