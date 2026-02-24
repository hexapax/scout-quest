import type { Collection } from "mongodb";
import { getDb } from "../db.js";
import type {
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

export async function scoutbookScouts(): Promise<Collection<ScoutbookScoutDoc>> {
  return (await getDb()).collection("scoutbook_scouts");
}

export async function scoutbookAdults(): Promise<Collection<ScoutbookAdultDoc>> {
  return (await getDb()).collection("scoutbook_adults");
}

export async function scoutbookParents(): Promise<Collection<ScoutbookParentDoc>> {
  return (await getDb()).collection("scoutbook_parents");
}

export async function scoutbookAdvancement(): Promise<Collection<ScoutbookAdvancementDoc>> {
  return (await getDb()).collection("scoutbook_advancement");
}

export async function scoutbookRequirements(): Promise<Collection<ScoutbookRequirementDoc>> {
  return (await getDb()).collection("scoutbook_requirements");
}

export async function scoutbookEvents(): Promise<Collection<ScoutbookEventDoc>> {
  return (await getDb()).collection("scoutbook_events");
}

export async function scoutbookCalendars(): Promise<Collection<ScoutbookCalendarDoc>> {
  return (await getDb()).collection("scoutbook_calendars");
}

export async function scoutbookDashboards(): Promise<Collection<ScoutbookDashboardDoc>> {
  return (await getDb()).collection("scoutbook_dashboards");
}

export async function scoutbookSyncLog(): Promise<Collection<ScoutbookSyncLogDoc>> {
  return (await getDb()).collection("scoutbook_sync_log");
}
