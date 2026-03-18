# BSA Scoutbook API Reference

**Last updated:** 2026-03-18
**Source:** Captured via Chrome CDP network interception against `advancements.scouting.org`

## Authentication

All endpoints use a JWT bearer token extracted from BSA session cookies.

```
Authorization: bearer eyJ...
Content-Type: application/json
Origin: https://advancements.scouting.org
Referer: https://advancements.scouting.org/
```

**Token source:** Cookie named `token` on `api.scouting.org` / `advancements.scouting.org` / `my.scouting.org`. Starts with `eyJ` (base64 JWT). Expires ~30-60 minutes after login.

**Auth flow:** Automated auth (`POST my.scouting.org/api/users/{username}/authenticate`) returns 503 since ~March 2026. Current workaround: manual Chrome login + CDP cookie extraction. See `docs/scoutbook-data-refresh.md`.

## Base URL

```
https://api.scouting.org
```

## Constants (Troop 2024)

| Constant | Value |
|----------|-------|
| `ORG_GUID` | `E1D07881-103D-43D8-92C4-63DEFDC05D48` |
| `UNIT_ID` | `121894` |
| `USER_ID` (Jeremy) | `9120709` |
| `MEMBER_ID` (Jeremy) | `131200255` |

---

## Read Endpoints

### Roster

| Endpoint | Description |
|----------|-------------|
| `GET /organizations/v2/units/{orgGuid}/youths` | Youth roster with contact info, ranks, positions |
| `GET /organizations/v2/units/{orgGuid}/adults` | Adult leaders with positions |
| `GET /organizations/v2/units/{orgGuid}/parents` | Parents linked to youth members |
| `GET /organizations/v2/units/{orgGuid}/subUnits` | Patrols |

### Advancement

| Endpoint | Description |
|----------|-------------|
| `GET /advancements/v2/youth/{userId}/ranks` | All rank progress for a scout |
| `GET /advancements/v2/youth/{userId}/meritBadges` | All merit badge progress |
| `GET /advancements/v2/youth/{userId}/awards` | All awards progress |
| `GET /advancements/v2/youth/{userId}/ranks/{rankId}/requirements` | Per-requirement completion for a rank |
| `GET /advancements/v2/{userId}/userActivitySummary` | Camping/hiking/service totals |

### Reference Data

| Endpoint | Description |
|----------|-------------|
| `GET /advancements/ranks` | All rank definitions |
| `GET /advancements/meritBadges` | All merit badge definitions |
| `GET /advancements/awards` | All award definitions |
| `GET /advancements/v2/ranks/{rankId}/requirements?versionId={vid}` | Requirement text for a rank version |

### Organization

| Endpoint | Description |
|----------|-------------|
| `GET /organizations/v2/{orgGuid}/advancementDashboard` | Troop advancement summary |
| `GET /organizations/v2/{orgGuid}/unitActivitiesDashboard` | Activity totals |
| `GET /organizations/v2/{orgGuid}/profile` | Troop profile |
| `GET /organizations/positions/{orgGuid}` | Position assignments |

### Person

| Endpoint | Description |
|----------|-------------|
| `GET /persons/v2/{userId}/personprofile` | Full person profile |
| `GET /persons/v2/{personGuid}/relationships` | Parent/guardian relationships |
| `GET /persons/v2/{personGuid}/trainings/ypt` | YPT training status |
| `GET /persons/{personGuid}/subscriptions` | Notification subscriptions |
| `GET /advancements/youth/{userId}/leadershipPositionHistory?summary=true` | Leadership position history |

### Calendar/Events

| Endpoint | Method | Description |
|----------|--------|-------------|
| `POST /advancements/events` | POST (read) | List events in date range |

```json
// Request
{ "unitId": 121894, "fromDate": "2026-01-01", "toDate": "2026-02-01", "showDLEvents": true }

// Response: array of event objects with id, name, startDate, endDate, invitees, etc.
```

### Activities

| Endpoint | Method | Description |
|----------|--------|-------------|
| `POST /advancements/v2/activities` | POST (read) | List activities in date range |

```json
// Request
{
  "hostOrganizationGuid": "E1D07881-103D-43D8-92C4-63DEFDC05D48",
  "startDate": "2026-01-01", "endDate": "2026-02-01",
  "includeActivities": "both"  // "both", "unit"
}
```

### Comments

| Endpoint | Method | Description |
|----------|--------|-------------|
| `POST /advancements/v2/users/{scoutUserId}/comments` | POST (read) | Get comments for an advancement |

