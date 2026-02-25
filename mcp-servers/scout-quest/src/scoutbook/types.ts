import type { ObjectId } from "mongodb";

// ============================================================
// BSA API Response Types
// Derived from actual API responses in scouting-org-research/data/responses/
// ============================================================

// --- Auth ---

/** Response from POST my.scouting.org/api/users/{username}/authenticate */
export interface AuthResponse {
  [key: string]: unknown;
}

// --- Roster: Shared ---

export interface MemberPosition {
  id: number;
  positionId: number;
  position: string;
  dateStarted: string;
  isPending: boolean;
  patrolId: number | null;
  patrolName: string | null;
  denId: number | null;
  denNumber: string | null;
  denType: string | null;
  isKey3?: boolean;
}

export interface HighestRankAwarded {
  id: number;
  rank: string;
  level: number;
  programId: number;
  program: string;
  unitTypeId: number;
  unitType: string;
  dateEarned: string;
  leaderApprovedDate: string | null;
  leaderApprovedUserId: number | null;
  awarded: boolean;
  awardedDate: string | null;
  awardedUserId: number | null;
}

/** Shared member shape returned by both youths and adults roster endpoints */
export interface RosterMember {
  userId: number;
  memberId: number;
  personGuid: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  nameSuffix: string | null;
  personFullName: string;
  nickName: string | null;
  dateOfBirth: string;
  age: number;
  memberType?: string;
  gender: string;
  grade: number | null;
  isAdult: boolean;
  address1: string;
  address2: string | null;
  city: string;
  state: string;
  zip: string;
  pictureUrl: string;
  email: string | null;
  homePhone: string | null;
  mobilePhone: string | null;
  workPhone: string | null;
  bsaVerifiedDate: string;
  lastRankApproved: Record<string, unknown>;
  highestRanksApproved: HighestRankAwarded[];
  highestRanksAwarded: HighestRankAwarded[];
  dateJoinedSeaScouts: string | null;
  dateJoinedVenturing: string | null;
  dateJoinedBoyScouts: string | null;
  positions: MemberPosition[];
}

export type YouthMember = RosterMember;
export type AdultMember = RosterMember;

/** Wrapper returned by GET /organizations/v2/units/{orgGuid}/youths and /adults */
export interface RosterResponse {
  id: number;
  number: string;
  unitType: string;
  unitTypeId: number;
  fullName: string;
  charterName: string;
  programType: string;
  akelaOrganizationGuid: string;
  organizationTypeId: number;
  councilAcceptGender: string;
  users: RosterMember[];
}

// --- Roster: Parents ---

export interface ParentInformation {
  memberId: number;
  personGuid: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  nickName: string | null;
  nameSuffix: string | null;
  personFullName: string;
  dateOfBirth: string;
  gender: string;
  address1: string;
  address2: string | null;
  city: string;
  state: string;
  zip: string;
  email: string | null;
  homePhone: string | null;
  mobilePhone: string | null;
  workPhone: string | null;
  bsaVerifiedDate: string;
}

/** Element of the flat array returned by GET /organizations/v2/units/{orgGuid}/parents */
export interface ParentEntry {
  youthUserId: number;
  parentUserId: number;
  parentInformation: ParentInformation;
}

// --- Roster: Patrols / Sub-Units ---

/** Element returned by GET /organizations/v2/units/{orgGuid}/subUnits */
export interface Patrol {
  subUnitId: number;
  subUnitName: string;
  denTypeId: number | null;
  denType: string | null;
  isApproved: boolean;
  isForumEnabled: boolean;
  showDlEvents: boolean | null;
  unitId: number;
  dateCreated: string;
}

// --- Advancement: Ranks ---

