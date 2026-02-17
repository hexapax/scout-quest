# Future Research

## iMessage Integration

**Status:** Not feasible (as of Feb 2026)

**Why we looked:** Will uses an iPad. iMessage would be the most native notification channel — no extra apps to install.

**What we found:**
- Apple has no public iMessage API. There is no supported way to send iMessages programmatically.
- **BlueBubbles** and **AirMessage** are community projects that bridge iMessage via a dedicated Mac running macOS. They work but require a Mac that stays on 24/7 — overkill for this project.
- **Beeper/Texts.com** aggregated messaging but shut down iMessage support under Apple legal pressure.
- Apple's Business Chat (now Apple Messages for Business) requires an approved business account and is designed for customer service, not personal notifications.

**Decision:** Use [ntfy.sh](https://ntfy.sh) instead. Free, works on iPad via the ntfy app, zero infrastructure. Good enough for chore reminders and milestone alerts.

**Revisit if:** Apple opens a public messaging API, or if a reliable hosted iMessage bridge emerges that doesn't require dedicated hardware.
