# Scouting America API Reference

Reverse-engineered from Chrome DevTools HAR capture of `advancements.scouting.org` on 2026-02-22.

**Base URL:** `https://api.scouting.org`

## Authentication

JWT token obtained via `my.scouting.org` login. The Scoutbook Plus frontend stores it as a `token` cookie and also in a `SessionToken` cookie.

**Headers required for authenticated requests:**
```
Authorization: bearer {JWT_TOKEN}
Origin: https://advancements.scouting.org
Referer: https://advancements.scouting.org/
Content-Type: application/json
Accept: application/json
```

**JWT payload fields (relevant):**
- `uid` — User ID (numeric, e.g., `9120709`)
- `mid` — Member ID (string, e.g., `"131200255"`)
- `ugu` — User GUID
- `pgu` — Person GUID
- `exp` — Expiration (typically ~8 hours from issue)

---

## Reference Data Endpoints (no auth required for most)

### GET /advancements/ranks
All ranks across all programs. Returns `{ "ranks": [...] }`.

**Query params:** `version`, `id`, `programId`, `status`

**Programs:** Scouts BSA (id=2), Cub Scouting (id=1), Sea Scouting (id=5), Venturing (id=4)

**Scouts BSA ranks:** Scout (1), Tenderfoot (2), Second Class (3), First Class (4), Star (5), Life (6), Eagle (7)

### GET /advancements/ranks/{rankId}/requirements
Requirements for a rank (definition only, no completion status).

### GET /advancements/meritBadges
All 141 merit badges. Returns flat array. Each has `versions` array.

### GET /advancements/meritBadges/{mbId}/requirements
Requirements for a merit badge (definition only).

### GET /advancements/awards
All 347 awards (Firem'n Chit, Totin' Chip, etc.). Returns flat array.

### GET /advancements/adventures
All 301 Cub Scout adventures. Returns flat array.

### GET /advancements/ssElectives
Sea Scout electives.

---

## Organization/Unit Endpoints (auth required)

### GET /organizations/v2/{orgGuid}/profile
Unit profile: name, number, charter org, council, district, type, tenure.

### GET /organizations/v2/units/{orgGuid}/youths
**Full youth roster.** Returns unit metadata + `users[]` array with rich per-scout data:
- Name, DOB, age, gender, grade, address, email, phone
- `highestRanksAwarded[]` — current rank with dates and approval chain
- `positions[]` — patrol assignment, leadership positions with `patrolId` and `patrolName`
- `dateJoinedBoyScouts`, `bsaVerifiedDate`

### GET /organizations/v2/units/{orgGuid}/adults
**Full adult leader roster.** Same structure as youths, with positions like Scoutmaster, Committee Member, etc.

### GET /organizations/v2/units/{orgGuid}/parents
**Parent/guardian roster.** Parents linked to youth members.

### POST /organizations/v2/{orgGuid}/orgYouths
Youth roster with registration details. Body: `{"includeRegistrationDetails":true,"includeExpired":true}`

Returns `{ organizationInfo: {...}, members: [...] }` with registration status, charter info, ethnicity, grade.

### POST /organizations/v2/{orgGuid}/orgAdults
Adult roster with registration details. Same body format. Includes YPT status, training status, position trained status.

### GET /organizations/v2/units/{orgGuid}/subUnits
**Patrol definitions.** Returns array of patrols with `subUnitId` and `subUnitName`.

### GET /organizations/v2/{orgGuid}/advancementDashboard
Unit-level advancement stats: counts of completed, awarded, not-purchased ranks/MBs/awards.

### GET /organizations/v2/{orgGuid}/unitActivitiesDashboard
Unit-level activity stats: campouts, service projects, hikes with attendance counts.

### GET /organizations/v2/{orgGuid}/recipients
Unit members eligible for advancement recognition (25KB response).

### GET /organizations/positions/{orgGuid}
All positions currently assigned in the unit with holder details.

---

## Person/Profile Endpoints (auth required)

### GET /persons/{userId}/myScout
Returns array of scouts linked to this parent/guardian/leader.

