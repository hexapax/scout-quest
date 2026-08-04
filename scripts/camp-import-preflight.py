#!/usr/bin/env python3
"""
Pre-flight check for a summer camp merit badge CSV before importing it into Scoutbook.

WHY THIS EXISTS
---------------
Camp advancement arrives as a "Scoutbook MB Requirements" CSV (Tentaroo / Black Pug).
It is imported through Legacy Scoutbook -> Administration -> "Import Merit Badge
Advancements", a screen injected by the volunteer-maintained Feature Assistant
browser extension. That importer has two properties that make a dry run valuable:

  1. It matches scouts by FIRST + LAST NAME, not by BSA member ID, even though the
     member ID is right there in the file. Camp registration names ("Jack", "Ben")
     routinely differ from Scoutbook roster names ("John", "Benjamin"), which raises
     a confirmation popup. Clicking Cancel on that popup SILENTLY DROPS that scout's
     entire record set, with no error and no summary line.

  2. It never overwrites. Anything already in Scoutbook is skipped into an exceptions
     list, so a re-import is safe but cannot correct existing bad data.

So the two things worth knowing in advance are exactly: which scouts will prompt, and
which rows will be silently skipped. This script answers both, plus flags data problems
in the camp file itself that are easier to fix by email than after import.

It is READ-ONLY. It talks to our synced Mongo mirror, never to BSA, and writes nothing
anywhere except its own report file.

USAGE
-----
    python3 scripts/camp-import-preflight.py <camp.csv> [-o report.md] [--cache FILE]

    --cache  Reuse (or create) a local JSON snapshot of the roster instead of
             re-querying the VM. Useful for iterating on the report offline.
"""

from __future__ import annotations

import argparse
import base64
import csv
import json
import os
import re
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SSH_VM = REPO / "scripts" / "ssh-vm.sh"

# gcloud chatters on stderr through the IAP tunnel; none of it is ours.
NOISE = ("WARNING", "To increase the performance", "please see", "https://cloud.google.com/iap")

# Mongo query shipped to the VM. Emits one JSON blob on stdout.
ROSTER_QUERY = r"""
const scouts = db.scoutbook_scouts
  .find({}, { userId: 1, memberId: 1, firstName: 1, lastName: 1, nickName: 1, currentRank: 1 })
  .toArray()
  .map(s => ({
    userId: s.userId, memberId: s.memberId || null,
    firstName: s.firstName || '', lastName: s.lastName || '',
    nickName: s.nickName || '', currentRank: s.currentRank || ''
  }));

const badges = db.scoutbook_advancement
  .find({ type: 'meritBadge' },
        { userId: 1, advancementId: 1, name: 1, status: 1, percentCompleted: 1,
          dateCompleted: 1, dateAwarded: 1 })
  .toArray()
  .map(a => ({
    userId: a.userId, advancementId: a.advancementId, name: a.name || '',
    status: a.status || '', percentCompleted: a.percentCompleted,
    dateCompleted: a.dateCompleted || null, dateAwarded: a.dateAwarded || null
  }));

print(JSON.stringify({ scouts, badges }));
"""


def strip_noise(text: str) -> str:
    return "\n".join(
        ln for ln in text.splitlines() if ln.strip() and not ln.lstrip().startswith(NOISE)
    )


def fetch_roster() -> dict:
    """Run ROSTER_QUERY on the VM's Mongo and return the parsed result."""
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as fh:
        fh.write(ROSTER_QUERY)
        local_js = fh.name
    try:
        b64 = base64.b64encode(Path(local_js).read_bytes()).decode()
        remote = (
            f"echo {b64} | base64 -d > /tmp/preflight.js && "
            "sudo -u scoutcoach docker cp /tmp/preflight.js scout-quest-mongodb:/tmp/preflight.js >/dev/null && "
            "sudo -u scoutcoach docker exec scout-quest-mongodb mongosh scoutquest --quiet --file /tmp/preflight.js"
        )
        proc = subprocess.run(
            ["bash", str(SSH_VM), remote], capture_output=True, text=True, timeout=180
        )
        if proc.returncode != 0:
            sys.exit(f"Roster fetch failed:\n{strip_noise(proc.stderr) or proc.stdout}")
        out = strip_noise(proc.stdout).strip()
        # mongosh may prepend connection chatter; the payload is the last JSON line.
        for line in reversed(out.splitlines()):
            line = line.strip()
            if line.startswith("{"):
                return json.loads(line)
        sys.exit(f"No JSON in roster output:\n{out[:2000]}")
    finally:
        os.unlink(local_js)


