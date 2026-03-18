/** Admin operational tools:
 * - rebuild_knowledge_cache: reload BSA knowledge doc in the backend
 * - validate_graph_integrity: check MongoDB scoutbook data health
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  scoutbookScouts,
  scoutbookAdvancement,
  scoutbookRequirements,
  scoutbookAdults,
} from "../../scoutbook/collections.js";

function getBackendUrl(): string {
  return process.env.BACKEND_URL ?? "http://scout-quest-backend:3090";
}

function getBackendApiKey(): string {
  return process.env.BACKEND_API_KEY ?? "";
}

export function registerAdminOpsTools(server: McpServer): void {
  // ---- rebuild_knowledge_cache ----
  server.registerTool(
    "rebuild_knowledge_cache",
    {
      title: "Rebuild Knowledge Cache",
      description:
        "Reload the BSA knowledge document in the Scout Coach backend without restarting it. " +
        "Use after updating knowledge files or running assemble-knowledge.sh. " +
        "The backend must be running and reachable.",
      inputSchema: {},
    },
    async () => {
      const url = `${getBackendUrl()}/internal/reload-knowledge`;
      const apiKey = getBackendApiKey();
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        });
        if (!res.ok) {
          const body = await res.text();
          return {
            content: [{ type: "text", text: `Knowledge reload failed (${res.status}): ${body}` }],
            isError: true,
          };
        }
        const data = (await res.json()) as { ok: boolean; chars: number; approxTokens: number };
        return {
          content: [{
            type: "text",
            text: `Knowledge cache reloaded: ${data.chars.toLocaleString()} chars (~${data.approxTokens.toLocaleString()} tokens).`,
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: `Cannot reach backend at ${url}: ${err instanceof Error ? err.message : String(err)}`,
          }],
          isError: true,
        };
      }
    }
  );

  // ---- validate_graph_integrity ----
  server.registerTool(
    "validate_graph_integrity",
    {
      title: "Validate Graph Integrity",
      description:
        "Check that MongoDB scoutbook data is complete and ready for graph loading. " +
        "Validates scout roster, advancement records, and requirements coverage. " +
        "Run before or after load-graph.sh to confirm data health.",
      inputSchema: {
        verbose: z
          .boolean()
          .optional()
          .describe("If true, lists specific scouts with missing data."),
      },
    },
    async ({ verbose }) => {
      const lines: string[] = ["## Graph Integrity Check\n"];
      let issues = 0;

      try {
        // Check scouts
        const scoutsCol = await scoutbookScouts();
        const allScouts = await scoutsCol.find({}).toArray();
        lines.push(`Scouts: ${allScouts.length} total`);

        const scoutsWithoutUserId = allScouts.filter((s) => !s.userId);
        if (scoutsWithoutUserId.length > 0) {
          lines.push(`  ⚠ ${scoutsWithoutUserId.length} scouts missing userId`);
          if (verbose) {
            for (const s of scoutsWithoutUserId) {
              lines.push(`    - ${s.firstName ?? "?"} ${s.lastName ?? "?"}`);
            }
          }
          issues++;
        } else {
          lines.push(`  ✓ All scouts have userId`);
        }

        // Check adults
        const adultsCol = await scoutbookAdults();
        const adultCount = await adultsCol.countDocuments();
        lines.push(`Adults: ${adultCount} total`);

        // Check advancement
        const advCol = await scoutbookAdvancement();
        const totalAdv = await advCol.countDocuments();
        lines.push(`\nAdvancement records: ${totalAdv} total`);

        if (totalAdv === 0) {
          lines.push(`  ⚠ No advancement records — run scoutbook_sync_all first`);
          issues++;
        } else {
          // Check which scouts have advancement data
          const scoutsWithAdv = await advCol.distinct("userId");
          const scoutUserIds = allScouts.map((s) => String(s.userId));
          const missingAdv = scoutUserIds.filter((id) => !scoutsWithAdv.map(String).includes(id));
          if (missingAdv.length > 0) {
            lines.push(`  ⚠ ${missingAdv.length} scouts have no advancement records`);
            if (verbose) {
              for (const uid of missingAdv.slice(0, 10)) {
                const s = allScouts.find((x) => String(x.userId) === uid);
                lines.push(`    - userId ${uid} (${s?.firstName ?? "?"} ${s?.lastName ?? "?"})`);
              }
              if (missingAdv.length > 10) lines.push(`    ... and ${missingAdv.length - 10} more`);
            }
            issues++;
          } else {
            lines.push(`  ✓ All scouts have advancement data`);
          }
        }

        // Check requirements
        const reqCol = await scoutbookRequirements();
        const totalReqs = await reqCol.countDocuments();
        lines.push(`\nRequirement records: ${totalReqs} total`);

        if (totalReqs === 0) {
          lines.push(`  ⚠ No requirement records — run scoutbook_sync_all first`);
          issues++;
        } else {
          const reqs = await reqCol.countDocuments({ reqId: { $exists: true } });
          const withoutReqId = totalReqs - reqs;
          if (withoutReqId > 0) {
            lines.push(`  ⚠ ${withoutReqId} requirements missing reqId`);
            issues++;
          } else {
            lines.push(`  ✓ All requirements have reqId`);
          }

          // Check advancement type coverage
          const rankReqs = await reqCol.countDocuments({ advancementType: "rank" });
          const mbReqs = await reqCol.countDocuments({ advancementType: "meritBadge" });
          lines.push(`  Breakdown: ${rankReqs} rank reqs, ${mbReqs} merit badge reqs`);
        }

        // Summary
        lines.push("");
        if (issues === 0) {
          lines.push(`✓ Graph integrity: OK — ready for graph loading`);
        } else {
          lines.push(`⚠ Graph integrity: ${issues} issue(s) found — resolve before running load-graph.sh`);
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: `Integrity check failed: ${err instanceof Error ? err.message : String(err)}`,
          }],
          isError: true,
        };
      }
    }
  );
}
