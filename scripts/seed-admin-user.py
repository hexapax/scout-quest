#!/usr/bin/env python3
"""Seed the admin user docs for Jeremy's two emails.

Idempotent upsert into the `scoutquest.users` collection — the same collection
the AdminJS panel and the backend `role-lookup` module consult. Running it
multiple times is safe; existing docs are updated, not duplicated.

Usage
-----
    # Local MongoDB (default):
    python3 scripts/seed-admin-user.py

    # Custom URI:
    MONGO_URI="mongodb://host/scoutquest" python3 scripts/seed-admin-user.py

    # Dry-run (no writes):
    python3 scripts/seed-admin-user.py --dry-run

Admins to seed
--------------
    jeremy@hexapax.com       — superuser, troop 2024
    jebramwell@gmail.com     — superuser, troop 2024

Once both docs exist the allowlist fallback in
`backend/src/auth/role-lookup.ts` becomes unnecessary but harmless (the DB
doc always wins over the allowlist). Do NOT remove the allowlist until
every production admin has a seeded user doc.

Run against production ONLY after a deploy that contains this script and the
Stream A backend changes — Jeremy should run it once post-merge.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone

from pymongo import MongoClient


ADMINS: list[dict] = [
    {
        "email": "jeremy@hexapax.com",
        "roles": [
            {"type": "superuser", "troop": "2024"},
        ],
    },
    {
        "email": "jebramwell@gmail.com",
        "roles": [
            {"type": "superuser", "troop": "2024"},
        ],
    },
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="Print intended writes; do not touch MongoDB.")
    parser.add_argument("--mongo-uri", default=os.environ.get("MONGO_URI", "mongodb://localhost:27017/scoutquest"))
    args = parser.parse_args()

    print(f"MongoDB URI: {args.mongo_uri}")
    print(f"Dry run: {args.dry_run}")
    print(f"Seeding {len(ADMINS)} admin user doc(s)...")
    print("")

    if args.dry_run:
        for admin in ADMINS:
            print(f"  would upsert: {admin}")
        return 0

    client = MongoClient(args.mongo_uri)
    # Database name is the last path segment of the URI; default to "scoutquest".
    db = client.get_default_database() or client["scoutquest"]
    users = db["users"]

    now = datetime.now(timezone.utc)

    for admin in ADMINS:
        email = admin["email"].lower()
        result = users.update_one(
            {"email": email},
            {
                "$set": {
                    "email": email,
                    "roles": admin["roles"],
                    "updated_at": now,
                },
                "$setOnInsert": {
                    "created_at": now,
                },
            },
            upsert=True,
        )
        action = "inserted" if result.upserted_id else (
            "updated" if result.modified_count else "unchanged"
        )
        print(f"  {email}: {action}")

    print("")
    print("Done. Restart the backend (or wait 60s) for the role-lookup cache to refresh.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
