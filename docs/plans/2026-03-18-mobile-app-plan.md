# Mobile App Shell — Push Notifications & Conversational UX

**Status:** Planned
**Date:** 2026-03-18
**Depends on:** v2 backend (Phase 4 complete), troopquest.com domain (registered)
**Approach:** Capacitor native shell wrapping existing web app
**Time estimates:** Assume developer working with Claude Code (2-5x faster than solo)

---

## Overview

A thin native shell (Capacitor/Ionic) around the existing web app to deliver:
1. **Reliable push notifications** on iOS and Android (the web-only gap)
2. **Deep linking** — tap notification → opens specific page in app
3. **Android conversational notifications** — AI coach appears alongside WhatsApp/Messages
4. **App Store presence** — parents trust "install from App Store" over "go to this URL"
5. **Future: Wallet passes** — event reminders via lock screen

This is an **add-on**, not a rewrite. The web app (LibreChat, micro-apps, backend API) stays exactly as built. Capacitor wraps it in a native shell and adds the native capabilities the web can't deliver.

---

## Why Not Pure Web / PWA?

| Capability | Web/PWA | Capacitor Shell |
|---|---|---|
| iOS push notifications | Unreliable (60-75% of native, fails after restart, requires home-screen add) | Reliable (APNs, same as any native app) |
| Android push | Works via FCM web but requires browser permission | FCM native, works by default |
| Deep link from notification | Opens browser tab, not app | Opens app to specific page |
| Android conversation section | Not possible | MessagingStyle puts you next to WhatsApp |
| Inline reply from notification | Not possible | Possible (with custom plugin) |
| App Store distribution | N/A | TestFlight / Play Store |
| Wallet passes | Requires Safari "Add to Home Screen" | Native plugin support |
| Offline splash/loading | Service worker (inconsistent) | Native splash screen |

---

## Distribution Strategy: No Public App Store Required

For a troop of ~80 users, TestFlight (iOS) and Play Store Internal Testing (Android) provide full distribution without public App Store review.

### iOS — TestFlight

| Track | Tester Limit | Review? | Build Expiry | Notes |
|---|---|---|---|---|
| **Internal** | 100 (Apple Developer team members) | None | 90 days | Must add testers to your Apple Developer account |
| **External** | 10,000 | Light review (24-48hr) | 90 days | Invite by email, testers install TestFlight app |

- **External testing** is the sweet spot for a troop — invite 80 people by email, they install Apple's TestFlight app, your app auto-updates
- TestFlight review is much more lenient than App Store review — **Guideline 4.2 (WebView rejection) does not apply** to TestFlight
- 90-day build expiry means uploading a new build quarterly (can be automated via CI)
- TestFlight is free, included with $99/yr Apple Developer account

### Android — Play Store Testing Tracks

| Track | Tester Limit | Review? | Notes |
|---|---|---|---|
| **Internal testing** | 100 | None | Instant publishing, invite by email |
| **Closed testing** | Unlimited | Light review | Can use Google Groups for tester lists |
| **Open testing** | Unlimited | Light review | Public opt-in link |

- **Internal testing** covers the troop with zero review
- Testers get a Play Store install link — looks legit, auto-updates
- Free, included with $25 one-time Google Play developer fee

### Android — Direct APK Sideloading

- No limit, no review, no cost, no expiry
- Share APK file directly (email, Drive, etc.)
- User enables "Install from unknown sources" — more friction, less trust
- Good for quick developer testing, not ideal for parent distribution

### Fallback for Non-Installers

Parents who refuse to install any app still get:
- Web app in browser (full functionality minus push)
- Email notifications (Resend)
- Calendar subscription (ICS)
- Discourse forum via web or DiscourseHub app

No single point of failure. The native app is an enhancement, not a gate.

---

## Progressive Capability Matrix

What users get at each adoption level:

| Capability | Web Only | PWA (Home Screen) | Capacitor App |
|---|---|---|---|
| AI chat (LibreChat) | ✓ | ✓ | ✓ |
| Progress micro-app | ✓ | ✓ | ✓ |
| Email review/send | ✓ | ✓ | ✓ |
| Forum (Discourse) | ✓ | ✓ | ✓ |
| Calendar events (ICS) | ✓ | ✓ | ✓ |
| Email notifications | ✓ | ✓ | ✓ |
| Push notifications (Android) | Partial (FCM web) | Partial | **Full (FCM native)** |
| Push notifications (iOS) | No | Unreliable | **Full (APNs)** |
| Deep link from notification | Browser tab | Browser tab | **In-app navigation** |
| Android conversation section | No | No | **Yes (with custom plugin)** |
| Inline reply (Android) | No | No | **Yes (with custom plugin)** |
| iOS communication notifications | No | No | **Yes (with Swift extension)** |
| Wallet passes | No | No | **Yes (with plugin)** |
| Offline splash/loading | No | Partial | **Yes** |
| Auto-update | N/A | N/A | **Yes (TestFlight / Play Store)** |

---

## Implementation Tiers

### Tier 1: Basic Shell + Push (MVP)

