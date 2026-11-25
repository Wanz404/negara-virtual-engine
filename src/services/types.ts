import type { Accessory, FollowStatus } from '../configs/types';

export type ApiMode = 'supabase' | 'sandbox';

export interface AvatarStyle {
  accessory?: Accessory;
}

export interface WorldState {
  worldId: string;
  igAccountHandle: string;
  lastCitizenNumber: number;
  dayNumber: number;
  igFollowerCount: number;
  followersSyncedAt: string | null;
  currentRingUnlocked: number;
  activeProjectId: string;
  activeProjectFunding: number;
  activeProjectGoal: number;
  activeProjectCompleted: boolean;
  completedProjects: string[];
  presidentAnnouncement: string;
  announcementAt: string | null;
  updatedAt: string | null;
}

/** Kolom publik warga (tanpa secret_token, ip_hash, recovery PIN). */
export interface PublicCitizen {
  id: string;
  worldId: string;
  citizenNumber: number;
  ktpCode: string;
  username: string;
  igUsername: string;
  followStatus: FollowStatus;
  followCheckedAt: string | null;
  joinedDay: number;
  rtRwAddress: string;
  avatarColor: string;
  avatarStyle: AvatarStyle;
  tierId: string;
  roleTitle: string;
  originalRoleTitle: string | null;
  impeachedAt: string | null;
  coins: number;
  totalDonated: number;
  statusText: string;
  lastStatusAt: string | null;
  lastWorkAt: string | null;
  lastActiveAt: string | null;
  createdAt: string;
}

export interface MyCitizen extends PublicCitizen {
  followRecheckRequestedAt: string | null;
  igChangedAt: string | null;
  hasRecoveryPin: boolean;
  /** Upgrade v2: terakhir ganti nama (cooldown 24 jam). Kosong jika belum pernah / DB lama. */
  nameUpdatedAt?: string | null;
  nameEditCount?: number;
}

export interface Session {
  citizenId: string;
  token: string;
}

export interface RegisterInput {
  username: string;
  igUsername: string;
  avatarColor: string;
  avatarStyle: AvatarStyle;
  turnstileToken?: string | null;
}

export interface RegisterResult {
  citizen: MyCitizen;
  session: Session;
}

export interface Plot {
  id: string;
  plotCode: string;
  ringLevel: number;
  gridX: number;
  gridY: number;
  price: number;
  ownerCitizenId: string | null;
  ownerTag: string | null;
  ownerNumber: number | null;
  buildingType: string | null;
  buildingName: string | null;
  buildingLevel: number;
  lastIncomeClaimAt: string | null;
  purchasedAt: string | null;
}

export type NewsCategory =
  | 'join'
  | 'status'
  | 'property'
  | 'project'
  | 'decree'
  | 'impeachment'
  | 'verification'
  | 'expansion'
  | 'poll'
  | 'system';

export interface NewsItem {
  id: number;
  category: NewsCategory;
  message: string;
  citizenId: string | null;
  createdAt: string;
}

export interface PollOption {
  id: string;
  label: string;
  votes: number;
}

export type PollStatus = 'pending' | 'active' | 'closed' | 'rejected';

export interface Poll {
  id: string;
  question: string;
  kind: 'policy' | 'project';
  status: PollStatus;
  options: PollOption[];
  totalVotes: number;
  createdByCitizenId: string | null;
  createdByTag: string | null;
  createdAt: string;
  myVote: string | null;
}

export type LeaderboardTab = 'founders' | 'gen1' | 'richest' | 'landlords';

export interface LeaderboardRow {
  rank: number;
  citizen: PublicCitizen;
  plotsCount: number;
  totalLevels: number;
}

export interface MyRanks {
  citizenNumber: number;
  wealthRank: number;
  landlordRank: number | null;
}

export interface DonorRow {
  citizenId: string;
  tag: string;
  amount: number;
}

export interface WorkResult {
  reward: number;
  coins: number;
  label: string;
  lastWorkAt: string;
}

export interface BatchVerifyResult {
  verified: number;
  notFollowing: number;
  unfollowed: number;
  syncedAt: string;
}

export interface FollowQueue {
  snapshotAt: string;
  usernames: string[];
}

export interface ImpeachResult {
  impeached: Array<{ citizenId: string; tag: string; roleTitle: string }>;
}

export interface WorldUpdatePatch {
  dayNumber?: number;
  igFollowerCount?: number;
  allowDirectRegistration?: boolean;
}

export interface PresenceMember {
  key: string;
  kind: 'guest' | 'citizen';
  tag: string;
  citizenId: string | null;
  color: string;
  onlineAt: string;
}

export interface PresenceIdentity {
  kind: 'guest' | 'citizen';
  tag: string;
  citizenId: string | null;
  color: string;
}

// ---------------------------------------------------------------------------
// Upgrade v2: Edit Profil, Global Chat, Emote Broadcast
// ---------------------------------------------------------------------------

export type EmoteKey = 'laugh' | 'cry' | 'salute' | 'fire' | 'coin' | 'angry';

export interface ProfilePatch {
  displayName?: string;
  avatarColor?: string;
  accessory?: Accessory;
}

export interface ChatMessage {
  id: number;
  citizenId: string;
  seatNumber: number;
  displayName: string;
  roleTitle: string;
  tier: string;
  message: string;
  emoteKey: EmoteKey | null;
  createdAt: string;
}

/** Payload ringan Supabase Realtime Broadcast (event 'citizen_emote'), tidak disimpan di DB. */
export interface EmoteEvent {
  citizen_id: string;
  seat_number: number;
  display_name: string;
  emote_key: EmoteKey;
  timestamp: number;
}