```json
// Request
{ "advancementId": 2, "advancementType": "ranks", "versionId": 83 }
```

---

## Write Endpoints

### 1. Mark Requirement Complete/Approved

```
POST /advancements/v2/youth/ranks/{rankId}/requirements
```

Batch endpoint — can update multiple scouts × multiple requirements in one call.

```json
// Request
[{
  "userId": 14195293,
  "organizationGuid": "E1D07881-103D-43D8-92C4-63DEFDC05D48",
  "requirements": [{
    "id": 1981,
    "completed": true,
    "started": true,
    "approved": true,
    "dateCompleted": "2026-03-17",
    "dateStarted": "2026-03-17",
    "markedCompletedDate": "2026-03-18",
    "leaderApprovedDate": "2026-03-18",
    "leaderApprovedUserId": 9120709
  }]
}]

// Response 200
[{
  "userId": 14195293,
  "rankId": 2,
  "percentCompleted": 0.63,
  "status": "Started",
  "requirements": [{
    "id": 1981,
    "percentCompleted": 0.63,
    "advancementStatus": "Started",
    "status": "Success",
    "message": "Advancement requirement updated successfully."
  }]
}]
```

**Fields:**
- `id` — requirement ID from rank requirements definition
- `completed`, `started`, `approved` — boolean flags
- `dateCompleted`, `dateStarted` — when the scout did the work (YYYY-MM-DD)
- `markedCompletedDate`, `leaderApprovedDate` — when recorded in system (YYYY-MM-DD)
- `leaderApprovedUserId` — userId of the approving leader

### 2. Add Comment

```
POST /advancements/v2/users/{leaderUserId}/comments/add
```

```json
// Request
{
  "advancementId": 2,
  "advancementType": "ranks",
  "body": "completed during the troop meeting",
  "scoutUserId": 14195293,
  "subject": "subject-post",
  "userId": 9120709,
  "versionId": 83,
  "requirementId": 1981
}

// Response 200
{ "message": "User comment created successfully.", "id": 94139894 }
```

**Fields:**
- `advancementId` — rank/MB/award ID
- `advancementType` — `"ranks"`, `"meritBadges"`, `"awards"`
- `requirementId` — specific requirement the comment is about
- `versionId` — version of the rank/MB definition
- `userId` — the commenter's userId (leader)
- `scoutUserId` — the scout the comment is about

### 3. RSVP to Event

```
PUT /advancements/v2/events/{eventId}/invitees
```

```json
// Request
{ "users": [{ "userId": 8539237, "rsvpCode": "Y" }] }

// Response 200
[{ "userId": 8539237, "message": "Successfully updated" }]
```

**RSVP codes:** `"Y"` (yes), `"M"` (maybe), `"N"` (no)

Batch endpoint — can update multiple users' RSVPs in one call.

### 4. Create Event

Two-step process: create event, then add invitees.

**Step 1: Create**
```
POST /advancements/events/add
```

```json
// Request
{
  "userId": 9120709,
  "unitId": 121894,
  "name": "Lake Burton Campout & Eagle Project Support",
  "startDate": "2026-04-17T20:30:00Z",
  "endDate": "2026-04-18T15:00:00Z",
  "description": "<p>HTML description with <strong>formatting</strong></p>",
  "eventType": "Other",
  "eventTypeTag": ["outdoorActivity"],
  "rsvp": true,
  "allDay": false,
  "slipsRequired": false,
  "recurrence": false,
  "areRemindersDisabled": true,
  "sendToRSVPYes": false,
  "sendToRSVPYesNMaybe": true,
  "outdoorActivity": true,
  "demographicLookupShort": "NA",
  "temp": false
}

// Response 200
{ "message": "Advancement Event created successfully.", "eventId": 6903133 }
```

**Step 2: Add Invitees**
```
POST /advancements/v2/events/{eventId}/invitees
```

```json
// Request — array of all roster members
[
  { "attended": false, "primaryLeader": false, "userId": 11833244 },
  { "attended": false, "primaryLeader": false, "userId": 9120709 },
  ...
]

// Response 200
{ "message": "New invitees were added successfully." }
```

### 5. Send Email

```
POST /advancements/v2/{orgGuid}/email
```

```json
// Request
{
  "to": { "memberId": [131200255] },
  "bcc": { "memberId": [] },
  "subject": "test",
  "body": "<div><p>HTML body with <strong>bold</strong></p><ul><li>bullets</li></ul></div>"
}

// Response 200
{ "message": "Email sent." }
```

**Note:** Uses `memberId` (not `userId`) for recipients. Both fields exist on roster records.