export interface RankProgress {
  id: number;
  name: string;
  versionId: number;
  version: string;
  dateEarned: string;
  leaderApprovedUserId: number | null;
  leaderApprovedDate: string | null;
  leaderApprovedFirstName: string | null;
  leaderApprovedLastName: string | null;
  awarded: boolean;
  poid: string | null;
  header: string | null;
  footer: string | null;
  adminNotes: string | null;
  proofReadDate: string;
  active: boolean;
  disabledOnQuickEntry: boolean;
  short: string;
  reallyShort: string;
  level: number;
  image: string;
  searchKeywords: string;
  lds: boolean;
  sku: number;
  price: number;
  priceLastUpdated: string;
  scoutNet: string;
  imageUrl50: string;
  imageUrl100: string;
  imageUrl200: string;
  imageUrl400: string;
  percentCompleted: number;
  markedCompletedDate: string | null;
  markedCompletedUserId: number | null;
  markedCompletedFirstName: string | null;
  markedCompletedLastName: string | null;
  awardedDate: string | null;
  awardedUserId: number | null;
  awardedFirstName: string | null;
  awardedLastName: string | null;
  status: string;
  programId: number;
  program: string;
}

export interface RankProgram {
  programId: number;
  program: string;
  totalNumberOfRanks: number;
  ranks: RankProgress[];
}

/** Response from GET /advancements/v2/youth/{userId}/ranks */
export interface RanksResponse {
  status: string;
  program: RankProgram[];
}

// --- Advancement: Rank Requirements ---

export interface RankRequirement {
  id: number;
  versionId: number;
  name: string;
  short: string;
  listNumber: string;
  requirementNumber: string;
  sortOrder: string;
  footer: string;
  childrenRequired: string;
  required: boolean;
  parentRequirementId: number | null;
  videoExternalURLId: number | null;
  previousRankRequired: boolean;
  monthsSinceLastRankRequired: string;
  eagleMBRequired: string;
  totalMBRequired: string;
  serviceHoursRequired: string;
  disabledOnQuickEntry: boolean;
  linkedAdventureId: number | null;
  linkedAwardId: number | null;
  linkedMeritBadgeId: number | null;
  electiveAdventure: boolean;
  dateStarted: string;
  optional: boolean;
  started: boolean;
  completed: boolean;
  linkedAdventure: Record<string, unknown>;
  linkedElectiveAdventures: unknown[];
  eagleRequiredMeritBadges: unknown[];
  nonEagleRequiredMeritBadges: unknown[];
  linkedMeritBadge: unknown[];
  linkedSSElective: unknown[];
  linkedAward: Record<string, unknown>;
  percentCompleted: number;
  status: string;
  dateCompleted: string;
  leaderApprovedDate: string;
  leaderApprovedUserId: number;
  leaderApprovedFirstName: string;
  leaderApprovedLastName: string;
  markedCompletedDate: string;
  markedCompletedUserId: number;
  markedCompletedFirstName: string;
  markedCompletedLastName: string;
  dateEarned: string | null;
  requiresSSElective: boolean;
}

/**
 * Response from GET /advancements/v2/youth/{userId}/ranks/{rankId}/requirements
 * Returns the rank object with an embedded requirements array.
 */
export interface RankRequirementsResponse extends RankProgress {
  requirements: RankRequirement[];
}

// --- Advancement: Merit Badges ---

