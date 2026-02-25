import type {
  AuthResponse,
  RosterResponse,
  YouthMember,
  AdultMember,
  ParentEntry,
  LinkedScout,
  RanksResponse,
  RankRequirementsResponse,
  MeritBadgeProgress,
  MBRequirementsResponse,
  AwardProgress,
  ActivitySummary,
  EventDetail,
  CalendarSubscription,
  AdvancementDashboard,
  UnitActivitiesDashboard,
  PersonProfileResponse,
} from "./types.js";

// ---------------------------------------------------------------------------
// BSA / Scoutbook API Client
// Auth via my.scouting.org, requests to api.scouting.org
// ---------------------------------------------------------------------------

const AUTH_BASE = "https://my.scouting.org/api/users";
const API_BASE = "https://api.scouting.org";

/** Minimum ms between requests (simple 1 req/sec rate limit). */
const RATE_LIMIT_MS = 1000;

/** Re-authenticate when JWT expires within this window. */
const REFRESH_BUFFER_MS = 30 * 60 * 1000; // 30 minutes

/** Max retries on 429 / network errors. */
const MAX_RETRIES = 3;

/** Base delay for exponential backoff (doubles each retry). */
const BACKOFF_BASE_MS = 2000;

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

interface JwtPayload {
  exp: number;
  uid: number;
  mid: string;
  [key: string]: unknown;
}

function decodeJwtPayload(token: string): JwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT: expected 3 parts");
  }
  const payload = Buffer.from(parts[1]!, "base64url").toString("utf-8");
  return JSON.parse(payload) as JwtPayload;
}

// ---------------------------------------------------------------------------
// ScoutbookApiClient
// ---------------------------------------------------------------------------

export class ScoutbookApiClient {
  private readonly username: string;
  private readonly password: string;
  readonly orgGuid: string;
  readonly unitId: string;

  private jwt: string | null = null;
  private jwtExp: number = 0; // seconds since epoch

  /** Timestamp of the last request (for rate limiting). */
  private lastRequestAt: number = 0;

