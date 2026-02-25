import type { ScoutbookApiClient } from "./api-client.js";
import type {
  YouthMember,
  AdultMember,
  ParentEntry,
  RankProgress,
  MeritBadgeProgress,
  AwardProgress,
  ScoutbookScoutDoc,
  ScoutbookAdultDoc,
  ScoutbookParentDoc,
  ScoutbookAdvancementDoc,
  ScoutbookRequirementDoc,
  ScoutbookEventDoc,
  ScoutbookCalendarDoc,
  ScoutbookDashboardDoc,
  ScoutbookSyncLogDoc,
} from "./types.js";
import {
  scoutbookScouts,
  scoutbookAdults,
  scoutbookParents,
  scoutbookAdvancement,
  scoutbookRequirements,
  scoutbookEvents,
  scoutbookCalendars,
  scoutbookDashboards,
  scoutbookSyncLog,
} from "./collections.js";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface SyncRosterResult {
  scouts: number;
  adults: number;
  parents: number;
  durationMs: number;
}

export interface SyncScoutResult {
  userId: string;
  ranks: number;
  meritBadges: number;
  awards: number;
  requirements: number;
  durationMs: number;
}

export interface SyncEventsResult {
  events: number;
  durationMs: number;
}

export interface SyncDashboardsResult {
  advancement: boolean;
  activities: boolean;
  durationMs: number;
}

export interface SyncCalendarsResult {
  calendars: number;
  durationMs: number;
}