# --- name handling -----------------------------------------------------------

SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


def norm(s: str) -> str:
    """Casefold, drop punctuation and name suffixes. For comparison only."""
    s = re.sub(r"[^\w\s]", "", (s or "").lower()).strip()
    parts = [p for p in s.split() if p not in SUFFIXES]
    return " ".join(parts)


def parse_camp_csv(path: Path):
    """Return (rows, badges) where badges maps (member_id, badge, version) -> record."""
    with path.open(newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))
    if not rows:
        sys.exit(f"{path} has no data rows.")

    required = {"BSA Member ID", "First Name", "Last Name", "Advancement Type", "Advancement"}
    missing = required - set(rows[0].keys())
    if missing:
        sys.exit(
            f"{path} is not a Scoutbook MB Requirements file (missing {sorted(missing)}).\n"
            "If you opened it in Excel and re-saved, the header quoting is destroyed. "
            "Use the original download."
        )

    badges: dict[tuple, dict] = {}
    for r in rows:
        mid = (r["BSA Member ID"] or "").strip()
        adv_type = (r["Advancement Type"] or "").strip()
        adv = (r["Advancement"] or "").strip()
        version = (r.get("Version") or "").strip()

        if adv_type == "Merit Badge":
            name, req = adv, None
        elif adv_type == "Merit Badge Requirement":
            name, _, req = adv.partition(" #")
            if not req:  # malformed; keep it visible rather than dropping it
                name, req = adv, "?"
        else:
            continue

        key = (mid, name.strip(), version)
        rec = badges.setdefault(
            key,
            {
                "member_id": mid,
                "first": (r["First Name"] or "").strip(),
                "last": (r["Last Name"] or "").strip(),
                "badge": name.strip(),
                "version": version,
                "complete": False,
                "reqs": [],
                "date": (r.get("Date Completed") or "").strip(),
                "approved": (r.get("Approved") or "").strip(),
            },
        )
        if req is None:
            rec["complete"] = True
        else:
            rec["reqs"].append(req)
    return rows, badges


# --- badge name reconciliation ----------------------------------------------