Get the app in testers' hands with reliable push and deep linking.

**Effort: 1-2 days with Claude Code**

| Task | Est. Time | Notes |
|---|---|---|
| Capacitor project init + iOS/Android targets | 1-2 hr | `npx cap init`, add platforms |
| Configure app icons, splash screen, app name | 1 hr | Asset generation tools exist |
| Firebase project setup + FCM config | 1-2 hr | Firebase console + google-services.json |
| Apple push certificate (APNs key) | 1 hr | Apple Developer portal |
| `@capacitor/push-notifications` plugin | 1-2 hr | Register token, handle tap → deep link |
| Backend: push token storage + send endpoint | 2-3 hr | MongoDB collection, FCM Admin SDK |
| Backend: trigger push on events (reminders, forum replies, etc.) | 2-3 hr | Hook into existing notification points |
| Android build + internal testing upload | 1 hr | `npx cap build android`, upload to Play Console |
| iOS build via GitHub Actions CI | 2-3 hr | Fastlane + GitHub Actions macOS runner |
| TestFlight upload + invite testers | 1 hr | Automated via CI |
| **Total** | **~1.5-2 days** | |

**Delivers:** Reliable push on both platforms, tap-to-open deep linking, App Store/TestFlight distribution. Basic notifications (title + body + icon), not conversational style.

### Tier 2: Android Conversational Notifications

Upgrade Android notifications to appear in the Conversations section alongside WhatsApp/Messages.

**Effort: 1-2 days with Claude Code**

| Task | Est. Time | Notes |
|---|---|---|
| Custom Capacitor plugin (Java/Kotlin) | 3-4 hr | Intercept FCM data messages, build MessagingStyle |
| Conversation shortcuts (ShortcutManager) | 1-2 hr | Long-lived shortcuts for "Scout Coach" |
| Person objects with avatars | 1-2 hr | AI coach avatar, scout avatars from profile |
| Backend: FCM data-only payloads | 1-2 hr | Switch from `notification` to `data` key |
| Notification channel config | 1 hr | IMPORTANCE_HIGH, conversation category |
| Testing + polish | 2-3 hr | Verify conversation section placement |
| **Total** | **~1-1.5 days** | |

**Delivers:** "Scout Coach" appears in Android's prioritized Conversations section. Notifications show sender avatar, chat-style layout. ~85-90% of WhatsApp notification quality.

**Not included (low value for effort):**
- Notification bubbles — WebView renders poorly in bubble's small window. Skip.
- Inline reply — AI response is async, feels incomplete in notification shade. Skip unless users request it.

### Tier 3: iOS Communication Notifications

Upgrade iOS notifications with contact avatars and Focus mode bypass.

**Effort: 0.5-1 day with Claude Code**

| Task | Est. Time | Notes |
|---|---|---|
| Notification Service Extension (Swift) | 2-3 hr | ~50-100 lines of Swift, INSendMessageIntent |
| Configure extension in Xcode project | 1 hr | Add target, configure entitlements |
| CI pipeline update for extension | 1-2 hr | Build extension alongside main app |
| Testing | 1-2 hr | Verify avatar display, Focus bypass |
| **Total** | **~0.5-1 day** | |

**Delivers:** Scout Coach notifications show contact avatar, appear in iOS Communication section, can bypass Focus/DND modes.

### Tier 4: Wallet Passes (Future)

**Effort: 2-3 days with Claude Code**

| Task | Est. Time | Notes |
|---|---|---|
| Apple Developer pass type ID + certificates | 1-2 hr | Apple Developer portal |
| Backend: pass generation (passkit-generator npm) | 3-4 hr | Create Troop 2024 membership pass |
| Backend: pass update endpoint (push updates) | 2-3 hr | APNs for pass updates |
| Google Wallet pass equivalent | 2-3 hr | Google Wallet API |
| Event-specific pass updates | 2-3 hr | "Next meeting: Tuesday 7pm" on lock screen |
| Capacitor plugin integration | 1-2 hr | `capacitor-pass-to-wallet` |
| **Total** | **~2-3 days** | |

**Delivers:** Persistent "Troop 2024" pass in every parent's Wallet. Lock screen notifications on event updates. Location-aware: surfaces at meeting location.

---

## Build Pipeline: No/Low Mac Paths

### Development (all platforms, no Mac needed)

All Capacitor web development and Android builds work on Windows/Linux:

```
Windows/Linux:
  ├── Web app development (Express, HTML, CSS, JS) — any OS
  ├── Capacitor config + plugin setup — any OS
  ├── Android builds (Android Studio) — any OS
  └── Android testing (emulator or USB device) — any OS

Mac needed ONCE for:
  └── Apple Developer certificate generation + initial Xcode project setup
```

### iOS Build Options (Mac involvement spectrum)

| Approach | Mac Required? | Cost | Maintenance |
|---|---|---|---|
| **GitHub Actions (macOS runner)** | No (CI has Mac) | Free (2,000 min/mo) | Push code → CI builds IPA → uploads to TestFlight |
| **Codemagic CI** | No | Free (500 min/mo) | Same, purpose-built for mobile |
| **Old MacBook (occasional)** | Yes, but rarely | Free | Only for cert management, maybe 2x/year |
| **Mac Mini cloud (MacStadium)** | No | $20-40/mo | Full remote Mac, overkill for this |

