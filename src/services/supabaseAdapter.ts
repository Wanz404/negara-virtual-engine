import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { WorldConfig } from '../configs/types';
import { mapCitizen, mapDonor, mapLeaderboard, mapMyCitizen, mapNews, mapPlot, mapPoll, mapWorld } from './mappers';
import {
  ApiError,
  type NationApi,
  type PresenceIdentity,
  type PresenceMember,
  type RegisterInput,
  type Session,
} from './types';

const WORLD_COLUMNS =
  'world_id, ig_account_handle, last_citizen_number, day_number, ig_follower_count, followers_synced_at, current_ring_unlocked, active_project_id, active_project_funding, active_project_goal, active_project_completed, completed_projects, president_announcement, announcement_at, updated_at';

const PLOT_COLUMNS =
  'id, plot_code, ring_level, grid_x, grid_y, price, owner_citizen_id, owner_tag, owner_number, building_type, building_name, building_level, last_income_claim_at, purchased_at';

export interface SupabaseAdapterOptions {
  url: string;
  anonKey: string;
  registerVia: 'edge' | 'rpc';
}

export function createSupabaseAdapter(config: WorldConfig, opts: SupabaseAdapterOptions): NationApi {
  const sb: SupabaseClient = createClient(opts.url, opts.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 2 } },
  });
  const W = config.worldId;

  async function rpc<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new ApiError(error.message);
    if (data && typeof data === 'object' && (data as { ok?: boolean }).ok === false) {
      throw new ApiError(String((data as { error?: string }).error ?? 'Ditolak.'));
    }
    return data as T;
  }

  const auth = (s: Session) => ({ p_world_id: W, p_citizen_id: s.citizenId, p_token: s.token });

  const api: NationApi = {
    mode: 'supabase',

    async getWorldState() {
      const { data, error } = await sb.from('world_states').select(WORLD_COLUMNS).eq('world_id', W).maybeSingle();
      if (error) throw new ApiError(error.message);
      if (!data) throw new ApiError(`Dunia "${W}" belum di-seed. Jalankan supabase/seed.sql di Supabase.`);
      return mapWorld(data);
    },

    async getNews(limit = 30) {
      const { data, error } = await sb
        .from('news_feed')
        .select('id, category, message, citizen_id, created_at')
        .eq('world_id', W)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw new ApiError(error.message);
      return (data ?? []).map(mapNews);
    },

    async getMapCitizens(meId = null, limit = 120) {
      const data = await rpc<any[]>('get_map_citizens', { p_world_id: W, p_me: meId, p_limit: limit });
      return (data ?? []).map(mapCitizen);
    },

    async getPlots(rings) {
      if (rings.length === 0) return [];
      const { data, error } = await sb.from('land_plots').select(PLOT_COLUMNS).eq('world_id', W).in('ring_level', rings);
      if (error) throw new ApiError(error.message);
      return (data ?? []).map(mapPlot);
    },

    async getOwnedPlots(rings) {
      if (rings.length === 0) return [];
      const { data, error } = await sb
        .from('land_plots')
        .select(PLOT_COLUMNS)
        .eq('world_id', W)
        .in('ring_level', rings)
        .not('owner_citizen_id', 'is', null);
      if (error) throw new ApiError(error.message);
      return (data ?? []).map(mapPlot);
    },

    async getLeaderboard(tab, offset, limit, search) {
      const data = await rpc<any[]>('get_leaderboard', {
        p_world_id: W,
        p_tab: tab,
        p_offset: offset,
        p_limit: limit,
        p_search: search?.trim() || null,
      });
      return (data ?? []).map(mapLeaderboard);
    },

    async getMyRanks(citizenId) {
      const r = await rpc('get_my_ranks', { p_world_id: W, p_citizen_id: citizenId });
      return { citizenNumber: r.citizen_number, wealthRank: r.wealth_rank, landlordRank: r.landlord_rank ?? null };
    },

    async getProjectTopDonors(projectId, limit = 10) {
      const data = await rpc<any[]>('get_project_top_donors', { p_world_id: W, p_project_id: projectId, p_limit: limit });
      return (data ?? []).map(mapDonor);
    },

    async getActivePolls(session) {
      const data = await rpc<any[]>('get_active_polls', {
        p_world_id: W,
        p_citizen_id: session?.citizenId ?? null,
        p_token: session?.token ?? null,
      });
      return (data ?? []).map(mapPoll);
    },

    async register(input: RegisterInput) {
      let raw: any;
      if (opts.registerVia === 'edge') {
        const res = await fetch(`${opts.url}/functions/v1/register-citizen`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: opts.anonKey,
            Authorization: `Bearer ${opts.anonKey}`,
          },
          body: JSON.stringify({
            worldId: W,
            username: input.username,
            igUsername: input.igUsername,
            avatarColor: input.avatarColor,
            avatarStyle: input.avatarStyle,
            turnstileToken: input.turnstileToken ?? '',
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new ApiError(body.error ?? `Pendaftaran gagal (HTTP ${res.status}).`);
        raw = body.citizen;
      } else {
        raw = await rpc('register_citizen_direct', {
          p_world_id: W,
          p_username: input.username,
          p_ig_username: input.igUsername,
          p_avatar_color: input.avatarColor,
          p_avatar_style: input.avatarStyle,
        });
      }
      return { citizen: mapMyCitizen(raw), session: { citizenId: raw.id, token: raw.secret_token } };
    },

    async getMe(session) {
      try {
        return mapMyCitizen(await rpc('get_my_citizen', auth(session)));
      } catch (e) {
        if (e instanceof ApiError && e.message.includes('Sesi warga tidak valid')) return null;
        throw e;
      }
    },

    async recoverSession(ktpCode, pin) {
      const r = await rpc('recover_session', { p_world_id: W, p_ktp_code: ktpCode, p_pin: pin });
      return { citizenId: r.citizen_id, token: r.secret_token };
    },

    async setRecoveryPin(session, pin) {
      await rpc('set_recovery_pin', { ...auth(session), p_pin: pin });
    },

    async updateInstagram(session, igUsername) {
      return mapMyCitizen(await rpc('update_citizen_instagram', { ...auth(session), p_new_ig_username: igUsername }));
    },

    async requestFollowRecheck(session) {
      return mapMyCitizen(await rpc('request_follow_recheck', auth(session)));
    },

    async claimWork(session) {
      const r = await rpc('claim_work_reward', auth(session));
      return { reward: Number(r.reward), coins: Number(r.coins), label: r.label, lastWorkAt: r.last_work_at };
    },

    async postStatus(session, text) {
      return mapMyCitizen(await rpc('post_status', { ...auth(session), p_text: text }));
    },

    async buyPlot(session, plotCode) {
      const r = await rpc('buy_land_plot', { ...auth(session), p_plot_code: plotCode });
      return { plot: mapPlot(r.plot), coins: Number(r.coins) };
    },

    async buildOrUpgrade(session, plotCode, buildingType = null, buildingName = null) {
      const r = await rpc('build_or_upgrade_property', {
        ...auth(session),
        p_plot_code: plotCode,
        p_building_type: buildingType,
        p_building_name: buildingName,
      });
      return { plot: mapPlot(r.plot), coins: Number(r.coins), cost: Number(r.cost) };
    },

    async renameProperty(session, plotCode, buildingName) {
      return mapPlot(await rpc('rename_property', { ...auth(session), p_plot_code: plotCode, p_building_name: buildingName }));
    },

    async claimPropertyIncome(session, plotCode = null) {
      const r = await rpc('claim_property_income', { ...auth(session), p_plot_code: plotCode });
      return { total: Number(r.total), coins: Number(r.coins) };
    },

    async donateToProject(session, amount) {
      const r = await rpc('donate_to_project', { ...auth(session), p_amount: amount });
      return { coins: Number(r.coins), world: mapWorld(r.world), completedProjectId: r.completed_project_id ?? null };
    },

    async castVote(session, pollId, optionId) {
      return mapPoll(await rpc('cast_poll_vote', { ...auth(session), p_poll_id: pollId, p_option_id: optionId }));
    },

    async postAnnouncement(session, text) {
      return mapWorld(await rpc('post_announcement', { ...auth(session), p_text: text }));
    },

    async proposePoll(session, question, options) {
      return mapPoll(await rpc('propose_poll', { ...auth(session), p_question: question, p_options: options }));
    },

    // --- Admin ---
    async adminLogin(secret) {
      try {
        await rpc('admin_login', { p_world_id: W, p_admin_secret: secret });
        return true;
      } catch {
        return false;
      }
    },

    async adminUpdateWorld(secret, patch) {
      const r = await rpc('admin_update_world', {
        p_world_id: W,
        p_admin_secret: secret,
        p_day_number: patch.dayNumber ?? null,
        p_follower_count: patch.igFollowerCount ?? null,
        p_allow_direct_registration: patch.allowDirectRegistration ?? null,
      });
      return mapWorld(r.world);
    },

    async adminGetFollowQueue(secret) {
      const r = await rpc('admin_get_follow_queue', { p_world_id: W, p_admin_secret: secret });
      return { snapshotAt: r.snapshot_at, usernames: r.usernames ?? [] };
    },

    async adminBatchVerify(secret, followerUsernames, totalFollowers, snapshotAt, markUnfollowers = false) {
      const r = await rpc('batch_verify_followers', {
        p_world_id: W,
        p_admin_secret: secret,
        p_follower_usernames: followerUsernames,
        p_total_ig_followers: totalFollowers,
        p_snapshot_at: snapshotAt,
        p_mark_unfollowers: markUnfollowers,
      });
      return { verified: r.verified, notFollowing: r.not_following, unfollowed: r.unfollowed, syncedAt: r.synced_at };
    },

    async adminImpeach(secret) {
      const r = await rpc('impeach_unverified_elites', { p_world_id: W, p_admin_secret: secret });
      return {
        impeached: (r.impeached ?? []).map((x: any) => ({ citizenId: x.citizen_id, tag: x.tag, roleTitle: x.role_title })),
      };
    },

    async adminRestoreCitizen(secret, citizenId) {
      await rpc('admin_restore_citizen', { p_world_id: W, p_admin_secret: secret, p_citizen_id: citizenId });
    },

    async adminCreatePoll(secret, question, options, kind) {
      const r = await rpc('admin_create_poll', {
        p_world_id: W,
        p_admin_secret: secret,
        p_question: question,
        p_options: options,
        p_kind: kind,
      });
      return mapPoll(r.poll);
    },

    async adminListPendingPolls(secret) {
      const r = await rpc('admin_list_pending_polls', { p_world_id: W, p_admin_secret: secret });
      return (r.polls ?? []).map(mapPoll);
    },

    async adminModeratePoll(secret, pollId, action) {
      await rpc('admin_moderate_poll', { p_world_id: W, p_admin_secret: secret, p_poll_id: pollId, p_action: action });
    },

    async adminModerateContent(secret, target, id) {
      await rpc('admin_moderate_content', { p_world_id: W, p_admin_secret: secret, p_target: target, p_id: id });
    },

    async adminSetActiveProject(secret, projectId, resetFunding) {
      const r = await rpc('admin_set_active_project', {
        p_world_id: W,
        p_admin_secret: secret,
        p_project_id: projectId,
        p_reset_funding: resetFunding,
      });
      return mapWorld(r.world);
    },

    // --- Realtime Presence: ephemeral, tidak memakan kuota write database ---
    joinPresence(me: PresenceIdentity, onSync: (members: PresenceMember[]) => void) {
      const key = me.citizenId ?? `guest:${me.tag}`;
      const channel: RealtimeChannel = sb.channel(`presence:${W}`, { config: { presence: { key } } });

      const emit = () => {
        const state = channel.presenceState<PresenceMember>();
        const members: PresenceMember[] = [];
        for (const [k, metas] of Object.entries(state)) {
          const m = metas[0];
          if (m) members.push({ key: k, kind: m.kind, tag: m.tag, citizenId: m.citizenId ?? null, color: m.color, onlineAt: m.onlineAt });
        }
        members.sort((a, b) => a.onlineAt.localeCompare(b.onlineAt));
        onSync(members);
      };

      channel
        .on('presence', { event: 'sync' }, emit)
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await channel.track({ ...me, onlineAt: new Date().toISOString() });
          }
        });

      return () => {
        void channel.untrack();
        void sb.removeChannel(channel);
      };
    },
  };

  return api;
}