export interface EmoteChannel {
  send(e: EmoteEvent): void;
  leave(): void;
}

export type ModerationTarget = 'status' | 'building_name' | 'news';

/**
 * Kontrak tunggal yang diimplementasikan oleh adapter Supabase (production) dan Sandbox (localStorage).
 * Semua mutasi warga butuh `Session` (citizen_id + secret_token). Semua mutasi admin butuh `adminSecret`.
 */
export interface NationApi {
  readonly mode: ApiMode;

  // --- Publik ---
  getWorldState(): Promise<WorldState>;
  getNews(limit?: number): Promise<NewsItem[]>;
  getMapCitizens(meId?: string | null, limit?: number): Promise<PublicCitizen[]>;
  getPlots(rings: number[]): Promise<Plot[]>;
  /** Hanya kavling ber-pemilik (kavling dijual digenerate di klien, identik dengan SQL). */
  getOwnedPlots(rings: number[]): Promise<Plot[]>;
  getLeaderboard(tab: LeaderboardTab, offset: number, limit: number, search?: string): Promise<LeaderboardRow[]>;
  getMyRanks(citizenId: string): Promise<MyRanks>;
  getProjectTopDonors(projectId: string, limit?: number): Promise<DonorRow[]>;
  getActivePolls(session?: Session | null): Promise<Poll[]>;

  // --- Pendaftaran & sesi ---
  register(input: RegisterInput): Promise<RegisterResult>;
  getMe(session: Session): Promise<MyCitizen | null>;
  recoverSession(ktpCode: string, pin: string): Promise<Session>;
  setRecoveryPin(session: Session, pin: string): Promise<void>;

  // --- Verifikasi follow (warga) ---
  updateInstagram(session: Session, igUsername: string): Promise<MyCitizen>;
  requestFollowRecheck(session: Session): Promise<MyCitizen>;

  // --- Aktivitas & ekonomi ---
  claimWork(session: Session): Promise<WorkResult>;
  postStatus(session: Session, text: string): Promise<MyCitizen>;
  buyPlot(session: Session, plotCode: string): Promise<{ plot: Plot; coins: number }>;
  buildOrUpgrade(session: Session, plotCode: string, buildingType?: string | null, buildingName?: string | null): Promise<{ plot: Plot; coins: number; cost: number }>;
  renameProperty(session: Session, plotCode: string, buildingName: string): Promise<Plot>;
  claimPropertyIncome(session: Session, plotCode?: string | null): Promise<{ total: number; coins: number }>;
  donateToProject(session: Session, amount: number): Promise<{ coins: number; world: WorldState; completedProjectId: string | null }>;

  // --- Pemerintahan ---
  castVote(session: Session, pollId: string, optionId: string): Promise<Poll>;
  postAnnouncement(session: Session, text: string): Promise<WorldState>;
  proposePoll(session: Session, question: string, options: string[]): Promise<Poll>;

  // --- Admin (PIN / ADMIN_SECRET) ---
  adminLogin(secret: string): Promise<boolean>;
  adminUpdateWorld(secret: string, patch: WorldUpdatePatch): Promise<WorldState>;
  adminGetFollowQueue(secret: string): Promise<FollowQueue>;
  adminBatchVerify(secret: string, followerUsernames: string[], totalFollowers: number | null, snapshotAt: string | null, markUnfollowers?: boolean): Promise<BatchVerifyResult>;
  /** Mode sebagian: lantik username di `followers`, tandai `notFollowers`; warga lain TIDAK diubah. */
  adminReportFollowChecks(secret: string, followers: string[], notFollowers: string[], totalFollowers: number | null): Promise<{ verified: number; notFollowing: number }>;
  adminImpeach(secret: string): Promise<ImpeachResult>;
  adminRestoreCitizen(secret: string, citizenId: string): Promise<void>;
  adminCreatePoll(secret: string, question: string, options: string[], kind: 'policy' | 'project'): Promise<Poll>;
  adminListPendingPolls(secret: string): Promise<Poll[]>;
  adminModeratePoll(secret: string, pollId: string, action: 'approve' | 'reject' | 'close'): Promise<void>;
  adminModerateContent(secret: string, target: ModerationTarget, id: string): Promise<void>;
  adminSetActiveProject(secret: string, projectId: string, resetFunding: boolean): Promise<WorldState>;

  // --- Realtime Presence (Tamu online) ---
  joinPresence(me: PresenceIdentity, onSync: (members: PresenceMember[]) => void): () => void;

  // --- Upgrade v2 ---
  /** Ganti nama (1x / 24 jam) & tampilan avatar. Kursi, jabatan, tier, ring, tgl gabung, status follow dikunci server. */
  updateProfile(session: Session, patch: ProfilePatch): Promise<MyCitizen>;
  getGlobalChat(limit?: number): Promise<ChatMessage[]>;
  sendGlobalChat(session: Session, message: string, emoteKey?: EmoteKey | null): Promise<ChatMessage>;
  /** INSERT (pesan baru) & UPDATE (sinkron ganti nama). Mengembalikan fungsi cleanup. */
  subscribeGlobalChat(handlers: { onInsert: (m: ChatMessage) => void; onUpdate: (m: ChatMessage) => void }): () => void;
  /** Realtime Broadcast emote (0 beban database). */
  joinEmotes(onEmote: (e: EmoteEvent) => void): EmoteChannel;
}

export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiError';
  }
}
