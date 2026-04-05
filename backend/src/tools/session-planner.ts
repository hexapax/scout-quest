/** Tool: session_planner
 * Plans structured advancement sessions (e.g., Sunday advancement days).
 * Given attendees and time, generates stations, pairings, and checklists.
 */

import { graphQuery, isFalkorConnected } from "../falkordb.js";

export interface SessionPlannerInput {
  attendees?: string;        // Comma-separated scout names
  durationMinutes?: number;  // Available time (default: 120)
  focusAreas?: string;       // Comma-separated: "first aid, navigation, cooking"
  leaders?: string;          // Comma-separated leader/counselor names available
}

// Requirement categories with time estimates
const STATION_CONFIG: Record<string, {
  label: string;
  keywords: string[];
  minutesPerReq: number;  // Estimated time to work through one requirement
  needsOutdoors: boolean;
  needsEquipment: string[];
}> = {
  "first_aid": {
    label: "First Aid & Rescue",
    keywords: ["first aid", "bandage", "rescue", "transport", "bleeding", "shock", "hurry", "cpr", "splint"],
    minutesPerReq: 15,
    needsOutdoors: false,
    needsEquipment: ["first aid kit", "bandages", "splints", "blanket for stretcher"],
  },
  "navigation": {
    label: "Navigation & Orienteering",
    keywords: ["compass", "map", "bearing", "topographic", "orienteering", "direction", "pace"],
    minutesPerReq: 20,
    needsOutdoors: true,
    needsEquipment: ["compasses", "topographic maps", "protractors"],
  },
  "cooking": {
    label: "Cooking & Camp Chef",
    keywords: ["cook", "meal", "menu", "food", "stove", "recipe", "nutrition"],
    minutesPerReq: 25,
    needsOutdoors: true,
    needsEquipment: ["camp stoves", "cooking pots", "utensils", "food supplies"],
  },
  "knots_lashing": {
    label: "Knots & Lashing",
    keywords: ["knot", "lash", "rope", "hitch", "whip", "square knot", "bowline", "taut-line"],
    minutesPerReq: 10,
    needsOutdoors: false,
    needsEquipment: ["ropes (various sizes)", "poles/staves for lashing"],
  },
  "camping_skills": {
    label: "Camping & Outdoor",
    keywords: ["tent", "camp", "pitch", "leave no trace", "fire", "campsite", "sleep"],
    minutesPerReq: 20,
    needsOutdoors: true,
    needsEquipment: ["tents", "ground tarps", "fire-building supplies"],
  },
  "swimming": {
    label: "Swimming & Water Safety",
    keywords: ["swim", "float", "stroke", "water", "rescue", "buddy"],
    minutesPerReq: 20,
    needsOutdoors: true,
    needsEquipment: ["pool/waterfront access", "rescue equipment"],
  },
  "citizenship": {
    label: "Citizenship & Service",
    keywords: ["citizen", "community", "government", "service", "flag", "civic"],
    minutesPerReq: 15,
    needsOutdoors: false,
    needsEquipment: ["presentation materials"],
  },
  "fitness": {
    label: "Physical Fitness",
    keywords: ["fitness", "exercise", "push-up", "sit-up", "mile", "bmi", "physical"],
    minutesPerReq: 15,
    needsOutdoors: false,
    needsEquipment: ["measuring tape", "stopwatch", "fitness tracking forms"],
  },
};