/** Element of the flat array from GET /advancements/v2/youth/{userId}/meritBadges */
export interface MeritBadgeProgress {
  id: number;
  version: string;
  versionId: string;
  name: string;
  short: string;
  description: string;
  meritBadgeCategoryId: number;
  meritBadgeCategoryName: string;
  bsaNumber: string;
  imageFilename: string;
  imageUrl50: string;
  imageUrl100: string;
  imageUrl200: string;
  isEagleRequired: boolean;
  centennial: boolean;
  dateCreated: string;
  dateDiscontinued: string;
  lastUpdated: string;
  adminNotes: string;
  worksheetDOC: string;
  worksheetPDF: string;
  bsaPamphletNumber: string;
  bsaPamphletEdition: string;
  bsaPamphletImage: string;
  bsaEmblemNumber: string;
  bsaEmblemImage: string;
  bsaRequirements: string;
  pageURL: string;
  searchKeywords: string;
  sku: string;
  price: number;
  priceLastUpdated: string;
  dateStarted: string;
  leaderSignedUserId: string;
  leaderSignedDate: string;
  dateCompleted: string;
  markedCompletedDate: string;
  markedCompletedUserId: string;
  markedCompletedFirstName: string;
  markedCompletedLastName: string;
  percentCompleted: number;
  assignedCounselorUserId: number | string;
  counselorApprovedUserId: string;
  counselorApprovedFirstName: string | null;
  counselorApprovedLastName: string | null;
  counselorApprovedDate: string | null;
  leaderApprovedUserId: string;
  leaderApprovedDate: string;
  leaderApprovedFirstName: string;
  leaderApprovedLastName: string;
  checkedRecordedUserId: string;
  checkedRecordedDate: string;
  awardedDate: string;
  awardedUserId: string;
  awardedFirstName: string;
  awardedLastName: string;
  poid: string;
  status: string;
}

// --- Advancement: Merit Badge Requirements ---
// NOTE: The MB requirements endpoint returns many fields as STRINGS
// (booleans as "True"/"False", numbers as "123") unlike rank requirements.

export interface MeritBadgeRequirement {
  id: string;
  number: string;
  name: string;
  listNumber: string;
  footer: string;
  sortOrder: string;
  childrenRequired: string;
  required: string;
  parentRequirementId: string;
  counselorApproval: string;
  daysRequired: string;
  counselorApproveUserId: string;
  counselorApprovedFirstName: string;
  counselorApprovedLastName: string;
  counselorApprovedDate: string;
  optional: string;
  started: string;
  completed: string;
  percentCompleted: string;
  status: string;
  dateCompleted: string;
  leaderApprovedDate: string;
  leaderApprovedUserId: string;
  leaderApprovedFirstName: string;
  leaderApprovedLastName: string;
  markedCompletedDate: string;
  markedCompletedUserId: string;
  markedCompletedFirstName: string;
  markedCompletedLastName: string;
  dateEarned: string | null;
}

/**
 * Response from GET /advancements/v2/youth/{userId}/meritBadges/{mbId}/requirements
 * Returns the MB object with an embedded requirements array.
 */
export interface MBRequirementsResponse {
  id: string;
  name: string;
  version: string;
  versionId: string;
  short: string;
  description: string;
  eagleRequired: string;
  dateStarted: string;
  dateCompleted: string;
  counselorApprovedUserId: string;
  counselorApprovedFirstName: string;
  counselorApprovedLastName: string;
  counselorApprovedDate: string;
  percentCompleted: number;
  leaderSignedUserId: string;
  leaderSignedDate: string;
  leaderApprovedDate: string;
  leaderApprovedUserId: string;
  leaderApprovedFirstName: string;
  leaderApprovedLastName: string;
  checkedRecordedUserId: string;
  checkedRecordedDate: string;
  poid: string;
  imageUrl50: string;
  imageUrl100: string;
  imageUrl200: string;
  markedCompletedDate: string;
  markedCompletedUserId: string;
  markedCompletedFirstName: string;
  markedCompletedLastName: string;
  awardedDate: string;
  awardedUserId: string;
  awardedFirstName: string;
  awardedLastName: string;
  status: string;
  requirements: MeritBadgeRequirement[];
}

// --- Advancement: Awards ---