### 6. Create Activity (Service Project / Campout)

```
POST /advancements/v2/activities/add
```

```json
// Request
{
  "activityTypeId": 1,
  "categoryId": 47,
  "name": "Will McDaid's Eagle Scout Project",
  "startDateTime": "2026-03-14T15:30:00.000Z",
  "endDateTime": "2026-03-14T20:00:00.000Z",
  "location": "Dunwoody Nature Center",
  "city": "Atlanta",
  "description": "Repairing and improving stairs and preventing erosion.",
  "isPersonalActivity": false,
  "hostOrganizationGuid": "E1D07881-103D-43D8-92C4-63DEFDC05D48",
  "organizationGuid": "E1D07881-103D-43D8-92C4-63DEFDC05D48",
  "isEveryChildOrg": false,
  "registeredAdults": [{
    "userId": 9120709,
    "note": "N/A",
    "organizationGuid": "E1D07881-103D-43D8-92C4-63DEFDC05D48",
    "isApproved": true,
    "leaderApprovedDate": "2026-03-18",
    "leaderApprovedId": 9120709,
    "personGuid": "B7EBE1E7-38E9-4B2D-9D51-32244DA6C037",
    "memberId": 131200255,
    "activityValues": [{ "activityValueTypeId": 1, "activityValue": 1 }]
  }],
  "registeredYouths": [{
    "userId": 3787564,
    "note": "N/A",
    "organizationGuid": "E1D07881-103D-43D8-92C4-63DEFDC05D48",
    "isApproved": true,
    "leaderApprovedDate": "2026-03-18",
    "leaderApprovedId": 9120709,
    "personGuid": "9CC1AA32-2D3A-41F6-AE84-A12C5370BC97",
    "memberId": 133873283,
    "activityValues": [{ "activityValueTypeId": 1, "activityValue": 3 }]
  }],
  "benefitGroup": "{\"SFF\":false,\"SFF_foodLb\":0,\"SFCW\":false,\"SFCW_wasteLb\":0,\"SFCW_plasticLb\":0,\"MOP\":false,\"BUCO\":false}"
}

// Response 200
{
  "message": "New advancement activity added successfully",
  "activityId": 8273743,
  "activityOrganizationId": 2753982,
  "activityAdults": [36004347, 36004348, 36004349, 36004350],
  "activityYouths": [36004351, 36004352, 36004353, 36004354, 36004355, 36004356, 36004357, 36004358]
}
```

**Activity type IDs:** `1` = Service Project (confirmed). Others TBD (likely: 2=Campout, 3=Hike, etc.)

**`activityValues`:** Per-person hours/units. `activityValueTypeId: 1` = service hours, `activityValue` = numeric hours.

### 7. Update Activity

```
PUT /advancements/v2/activities/{activityId}
```

```json
// Request
{
  "organizationTypeId": 6,
  "activityTypeId": 2,
  "categoryId": 8,
  "name": "Campout - Allatoona Aquatics Base",
  "description": "<p>HTML description</p>",
  "startDateTime": "2026-01-16T23:00:00.000Z",
  "endDateTime": "2026-01-17T15:00:00.000Z",
  "location": "Location was not specified",
  "isEveryChildOrg": false,
  "isPersonalActivity": false
}

// Response 200
{ "message": "Advancement activity updated successfully." }
```

### 8. Search Camps

```
POST /organizations/camps/search
```

```json
// Request
{ "zip": "30327", "radiusInMiles": "200" }

// Response: array of camp objects with id, name, address, distance, council info
```

---

## ID Relationships

| Field | Used In | Description |
|-------|---------|-------------|
| `userId` | Most endpoints | Primary identifier for persons (scouts, adults) |
| `memberId` | Email, activities | BSA membership number; used for email recipients |
| `personGuid` | Activities, profile | UUID for the person record |
| `orgGuid` | Most endpoints | UUID for the organization (troop) |
| `unitId` | Events | Numeric troop ID |

**Important:** Email uses `memberId`, not `userId`. Both are available on roster records (`org_units_youths.json`, `org_units_adults.json`).

---

## Error Handling

- **401** — Token expired. Re-authenticate.
- **503** — BSA auth endpoint down (known issue since March 2026).
- **Rate limiting** — No formal limits observed, but 800ms delay between requests is respectful.

## Captured Data Location

- Raw intercept data: `scouting-org-research/data/api-intercept.json` (2.7MB, 85K lines)
- Intercept script: `scripts/scoutbook/intercept-api.mjs`
