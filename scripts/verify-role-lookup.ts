/**
 * Manual verification harness for `lookupUserRole`.
 *
 * Exercises every test case from Stream A deliverable #6 of the
 * 2026-04-16 alpha launch plan. Spins up an isolated MongoDB database
 * (`scoutquest_verify` on the URI you pass in), seeds user docs, runs
 * the real `lookupUserRole`, asserts on the output, then cleans up.
 *
 * Run with:
 *   MONGO_URI=mongodb://localhost:27017/scoutquest_verify \
 *     npx --prefix backend tsx scripts/verify-role-lookup.ts
 *
 * No test framework — the backend has none today. Ported to Vitest/Jest
 * later as part of a broader test-harness investment.
 */

import type { UserDoc } from "../backend/src/models/user.js";

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/scoutquest_verify";

async function main(): Promise<void> {
  // Seed MONGO_URI BEFORE any module transitively imports db.ts / role-lookup.ts,
  // so `connectDb()` points at the isolated verify DB. All backend imports are
  // deferred via dynamic import() to guarantee the env var wins.
  process.env.MONGO_URI = MONGO_URI;

  const { connectDb, getScoutQuestDb } = await import("../backend/src/db.js");
  await connectDb();
  const db = getScoutQuestDb();

  const { clearRoleCache, lookupUserRole, pickPrimaryRole } = await import("../backend/src/auth/role-lookup.js");
  const { getToolsForRole } = await import("../backend/src/tools/definitions.js");

  const users = db.collection<UserDoc>("users");
  await users.deleteMany({});

  let failures = 0;
  const check = (name: string, cond: boolean, detail?: unknown) => {
    const mark = cond ? "PASS" : "FAIL";
    console.log(`  ${mark}: ${name}`);
    if (!cond) {
      failures++;
      if (detail !== undefined) console.log("    detail:", JSON.stringify(detail));
    }
  };

  // ---------- Test 1: Jeremy, no user doc → allowlist ----------
  console.log("\n[1] Jeremy with no user doc → allowlist fallback");
  clearRoleCache();
  const r1 = await lookupUserRole("jeremy@hexapax.com");
  check("source === 'allowlist'", r1.source === "allowlist", r1);
  check("isAdmin === true", r1.isAdmin === true, r1);
  check("role === 'superuser'", r1.role === "superuser", r1);
  check("troop set to 2024", r1.troop === "2024", r1);

  // ---------- Test 2: Jeremy WITH user doc → db wins ----------
  console.log("\n[2] Jeremy with user doc → DB source wins");
  await users.insertOne({
    email: "jeremy@hexapax.com",
    roles: [{ type: "admin", troop: "2024" }],
  });
  clearRoleCache();
  const r2 = await lookupUserRole("jeremy@hexapax.com");
  check("source === 'db'", r2.source === "db", r2);
  check("isAdmin === true", r2.isAdmin === true, r2);
  check("role === 'admin'", r2.role === "admin", r2);

  // ---------- Test 3: Arbitrary email, no user doc → unknown ----------
  console.log("\n[3] Arbitrary email with no user doc → unknown + empty tools");
  clearRoleCache();
  const r3 = await lookupUserRole("random@example.com");
  check("source === 'none'", r3.source === "none", r3);
  check("isAdmin === false", r3.isAdmin === false, r3);
  check("role === 'unknown'", r3.role === "unknown", r3);
  const unknownTools = getToolsForRole(r3.role);
  check("tools === []", unknownTools.length === 0, unknownTools.map((t) => t.name));

  // ---------- Test 4: Parent with scout_emails ----------
  console.log("\n[4] Parent with scout_emails → scoutEmails populated");
  await users.insertOne({
    email: "parent@example.com",
    roles: [{ type: "parent", scout_emails: ["kid1@example.com", "Kid2@Example.com"] }],
  });
  clearRoleCache();
  const r4 = await lookupUserRole("parent@example.com");
  check("source === 'db'", r4.source === "db", r4);
  check("role === 'parent'", r4.role === "parent", r4);
  check("isAdmin === false", r4.isAdmin === false, r4);
  check(
    "scoutEmails contains 2 kids (lowercased)",
    r4.scoutEmails.length === 2 &&
      r4.scoutEmails.includes("kid1@example.com") &&
      r4.scoutEmails.includes("kid2@example.com"),
    r4.scoutEmails,
  );
  const parentTools = getToolsForRole(r4.role);
  const writeToolNames = ["create_pending_action", "log_requirement_work", "advance_requirement", "rsvp_event", "log_activity"];
  check(
    "parent tools = read-only subset (no write tools)",
    parentTools.every((t) => !writeToolNames.includes(t.name)),
    parentTools.map((t) => t.name),
  );

  // ---------- Test 5: Leader + parent → role=leader (higher priority) ----------
  console.log("\n[5] Leader+parent → primary role = leader, roles includes both");
  await users.insertOne({
    email: "leader@example.com",
    roles: [
      { type: "parent", scout_emails: ["scoutkid@example.com"] },
      { type: "leader", troop: "2024" },
    ],
  });
  clearRoleCache();
  const r5 = await lookupUserRole("leader@example.com");
  check("source === 'db'", r5.source === "db", r5);
  check("role === 'leader'", r5.role === "leader", r5);
  check(
    "roles contains both leader and parent",
    r5.roles.includes("leader") && r5.roles.includes("parent"),
    r5.roles,
  );
  check(
    "scoutEmails still populated from parent entry",
    r5.scoutEmails.includes("scoutkid@example.com"),
    r5.scoutEmails,
  );
  const leaderTools = getToolsForRole(r5.role);
  check(
    "leader has write tools",
    leaderTools.some((t) => t.name === "create_pending_action") &&
      leaderTools.some((t) => t.name === "log_requirement_work"),
    leaderTools.map((t) => t.name),
  );

  // ---------- Test 6: Priority ordering ----------
  console.log("\n[6] pickPrimaryRole priority ordering");
  check("[superuser, admin] → superuser", pickPrimaryRole(["superuser", "admin"]) === "superuser");
  check("[admin, leader] → admin", pickPrimaryRole(["admin", "leader"]) === "admin");
  check("[leader, parent] → leader", pickPrimaryRole(["leader", "parent"]) === "leader");
  check("[parent, scout] → parent", pickPrimaryRole(["parent", "scout"]) === "parent");
  check("[scout, adult_readonly] → scout", pickPrimaryRole(["scout", "adult_readonly"]) === "scout");
  check("[] → unknown", pickPrimaryRole([]) === "unknown");

  // ---------- Test 7: Cache TTL + clear ----------
  console.log("\n[7] Cache holds (no re-read) and clears cleanly");
  clearRoleCache();
  const r7a = await lookupUserRole("leader@example.com");
  // Mutate DB under the cache — role lookup should still return cached value.
  await users.updateOne(
    { email: "leader@example.com" },
    { $set: { roles: [{ type: "scout" }] } },
  );
  const r7b = await lookupUserRole("leader@example.com");
  check("cached result unchanged", r7a.role === r7b.role && r7b.role === "leader", { r7a, r7b });
  clearRoleCache("leader@example.com");
  const r7c = await lookupUserRole("leader@example.com");
  check("after clearRoleCache: reads fresh DB state", r7c.role === "scout", r7c);

  // ---------- Test 8: Email case insensitivity ----------
  console.log("\n[8] Email lookup is case-insensitive");
  clearRoleCache();
  const r8 = await lookupUserRole("Jeremy@HEXAPAX.com");
  // DB has a jeremy@hexapax.com doc from test 2 with role=admin.
  check("mixed-case email resolves to same DB doc", r8.source === "db" && r8.role === "admin", r8);

  // Cleanup.
  await users.deleteMany({});

  console.log("");
  if (failures === 0) {
    console.log("All checks passed.");
    process.exit(0);
  } else {
    console.log(`FAILED — ${failures} check(s) did not pass.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Verification harness error:", err);
  process.exit(2);
});