/** Element of the flat array from GET /advancements/v2/youth/{userId}/awards */
export interface AwardProgress {
  awardId: number;
  userAwardId: number;
  percentCompleted: number;
  markedCompletedDate: string;
  markedCompletedUserId: number;
  markedCompletedFirstName: string;
  markedCompletedLastName: string;
  dateEarned: string;
  leaderApprovedUserId: number;
  leaderApprovedDate: string;
  leaderApprovedFirstName: string;
  leaderApprovedLastName: string;
  awarded: boolean;
  awardedDate: string;
  awardedUserId: number;
  awardedFirstName: string;
  awardedLastName: string;
  referenceId: number | null;
  cacheDate: string;
  poid: string | null;
  name: string;
  short: string;
  category: string;
  itemNumber: string;
  rankId: number | null;
  image: string;
  imageSmall: string | null;
  sku: string;
  skuName: string;
  price: number;
  priceLastUpdated: string;
  adultAward: boolean;
  adminNotes: string | null;
  unitTypeId: number;
  scoutNet: string;
  showOnEvents: boolean;
  showOnQuickEntry: boolean;
  activeDate: string | null;
  expiredDate: string | null;
  status: string;
  imageUrl100: string;
  imageUrl200: string;
  imageUrl300: string;
  imageUrl400: string;
  rank: unknown | null;
  awardVersionId: number;
  version: string;
  versionEffectiveDt: string;
  versionExpiryDt: string | null;
  unitType: string;
  program: string;
}

// --- Activity Summary ---

export interface CampingLogs {
  totalNumberOfDays: number;
  totalNumberOfNights: number;
  percentCompleteTowardGoal: number;
}

export interface HikingLogs {
  totalNumberOfMiles: number;
  percentCompleteTowardGoal: number;
}

export interface ServiceLogs {
  totalNumberOfHours: number;
  percentCompleteTowardGoal: number;
}

export interface LongCruiseLogs {
  totalNumberOfDays: number;
}

/** Response from GET /advancements/v2/{userId}/userActivitySummary */
export interface ActivitySummary {
  memberId: string;
  fullName: string;
  campingLogs: CampingLogs;
  hikingLogs: HikingLogs;
  serviceLogs: ServiceLogs;
  longCruiseLogs: LongCruiseLogs;
}

// --- Linked Scouts ---

/** Element from GET /persons/{userId}/myScout */
export interface LinkedScout {
  userId: string;
  memberId: string;
  relationship: string;
  personGuid: string;
  firstName: string;
  lastName: string;
  nickName: string;
  missingRelationship: boolean;
  orgGuid: string;
  unitId: string;
  organizationName: string;
  position: string;
  positionId: number | null;
  unitType: string;
  unitTypeId: number | null;
  unitNumber: string;
  program: string;
  programId: number | null;
  acceptGender: string;
}

// --- Person Profile ---

export interface PersonProfile {
  personId: string;
  memberId: string;
  personGuid: string;
  userGuid: string;
  firstName: string;
  middleName: string;
  lastName: string;
  nameSuffix: string;
  fullName: string;
  nickName: string;
  dateOfBirth: string;
  gender: string;
  title: string;
  employer: string;
  occupation: string;
  name: string;
  homePhone: string;
  mobilePhone: string;
  mobilePhoneCarrier: string;
  mobilePhoneVerified: string;
  workPhone: string;
  scouterTitle: string;
  schoolGrade: string;
  imagePath: string;
  imageLargePath: string;
  imageSmallPath: string;
  isAdult: string;
  memberType: string;
  isLDS: string;
  dateDeleted: string;
  bio: string;
  talentReleaseId: string;
  talentReleaseDate: string;
  oaMember: string;
  oaMemberNumber: string;
  oaActive: string;
  isEagle: string;
  isEagleExtension: string;
  eagleId: string | null;
  eagleExtensionId: string;
  eagleExtEffectiveDt: string;
  eagleExtExpiryDt: string;
  extensionTypeLookUpId: number | null;
  extensionTypeLookUpShort: string;
  extensionTypeLookUpName: string;
  eagleProjectNumber: string | null;
  eagleProjectApproved: string | null;
  driversLicense: string;
  driversLicenseState: string;
  ethinicBackground: string;
  workAddress: string;
  workCity: string;
  workState: string;
  workZip: string;
  eagleScout: string;
  eagleScoutDate: string;
  schoolName: string;
  facebookId: string;
  dateInvited: string;
  personalMessage: string;
  website: string;
  facebook: string;
  twitter: string;
  experience: string;
  showFullName: string;
  showCouncilPatch: string;
  showUnitNumber: string;
  noEmails: string;
  createdSource: string;
  swimmingClassification: string;
  swimmingClassificationDate: string;
  oaElectionDate: string;
  oaOrdealDate: string;
  oaBrotherhoodDate: string;
  oaVigilDate: string;
  affiliateCode: string;
  payPalEmail: string;
  unitTypeId: string;
  annualHealthRecordABDate: string;
  annualHealthRecordCDate: string;
  boysLife: string;
  youthScoutTenure: string;
  boyScoutAdvancement: string;
  emailVerifiedBad: string;
  workingTowardAOL: string;
  workingTowardAOLDate: string;
  htmlPatches: string;
  address3: string;
  address4: string;
  address5: string;
  country: string;
  dateJoinedVenturing: string;
  dateJoinedSeaScouts: string;
  isUnalterable: boolean;
  isHidden: boolean;
}

