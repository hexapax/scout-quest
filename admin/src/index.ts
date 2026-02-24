import express from "express";
import session from "express-session";
import AdminJS from "adminjs";
import AdminJSExpress from "@adminjs/express";
import * as AdminJSMongoose from "@adminjs/mongoose";
import MongoStore from "connect-mongo";

import { connectScoutDb, libreChatDb } from "./models/connections.js";
import { scoutQuestResources } from "./resources/scout-quest.js";
import { libreChatResources } from "./resources/librechat.js";
import { registerExportRoute } from "./resources/export.js";
import { passport } from "./auth.js";

// Register Mongoose adapter with AdminJS
AdminJS.registerAdapter({
  Resource: AdminJSMongoose.Resource,
  Database: AdminJSMongoose.Database,
});

const PORT = parseInt(process.env.PORT || "3082", 10);
const SESSION_SECRET = process.env.SESSION_SECRET || "change-me-in-production";
const MONGO_URI_SCOUT = process.env.MONGO_URI_SCOUT || "mongodb://localhost:27017/scoutquest";

// Dense layout CSS — reduces padding/margins for more data on screen
const denseCSS = `
/* --- List view: compact table --- */
[data-css="default-css"] table td,
[data-css="default-css"] table th {
  padding: 6px 8px !important;
  font-size: 13px !important;
}

/* Table header */
[data-css="default-css"] table th {
  font-size: 12px !important;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* --- Sidebar: tighter spacing --- */
[data-css="sidebar-css"] {
  width: 200px !important;
}
[data-css="sidebar-css"] a,
[data-css="sidebar-css"] [class*="NavigationElement"] {
  padding: 4px 12px !important;
  font-size: 13px !important;
}
[data-css="sidebar-css"] section {
  margin: 0 !important;
}

/* --- Cards and boxes: less padding --- */
[class*="Box"],
[class*="Card"] {
  padding: 8px !important;
}

/* --- Show page: compact form fields --- */
[data-css="default-css"] [class*="PropertyInShow"],
[data-css="default-css"] [class*="property-in-show"] {
  margin-bottom: 8px !important;
}
[data-css="default-css"] label {
  margin-bottom: 2px !important;
  font-size: 11px !important;
}

/* --- Action header: less vertical space --- */
[class*="ActionHeader"] {
  padding: 8px 0 !important;
  margin-bottom: 8px !important;
}

/* --- Breadcrumbs: smaller --- */
[class*="Breadcrumbs"] {
  font-size: 12px !important;
}

/* --- Mobile: tighter layout --- */
@media (max-width: 768px) {
  [data-css="sidebar-css"] {
    width: 180px !important;
  }
  [data-css="default-css"] table td,
  [data-css="default-css"] table th {
    padding: 4px 6px !important;
    font-size: 12px !important;
  }
}

/* --- Summary column: full-width, no truncation --- */
td:only-child {
  max-width: none !important;
  white-space: normal !important;
}
`;

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

  const allResources = [...scoutQuestResources, ...libreChatResources];

  // Create AdminJS instance
  const admin = new AdminJS({
    resources: allResources,
    rootPath: "/",
    branding: {
      companyName: "Scout Quest Admin",
      logo: false,
      withMadeWithLove: false,
    },
    assets: {
      styles: ["/admin-dense.css"],
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
          actions: {
            exportJson: "Export JSON",
            exportText: "Copy as Text",
            viewMessages: "View Messages",
          },
        },
      },
    },
  });

  const app = express();

  // Trust proxy (behind Caddy reverse proxy)
  app.set("trust proxy", 1);

  // Session middleware (shared by Passport and AdminJS)
  app.use(
    session({
      store: MongoStore.create({
        mongoUrl: MONGO_URI_SCOUT,
        collectionName: "admin_sessions",
      }),
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      name: "scout-admin",
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      },
    })
  );

  // Passport middleware
  app.use(passport.initialize());
  app.use(passport.session());

  // --- Auth routes (before AdminJS router) ---

  // Login: redirect to Google OAuth
  app.get("/login", (_req, res) => {
    res.redirect("/auth/google");
  });

  // Start Google OAuth flow
  app.get(
    "/auth/google",
    passport.authenticate("google", { scope: ["email", "profile"] })
  );

  // Google OAuth callback
  app.get(
    "/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/auth/failed" }),
    (_req, res) => {
      res.redirect("/");
    }
  );

  // Auth failure page
  app.get("/auth/failed", (_req, res) => {
    res.status(403).send(
      "<h1>Access Denied</h1><p>Your Google account is not authorized to access this admin panel.</p>" +
        '<p><a href="/auth/google">Try a different account</a></p>'
    );
  });

  // Logout
  app.get("/logout", (req, res) => {
    req.logout(() => {
      res.redirect("/login");
    });
  });

  // --- Custom API routes (before AdminJS router) ---

  // Dense CSS served as a stylesheet
  app.get("/admin-dense.css", (_req, res) => {
    res.setHeader("Content-Type", "text/css");
    res.send(denseCSS);
  });

  // Export API — builds model list from all resources
  const resourceModels = allResources.map((r) => ({
    resource: r.resource as unknown as mongoose.Model<unknown>,
    options: { id: (r.options as Record<string, unknown>)?.id as string | undefined },
  }));
  registerExportRoute(app, resourceModels);

  // --- AdminJS router (unauthenticated — we handle auth above) ---
  const adminRouter = AdminJSExpress.buildRouter(admin);

  // Protect all AdminJS routes with auth check
  app.use(admin.options.rootPath, (req, res, next) => {
    if (req.isAuthenticated()) {
      return next();
    }
    res.redirect("/auth/google");
  }, adminRouter);

  app.listen(PORT, () => {
    console.log(`Scout Quest Admin running at http://localhost:${PORT}`);
  });
}

// Need mongoose import for type in registerExportRoute call
import mongoose from "mongoose";

start().catch((err) => {
  console.error("Failed to start admin app:", err);
  process.exit(1);
});