  constructor() {
    const username = process.env.SCOUTBOOK_USERNAME;
    const password = process.env.SCOUTBOOK_PASSWORD;
    const orgGuid = process.env.SCOUTBOOK_ORG_GUID;
    const unitId = process.env.SCOUTBOOK_UNIT_ID;

    if (!username) throw new Error("SCOUTBOOK_USERNAME is required");
    if (!password) throw new Error("SCOUTBOOK_PASSWORD is required");
    if (!orgGuid) throw new Error("SCOUTBOOK_ORG_GUID is required");
    if (!unitId) throw new Error("SCOUTBOOK_UNIT_ID is required");

    this.username = username;
    this.password = password;
    this.orgGuid = orgGuid;
    this.unitId = unitId;
  }

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  /** Authenticate and cache the JWT. */
  async authenticate(): Promise<void> {
    const url = `${AUTH_BASE}/${encodeURIComponent(this.username)}/authenticate`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json; version=2",
      },
      body: JSON.stringify({ password: this.password }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Auth failed (${res.status}): ${body}`);
    }
    const data = (await res.json()) as AuthResponse;
    const token =
      typeof data.token === "string"
        ? data.token
        : typeof data.tokenResponse === "object" &&
            data.tokenResponse !== null &&
            typeof (data.tokenResponse as Record<string, unknown>).token === "string"
          ? ((data.tokenResponse as Record<string, unknown>).token as string)
          : undefined;
    if (!token) {
      throw new Error("Auth response did not contain a token");
    }
    this.jwt = token;
    this.jwtExp = decodeJwtPayload(token).exp;
  }

  /** Ensure we have a valid, non-expiring-soon JWT. */
  async ensureAuth(): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    if (!this.jwt || nowSec >= this.jwtExp - REFRESH_BUFFER_MS / 1000) {
      await this.authenticate();
    }
    return this.jwt!;
  }

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestAt;
    if (elapsed < RATE_LIMIT_MS) {
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
    }
    this.lastRequestAt = Date.now();
  }

  // -------------------------------------------------------------------------
  // HTTP primitives
  // -------------------------------------------------------------------------

  private buildHeaders(token: string): Record<string, string> {
    return {
      Authorization: `bearer ${token}`,
      Origin: "https://advancements.scouting.org",
      Referer: "https://advancements.scouting.org/",
      "Content-Type": "application/json",
      Accept: "application/json; version=2",
    };
  }

  /**
   * Generic GET request against the BSA API.
   * - Auto-authenticates
   * - Retries once on 401 (re-auth)
   * - Retries with exponential backoff on 429 / network error
   */
  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  /**
   * Generic POST request against the BSA API.
   * Same retry / auth semantics as get().
   */
  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    _retryCount = 0,
    _reauthed = false,
  ): Promise<T> {
    const token = await this.ensureAuth();
    await this.rateLimit();

    const url = `${API_BASE}${path}`;
    const init: RequestInit = {
      method,
      headers: this.buildHeaders(token),
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      // Network error — retry with backoff
      if (_retryCount < MAX_RETRIES) {
        const delay = BACKOFF_BASE_MS * 2 ** _retryCount;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.request<T>(method, path, body, _retryCount + 1, _reauthed);
      }
      throw err;
    }

    // 401 — try re-authenticating once
    if (res.status === 401 && !_reauthed) {
      this.jwt = null;
      await this.authenticate();
      return this.request<T>(method, path, body, _retryCount, true);
    }

    // 429 — backoff + retry
    if (res.status === 429 && _retryCount < MAX_RETRIES) {
      const delay = BACKOFF_BASE_MS * 2 ** _retryCount;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.request<T>(method, path, body, _retryCount + 1, _reauthed);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`BSA API ${method} ${path} failed (${res.status}): ${text}`);
    }

    return (await res.json()) as T;
  }

  // -------------------------------------------------------------------------
  // Roster
  // -------------------------------------------------------------------------

  /** GET youth roster for the unit. */
  async getYouthRoster(): Promise<YouthMember[]> {
    const res = await this.get<RosterResponse>(
      `/organizations/v2/units/${this.orgGuid}/youths`,
    );
    return res.users;
  }

  /** GET adult roster for the unit. */
  async getAdultRoster(): Promise<AdultMember[]> {
    const res = await this.get<RosterResponse>(
      `/organizations/v2/units/${this.orgGuid}/adults`,
    );
    return res.users;
  }

  /** GET parents for a specific youth member (filtered from unit parent roster). */
  async getParents(youthUserId: string): Promise<ParentEntry[]> {
    const all = await this.get<ParentEntry[]>(
      `/organizations/v2/units/${this.orgGuid}/parents`,
    );
    return all.filter((p) => String(p.youthUserId) === youthUserId);
  }

  /** GET scouts linked to current user (parent/guardian view). */
  async getLinkedScouts(userId: string): Promise<LinkedScout[]> {
    return this.get<LinkedScout[]>(`/persons/${userId}/myScout`);
  }

  // -------------------------------------------------------------------------
  // Advancement
  // -------------------------------------------------------------------------

  /** GET rank progress for a scout. */
  async getRanks(userId: string): Promise<RanksResponse> {
    return this.get<RanksResponse>(
      `/advancements/v2/youth/${userId}/ranks`,
    );
  }

  /** GET requirement completion for a scout + rank. */
  async getRankRequirements(
    userId: string,
    rankId: string,
  ): Promise<RankRequirementsResponse> {
    return this.get<RankRequirementsResponse>(
      `/advancements/v2/youth/${userId}/ranks/${rankId}/requirements`,
    );
  }

  /** GET merit badge progress for a scout. */
  async getMeritBadges(userId: string): Promise<MeritBadgeProgress[]> {
    return this.get<MeritBadgeProgress[]>(
      `/advancements/v2/youth/${userId}/meritBadges`,
    );
  }

  /** GET requirement completion for a scout + merit badge. */
  async getMBRequirements(
    userId: string,
    mbId: string,
  ): Promise<MBRequirementsResponse> {
    return this.get<MBRequirementsResponse>(
      `/advancements/v2/youth/${userId}/meritBadges/${mbId}/requirements`,
    );
  }

  /** GET awards for a scout. */
  async getAwards(userId: string): Promise<AwardProgress[]> {
    return this.get<AwardProgress[]>(
      `/advancements/v2/youth/${userId}/awards`,
    );
  }

  /** GET activity summary (camping, hiking, service) for a scout. */
  async getActivitySummary(userId: string): Promise<ActivitySummary> {
    return this.get<ActivitySummary>(
      `/advancements/v2/${userId}/userActivitySummary`,
    );
  }

  // -------------------------------------------------------------------------
  // Events / Calendar
  // -------------------------------------------------------------------------

  /** POST to fetch events for the unit within a date range. */
  async getEvents(startDate: string, endDate: string): Promise<EventDetail[]> {
    return this.post<EventDetail[]>("/advancements/events", {
      unitId: Number(this.unitId),
      fromDate: startDate,
      toDate: endDate,
      showDLEvents: true,
    });
  }

  /** GET calendar subscriptions for a user. */
  async getCalendarSubscriptions(
    userId: string,
  ): Promise<CalendarSubscription[]> {
    return this.get<CalendarSubscription[]>(
      `/advancements/v2/users/${userId}/calendars`,
    );
  }

  // -------------------------------------------------------------------------
  // Dashboards
  // -------------------------------------------------------------------------

  /** GET unit advancement dashboard. */
  async getAdvancementDashboard(): Promise<AdvancementDashboard> {
    return this.get<AdvancementDashboard>(
      `/organizations/v2/${this.orgGuid}/advancementDashboard`,
    );
  }

  /** GET unit activities dashboard. */
  async getUnitActivitiesDashboard(): Promise<UnitActivitiesDashboard> {
    return this.get<UnitActivitiesDashboard>(
      `/organizations/v2/${this.orgGuid}/unitActivitiesDashboard`,
    );
  }

  /** GET full person profile. */
  async getPersonProfile(
    userProfileId: string,
  ): Promise<PersonProfileResponse> {
    return this.get<PersonProfileResponse>(
      `/persons/v2/${userProfileId}/personprofile`,
    );
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: ScoutbookApiClient | null = null;

/** Lazily-initialized singleton. Throws if env vars are missing. */
export function scoutbookClient(): ScoutbookApiClient {
  if (!_instance) {
    _instance = new ScoutbookApiClient();
  }
  return _instance;
}