export interface ProfileCouncil {
  councilGuid: string;
  councilName: string;
}

export interface ProfileAddress {
  address1: string;
  address2: string;
  city: string;
  zipCode: string;
  state: string;
}

export interface ProfileEmail {
  email: string;
}

export interface ProfileOrgPosition {
  organizationGuid: string;
  scoutbookGuid: string;
  organizationId: string;
  organizationName: string;
  unitType: string;
  unitNumber: string;
  dateStarted: string;
  subscriptionExpireDate: string;
  inUnitSubscription: boolean;
  positions: {
    id: string;
    name: string;
    denId: string;
    den: string;
    patrolId: string;
    patrol: string;
    dateStarted: string;
    expirationDate: string;
    trainedDate: string;
    trainedStatus: string;
    isPrimary: string;
    isKey3: string;
  }[];
}

export interface ProfileAdvancementInfo {
  totalEarnedMeritBadges: string;
  totalEarnedAwards: string;
}

/** Response from GET /persons/v2/{userId}/personprofile */
export interface PersonProfileResponse {
  profile: PersonProfile;
  currentProgramsAndRanks: unknown[];
  currentCouncils: ProfileCouncil[];
  parentsGuardiansInfo: unknown | null;
  advancementInfo: ProfileAdvancementInfo;
  extendedProfile: unknown[];
  addresses: ProfileAddress[];
  phones: unknown[];
  emails: ProfileEmail[];
  webContacts: unknown[];
  organizationPositions: ProfileOrgPosition[];
}

// --- Events ---

export interface EventUnit {
  id: number;
  unitId: number;
  unitFullName: string;
  unitTypeId: number;
  councilAcceptGender: string;
  acceptGender: string;
  denId: number | null;
  denNumber: string;
  denType: string;
  showDLEvents: boolean | null;
  patrolId: number | null;
  patrolName: string;
}

export interface EventRsvp {
  userId: number;
  firstName: string;
  lastName: string;
  nickName: string;
  rsvp: string;
  attended: boolean;
  primaryLeader: boolean;
  rsvpCode: string;
  isAdult: boolean;
  profileImage: string;
  canTakeAttendance: boolean;
  isAdvancementUpdated: boolean;
  akelaImage: string;
}