export async function sessionPlanner(input: SessionPlannerInput): Promise<string> {
  if (!isFalkorConnected()) {
    return "Knowledge graph not available for session planning.";
  }

  const duration = input.durationMinutes ?? 120;
  const focusAreas = input.focusAreas
    ? input.focusAreas.split(",").map(a => a.trim().toLowerCase())
    : null;

  try {
    // Resolve attendees
    let attendeeFilter: string[] | null = null;
    if (input.attendees) {
      attendeeFilter = input.attendees.split(",").map(n => n.trim().toLowerCase());
    }

    // Get all started-but-incomplete requirements for attendees
    const allStarted = await graphQuery<{
      scout: string; userId: string; reqNumber: string; reqName: string;
      advName: string; advId: number; advType: string;
    }>(
      `MATCH (s:Scout)-[:STARTED_REQ]->(req:Requirement) ` +
      `MATCH (adv:Advancement {advancementId: req.advancementId})-[:HAS_REQUIREMENT]->(req) ` +
      `RETURN s.name AS scout, s.userId AS userId, req.reqNumber AS reqNumber, ` +
      `req.reqName AS reqName, adv.name AS advName, adv.advancementId AS advId, adv.type AS advType ` +
      `ORDER BY s.name, adv.name`
    );

    // Filter to attendees if specified
    const started = attendeeFilter
      ? allStarted.filter(r => attendeeFilter!.some(n => r.scout.toLowerCase().includes(n)))
      : allStarted;

    // Get proven teachers
    const teachers = await graphQuery<{ scout: string; userId: string }>(
      `MATCH (s:Scout)-[:COMPLETED_REQ]->(req:Requirement) ` +
      `WHERE (req.advancementId = 6 AND req.reqNumber = '6') ` +
      `   OR (req.advancementId = 2 AND req.reqNumber = '8') ` +
      `   OR (req.advancementId = 30 AND req.reqNumber = '6') ` +
      `RETURN DISTINCT s.name AS scout, s.userId AS userId`
    );
    const teacherNames = new Set(teachers.map(t => t.scout));

    // Classify requirements into stations
    const stations = new Map<string, {
      config: typeof STATION_CONFIG[string];
      scouts: Map<string, string[]>;  // scout -> list of req descriptions
      totalReqs: number;
    }>();

    for (const r of started) {
      const category = classifyReq(r.reqName, r.advName, focusAreas);
      if (!category) continue;

      if (!stations.has(category)) {
        stations.set(category, {
          config: STATION_CONFIG[category] ?? { label: category, keywords: [], minutesPerReq: 15, needsOutdoors: false, needsEquipment: [] },
          scouts: new Map(),
          totalReqs: 0,
        });
      }

      const station = stations.get(category)!;
      const scoutReqs = station.scouts.get(r.scout) || [];
      scoutReqs.push(`${r.advName} ${r.reqNumber}: ${r.reqName.substring(0, 60)}`);
      station.scouts.set(r.scout, scoutReqs);
      station.totalReqs++;
    }

    // Sort stations by number of scouts (most populated first)
    const sortedStations = [...stations.entries()]
      .sort((a, b) => b[1].scouts.size - a[1].scouts.size);

    // Find scouts who can serve as peer instructors at each station
    const peerInstructors = new Map<string, string[]>();
    for (const [category, station] of sortedStations) {
      const keywords = station.config.keywords;
      if (keywords.length === 0) continue;

      const pattern = keywords.join("|");
      const completers = await graphQuery<{ scout: string }>(
        `MATCH (s:Scout)-[:COMPLETED_REQ]->(req:Requirement) ` +
        `WHERE toLower(req.reqName) =~ $pattern ` +
        `RETURN DISTINCT s.name AS scout`,
        { pattern: `.*(?:${pattern}).*` }
      );

      // Prefer EDGE-trained scouts, exclude scouts who are learners at this station
      const learnerSet = new Set(station.scouts.keys());
      const instructors = completers
        .map(c => c.scout)
        .filter(name => !learnerSet.has(name))
        .sort((a, b) => {
          const aTeacher = teacherNames.has(a) ? 0 : 1;
          const bTeacher = teacherNames.has(b) ? 0 : 1;
          return aTeacher - bTeacher;
        });

      peerInstructors.set(category, instructors);
    }

    // Build the session plan
    const lines = [
      "ADVANCEMENT SESSION PLAN",
      `Duration: ${duration} minutes`,
      `Scouts: ${attendeeFilter ? input.attendees : `all (${new Set(started.map(s => s.scout)).size} with active requirements)`}`,
      `Leaders: ${input.leaders || "(assign as available)"}`,
      "",
    ];

    // Determine how many stations fit in the time
    const stationTime = Math.floor(duration / Math.min(sortedStations.length, 3));
    const rotations = Math.min(3, sortedStations.length);
    lines.push(`FORMAT: ${rotations} rotations x ${stationTime} min each\n`);

    // Station details
    lines.push("=" .repeat(50));
    lines.push("STATIONS\n");

    const leaderList = input.leaders ? input.leaders.split(",").map(l => l.trim()) : [];
    let leaderIdx = 0;

    for (const [category, station] of sortedStations.slice(0, 5)) {
      const instructors = peerInstructors.get(category) ?? [];
      const reqsPerScout = station.totalReqs / station.scouts.size;
      const estTime = Math.round(reqsPerScout * station.config.minutesPerReq);

      lines.push(`--- ${station.config.label} ---`);
      lines.push(`  Scouts: ${station.scouts.size} | Requirements: ${station.totalReqs} | Est. time: ${estTime} min`);
      if (station.config.needsOutdoors) lines.push(`  Location: OUTDOORS required`);
      if (station.config.needsEquipment.length > 0) {
        lines.push(`  Equipment: ${station.config.needsEquipment.join(", ")}`);
      }

      // Leader assignment
      if (leaderIdx < leaderList.length) {
        lines.push(`  Leader: ${leaderList[leaderIdx]}`);
        leaderIdx++;
      }

      // Peer instructor
      if (instructors.length > 0) {
        const edgeTag = teacherNames.has(instructors[0]) ? " [EDGE trained]" : "";
        lines.push(`  Peer instructor: ${instructors[0]}${edgeTag}`);
        if (instructors.length > 1) {
          lines.push(`    Backup: ${instructors.slice(1, 3).join(", ")}`);
        }
      }

      // Scout assignments
      lines.push(`  Scouts at this station:`);
      for (const [scout, reqs] of station.scouts) {
        lines.push(`    ${scout}: ${reqs.length} reqs — ${reqs[0]}`);
        if (reqs.length > 1) lines.push(`      + ${reqs.length - 1} more`);
      }
      lines.push("");
    }

    // Multi-person requirements (need to be scheduled together)
    const multiPerson = started.filter(r =>
      /partner|buddy|another|helper|together|with a|practice victim|with .+ show/i.test(r.reqName)
    );

    if (multiPerson.length > 0) {
      lines.push("=" .repeat(50));
      lines.push("MULTI-PERSON REQUIREMENTS (schedule these when partners are available)\n");
      for (const r of multiPerson.slice(0, 10)) {
        lines.push(`  ${r.scout}: ${r.advName} Req ${r.reqNumber}`);
        lines.push(`    ${r.reqName.substring(0, 100)}`);
      }
      lines.push("");
    }

    // Requirement checklist
    lines.push("=" .repeat(50));
    lines.push("REQUIREMENT CHECKLIST (track completions)\n");
    const byScout = new Map<string, string[]>();
    for (const r of started) {
      const arr = byScout.get(r.scout) || [];
      arr.push(`[ ] ${r.advName} Req ${r.reqNumber}`);
      byScout.set(r.scout, arr);
    }
    for (const [scout, reqs] of byScout) {
      lines.push(`${scout}:`);
      for (const r of reqs.slice(0, 8)) {
        lines.push(`  ${r}`);
      }
      if (reqs.length > 8) lines.push(`  ... and ${reqs.length - 8} more`);
      lines.push("");
    }

    return lines.join("\n");
  } catch (err) {
    console.error("session_planner error:", err);
    return `Session planning failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Classify a requirement into a station category. */
function classifyReq(reqName: string, advName: string, focusAreas: string[] | null): string | null {
  const text = `${reqName} ${advName}`.toLowerCase();

  for (const [category, config] of Object.entries(STATION_CONFIG)) {
    if (focusAreas && !focusAreas.some(f => category.includes(f) || config.label.toLowerCase().includes(f))) {
      continue;
    }
    if (config.keywords.some(kw => text.includes(kw))) {
      return category;
    }
  }

  // If focus areas specified and nothing matched, return null (skip)
  if (focusAreas) return null;
  return "general";
}