Each scout object includes:
```json
{
  "userId": "12352438",
  "memberId": "141634365",
  "relationship": "Parent/Guardian",
  "personGuid": "...",
  "firstName": "William",
  "lastName": "Bramwell",
  "nickName": "Will",
  "orgGuid": "...",
  "unitId": "121894",
  "organizationName": "PACE ACADEMY",
  "position": "Scouts BSA",
  "unitType": "Troop",
  "unitNumber": "2024",
  "program": "Scouts BSA",
  "programId": 2
}
```

### GET /persons/v2/{userId}/personprofile
Full person profile. Works with numeric userId or person GUID.

Returns `{ "profile": {...}, "currentProgramsAndRanks": [...] }`.

Profile fields include: name, DOB, gender, phone, school, member type (Adult/Youth), OA status, Eagle status, swimming classification, addresses, etc.

### GET /persons/v2/{personGuid}/trainings/ypt
YPT training status: completion date, expiry date, status (ACTIVE/EXPIRED).

### GET /persons/{personGuid}/roleTypes
User's roles and permissions within each organization.

### GET /persons/{personGuid}/subscriptions
Communication subscriptions (email, text, calendar).

### GET /persons/{personGuid}/renewalRelationships
Renewal/registration relationships including parent-child links.

### POST /persons/v2/{personGuid}/membershipRegistrations
Registration details for a person. Body: `{"status":["current"],"organizationGuid":"..."}`

---

## Youth Advancement Endpoints (auth required)

### GET /advancements/v2/youth/{userId}/ranks
Scout's rank progress across all programs. Includes completion percentage and status.

Returns:
```json
{
  "status": "All",
  "program": [{
    "programId": 2,
    "program": "Scouts BSA",
    "totalNumberOfRanks": 7,
    "ranks": [
      {
        "id": 1,
        "name": "Scout",
        "percentCompleted": 1,
        "status": "Awarded",
        "dateEarned": "2025-11-13",
        "awardedDate": "2025-11-19",
        ...
      }
    ]
  }]
}
```

**Status values:** "Awarded", "Started", (not started = not in list or 0%)

### GET /advancements/v2/youth/{userId}/ranks/{rankId}/requirements
Individual requirement completion status for a scout + rank.

Each requirement includes:
- `completed` (bool), `started` (bool)
- `dateCompleted`, `dateStarted`
- `leaderApprovedDate`, `leaderApprovedUserId`
- `percentCompleted` (0 or 1 for individual reqs, 0-1 for parent reqs)
- `parentRequirementId` (for sub-requirements)

### GET /advancements/v2/youth/{userId}/meritBadges
Scout's merit badge progress. Returns array of started/completed MBs.

Each badge includes: `dateStarted`, `dateCompleted`, `percentCompleted`, `status`, `assignedCounselorUserId`, approval chain fields.

### GET /advancements/v2/youth/{userId}/meritBadges/{mbId}/requirements
Individual requirement completion for a scout + merit badge.

### GET /advancements/v2/youth/{userId}/awards
Scout's awards (Firem'n Chit, Totin' Chip, etc.) with completion status.

### GET /advancements/v2/{userId}/userActivitySummary
Activity summary: camping days/nights, hiking miles, service hours, long cruise days.

```json
{
  "campingLogs": { "totalNumberOfDays": 1, "totalNumberOfNights": 1, "percentCompleteTowardGoal": 0.05 },
  "hikingLogs": { "totalNumberOfMiles": 0, "percentCompleteTowardGoal": 0 },
  "serviceLogs": { "totalNumberOfHours": 5, "percentCompleteTowardGoal": 0.33 }
}
```

---

## Calendar & Events Endpoints (auth required)

### GET /advancements/v2/users/{userId}/calendars
User's calendar subscriptions. Returns array of calendars for the unit and each patrol.

```json
[
  { "userCalendarId": 5333885, "unitId": 121894, "patrolId": null, "calendarCode": "UnitID121894" },
  { "userCalendarId": 5333886, "unitId": 121894, "patrolId": 175529, "calendarCode": "PatrolID175529" }
]
```

**Patrols for Troop 2024:**
| subUnitId | Name |
|-----------|------|
| 145820 | Flaming Tortillas |
| 145821 | Old Men |
| 175529 | Alumni |
| 175671 | New Scouts |
| 175672 | Dear Leaders |

### POST /advancements/events
Fetch events for a unit within a date range. **Also serves as a de facto roster query** — each event's `invitedUsers` array contains every unit member.