/** Element of the array from POST /advancements/events */
export interface EventDetail {
  id: number;
  userId: number;
  firstName: string;
  lastName: string;
  nickName: string;
  dateCreated: string;
  temp: boolean;
  eventType: string;
  startDate: string;
  endDate: string;
  numberOfDaysUntilEvent: number;
  name: string;
  location: string;
  mapUrl: string;
  isActivityMeeting: boolean;
  activityTypeId: number | null;
  activityType: string;
  activityId: number | null;
  lastUpdatedBy: string;
  lastUpdatedDt: string;
  description: string;
  notes: string;
  growthPlan: boolean;
  serviceProject: boolean;
  serviceProjectBenefit: boolean;
  outdoorActivity: boolean;
  parentOrientation: boolean;
  budgetCompleted: boolean;
  budgetIncludesScouts: boolean;
  budgetScoutsParticipate: boolean;
  budgetReviewed: boolean;
  parentalInvolvement: boolean;
  scoutStrong: boolean;
  groupFitness: boolean;
  fitnessCompetition: boolean;
  myScoutingTools: boolean;
  patrolTraining: boolean;
  plansReviewedParents: boolean;
  rsvp: boolean;
  tourLeaderUserId: number | null;
  slipsRequired: boolean;
  isAdvancementMeeting: boolean;
  advancementOrgMeetingId: number | null;
  wordPressMeetingId: number | null;
  isSequenceFixed: boolean | null;
  isAttended: boolean | null;
  userRsvp: string;
  rsvpCode: string;
  isAdvancementUpdated: boolean | null;
  electiveGroupName: string;
  electiveGroupSize: number | null;
  meetingIcon: string;
  isRequired: boolean | null;
  demographicLookupId: number;
  demographicLookupShort: string;
  demographicLookupLong: string;
  units: EventUnit[];
  invitedUsers: EventRsvp[];
}

// --- Calendars ---

/** Element from GET /advancements/v2/users/{userId}/calendars */
export interface CalendarSubscription {
  userCalendarId: number;
  userId: number;
  unitId: number;
  denId: number | null;
  patrolId: number | null;
  color: string;
  showCalendar: boolean;
  calendarCode: string;
}

// --- Dashboards ---

export interface DashboardCounts {
  ranks: number;
  meritBadges: number;
  awards: number;
  adventures: number;
}

/** Response from GET /organizations/v2/{orgGuid}/advancementDashboard */
export interface AdvancementDashboard {
  completed: DashboardCounts & { requirements: DashboardCounts };
  notPurchased: DashboardCounts;
  purchasedNotAwarded: DashboardCounts;
  awarded: DashboardCounts;
}

/** Response from GET /organizations/v2/{orgGuid}/unitActivitiesDashboard */
export interface UnitActivitiesDashboard {
  CampOuts: {
    Campouts: number;
    CampoutsScoutParticipating: number;
    CampoutsTotalAttendance: number;
    NightsCamped: number;
    DaysCamped: number;
  };
  ServiceProjects: {
    ServiceProjects: number;
    ServiceProjectsScoutParticipating: number;
    ServiceProjectsTotalAttendance: number;
    ServiceHours: number;
    ConservationHours: number;
  };
  Hikes: {
    Hikes: number;
    HikesScoutParticipating: number;
    HikesTotalAttendance: number;
  };
}


// ============================================================
// MongoDB Document Types
// ============================================================

/** scoutbook_scouts — youth members. Upsert key: userId */
export interface ScoutbookScoutDoc {
  _id?: ObjectId;
  userId: string;
  memberId: string;
  personGuid: string;
  firstName: string;
  lastName: string;
  nickName?: string;
  dob?: string;
  age?: number;
  gender?: string;
  grade?: number;
  email?: string;
  phone?: string;
  address?: { line1: string; city: string; state: string; zip: string };
  orgGuid: string;
  unitNumber: string;
  patrol?: { id: number; name: string };
  currentRank?: { id: number; name: string; dateEarned?: string };
  positions?: { name: string; patrolId?: number }[];
  swimmingClassification?: string;
  dateJoined?: string;
  activitySummary?: {
    campingDays: number;
    campingNights: number;
    hikingMiles: number;
    serviceHours: number;
  };
  syncedAt: Date;
}