export interface SyncAllResult {
  roster: SyncRosterResult;
  scoutResults: { userId: string; success: boolean; error?: string }[];
  events: SyncEventsResult | null;
  dashboards: SyncDashboardsResult | null;
  calendars: SyncCalendarsResult | null;
  totalDurationMs: number;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function mapYouthToDoc(
  member: YouthMember,
  orgGuid: string,
  unitNumber: string,
): Omit<ScoutbookScoutDoc, "_id"> {
  // Find patrol from positions
  const patrolPosition = member.positions.find((p) => p.patrolId != null);
  const patrol =
    patrolPosition?.patrolId != null && patrolPosition.patrolName
      ? { id: patrolPosition.patrolId, name: patrolPosition.patrolName }
      : undefined;

  // Highest rank from the Boy Scouts program (unitTypeId 2 = Scouts BSA)
  const bsaRanks = member.highestRanksAwarded.filter(
    (r) => r.unitType === "Troop" || r.program === "Scouts BSA",
  );
  const highestRank = bsaRanks.sort((a, b) => b.level - a.level)[0];
  const currentRank = highestRank
    ? { id: highestRank.id, name: highestRank.rank, dateEarned: highestRank.dateEarned }
    : undefined;

  return {
    userId: String(member.userId),
    memberId: String(member.memberId),
    personGuid: member.personGuid,
    firstName: member.firstName,
    lastName: member.lastName,
    nickName: member.nickName ?? undefined,
    dob: member.dateOfBirth,
    age: member.age,
    gender: member.gender,
    grade: member.grade ?? undefined,
    email: member.email ?? undefined,
    phone: member.mobilePhone ?? member.homePhone ?? undefined,
    address: {
      line1: member.address1,
      city: member.city,
      state: member.state,
      zip: member.zip,
    },
    orgGuid,
    unitNumber,
    patrol,
    currentRank,
    positions: member.positions.map((p) => ({
      name: p.position,
      patrolId: p.patrolId ?? undefined,
    })),
    dateJoined: member.dateJoinedBoyScouts ?? undefined,
    syncedAt: new Date(),
  };
}

function mapAdultToDoc(
  member: AdultMember,
  orgGuid: string,
  unitNumber: string,
): Omit<ScoutbookAdultDoc, "_id"> {
  return {
    userId: String(member.userId),
    memberId: String(member.memberId),
    personGuid: member.personGuid,
    firstName: member.firstName,
    lastName: member.lastName,
    email: member.email ?? undefined,
    phone: member.mobilePhone ?? member.homePhone ?? undefined,
    orgGuid,
    unitNumber,
    positions: member.positions.map((p) => ({
      name: p.position,
      code: String(p.positionId),
    })),
    syncedAt: new Date(),
  };
}

function aggregateParents(
  entries: ParentEntry[],
): Omit<ScoutbookParentDoc, "_id">[] {
  const byParent = new Map<number, { info: ParentEntry["parentInformation"]; youthIds: Set<string> }>();

  for (const entry of entries) {
    const existing = byParent.get(entry.parentUserId);
    if (existing) {
      existing.youthIds.add(String(entry.youthUserId));
    } else {
      byParent.set(entry.parentUserId, {
        info: entry.parentInformation,
        youthIds: new Set([String(entry.youthUserId)]),
      });
    }
  }

  const docs: Omit<ScoutbookParentDoc, "_id">[] = [];
  for (const [parentUserId, { info, youthIds }] of byParent) {
    docs.push({
      userId: String(parentUserId),
      memberId: String(info.memberId),
      personGuid: info.personGuid,
      firstName: info.firstName,
      lastName: info.lastName,
      email: info.email ?? undefined,
      phone: info.mobilePhone ?? info.homePhone ?? undefined,
      linkedYouthUserIds: [...youthIds],
      syncedAt: new Date(),
    });
  }
  return docs;
}

// ---------------------------------------------------------------------------
// syncRoster
// ---------------------------------------------------------------------------

export async function syncRoster(client: ScoutbookApiClient): Promise<SyncRosterResult> {
  const start = Date.now();
  const log = await scoutbookSyncLog();

  try {
    // Fetch all three rosters — youth and adults in parallel, parents from
    // the full parent roster endpoint (we call getParents with a dummy filter
    // that returns all, but the API client filters. Use get() directly).
    const [youth, adults, allParents] = await Promise.all([
      client.getYouthRoster(),
      client.getAdultRoster(),
      client.get<ParentEntry[]>(
        `/organizations/v2/units/${client.orgGuid}/parents`,
      ),
    ]);

    const scoutsCol = await scoutbookScouts();
    const adultsCol = await scoutbookAdults();
    const parentsCol = await scoutbookParents();

    // Derive unit number from the roster response metadata if available,
    // but youth/adult endpoints return just users. Use orgGuid as fallback.
    const unitNumber = client.unitId;

    // Upsert youth
    for (const member of youth) {
      const doc = mapYouthToDoc(member, client.orgGuid, unitNumber);
      await scoutsCol.updateOne(
        { userId: doc.userId },
        { $set: doc },
        { upsert: true },
      );
    }

    // Upsert adults
    for (const member of adults) {
      const doc = mapAdultToDoc(member, client.orgGuid, unitNumber);
      await adultsCol.updateOne(
        { userId: doc.userId },
        { $set: doc },
        { upsert: true },
      );
    }

    // Aggregate and upsert parents
    const parentDocs = aggregateParents(allParents);
    for (const doc of parentDocs) {
      await parentsCol.updateOne(
        { userId: doc.userId },
        { $set: doc },
        { upsert: true },
      );
    }

    const durationMs = Date.now() - start;
    const result: SyncRosterResult = {
      scouts: youth.length,
      adults: adults.length,
      parents: parentDocs.length,
      durationMs,
    };

    // Write sync log
    const logEntry: Omit<ScoutbookSyncLogDoc, "_id"> = {
      timestamp: new Date(),
      operation: "roster",
      orgGuid: client.orgGuid,
      result: "success",
      counts: {
        scouts: result.scouts,
        adults: result.adults,
        parents: result.parents,
      },
      durationMs,
    };
    await log.insertOne(logEntry as ScoutbookSyncLogDoc);

    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    const logEntry: Omit<ScoutbookSyncLogDoc, "_id"> = {
      timestamp: new Date(),
      operation: "roster",
      orgGuid: client.orgGuid,
      result: "error",
      error: err instanceof Error ? err.message : String(err),
      durationMs,
    };
    await log.insertOne(logEntry as ScoutbookSyncLogDoc).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------
// syncScout
// ---------------------------------------------------------------------------

export async function syncScout(
  client: ScoutbookApiClient,
  userId: string,
): Promise<SyncScoutResult> {
  const start = Date.now();
  const log = await scoutbookSyncLog();

  try {
    // Fetch ranks, merit badges, awards in parallel
    const [ranksResponse, meritBadges, awards] = await Promise.all([
      client.getRanks(userId),
      client.getMeritBadges(userId),
      client.getAwards(userId),
    ]);

    // Flatten ranks from all programs
    const allRanks: RankProgress[] = ranksResponse.program.flatMap((p) => p.ranks);

    const advCol = await scoutbookAdvancement();
    const reqCol = await scoutbookRequirements();

    let advancementCount = 0;
    let requirementCount = 0;

    // Upsert rank advancements
    for (const rank of allRanks) {
      const doc: Omit<ScoutbookAdvancementDoc, "_id"> = {
        userId,
        type: "rank",
        advancementId: rank.id,
        name: rank.name,
        versionId: rank.versionId,
        status: rank.status,
        percentCompleted: rank.percentCompleted,
        dateStarted: rank.dateEarned || undefined,
        dateCompleted: rank.markedCompletedDate ?? undefined,
        dateAwarded: rank.awardedDate ?? undefined,
        syncedAt: new Date(),
      };
      await advCol.updateOne(
        { userId, type: "rank", advancementId: rank.id },
        { $set: doc },
        { upsert: true },
      );
      advancementCount++;

      // Fetch requirements for started/in-progress/awarded ranks
      if (rank.percentCompleted > 0 || rank.status === "Started" || rank.awarded) {
        try {
          const reqResponse = await client.getRankRequirements(userId, String(rank.id));
          for (const req of reqResponse.requirements) {
            const reqDoc: Omit<ScoutbookRequirementDoc, "_id"> = {
              userId,
              advancementType: "rank",
              advancementId: rank.id,
              reqId: req.id,
              reqNumber: req.requirementNumber || req.listNumber,
              reqName: req.name,
              parentReqId: req.parentRequirementId,
              completed: req.completed,
              started: req.started,
              dateCompleted: req.dateCompleted || undefined,
              dateStarted: req.dateStarted || undefined,
              leaderApprovedDate: req.leaderApprovedDate || undefined,
              percentCompleted: req.percentCompleted,
              syncedAt: new Date(),
            };
            await reqCol.updateOne(
              { userId, advancementType: "rank", advancementId: rank.id, reqId: req.id },
              { $set: reqDoc },
              { upsert: true },
            );
            requirementCount++;
          }
        } catch (err) {
          // Log but don't fail the whole scout sync for one requirement fetch
          console.error(
            `Failed to fetch rank requirements for user=${userId} rank=${rank.id}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    }

    // Upsert merit badge advancements
    for (const mb of meritBadges) {
      const doc: Omit<ScoutbookAdvancementDoc, "_id"> = {
        userId,
        type: "meritBadge",
        advancementId: mb.id,
        name: mb.name,
        versionId: Number(mb.versionId) || undefined,
        status: mb.status,
        percentCompleted: mb.percentCompleted,
        dateStarted: mb.dateStarted || undefined,
        dateCompleted: mb.dateCompleted || undefined,
        dateAwarded: mb.awardedDate || undefined,
        counselorUserId: mb.assignedCounselorUserId
          ? String(mb.assignedCounselorUserId)
          : undefined,
        syncedAt: new Date(),
      };
      await advCol.updateOne(
        { userId, type: "meritBadge", advancementId: mb.id },
        { $set: doc },
        { upsert: true },
      );
      advancementCount++;

      // Fetch requirements for started/in-progress merit badges
      if (mb.percentCompleted > 0 || mb.status === "Started") {
        try {
          const reqResponse = await client.getMBRequirements(userId, String(mb.id));
          for (const req of reqResponse.requirements) {
            const reqDoc: Omit<ScoutbookRequirementDoc, "_id"> = {
              userId,
              advancementType: "meritBadge",
              advancementId: mb.id,
              reqId: Number(req.id),
              reqNumber: req.number || req.listNumber,
              reqName: req.name,
              parentReqId: req.parentRequirementId ? Number(req.parentRequirementId) : null,
              completed: req.completed === "True" || req.completed === "true",
              started: req.started === "True" || req.started === "true",
              dateCompleted: req.dateCompleted || undefined,
              dateStarted: undefined, // MB requirements don't have dateStarted
              leaderApprovedDate: req.leaderApprovedDate || undefined,
              percentCompleted: Number(req.percentCompleted) || 0,
              syncedAt: new Date(),
            };
            await reqCol.updateOne(
              {
                userId,
                advancementType: "meritBadge",
                advancementId: mb.id,
                reqId: Number(req.id),
              },
              { $set: reqDoc },
              { upsert: true },
            );
            requirementCount++;
          }
        } catch (err) {
          console.error(
            `Failed to fetch MB requirements for user=${userId} mb=${mb.id}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    }

    // Upsert award advancements
    for (const award of awards) {
      const doc: Omit<ScoutbookAdvancementDoc, "_id"> = {
        userId,
        type: "award",
        advancementId: award.awardId,
        name: award.name,
        versionId: award.awardVersionId,
        status: award.status,
        percentCompleted: award.percentCompleted,
        dateCompleted: award.dateEarned || undefined,
        dateAwarded: award.awardedDate || undefined,
        syncedAt: new Date(),
      };
      await advCol.updateOne(
        { userId, type: "award", advancementId: award.awardId },
        { $set: doc },
        { upsert: true },
      );
      advancementCount++;
    }

    // Fetch and update activity summary on the scout doc
    try {
      const activity = await client.getActivitySummary(userId);
      const scoutsCol = await scoutbookScouts();
      await scoutsCol.updateOne(
        { userId },
        {
          $set: {
            activitySummary: {
              campingDays: activity.campingLogs.totalNumberOfDays,
              campingNights: activity.campingLogs.totalNumberOfNights,
              hikingMiles: activity.hikingLogs.totalNumberOfMiles,
              serviceHours: activity.serviceLogs.totalNumberOfHours,
            },
            lastSyncedAt: new Date(),
          },
        },
      );
    } catch (err) {
      console.error(
        `Failed to fetch activity summary for user=${userId}: ${err instanceof Error ? err.message : err}`,
      );
    }

    const durationMs = Date.now() - start;
    const result: SyncScoutResult = {
      userId,
      ranks: allRanks.length,
      meritBadges: meritBadges.length,
      awards: awards.length,
      requirements: requirementCount,
      durationMs,
    };

    // Write sync log
    const logEntry: Omit<ScoutbookSyncLogDoc, "_id"> = {
      timestamp: new Date(),
      operation: "scout",
      userId,
      result: "success",
      counts: {
        advancements: advancementCount,
        requirements: requirementCount,
      },
      durationMs,
    };
    await log.insertOne(logEntry as ScoutbookSyncLogDoc);

    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    const logEntry: Omit<ScoutbookSyncLogDoc, "_id"> = {
      timestamp: new Date(),
      operation: "scout",
      userId,
      result: "error",
      error: err instanceof Error ? err.message : String(err),
      durationMs,
    };
    await log.insertOne(logEntry as ScoutbookSyncLogDoc).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------
// syncEvents
// ---------------------------------------------------------------------------

export async function syncEvents(
  client: ScoutbookApiClient,
  daysAhead: number = 90,
): Promise<SyncEventsResult> {
  const start = Date.now();
  const log = await scoutbookSyncLog();

  try {
    const now = new Date();
    const startDate = now.toISOString().split("T")[0]!;
    const endDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0]!;

    const events = await client.getEvents(startDate, endDate);

    const eventsCol = await scoutbookEvents();
    for (const event of events) {
      const doc: Omit<ScoutbookEventDoc, "_id"> = {
        eventId: event.id,
        unitId: Number(client.unitId),
        name: event.name,
        eventType: event.eventType,
        startDate: event.startDate,
        endDate: event.endDate,
        location: event.location || undefined,
        description: event.description || undefined,
        notes: event.notes || undefined,
        rsvpEnabled: event.rsvp,
        createdBy: {
          userId: event.userId,
          firstName: event.firstName,
          lastName: event.lastName,
        },
        dateCreated: event.dateCreated,
        isActivityMeeting: event.isActivityMeeting,
        activityType: event.activityType || undefined,
        serviceProject: event.serviceProject,
        outdoorActivity: event.outdoorActivity,
        invitedUsers: event.invitedUsers.map((u) => ({
          userId: u.userId,
          firstName: u.firstName,
          lastName: u.lastName,
          isAdult: u.isAdult,
          rsvp: u.rsvp,
          rsvpCode: u.rsvpCode,
          attended: u.attended,
          primaryLeader: u.primaryLeader,
        })),
        units: event.units.map((u) => ({
          unitId: u.unitId,
          unitFullName: u.unitFullName,
          patrolId: u.patrolId ?? undefined,
          patrolName: u.patrolName || undefined,
        })),
        syncedAt: new Date(),
      };
      await eventsCol.updateOne(
        { eventId: event.id },
        { $set: doc },
        { upsert: true },
      );
    }

    const durationMs = Date.now() - start;
    const result: SyncEventsResult = {
      events: events.length,
      durationMs,
    };

    const logEntry: Omit<ScoutbookSyncLogDoc, "_id"> = {
      timestamp: new Date(),
      operation: "events",
      result: "success",
      counts: { events: events.length },
      durationMs,
    };
    await log.insertOne(logEntry as ScoutbookSyncLogDoc);

    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    const logEntry: Omit<ScoutbookSyncLogDoc, "_id"> = {
      timestamp: new Date(),
      operation: "events",
      result: "error",
      error: err instanceof Error ? err.message : String(err),
      durationMs,
    };
    await log.insertOne(logEntry as ScoutbookSyncLogDoc).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------
// syncDashboards
// ---------------------------------------------------------------------------

export async function syncDashboards(
  client: ScoutbookApiClient,
): Promise<SyncDashboardsResult> {
  const start = Date.now();
  const log = await scoutbookSyncLog();

  try {
    const [advDashboard, actDashboard] = await Promise.all([
      client.getAdvancementDashboard(),
      client.getUnitActivitiesDashboard(),
    ]);

    const col = await scoutbookDashboards();

    // Upsert advancement dashboard
    const advDoc: Omit<ScoutbookDashboardDoc, "_id"> = {
      orgGuid: client.orgGuid,
      type: "advancement",
      data: advDashboard as unknown as Record<string, unknown>,
      syncedAt: new Date(),
    };
    await col.updateOne(
      { orgGuid: client.orgGuid, type: "advancement" },
      { $set: advDoc },
      { upsert: true },
    );

    // Upsert activities dashboard
    const actDoc: Omit<ScoutbookDashboardDoc, "_id"> = {
      orgGuid: client.orgGuid,
      type: "activities",
      data: actDashboard as unknown as Record<string, unknown>,
      syncedAt: new Date(),
    };
    await col.updateOne(
      { orgGuid: client.orgGuid, type: "activities" },
      { $set: actDoc },
      { upsert: true },
    );

    const durationMs = Date.now() - start;
    const result: SyncDashboardsResult = {
      advancement: true,
      activities: true,
      durationMs,
    };

    const logEntry: Omit<ScoutbookSyncLogDoc, "_id"> = {
      timestamp: new Date(),
      operation: "dashboards",
      orgGuid: client.orgGuid,
      result: "success",
      durationMs,
    };
    await log.insertOne(logEntry as ScoutbookSyncLogDoc);

    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    const logEntry: Omit<ScoutbookSyncLogDoc, "_id"> = {
      timestamp: new Date(),
      operation: "dashboards",
      orgGuid: client.orgGuid,
      result: "error",
      error: err instanceof Error ? err.message : String(err),
      durationMs,
    };
    await log.insertOne(logEntry as ScoutbookSyncLogDoc).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------
// syncCalendars
// ---------------------------------------------------------------------------

export async function syncCalendars(
  client: ScoutbookApiClient,
  userId: string,
): Promise<SyncCalendarsResult> {
  const start = Date.now();
  const log = await scoutbookSyncLog();

  try {
    const subscriptions = await client.getCalendarSubscriptions(userId);

    const col = await scoutbookCalendars();
    for (const sub of subscriptions) {
      const doc: Omit<ScoutbookCalendarDoc, "_id"> = {
        userCalendarId: sub.userCalendarId,
        userId: sub.userId,
        unitId: sub.unitId,
        patrolId: sub.patrolId ?? undefined,
        calendarCode: sub.calendarCode,
        color: sub.color,
        showCalendar: sub.showCalendar,
        syncedAt: new Date(),
      };
      await col.updateOne(
        { userCalendarId: sub.userCalendarId },
        { $set: doc },
        { upsert: true },
      );
    }

    const durationMs = Date.now() - start;
    const result: SyncCalendarsResult = {
      calendars: subscriptions.length,
      durationMs,
    };

    const logEntry: Omit<ScoutbookSyncLogDoc, "_id"> = {
      timestamp: new Date(),
      operation: "calendars",
      userId,
      result: "success",
      counts: { events: subscriptions.length },
      durationMs,
    };
    await log.insertOne(logEntry as ScoutbookSyncLogDoc);

    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    const logEntry: Omit<ScoutbookSyncLogDoc, "_id"> = {
      timestamp: new Date(),
      operation: "calendars",
      userId,
      result: "error",
      error: err instanceof Error ? err.message : String(err),
      durationMs,
    };
    await log.insertOne(logEntry as ScoutbookSyncLogDoc).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------
// syncAll
// ---------------------------------------------------------------------------

export async function syncAll(client: ScoutbookApiClient): Promise<SyncAllResult> {
  const totalStart = Date.now();
  const log = await scoutbookSyncLog();

  // Step 1: Sync roster
  const roster = await syncRoster(client);

  // Step 2: Sync each scout individually, continuing on failures
  const scoutsCol = await scoutbookScouts();
  const allScouts = await scoutsCol.find({}, { projection: { userId: 1 } }).toArray();
  const scoutResults: SyncAllResult["scoutResults"] = [];

  for (const scout of allScouts) {
    try {
      await syncScout(client, scout.userId);
      scoutResults.push({ userId: scout.userId, success: true });
    } catch (err) {
      console.error(
        `syncAll: failed to sync scout ${scout.userId}: ${err instanceof Error ? err.message : err}`,
      );
      scoutResults.push({
        userId: scout.userId,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Step 3: Sync events for next 90 days
  let eventsResult: SyncEventsResult | null = null;
  try {
    eventsResult = await syncEvents(client);
  } catch (err) {
    console.error(
      `syncAll: failed to sync events: ${err instanceof Error ? err.message : err}`,
    );
  }

  // Step 4: Sync dashboards
  let dashboardsResult: SyncDashboardsResult | null = null;
  try {
    dashboardsResult = await syncDashboards(client);
  } catch (err) {
    console.error(
      `syncAll: failed to sync dashboards: ${err instanceof Error ? err.message : err}`,
    );
  }

  // Step 5: Sync calendars for all adults (they own calendar subscriptions)
  let calendarsResult: SyncCalendarsResult | null = null;
  try {
    const adultsCol = await scoutbookAdults();
    const allAdults = await adultsCol.find({}, { projection: { userId: 1 } }).toArray();
    let totalCalendars = 0;
    const calStart = Date.now();
    for (const adult of allAdults) {
      try {
        const r = await syncCalendars(client, adult.userId);
        totalCalendars += r.calendars;
      } catch {
        // Individual calendar sync failures are non-fatal
      }
    }
    calendarsResult = { calendars: totalCalendars, durationMs: Date.now() - calStart };
  } catch (err) {
    console.error(
      `syncAll: failed to sync calendars: ${err instanceof Error ? err.message : err}`,
    );
  }

  const totalDurationMs = Date.now() - totalStart;
  const successCount = scoutResults.filter((r) => r.success).length;
  const failCount = scoutResults.filter((r) => !r.success).length;
  const overallResult = failCount === 0 ? "success" : successCount > 0 ? "partial" : "error";

  // Write overall sync log
  const logEntry: Omit<ScoutbookSyncLogDoc, "_id"> = {
    timestamp: new Date(),
    operation: "all",
    orgGuid: client.orgGuid,
    result: overallResult,
    counts: {
      scouts: roster.scouts,
      adults: roster.adults,
      parents: roster.parents,
      advancements: scoutResults.filter((r) => r.success).length,
      events: eventsResult?.events,
    },
    error: failCount > 0 ? `${failCount} scout(s) failed to sync` : undefined,
    durationMs: totalDurationMs,
  };
  await log.insertOne(logEntry as ScoutbookSyncLogDoc).catch(() => {});

  return {
    roster,
    scoutResults,
    events: eventsResult,
    dashboards: dashboardsResult,
    calendars: calendarsResult,
    totalDurationMs,
  };
}
