#!/bin/bash
# Verify end-to-end vector (semantic) search through the DEPLOYED backend code,
# exercising the real searchBsaReference() path inside the running container.
#
# Success = output contains "(semantic)" + "(relevance: ...)" scores, proving the
# vector index is hit (not the full-text or doc-scan fallback).
#
# Needs admin-mode impersonation to reach scout-coach-vm via IAP:
#   CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT=claude-admin@hexapax-devbox.iam.gserviceaccount.com \
#     bash scripts/verify-vector-search.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-scout-assistant-487523}"

REMOTE_SCRIPT='
set -e
# Write the ESM probe into the running backend container, run it, clean up.
sudo -u scoutcoach docker exec scout-quest-backend sh -c "cat > /tmp/verify-vec.mjs <<'"'"'MJS'"'"'
import { searchBsaReference } from \"/app/dist/tools/search-bsa-reference.js\";
import { connectFalkorDB } from \"/app/dist/falkordb.js\";

const QUERY = \"how do I treat someone for shock and a sprained ankle in first aid\";
await connectFalkorDB();
const out = await searchBsaReference(QUERY);
console.log(\"QUERY:\", QUERY);
console.log(\"----- RESULT (first 700 chars) -----\");
console.log(out.slice(0, 700));
console.log(\"----- VERDICT -----\");
if (out.includes(\"(semantic)\")) console.log(\"VECTOR_SEARCH_WORKS: semantic path hit\");
else if (out.includes(\"(full-text)\")) console.log(\"DEGRADED: fell back to full-text\");
else console.log(\"DEGRADED: fell back to knowledge-doc scan\");
process.exit(0);
MJS
"
sudo -u scoutcoach docker exec scout-quest-backend node /tmp/verify-vec.mjs 2>&1
sudo -u scoutcoach docker exec scout-quest-backend rm -f /tmp/verify-vec.mjs
'

gcloud compute ssh scout-coach-vm --zone=us-east4-b --project="$PROJECT_ID" \
  --tunnel-through-iap --command="$REMOTE_SCRIPT" 2>&1
