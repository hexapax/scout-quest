import { MongoClient, Db, Collection } from "mongodb";
import type {
  UserDocument, ScoutDocument, RequirementDocument,
  ChoreLogEntry, BudgetEntry, TimeMgmtDocument,
  LoanAnalysisDocument, EmailRecord, ReminderDocument,
  SetupStatusDocument, QuestPlanDocument, SessionNoteDocument,
  CronLogEntry, PlanChangeLogEntry
} from "./types.js";

let db: Db | null = null;

export async function getDb(): Promise<Db> {
  if (db) return db;
  const uri = process.env.MONGO_URI || "mongodb://mongodb:27017/scoutquest";
  const client = new MongoClient(uri);
  await client.connect();
  db = client.db();
  return db;
}

export async function users(): Promise<Collection<UserDocument>> {
  return (await getDb()).collection("users");
}
export async function scouts(): Promise<Collection<ScoutDocument>> {
  return (await getDb()).collection("scouts");
}
export async function requirements(): Promise<Collection<RequirementDocument>> {
  return (await getDb()).collection("requirements");
}
export async function choreLogs(): Promise<Collection<ChoreLogEntry>> {
  return (await getDb()).collection("chore_logs");
}
export async function budgetEntries(): Promise<Collection<BudgetEntry>> {
  return (await getDb()).collection("budget_entries");
}
export async function timeMgmt(): Promise<Collection<TimeMgmtDocument>> {
  return (await getDb()).collection("time_mgmt");
}
export async function loanAnalysis(): Promise<Collection<LoanAnalysisDocument>> {
  return (await getDb()).collection("loan_analysis");
}
export async function emailsSent(): Promise<Collection<EmailRecord>> {
  return (await getDb()).collection("emails_sent");
}
export async function reminders(): Promise<Collection<ReminderDocument>> {
  return (await getDb()).collection("reminders");
}
export async function setupStatus(): Promise<Collection<SetupStatusDocument>> {
  return (await getDb()).collection("setup_status");
}
export async function questPlans(): Promise<Collection<QuestPlanDocument>> {
  return (await getDb()).collection("quest_plans");
}
export async function sessionNotes(): Promise<Collection<SessionNoteDocument>> {
  return (await getDb()).collection("session_notes");
}
export async function cronLog(): Promise<Collection<CronLogEntry>> {
  return (await getDb()).collection("cron_log");
}
export async function planChangelog(): Promise<Collection<PlanChangeLogEntry>> {
  return (await getDb()).collection("plan_changelog");
}