def badge_key(name: str) -> str:
    """Normalize a badge name for comparison across systems ('&' vs 'and')."""
    n = (name or "").lower().replace("&", "and")
    return re.sub(r"[^a-z0-9]+", "", n)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv_path", type=Path, help="Scoutbook_MBRequirements_*.csv from camp")
    ap.add_argument("-o", "--out", type=Path, help="write the markdown report here")
    ap.add_argument("--cache", type=Path, help="JSON snapshot to reuse instead of querying the VM")
    args = ap.parse_args()

    if not args.csv_path.exists():
        sys.exit(f"No such file: {args.csv_path}")

    if args.cache and args.cache.exists():
        data = json.loads(args.cache.read_text())
    else:
        print("Fetching roster from VM...", file=sys.stderr)
        data = fetch_roster()
        if args.cache:
            args.cache.write_text(json.dumps(data))

    scouts = data["scouts"]
    by_member = {str(s["memberId"]): s for s in scouts if s.get("memberId")}

    # Name index. The importer keys on name, so a member-ID miss is not fatal on its
    # own -- it just means the camp file and Scoutbook disagree about the ID, which is
    # worth reporting separately from "this scout does not exist".
    by_name: dict[str, dict] = {}
    for s in scouts:
        for given in (s.get("firstName"), s.get("nickName")):
            if given:
                by_name.setdefault(f"{norm(given)}|{norm(s.get('lastName') or '')}", s)

    def resolve(member_id: str, first: str, last: str):
        """Mirror the importer's own resolution order: ID for our bookkeeping, name for reality."""
        scout = by_member.get(member_id)
        if scout:
            return scout, "id"
        scout = by_name.get(f"{norm(first)}|{norm(last)}")
        return (scout, "name") if scout else (None, None)
    badges_by_user = defaultdict(list)
    for b in data["badges"]:
        badges_by_user[b["userId"]].append(b)

    rows, camp = parse_camp_csv(args.csv_path)
    out: list[str] = []

    def w(line: str = "") -> None:
        out.append(line)

    w(f"# Camp import pre-flight: `{args.csv_path.name}`")
    w()
    w(f"{len(rows)} rows, {len(camp)} badge records, "
      f"{sum(1 for r in camp.values() if r['complete'])} completions, "
      f"{sum(1 for r in camp.values() if not r['complete'])} partials.")
    w()

    # ---- 1. name matching (the thing that silently eats a scout) ----
    w("## 1. Name matching")
    w()
    w("The importer matches on first + last name, not member ID. A mismatch raises a")
    w("popup; **clicking Cancel silently drops that scout's entire record set.** Confirm")
    w("every prompt below rather than cancelling.")
    w()
    w("| Camp name | BSA ID | Scoutbook name | Verdict |")
    w("|---|---|---|---|")

    people = {}
    for rec in camp.values():
        people.setdefault(rec["member_id"], (rec["first"], rec["last"]))

    prompts, unmatched, id_mismatch = [], [], []
    resolved: dict[str, dict] = {}
    for mid, (first, last) in sorted(people.items(), key=lambda kv: kv[1][1]):
        scout, how = resolve(mid, first, last)
        if not scout:
            w(f"| {first} {last} | `{mid}` | *no match by ID or name* | **NOT FOUND** |")
            unmatched.append((f"{first} {last}", mid))
            continue
        resolved[mid] = scout
        sb_first, sb_last, nick = scout["firstName"], scout["lastName"], scout.get("nickName") or ""
        exact = norm(first) == norm(sb_first) and norm(last) == norm(sb_last)
        via_nick = bool(nick) and norm(first) == norm(nick) and norm(last) == norm(sb_last)
        sb_display = f"{sb_first} {sb_last}" + (f" (nick: {nick})" if nick else "")

        plain = sb_display  # checklist copy, kept free of markdown so it renders as a name
        if how == "name":
            # Name resolves, so the import works; the two systems just disagree on the ID.
            id_mismatch.append((f"{first} {last}", mid, str(scout.get("memberId") or "-")))
            sb_display += f" (BSA ID **{scout.get('memberId')}**)"

        if exact and how == "id":
            verdict = "match"
        elif via_nick:
            verdict = "**PROMPT** (nickname)"
            prompts.append((f"{first} {last}", plain))
        else:
            verdict = "**PROMPT** — confirm, do not cancel"
            prompts.append((f"{first} {last}", plain))
        w(f"| {first} {last} | `{mid}` | {sb_display} | {verdict} |")
    w()
    if id_mismatch:
        w("**BSA member ID disagreement.** These scouts resolve by name, so the import will")
        w("still work, but camp holds a different member ID than Scoutbook. Worth correcting")
        w("with camp so next year's file is clean:")
        w()
        for name, camp_id, sb_id in id_mismatch:
            w(f"- {name}: camp has `{camp_id}`, Scoutbook has `{sb_id}`")
        w()
    if prompts:
        w(f"**{len(prompts)} popup(s) expected.** Confirm each one:")
        w()
        for camp_name, sb_name in prompts:
            w(f"- [ ] `{camp_name}` -> `{sb_name}`")
        w()
    else:
        w("No popups expected.")
        w()
    if unmatched:
        w("**Not on the synced roster** — these will fail outright. Re-run the Scoutbook")
        w("sync first, or confirm the scout is registered in the unit:")
        w()
        for name, mid in unmatched:
            w(f"- {name} (`{mid}`)")
        w()

    # ---- 2. what Scoutbook already has (import will skip these) ----
    w("## 2. Rows Scoutbook will skip")
    w()
    w("The importer never overwrites. Anything already recorded lands in the exceptions")
    w("list, so these will not import and cannot be corrected this way.")
    w()
    skipped = []
    for (mid, badge, _ver), rec in sorted(camp.items(), key=lambda kv: (kv[0][2] or "", kv[0][1])):
        scout = resolved.get(mid)
        if not scout:
            continue
        existing = [
            b for b in badges_by_user.get(scout["userId"], []) if badge_key(b["name"]) == badge_key(badge)
        ]
        for e in existing:
            if e["status"] in ("Awarded", "Leader Approved") or (e.get("dateCompleted")):
                skipped.append((f"{rec['first']} {rec['last']}", badge, e["status"], e.get("dateCompleted") or "-"))
    if skipped:
        w("| Scout | Badge | Existing status | Existing completion |")
        w("|---|---|---|---|")
        for name, badge, status, date in skipped:
            w(f"| {name} | {badge} | {status} | {date} |")
        w()
        w(f"{len(skipped)} badge(s) already present. Expect them in the exceptions list; that is normal.")
    else:
        w("None. No camp badge is already recorded in Scoutbook.")
    w()

    # ---- 3. peer anomaly detection ----
    w("## 3. Completions that look short")
    w()
    w("A badge marked complete whose requirement list is a strict subset of what other")
    w("scouts got for the same badge and version. Usually a missed counselor checkbox.")
    w("Scoutbook will accept it either way, so it surfaces later at a board of review.")
    w()
    by_badge = defaultdict(list)
    for rec in camp.values():
        if rec["complete"]:
            by_badge[(rec["badge"], rec["version"])].append(rec)

    anomalies = []
    for (badge, version), recs in sorted(by_badge.items()):
        if len(recs) < 2:
            continue
        counts = Counter(len(r["reqs"]) for r in recs)
        modal = max(counts, key=lambda k: (counts[k], k))
        modal_reqs = max((set(r["reqs"]) for r in recs if len(r["reqs"]) == modal), key=len)
        for r in recs:
            missing = modal_reqs - set(r["reqs"])
            if missing:
                anomalies.append((f"{r['first']} {r['last']}", badge, version, sorted(missing)))
    if anomalies:
        w("| Scout | Badge | Version | Missing vs peers |")
        w("|---|---|---|---|")
        for name, badge, version, missing in anomalies:
            w(f"| {name} | {badge} | {version} | {', '.join(missing)} |")
        w()
        w("Worth one email to camp before importing.")
    else:
        w("None. Every completion matches its peers.")
    w()

    # ---- 4. partials follow-up ----
    w("## 4. Partials — who needs a counselor")
    w()
    w("These import as in-progress. Each needs a counselor to finish. The camp file lists")
    w("what was *earned*, so what remains is inferred from gaps in the top-level numbering.")
    w()
    partials = defaultdict(list)
    for rec in camp.values():
        if not rec["complete"]:
            partials[f"{rec['first']} {rec['last']}"].append(rec)
    if partials:
        for name in sorted(partials):
            w(f"**{name}**")
            w()
            for rec in sorted(partials[name], key=lambda r: r["badge"]):
                tops = sorted({re.match(r"\d+", q).group() for q in rec["reqs"] if re.match(r"\d+", q)},
                              key=int)
                gaps = [str(n) for n in range(1, (int(tops[-1]) if tops else 0) + 1)
                        if str(n) not in tops]
                gap_note = f" — no work recorded under requirement {', '.join(gaps)}" if gaps else ""
                w(f"- {rec['badge']} ({rec['version']}): {len(rec['reqs'])} requirements done{gap_note}")
            w()
    else:
        w("No partials.")
    w()

    # ---- 5. reminders that are not derivable from the file ----
    w("## 5. Before you import")
    w()
    w("- [ ] Use the **original download**. Excel strips the quoted header and breaks the file.")
    w("- [ ] Feature Assistant extension **v0.49.0.15 or later** (an SB+ change broke older versions).")
    w("- [ ] Importer needs legacy Scoutbook **Full Control of every scout**, not just SB+ rights.")
    w("- [ ] Leave **Leader Approve OFF** so everything lands on the Needs Approval Report for review.")
    w("- [ ] Rank requirements cannot be imported by any path. They stay hand-entered.")
    w("- [ ] There is no bulk undo. Corrections are per-record.")
    w()

    report = "\n".join(out)
    if args.out:
        args.out.write_text(report)
        print(f"Report written to {args.out}", file=sys.stderr)
    print(report)

    print(
        f"\nSummary: {len(prompts)} name popup(s), {len(unmatched)} unmatched, "
        f"{len(skipped)} already-present, {len(anomalies)} short completion(s).",
        file=sys.stderr,
    )
    return 1 if unmatched else 0


if __name__ == "__main__":
    raise SystemExit(main())
