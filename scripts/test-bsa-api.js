// Quick diagnostic: test BSA auth + youth roster with timeouts
const org = process.env.SCOUTBOOK_ORG_GUID;
const user = process.env.SCOUTBOOK_USERNAME;
const pass = process.env.SCOUTBOOK_PASSWORD;
console.log("Authenticating as", user, "org", org);
const authUrl = "https://my.scouting.org/api/users/" + encodeURIComponent(user) + "/authenticate";
console.log("Auth URL:", authUrl);
const start = Date.now();

async function main() {
  // Auth with 30s timeout
  const authCtrl = new AbortController();
  const authTimer = setTimeout(() => { console.log("AUTH ABORT after 30s"); authCtrl.abort(); }, 30000);

  const authRes = await fetch(authUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json; version=2" },
    body: JSON.stringify({ password: pass }),
    signal: authCtrl.signal,
  });
  clearTimeout(authTimer);
  console.log("Auth status:", authRes.status, "in", Date.now() - start, "ms");

  const data = await authRes.json();
  const token = data.token || (data.tokenResponse && data.tokenResponse.token);
  if (!token) {
    console.log("No token in response:", JSON.stringify(data).slice(0, 300));
    return;
  }
  console.log("Got JWT, length:", token.length);

  // Youth roster with 30s timeout
  const rosterUrl = "https://api.scouting.org/organizations/v2/units/" + org + "/youths";
  console.log("Fetching youth roster:", rosterUrl);
  const rosterStart = Date.now();
  const rosterCtrl = new AbortController();
  const rosterTimer = setTimeout(() => { console.log("ROSTER ABORT after 30s"); rosterCtrl.abort(); }, 30000);

  const rosterRes = await fetch(rosterUrl, {
    headers: {
      Authorization: "bearer " + token,
      Origin: "https://advancements.scouting.org",
      Referer: "https://advancements.scouting.org/",
      Accept: "application/json; version=2",
    },
    signal: rosterCtrl.signal,
  });
  clearTimeout(rosterTimer);
  console.log("Roster status:", rosterRes.status, "in", Date.now() - rosterStart, "ms");
  const body = await rosterRes.text();
  console.log("Roster body (" + body.length + " chars):", body.slice(0, 500));
}

main().catch(e => {
  console.log("Error:", e.name, e.message);
  process.exit(1);
});