/** scoutbook_adults — adult leaders. Upsert key: userId */
export interface ScoutbookAdultDoc {
  _id?: ObjectId;
  userId: string;
  memberId: string;
  personGuid: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  orgGuid: string;
  unitNumber: string;
  positions?: { name: string; code: string }[];
  yptStatus?: string;
  yptExpiry?: string;
  syncedAt: Date;
}

/** scoutbook_parents — parents linked to youth. Upsert key: userId */
export interface ScoutbookParentDoc {
  _id?: ObjectId;
  userId: string;
  memberId?: string;
  personGuid: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  linkedYouthUserIds: string[];
  syncedAt: Date;
}

/** scoutbook_advancement — rank/MB/award progress. Upsert key: userId + type + advancementId */
export interface ScoutbookAdvancementDoc {
  _id?: ObjectId;
  userId: string;
  type: "rank" | "meritBadge" | "award";
  advancementId: number;
  name: string;
  versionId?: number;
  status: string;
  percentCompleted: number;
  dateStarted?: string;
  dateCompleted?: string;
  dateAwarded?: string;
  counselorUserId?: string;
  syncedAt: Date;
}

/** scoutbook_requirements — individual requirement completion. Upsert key: userId + advancementType + advancementId + reqId */
export interface ScoutbookRequirementDoc {
  _id?: ObjectId;
  userId: string;
  advancementType: "rank" | "meritBadge";
  advancementId: number;
  reqId: number;
  reqNumber: string;
  reqName: string;
  parentReqId: number | null;
  completed: boolean;
  started: boolean;
  dateCompleted?: string;
  dateStarted?: string;
  leaderApprovedDate?: string;
  percentCompleted: number;
  syncedAt: Date;
}

/** Embedded RSVP entry within ScoutbookEventDoc */
export interface ScoutbookEventRsvpEntry {
  userId: number;
  firstName: string;
  lastName: string;
  isAdult: boolean;
  rsvp: string;
  rsvpCode: string;
  attended: boolean;
  primaryLeader: boolean;
}

/** scoutbook_events — calendar events with RSVP data. Upsert key: eventId */
export interface ScoutbookEventDoc {
  _id?: ObjectId;
  eventId: number;
  unitId: number;
  name: string;
  eventType: string;
  startDate: string;
  endDate: string;
  location?: string;
  description?: string;
  notes?: string;
  rsvpEnabled: boolean;
  createdBy: { userId: number; firstName: string; lastName: string };
  dateCreated: string;
  isActivityMeeting: boolean;
  activityType?: string;
  serviceProject: boolean;
  outdoorActivity: boolean;
  invitedUsers: ScoutbookEventRsvpEntry[];
  units: { unitId: number; unitFullName: string; patrolId?: number; patrolName?: string }[];
  syncedAt: Date;
}

/** scoutbook_calendars — calendar subscriptions. Upsert key: userCalendarId */
export interface ScoutbookCalendarDoc {
  _id?: ObjectId;
  userCalendarId: number;
  userId: number;
  unitId: number;
  patrolId?: number;
  calendarCode: string;
  color: string;
  showCalendar: boolean;
  syncedAt: Date;
}

/** scoutbook_dashboards — unit-level dashboard snapshots. Upsert key: orgGuid + type */
export interface ScoutbookDashboardDoc {
  _id?: ObjectId;
  orgGuid: string;
  type: "advancement" | "activities";
  data: Record<string, unknown>;
  syncedAt: Date;
}

/** scoutbook_sync_log — audit trail. Insert-only (append). */
export interface ScoutbookSyncLogDoc {
  _id?: ObjectId;
  timestamp: Date;
  operation: "roster" | "scout" | "all" | "events" | "dashboards" | "calendars" | "auth_test" | "quest_init";
  orgGuid?: string;
  userId?: string;
  result: "success" | "partial" | "error";
  counts?: {
    scouts?: number;
    adults?: number;
    parents?: number;
    advancements?: number;
    requirements?: number;
    events?: number;
  };
  error?: string;
  durationMs: number;
}
