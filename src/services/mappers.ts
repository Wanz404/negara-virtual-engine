import type {
  DonorRow,
  LeaderboardRow,
  MyCitizen,
  NewsItem,
  Plot,
  Poll,
  PublicCitizen,
  WorldState,
} from './types';

type Row = Record<string, any>;

const num = (v: unknown, d = 0): number => (v === null || v === undefined || v === '' ? d : Number(v));
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export function mapWorld(r: Row): WorldState {
  return {
    worldId: r.world_id,
    igAccountHandle: r.ig_account_handle,
    lastCitizenNumber: num(r.last_citizen_number),
    dayNumber: num(r.day_number, 1),
    igFollowerCount: num(r.ig_follower_count),
    followersSyncedAt: str(r.followers_synced_at),
    currentRingUnlocked: num(r.current_ring_unlocked, 1),
    activeProjectId: r.active_project_id ?? '',
    activeProjectFunding: num(r.active_project_funding),
    activeProjectGoal: num(r.active_project_goal),
    activeProjectCompleted: Boolean(r.active_project_completed),
    completedProjects: r.completed_projects ?? [],
    presidentAnnouncement: r.president_announcement ?? '',
    announcementAt: str(r.announcement_at),
    updatedAt: str(r.updated_at),
  };
}

export function mapCitizen(r: Row): PublicCitizen {
  return {
    id: r.id,
    worldId: r.world_id,
    citizenNumber: num(r.citizen_number),
    ktpCode: r.ktp_code,
    username: r.username,
    igUsername: r.ig_username,
    followStatus: r.follow_status,
    followCheckedAt: str(r.follow_checked_at),
    joinedDay: num(r.joined_day, 1),
    rtRwAddress: r.rt_rw_address,
    avatarColor: r.avatar_color,
    avatarStyle: r.avatar_style ?? {},
    tierId: r.tier_id,
    roleTitle: r.role_title,
    originalRoleTitle: str(r.original_role_title),
    impeachedAt: str(r.impeached_at),
    coins: num(r.coins),
    totalDonated: num(r.total_donated),
    statusText: r.status_text ?? '',
    lastStatusAt: str(r.last_status_at),
    lastWorkAt: str(r.last_work_at),
    lastActiveAt: str(r.last_active_at),
    createdAt: r.created_at,
  };
}

export function mapMyCitizen(r: Row): MyCitizen {
  return {
    ...mapCitizen(r),
    followRecheckRequestedAt: str(r.follow_recheck_requested_at),
    igChangedAt: str(r.ig_changed_at),
    hasRecoveryPin: Boolean(r.has_recovery_pin),
  };
}

export function mapPlot(r: Row): Plot {
  return {
    id: r.id,
    plotCode: r.plot_code,
    ringLevel: num(r.ring_level),
    gridX: num(r.grid_x),
    gridY: num(r.grid_y),
    price: num(r.price),
    ownerCitizenId: str(r.owner_citizen_id),
    ownerTag: str(r.owner_tag),
    ownerNumber: r.owner_number === null || r.owner_number === undefined ? null : num(r.owner_number),
    buildingType: str(r.building_type),
    buildingName: str(r.building_name),
    buildingLevel: num(r.building_level),
    lastIncomeClaimAt: str(r.last_income_claim_at),
    purchasedAt: str(r.purchased_at),
  };
}

export function mapNews(r: Row): NewsItem {
  return { id: num(r.id), category: r.category, message: r.message, citizenId: str(r.citizen_id), createdAt: r.created_at };
}

export function mapPoll(r: Row): Poll {
  return {
    id: r.id,
    question: r.question,
    kind: r.kind,
    status: r.status,
    options: (r.options ?? []).map((o: Row) => ({ id: o.id, label: o.label, votes: num(o.votes) })),
    totalVotes: num(r.total_votes),
    createdByCitizenId: str(r.created_by_citizen_id),
    createdByTag: str(r.created_by_tag),
    createdAt: r.created_at,
    myVote: str(r.my_vote),
  };
}

export function mapLeaderboard(r: Row): LeaderboardRow {
  return { rank: num(r.rank), citizen: mapCitizen(r.citizen), plotsCount: num(r.plots_count), totalLevels: num(r.total_levels) };
}

export function mapDonor(r: Row): DonorRow {
  return { citizenId: r.citizen_id, tag: r.tag, amount: num(r.amount) };
}
