import { MongoClient, Db, Collection } from "mongodb";
import type {
  UserDocument, ScoutDocument, RequirementDocument,
  ChoreLogEntry, BudgetEntry, TimeMgmtDocument,
  LoanAnalysisDocument, EmailRecord, ReminderDocument,
  SetupStatusDocument, QuestPlanDocument, SessionNoteDocument,
  CronLogEntry, PlanChangeLogEntry
} from "./types.js";

// ---------------------------------------------------------------------------
// Two database connections:
//   getDb()          → LibreChat database (conversations, users, messages)
//   getScoutQuestDb() → scoutquest database (all scout/scoutbook/quest data)
//
// LibreChat sets MONGO_URI to its own database. Scout quest data lives in a
// separate database on the same MongoDB instance for clean separation.
// ---------------------------------------------------------------------------

let librechatDb: Db | null = null;
let scoutquestDb: Db | null = null;
let sharedClient: MongoClient | null = null;

async function getClient(): Promise<MongoClient> {
  if (sharedClient) return sharedClient;
  const uri = process.env.MONGO_URI || "mongodb://mongodb:27017/LibreChat";
  sharedClient = new MongoClient(uri);
  await sharedClient.connect();
  return sharedClient;
}

/** LibreChat database — for LibreChat-internal collections only. */
export async function getDb(): Promise<Db> {
  if (librechatDb) return librechatDb;
  const client = await getClient();
  librechatDb = client.db(); // uses database from MONGO_URI
  return librechatDb;
}

/** Scout Quest database — for all scout, scoutbook, quest, and knowledge data. */
export async function getScoutQuestDb(): Promise<Db> {
  if (scoutquestDb) return scoutquestDb;
  const client = await getClient();
  const dbName = process.env.SCOUTQUEST_DB || "scoutquest";
  scoutquestDb = client.db(dbName);
  return scoutquestDb;
}

// ---------------------------------------------------------------------------
// Quest collections — these are scout quest system data, NOT LibreChat data.
// All use getScoutQuestDb() for clean separation.
// ---------------------------------------------------------------------------

export async function users(): Promise<Collection<UserDocument>> {
  return (await getScoutQuestDb()).collection("users");
}
export async function scouts(): Promise<Collection<ScoutDocument>> {
  return (await getScoutQuestDb()).collection("scouts");
}
export async function requirements(): Promise<Collection<RequirementDocument>> {
  return (await getScoutQuestDb()).collection("requirements");
}
export async function choreLogs(): Promise<Collection<ChoreLogEntry>> {
  return (await getScoutQuestDb()).collection("chore_logs");
}
export async function budgetEntries(): Promise<Collection<BudgetEntry>> {
  return (await getScoutQuestDb()).collection("budget_entries");
}
export async function timeMgmt(): Promise<Collection<TimeMgmtDocument>> {
  return (await getScoutQuestDb()).collection("time_mgmt");
}
export async function loanAnalysis(): Promise<Collection<LoanAnalysisDocument>> {
  return (await getScoutQuestDb()).collection("loan_analysis");
}
export async function emailsSent(): Promise<Collection<EmailRecord>> {
  return (await getScoutQuestDb()).collection("emails_sent");
}
export async function reminders(): Promise<Collection<ReminderDocument>> {
  return (await getScoutQuestDb()).collection("reminders");
}
export async function setupStatus(): Promise<Collection<SetupStatusDocument>> {
  return (await getScoutQuestDb()).collection("setup_status");
}
export async function questPlans(): Promise<Collection<QuestPlanDocument>> {
  return (await getScoutQuestDb()).collection("quest_plans");
}
export async function sessionNotes(): Promise<Collection<SessionNoteDocument>> {
  return (await getScoutQuestDb()).collection("session_notes");
}
export async function cronLog(): Promise<Collection<CronLogEntry>> {
  return (await getScoutQuestDb()).collection("cron_log");
}
export async function planChangelog(): Promise<Collection<PlanChangeLogEntry>> {
  return (await getScoutQuestDb()).collection("plan_changelog");
}
