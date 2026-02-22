import express from "express";
import AdminJS from "adminjs";
import AdminJSExpress from "@adminjs/express";
import * as AdminJSMongoose from "@adminjs/mongoose";
import MongoStore from "connect-mongo";

import { connectScoutDb, libreChatDb } from "./models/connections.js";
import { scoutQuestResources } from "./resources/scout-quest.js";
import { libreChatResources } from "./resources/librechat.js";
import { authenticate } from "./auth.js";

// Register Mongoose adapter with AdminJS
AdminJS.registerAdapter({
  Resource: AdminJSMongoose.Resource,
  Database: AdminJSMongoose.Database,
});

const PORT = parseInt(process.env.PORT || "3082", 10);
const SESSION_SECRET = process.env.SESSION_SECRET || "change-me-in-production";
const MONGO_URI_SCOUT = process.env.MONGO_URI_SCOUT || "mongodb://localhost:27017/scoutquest";

async function start() {
  // Connect to both databases
  console.log("Connecting to Scout Quest MongoDB...");
  await connectScoutDb();
  console.log("Connected to Scout Quest MongoDB");

  // Wait for LibreChat connection
  await new Promise<void>((resolve, reject) => {
    if (libreChatDb.readyState === 1) {
      resolve();
      return;
    }
    libreChatDb.once("connected", resolve);
    libreChatDb.once("error", reject);
  });

  // Create AdminJS instance
  const admin = new AdminJS({
    resources: [...scoutQuestResources, ...libreChatResources],
    rootPath: "/",
    branding: {
      companyName: "Scout Quest Admin",
      logo: false,
      withMadeWithLove: false,
    },
    locale: {
      language: "en",
      translations: {
        en: {
          labels: {
            Scout: "Scouts",
            Requirement: "Requirements",
            ChoreLog: "Chore Logs",
            BudgetEntry: "Budget Entries",
            TimeMgmt: "Time Management",
            LoanAnalysis: "Loan Analysis",
            EmailSent: "Emails Sent",
            Reminder: "Reminders",
            User: "Users",
            AuditLog: "Audit Log",
            QuestPlan: "Quest Plans",
            SessionNote: "Session Notes",
            CronLog: "Cron Log",
            PlanChangelog: "Plan Changelog",
            SetupStatus: "Setup Status",
            Conversation: "Conversations",
            Message: "Messages",
            LibreChatUser: "LibreChat Users",
          },
        },
      },
    },
  });

  const app = express();

  // Build authenticated router with session store
  const adminRouter = AdminJSExpress.buildAuthenticatedRouter(
    admin,
    {
      authenticate,
      cookieName: "scout-admin",
      cookiePassword: SESSION_SECRET,
    },
    null,
    {
      store: MongoStore.create({
        mongoUrl: MONGO_URI_SCOUT,
        collectionName: "admin_sessions",
      }),
      resave: false,
      saveUninitialized: false,
      secret: SESSION_SECRET,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      },
      name: "scout-admin",
    }
  );

  app.use(admin.options.rootPath, adminRouter);

  app.listen(PORT, () => {
    console.log(`Scout Quest Admin running at http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start admin app:", err);
  process.exit(1);
});