**Recommended:** GitHub Actions for CI builds + old MacBook for initial cert setup.

### Recommended CI Pipeline

```
Developer pushes to GitHub
  │
  ├── GitHub Actions (ubuntu): build web assets, run tests
  │
  ├── GitHub Actions (ubuntu): build Android APK/AAB
  │   └── Upload to Play Store Internal Testing (via Fastlane)
  │
  └── GitHub Actions (macos): build iOS IPA
      └── Upload to TestFlight (via Fastlane)
```

Total CI config: ~100-150 lines of GitHub Actions YAML. Claude Code can generate this.

### Initial Mac Setup (one-time, ~2 hours)

These tasks require Xcode on macOS and cannot be done remotely:

1. Generate Apple Distribution certificate + provisioning profile
2. Export signing credentials for CI (Fastlane match or manual export)
3. Initial `npx cap open ios` to verify Xcode project builds
4. Register APNs key for push notifications

After this, the MacBook can be shelved. All subsequent builds happen via CI.

**MacBook minimum requirements:**
- macOS 13 Ventura+ (2017 MacBook Pro or newer) for current Xcode
- macOS 12 Monterey (2015-2016 MacBook Pro) for Xcode 14 — targets iOS 16, which still covers 95%+ of devices
- Only needs ~20GB free disk space for Xcode
- Performance doesn't matter — you're running Xcode once, not building repeatedly

---

## Cost Summary

| Item | Cost | Frequency | Required for |
|---|---|---|---|
| Apple Developer account | $99 | Annual | iOS builds, TestFlight, push certs, Wallet passes |
| Google Play developer | $25 | One-time | Play Store testing tracks |
| Firebase (FCM) | $0 | Free tier | Push notification delivery |
| OneSignal (optional) | $0 | Free tier (10K subscribers) | Simplifies push token management |
| GitHub Actions CI | $0 | Free tier (2,000 min/mo) | iOS builds without a Mac |
| Capacitor | $0 | MIT license | Native shell framework |
| **Total year 1** | **$124** | | |
| **Total ongoing** | **$99/yr** | | |

---

## Effort Summary (with Claude Code)

| Tier | What You Get | Effort | Cumulative |
|---|---|---|---|
| **Tier 1: Basic shell + push** | Reliable push, deep links, TestFlight/Play Store | 1.5-2 days | 2 days |
| **Tier 2: Android conversational** | Conversation section, MessagingStyle, avatars | 1-1.5 days | 3.5 days |
| **Tier 3: iOS communication** | Contact avatars, Focus bypass | 0.5-1 day | 4.5 days |
| **Tier 4: Wallet passes** | Lock screen event updates, location-aware | 2-3 days | 7 days |
| **CI pipeline setup** | Automated builds, no-Mac workflow | 0.5 day | 7.5 days |

**MVP (Tier 1 + CI) ships in ~2.5 days.** Full experience (all tiers) in ~7.5 days.

---

## Architecture

```
Parent/Scout's phone
  └── "Troop Quest" (Capacitor shell)
        ├── WebView → troopquest.com
        │     ├── LibreChat (AI coaching)
        │     ├── /progress (advancement tracking)
        │     ├── /email (email review micro-app)
        │     └── Discourse (forum, via iframe or link)
        │
        ├── Native: Push Notifications
        │     ├── Android: FCM → MessagingStyle (Tier 2)
        │     └── iOS: APNs → Communication Notifications (Tier 3)
        │
        ├── Native: Deep Linking
        │     └── Notification tap → WebView navigates to relevant page
        │
        └── Native: Wallet Passes (Tier 4)
              └── Event updates → lock screen notifications

Backend (troopquest.com:3090)
  ├── Existing: chat, tools, BSA API, micro-apps
  ├── New: POST /push/register (store device token)
  ├── New: POST /push/send (trigger notification)
  └── New: FCM Admin SDK / APNs for delivery
```

---

## Open Questions

1. **OneSignal vs raw FCM/APNs?** OneSignal simplifies token management and analytics for free. Trade-off: another dependency. Recommendation: start with raw FCM (simpler architecture), add OneSignal later if token management becomes painful.

2. **WebView vs native tab bar?** A native bottom tab bar (Chat, Progress, Forum, Settings) would make the app feel more native and help with App Store approval if we ever go public. Adds ~0.5 day. Recommended for Tier 2.

3. **Discourse integration:** Open Discourse in an in-app browser tab or deep-link to DiscourseHub? In-app keeps the experience unified. Deep-link to DiscourseHub is simpler. TBD based on whether we self-host Discourse under troopquest.com.

4. **When to go public on App Store?** Only when scaling beyond the troop. TestFlight + Play Store internal testing serves 80 users indefinitely with no review friction. Apple's Guideline 4.2 would require adding native tab bar + offline support to pass review.