**Request body:**
```json
{
  "unitId": 121894,
  "fromDate": "2026-02-01",
  "toDate": "2026-03-01",
  "showDLEvents": true
}
```

**Response:** Array of event objects. Key fields per event:
- `name`, `location`, `startDate`, `endDate`, `eventType`, `description`
- `units[].unitId`, `units[].unitFullName`, `units[].patrolId`, `units[].patrolName`
- `invitedUsers[]` — **full roster**: `userId`, `firstName`, `lastName`, `nickName`, `isAdult`, `rsvp`, `attended`

**Roster discovery pattern:** Fetch events, deduplicate `invitedUsers` across all events → complete unit roster.

---

## Comments Endpoint (POST, auth required)

### POST /advancements/v2/users/{userId}/comments
Get comments/notes for a specific advancement.

**Request body:**
```json
{
  "advancementId": 2,
  "advancementType": "ranks",
  "versionId": 83
}
```

---

## Lookup Endpoints

### GET /lookups/address/states
US states list.

### GET /lookups/address/countries
Country list with id, name, short code.

### GET /lookups/communications/phoneCountryCodes
Phone country codes.

### GET /lookups/communications/communicationTypes
Communication type definitions.

### GET /lookups/communications/mobilePhoneCarrier
Mobile phone carrier list.

### GET /lookups/person/grades
School grade levels.

### GET /lookups/person/nameSuffixes
Name suffix options (Jr, Sr, III, etc).

### GET /lookups/person/titlePrefixes
Title prefix options (Mr, Mrs, Dr, etc).

### GET /lookups/advancements/swimmingClassification
Swimming levels: Nonswimmer, Beginner, Swimmer.

### GET /lookups/advancements/unitTimezone
Unit timezone options.

### GET /lookups/advancements/youthLeadershipPositions
All youth leadership positions with unit type mappings. Includes SPL, ASPL, Patrol Leader, Quartermaster, Scribe, etc.

### GET /lookups/person/positions
All possible positions across all program types (381KB — very large).

---

## Auth Flow Endpoints

### POST https://my.scouting.org/api/users/{USERNAME}/authenticate
Direct username/password auth. Returns JWT token + userId.

### GET https://auth.scouting.org/api/users/self_{guid}/sessions/current
Session validation check (returns 401 if expired).

### GET https://auth.scouting.org/api/users/logout
Invalidate current session (returns 204).

---

## Key IDs

### Scouts BSA Rank IDs
| ID | Name | Version |
|----|------|---------|
| 1 | Scout | 2022 |
| 2 | Tenderfoot | 2022 |
| 3 | Second Class | 2022 |
| 4 | First Class | 2022 |
| 5 | Star Scout | 2016 |
| 6 | Life Scout | 2016 |
| 7 | Eagle Scout | 2022 |

### Troop 2024 (unitId: 121894, orgGuid: E1D07881-103D-43D8-92C4-63DEFDC05D48)

**Bramwell family:**
| User | userId | memberId | Role |
|------|--------|----------|------|
| Jeremy Bramwell | 9120709 | 131200255 | Scoutmaster / Parent |
| Matthew Bramwell | 6679374 | 131200254 | Scout (inactive?) |
| Benjamin Bramwell | 8539237 | 14892085 | Scout, Troop 2024 |
| William Bramwell | 12352438 | 141634365 | Scout, Troop 2024 |

**Full roster: 27 youth, 37 adults (64 total).** See `data/responses/POST_advancements_events.json` for complete invitedUsers lists.

---

## Rate Limiting

No documented rate limits, but be conservative — these are BSA production servers. Recommended: ≤1 request/second with caching of reference data.

## Scoutbook Plus Import Format

Pipe-delimited text file for importing completed advancements:
```
Unit|BSA Member ID|First Name|Middle Name|Last Name|Advancement Type|Advancement|Version|Date Completed|Approved|Awarded
```

**Constraints:**
- Max 500 records per file
- Only completed advancements (not partials)
- BSA Member ID + Last Name must match official records
- Full spec is proprietary (shared with authorized vendors only)

## Saved Response Data

All API response bodies are saved in `scouting-org-research/data/responses/` as individual JSON files for offline analysis.
