-- =============================================================================
-- DEPLOY_ALL_SQL.sql — GENERATED oleh scripts/bundle-sql.mjs. Jalankan SEKALI di Supabase SQL Editor.
-- Isi: 001_init.sql, 002_worker_checks.sql + seed.sql (10 dunia, 0 warga). Aman diulang (idempotent).
-- =============================================================================

-- >>> migrations/001_init.sql
-- =============================================================================
-- NEGARA VIRTUAL — Multi-Tenant Virtual Nation Platform
-- Migration 001: skema inti, RPC atomik STRICT FCFS, verifikasi follow 1x24 jam,
--                kavling tanah & properti, proyek nasional, sidang warga, RLS.
--
-- Prinsip keamanan:
--   * Client (anon key) hanya boleh SELECT kolom publik. Semua mutasi lewat RPC
--     SECURITY DEFINER yang memvalidasi secret_token (warga) atau ADMIN_SECRET (admin).
--   * secret_token, ip_hash, recovery PIN TIDAK PERNAH bisa dibaca anon.
--   * Aturan game (kasta, harga, cooldown) dibaca dari world_states.config (JSONB)
--     yang di-seed dari src/configs/worlds/*.ts lewat `npm run db:seed`.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- -----------------------------------------------------------------------------
-- 1. TABEL
-- -----------------------------------------------------------------------------

-- Counter atomik & state global per dunia (STRICT FCFS + sinkronisasi follower)
CREATE TABLE IF NOT EXISTS public.world_states (
  world_id TEXT PRIMARY KEY CHECK (world_id ~ '^[a-z0-9-]{2,40}$'),
  display_name TEXT NOT NULL DEFAULT '',
  ig_account_handle TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_citizen_number INTEGER NOT NULL DEFAULT 0,
  day_number INTEGER NOT NULL DEFAULT 1,
  ig_follower_count INTEGER NOT NULL DEFAULT 0,
  followers_synced_at TIMESTAMPTZ,
  current_ring_unlocked INTEGER NOT NULL DEFAULT 1,
  active_project_id TEXT NOT NULL DEFAULT '',
  active_project_funding BIGINT NOT NULL DEFAULT 0,
  active_project_goal BIGINT NOT NULL DEFAULT 0,
  active_project_completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_projects TEXT[] NOT NULL DEFAULT '{}',
  president_announcement TEXT NOT NULL DEFAULT '',
  announcement_by_citizen_id UUID,
  announcement_at TIMESTAMPTZ,
  allow_direct_registration BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rahasia admin & worker (hash bcrypt). Tidak bisa dibaca siapa pun selain postgres/service_role.
CREATE TABLE IF NOT EXISTS public.world_secrets (
  world_id TEXT PRIMARY KEY REFERENCES public.world_states(world_id) ON DELETE CASCADE,
  admin_secret_hash TEXT,
  sync_secret_hash TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Daftar kata kasar (sudah dinormalisasi, lihat nv_normalize_filter). Di-seed dari seed.sql.
CREATE TABLE IF NOT EXISTS public.profanity_words (
  word TEXT PRIMARY KEY
);

-- Warga terdaftar + status verifikasi follow IG
CREATE TABLE IF NOT EXISTS public.citizens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id TEXT NOT NULL REFERENCES public.world_states(world_id) ON DELETE CASCADE,
  citizen_number INTEGER NOT NULL CHECK (citizen_number > 0),
  ktp_code TEXT NOT NULL,
  username TEXT NOT NULL,                -- nama tampilan di peta & KTP
  ig_username TEXT NOT NULL CHECK (ig_username ~ '^[a-z0-9._]{1,30}$'), -- lowercase tanpa '@'
  follow_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (follow_status IN ('pending', 'verified', 'not_following', 'recheck_requested', 'impeached')),
  follow_checked_at TIMESTAMPTZ,
  follow_recheck_requested_at TIMESTAMPTZ,
  ig_changed_at TIMESTAMPTZ,
  joined_day INTEGER NOT NULL DEFAULT 1,
  rt_rw_address TEXT NOT NULL DEFAULT 'RT 01 / RW 01',
  secret_token UUID NOT NULL DEFAULT gen_random_uuid(),
  recovery_pin_hash TEXT,
  recovery_failed_attempts INTEGER NOT NULL DEFAULT 0,
  recovery_locked_until TIMESTAMPTZ,
  avatar_color TEXT NOT NULL DEFAULT '#ef4444' CHECK (avatar_color ~ '^#[0-9a-fA-F]{6}$'),
  avatar_style JSONB NOT NULL DEFAULT '{}'::jsonb,
  tier_id TEXT NOT NULL,
  role_title TEXT NOT NULL,
  original_tier_id TEXT,
  original_role_title TEXT,
  impeached_at TIMESTAMPTZ,
  coins BIGINT NOT NULL DEFAULT 0 CHECK (coins >= 0),
  total_donated BIGINT NOT NULL DEFAULT 0,
  status_text TEXT NOT NULL DEFAULT '',
  last_work_at TIMESTAMPTZ,
  last_status_at TIMESTAMPTZ,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (world_id, citizen_number),
  UNIQUE (world_id, ktp_code),
  UNIQUE (world_id, ig_username)
);

CREATE INDEX IF NOT EXISTS idx_citizens_world_coins ON public.citizens (world_id, coins DESC, citizen_number);
CREATE INDEX IF NOT EXISTS idx_citizens_world_active ON public.citizens (world_id, last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_citizens_world_iphash ON public.citizens (world_id, ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_citizens_follow_queue ON public.citizens (world_id, follow_status)
  WHERE follow_status IN ('pending', 'recheck_requested', 'not_following');

ALTER TABLE public.world_states
  DROP CONSTRAINT IF EXISTS world_states_announcement_by_fk;
ALTER TABLE public.world_states
  ADD CONSTRAINT world_states_announcement_by_fk
  FOREIGN KEY (announcement_by_citizen_id) REFERENCES public.citizens(id) ON DELETE SET NULL;

-- Kavling tanah & bangunan warga (dibuat prosedural per ring oleh nv_ensure_plots)
CREATE TABLE IF NOT EXISTS public.land_plots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id TEXT NOT NULL REFERENCES public.world_states(world_id) ON DELETE CASCADE,
  plot_code TEXT NOT NULL,             -- cth: "R1-A004"
  ring_level INTEGER NOT NULL,
  grid_x INTEGER NOT NULL,
  grid_y INTEGER NOT NULL,
  price BIGINT NOT NULL,
  owner_citizen_id UUID REFERENCES public.citizens(id) ON DELETE SET NULL,
  owner_tag TEXT,                      -- "Novi | 001" (denormalisasi untuk papan nama)
  owner_number INTEGER,
  building_type TEXT,
  building_name TEXT,
  building_level INTEGER NOT NULL DEFAULT 0 CHECK (building_level BETWEEN 0 AND 10),
  last_income_claim_at TIMESTAMPTZ,
  purchased_at TIMESTAMPTZ,
  UNIQUE (world_id, plot_code),
  UNIQUE (world_id, grid_x, grid_y)
);

CREATE INDEX IF NOT EXISTS idx_plots_world_ring ON public.land_plots (world_id, ring_level);
CREATE INDEX IF NOT EXISTS idx_plots_owner ON public.land_plots (world_id, owner_citizen_id);

-- Berita / log aktivitas (Breaking News TV)
CREATE TABLE IF NOT EXISTS public.news_feed (
  id BIGSERIAL PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES public.world_states(world_id) ON DELETE CASCADE,
  citizen_id UUID REFERENCES public.citizens(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'status'
    CHECK (category IN ('join', 'status', 'property', 'project', 'decree', 'impeachment', 'verification', 'expansion', 'poll', 'system')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_world_time ON public.news_feed (world_id, created_at DESC);

-- Sidang Warga (voting kebijakan / proyek)
CREATE TABLE IF NOT EXISTS public.polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id TEXT NOT NULL REFERENCES public.world_states(world_id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'policy' CHECK (kind IN ('policy', 'project')),
  options JSONB NOT NULL,              -- [{"id":"a","label":"..."}]  (jumlah suara dihitung dari poll_votes)
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'closed', 'rejected')),
  created_by_citizen_id UUID REFERENCES public.citizens(id) ON DELETE SET NULL,
  closes_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_polls_world_status ON public.polls (world_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.poll_votes (
  poll_id UUID NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  citizen_id UUID NOT NULL REFERENCES public.citizens(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (poll_id, citizen_id)
);

CREATE INDEX IF NOT EXISTS idx_poll_votes_option ON public.poll_votes (poll_id, option_id);

-- Leaderboard penyumbang proyek nasional
CREATE TABLE IF NOT EXISTS public.project_donations (
  world_id TEXT NOT NULL REFERENCES public.world_states(world_id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  citizen_id UUID NOT NULL REFERENCES public.citizens(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (world_id, project_id, citizen_id)
);

CREATE INDEX IF NOT EXISTS idx_donations_rank ON public.project_donations (world_id, project_id, amount DESC);

-- -----------------------------------------------------------------------------
-- 2. HELPER MURNI (cermin dari src/lib/game.ts & src/lib/profanity.ts)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.nv_pad(p_n BIGINT, p_width INTEGER)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT lpad(p_n::text, greatest(p_width, length(p_n::text)), '0')
$$;

-- "Novi | 001", "Raka | 1000"
CREATE OR REPLACE FUNCTION public.nv_tag(p_name TEXT, p_number INTEGER)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT p_name || ' | ' || CASE WHEN p_number < 1000 THEN lpad(p_number::text, 3, '0') ELSE p_number::text END
$$;

CREATE OR REPLACE FUNCTION public.nv_number_hash(p_n BIGINT)
RETURNS BIGINT LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_n * 2654435761) % 4294967296
$$;

CREATE OR REPLACE FUNCTION public.nv_normalize_filter(p_text TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
           regexp_replace(translate(lower(coalesce(p_text, '')), '0134578@$!', 'oieastbasi'), '[^a-z]', '', 'g'),
           '(.)\1+', '\1', 'g')
$$;

CREATE OR REPLACE FUNCTION public.nv_contains_profanity(p_text TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profanity_words w
    WHERE strpos(public.nv_normalize_filter(p_text), w.word) > 0
  )
$$;

-- Karakter terlarang di teks bebas (kontrol, < > { } [ ] \ | ` ")
CREATE OR REPLACE FUNCTION public.nv_has_bad_chars(p_text TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(p_text, '') ~ '[[:cntrl:]<>{}|`"\[\]\\]'
$$;

CREATE OR REPLACE FUNCTION public.nv_clean_text(p_text TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.nv_fmt_wait(p_wait INTERVAL)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_s INTEGER := greatest(0, ceil(extract(epoch FROM p_wait))::int);
  v_m INTEGER;
BEGIN
  IF v_s < 60 THEN RETURN v_s || ' detik'; END IF;
  v_m := ceil(v_s / 60.0)::int;
  IF v_m < 60 THEN RETURN v_m || ' menit'; END IF;
  RETURN (v_m / 60) || ' jam' || CASE WHEN v_m % 60 > 0 THEN ' ' || (v_m % 60) || ' menit' ELSE '' END;
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_assert_ig_username(p_ig TEXT)
RETURNS VOID LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_ig IS NULL OR p_ig = '' THEN
    RAISE EXCEPTION 'Username Instagram wajib diisi.';
  END IF;
  IF p_ig !~ '^[a-z0-9._]{1,30}$' THEN
    RAISE EXCEPTION 'Username Instagram hanya boleh huruf, angka, titik, dan garis bawah (maks. 30).';
  END IF;
  IF left(p_ig, 1) = '.' OR right(p_ig, 1) = '.' THEN
    RAISE EXCEPTION 'Username Instagram tidak boleh diawali/diakhiri titik.';
  END IF;
  IF strpos(p_ig, '..') > 0 THEN
    RAISE EXCEPTION 'Username Instagram tidak boleh berisi dua titik berturut-turut.';
  END IF;
END;
$$;

-- Tier berdasarkan nomor urut
CREATE OR REPLACE FUNCTION public.nv_resolve_tier(p_config JSONB, p_n INTEGER)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT t FROM jsonb_array_elements(coalesce(p_config->'tiers', '[]'::jsonb)) t
  WHERE (t->>'min')::int <= p_n
    AND (t->'max' IS NULL OR jsonb_typeof(t->'max') = 'null' OR (t->>'max')::int >= p_n)
  ORDER BY (t->>'min')::int DESC
  LIMIT 1
$$;

-- Jabatan: kursi tetap (seatTitles) → pool via hash → nama tier
CREATE OR REPLACE FUNCTION public.nv_resolve_title(p_tier JSONB, p_n INTEGER)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_offset INTEGER := p_n - (p_tier->>'min')::int;
  v_seats JSONB := coalesce(p_tier->'seatTitles', '[]'::jsonb);
  v_pool JSONB := coalesce(p_tier->'titlePool', '[]'::jsonb);
BEGIN
  IF v_offset >= 0 AND v_offset < jsonb_array_length(v_seats) THEN
    RETURN v_seats->>v_offset;
  END IF;
  IF jsonb_array_length(v_pool) > 0 THEN
    RETURN v_pool->>((public.nv_number_hash(p_n) % jsonb_array_length(v_pool))::int);
  END IF;
  RETURN p_tier->>'name';
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_find_tier(p_config JSONB, p_tier_id TEXT)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(
    (SELECT t FROM jsonb_array_elements(coalesce(p_config->'tiers', '[]'::jsonb)) t WHERE t->>'id' = p_tier_id LIMIT 1),
    CASE WHEN p_config->'impeachedTier'->>'id' = p_tier_id THEN p_config->'impeachedTier' END,
    (SELECT t FROM jsonb_array_elements(coalesce(p_config->'tiers', '[]'::jsonb)) WITH ORDINALITY x(t, i) ORDER BY i DESC LIMIT 1)
  )
$$;

CREATE OR REPLACE FUNCTION public.nv_tier_perk(p_config JSONB, p_tier_id TEXT, p_perk TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce((public.nv_find_tier(p_config, p_tier_id)->'perks'->>p_perk)::boolean, false)
$$;

CREATE OR REPLACE FUNCTION public.nv_tier_perk_num(p_config JSONB, p_tier_id TEXT, p_perk TEXT)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce((public.nv_find_tier(p_config, p_tier_id)->'perks'->>p_perk)::numeric, 0)
$$;

CREATE OR REPLACE FUNCTION public.nv_econ_num(p_config JSONB, p_key TEXT, p_default NUMERIC)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce((p_config->'economy'->>p_key)::numeric, p_default)
$$;

-- Ring milestone: ring ke-(index+1) terbuka saat populasi >= nilai ini
CREATE OR REPLACE FUNCTION public.nv_milestone(p_config JSONB, p_index INTEGER)
RETURNS BIGINT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_arr JSONB := coalesce(p_config->'map'->'ringMilestones', '[0, 100, 500]'::jsonb);
  v_len INTEGER := jsonb_array_length(v_arr);
  v_last BIGINT;
BEGIN
  IF p_index < v_len THEN
    RETURN (v_arr->>p_index)::bigint;
  END IF;
  v_last := greatest((v_arr->>(v_len - 1))::bigint, 1);
  RETURN (v_last * power(2, p_index - v_len + 1))::bigint;
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_rings_for_population(p_config JSONB, p_pop BIGINT)
RETURNS INTEGER LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_r INTEGER := 1;
BEGIN
  WHILE v_r < 60 AND public.nv_milestone(p_config, v_r) <= p_pop LOOP
    v_r := v_r + 1;
  END LOOP;
  RETURN v_r;
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_ring_name(p_config JSONB, p_ring INTEGER)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(
    p_config->'map'->'ringNames'->>p_ring,
    replace(coalesce(p_config->'map'->>'ringNameFallback', 'Ring {n}'), '{n}', p_ring::text)
  )
$$;

CREATE OR REPLACE FUNCTION public.nv_plot_price(p_config JSONB, p_ring INTEGER, p_layer INTEGER)
RETURNS BIGINT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_land JSONB := coalesce(p_config->'economy'->'land', '{}'::jsonb);
  v_base NUMERIC := coalesce((v_land->>'basePrice')::numeric, 200);
  v_decay NUMERIC := coalesce((v_land->>'ringDecayPct')::numeric, 25);
  v_min NUMERIC := coalesce((v_land->>'minPrice')::numeric, 50);
  v_inner NUMERIC := coalesce((v_land->>'innerLayerBonusPct')::numeric, 20);
  v_price NUMERIC;
BEGIN
  v_price := greatest(v_min, v_base * power(1 - v_decay / 100, p_ring - 1));
  IF p_layer = 0 THEN
    v_price := v_price * (1 + v_inner / 100);
  END IF;
  RETURN (round(v_price / 5) * 5)::bigint;
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_find_building(p_config JSONB, p_type TEXT)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT b FROM jsonb_array_elements(coalesce(p_config->'buildings', '[]'::jsonb)) b WHERE b->>'id' = p_type LIMIT 1
$$;

-- Pendapatan pasif terkumpul (floor), dibatasi maxAccrualHours
CREATE OR REPLACE FUNCTION public.nv_property_income(
  p_config JSONB, p_building JSONB, p_level INTEGER, p_last TIMESTAMPTZ, p_bonus_pct NUMERIC
) RETURNS BIGINT LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_last IS NULL OR p_level <= 0 OR p_building IS NULL THEN 0
    ELSE floor(
      (p_building->>'incomePerLevelPerDay')::numeric * p_level
      * least(
          coalesce((p_config->'economy'->'income'->>'maxAccrualHours')::numeric, 24),
          greatest(0, extract(epoch FROM (now() - p_last)) / 3600)
        ) / 24
      * (1 + coalesce(p_bonus_pct, 0) / 100)
    )::bigint
  END
$$;

-- -----------------------------------------------------------------------------
-- 3. HELPER INTERNAL (akses tabel)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.nv_citizen_public(p_c public.citizens)
RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT to_jsonb(p_c) - ARRAY[
    'secret_token', 'ip_hash', 'recovery_pin_hash', 'recovery_failed_attempts',
    'recovery_locked_until', 'follow_recheck_requested_at', 'ig_changed_at', 'original_tier_id'
  ]
$$;

CREATE OR REPLACE FUNCTION public.nv_citizen_private(p_c public.citizens)
RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT (to_jsonb(p_c) - ARRAY['secret_token', 'ip_hash', 'recovery_pin_hash', 'recovery_failed_attempts', 'recovery_locked_until'])
         || jsonb_build_object('has_recovery_pin', p_c.recovery_pin_hash IS NOT NULL)
$$;

CREATE OR REPLACE FUNCTION public.nv_world_json(p_w public.world_states)
RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT to_jsonb(p_w) - 'config'
$$;

CREATE OR REPLACE FUNCTION public.nv_news(p_world_id TEXT, p_citizen_id UUID, p_category TEXT, p_message TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO public.news_feed (world_id, citizen_id, category, message)
  VALUES (p_world_id, p_citizen_id, p_category, left(p_message, 280))
$$;

-- Validasi sesi warga (citizen_id + secret_token). Default: kunci baris (FOR UPDATE).
CREATE OR REPLACE FUNCTION public.nv_auth_citizen(p_world_id TEXT, p_citizen_id UUID, p_token UUID, p_lock BOOLEAN DEFAULT TRUE)
RETURNS public.citizens LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v public.citizens;
BEGIN
  IF p_lock THEN
    SELECT * INTO v FROM public.citizens
    WHERE id = p_citizen_id AND world_id = p_world_id AND secret_token = p_token
    FOR UPDATE;
  ELSE
    SELECT * INTO v FROM public.citizens
    WHERE id = p_citizen_id AND world_id = p_world_id AND secret_token = p_token;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sesi warga tidak valid. Masuk ulang lewat "Masuk KTP" dengan Kode Pemulihan.';
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_get_world(p_world_id TEXT)
RETURNS public.world_states LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v public.world_states;
BEGIN
  SELECT * INTO v FROM public.world_states WHERE world_id = p_world_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dunia "%" tidak ditemukan. Jalankan supabase/seed.sql dulu.', p_world_id;
  END IF;
  RETURN v;
END;
$$;

-- Gerbang hak akses berbasis status follow (pending / not_following / impeached dikunci)
CREATE OR REPLACE FUNCTION public.nv_require_verified(p_world public.world_states, p_c public.citizens, p_action TEXT)
RETURNS VOID LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF coalesce((p_world.config->'economy'->'requireVerified'->>p_action)::boolean, TRUE)
     AND p_c.follow_status <> 'verified' THEN
    IF p_c.follow_status = 'impeached' THEN
      RAISE EXCEPTION 'Akses terkunci: kamu sudah dimakzulkan. Hubungi admin untuk pemulihan status.';
    ELSIF p_c.follow_status = 'not_following' THEN
      RAISE EXCEPTION 'Akun @% belum terdeteksi follow @%. Follow dulu lalu klik Cek Ulang atau Ganti Instagram.',
        p_c.ig_username, p_world.ig_account_handle;
    ELSE
      RAISE EXCEPTION 'Fitur ini terbuka setelah kamu resmi dilantik (verifikasi follow @% otomatis maks. 1x24 jam).',
        p_world.ig_account_handle;
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_assert_cooldown(p_last TIMESTAMPTZ, p_minutes NUMERIC, p_message TEXT)
RETURNS VOID LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_next TIMESTAMPTZ;
BEGIN
  IF p_last IS NULL OR p_minutes <= 0 THEN RETURN; END IF;
  v_next := p_last + p_minutes * INTERVAL '1 minute';
  IF v_next > now() THEN
    RAISE EXCEPTION '% Coba lagi dalam %.', p_message, public.nv_fmt_wait(v_next - now());
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_assert_free_text(p_text TEXT, p_max INTEGER, p_label TEXT)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_text IS NULL OR p_text = '' THEN
    RAISE EXCEPTION '% tidak boleh kosong.', p_label;
  END IF;
  IF char_length(p_text) > p_max THEN
    RAISE EXCEPTION '% maksimal % karakter.', p_label, p_max;
  END IF;
  IF public.nv_has_bad_chars(p_text) THEN
    RAISE EXCEPTION '% mengandung karakter yang tidak diizinkan.', p_label;
  END IF;
  IF public.nv_contains_profanity(p_text) THEN
    RAISE EXCEPTION '% mengandung kata yang tidak diizinkan.', p_label;
  END IF;
END;
$$;

-- Generator kavling prosedural: ring r berisi lapis berjarak Chebyshev d, 8·d kavling per lapis,
-- urut searah jarum jam dari pojok kiri atas (identik dengan generateRingPlots() di game.ts).
CREATE OR REPLACE FUNCTION public.nv_ensure_plots(p_world_id TEXT, p_upto_ring INTEGER)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_config JSONB;
  v_core INTEGER;
  v_layers INTEGER;
  v_ring INTEGER;
  v_layer INTEGER;
  v_d INTEGER;
  v_inserted INTEGER;
  v_total INTEGER := 0;
BEGIN
  SELECT config INTO v_config FROM public.world_states WHERE world_id = p_world_id;
  v_core := coalesce((v_config->'map'->>'coreRadius')::int, 3);
  v_layers := coalesce((v_config->'map'->>'layersPerRing')::int, 2);

  FOR v_ring IN 1..greatest(p_upto_ring, 1) LOOP
    IF EXISTS (SELECT 1 FROM public.land_plots WHERE world_id = p_world_id AND ring_level = v_ring) THEN
      CONTINUE;
    END IF;
    FOR v_layer IN 0..(v_layers - 1) LOOP
      v_d := v_core + (v_ring - 1) * v_layers + v_layer + 1;
      INSERT INTO public.land_plots (world_id, plot_code, ring_level, grid_x, grid_y, price)
      SELECT p_world_id,
             'R' || v_ring || '-' || chr(65 + v_layer) || public.nv_pad(s.idx, 3),
             v_ring, s.gx, s.gy,
             public.nv_plot_price(v_config, v_ring, v_layer)
      FROM (
        SELECT row_number() OVER (ORDER BY seg, ord) AS idx, gx, gy
        FROM (
          SELECT 1 AS seg, g AS ord, g AS gx, -v_d AS gy FROM generate_series(-v_d, v_d) g
          UNION ALL SELECT 2, g, v_d, g FROM generate_series(-v_d + 1, v_d) g
          UNION ALL SELECT 3, -g, g, v_d FROM generate_series(-v_d, v_d - 1) g
          UNION ALL SELECT 4, -g, -v_d, g FROM generate_series(-v_d + 1, v_d - 1) g
        ) perim
      ) s
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      v_total := v_total + v_inserted;
    END LOOP;
  END LOOP;
  RETURN v_total;
END;
$$;

-- Validasi admin. TIDAK raise agar counter percobaan gagal tetap tersimpan (lock 15 menit setelah 10x gagal).
CREATE OR REPLACE FUNCTION public.nv_admin_ok(p_world_id TEXT, p_secret TEXT, p_allow_sync BOOLEAN DEFAULT FALSE)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v public.world_secrets;
BEGIN
  SELECT * INTO v FROM public.world_secrets WHERE world_id = p_world_id FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF v.locked_until IS NOT NULL AND v.locked_until > now() THEN RETURN FALSE; END IF;

  IF p_secret IS NOT NULL AND p_secret <> '' AND (
       (v.admin_secret_hash IS NOT NULL AND extensions.crypt(p_secret, v.admin_secret_hash) = v.admin_secret_hash)
    OR (p_allow_sync AND v.sync_secret_hash IS NOT NULL AND extensions.crypt(p_secret, v.sync_secret_hash) = v.sync_secret_hash)
  ) THEN
    IF v.failed_attempts > 0 THEN
      UPDATE public.world_secrets SET failed_attempts = 0 WHERE world_id = p_world_id;
    END IF;
    RETURN TRUE;
  END IF;

  UPDATE public.world_secrets
  SET failed_attempts = CASE WHEN failed_attempts + 1 >= 10 THEN 0 ELSE failed_attempts + 1 END,
      locked_until = CASE WHEN failed_attempts + 1 >= 10 THEN now() + INTERVAL '15 minutes' ELSE locked_until END
  WHERE world_id = p_world_id;
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_denied()
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('ok', false, 'error', 'Akses admin ditolak (PIN salah, atau terkunci 15 menit setelah 10x gagal).')
$$;

CREATE OR REPLACE FUNCTION public.nv_poll_json(p_poll_id UUID, p_viewer UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'id', p.id,
    'question', p.question,
    'kind', p.kind,
    'status', p.status,
    'created_at', p.created_at,
    'created_by_citizen_id', p.created_by_citizen_id,
    'created_by_tag', (SELECT public.nv_tag(c.username, c.citizen_number) FROM public.citizens c WHERE c.id = p.created_by_citizen_id),
    'options', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', o->>'id',
        'label', o->>'label',
        'votes', (SELECT count(*) FROM public.poll_votes v WHERE v.poll_id = p.id AND v.option_id = o->>'id')
      ) ORDER BY x.ord), '[]'::jsonb)
      FROM jsonb_array_elements(p.options) WITH ORDINALITY x(o, ord)
    ),
    'total_votes', (SELECT count(*) FROM public.poll_votes v WHERE v.poll_id = p.id),
    'my_vote', (SELECT v.option_id FROM public.poll_votes v WHERE v.poll_id = p.id AND v.citizen_id = p_viewer)
  )
  FROM public.polls p WHERE p.id = p_poll_id
$$;

CREATE OR REPLACE FUNCTION public.nv_build_poll_options(p_options TEXT[])
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_out JSONB := '[]'::jsonb;
  v_label TEXT;
  v_i INTEGER := 0;
BEGIN
  IF p_options IS NULL OR cardinality(p_options) < 2 OR cardinality(p_options) > 4 THEN
    RAISE EXCEPTION 'Voting harus punya 2–4 pilihan.';
  END IF;
  FOREACH v_label IN ARRAY p_options LOOP
    v_label := public.nv_clean_text(v_label);
    PERFORM public.nv_assert_free_text(v_label, 40, 'Pilihan voting');
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', chr(97 + v_i), 'label', v_label));
    v_i := v_i + 1;
  END LOOP;
  RETURN v_out;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. PENDAFTARAN STRICT FIRST-COME, FIRST-SERVED
-- -----------------------------------------------------------------------------
-- Kunci: `UPDATE world_states SET last_citizen_number = last_citizen_number + 1 ... RETURNING`
-- mengambil row-lock pada baris dunia. Request paralel ANTRE di baris itu, sehingga nomor
-- tidak pernah kembar. Jika validasi apa pun gagal SETELAH increment, exception me-rollback
-- seluruh transaksi (termasuk increment) → nomor tidak pernah melompat.

CREATE OR REPLACE FUNCTION public.nv_register_citizen_core(
  p_world_id TEXT,
  p_username TEXT,
  p_ig_username TEXT,
  p_avatar_color TEXT,
  p_avatar_style JSONB,
  p_ip_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_world public.world_states;
  v_clean_ig TEXT;
  v_name TEXT;
  v_name_max INTEGER;
  v_max_per_ip INTEGER;
  v_next_num INTEGER;
  v_day_num INTEGER;
  v_rings_now INTEGER;
  v_tier JSONB;
  v_title TEXT;
  v_ktp TEXT;
  v_rt_rw TEXT;
  v_new_rings INTEGER;
  v_style JSONB := coalesce(p_avatar_style, '{}'::jsonb);
  v_citizen public.citizens;
BEGIN
  v_clean_ig := lower(btrim(btrim(coalesce(p_ig_username, '')), '@'));
  PERFORM public.nv_assert_ig_username(v_clean_ig);

  v_world := public.nv_get_world(p_world_id);

  IF v_clean_ig = lower(v_world.ig_account_handle) THEN
    RAISE EXCEPTION 'Gunakan akun Instagram pribadimu, bukan akun resmi negara.';
  END IF;

  v_name_max := coalesce((v_world.config->'registration'->>'displayNameMaxLength')::int, 16);
  v_name := public.nv_clean_text(p_username);
  IF v_name = '' THEN
    v_name := left(v_clean_ig, v_name_max);
  END IF;
  IF char_length(v_name) > v_name_max THEN
    RAISE EXCEPTION 'Nama tampilan maksimal % karakter.', v_name_max;
  END IF;
  IF public.nv_has_bad_chars(v_name) THEN
    RAISE EXCEPTION 'Nama tampilan mengandung karakter yang tidak diizinkan.';
  END IF;
  IF public.nv_contains_profanity(v_name) OR public.nv_contains_profanity(v_clean_ig) THEN
    RAISE EXCEPTION 'Nama atau username mengandung kata yang tidak diizinkan.';
  END IF;
  IF p_avatar_color IS NULL OR p_avatar_color !~ '^#[0-9a-fA-F]{6}$' THEN
    RAISE EXCEPTION 'Warna avatar tidak valid.';
  END IF;
  IF jsonb_typeof(v_style) <> 'object' OR length(v_style::text) > 400 THEN
    RAISE EXCEPTION 'Gaya avatar tidak valid.';
  END IF;

  -- 1) KUNCI baris counter dunia → antrean rapi, strict FCFS
  UPDATE public.world_states
  SET last_citizen_number = last_citizen_number + 1,
      updated_at = now()
  WHERE world_id = p_world_id
  RETURNING last_citizen_number, day_number, current_ring_unlocked
  INTO v_next_num, v_day_num, v_rings_now;

  -- 2) Cek duplikat & rate-limit SETELAH lock (sudah terserialisasi per dunia)
  IF EXISTS (SELECT 1 FROM public.citizens WHERE world_id = p_world_id AND ig_username = v_clean_ig) THEN
    RAISE EXCEPTION 'Username Instagram @% sudah terdaftar. Kalau itu akunmu, pakai "Masuk KTP".', v_clean_ig;
  END IF;

  v_max_per_ip := coalesce((v_world.config->'registration'->>'maxRegistrationsPerIp24h')::int, 2);
  IF p_ip_hash IS NOT NULL AND v_max_per_ip > 0 AND (
    SELECT count(*) FROM public.citizens
    WHERE world_id = p_world_id AND ip_hash = p_ip_hash AND created_at > now() - INTERVAL '24 hours'
  ) >= v_max_per_ip THEN
    RAISE EXCEPTION 'Batas pendaftaran dari jaringan ini sudah tercapai (maks. % per 24 jam).', v_max_per_ip;
  END IF;

  -- 3) Kasta & jabatan deterministik dari config dunia
  v_tier := public.nv_resolve_tier(v_world.config, v_next_num);
  IF v_tier IS NULL THEN
    RAISE EXCEPTION 'Config kasta dunia "%" kosong. Jalankan supabase/seed.sql.', p_world_id;
  END IF;
  v_title := public.nv_resolve_title(v_tier, v_next_num);

  v_ktp := coalesce(v_world.config->>'ktpPrefix', upper(left(p_world_id, 2))) || '-' || public.nv_pad(v_next_num, 4);
  v_rt_rw := 'RT ' || public.nv_pad(((v_next_num - 1) / 50) % 10 + 1, 2)
          || ' / RW ' || public.nv_pad((v_next_num - 1) / 500 + 1, 2)
          || ' • Ring ' || public.nv_rings_for_population(v_world.config, v_next_num - 1);

  -- 4) Insert warga (follow_status = 'pending' → antrean cek follow 1x24 jam)
  BEGIN
    INSERT INTO public.citizens (
      world_id, citizen_number, ktp_code, username, ig_username,
      follow_status, joined_day, rt_rw_address, avatar_color, avatar_style,
      tier_id, role_title, coins, ip_hash
    )
    VALUES (
      p_world_id, v_next_num, v_ktp, v_name, v_clean_ig,
      'pending', v_day_num, v_rt_rw, p_avatar_color, v_style,
      v_tier->>'id', v_title,
      coalesce((v_world.config->'economy'->>'startingCoins')::bigint, 20),
      p_ip_hash
    )
    RETURNING * INTO v_citizen;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Username Instagram @% sudah terdaftar.', v_clean_ig;
  END;

  -- 5) Ekspansi wilayah otomatis berdasarkan milestone populasi
  v_new_rings := public.nv_rings_for_population(v_world.config, v_next_num);
  IF v_new_rings > v_rings_now THEN
    UPDATE public.world_states SET current_ring_unlocked = v_new_rings
    WHERE world_id = p_world_id AND current_ring_unlocked < v_new_rings;
    PERFORM public.nv_ensure_plots(p_world_id, v_new_rings);
    PERFORM public.nv_news(p_world_id, NULL, 'expansion',
      format('EKSPANSI WILAYAH! %s (Ring %s) resmi dibuka — populasi tembus %s warga!',
             public.nv_ring_name(v_world.config, v_new_rings), v_new_rings, v_next_num));
  END IF;

  PERFORM public.nv_news(p_world_id, v_citizen.id, 'join',
    format('Selamat datang %s — %s!', public.nv_tag(v_citizen.username, v_citizen.citizen_number), v_citizen.role_title));

  RETURN public.nv_citizen_private(v_citizen) || jsonb_build_object('secret_token', v_citizen.secret_token);
END;
$$;

-- A. Dipanggil Edge Function `register-citizen` (service_role) SETELAH Turnstile lolos.
CREATE OR REPLACE FUNCTION public.register_citizen_atomic(
  p_world_id TEXT,
  p_username TEXT,
  p_ig_username TEXT,
  p_avatar_color TEXT,
  p_ip_hash TEXT,
  p_avatar_style JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.nv_register_citizen_core(p_world_id, p_username, p_ig_username, p_avatar_color, p_avatar_style, p_ip_hash)
$$;

-- A2. Jalur langsung (anon) tanpa Edge Function — HANYA aktif jika world_states.allow_direct_registration = true.
--     Rate-limit IP tetap berjalan memakai header permintaan yang diteruskan PostgREST.
CREATE OR REPLACE FUNCTION public.register_citizen_direct(
  p_world_id TEXT,
  p_username TEXT,
  p_ig_username TEXT,
  p_avatar_color TEXT,
  p_avatar_style JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_allowed BOOLEAN;
  v_headers JSON;
  v_ip TEXT;
  v_ip_hash TEXT;
BEGIN
  SELECT allow_direct_registration INTO v_allowed FROM public.world_states WHERE world_id = p_world_id;
  IF NOT coalesce(v_allowed, FALSE) THEN
    RAISE EXCEPTION 'Pendaftaran langsung dinonaktifkan. Gunakan jalur Edge Function (Turnstile).';
  END IF;
  BEGIN
    v_headers := current_setting('request.headers', true)::json;
  EXCEPTION WHEN others THEN
    v_headers := NULL;
  END;
  v_ip := nullif(btrim(coalesce(v_headers->>'cf-connecting-ip', split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1))), '');
  IF v_ip IS NOT NULL THEN
    v_ip_hash := encode(extensions.digest(v_ip || ':' || p_world_id, 'sha256'), 'hex');
  END IF;
  RETURN public.nv_register_citizen_core(p_world_id, p_username, p_ig_username, p_avatar_color, p_avatar_style, v_ip_hash);
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. SESI WARGA, IG, & VERIFIKASI FOLLOW (sisi warga)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_citizen(p_world_id TEXT, p_citizen_id UUID, p_token UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_c public.citizens;
BEGIN
  v_c := public.nv_auth_citizen(p_world_id, p_citizen_id, p_token, FALSE);
  UPDATE public.citizens SET last_active_at = now() WHERE id = v_c.id RETURNING * INTO v_c;
  RETURN public.nv_citizen_private(v_c);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_recovery_pin(p_world_id TEXT, p_citizen_id UUID, p_token UUID, p_pin TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_c public.citizens;
BEGIN
  v_c := public.nv_auth_citizen(p_world_id, p_citizen_id, p_token);
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,6}$' THEN
    RAISE EXCEPTION 'PIN pemulihan harus 4–6 digit angka.';
  END IF;
  UPDATE public.citizens
  SET recovery_pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)),
      recovery_failed_attempts = 0,
      recovery_locked_until = NULL
  WHERE id = v_c.id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Pindah sesi ke HP/browser lain: Kode KTP + PIN. Tidak raise agar counter gagal tersimpan.
CREATE OR REPLACE FUNCTION public.recover_session(p_world_id TEXT, p_ktp_code TEXT, p_pin TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v public.citizens;
  v_left INTEGER;
BEGIN
  SELECT * INTO v FROM public.citizens
  WHERE world_id = p_world_id AND upper(ktp_code) = upper(btrim(coalesce(p_ktp_code, '')))
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Kode KTP tidak ditemukan.');
  END IF;
  IF v.recovery_pin_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'KTP ini belum mengaktifkan PIN pemulihan.');
  END IF;
  IF v.recovery_locked_until IS NOT NULL AND v.recovery_locked_until > now() THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'Terlalu banyak percobaan. Coba lagi dalam ' || public.nv_fmt_wait(v.recovery_locked_until - now()) || '.');
  END IF;
  IF p_pin IS NOT NULL AND extensions.crypt(p_pin, v.recovery_pin_hash) = v.recovery_pin_hash THEN
    UPDATE public.citizens SET recovery_failed_attempts = 0, recovery_locked_until = NULL, last_active_at = now()
    WHERE id = v.id;
    RETURN jsonb_build_object('ok', true, 'citizen_id', v.id, 'secret_token', v.secret_token);
  END IF;
  v_left := 5 - (v.recovery_failed_attempts + 1);
  UPDATE public.citizens
  SET recovery_failed_attempts = CASE WHEN v_left <= 0 THEN 0 ELSE recovery_failed_attempts + 1 END,
      recovery_locked_until = CASE WHEN v_left <= 0 THEN now() + INTERVAL '1 hour' ELSE recovery_locked_until END
  WHERE id = v.id;
  RETURN jsonb_build_object('ok', false, 'error',
    CASE WHEN v_left <= 0 THEN 'PIN salah. KTP dikunci 1 jam.' ELSE 'PIN salah. Sisa ' || v_left || ' percobaan.' END);
END;
$$;

-- Tombol "Ganti Instagram" (typo saat daftar). Status follow kembali 'pending'.
CREATE OR REPLACE FUNCTION public.update_citizen_instagram(p_world_id TEXT, p_citizen_id UUID, p_token UUID, p_new_ig_username TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_world public.world_states;
  v_c public.citizens;
  v_clean TEXT;
BEGIN
  v_world := public.nv_get_world(p_world_id);
  v_c := public.nv_auth_citizen(p_world_id, p_citizen_id, p_token);
  v_clean := lower(btrim(btrim(coalesce(p_new_ig_username, '')), '@'));
  PERFORM public.nv_assert_ig_username(v_clean);
  IF v_clean = lower(v_world.ig_account_handle) THEN
    RAISE EXCEPTION 'Gunakan akun Instagram pribadimu, bukan akun resmi negara.';
  END IF;
  IF public.nv_contains_profanity(v_clean) THEN
    RAISE EXCEPTION 'Username mengandung kata yang tidak diizinkan.';
  END IF;
  IF v_clean = v_c.ig_username THEN
    RAISE EXCEPTION 'Itu username Instagram yang sama dengan sekarang.';
  END IF;
  PERFORM public.nv_assert_cooldown(v_c.ig_changed_at,
    public.nv_econ_num(v_world.config, 'igChangeCooldownMinutes', 30), 'Username IG baru saja diganti.');
  IF EXISTS (SELECT 1 FROM public.citizens WHERE world_id = p_world_id AND ig_username = v_clean AND id <> v_c.id) THEN
    RAISE EXCEPTION 'Username Instagram @% sudah dipakai warga lain.', v_clean;
  END IF;

  BEGIN
    UPDATE public.citizens
    SET ig_username = v_clean,
        ig_changed_at = now(),
        follow_status = CASE WHEN follow_status = 'impeached' THEN 'impeached' ELSE 'pending' END,
        follow_checked_at = CASE WHEN follow_status = 'impeached' THEN follow_checked_at ELSE NULL END,
        last_active_at = now()
    WHERE id = v_c.id
    RETURNING * INTO v_c;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Username Instagram @% sudah dipakai warga lain.', v_clean;
  END;
  RETURN public.nv_citizen_private(v_c);
END;
$$;

-- Tombol "Cek Ulang": masuk antrean prioritas pengecekan follow berikutnya.
CREATE OR REPLACE FUNCTION public.request_follow_recheck(p_world_id TEXT, p_citizen_id UUID, p_token UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_world public.world_states;
  v_c public.citizens;
BEGIN
  v_world := public.nv_get_world(p_world_id);
  v_c := public.nv_auth_citizen(p_world_id, p_citizen_id, p_token);
  IF v_c.follow_status = 'verified' THEN
    RAISE EXCEPTION 'Akunmu sudah terverifikasi ✓';
  END IF;
  IF v_c.follow_status = 'impeached' THEN
    RAISE EXCEPTION 'Status dimakzulkan hanya bisa dipulihkan oleh admin.';
  END IF;
  PERFORM public.nv_assert_cooldown(v_c.follow_recheck_requested_at,
    public.nv_econ_num(v_world.config, 'recheckCooldownMinutes', 60), 'Permintaan cek ulang sudah tercatat.');
  UPDATE public.citizens
  SET follow_status = 'recheck_requested',
      follow_recheck_requested_at = now(),
      last_active_at = now()
  WHERE id = v_c.id
  RETURNING * INTO v_c;
  RETURN public.nv_citizen_private(v_c);
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. AKTIVITAS HARIAN
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_work_reward(p_world_id TEXT, p_citizen_id UUID, p_token UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_world public.world_states;
  v_c public.citizens;
  v_tier JSONB;
  v_reward BIGINT;
  v_coins BIGINT;
  v_now TIMESTAMPTZ := now();
BEGIN
  v_world := public.nv_get_world(p_world_id);
  v_c := public.nv_auth_citizen(p_world_id, p_citizen_id, p_token);
  PERFORM public.nv_assert_cooldown(v_c.last_work_at,
    public.nv_econ_num(v_world.config, 'workCooldownMinutes', 120), 'Masih capek habis kerja!');
  v_tier := public.nv_find_tier(v_world.config, v_c.tier_id);
  v_reward := coalesce((v_tier->'work'->>'reward')::bigint, 10);
  UPDATE public.citizens
  SET coins = coins + v_reward, last_work_at = v_now, last_active_at = v_now
  WHERE id = v_c.id
  RETURNING coins INTO v_coins;
  RETURN jsonb_build_object('reward', v_reward, 'coins', v_coins,
                            'label', coalesce(v_tier->'work'->>'label', 'Kerja'), 'last_work_at', v_now);
END;
$$;

CREATE OR REPLACE FUNCTION public.post_status(p_world_id TEXT, p_citizen_id UUID, p_token UUID, p_text TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_world public.world_states;
  v_c public.citizens;
  v_text TEXT := public.nv_clean_text(p_text);
BEGIN
  v_world := public.nv_get_world(p_world_id);
  v_c := public.nv_auth_citizen(p_world_id, p_citizen_id, p_token);
  IF v_c.follow_status = 'impeached' THEN
    RAISE EXCEPTION 'Warga yang dimakzulkan tidak bisa update status.';
  END IF;
  PERFORM public.nv_assert_free_text(v_text, public.nv_econ_num(v_world.config, 'statusMaxLength', 50)::int, 'Status');
  PERFORM public.nv_assert_cooldown(v_c.last_status_at,
    public.nv_econ_num(v_world.config, 'statusCooldownMinutes', 10), 'Status baru saja di-update.');
  UPDATE public.citizens
  SET status_text = v_text, last_status_at = now(), last_active_at = now()
  WHERE id = v_c.id
  RETURNING * INTO v_c;
  PERFORM public.nv_news(p_world_id, v_c.id, 'status', public.nv_tag(v_c.username, v_c.citizen_number) || ': ' || v_text);
  RETURN public.nv_citizen_private(v_c);
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. TANAH & PROPERTI
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.buy_land_plot(p_world_id TEXT, p_citizen_id UUID, p_token UUID, p_plot_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_world public.world_states;
  v_c public.citizens;
  v_plot public.land_plots;
  v_owned INTEGER;
  v_max INTEGER;
  v_discount NUMERIC;
  v_price BIGINT;
  v_coins BIGINT;
  v_ring_owned INTEGER;
  v_ring_total INTEGER;
  v_pct NUMERIC;
BEGIN
  v_world := public.nv_get_world(p_world_id);
  v_c := public.nv_auth_citizen(p_world_id, p_citizen_id, p_token);
  PERFORM public.nv_require_verified(v_world, v_c, 'buyLand');

  SELECT * INTO v_plot FROM public.land_plots
  WHERE world_id = p_world_id AND plot_code = upper(btrim(p_plot_code))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kavling % tidak ditemukan.', p_plot_code; END IF;
  IF v_plot.ring_level > v_world.current_ring_unlocked THEN
    RAISE EXCEPTION 'Ring % belum dibuka.', v_plot.ring_level;
  END IF;
  IF v_plot.owner_citizen_id IS NOT NULL THEN
    RAISE EXCEPTION 'Kavling % sudah dimiliki %.', v_plot.plot_code, v_plot.owner_tag;
  END IF;

  v_max := coalesce((v_world.config->'economy'->'land'->>'maxPlotsPerCitizen')::int, 5);
  SELECT count(*) INTO v_owned FROM public.land_plots WHERE world_id = p_world_id AND owner_citizen_id = v_c.id;
  IF v_owned >= v_max THEN
    RAISE EXCEPTION 'Batas kepemilikan tercapai (maks. % kavling per warga).', v_max;
  END IF;

  v_discount := public.nv_tier_perk_num(v_world.config, v_c.tier_id, 'landDiscountPct');
  v_price := floor(v_plot.price * (100 - v_discount) / 100)::bigint;
  IF v_c.coins < v_price THEN
    RAISE EXCEPTION 'Saldo kurang! Harga kavling % adalah % %.', v_plot.plot_code, v_price, v_world.config->'currency'->>'code';
  END IF;

  UPDATE public.citizens SET coins = coins - v_price, last_active_at = now()
  WHERE id = v_c.id RETURNING coins INTO v_coins;

  UPDATE public.land_plots
  SET owner_citizen_id = v_c.id,
      owner_tag = public.nv_tag(v_c.username, v_c.citizen_number),
      owner_number = v_c.citizen_number,
      purchased_at = now(),
      building_type = NULL, building_name = NULL, building_level = 0, last_income_claim_at = NULL
  WHERE id = v_plot.id
  RETURNING * INTO v_plot;

  PERFORM public.nv_news(p_world_id, v_c.id, 'property',
    format('%s membeli kavling %s (%s %s).', public.nv_tag(v_c.username, v_c.citizen_number),
           v_plot.plot_code, v_price, v_world.config->'currency'->>'code'));

  -- Ekspansi saat ring terluar terisi >= occupancyUnlockPct
  IF v_plot.ring_level = v_world.current_ring_unlocked THEN
    v_pct := coalesce((v_world.config->'map'->>'occupancyUnlockPct')::numeric, 80);
    SELECT count(*) FILTER (WHERE owner_citizen_id IS NOT NULL), count(*)
    INTO v_ring_owned, v_ring_total
    FROM public.land_plots WHERE world_id = p_world_id AND ring_level = v_plot.ring_level;
    IF v_ring_total > 0 AND v_ring_owned * 100 >= v_ring_total * v_pct THEN
      UPDATE public.world_states SET current_ring_unlocked = v_plot.ring_level + 1, updated_at = now()
      WHERE world_id = p_world_id AND current_ring_unlocked = v_plot.ring_level;
      IF FOUND THEN
        PERFORM public.nv_ensure_plots(p_world_id, v_plot.ring_level + 1);
        PERFORM public.nv_news(p_world_id, NULL, 'expansion',
          format('EKSPANSI WILAYAH! Kavling Ring %s hampir habis, %s (Ring %s) resmi dibuka!',
                 v_plot.ring_level, public.nv_ring_name(v_world.config, v_plot.ring_level + 1), v_plot.ring_level + 1));
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('plot', to_jsonb(v_plot), 'coins', v_coins, 'price', v_price);
END;
$$;

CREATE OR REPLACE FUNCTION public.build_or_upgrade_property(
  p_world_id TEXT, p_citizen_id UUID, p_token UUID, p_plot_code TEXT,
  p_building_type TEXT DEFAULT NULL, p_building_name TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_world public.world_states;
  v_c public.citizens;
  v_plot public.land_plots;
  v_b JSONB;
  v_cost BIGINT;
  v_name TEXT;
  v_pending BIGINT := 0;
  v_coins BIGINT;
  v_max_level INTEGER;
BEGIN
  v_world := public.nv_get_world(p_world_id);
  v_c := public.nv_auth_citizen(p_world_id, p_citizen_id, p_token);
  PERFORM public.nv_require_verified(v_world, v_c, 'build');

  SELECT * INTO v_plot FROM public.land_plots
  WHERE world_id = p_world_id AND plot_code = upper(btrim(p_plot_code))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kavling % tidak ditemukan.', p_plot_code; END IF;
  IF v_plot.owner_citizen_id IS DISTINCT FROM v_c.id THEN
    RAISE EXCEPTION 'Kamu bukan pemilik kavling %.', v_plot.plot_code;
  END IF;

  IF v_plot.building_level = 0 THEN
    v_b := public.nv_find_building(v_world.config, p_building_type);
    IF v_b IS NULL THEN RAISE EXCEPTION 'Jenis bangunan tidak dikenal.'; END IF;
    IF v_b->>'requiresPerk' IS NOT NULL AND NOT public.nv_tier_perk(v_world.config, v_c.tier_id, v_b->>'requiresPerk') THEN
      RAISE EXCEPTION '% hanya boleh dibangun pejabat / pemegang izin pemerintah.', v_b->>'name';
    END IF;
    v_name := public.nv_clean_text(coalesce(nullif(btrim(coalesce(p_building_name, '')), ''), v_b->>'name'));
    v_name := left(v_name, 24);
    PERFORM public.nv_assert_free_text(v_name, 24, 'Nama bangunan');
  ELSE
    v_b := public.nv_find_building(v_world.config, v_plot.building_type);
    IF v_b IS NULL THEN RAISE EXCEPTION 'Data bangunan rusak, hubungi admin.'; END IF;
    v_max_level := coalesce((v_b->>'maxLevel')::int, 5);
    IF v_plot.building_level >= v_max_level THEN
      RAISE EXCEPTION '% sudah level maksimal (%).', v_plot.building_name, v_max_level;
    END IF;
    v_name := v_plot.building_name;
    IF p_building_name IS NOT NULL AND btrim(p_building_name) <> '' THEN
      v_name := public.nv_clean_text(p_building_name);
      PERFORM public.nv_assert_free_text(v_name, 24, 'Nama bangunan');
    END IF;
    -- Cairkan pendapatan level lama sebelum upgrade
    v_pending := public.nv_property_income(v_world.config, v_b, v_plot.building_level, v_plot.last_income_claim_at,
      public.nv_tier_perk_num(v_world.config, v_c.tier_id, 'incomeBonusPct'));
  END IF;

  v_cost := round((v_b->>'baseCost')::numeric * power((v_b->>'upgradeMultiplier')::numeric, v_plot.building_level))::bigint;
  IF v_c.coins + v_pending < v_cost THEN
    RAISE EXCEPTION 'Saldo kurang! Butuh % %.', v_cost, v_world.config->'currency'->>'code';
  END IF;

  UPDATE public.citizens SET coins = coins + v_pending - v_cost, last_active_at = now()
  WHERE id = v_c.id RETURNING coins INTO v_coins;

  UPDATE public.land_plots
  SET building_type = v_b->>'id',
      building_name = v_name,
      building_level = building_level + 1,
      last_income_claim_at = now()
  WHERE id = v_plot.id
  RETURNING * INTO v_plot;

  PERFORM public.nv_news(p_world_id, v_c.id, 'property',
    CASE WHEN v_plot.building_level = 1
      THEN format('%s membangun "%s" di kavling %s!', public.nv_tag(v_c.username, v_c.citizen_number), v_plot.building_name, v_plot.plot_code)
      ELSE format('"%s" milik %s naik ke Level %s!', v_plot.building_name, public.nv_tag(v_c.username, v_c.citizen_number), v_plot.building_level)
    END);

  RETURN jsonb_build_object('plot', to_jsonb(v_plot), 'coins', v_coins, 'cost', v_cost, 'income_claimed', v_pending);
END;
$$;

CREATE OR REPLACE FUNCTION public.rename_property(p_world_id TEXT, p_citizen_id UUID, p_token UUID, p_plot_code TEXT, p_building_name TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_c public.citizens;
  v_plot public.land_plots;
  v_name TEXT := public.nv_clean_text(p_building_name);
BEGIN
  v_c := public.nv_auth_citizen(p_world_id, p_citizen_id, p_token);
  PERFORM public.nv_assert_free_text(v_name, 24, 'Nama bangunan');
  UPDATE public.land_plots SET building_name = v_name
  WHERE world_id = p_world_id AND plot_code = upper(btrim(p_plot_code)) AND owner_citizen_id = v_c.id AND building_level > 0
  RETURNING * INTO v_plot;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bangunan tidak ditemukan atau bukan milikmu.'; END IF;
  RETURN to_jsonb(v_plot);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_property_income(p_world_id TEXT, p_citizen_id UUID, p_token UUID, p_plot_code TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_world public.world_states;
  v_c public.citizens;
  v_plot public.land_plots;
  v_bonus NUMERIC;
  v_amount BIGINT;
  v_total BIGINT := 0;
  v_coins BIGINT;
  v_claimed JSONB := '[]'::jsonb;
BEGIN
  v_world := public.nv_get_world(p_world_id);
  v_c := public.nv_auth_citizen(p_world_id, p_citizen_id, p_token);
  v_bonus := public.nv_tier_perk_num(v_world.config, v_c.tier_id, 'incomeBonusPct');

  FOR v_plot IN
    SELECT * FROM public.land_plots
    WHERE world_id = p_world_id AND owner_citizen_id = v_c.id AND building_level > 0
      AND (p_plot_code IS NULL OR plot_code = upper(btrim(p_plot_code)))
    FOR UPDATE
  LOOP
    v_amount := public.nv_property_income(v_world.config, public.nv_find_building(v_world.config, v_plot.building_type),
      v_plot.building_level, v_plot.last_income_claim_at, v_bonus);
    IF v_amount >= 1 THEN
      UPDATE public.land_plots SET last_income_claim_at = now() WHERE id = v_plot.id;
      v_total := v_total + v_amount;
      v_claimed := v_claimed || jsonb_build_array(jsonb_build_object('plot_code', v_plot.plot_code, 'amount', v_amount));
    END IF;
  END LOOP;

  IF v_total = 0 THEN
    RAISE EXCEPTION 'Belum ada pendapatan properti yang bisa diklaim.';
  END IF;

  UPDATE public.citizens SET coins = coins + v_total, last_active_at = now()
  WHERE id = v_c.id RETURNING coins INTO v_coins;
  RETURN jsonb_build_object('total', v_total, 'coins', v_coins, 'claimed', v_claimed);
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. PROYEK NASIONAL
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.donate_to_project(p_world_id TEXT, p_citizen_id UUID, p_token UUID, p_amount BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_world public.world_states;
  v_c public.citizens;
  v_coins BIGINT;
  v_funding BIGINT;
  v_done TEXT := NULL;
  v_done_name TEXT;
  v_next JSONB;
  v_completed TEXT[];
BEGIN
  v_world := public.nv_get_world(p_world_id);
  v_c := public.nv_auth_citizen(p_world_id, p_citizen_id, p_token);
  PERFORM public.nv_require_verified(v_world, v_c, 'donate');
  IF p_amount IS NULL OR p_amount < 1 THEN RAISE EXCEPTION 'Jumlah sumbangan minimal 1.'; END IF;
  IF v_c.coins < p_amount THEN RAISE EXCEPTION 'Saldo tidak cukup untuk menyumbang sebanyak itu.'; END IF;

  -- Kunci state dunia (urutan lock: citizen → world, konsisten di semua fungsi)
  SELECT * INTO v_world FROM public.world_states WHERE world_id = p_world_id FOR UPDATE;
  IF v_world.active_project_completed OR v_world.active_project_id = '' THEN
    RAISE EXCEPTION 'Belum ada proyek nasional aktif. Tunggu proyek baru dari Presiden/Admin.';
  END IF;

  UPDATE public.citizens
  SET coins = coins - p_amount, total_donated = total_donated + p_amount, last_active_at = now()
  WHERE id = v_c.id RETURNING coins INTO v_coins;

  INSERT INTO public.project_donations (world_id, project_id, citizen_id, amount)
  VALUES (p_world_id, v_world.active_project_id, v_c.id, p_amount)
  ON CONFLICT (world_id, project_id, citizen_id)
  DO UPDATE SET amount = public.project_donations.amount + EXCLUDED.amount, updated_at = now();

  v_funding := v_world.active_project_funding + p_amount;

  IF v_world.active_project_goal > 0 AND v_funding >= v_world.active_project_goal THEN
    v_done := v_world.active_project_id;
    v_completed := array_append(v_world.completed_projects, v_done);
    SELECT p->>'name' INTO v_done_name FROM jsonb_array_elements(v_world.config->'projects') p WHERE p->>'id' = v_done;
    PERFORM public.nv_news(p_world_id, NULL, 'project',
      format('PROYEK NASIONAL SELESAI! %s resmi beroperasi berkat gotong royong warga!', coalesce(v_done_name, v_done)));

    SELECT p.value INTO v_next
    FROM jsonb_array_elements(v_world.config->'projects') WITH ORDINALITY p(value, idx)
    WHERE NOT ((p.value->>'id') = ANY (v_completed))
    ORDER BY p.idx LIMIT 1;

    IF v_next IS NOT NULL THEN
      UPDATE public.world_states
      SET completed_projects = v_completed,
          active_project_id = v_next->>'id',
          active_project_goal = (v_next->>'goal')::bigint,
          active_project_funding = least(v_funding - v_world.active_project_goal, (v_next->>'goal')::bigint - 1),
          active_project_completed = FALSE,
          updated_at = now()
      WHERE world_id = p_world_id
      RETURNING * INTO v_world;
      PERFORM public.nv_news(p_world_id, NULL, 'project',
        format('Proyek berikutnya dimulai: %s %s. Ayo patungan!', v_next->>'emoji', v_next->>'name'));
    ELSE
      UPDATE public.world_states
      SET completed_projects = v_completed,
          active_project_funding = active_project_goal,
          active_project_completed = TRUE,
          updated_at = now()
      WHERE world_id = p_world_id
      RETURNING * INTO v_world;
    END IF;
  ELSE
    UPDATE public.world_states SET active_project_funding = v_funding, updated_at = now()
    WHERE world_id = p_world_id
    RETURNING * INTO v_world;
  END IF;

  RETURN jsonb_build_object('coins', v_coins, 'world', public.nv_world_json(v_world), 'completed_project_id', v_done);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_project_top_donors(p_world_id TEXT, p_project_id TEXT, p_limit INTEGER DEFAULT 10)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.amount DESC), '[]'::jsonb)
  FROM (
    SELECT d.citizen_id, public.nv_tag(c.username, c.citizen_number) AS tag, d.amount
    FROM public.project_donations d
    JOIN public.citizens c ON c.id = d.citizen_id
    WHERE d.world_id = p_world_id AND d.project_id = p_project_id
    ORDER BY d.amount DESC, c.citizen_number
    LIMIT least(greatest(coalesce(p_limit, 10), 1), 50)
  ) t
$$;

-- -----------------------------------------------------------------------------
-- 9. PEMERINTAHAN & SIDANG WARGA
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.post_announcement(p_world_id TEXT, p_citizen_id UUID, p_token UUID, p_text TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_world public.world_states;
  v_c public.citizens;
  v_text TEXT := public.nv_clean_text(p_text);
BEGIN
  v_world := public.nv_get_world(p_world_id);
  v_c := public.nv_auth_citizen(p_world_id, p_citizen_id, p_token, FALSE);
  IF NOT public.nv_tier_perk(v_world.config, v_c.tier_id, 'canAnnounce') THEN
    RAISE EXCEPTION 'Hanya Presiden & Wakil Presiden yang bisa berpidato.';
  END IF;
  PERFORM public.nv_require_verified(v_world, v_c, 'governance');
  PERFORM public.nv_assert_free_text(v_text, public.nv_econ_num(v_world.config, 'announcementMaxLength', 160)::int, 'Pidato');

  UPDATE public.world_states
  SET president_announcement = v_text,
      announcement_by_citizen_id = v_c.id,
      announcement_at = now(),
      updated_at = now()
  WHERE world_id = p_world_id
  RETURNING * INTO v_world;

  PERFORM public.nv_news(p_world_id, v_c.id, 'decree',
    format('PIDATO %s %s: "%s"', upper(v_c.role_title), public.nv_tag(v_c.username, v_c.citizen_number), v_text));
  RETURN public.nv_world_json(v_world);
END;
$$;

CREATE OR REPLACE FUNCTION public.propose_poll(p_world_id TEXT, p_citizen_id UUID, p_token UUID, p_question TEXT, p_options TEXT[])
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_world public.world_states;
  v_c public.citizens;
  v_direct BOOLEAN;
  v_question TEXT := public.nv_clean_text(p_question);
  v_last TIMESTAMPTZ;
  v_id UUID;
BEGIN
  v_world := public.nv_get_world(p_world_id);
  v_c := public.nv_auth_citizen(p_world_id, p_citizen_id, p_token);
  v_direct := public.nv_tier_perk(v_world.config, v_c.tier_id, 'canCreatePoll');
  IF NOT v_direct AND NOT public.nv_tier_perk(v_world.config, v_c.tier_id, 'canProposePoll') THEN
    RAISE EXCEPTION 'Hanya Presiden, Wapres, Kabinet, dan DPR yang bisa mengajukan voting.';
  END IF;
  PERFORM public.nv_require_verified(v_world, v_c, 'governance');
  PERFORM public.nv_assert_free_text(v_question, 120, 'Pertanyaan voting');

  SELECT max(created_at) INTO v_last FROM public.polls WHERE world_id = p_world_id AND created_by_citizen_id = v_c.id;
  PERFORM public.nv_assert_cooldown(v_last,
    public.nv_econ_num(v_world.config, 'pollProposalCooldownMinutes', 360), 'Kamu baru saja mengajukan voting.');

  INSERT INTO public.polls (world_id, question, kind, options, status, created_by_citizen_id)
  VALUES (p_world_id, v_question, 'policy', public.nv_build_poll_options(p_options),
          CASE WHEN v_direct THEN 'active' ELSE 'pending' END, v_c.id)
  RETURNING id INTO v_id;

  IF v_direct THEN
    PERFORM public.nv_news(p_world_id, v_c.id, 'poll',
      format('SIDANG WARGA DIBUKA: "%s" — diajukan %s', v_question, public.nv_tag(v_c.username, v_c.citizen_number)));
  END IF;
  RETURN public.nv_poll_json(v_id, v_c.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cast_poll_vote(p_world_id TEXT, p_citizen_id UUID, p_token UUID, p_poll_id UUID, p_option_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_world public.world_states;
  v_c public.citizens;
  v_poll public.polls;
BEGIN
  v_world := public.nv_get_world(p_world_id);
  v_c := public.nv_auth_citizen(p_world_id, p_citizen_id, p_token, FALSE);
  PERFORM public.nv_require_verified(v_world, v_c, 'vote');

  SELECT * INTO v_poll FROM public.polls WHERE id = p_poll_id AND world_id = p_world_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Voting tidak ditemukan.'; END IF;
  IF v_poll.status <> 'active' OR (v_poll.closes_at IS NOT NULL AND v_poll.closes_at < now()) THEN
    RAISE EXCEPTION 'Sidang warga ini sudah ditutup.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_poll.options) o WHERE o->>'id' = p_option_id) THEN
    RAISE EXCEPTION 'Pilihan voting tidak valid.';
  END IF;

  INSERT INTO public.poll_votes (poll_id, citizen_id, option_id)
  VALUES (p_poll_id, v_c.id, p_option_id)
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kamu sudah memberikan suara di sidang ini.';
  END IF;

  UPDATE public.citizens SET last_active_at = now() WHERE id = v_c.id;
  RETURN public.nv_poll_json(p_poll_id, v_c.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_active_polls(p_world_id TEXT, p_citizen_id UUID DEFAULT NULL, p_token UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_viewer UUID := NULL;
BEGIN
  IF p_citizen_id IS NOT NULL AND p_token IS NOT NULL THEN
    SELECT id INTO v_viewer FROM public.citizens
    WHERE id = p_citizen_id AND world_id = p_world_id AND secret_token = p_token;
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(public.nv_poll_json(p.id, v_viewer) ORDER BY p.created_at DESC), '[]'::jsonb)
    FROM (
      SELECT id, created_at FROM public.polls
      WHERE world_id = p_world_id AND status = 'active'
      ORDER BY created_at DESC LIMIT 10
    ) p
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 10. BACA PUBLIK (sampling hemat kuota)
-- -----------------------------------------------------------------------------

-- Maks. 120 warga untuk peta: diri sendiri + Top 25 pejabat + 40 terbaru + paling aktif.
CREATE OR REPLACE FUNCTION public.get_map_citizens(p_world_id TEXT, p_me UUID DEFAULT NULL, p_limit INTEGER DEFAULT 120)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH lim AS (SELECT least(greatest(coalesce(p_limit, 120), 1), 200) AS n),
  picks AS (
    SELECT 0 AS pri, c.id FROM public.citizens c WHERE c.world_id = p_world_id AND c.id = p_me
    UNION ALL
    (SELECT 1, c.id FROM public.citizens c WHERE c.world_id = p_world_id ORDER BY c.citizen_number LIMIT 25)
    UNION ALL
    (SELECT 2, c.id FROM public.citizens c WHERE c.world_id = p_world_id ORDER BY c.citizen_number DESC LIMIT 40)
    UNION ALL
    (SELECT 3, c.id FROM public.citizens c WHERE c.world_id = p_world_id ORDER BY c.last_active_at DESC LIMIT 200)
  ),
  dedup AS (
    SELECT DISTINCT ON (id) id, pri FROM picks ORDER BY id, pri
  ),
  chosen AS (
    SELECT d.id, d.pri FROM dedup d JOIN public.citizens c ON c.id = d.id
    ORDER BY d.pri, c.last_active_at DESC
    LIMIT (SELECT n FROM lim)
  )
  SELECT coalesce(jsonb_agg(public.nv_citizen_public(c) ORDER BY ch.pri, c.citizen_number), '[]'::jsonb)
  FROM chosen ch JOIN public.citizens c ON c.id = ch.id
$$;

CREATE OR REPLACE FUNCTION public.get_leaderboard(
  p_world_id TEXT, p_tab TEXT, p_offset INTEGER DEFAULT 0, p_limit INTEGER DEFAULT 50, p_search TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_limit INTEGER := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset INTEGER := greatest(coalesce(p_offset, 0), 0);
  v_q TEXT := nullif(lower(btrim(btrim(btrim(coalesce(p_search, '')), '@#'))), '');
  v_result JSONB;
BEGIN
  IF p_tab = 'landlords' THEN
    WITH agg AS (
      SELECT owner_citizen_id AS cid, count(*)::int AS plots, coalesce(sum(building_level), 0)::int AS levels
      FROM public.land_plots WHERE world_id = p_world_id AND owner_citizen_id IS NOT NULL
      GROUP BY owner_citizen_id
    ), ranked AS (
      SELECT c, a.plots, a.levels,
             row_number() OVER (ORDER BY a.levels DESC, a.plots DESC, c.citizen_number) AS rk
      FROM agg a JOIN public.citizens c ON c.id = a.cid
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('rank', r.rk, 'citizen', public.nv_citizen_public(r.c),
                                                 'plots_count', r.plots, 'total_levels', r.levels) ORDER BY r.rk), '[]'::jsonb)
    INTO v_result
    FROM (
      SELECT * FROM ranked x
      WHERE v_q IS NULL OR strpos(lower((x.c).username), v_q) > 0 OR strpos((x.c).ig_username, v_q) > 0
         OR (x.c).citizen_number::text = ltrim(v_q, '0') OR strpos(lower((x.c).role_title), v_q) > 0
      ORDER BY x.rk OFFSET v_offset LIMIT v_limit
    ) r;
  ELSE
    WITH base AS (
      SELECT c,
             CASE WHEN p_tab = 'richest'
               THEN row_number() OVER (ORDER BY c.coins DESC, c.citizen_number)
               ELSE c.citizen_number::bigint END AS rk
      FROM public.citizens c
      WHERE c.world_id = p_world_id
        AND (p_tab <> 'founders' OR c.citizen_number <= 100)
        AND (p_tab <> 'gen1' OR c.citizen_number BETWEEN 101 AND 1000)
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('rank', r.rk, 'citizen', public.nv_citizen_public(r.c),
                                                 'plots_count', 0, 'total_levels', 0) ORDER BY r.rk), '[]'::jsonb)
    INTO v_result
    FROM (
      SELECT * FROM base x
      WHERE v_q IS NULL OR strpos(lower((x.c).username), v_q) > 0 OR strpos((x.c).ig_username, v_q) > 0
         OR (x.c).citizen_number::text = ltrim(v_q, '0') OR strpos(lower((x.c).role_title), v_q) > 0
      ORDER BY x.rk OFFSET v_offset LIMIT v_limit
    ) r;
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_ranks(p_world_id TEXT, p_citizen_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_c public.citizens;
  v_wealth INTEGER;
  v_land INTEGER;
  v_plots INTEGER;
  v_levels INTEGER;
BEGIN
  SELECT * INTO v_c FROM public.citizens WHERE id = p_citizen_id AND world_id = p_world_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Warga tidak ditemukan.'; END IF;

  SELECT 1 + count(*) INTO v_wealth FROM public.citizens
  WHERE world_id = p_world_id AND (coins > v_c.coins OR (coins = v_c.coins AND citizen_number < v_c.citizen_number));

  SELECT count(*), coalesce(sum(building_level), 0) INTO v_plots, v_levels
  FROM public.land_plots WHERE world_id = p_world_id AND owner_citizen_id = v_c.id;

  IF v_plots > 0 THEN
    WITH agg AS (
      SELECT owner_citizen_id AS cid, count(*) AS plots, sum(building_level) AS levels, min(owner_number) AS num
      FROM public.land_plots WHERE world_id = p_world_id AND owner_citizen_id IS NOT NULL
      GROUP BY owner_citizen_id
    )
    SELECT 1 + count(*) INTO v_land FROM agg
    WHERE levels > v_levels
       OR (levels = v_levels AND plots > v_plots)
       OR (levels = v_levels AND plots = v_plots AND num < v_c.citizen_number);
  END IF;

  RETURN jsonb_build_object('citizen_number', v_c.citizen_number, 'wealth_rank', v_wealth, 'landlord_rank', v_land);
END;
$$;

-- -----------------------------------------------------------------------------
-- 11. ADMIN (PIN / ADMIN_SECRET) & WORKER (ADMIN_SYNC_SECRET)
-- -----------------------------------------------------------------------------

-- Jalankan SEKALI per dunia dari SQL Editor Supabase (tidak bisa dipanggil anon):
--   SELECT set_world_secrets('republik-konoha', 'PIN-ADMIN-PANJANG', 'SYNC-SECRET-WORKER');
CREATE OR REPLACE FUNCTION public.set_world_secrets(p_world_id TEXT, p_admin_secret TEXT, p_sync_secret TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
BEGIN
  IF p_admin_secret IS NULL OR length(p_admin_secret) < 8 THEN
    RAISE EXCEPTION 'ADMIN secret minimal 8 karakter.';
  END IF;
  IF p_sync_secret IS NOT NULL AND length(p_sync_secret) < 16 THEN
    RAISE EXCEPTION 'SYNC secret minimal 16 karakter.';
  END IF;
  PERFORM public.nv_get_world(p_world_id);
  INSERT INTO public.world_secrets (world_id, admin_secret_hash, sync_secret_hash)
  VALUES (p_world_id,
          extensions.crypt(p_admin_secret, extensions.gen_salt('bf', 10)),
          CASE WHEN p_sync_secret IS NULL THEN NULL ELSE extensions.crypt(p_sync_secret, extensions.gen_salt('bf', 10)) END)
  ON CONFLICT (world_id) DO UPDATE
  SET admin_secret_hash = EXCLUDED.admin_secret_hash,
      sync_secret_hash = coalesce(EXCLUDED.sync_secret_hash, public.world_secrets.sync_secret_hash),
      failed_attempts = 0,
      locked_until = NULL,
      updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_login(p_world_id TEXT, p_admin_secret TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.nv_admin_ok(p_world_id, p_admin_secret) THEN RETURN public.nv_denied(); END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_world(
  p_world_id TEXT, p_admin_secret TEXT,
  p_day_number INTEGER DEFAULT NULL, p_follower_count INTEGER DEFAULT NULL, p_allow_direct_registration BOOLEAN DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_world public.world_states;
BEGIN
  IF NOT public.nv_admin_ok(p_world_id, p_admin_secret) THEN RETURN public.nv_denied(); END IF;
  IF p_day_number IS NOT NULL AND p_day_number < 1 THEN RAISE EXCEPTION 'Hari minimal 1.'; END IF;
  IF p_follower_count IS NOT NULL AND p_follower_count < 0 THEN RAISE EXCEPTION 'Jumlah follower tidak valid.'; END IF;
  UPDATE public.world_states
  SET day_number = coalesce(p_day_number, day_number),
      ig_follower_count = coalesce(p_follower_count, ig_follower_count),
      followers_synced_at = CASE WHEN p_follower_count IS NOT NULL THEN now() ELSE followers_synced_at END,
      allow_direct_registration = coalesce(p_allow_direct_registration, allow_direct_registration),
      updated_at = now()
  WHERE world_id = p_world_id
  RETURNING * INTO v_world;
  RETURN jsonb_build_object('ok', true, 'world', public.nv_world_json(v_world));
END;
$$;

-- Antrean cek follow (dipakai Admin Panel untuk intersect file followers, dan oleh worker).
CREATE OR REPLACE FUNCTION public.admin_get_follow_queue(p_world_id TEXT, p_admin_secret TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF NOT public.nv_admin_ok(p_world_id, p_admin_secret, TRUE) THEN RETURN public.nv_denied(); END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'snapshot_at', v_now,
    'usernames', (
      SELECT coalesce(jsonb_agg(ig_username ORDER BY
               CASE follow_status WHEN 'recheck_requested' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
               greatest(created_at, follow_recheck_requested_at, ig_changed_at)), '[]'::jsonb)
      FROM public.citizens
      WHERE world_id = p_world_id AND follow_status IN ('recheck_requested', 'pending', 'not_following')
    )
  );
END;
$$;

-- B. Batch verifikasi follow (Upload JSON Admin Panel ATAU worker).
--    p_snapshot_at: warga yang daftar / ganti IG / minta cek ulang SETELAH snapshot antrean diambil
--    tidak akan ditandai 'not_following' (mencegah salah tandai karena race).
--    p_mark_unfollowers: jika TRUE (hanya untuk daftar followers LENGKAP), warga 'verified' yang tidak ada
--    di daftar diturunkan ke 'not_following'.
CREATE OR REPLACE FUNCTION public.batch_verify_followers(
  p_world_id TEXT,
  p_admin_secret TEXT,
  p_follower_usernames TEXT[],
  p_total_ig_followers INTEGER DEFAULT NULL,
  p_snapshot_at TIMESTAMPTZ DEFAULT NULL,
  p_mark_unfollowers BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_list TEXT[];
  v_verified INTEGER := 0;
  v_not_following INTEGER := 0;
  v_unfollowed INTEGER := 0;
  v_handle TEXT;
BEGIN
  IF NOT public.nv_admin_ok(p_world_id, p_admin_secret, TRUE) THEN RETURN public.nv_denied(); END IF;

  v_list := ARRAY(
    SELECT DISTINCT lower(btrim(btrim(u), '@'))
    FROM unnest(coalesce(p_follower_usernames, '{}'::text[])) u
    WHERE u IS NOT NULL AND btrim(u) <> ''
  );

  -- 1) Ketemu di daftar followers → verified
  WITH upd AS (
    UPDATE public.citizens c
    SET follow_status = 'verified', follow_checked_at = now()
    WHERE c.world_id = p_world_id
      AND c.follow_status IN ('pending', 'recheck_requested', 'not_following')
      AND c.ig_username = ANY (v_list)
    RETURNING c.id, c.username, c.citizen_number, c.role_title
  ), elite_news AS (
    INSERT INTO public.news_feed (world_id, citizen_id, category, message)
    SELECT p_world_id, u.id, 'verification',
           format('RESMI DILANTIK! %s — %s', public.nv_tag(u.username, u.citizen_number), u.role_title)
    FROM upd u WHERE u.citizen_number <= 30
    RETURNING 1
  )
  SELECT count(*) INTO v_verified FROM upd;

  -- 2) Antrean yang TIDAK ada di daftar → not_following
  UPDATE public.citizens c
  SET follow_status = 'not_following', follow_checked_at = now()
  WHERE c.world_id = p_world_id
    AND c.follow_status IN ('pending', 'recheck_requested')
    AND NOT (c.ig_username = ANY (v_list))
    AND (p_snapshot_at IS NULL OR greatest(c.created_at, c.follow_recheck_requested_at, c.ig_changed_at) <= p_snapshot_at);
  GET DIAGNOSTICS v_not_following = ROW_COUNT;

  -- 3) (Opsional) deteksi unfollow dari daftar lengkap
  IF p_mark_unfollowers THEN
    UPDATE public.citizens c
    SET follow_status = 'not_following', follow_checked_at = now()
    WHERE c.world_id = p_world_id AND c.follow_status = 'verified'
      AND NOT (c.ig_username = ANY (v_list));
    GET DIAGNOSTICS v_unfollowed = ROW_COUNT;
  END IF;

  -- 4) Total followers & timestamp "diperbarui ..."
  UPDATE public.world_states
  SET ig_follower_count = coalesce(p_total_ig_followers, greatest(ig_follower_count, cardinality(v_list))),
      followers_synced_at = now(),
      updated_at = now()
  WHERE world_id = p_world_id
  RETURNING ig_account_handle INTO v_handle;

  IF v_verified > 0 THEN
    PERFORM public.nv_news(p_world_id, NULL, 'verification',
      format('PELANTIKAN: %s warga resmi dilantik setelah verifikasi follow @%s!', v_verified, v_handle));
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'verified', v_verified,
    'not_following', v_not_following,
    'unfollowed', v_unfollowed,
    'synced_at', now()
  );
END;
$$;

-- Pemakzulan pejabat #001–#100 yang 'not_following' > 48 jam (bahan drama Reels).
CREATE OR REPLACE FUNCTION public.impeach_unverified_elites(
  p_world_id TEXT, p_admin_secret TEXT, p_max_number INTEGER DEFAULT NULL, p_hours INTEGER DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_world public.world_states;
  v_max INTEGER;
  v_hours INTEGER;
  v_imp_id TEXT;
  v_result JSONB;
BEGIN
  IF NOT public.nv_admin_ok(p_world_id, p_admin_secret) THEN RETURN public.nv_denied(); END IF;
  v_world := public.nv_get_world(p_world_id);
  v_max := coalesce(p_max_number, (v_world.config->'verification'->>'impeachMaxNumber')::int, 100);
  v_hours := coalesce(p_hours, (v_world.config->'verification'->>'impeachAfterHours')::int, 48);
  v_imp_id := coalesce(v_world.config->'impeachedTier'->>'id', 'impeached');

  WITH upd AS (
    UPDATE public.citizens c
    SET original_tier_id = c.tier_id,
        original_role_title = c.role_title,
        tier_id = v_imp_id,
        role_title = 'Mantan ' || c.role_title,
        follow_status = 'impeached',
        impeached_at = now()
    WHERE c.world_id = p_world_id
      AND c.citizen_number <= v_max
      AND c.follow_status = 'not_following'
      AND c.follow_checked_at < now() - v_hours * INTERVAL '1 hour'
    RETURNING c.id, c.username, c.citizen_number, c.original_role_title
  ), news AS (
    INSERT INTO public.news_feed (world_id, citizen_id, category, message)
    SELECT p_world_id, u.id, 'impeachment',
           format('BREAKING NEWS: %s #%s resmi dimakzulkan karena ketahuan belum follow!',
                  u.original_role_title, public.nv_pad(u.citizen_number, 3))
    FROM upd u
    RETURNING 1
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'citizen_id', u.id,
           'tag', public.nv_tag(u.username, u.citizen_number),
           'role_title', u.original_role_title) ORDER BY u.citizen_number), '[]'::jsonb)
  INTO v_result FROM upd u;

  RETURN jsonb_build_object('ok', true, 'impeached', v_result);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_restore_citizen(p_world_id TEXT, p_admin_secret TEXT, p_citizen_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_c public.citizens;
BEGIN
  IF NOT public.nv_admin_ok(p_world_id, p_admin_secret) THEN RETURN public.nv_denied(); END IF;
  UPDATE public.citizens
  SET tier_id = coalesce(original_tier_id, tier_id),
      role_title = coalesce(original_role_title, role_title),
      original_tier_id = NULL, original_role_title = NULL, impeached_at = NULL,
      follow_status = 'pending', follow_checked_at = NULL
  WHERE id = p_citizen_id AND world_id = p_world_id AND follow_status = 'impeached'
  RETURNING * INTO v_c;
  IF NOT FOUND THEN RAISE EXCEPTION 'Warga tidak ditemukan atau tidak berstatus dimakzulkan.'; END IF;
  PERFORM public.nv_news(p_world_id, v_c.id, 'system',
    format('%s dipulihkan sebagai %s (menunggu verifikasi follow ulang).', public.nv_tag(v_c.username, v_c.citizen_number), v_c.role_title));
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_poll(p_world_id TEXT, p_admin_secret TEXT, p_question TEXT, p_options TEXT[], p_kind TEXT DEFAULT 'policy')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_question TEXT := public.nv_clean_text(p_question);
  v_id UUID;
BEGIN
  IF NOT public.nv_admin_ok(p_world_id, p_admin_secret) THEN RETURN public.nv_denied(); END IF;
  IF p_kind NOT IN ('policy', 'project') THEN RAISE EXCEPTION 'Jenis voting tidak valid.'; END IF;
  PERFORM public.nv_assert_free_text(v_question, 120, 'Pertanyaan voting');
  INSERT INTO public.polls (world_id, question, kind, options, status)
  VALUES (p_world_id, v_question, p_kind, public.nv_build_poll_options(p_options), 'active')
  RETURNING id INTO v_id;
  PERFORM public.nv_news(p_world_id, NULL, 'poll', format('SIDANG WARGA DIBUKA: "%s"', v_question));
  RETURN jsonb_build_object('ok', true, 'poll', public.nv_poll_json(v_id, NULL));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_pending_polls(p_world_id TEXT, p_admin_secret TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.nv_admin_ok(p_world_id, p_admin_secret) THEN RETURN public.nv_denied(); END IF;
  RETURN jsonb_build_object('ok', true, 'polls', (
    SELECT coalesce(jsonb_agg(public.nv_poll_json(p.id, NULL) ORDER BY p.created_at), '[]'::jsonb)
    FROM public.polls p WHERE p.world_id = p_world_id AND p.status = 'pending'
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_moderate_poll(p_world_id TEXT, p_admin_secret TEXT, p_poll_id UUID, p_action TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_poll public.polls;
BEGIN
  IF NOT public.nv_admin_ok(p_world_id, p_admin_secret) THEN RETURN public.nv_denied(); END IF;
  UPDATE public.polls
  SET status = CASE p_action WHEN 'approve' THEN 'active' WHEN 'reject' THEN 'rejected' WHEN 'close' THEN 'closed' END
  WHERE id = p_poll_id AND world_id = p_world_id AND p_action IN ('approve', 'reject', 'close')
  RETURNING * INTO v_poll;
  IF NOT FOUND THEN RAISE EXCEPTION 'Voting tidak ditemukan atau aksi tidak valid.'; END IF;
  IF p_action = 'approve' THEN
    PERFORM public.nv_news(p_world_id, v_poll.created_by_citizen_id, 'poll', format('SIDANG WARGA DIBUKA: "%s"', v_poll.question));
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Moderasi: kosongkan status warga, reset nama bangunan, atau hapus berita.
CREATE OR REPLACE FUNCTION public.admin_moderate_content(p_world_id TEXT, p_admin_secret TEXT, p_target TEXT, p_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_world public.world_states;
BEGIN
  IF NOT public.nv_admin_ok(p_world_id, p_admin_secret) THEN RETURN public.nv_denied(); END IF;
  v_world := public.nv_get_world(p_world_id);
  IF p_target = 'status' THEN
    UPDATE public.citizens SET status_text = '' WHERE world_id = p_world_id AND id = p_id::uuid;
  ELSIF p_target = 'building_name' THEN
    UPDATE public.land_plots lp
    SET building_name = left(coalesce(public.nv_find_building(v_world.config, lp.building_type)->>'name', 'Bangunan'), 24)
    WHERE lp.world_id = p_world_id AND lp.plot_code = upper(p_id);
  ELSIF p_target = 'news' THEN
    DELETE FROM public.news_feed WHERE world_id = p_world_id AND id = p_id::bigint;
  ELSE
    RAISE EXCEPTION 'Target moderasi tidak dikenal.';
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Konten tidak ditemukan.'; END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_active_project(p_world_id TEXT, p_admin_secret TEXT, p_project_id TEXT, p_reset_funding BOOLEAN DEFAULT TRUE)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_world public.world_states;
  v_p JSONB;
BEGIN
  IF NOT public.nv_admin_ok(p_world_id, p_admin_secret) THEN RETURN public.nv_denied(); END IF;
  v_world := public.nv_get_world(p_world_id);
  SELECT p INTO v_p FROM jsonb_array_elements(v_world.config->'projects') p WHERE p->>'id' = p_project_id;
  IF v_p IS NULL THEN RAISE EXCEPTION 'Proyek % tidak ada di config dunia.', p_project_id; END IF;
  UPDATE public.world_states
  SET active_project_id = p_project_id,
      active_project_goal = (v_p->>'goal')::bigint,
      active_project_funding = CASE WHEN p_reset_funding THEN 0 ELSE least(active_project_funding, (v_p->>'goal')::bigint - 1) END,
      active_project_completed = FALSE,
      completed_projects = array_remove(completed_projects, p_project_id),
      updated_at = now()
  WHERE world_id = p_world_id
  RETURNING * INTO v_world;
  PERFORM public.nv_news(p_world_id, NULL, 'project', format('Proyek nasional aktif: %s %s', v_p->>'emoji', v_p->>'name'));
  RETURN jsonb_build_object('ok', true, 'world', public.nv_world_json(v_world));
END;
$$;

-- -----------------------------------------------------------------------------
-- 12. ROW LEVEL SECURITY & HAK AKSES
-- -----------------------------------------------------------------------------

ALTER TABLE public.world_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.world_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profanity_words ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.citizens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.land_plots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_feed ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poll_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_donations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS world_states_public_read ON public.world_states;
CREATE POLICY world_states_public_read ON public.world_states FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS citizens_public_read ON public.citizens;
CREATE POLICY citizens_public_read ON public.citizens FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS land_plots_public_read ON public.land_plots;
CREATE POLICY land_plots_public_read ON public.land_plots FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS news_public_read ON public.news_feed;
CREATE POLICY news_public_read ON public.news_feed FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS polls_public_read ON public.polls;
CREATE POLICY polls_public_read ON public.polls FOR SELECT TO anon, authenticated USING (status IN ('active', 'closed'));

DROP POLICY IF EXISTS donations_public_read ON public.project_donations;
CREATE POLICY donations_public_read ON public.project_donations FOR SELECT TO anon, authenticated USING (true);
-- world_secrets, profanity_words, poll_votes: TANPA policy → tertutup total untuk anon.

-- Cabut semua hak tulis/baca default, lalu buka SELECT kolom publik saja.
REVOKE ALL ON public.world_states, public.world_secrets, public.profanity_words, public.citizens,
              public.land_plots, public.news_feed, public.polls, public.poll_votes, public.project_donations
  FROM anon, authenticated;

GRANT SELECT ON public.world_states, public.land_plots, public.news_feed, public.polls, public.project_donations
  TO anon, authenticated;

-- citizens: secret_token, ip_hash, recovery_* , follow_recheck_requested_at, ig_changed_at TIDAK di-grant.
GRANT SELECT (
  id, world_id, citizen_number, ktp_code, username, ig_username, follow_status, follow_checked_at,
  joined_day, rt_rw_address, avatar_color, avatar_style, tier_id, role_title, original_role_title,
  impeached_at, coins, total_donated, status_text, last_work_at, last_status_at, last_active_at, created_at
) ON public.citizens TO anon, authenticated;

REVOKE ALL ON SEQUENCE public.news_feed_id_seq FROM anon, authenticated;

-- Fungsi: cabut semua dari PUBLIC/anon/authenticated, lalu buka yang memang publik.
DO $$
DECLARE
  f RECORD;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE 'nv\_%' OR p.proname IN (
        'register_citizen_atomic', 'register_citizen_direct', 'get_my_citizen', 'set_recovery_pin', 'recover_session',
        'update_citizen_instagram', 'request_follow_recheck', 'claim_work_reward', 'post_status',
        'buy_land_plot', 'build_or_upgrade_property', 'rename_property', 'claim_property_income',
        'donate_to_project', 'get_project_top_donors', 'post_announcement', 'propose_poll', 'cast_poll_vote',
        'get_active_polls', 'get_map_citizens', 'get_leaderboard', 'get_my_ranks', 'set_world_secrets',
        'admin_login', 'admin_update_world', 'admin_get_follow_queue', 'batch_verify_followers',
        'impeach_unverified_elites', 'admin_restore_citizen', 'admin_create_poll', 'admin_list_pending_polls',
        'admin_moderate_poll', 'admin_moderate_content', 'admin_set_active_project'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $$;

-- Publik (anon): baca & mutasi warga ber-token & admin ber-PIN
GRANT EXECUTE ON FUNCTION
  public.register_citizen_direct(TEXT, TEXT, TEXT, TEXT, JSONB),
  public.get_my_citizen(TEXT, UUID, UUID),
  public.set_recovery_pin(TEXT, UUID, UUID, TEXT),
  public.recover_session(TEXT, TEXT, TEXT),
  public.update_citizen_instagram(TEXT, UUID, UUID, TEXT),
  public.request_follow_recheck(TEXT, UUID, UUID),
  public.claim_work_reward(TEXT, UUID, UUID),
  public.post_status(TEXT, UUID, UUID, TEXT),
  public.buy_land_plot(TEXT, UUID, UUID, TEXT),
  public.build_or_upgrade_property(TEXT, UUID, UUID, TEXT, TEXT, TEXT),
  public.rename_property(TEXT, UUID, UUID, TEXT, TEXT),
  public.claim_property_income(TEXT, UUID, UUID, TEXT),
  public.donate_to_project(TEXT, UUID, UUID, BIGINT),
  public.get_project_top_donors(TEXT, TEXT, INTEGER),
  public.post_announcement(TEXT, UUID, UUID, TEXT),
  public.propose_poll(TEXT, UUID, UUID, TEXT, TEXT[]),
  public.cast_poll_vote(TEXT, UUID, UUID, UUID, TEXT),
  public.get_active_polls(TEXT, UUID, UUID),
  public.get_map_citizens(TEXT, UUID, INTEGER),
  public.get_leaderboard(TEXT, TEXT, INTEGER, INTEGER, TEXT),
  public.get_my_ranks(TEXT, UUID),
  public.admin_login(TEXT, TEXT),
  public.admin_update_world(TEXT, TEXT, INTEGER, INTEGER, BOOLEAN),
  public.admin_get_follow_queue(TEXT, TEXT),
  public.batch_verify_followers(TEXT, TEXT, TEXT[], INTEGER, TIMESTAMPTZ, BOOLEAN),
  public.impeach_unverified_elites(TEXT, TEXT, INTEGER, INTEGER),
  public.admin_restore_citizen(TEXT, TEXT, UUID),
  public.admin_create_poll(TEXT, TEXT, TEXT, TEXT[], TEXT),
  public.admin_list_pending_polls(TEXT, TEXT),
  public.admin_moderate_poll(TEXT, TEXT, UUID, TEXT),
  public.admin_moderate_content(TEXT, TEXT, TEXT, TEXT),
  public.admin_set_active_project(TEXT, TEXT, TEXT, BOOLEAN)
TO anon, authenticated;

-- Hanya service_role (Edge Function) yang boleh pendaftaran ber-Turnstile.
GRANT EXECUTE ON FUNCTION public.register_citizen_atomic(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_world_secrets(TEXT, TEXT, TEXT) TO service_role;


-- >>> migrations/002_worker_checks.sql
-- =============================================================================
-- Migration 002: RPC khusus worker verifikasi follow.
--
-- batch_verify_followers (001) cocok untuk daftar followers LENGKAP (ekspor Meta): semua warga antrean
-- yang tidak ada di daftar ditandai 'not_following'. Worker otomatis hanya mengecek SEBAGIAN antrean
-- per run (dibatasi agar aman dari limit Instagram), jadi ia butuh RPC yang HANYA mengubah username
-- yang benar-benar sudah dicek: report_follow_checks.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.report_follow_checks(
  p_world_id TEXT,
  p_admin_secret TEXT,
  p_followers TEXT[],
  p_not_followers TEXT[],
  p_total_ig_followers INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_yes TEXT[];
  v_no TEXT[];
  v_verified INTEGER := 0;
  v_not INTEGER := 0;
  v_handle TEXT;
BEGIN
  IF NOT public.nv_admin_ok(p_world_id, p_admin_secret, TRUE) THEN RETURN public.nv_denied(); END IF;

  v_yes := ARRAY(SELECT DISTINCT lower(btrim(btrim(u), '@')) FROM unnest(coalesce(p_followers, '{}'::text[])) u WHERE btrim(coalesce(u, '')) <> '');
  v_no := ARRAY(SELECT DISTINCT lower(btrim(btrim(u), '@')) FROM unnest(coalesce(p_not_followers, '{}'::text[])) u WHERE btrim(coalesce(u, '')) <> '');
  -- username yang muncul di dua daftar dianggap follow (lebih aman bagi warga)
  v_no := ARRAY(SELECT x FROM unnest(v_no) x WHERE NOT (x = ANY (v_yes)));

  WITH upd AS (
    UPDATE public.citizens c
    SET follow_status = 'verified', follow_checked_at = now()
    WHERE c.world_id = p_world_id
      AND c.follow_status IN ('pending', 'recheck_requested', 'not_following')
      AND c.ig_username = ANY (v_yes)
    RETURNING c.id, c.username, c.citizen_number, c.role_title
  ), elite_news AS (
    INSERT INTO public.news_feed (world_id, citizen_id, category, message)
    SELECT p_world_id, u.id, 'verification', format('RESMI DILANTIK! %s — %s', public.nv_tag(u.username, u.citizen_number), u.role_title)
    FROM upd u WHERE u.citizen_number <= 30
    RETURNING 1
  )
  SELECT count(*) INTO v_verified FROM upd;

  UPDATE public.citizens c
  SET follow_status = 'not_following', follow_checked_at = now()
  WHERE c.world_id = p_world_id
    AND c.follow_status IN ('pending', 'recheck_requested')
    AND c.ig_username = ANY (v_no);
  GET DIAGNOSTICS v_not = ROW_COUNT;

  UPDATE public.world_states
  SET ig_follower_count = coalesce(p_total_ig_followers, ig_follower_count),
      followers_synced_at = CASE WHEN p_total_ig_followers IS NOT NULL THEN now() ELSE followers_synced_at END,
      updated_at = now()
  WHERE world_id = p_world_id
  RETURNING ig_account_handle INTO v_handle;

  IF v_verified > 0 THEN
    PERFORM public.nv_news(p_world_id, NULL, 'verification',
      format('PELANTIKAN: %s warga resmi dilantik setelah verifikasi follow @%s!', v_verified, v_handle));
  END IF;

  RETURN jsonb_build_object('ok', true, 'verified', v_verified, 'not_following', v_not, 'synced_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.report_follow_checks(TEXT, TEXT, TEXT[], TEXT[], INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_follow_checks(TEXT, TEXT, TEXT[], TEXT[], INTEGER) TO anon, authenticated;


-- >>> seed.sql
-- =============================================================================
-- GENERATED oleh scripts/generate-seed.ts — JANGAN edit manual.
-- Edit src/configs/worlds/*.ts lalu jalankan `npm run db:seed`.
-- Tidak membuat warga dummy: production selalu mulai dari 0 warga (strict FCFS).
-- =============================================================================

INSERT INTO public.profanity_words (word) VALUES
  ('anjing'),
  ('anjeng'),
  ('bangsat'),
  ('bajingan'),
  ('brengsek'),
  ('keparat'),
  ('kampret'),
  ('goblok'),
  ('tolol'),
  ('idiot'),
  ('kontol'),
  ('kntl'),
  ('memek'),
  ('ngentot'),
  ('ngentod'),
  ('ngewe'),
  ('jembut'),
  ('pepek'),
  ('peler'),
  ('pantek'),
  ('pukimak'),
  ('cukimai'),
  ('jancok'),
  ('jancuk'),
  ('dancok'),
  ('lonte'),
  ('pelacur'),
  ('perek'),
  ('jablay'),
  ('bokep'),
  ('porno'),
  ('bencong'),
  ('fuck'),
  ('shit'),
  ('bitch'),
  ('ashole'),
  ('bastard'),
  ('cunt'),
  ('whore'),
  ('slut'),
  ('pusy'),
  ('fagot'),
  ('niger'),
  ('niga'),
  ('retard'),
  ('hitler')
ON CONFLICT DO NOTHING;

-- Republik Konoha (republikkonoha.pages.dev)
INSERT INTO public.world_states (world_id, display_name, ig_account_handle, config, active_project_id, active_project_goal)
VALUES ('republik-konoha', 'Republik Konoha', 'republikkonoha', $cfg${"worldId":"republik-konoha","igAccountHandle":"republikkonoha","domain":"republikkonoha.pages.dev","ktpPrefix":"RK","currency":{"code":"RpK","name":"Rupiah Konoha"},"copy":{"citizenNoun":"Warga","guestLabel":"Tamu","registerCta":"Daftar Warga","ktpTitle":"KARTU TANDA PENDUDUK","ktpDisclaimer":"Kartu Tanda Penduduk versi virtual • bukan dokumen resmi","nationName":"Republik Konoha","nationShort":"Konoha","tvName":"Konoha TV","tagline":"1 Follower = 1 Warga. Klaim KTP-mu sebelum kursi pejabat habis!","stamps":{"pending":"MENUNGGU PELANTIKAN","verified":"DUKCAPIL SAH • RESMI DILANTIK","not_following":"BELUM FOLLOW / WARGA GELAP","impeached":"DIMAKZULKAN"}},"theme":{"primary":"#dc2626","accent":"#facc15","background":"#fef7ec","surface":"#ffffff","text":"#1f2937","muted":"#6b7280","ground":"#bbf7d0","road":"#94a3b8"},"tiers":[{"id":"head","preset":"head","name":"RI 1 (Presiden)","shortName":"RI 1","min":1,"max":1,"seatTitles":["Presiden Republik Konoha"],"titlePool":[],"nametagColor":"#facc15","ktpBorder":"#d4a017","zone":"palace","look":{"outfit":"suit","accessory":"crown","accentColor":"#dc2626"},"work":{"label":"Tanda Tangan Keppres","reward":60},"perks":{"canAnnounce":true,"canCreatePoll":true,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":10,"incomeBonusPct":20}},{"id":"deputy","preset":"deputy","name":"RI 2 (Wapres)","shortName":"RI 2","min":2,"max":2,"seatTitles":["Wakil Presiden Konoha"],"titlePool":[],"nametagColor":"#fde047","ktpBorder":"#d4a017","zone":"palace","look":{"outfit":"suit","accessory":"star","accentColor":"#eab308"},"work":{"label":"Gunting Pita Peresmian","reward":50},"perks":{"canAnnounce":true,"canCreatePoll":true,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":10,"incomeBonusPct":15}},{"id":"cabinet","preset":"cabinet","name":"Kabinet Menteri","shortName":"MENTERI","min":3,"max":30,"seatTitles":["Menteri Keuangan","Menteri Perkopian & WFA","Menteri Urusan Gabut","Menteri Sinyal & Kuota","Menteri Perparkiran","Menteri Per-Healing-an","Menteri Urusan Mantan","Menteri Gorengan & Cilok","Menteri Pertahanan Dompet","Menteri Konten & FYP","Menteri Urusan Rebahan","Menteri Percintaan & Ghosting","Menteri Perbucinan Nasional","Menteri Diskon & Flash Sale","Menteri Urusan Grup WA Keluarga","Menteri Per-Ojol-an","Menteri Kemacetan","Menteri Hujan & Banjir Kiriman","Menteri Skincare & Glowing","Menteri Utang Piutang","Menteri Begadang & Insomnia","Menteri Urusan Kos-kosan","Menteri Perbaksoan","Menteri Urusan Deadline","Menteri Overthinking","Menteri Wacana & Rencana","Menteri Senam Pagi (Kalau Bangun)","Menteri Sekretaris Grup Chat"],"titlePool":[],"nametagColor":"#fbbf24","ktpBorder":"#c9a227","zone":"ring1","look":{"outfit":"suit","accessory":"nametag","accentColor":"#1d4ed8"},"work":{"label":"Rapat Paripurna","reward":40},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":10}},{"id":"council","preset":"council","name":"Senayan & Pejabat","shortName":"DPR","min":31,"max":60,"seatTitles":["Ketua DPR","Wakil Ketua DPR","Wakil Ketua DPR","Ketua Fraksi Rebahan"],"titlePool":["Anggota Dewan","Anggota Dewan Komisi Nongkrong","Anggota Dewan (Sering Absen)","Stafsus Presiden","Stafsus Milenial","Gubernur Ibukota","Gubernur Provinsi Sebelah","Walikota","Bupati","Juru Bicara Istana"],"nametagColor":"#7dd3fc","ktpBorder":"#0ea5e9","zone":"parliament","look":{"outfit":"formal","accessory":"pin","accentColor":"#0ea5e9"},"work":{"label":"Rapat Sambil Tidur","reward":35},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":5}},{"id":"elite","preset":"elite","name":"Konglomerat / Naga","shortName":"KONGLO","min":61,"max":100,"seatTitles":[],"titlePool":["Bos Tambang","Sultan Properti","Owner Bank","Bos Sawit","Investor Asing","Juragan Batu Bara","Raja Ritel","Taipan Media","Crazy Rich Pinggiran","Pewaris Tunggal"],"nametagColor":"#c084fc","ktpBorder":"#9333ea","zone":"elite_complex","look":{"outfit":"suit","accessory":"sunglasses","accentColor":"#7c3aed"},"work":{"label":"Cairin Dividen","reward":45},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":20,"incomeBonusPct":10}},{"id":"ring2","preset":"ring2","name":"Ring 2 & Orang Dalam","shortName":"RING 2","min":101,"max":250,"seatTitles":[],"titlePool":["Komisaris BUMN","Artis Ibukota","Influencer Centang Biru","Pengacara Kondang","Selebgram Endorse","Podcaster Viral","Dokter Estetika","YouTuber Gaming","Konsultan Startup","Pemilik Klub Bola"],"nametagColor":"#2dd4bf","ktpBorder":"#0d9488","zone":"commercial","look":{"outfit":"casual","accessory":"sparkle","accentColor":"#14b8a6"},"work":{"label":"Endorse Produk","reward":28},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":5}},{"id":"grassroot","preset":"grassroot","name":"Penguasa Akar Rumput","shortName":"AKAR RUMPUT","min":251,"max":500,"seatTitles":[],"titlePool":["Ketua Ormas","Juragan Kosan","Ketua RT","Ketua RW","ASN Senior","Mandor Proyek","Lurah","Ketua Karang Taruna","Bendahara Arisan","Ketua Panitia 17-an"],"nametagColor":"#fb923c","ktpBorder":"#c2410c","zone":"residential","look":{"outfit":"uniform","accessory":"cap","accentColor":"#ea580c"},"work":{"label":"Rapat Koordinasi Warga","reward":22},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":0}},{"id":"street","preset":"street","name":"Ikon Jalanan & Pekerja","shortName":"PEKERJA","min":501,"max":1000,"seatTitles":[],"titlePool":["Penjaga Warung Madura 24 Jam","Driver Ojol","Kang Parkir Minimarket","Barista SCBD","Karyawan Swasta","Kurir Paket","Tukang Bakso Keliling","Satpam Kompleks","Kasir Minimarket","Admin Olshop"],"nametagColor":"#a3e635","ktpBorder":"#65a30d","zone":"gate","look":{"outfit":"jacket","accessory":"helmet","accentColor":"#16a34a"},"work":{"label":"Narik Orderan","reward":18},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}},{"id":"civil","preset":"civil","name":"Rakyat Jelata (Sipil)","shortName":"RAKYAT","min":1001,"max":null,"seatTitles":[],"titlePool":["Mahasiswa Abadi","Sobat Misqueen","Pengangguran Banyak Acara","Pejuang UMR","Kaum Rebahan","Fresh Graduate Galau","Freelancer Dikejar Deadline","Pemburu Promo","Penonton Drakor Garis Keras","Wibu Lokal","Pencari Kerja Profesional","Anak Senja"],"nametagColor":"#e5e7eb","ktpBorder":"#6b7280","zone":"anywhere","look":{"outfit":"casual","accessory":"none","accentColor":"#64748b"},"work":{"label":"Cari Cuan Halal","reward":12},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}}],"impeachedTier":{"id":"impeached","preset":"civil","name":"Warga Gelap (Dimakzulkan)","shortName":"GELAP","min":0,"max":0,"seatTitles":[],"titlePool":[],"nametagColor":"#9ca3af","ktpBorder":"#4b5563","zone":"anywhere","look":{"outfit":"casual","accessory":"none","accentColor":"#64748b"},"work":{"label":"Cari Cuan Halal","reward":9},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}},"buildings":[{"id":"rumah_sederhana","name":"Rumah Sederhana","category":"residential","emoji":"🏠","baseCost":100,"incomePerLevelPerDay":8,"color":"#f59e0b","upgradeMultiplier":1.6,"maxLevel":5},{"id":"kosan","name":"Kos-kosan 10 Pintu","category":"residential","emoji":"🏘️","baseCost":250,"incomePerLevelPerDay":20,"color":"#fb7185","upgradeMultiplier":1.6,"maxLevel":5},{"id":"rumah_minimalis","name":"Rumah Minimalis","category":"residential","emoji":"🏡","baseCost":400,"incomePerLevelPerDay":30,"color":"#94a3b8","upgradeMultiplier":1.6,"maxLevel":5},{"id":"villa_sultan","name":"Villa Sultan","category":"residential","emoji":"🏰","baseCost":900,"incomePerLevelPerDay":65,"color":"#fcd34d","upgradeMultiplier":1.6,"maxLevel":5},{"id":"mansion_helipad","name":"Mansion Helipad","category":"residential","emoji":"🚁","baseCost":2000,"incomePerLevelPerDay":140,"color":"#a78bfa","upgradeMultiplier":1.6,"maxLevel":5},{"id":"gerobak_kopi","name":"Gerobak Kopi / Angkringan","category":"commercial","emoji":"☕","baseCost":80,"incomePerLevelPerDay":10,"color":"#92400e","upgradeMultiplier":1.6,"maxLevel":5},{"id":"warung_kelontong","name":"Warung Kelontong","category":"commercial","emoji":"🏪","baseCost":200,"incomePerLevelPerDay":22,"color":"#ef4444","upgradeMultiplier":1.6,"maxLevel":5},{"id":"ruko_seblak","name":"Ruko Seblak","category":"commercial","emoji":"🌶️","baseCost":350,"incomePerLevelPerDay":35,"color":"#f97316","upgradeMultiplier":1.6,"maxLevel":5},{"id":"kafe_scbd","name":"Kafe SCBD","category":"commercial","emoji":"🧋","baseCost":800,"incomePerLevelPerDay":75,"color":"#14b8a6","upgradeMultiplier":1.6,"maxLevel":5},{"id":"gedung_kantor","name":"Gedung Pencakar Langit / Kantor PT","category":"commercial","emoji":"🏢","baseCost":1800,"incomePerLevelPerDay":160,"color":"#3b82f6","upgradeMultiplier":1.6,"maxLevel":5},{"id":"pos_ronda","name":"Pos Ronda","category":"government","emoji":"🛖","baseCost":150,"incomePerLevelPerDay":12,"color":"#a16207","upgradeMultiplier":1.6,"maxLevel":5,"requiresPerk":"canBuildGovernment"},{"id":"balai_rt","name":"Balai RT","category":"government","emoji":"🏛️","baseCost":300,"incomePerLevelPerDay":25,"color":"#15803d","upgradeMultiplier":1.6,"maxLevel":5,"requiresPerk":"canBuildGovernment"},{"id":"kantor_kementerian","name":"Kantor Kementerian Cabang","category":"government","emoji":"🏤","baseCost":900,"incomePerLevelPerDay":80,"color":"#1e40af","upgradeMultiplier":1.6,"maxLevel":5,"requiresPerk":"canBuildGovernment"},{"id":"patung_monumen","name":"Patung Monumen Pribadi","category":"government","emoji":"🗿","baseCost":1200,"incomePerLevelPerDay":50,"color":"#6b7280","upgradeMultiplier":1.6,"maxLevel":5,"requiresPerk":"canBuildGovernment"}],"projects":[{"id":"mrt_konoha","name":"Stasiun MRT Konoha","description":"Biar warga nggak telat absen lagi.","emoji":"🚇","goal":50000},{"id":"tol_layang","name":"Jalan Tol Layang Konoha","description":"Macet pindah ke atas.","emoji":"🛣️","goal":120000},{"id":"bandara_konoha","name":"Bandara Internasional Konoha","description":"Gerbang mudik & healing ke luar negeri.","emoji":"✈️","goal":250000},{"id":"stadion_konoha","name":"Stadion GBK Konoha","description":"Buat nobar & konser comeback.","emoji":"🏟️","goal":500000}],"landmarks":[{"id":"tugu","kind":"plaza","name":"Alun-Alun Tugu Konoha","emoji":"🗼"},{"id":"istana","kind":"palace","name":"Istana Negara","emoji":"🏛️"},{"id":"dpr","kind":"parliament","name":"Gedung DPR","emoji":"🐢"},{"id":"konglo","kind":"elite_complex","name":"Kompleks Konglomerat","emoji":"🚁"},{"id":"warung_madura","kind":"shop","name":"Warung Madura 24 Jam","emoji":"🏪"},{"id":"gerbang","kind":"gate","name":"Gerbang Konoha & Pangkalan Ojol","emoji":"🛵"},{"id":"proyek","kind":"project_site","name":"Zona Proyek Nasional","emoji":"🚧"}],"economy":{"startingCoins":20,"workCooldownMinutes":120,"statusCooldownMinutes":10,"statusMaxLength":50,"announcementMaxLength":160,"igChangeCooldownMinutes":30,"recheckCooldownMinutes":60,"pollProposalCooldownMinutes":360,"land":{"basePrice":200,"ringDecayPct":25,"minPrice":50,"innerLayerBonusPct":20,"maxPlotsPerCitizen":5},"income":{"maxAccrualHours":24},"requireVerified":{"buyLand":true,"build":true,"donate":true,"vote":true,"governance":true}},"map":{"coreRadius":3,"layersPerRing":2,"ringMilestones":[0,100,500,1000,2500,5000,10000,25000,50000,100000],"occupancyUnlockPct":80,"ringNames":["Inti Pusat","Distrik Perintis","Distrik Kota Baru","Megapolitan"],"ringNameFallback":"Ekspansi Ring {n}"},"registration":{"softGateFollow":false,"softGateDelaySeconds":3,"displayNameMaxLength":16,"maxRegistrationsPerIp24h":2,"avatarColors":["#ef4444","#f97316","#eab308","#22c55e","#14b8a6","#3b82f6","#8b5cf6","#ec4899","#78716c","#0f172a"],"avatarAccessories":["none","cap","hat","sunglasses","helmet"]},"verification":{"checkWindowHours":24,"impeachAfterHours":48,"impeachMaxNumber":100},"sandbox":{"workCooldownMinutes":1,"statusCooldownMinutes":0.25,"igChangeCooldownMinutes":0.25,"recheckCooldownMinutes":0.25,"pollProposalCooldownMinutes":0.5}}$cfg$::jsonb, 'mrt_konoha', 50000)
ON CONFLICT (world_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  ig_account_handle = EXCLUDED.ig_account_handle,
  config = EXCLUDED.config,
  active_project_goal = CASE WHEN public.world_states.active_project_id = '' THEN EXCLUDED.active_project_goal ELSE public.world_states.active_project_goal END,
  active_project_id = CASE WHEN public.world_states.active_project_id = '' THEN EXCLUDED.active_project_id ELSE public.world_states.active_project_id END,
  updated_at = now();

-- PT Virtual SCBD (ptvirtual.pages.dev)
INSERT INTO public.world_states (world_id, display_name, ig_account_handle, config, active_project_id, active_project_goal)
VALUES ('pt-virtual', 'PT Virtual SCBD', 'ptvirtualscbd', $cfg${"worldId":"pt-virtual","igAccountHandle":"ptvirtualscbd","domain":"ptvirtual.pages.dev","ktpPrefix":"PV","currency":{"code":"Gaji","name":"Gaji Bulanan"},"copy":{"citizenNoun":"Karyawan","guestLabel":"Tamu","registerCta":"Lamar Kerja","ktpTitle":"ID CARD KARYAWAN","ktpDisclaimer":"ID Card karyawan virtual • bukan dokumen resmi","nationName":"PT Virtual SCBD","nationShort":"PT Virtual","tvName":"Info Internal","tagline":"1 Follower = 1 Karyawan. Rebut kursi CEO sebelum diambil anak magang!","stamps":{"pending":"MASA PERCOBAAN","verified":"KARYAWAN TETAP • SAH","not_following":"BELUM FOLLOW / KARYAWAN BAYANGAN","impeached":"DI-PHK"}},"theme":{"primary":"#0f172a","accent":"#38bdf8","background":"#f1f5f9","surface":"#ffffff","text":"#0f172a","muted":"#64748b","ground":"#e2e8f0","road":"#475569"},"tiers":[{"id":"head","preset":"head","name":"CEO & Founder","shortName":"CEO","min":1,"max":1,"seatTitles":["CEO & Founder"],"titlePool":[],"nametagColor":"#facc15","ktpBorder":"#d4a017","zone":"palace","look":{"outfit":"suit","accessory":"crown","accentColor":"#dc2626"},"work":{"label":"Pitching ke Investor","reward":60},"perks":{"canAnnounce":true,"canCreatePoll":true,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":10,"incomeBonusPct":20}},{"id":"deputy","preset":"deputy","name":"Komisaris Utama","shortName":"KOMUT","min":2,"max":2,"seatTitles":["Komisaris Utama"],"titlePool":[],"nametagColor":"#fde047","ktpBorder":"#d4a017","zone":"palace","look":{"outfit":"suit","accessory":"star","accentColor":"#eab308"},"work":{"label":"Tanda Tangan Laporan","reward":50},"perks":{"canAnnounce":true,"canCreatePoll":true,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":10,"incomeBonusPct":15}},{"id":"cabinet","preset":"cabinet","name":"Jajaran Direksi","shortName":"DIREKTUR","min":3,"max":30,"seatTitles":["CFO","CTO","CMO","COO","Direktur HRD","Direktur Kopi & Snack","Direktur Wi-Fi Kantor","Direktur Lembur"],"titlePool":["Direktur Cabang","Direktur Divisi Rahasia","Direktur Inovasi Wacana","Direktur Meeting Dadakan"],"nametagColor":"#fbbf24","ktpBorder":"#c9a227","zone":"ring1","look":{"outfit":"suit","accessory":"nametag","accentColor":"#1d4ed8"},"work":{"label":"Rapat Direksi","reward":40},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":10}},{"id":"council","preset":"council","name":"HRD & Head of","shortName":"HEAD","min":31,"max":60,"seatTitles":[],"titlePool":["HRD Galak","Head of People","Head of Growth","Head of Sales","Head of Design","Head of Engineering"],"nametagColor":"#7dd3fc","ktpBorder":"#0ea5e9","zone":"parliament","look":{"outfit":"formal","accessory":"pin","accentColor":"#0ea5e9"},"work":{"label":"Interview Kandidat","reward":35},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":5}},{"id":"elite","preset":"elite","name":"Manager","shortName":"MANAGER","min":61,"max":100,"seatTitles":[],"titlePool":["Project Manager","Product Manager","Sales Manager","Marketing Manager","Finance Manager"],"nametagColor":"#c084fc","ktpBorder":"#9333ea","zone":"elite_complex","look":{"outfit":"suit","accessory":"sunglasses","accentColor":"#7c3aed"},"work":{"label":"Bikin Slide KPI","reward":45},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":20,"incomeBonusPct":10}},{"id":"ring2","preset":"ring2","name":"Senior","shortName":"SENIOR","min":101,"max":250,"seatTitles":[],"titlePool":["Senior Engineer","Senior Designer","Senior Analyst","Senior Copywriter","Senior Accountant"],"nametagColor":"#2dd4bf","ktpBorder":"#0d9488","zone":"commercial","look":{"outfit":"casual","accessory":"sparkle","accentColor":"#14b8a6"},"work":{"label":"Review Kerjaan Junior","reward":28},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":5}},{"id":"grassroot","preset":"grassroot","name":"Staff Tetap","shortName":"STAFF","min":251,"max":500,"seatTitles":[],"titlePool":["Staff Admin","Staff Finance","Staff Marketing","Staff IT Support","Staff Legal"],"nametagColor":"#fb923c","ktpBorder":"#c2410c","zone":"residential","look":{"outfit":"uniform","accessory":"cap","accentColor":"#ea580c"},"work":{"label":"Kerjain Tiket","reward":22},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":0}},{"id":"street","preset":"street","name":"Staff Kontrak","shortName":"KONTRAK","min":501,"max":1000,"seatTitles":[],"titlePool":["Office Boy","Resepsionis","Kurir Kantor","Satpam Lobby","Outsourcing IT"],"nametagColor":"#a3e635","ktpBorder":"#65a30d","zone":"gate","look":{"outfit":"jacket","accessory":"helmet","accentColor":"#16a34a"},"work":{"label":"Lembur Tanpa Dibayar","reward":18},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}},{"id":"civil","preset":"civil","name":"Anak Magang","shortName":"MAGANG","min":1001,"max":null,"seatTitles":[],"titlePool":["Anak Magang Unpaid","Magang Fotokopi","Magang Pembeli Kopi","Freelancer Lepas","Calon Karyawan Abadi"],"nametagColor":"#e5e7eb","ktpBorder":"#6b7280","zone":"anywhere","look":{"outfit":"casual","accessory":"none","accentColor":"#64748b"},"work":{"label":"Fotokopi Dokumen","reward":12},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}}],"impeachedTier":{"id":"impeached","preset":"civil","name":"Warga Gelap (Dimakzulkan)","shortName":"GELAP","min":0,"max":0,"seatTitles":[],"titlePool":[],"nametagColor":"#9ca3af","ktpBorder":"#4b5563","zone":"anywhere","look":{"outfit":"casual","accessory":"none","accentColor":"#64748b"},"work":{"label":"Fotokopi Dokumen","reward":9},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}},"buildings":[{"id":"kubikel","name":"Kubikel Pribadi","category":"residential","emoji":"🪑","baseCost":100,"incomePerLevelPerDay":8,"color":"#94a3b8","upgradeMultiplier":1.6,"maxLevel":5},{"id":"ruang_meeting","name":"Ruang Meeting","category":"commercial","emoji":"📊","baseCost":250,"incomePerLevelPerDay":22,"color":"#38bdf8","upgradeMultiplier":1.6,"maxLevel":5},{"id":"pantry","name":"Pantry Gratis","category":"commercial","emoji":"🍩","baseCost":200,"incomePerLevelPerDay":18,"color":"#f97316","upgradeMultiplier":1.6,"maxLevel":5},{"id":"kafe_kopi","name":"Kafe Kopi Lobby","category":"commercial","emoji":"☕","baseCost":400,"incomePerLevelPerDay":35,"color":"#92400e","upgradeMultiplier":1.6,"maxLevel":5},{"id":"coworking","name":"Coworking Space","category":"commercial","emoji":"💻","baseCost":900,"incomePerLevelPerDay":75,"color":"#14b8a6","upgradeMultiplier":1.6,"maxLevel":5},{"id":"rooftop_lounge","name":"Rooftop Lounge","category":"residential","emoji":"🌇","baseCost":1800,"incomePerLevelPerDay":150,"color":"#a78bfa","upgradeMultiplier":1.6,"maxLevel":5},{"id":"ruang_hrd","name":"Ruang HRD","category":"government","emoji":"📁","baseCost":300,"incomePerLevelPerDay":25,"color":"#1e40af","upgradeMultiplier":1.6,"maxLevel":5,"requiresPerk":"canBuildGovernment"},{"id":"ruang_direksi","name":"Ruang Direksi","category":"government","emoji":"🏢","baseCost":1200,"incomePerLevelPerDay":90,"color":"#0f172a","upgradeMultiplier":1.6,"maxLevel":5,"requiresPerk":"canBuildGovernment"}],"projects":[{"id":"mesin_kopi","name":"Mesin Kopi Premium","description":"Produktivitas naik 200%.","emoji":"☕","goal":50000},{"id":"rooftop","name":"Rooftop Bar Kantor","description":"Healing tanpa cuti.","emoji":"🌆","goal":120000},{"id":"thr_cair","name":"THR Cair Tepat Waktu","description":"Mitos yang ingin dibuktikan.","emoji":"💸","goal":250000}],"landmarks":[{"id":"lobby","kind":"plaza","name":"Lobby Utama","emoji":"🛎️"},{"id":"ruang_ceo","kind":"palace","name":"Ruang CEO Lantai 50","emoji":"🏙️"},{"id":"ruang_rapat","kind":"parliament","name":"Ruang Rapat Besar","emoji":"📽️"},{"id":"lounge","kind":"elite_complex","name":"Executive Lounge","emoji":"🥂"},{"id":"minimarket","kind":"shop","name":"Minimarket Basement","emoji":"🏪"},{"id":"parkiran","kind":"gate","name":"Gerbang Parkir & Ojol","emoji":"🛵"},{"id":"proyek","kind":"project_site","name":"Zona Renovasi","emoji":"🚧"}],"economy":{"startingCoins":20,"workCooldownMinutes":120,"statusCooldownMinutes":10,"statusMaxLength":50,"announcementMaxLength":160,"igChangeCooldownMinutes":30,"recheckCooldownMinutes":60,"pollProposalCooldownMinutes":360,"land":{"basePrice":200,"ringDecayPct":25,"minPrice":50,"innerLayerBonusPct":20,"maxPlotsPerCitizen":5},"income":{"maxAccrualHours":24},"requireVerified":{"buyLand":true,"build":true,"donate":true,"vote":true,"governance":true}},"map":{"coreRadius":3,"layersPerRing":2,"ringMilestones":[0,100,500,1000,2500,5000,10000,25000,50000,100000],"occupancyUnlockPct":80,"ringNames":["Inti Pusat","Distrik Perintis","Distrik Kota Baru","Megapolitan"],"ringNameFallback":"Ekspansi Ring {n}"},"registration":{"softGateFollow":false,"softGateDelaySeconds":3,"displayNameMaxLength":16,"maxRegistrationsPerIp24h":2,"avatarColors":["#ef4444","#f97316","#eab308","#22c55e","#14b8a6","#3b82f6","#8b5cf6","#ec4899","#78716c","#0f172a"],"avatarAccessories":["none","cap","hat","sunglasses","helmet"]},"verification":{"checkWindowHours":24,"impeachAfterHours":48,"impeachMaxNumber":100},"sandbox":{"workCooldownMinutes":1,"statusCooldownMinutes":0.25,"igChangeCooldownMinutes":0.25,"recheckCooldownMinutes":0.25,"pollProposalCooldownMinutes":0.5}}$cfg$::jsonb, 'mesin_kopi', 50000)
ON CONFLICT (world_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  ig_account_handle = EXCLUDED.ig_account_handle,
  config = EXCLUDED.config,
  active_project_goal = CASE WHEN public.world_states.active_project_id = '' THEN EXCLUDED.active_project_goal ELSE public.world_states.active_project_goal END,
  active_project_id = CASE WHEN public.world_states.active_project_id = '' THEN EXCLUDED.active_project_id ELSE public.world_states.active_project_id END,
  updated_at = now();

-- Kampus Konoha (kampusvirtual.pages.dev)
INSERT INTO public.world_states (world_id, display_name, ig_account_handle, config, active_project_id, active_project_goal)
VALUES ('kampus-virtual', 'Kampus Konoha', 'kampusvirtual', $cfg${"worldId":"kampus-virtual","igAccountHandle":"kampusvirtual","domain":"kampusvirtual.pages.dev","ktpPrefix":"KV","currency":{"code":"SKS","name":"Satuan Kredit Semester"},"copy":{"citizenNoun":"Mahasiswa","guestLabel":"Tamu","registerCta":"Daftar Ulang","ktpTitle":"KARTU TANDA MAHASISWA","ktpDisclaimer":"KTM virtual • bukan dokumen resmi","nationName":"Kampus Konoha","nationShort":"Kampus","tvName":"Radio Kampus","tagline":"1 Follower = 1 Mahasiswa. Siapa cepat dia jadi Rektor!","stamps":{"pending":"MENUNGGU HER-REGISTRASI","verified":"MAHASISWA AKTIF • SAH","not_following":"BELUM FOLLOW / MAHASISWA GAIB","impeached":"DROP OUT"}},"theme":{"primary":"#1d4ed8","accent":"#f59e0b","background":"#eff6ff","surface":"#ffffff","text":"#1e293b","muted":"#64748b","ground":"#bbf7d0","road":"#a8a29e"},"tiers":[{"id":"head","preset":"head","name":"Rektor","shortName":"REKTOR","min":1,"max":1,"seatTitles":["Rektor Magnifisus"],"titlePool":[],"nametagColor":"#facc15","ktpBorder":"#d4a017","zone":"palace","look":{"outfit":"suit","accessory":"crown","accentColor":"#dc2626"},"work":{"label":"Wisuda Mahasiswa","reward":60},"perks":{"canAnnounce":true,"canCreatePoll":true,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":10,"incomeBonusPct":20}},{"id":"deputy","preset":"deputy","name":"Wakil Rektor","shortName":"WAREK","min":2,"max":2,"seatTitles":["Wakil Rektor Bidang Kemahasiswaan"],"titlePool":[],"nametagColor":"#fde047","ktpBorder":"#d4a017","zone":"palace","look":{"outfit":"suit","accessory":"star","accentColor":"#eab308"},"work":{"label":"Sambutan Ospek","reward":50},"perks":{"canAnnounce":true,"canCreatePoll":true,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":10,"incomeBonusPct":15}},{"id":"cabinet","preset":"cabinet","name":"Dekan & Kaprodi","shortName":"DEKAN","min":3,"max":30,"seatTitles":["Dekan Teknik","Dekan Ekonomi","Dekan Hukum","Dekan Kedokteran","Dekan Ilmu Rebahan"],"titlePool":["Kaprodi","Sekprodi","Kepala Lab","Kepala Perpus"],"nametagColor":"#fbbf24","ktpBorder":"#c9a227","zone":"ring1","look":{"outfit":"suit","accessory":"nametag","accentColor":"#1d4ed8"},"work":{"label":"Tanda Tangan Transkrip","reward":40},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":10}},{"id":"council","preset":"council","name":"Dosen Killer","shortName":"DOSEN","min":31,"max":60,"seatTitles":[],"titlePool":["Dosen Killer","Dosen Pembimbing Ghosting","Dosen Tamu","Asisten Dosen","Dosen Absen Mulu"],"nametagColor":"#7dd3fc","ktpBorder":"#0ea5e9","zone":"parliament","look":{"outfit":"formal","accessory":"pin","accentColor":"#0ea5e9"},"work":{"label":"Kasih Nilai C","reward":35},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":5}},{"id":"elite","preset":"elite","name":"Ketua BEM & Ormawa","shortName":"BEM","min":61,"max":100,"seatTitles":["Ketua BEM","Wakil Ketua BEM"],"titlePool":["Ketua Himpunan","Ketua UKM","Menteri BEM","Ketua DPM"],"nametagColor":"#c084fc","ktpBorder":"#9333ea","zone":"elite_complex","look":{"outfit":"suit","accessory":"sunglasses","accentColor":"#7c3aed"},"work":{"label":"Demo Damai","reward":45},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":20,"incomeBonusPct":10}},{"id":"ring2","preset":"ring2","name":"Senior & Aktivis","shortName":"SENIOR","min":101,"max":250,"seatTitles":[],"titlePool":["Senior Galak","Aktivis Kampus","Mapres","Asisten Lab","Panitia Ospek"],"nametagColor":"#2dd4bf","ktpBorder":"#0d9488","zone":"commercial","look":{"outfit":"casual","accessory":"sparkle","accentColor":"#14b8a6"},"work":{"label":"Ngader Maba","reward":28},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":5}},{"id":"grassroot","preset":"grassroot","name":"Kura-kura (Kuliah Rapat)","shortName":"KURA2","min":251,"max":500,"seatTitles":[],"titlePool":["Anak Organisasi","Sie Konsumsi","Bendahara Himpunan","Humas Event"],"nametagColor":"#fb923c","ktpBorder":"#c2410c","zone":"residential","look":{"outfit":"uniform","accessory":"cap","accentColor":"#ea580c"},"work":{"label":"Rapat Proker","reward":22},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":0}},{"id":"street","preset":"street","name":"Kupu-kupu (Kuliah Pulang)","shortName":"KUPU2","min":501,"max":1000,"seatTitles":[],"titlePool":["Mahasiswa Kupu-kupu","Penghuni Kantin","Titip Absen Pro","Anak Kos Hemat"],"nametagColor":"#a3e635","ktpBorder":"#65a30d","zone":"gate","look":{"outfit":"jacket","accessory":"helmet","accentColor":"#16a34a"},"work":{"label":"Ngerjain Tugas","reward":18},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}},{"id":"civil","preset":"civil","name":"Maba Abadi","shortName":"MABA","min":1001,"max":null,"seatTitles":[],"titlePool":["Maba Polos","Mahasiswa Semester 14","Pejuang Skripsi","Mahasiswa Ilmu Rebahan","Penunggu Dosen Pembimbing"],"nametagColor":"#e5e7eb","ktpBorder":"#6b7280","zone":"anywhere","look":{"outfit":"casual","accessory":"none","accentColor":"#64748b"},"work":{"label":"Revisi Skripsi","reward":12},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}}],"impeachedTier":{"id":"impeached","preset":"civil","name":"Warga Gelap (Dimakzulkan)","shortName":"GELAP","min":0,"max":0,"seatTitles":[],"titlePool":[],"nametagColor":"#9ca3af","ktpBorder":"#4b5563","zone":"anywhere","look":{"outfit":"casual","accessory":"none","accentColor":"#64748b"},"work":{"label":"Revisi Skripsi","reward":9},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}},"buildings":[{"id":"kos_mahasiswa","name":"Kos Mahasiswa","category":"residential","emoji":"🛏️","baseCost":100,"incomePerLevelPerDay":8,"color":"#f59e0b","upgradeMultiplier":1.6,"maxLevel":5},{"id":"kontrakan","name":"Kontrakan Rame-rame","category":"residential","emoji":"🏘️","baseCost":300,"incomePerLevelPerDay":24,"color":"#fb7185","upgradeMultiplier":1.6,"maxLevel":5},{"id":"kantin","name":"Kantin Murah","category":"commercial","emoji":"🍜","baseCost":150,"incomePerLevelPerDay":14,"color":"#ef4444","upgradeMultiplier":1.6,"maxLevel":5},{"id":"fotokopi","name":"Fotokopi & Print 24 Jam","category":"commercial","emoji":"🖨️","baseCost":250,"incomePerLevelPerDay":22,"color":"#64748b","upgradeMultiplier":1.6,"maxLevel":5},{"id":"kafe_nugas","name":"Kafe Nugas","category":"commercial","emoji":"☕","baseCost":700,"incomePerLevelPerDay":60,"color":"#92400e","upgradeMultiplier":1.6,"maxLevel":5},{"id":"perpus_mini","name":"Perpus Mini","category":"community","emoji":"📚","baseCost":400,"incomePerLevelPerDay":30,"color":"#16a34a","upgradeMultiplier":1.6,"maxLevel":5},{"id":"sekretariat","name":"Sekretariat Himpunan","category":"government","emoji":"🏫","baseCost":300,"incomePerLevelPerDay":25,"color":"#1d4ed8","upgradeMultiplier":1.6,"maxLevel":5,"requiresPerk":"canBuildGovernment"},{"id":"gedung_fakultas","name":"Gedung Fakultas","category":"government","emoji":"🏛️","baseCost":1500,"incomePerLevelPerDay":120,"color":"#0f172a","upgradeMultiplier":1.6,"maxLevel":5,"requiresPerk":"canBuildGovernment"}],"projects":[{"id":"ac_kelas","name":"AC Kelas Nyala Semua","description":"Biar nggak kuliah sambil sauna.","emoji":"❄️","goal":50000},{"id":"parkiran","name":"Parkiran Motor Beratap","description":"Jok nggak panas lagi.","emoji":"🏍️","goal":120000},{"id":"wifi_kampus","name":"Wi-Fi Kampus Kenceng","description":"Bukan cuma nama SSID.","emoji":"📶","goal":250000}],"landmarks":[{"id":"lapangan","kind":"plaza","name":"Lapangan Upacara","emoji":"🏳️"},{"id":"rektorat","kind":"palace","name":"Gedung Rektorat","emoji":"🏛️"},{"id":"aula","kind":"parliament","name":"Aula Senat","emoji":"🎓"},{"id":"gedung_pasca","kind":"elite_complex","name":"Gedung Pascasarjana","emoji":"🏢"},{"id":"koperasi","kind":"shop","name":"Koperasi Mahasiswa","emoji":"🏪"},{"id":"gerbang","kind":"gate","name":"Gerbang Kampus & Pangkalan Ojol","emoji":"🛵"},{"id":"proyek","kind":"project_site","name":"Zona Pembangunan Kampus","emoji":"🚧"}],"economy":{"startingCoins":20,"workCooldownMinutes":120,"statusCooldownMinutes":10,"statusMaxLength":50,"announcementMaxLength":160,"igChangeCooldownMinutes":30,"recheckCooldownMinutes":60,"pollProposalCooldownMinutes":360,"land":{"basePrice":200,"ringDecayPct":25,"minPrice":50,"innerLayerBonusPct":20,"maxPlotsPerCitizen":5},"income":{"maxAccrualHours":24},"requireVerified":{"buyLand":true,"build":true,"donate":true,"vote":true,"governance":true}},"map":{"coreRadius":3,"layersPerRing":2,"ringMilestones":[0,100,500,1000,2500,5000,10000,25000,50000,100000],"occupancyUnlockPct":80,"ringNames":["Inti Pusat","Distrik Perintis","Distrik Kota Baru","Megapolitan"],"ringNameFallback":"Ekspansi Ring {n}"},"registration":{"softGateFollow":false,"softGateDelaySeconds":3,"displayNameMaxLength":16,"maxRegistrationsPerIp24h":2,"avatarColors":["#ef4444","#f97316","#eab308","#22c55e","#14b8a6","#3b82f6","#8b5cf6","#ec4899","#78716c","#0f172a"],"avatarAccessories":["none","cap","hat","sunglasses","helmet"]},"verification":{"checkWindowHours":24,"impeachAfterHours":48,"impeachMaxNumber":100},"sandbox":{"workCooldownMinutes":1,"statusCooldownMinutes":0.25,"igChangeCooldownMinutes":0.25,"recheckCooldownMinutes":0.25,"pollProposalCooldownMinutes":0.5}}$cfg$::jsonb, 'ac_kelas', 50000)
ON CONFLICT (world_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  ig_account_handle = EXCLUDED.ig_account_handle,
  config = EXCLUDED.config,
  active_project_goal = CASE WHEN public.world_states.active_project_id = '' THEN EXCLUDED.active_project_goal ELSE public.world_states.active_project_goal END,
  active_project_id = CASE WHEN public.world_states.active_project_id = '' THEN EXCLUDED.active_project_id ELSE public.world_states.active_project_id END,
  updated_at = now();

-- Kampung Mistis (kampungmistis.pages.dev)
INSERT INTO public.world_states (world_id, display_name, ig_account_handle, config, active_project_id, active_project_goal)
VALUES ('kampung-mistis', 'Kampung Mistis', 'kampungmistis', $cfg${"worldId":"kampung-mistis","igAccountHandle":"kampungmistis","domain":"kampungmistis.pages.dev","ktpPrefix":"MS","currency":{"code":"Kemenyan","name":"Batang Kemenyan"},"copy":{"citizenNoun":"Penghuni","guestLabel":"Arwah","registerCta":"Daftar Penghuni","ktpTitle":"KARTU TANDA PENGHUNI","ktpDisclaimer":"Kartu penghuni virtual • fiksi horor-komedi","nationName":"Kampung Mistis","nationShort":"Kampung","tvName":"Bisikan Malam","tagline":"1 Follower = 1 Penghuni Gaib. Jangan datang sendirian!","stamps":{"pending":"MENUNGGU RITUAL","verified":"SAH • TERIKAT KONTRAK GAIB","not_following":"BELUM FOLLOW / ARWAH GENTAYANGAN","impeached":"DIUSIR DUKUN"}},"theme":{"primary":"#7c3aed","accent":"#22c55e","background":"#0f0a1f","surface":"#1e1533","text":"#ede9fe","muted":"#a78bfa","ground":"#14532d","road":"#3f3f46"},"tiers":[{"id":"head","preset":"head","name":"Ratu Gaib","shortName":"RATU","min":1,"max":1,"seatTitles":["Ratu Gaib Penguasa Kampung"],"titlePool":[],"nametagColor":"#facc15","ktpBorder":"#d4a017","zone":"palace","look":{"outfit":"robe","accessory":"crown","accentColor":"#16a34a"},"work":{"label":"Bertitah di Malam Jumat","reward":60},"perks":{"canAnnounce":true,"canCreatePoll":true,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":10,"incomeBonusPct":20}},{"id":"deputy","preset":"deputy","name":"Sesepuh","shortName":"SESEPUH","min":2,"max":2,"seatTitles":["Sesepuh Kampung"],"titlePool":[],"nametagColor":"#fde047","ktpBorder":"#d4a017","zone":"palace","look":{"outfit":"robe","accessory":"star","accentColor":"#a3a3a3"},"work":{"label":"Memberi Wangsit","reward":50},"perks":{"canAnnounce":true,"canCreatePoll":true,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":10,"incomeBonusPct":15}},{"id":"cabinet","preset":"cabinet","name":"Mbah Dukun","shortName":"DUKUN","min":3,"max":30,"seatTitles":[],"titlePool":["Mbah Dukun Santet Online","Dukun Pelaris","Dukun Jodoh","Paranormal Konten","Ahli Terawang"],"nametagColor":"#fbbf24","ktpBorder":"#c9a227","zone":"ring1","look":{"outfit":"robe","accessory":"hat","accentColor":"#78350f"},"work":{"label":"Baca Mantra","reward":40},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":10}},{"id":"council","preset":"council","name":"Genderuwo","shortName":"GENDERUWO","min":31,"max":60,"seatTitles":[],"titlePool":["Genderuwo Pohon Asem","Genderuwo Jembatan","Genderuwo Baper"],"nametagColor":"#7dd3fc","ktpBorder":"#0ea5e9","zone":"parliament","look":{"outfit":"fur","accessory":"horns","accentColor":"#451a03"},"work":{"label":"Menakut-nakuti Ronda","reward":35},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":5}},{"id":"elite","preset":"elite","name":"Kuntilanak","shortName":"KUNTI","min":61,"max":100,"seatTitles":[],"titlePool":["Kuntilanak Merah","Kuntilanak Pohon Pisang","Kuntilanak Selebgram"],"nametagColor":"#c084fc","ktpBorder":"#9333ea","zone":"elite_complex","look":{"outfit":"ghost","accessory":"none","accentColor":"#f5f5f5"},"work":{"label":"Ketawa di Pohon","reward":45},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":20,"incomeBonusPct":10}},{"id":"ring2","preset":"ring2","name":"Wewe Gombel & Sundel","shortName":"WEWE","min":101,"max":250,"seatTitles":[],"titlePool":["Wewe Gombel","Sundel Bolong","Leak Penari","Banaspati"],"nametagColor":"#2dd4bf","ktpBorder":"#0d9488","zone":"commercial","look":{"outfit":"ghost","accessory":"sparkle","accentColor":"#fb7185"},"work":{"label":"Ngumpetin Barang","reward":28},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":5}},{"id":"grassroot","preset":"grassroot","name":"Pocong Senior","shortName":"POCONG","min":251,"max":500,"seatTitles":[],"titlePool":["Pocong Senior","Pocong Penunggu Kuburan","Pocong Ojol","Pocong Hits"],"nametagColor":"#fb923c","ktpBorder":"#c2410c","zone":"residential","look":{"outfit":"ghost","accessory":"none","accentColor":"#e5e5e5"},"work":{"label":"Lompat-lompat Ronda","reward":22},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":0}},{"id":"street","preset":"street","name":"Tuyul Magang","shortName":"TUYUL","min":501,"max":1000,"seatTitles":[],"titlePool":["Tuyul Magang","Tuyul Freelance","Tuyul Digital","Babi Ngepet Part-time"],"nametagColor":"#a3e635","ktpBorder":"#65a30d","zone":"gate","look":{"outfit":"casual","accessory":"none","accentColor":"#a3e635"},"work":{"label":"Nyolong Receh","reward":18},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}},{"id":"civil","preset":"civil","name":"Warga Nyasar","shortName":"NYASAR","min":1001,"max":null,"seatTitles":[],"titlePool":["Warga Nyasar","Pemburu Hantu YouTube","Penakut Profesional","Peserta Uji Nyali","Penjaga Malam"],"nametagColor":"#e5e7eb","ktpBorder":"#6b7280","zone":"anywhere","look":{"outfit":"casual","accessory":"none","accentColor":"#64748b"},"work":{"label":"Cari Jalan Pulang","reward":12},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}}],"impeachedTier":{"id":"impeached","preset":"civil","name":"Warga Gelap (Dimakzulkan)","shortName":"GELAP","min":0,"max":0,"seatTitles":[],"titlePool":[],"nametagColor":"#9ca3af","ktpBorder":"#4b5563","zone":"anywhere","look":{"outfit":"casual","accessory":"none","accentColor":"#64748b"},"work":{"label":"Cari Jalan Pulang","reward":9},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}},"buildings":[{"id":"rumah_kosong","name":"Rumah Kosong Angker","category":"residential","emoji":"🏚️","baseCost":100,"incomePerLevelPerDay":8,"color":"#525252","upgradeMultiplier":1.6,"maxLevel":5},{"id":"pohon_beringin","name":"Pohon Beringin Keramat","category":"residential","emoji":"🌳","baseCost":300,"incomePerLevelPerDay":24,"color":"#166534","upgradeMultiplier":1.6,"maxLevel":5},{"id":"warung_sate","name":"Warung Sate Tengah Malam","category":"commercial","emoji":"🍢","baseCost":200,"incomePerLevelPerDay":18,"color":"#b45309","upgradeMultiplier":1.6,"maxLevel":5},{"id":"toko_kemenyan","name":"Toko Kemenyan & Kembang","category":"commercial","emoji":"🌸","baseCost":400,"incomePerLevelPerDay":34,"color":"#db2777","upgradeMultiplier":1.6,"maxLevel":5},{"id":"padepokan_dukun","name":"Padepokan Dukun","category":"commercial","emoji":"🔮","baseCost":900,"incomePerLevelPerDay":75,"color":"#7c3aed","upgradeMultiplier":1.6,"maxLevel":5},{"id":"gardu_ronda","name":"Gardu Ronda Berhantu","category":"government","emoji":"🛖","baseCost":150,"incomePerLevelPerDay":12,"color":"#78350f","upgradeMultiplier":1.6,"maxLevel":5,"requiresPerk":"canBuildGovernment"},{"id":"makam_keramat","name":"Makam Keramat","category":"government","emoji":"🪦","baseCost":1200,"incomePerLevelPerDay":90,"color":"#3f3f46","upgradeMultiplier":1.6,"maxLevel":5,"requiresPerk":"canBuildGovernment"}],"projects":[{"id":"kuburan_elit","name":"Kuburan Elit Ber-AC","description":"Arwah juga butuh kenyamanan.","emoji":"🪦","goal":50000},{"id":"jembatan_angker","name":"Jembatan Angker Baru","description":"Lokasi uji nyali premium.","emoji":"🌉","goal":120000},{"id":"istana_gaib","name":"Istana Gaib Ratu","description":"Hanya terlihat malam Jumat.","emoji":"🏯","goal":250000}],"landmarks":[{"id":"alun","kind":"plaza","name":"Alun-Alun Berkabut","emoji":"🌫️"},{"id":"keraton_gaib","kind":"palace","name":"Keraton Gaib","emoji":"🏯"},{"id":"balai_sesepuh","kind":"parliament","name":"Balai Sesepuh","emoji":"🕯️"},{"id":"hutan_larangan","kind":"elite_complex","name":"Hutan Larangan","emoji":"🌲"},{"id":"warung_tengah_malam","kind":"shop","name":"Warung Kopi Tengah Malam","emoji":"☕"},{"id":"gapura","kind":"gate","name":"Gapura Kampung","emoji":"⛩️"},{"id":"proyek","kind":"project_site","name":"Zona Ritual Pembangunan","emoji":"🚧"}],"economy":{"startingCoins":20,"workCooldownMinutes":120,"statusCooldownMinutes":10,"statusMaxLength":50,"announcementMaxLength":160,"igChangeCooldownMinutes":30,"recheckCooldownMinutes":60,"pollProposalCooldownMinutes":360,"land":{"basePrice":200,"ringDecayPct":25,"minPrice":50,"innerLayerBonusPct":20,"maxPlotsPerCitizen":5},"income":{"maxAccrualHours":24},"requireVerified":{"buyLand":true,"build":true,"donate":true,"vote":true,"governance":true}},"map":{"coreRadius":3,"layersPerRing":2,"ringMilestones":[0,100,500,1000,2500,5000,10000,25000,50000,100000],"occupancyUnlockPct":80,"ringNames":["Inti Pusat","Distrik Perintis","Distrik Kota Baru","Megapolitan"],"ringNameFallback":"Ekspansi Ring {n}"},"registration":{"softGateFollow":false,"softGateDelaySeconds":3,"displayNameMaxLength":16,"maxRegistrationsPerIp24h":2,"avatarColors":["#ef4444","#f97316","#eab308","#22c55e","#14b8a6","#3b82f6","#8b5cf6","#ec4899","#78716c","#0f172a"],"avatarAccessories":["none","cap","hat","sunglasses","helmet"]},"verification":{"checkWindowHours":24,"impeachAfterHours":48,"impeachMaxNumber":100},"sandbox":{"workCooldownMinutes":1,"statusCooldownMinutes":0.25,"igChangeCooldownMinutes":0.25,"recheckCooldownMinutes":0.25,"pollProposalCooldownMinutes":0.5}}$cfg$::jsonb, 'kuburan_elit', 50000)
ON CONFLICT (world_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  ig_account_handle = EXCLUDED.ig_account_handle,
  config = EXCLUDED.config,
  active_project_goal = CASE WHEN public.world_states.active_project_id = '' THEN EXCLUDED.active_project_goal ELSE public.world_states.active_project_goal END,
  active_project_id = CASE WHEN public.world_states.active_project_id = '' THEN EXCLUDED.active_project_id ELSE public.world_states.active_project_id END,
  updated_at = now();

-- Kerajaan Nusantara (kerajaannusantara.pages.dev)
INSERT INTO public.world_states (world_id, display_name, ig_account_handle, config, active_project_id, active_project_goal)
VALUES ('kerajaan-nusantara', 'Kerajaan Nusantara', 'kerajaannusantara', $cfg${"worldId":"kerajaan-nusantara","igAccountHandle":"kerajaannusantara","domain":"kerajaannusantara.pages.dev","ktpPrefix":"KN","currency":{"code":"Keping","name":"Keping Emas"},"copy":{"citizenNoun":"Kawula","guestLabel":"Tamu","registerCta":"Jadi Kawula","ktpTitle":"PRASASTI KAWULA","ktpDisclaimer":"Prasasti kawula virtual • kerajaan fiktif","nationName":"Kerajaan Nusantara","nationShort":"Kerajaan","tvName":"Kabar Istana","tagline":"1 Follower = 1 Kawula. Siapa cepat, dia naik takhta!","stamps":{"pending":"MENUNGGU TITAH RAJA","verified":"SAH • DISAHKAN KERATON","not_following":"BELUM FOLLOW / KAWULA PELARIAN","impeached":"DIBUANG KE PENGASINGAN"}},"theme":{"primary":"#b45309","accent":"#facc15","background":"#fffbeb","surface":"#ffffff","text":"#422006","muted":"#92400e","ground":"#bef264","road":"#d6d3d1"},"tiers":[{"id":"head","preset":"head","name":"Raja / Ratu","shortName":"RAJA","min":1,"max":1,"seatTitles":["Sri Baginda Raja Nusantara"],"titlePool":[],"nametagColor":"#facc15","ktpBorder":"#d4a017","zone":"palace","look":{"outfit":"robe","accessory":"crown","accentColor":"#facc15"},"work":{"label":"Menerima Upeti","reward":60},"perks":{"canAnnounce":true,"canCreatePoll":true,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":10,"incomeBonusPct":20}},{"id":"deputy","preset":"deputy","name":"Mahapatih","shortName":"PATIH","min":2,"max":2,"seatTitles":["Mahapatih Kerajaan"],"titlePool":[],"nametagColor":"#fde047","ktpBorder":"#d4a017","zone":"palace","look":{"outfit":"robe","accessory":"star","accentColor":"#b45309"},"work":{"label":"Sumpah Jabatan","reward":50},"perks":{"canAnnounce":true,"canCreatePoll":true,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":10,"incomeBonusPct":15}},{"id":"cabinet","preset":"cabinet","name":"Panglima & Menteri Istana","shortName":"PANGLIMA","min":3,"max":30,"seatTitles":["Panglima Perang","Laksamana Laut","Bendahara Kerajaan","Pujangga Istana","Empu Keris"],"titlePool":["Tumenggung","Adipati","Senopati","Rakryan"],"nametagColor":"#fbbf24","ktpBorder":"#c9a227","zone":"ring1","look":{"outfit":"armor","accessory":"helmet","accentColor":"#b91c1c"},"work":{"label":"Apel Pasukan","reward":40},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":10}},{"id":"council","preset":"council","name":"Pendekar","shortName":"PENDEKAR","min":31,"max":60,"seatTitles":[],"titlePool":["Pendekar Tanpa Tanding","Pendekar Pedang","Pendekar Bayangan","Resi Pertapa"],"nametagColor":"#7dd3fc","ktpBorder":"#0ea5e9","zone":"parliament","look":{"outfit":"robe","accessory":"pin","accentColor":"#0ea5e9"},"work":{"label":"Latihan Silat","reward":35},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":5}},{"id":"elite","preset":"elite","name":"Saudagar Kaya","shortName":"SAUDAGAR","min":61,"max":100,"seatTitles":[],"titlePool":["Saudagar Rempah","Juragan Kapal","Saudagar Kain","Bandar Emas"],"nametagColor":"#c084fc","ktpBorder":"#9333ea","zone":"elite_complex","look":{"outfit":"robe","accessory":"sunglasses","accentColor":"#7c3aed"},"work":{"label":"Dagang Rempah","reward":45},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":20,"incomeBonusPct":10}},{"id":"ring2","preset":"ring2","name":"Bangsawan","shortName":"BANGSAWAN","min":101,"max":250,"seatTitles":[],"titlePool":["Raden","Ndoro","Putri Keraton","Pangeran Kelana"],"nametagColor":"#2dd4bf","ktpBorder":"#0d9488","zone":"commercial","look":{"outfit":"casual","accessory":"sparkle","accentColor":"#14b8a6"},"work":{"label":"Pesta Keraton","reward":28},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":5}},{"id":"grassroot","preset":"grassroot","name":"Prajurit","shortName":"PRAJURIT","min":251,"max":500,"seatTitles":[],"titlePool":["Prajurit Tombak","Prajurit Panah","Prajurit Berkuda","Penjaga Benteng"],"nametagColor":"#fb923c","ktpBorder":"#c2410c","zone":"residential","look":{"outfit":"armor","accessory":"helmet","accentColor":"#78716c"},"work":{"label":"Jaga Gerbang","reward":22},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":0}},{"id":"street","preset":"street","name":"Pedagang & Pengrajin","shortName":"PENGRAJIN","min":501,"max":1000,"seatTitles":[],"titlePool":["Pedagang Pasar","Pengrajin Keris","Penenun Batik","Tukang Perahu"],"nametagColor":"#a3e635","ktpBorder":"#65a30d","zone":"gate","look":{"outfit":"jacket","accessory":"helmet","accentColor":"#16a34a"},"work":{"label":"Jualan di Pasar","reward":18},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}},{"id":"civil","preset":"civil","name":"Rakyat Jelata","shortName":"RAKYAT","min":1001,"max":null,"seatTitles":[],"titlePool":["Petani Padi","Penggembala","Nelayan","Abdi Dalem","Pengelana"],"nametagColor":"#e5e7eb","ktpBorder":"#6b7280","zone":"anywhere","look":{"outfit":"casual","accessory":"none","accentColor":"#64748b"},"work":{"label":"Bertani di Sawah","reward":12},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}}],"impeachedTier":{"id":"impeached","preset":"civil","name":"Warga Gelap (Dimakzulkan)","shortName":"GELAP","min":0,"max":0,"seatTitles":[],"titlePool":[],"nametagColor":"#9ca3af","ktpBorder":"#4b5563","zone":"anywhere","look":{"outfit":"casual","accessory":"none","accentColor":"#64748b"},"work":{"label":"Bertani di Sawah","reward":9},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}},"buildings":[{"id":"gubuk","name":"Gubuk Bambu","category":"residential","emoji":"🛖","baseCost":100,"incomePerLevelPerDay":8,"color":"#a16207","upgradeMultiplier":1.6,"maxLevel":5},{"id":"rumah_joglo","name":"Rumah Joglo","category":"residential","emoji":"🏠","baseCost":400,"incomePerLevelPerDay":30,"color":"#92400e","upgradeMultiplier":1.6,"maxLevel":5},{"id":"pendopo","name":"Pendopo Bangsawan","category":"residential","emoji":"🏯","baseCost":1500,"incomePerLevelPerDay":120,"color":"#b45309","upgradeMultiplier":1.6,"maxLevel":5},{"id":"pasar_rempah","name":"Lapak Pasar Rempah","category":"commercial","emoji":"🌶️","baseCost":200,"incomePerLevelPerDay":18,"color":"#dc2626","upgradeMultiplier":1.6,"maxLevel":5},{"id":"bengkel_keris","name":"Bengkel Keris","category":"commercial","emoji":"🗡️","baseCost":500,"incomePerLevelPerDay":42,"color":"#525252","upgradeMultiplier":1.6,"maxLevel":5},{"id":"pelabuhan_kecil","name":"Dermaga Dagang","category":"commercial","emoji":"⛵","baseCost":1000,"incomePerLevelPerDay":85,"color":"#0369a1","upgradeMultiplier":1.6,"maxLevel":5},{"id":"padepokan","name":"Padepokan Silat","category":"government","emoji":"🥋","baseCost":400,"incomePerLevelPerDay":32,"color":"#15803d","upgradeMultiplier":1.6,"maxLevel":5,"requiresPerk":"canBuildGovernment"},{"id":"candi_kecil","name":"Candi Kecil","category":"government","emoji":"🛕","baseCost":1200,"incomePerLevelPerDay":90,"color":"#78716c","upgradeMultiplier":1.6,"maxLevel":5,"requiresPerk":"canBuildGovernment"}],"projects":[{"id":"candi_agung","name":"Candi Agung Nusantara","description":"Mahakarya batu untuk anak cucu.","emoji":"🛕","goal":50000},{"id":"kapal_perang","name":"Armada Kapal Perang","description":"Menjaga lautan nusantara.","emoji":"⛵","goal":120000},{"id":"benteng_raksasa","name":"Benteng Raksasa","description":"Tak tertembus musuh.","emoji":"🏰","goal":250000}],"landmarks":[{"id":"alun","kind":"plaza","name":"Alun-Alun Keraton","emoji":"🌳"},{"id":"keraton","kind":"palace","name":"Keraton Agung","emoji":"🏯"},{"id":"balairung","kind":"parliament","name":"Balairung Sidang","emoji":"📜"},{"id":"kampung_saudagar","kind":"elite_complex","name":"Kampung Saudagar","emoji":"💰"},{"id":"pasar","kind":"shop","name":"Pasar Rakyat","emoji":"🧺"},{"id":"gapura","kind":"gate","name":"Gapura Kerajaan","emoji":"⛩️"},{"id":"proyek","kind":"project_site","name":"Zona Pembangunan Kerajaan","emoji":"🚧"}],"economy":{"startingCoins":20,"workCooldownMinutes":120,"statusCooldownMinutes":10,"statusMaxLength":50,"announcementMaxLength":160,"igChangeCooldownMinutes":30,"recheckCooldownMinutes":60,"pollProposalCooldownMinutes":360,"land":{"basePrice":200,"ringDecayPct":25,"minPrice":50,"innerLayerBonusPct":20,"maxPlotsPerCitizen":5},"income":{"maxAccrualHours":24},"requireVerified":{"buyLand":true,"build":true,"donate":true,"vote":true,"governance":true}},"map":{"coreRadius":3,"layersPerRing":2,"ringMilestones":[0,100,500,1000,2500,5000,10000,25000,50000,100000],"occupancyUnlockPct":80,"ringNames":["Inti Pusat","Distrik Perintis","Distrik Kota Baru","Megapolitan"],"ringNameFallback":"Ekspansi Ring {n}"},"registration":{"softGateFollow":false,"softGateDelaySeconds":3,"displayNameMaxLength":16,"maxRegistrationsPerIp24h":2,"avatarColors":["#ef4444","#f97316","#eab308","#22c55e","#14b8a6","#3b82f6","#8b5cf6","#ec4899","#78716c","#0f172a"],"avatarAccessories":["none","cap","hat","sunglasses","helmet"]},"verification":{"checkWindowHours":24,"impeachAfterHours":48,"impeachMaxNumber":100},"sandbox":{"workCooldownMinutes":1,"statusCooldownMinutes":0.25,"igChangeCooldownMinutes":0.25,"recheckCooldownMinutes":0.25,"pollProposalCooldownMinutes":0.5}}$cfg$::jsonb, 'candi_agung', 50000)
ON CONFLICT (world_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  ig_account_handle = EXCLUDED.ig_account_handle,
  config = EXCLUDED.config,
  active_project_goal = CASE WHEN public.world_states.active_project_id = '' THEN EXCLUDED.active_project_goal ELSE public.world_states.active_project_goal END,
  active_project_id = CASE WHEN public.world_states.active_project_id = '' THEN EXCLUDED.active_project_id ELSE public.world_states.active_project_id END,
  updated_at = now();

-- Guild Isekai (guildisekai.pages.dev)
INSERT INTO public.world_states (world_id, display_name, ig_account_handle, config, active_project_id, active_project_goal)
VALUES ('guild-petualang', 'Guild Isekai', 'guildisekai', $cfg${"worldId":"guild-petualang","igAccountHandle":"guildisekai","domain":"guildisekai.pages.dev","ktpPrefix":"GI","currency":{"code":"Gold","name":"Koin Gold"},"copy":{"citizenNoun":"Petualang","guestLabel":"Pengembara","registerCta":"Daftar Guild","ktpTitle":"GUILD CARD PETUALANG","ktpDisclaimer":"Guild card virtual • dunia fantasi fiktif","nationName":"Guild Isekai","nationShort":"Guild","tvName":"Papan Quest","tagline":"1 Follower = 1 Petualang. Daftar duluan = S-Rank duluan!","stamps":{"pending":"MENUNGGU APPRAISAL","verified":"TERDAFTAR • GUILD SAH","not_following":"BELUM FOLLOW / PETUALANG LIAR","impeached":"RANK DICABUT"}},"theme":{"primary":"#4f46e5","accent":"#f59e0b","background":"#eef2ff","surface":"#ffffff","text":"#1e1b4b","muted":"#6366f1","ground":"#86efac","road":"#a8a29e"},"tiers":[{"id":"head","preset":"head","name":"Guild Master","shortName":"GM","min":1,"max":1,"seatTitles":["Guild Master Agung"],"titlePool":[],"nametagColor":"#facc15","ktpBorder":"#d4a017","zone":"palace","look":{"outfit":"armor","accessory":"crown","accentColor":"#f59e0b"},"work":{"label":"Bagikan Quest Legendaris","reward":60},"perks":{"canAnnounce":true,"canCreatePoll":true,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":10,"incomeBonusPct":20}},{"id":"deputy","preset":"deputy","name":"Sub-Master","shortName":"SUB-GM","min":2,"max":2,"seatTitles":["Sub-Master Guild"],"titlePool":[],"nametagColor":"#fde047","ktpBorder":"#d4a017","zone":"palace","look":{"outfit":"armor","accessory":"star","accentColor":"#eab308"},"work":{"label":"Audit Hadiah Quest","reward":50},"perks":{"canAnnounce":true,"canCreatePoll":true,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":10,"incomeBonusPct":15}},{"id":"cabinet","preset":"cabinet","name":"S-Rank","shortName":"S-RANK","min":3,"max":30,"seatTitles":[],"titlePool":["Pahlawan Terpilih","Pendekar Pedang Suci","Ksatria Naga","Pembasmi Iblis","Saint Penyembuh"],"nametagColor":"#fbbf24","ktpBorder":"#c9a227","zone":"ring1","look":{"outfit":"armor","accessory":"sparkle","accentColor":"#dc2626"},"work":{"label":"Kalahkan Naga","reward":40},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":10}},{"id":"council","preset":"council","name":"Archmage","shortName":"ARCHMAGE","min":31,"max":60,"seatTitles":[],"titlePool":["Archmage Api","Archmage Es","Penyihir Waktu","Nekromanser Insaf"],"nametagColor":"#7dd3fc","ktpBorder":"#0ea5e9","zone":"parliament","look":{"outfit":"robe","accessory":"hat","accentColor":"#7c3aed"},"work":{"label":"Riset Sihir Kuno","reward":35},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":5}},{"id":"elite","preset":"elite","name":"A-Rank","shortName":"A-RANK","min":61,"max":100,"seatTitles":[],"titlePool":["Paladin","Ranger Elf","Berserker","Beast Tamer","Pemanah Bayangan"],"nametagColor":"#c084fc","ktpBorder":"#9333ea","zone":"elite_complex","look":{"outfit":"suit","accessory":"sunglasses","accentColor":"#7c3aed"},"work":{"label":"Bersihkan Dungeon","reward":45},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":20,"incomeBonusPct":10}},{"id":"ring2","preset":"ring2","name":"Blacksmith & Alkemis","shortName":"CRAFTER","min":101,"max":250,"seatTitles":[],"titlePool":["Blacksmith Dwarf","Alkemis Ramuan","Penjual Gacha","Enchanter"],"nametagColor":"#2dd4bf","ktpBorder":"#0d9488","zone":"commercial","look":{"outfit":"uniform","accessory":"cap","accentColor":"#78716c"},"work":{"label":"Tempa Senjata","reward":28},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":5}},{"id":"grassroot","preset":"grassroot","name":"B-Rank","shortName":"B-RANK","min":251,"max":500,"seatTitles":[],"titlePool":["Swordsman","Archer","Cleric","Penjaga Gerbang"],"nametagColor":"#fb923c","ktpBorder":"#c2410c","zone":"residential","look":{"outfit":"uniform","accessory":"cap","accentColor":"#ea580c"},"work":{"label":"Kawal Karavan","reward":22},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":0}},{"id":"street","preset":"street","name":"C-Rank","shortName":"C-RANK","min":501,"max":1000,"seatTitles":[],"titlePool":["Pemburu Slime","Pengumpul Herbal","Porter Dungeon","Pelayan Tavern"],"nametagColor":"#a3e635","ktpBorder":"#65a30d","zone":"gate","look":{"outfit":"jacket","accessory":"helmet","accentColor":"#16a34a"},"work":{"label":"Berburu Slime","reward":18},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}},{"id":"civil","preset":"civil","name":"F-Rank / NPC","shortName":"F-RANK","min":1001,"max":null,"seatTitles":[],"titlePool":["Petualang F-Rank","NPC Penjaga Toko","Korban Truk-kun","Penduduk Desa Awal","Reinkarnasi Gagal"],"nametagColor":"#e5e7eb","ktpBorder":"#6b7280","zone":"anywhere","look":{"outfit":"casual","accessory":"none","accentColor":"#64748b"},"work":{"label":"Quest Cari Kucing Hilang","reward":12},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}}],"impeachedTier":{"id":"impeached","preset":"civil","name":"Warga Gelap (Dimakzulkan)","shortName":"GELAP","min":0,"max":0,"seatTitles":[],"titlePool":[],"nametagColor":"#9ca3af","ktpBorder":"#4b5563","zone":"anywhere","look":{"outfit":"casual","accessory":"none","accentColor":"#64748b"},"work":{"label":"Quest Cari Kucing Hilang","reward":9},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}},"buildings":[{"id":"penginapan","name":"Penginapan Murah","category":"residential","emoji":"🛏️","baseCost":100,"incomePerLevelPerDay":8,"color":"#a16207","upgradeMultiplier":1.6,"maxLevel":5},{"id":"rumah_petualang","name":"Rumah Petualang","category":"residential","emoji":"🏠","baseCost":400,"incomePerLevelPerDay":30,"color":"#4f46e5","upgradeMultiplier":1.6,"maxLevel":5},{"id":"kastil_mini","name":"Kastil Mini","category":"residential","emoji":"🏰","baseCost":1800,"incomePerLevelPerDay":150,"color":"#6b7280","upgradeMultiplier":1.6,"maxLevel":5},{"id":"tavern","name":"Tavern Ramai","category":"commercial","emoji":"🍺","baseCost":250,"incomePerLevelPerDay":22,"color":"#b45309","upgradeMultiplier":1.6,"maxLevel":5},{"id":"bengkel_senjata","name":"Bengkel Senjata","category":"commercial","emoji":"⚒️","baseCost":500,"incomePerLevelPerDay":42,"color":"#525252","upgradeMultiplier":1.6,"maxLevel":5},{"id":"toko_ramuan","name":"Toko Ramuan","category":"commercial","emoji":"🧪","baseCost":300,"incomePerLevelPerDay":26,"color":"#16a34a","upgradeMultiplier":1.6,"maxLevel":5},{"id":"menara_sihir","name":"Menara Sihir","category":"government","emoji":"🗼","baseCost":1200,"incomePerLevelPerDay":90,"color":"#7c3aed","upgradeMultiplier":1.6,"maxLevel":5,"requiresPerk":"canBuildGovernment"},{"id":"pos_guild","name":"Pos Guild Cabang","category":"government","emoji":"📜","baseCost":300,"incomePerLevelPerDay":25,"color":"#f59e0b","upgradeMultiplier":1.6,"maxLevel":5,"requiresPerk":"canBuildGovernment"}],"projects":[{"id":"raid_boss","name":"Raid Boss Naga Merah","description":"Seluruh guild gotong royong!","emoji":"🐉","goal":50000},{"id":"markas_guild","name":"Markas Guild Baru","description":"Aula besar untuk semua petualang.","emoji":"🏰","goal":120000},{"id":"portal_dimensi","name":"Portal Dimensi","description":"Akses ke dungeon tersembunyi.","emoji":"🌀","goal":250000}],"landmarks":[{"id":"alun","kind":"plaza","name":"Alun-Alun Kota Awal","emoji":"⛲"},{"id":"markas","kind":"palace","name":"Aula Guild Master","emoji":"🏰"},{"id":"dewan","kind":"parliament","name":"Menara Dewan Penyihir","emoji":"🔮"},{"id":"distrik_s","kind":"elite_complex","name":"Distrik S-Rank","emoji":"💎"},{"id":"item_shop","kind":"shop","name":"Item Shop 24 Jam","emoji":"🛍️"},{"id":"gerbang","kind":"gate","name":"Gerbang Kota & Kandang Kuda","emoji":"🐴"},{"id":"proyek","kind":"project_site","name":"Zona Raid","emoji":"⚔️"}],"economy":{"startingCoins":20,"workCooldownMinutes":120,"statusCooldownMinutes":10,"statusMaxLength":50,"announcementMaxLength":160,"igChangeCooldownMinutes":30,"recheckCooldownMinutes":60,"pollProposalCooldownMinutes":360,"land":{"basePrice":200,"ringDecayPct":25,"minPrice":50,"innerLayerBonusPct":20,"maxPlotsPerCitizen":5},"income":{"maxAccrualHours":24},"requireVerified":{"buyLand":true,"build":true,"donate":true,"vote":true,"governance":true}},"map":{"coreRadius":3,"layersPerRing":2,"ringMilestones":[0,100,500,1000,2500,5000,10000,25000,50000,100000],"occupancyUnlockPct":80,"ringNames":["Inti Pusat","Distrik Perintis","Distrik Kota Baru","Megapolitan"],"ringNameFallback":"Ekspansi Ring {n}"},"registration":{"softGateFollow":false,"softGateDelaySeconds":3,"displayNameMaxLength":16,"maxRegistrationsPerIp24h":2,"avatarColors":["#ef4444","#f97316","#eab308","#22c55e","#14b8a6","#3b82f6","#8b5cf6","#ec4899","#78716c","#0f172a"],"avatarAccessories":["none","cap","hat","sunglasses","helmet"]},"verification":{"checkWindowHours":24,"impeachAfterHours":48,"impeachMaxNumber":100},"sandbox":{"workCooldownMinutes":1,"statusCooldownMinutes":0.25,"igChangeCooldownMinutes":0.25,"recheckCooldownMinutes":0.25,"pollProposalCooldownMinutes":0.5}}$cfg$::jsonb, 'raid_boss', 50000)
ON CONFLICT (world_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  ig_account_handle = EXCLUDED.ig_account_handle,
  config = EXCLUDED.config,
  active_project_goal = CASE WHEN public.world_states.active_project_id = '' THEN EXCLUDED.active_project_goal ELSE public.world_states.active_project_goal END,
  active_project_id = CASE WHEN public.world_states.active_project_id = '' THEN EXCLUDED.active_project_id ELSE public.world_states.active_project_id END,
  updated_at = now();

-- Kota Mafia (kotamafia.pages.dev)
INSERT INTO public.world_states (world_id, display_name, ig_account_handle, config, active_project_id, active_project_goal)
VALUES ('kota-mafia', 'Kota Mafia', 'kotamafia', $cfg${"worldId":"kota-mafia","igAccountHandle":"kotamafia","domain":"kotamafia.pages.dev","ktpPrefix":"MF","currency":{"code":"Cash","name":"Uang Cash"},"copy":{"citizenNoun":"Anggota","guestLabel":"Orang Asing","registerCta":"Gabung Keluarga","ktpTitle":"KARTU ANGGOTA KELUARGA","ktpDisclaimer":"Kartu anggota virtual • kota fiktif, parodi film","nationName":"Kota Mafia","nationShort":"Kota Mafia","tvName":"Kabar Jalanan","tagline":"1 Follower = 1 Anggota Keluarga. Yang datang duluan jadi Godfather.","stamps":{"pending":"MASA PERCOBAAN","verified":"SAH • SUMPAH SETIA","not_following":"BELUM FOLLOW / PENGKHIANAT?","impeached":"DIKELUARKAN DARI KELUARGA"}},"theme":{"primary":"#991b1b","accent":"#d4a017","background":"#18181b","surface":"#27272a","text":"#f4f4f5","muted":"#a1a1aa","ground":"#3f3f46","road":"#52525b"},"tiers":[{"id":"head","preset":"head","name":"Godfather","shortName":"DON","min":1,"max":1,"seatTitles":["Godfather Kota"],"titlePool":[],"nametagColor":"#facc15","ktpBorder":"#d4a017","zone":"palace","look":{"outfit":"suit","accessory":"hat","accentColor":"#991b1b"},"work":{"label":"Tawaran yang Tak Bisa Ditolak","reward":60},"perks":{"canAnnounce":true,"canCreatePoll":true,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":10,"incomeBonusPct":20}},{"id":"deputy","preset":"deputy","name":"Consigliere","shortName":"CONSIGLIERE","min":2,"max":2,"seatTitles":["Consigliere"],"titlePool":[],"nametagColor":"#fde047","ktpBorder":"#d4a017","zone":"palace","look":{"outfit":"suit","accessory":"star","accentColor":"#d4a017"},"work":{"label":"Beri Nasihat Licik","reward":50},"perks":{"canAnnounce":true,"canCreatePoll":true,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":10,"incomeBonusPct":15}},{"id":"cabinet","preset":"cabinet","name":"Capo","shortName":"CAPO","min":3,"max":30,"seatTitles":[],"titlePool":["Capo Pelabuhan","Capo Pasar Malam","Capo Kasino","Capo Distrik Utara","Capo Distrik Selatan"],"nametagColor":"#fbbf24","ktpBorder":"#c9a227","zone":"ring1","look":{"outfit":"suit","accessory":"sunglasses","accentColor":"#1f2937"},"work":{"label":"Tagih Setoran Wilayah","reward":40},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":10}},{"id":"council","preset":"council","name":"Hitman & Hacker","shortName":"SPESIALIS","min":31,"max":60,"seatTitles":[],"titlePool":["Hitman Bayaran","Hacker Bawah Tanah","Penembak Jitu Atap","Ahli Kunci Brankas"],"nametagColor":"#7dd3fc","ktpBorder":"#0ea5e9","zone":"parliament","look":{"outfit":"jacket","accessory":"sunglasses","accentColor":"#0f172a"},"work":{"label":"Misi Rahasia","reward":35},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":5}},{"id":"elite","preset":"elite","name":"Bandar Besar","shortName":"BANDAR","min":61,"max":100,"seatTitles":[],"titlePool":["Bandar Kasino","Juragan Gudang","Raja Pelabuhan","Pemilik Klub Malam"],"nametagColor":"#c084fc","ktpBorder":"#9333ea","zone":"elite_complex","look":{"outfit":"suit","accessory":"sunglasses","accentColor":"#7c3aed"},"work":{"label":"Hitung Setoran Kasino","reward":45},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":20,"incomeBonusPct":10}},{"id":"ring2","preset":"ring2","name":"Pengacara & Akuntan","shortName":"ORANG DALAM","min":101,"max":250,"seatTitles":[],"titlePool":["Pengacara Licin","Akuntan Kreatif","Detektif Bayaran","Wartawan Gosip"],"nametagColor":"#2dd4bf","ktpBorder":"#0d9488","zone":"commercial","look":{"outfit":"casual","accessory":"sparkle","accentColor":"#14b8a6"},"work":{"label":"Rapikan Pembukuan","reward":28},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":5}},{"id":"grassroot","preset":"grassroot","name":"Soldato","shortName":"SOLDATO","min":251,"max":500,"seatTitles":[],"titlePool":["Soldato","Bodyguard","Sopir Pelarian","Penjaga Gudang"],"nametagColor":"#fb923c","ktpBorder":"#c2410c","zone":"residential","look":{"outfit":"uniform","accessory":"cap","accentColor":"#ea580c"},"work":{"label":"Jaga Markas","reward":22},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":0}},{"id":"street","preset":"street","name":"Informan","shortName":"INFORMAN","min":501,"max":1000,"seatTitles":[],"titlePool":["Informan Pasar","Tukang Semir Mata-mata","Penjual Koran Rahasia","Bartender Kepo"],"nametagColor":"#a3e635","ktpBorder":"#65a30d","zone":"gate","look":{"outfit":"jacket","accessory":"helmet","accentColor":"#16a34a"},"work":{"label":"Kumpulin Gosip","reward":18},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}},{"id":"civil","preset":"civil","name":"Preman Pasar","shortName":"PREMAN","min":1001,"max":null,"seatTitles":[],"titlePool":["Preman Pasar","Calo Tiket","Pencopet Pensiun","Anak Baru Gede","Figuran Film Gangster"],"nametagColor":"#e5e7eb","ktpBorder":"#6b7280","zone":"anywhere","look":{"outfit":"casual","accessory":"none","accentColor":"#64748b"},"work":{"label":"Jaga Parkir Pasar","reward":12},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}}],"impeachedTier":{"id":"impeached","preset":"civil","name":"Warga Gelap (Dimakzulkan)","shortName":"GELAP","min":0,"max":0,"seatTitles":[],"titlePool":[],"nametagColor":"#9ca3af","ktpBorder":"#4b5563","zone":"anywhere","look":{"outfit":"casual","accessory":"none","accentColor":"#64748b"},"work":{"label":"Jaga Parkir Pasar","reward":9},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}},"buildings":[{"id":"apartemen_kumuh","name":"Apartemen Kumuh","category":"residential","emoji":"🏚️","baseCost":100,"incomePerLevelPerDay":8,"color":"#52525b","upgradeMultiplier":1.6,"maxLevel":5},{"id":"penthouse","name":"Penthouse Rahasia","category":"residential","emoji":"🌃","baseCost":1800,"incomePerLevelPerDay":150,"color":"#d4a017","upgradeMultiplier":1.6,"maxLevel":5},{"id":"laundry","name":"Laundry Kilat","category":"commercial","emoji":"🧺","baseCost":250,"incomePerLevelPerDay":22,"color":"#38bdf8","upgradeMultiplier":1.6,"maxLevel":5},{"id":"bar","name":"Bar Remang","category":"commercial","emoji":"🍸","baseCost":400,"incomePerLevelPerDay":34,"color":"#991b1b","upgradeMultiplier":1.6,"maxLevel":5},{"id":"kasino","name":"Kasino Mini","category":"commercial","emoji":"🎰","baseCost":1000,"incomePerLevelPerDay":85,"color":"#a16207","upgradeMultiplier":1.6,"maxLevel":5},{"id":"gudang_rahasia","name":"Gudang Rahasia","category":"commercial","emoji":"📦","baseCost":600,"incomePerLevelPerDay":50,"color":"#78350f","upgradeMultiplier":1.6,"maxLevel":5},{"id":"markas_keluarga","name":"Markas Keluarga","category":"government","emoji":"🏛️","baseCost":1200,"incomePerLevelPerDay":90,"color":"#18181b","upgradeMultiplier":1.6,"maxLevel":5,"requiresPerk":"canBuildGovernment"}],"projects":[{"id":"pelabuhan_gelap","name":"Pelabuhan Gelap","description":"Jalur dagang \"khusus\".","emoji":"⚓","goal":50000},{"id":"bunker","name":"Bunker Bawah Tanah","description":"Tempat sembunyi paling aman.","emoji":"🕳️","goal":120000},{"id":"menara_keluarga","name":"Menara Keluarga","description":"Simbol kekuasaan di cakrawala.","emoji":"🏙️","goal":250000}],"landmarks":[{"id":"plaza","kind":"plaza","name":"Plaza Air Mancur","emoji":"⛲"},{"id":"mansion_don","kind":"palace","name":"Mansion Godfather","emoji":"🏛️"},{"id":"ruang_meja_bundar","kind":"parliament","name":"Ruang Meja Bundar","emoji":"🪑"},{"id":"distrik_kasino","kind":"elite_complex","name":"Distrik Kasino","emoji":"🎰"},{"id":"restoran","kind":"shop","name":"Restoran Pasta Keluarga","emoji":"🍝"},{"id":"dermaga","kind":"gate","name":"Dermaga & Pangkalan Taksi","emoji":"🚕"},{"id":"proyek","kind":"project_site","name":"Zona Proyek Rahasia","emoji":"🚧"}],"economy":{"startingCoins":20,"workCooldownMinutes":120,"statusCooldownMinutes":10,"statusMaxLength":50,"announcementMaxLength":160,"igChangeCooldownMinutes":30,"recheckCooldownMinutes":60,"pollProposalCooldownMinutes":360,"land":{"basePrice":200,"ringDecayPct":25,"minPrice":50,"innerLayerBonusPct":20,"maxPlotsPerCitizen":5},"income":{"maxAccrualHours":24},"requireVerified":{"buyLand":true,"build":true,"donate":true,"vote":true,"governance":true}},"map":{"coreRadius":3,"layersPerRing":2,"ringMilestones":[0,100,500,1000,2500,5000,10000,25000,50000,100000],"occupancyUnlockPct":80,"ringNames":["Inti Pusat","Distrik Perintis","Distrik Kota Baru","Megapolitan"],"ringNameFallback":"Ekspansi Ring {n}"},"registration":{"softGateFollow":false,"softGateDelaySeconds":3,"displayNameMaxLength":16,"maxRegistrationsPerIp24h":2,"avatarColors":["#ef4444","#f97316","#eab308","#22c55e","#14b8a6","#3b82f6","#8b5cf6","#ec4899","#78716c","#0f172a"],"avatarAccessories":["none","cap","hat","sunglasses","helmet"]},"verification":{"checkWindowHours":24,"impeachAfterHours":48,"impeachMaxNumber":100},"sandbox":{"workCooldownMinutes":1,"statusCooldownMinutes":0.25,"igChangeCooldownMinutes":0.25,"recheckCooldownMinutes":0.25,"pollProposalCooldownMinutes":0.5}}$cfg$::jsonb, 'pelabuhan_gelap', 50000)
ON CONFLICT (world_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  ig_account_handle = EXCLUDED.ig_account_handle,
  config = EXCLUDED.config,
  active_project_goal = CASE WHEN public.world_states.active_project_id = '' THEN EXCLUDED.active_project_goal ELSE public.world_states.active_project_goal END,
  active_project_id = CASE WHEN public.world_states.active_project_id = '' THEN EXCLUDED.active_project_id ELSE public.world_states.active_project_id END,
  updated_at = now();

-- Pulau Penjara (pulaupenjara.pages.dev)
INSERT INTO public.world_states (world_id, display_name, ig_account_handle, config, active_project_id, active_project_goal)
VALUES ('pulau-penjara', 'Pulau Penjara', 'pulaupenjara', $cfg${"worldId":"pulau-penjara","igAccountHandle":"pulaupenjara","domain":"pulaupenjara.pages.dev","ktpPrefix":"PP","currency":{"code":"Rokok","name":"Batang Rokok"},"copy":{"citizenNoun":"Napi","guestLabel":"Pembesuk","registerCta":"Masuk Penjara","ktpTitle":"KARTU IDENTITAS NAPI","ktpDisclaimer":"Kartu napi virtual • penjara fiktif, parodi","nationName":"Pulau Penjara","nationShort":"Penjara","tvName":"Pengeras Suara Blok","tagline":"1 Follower = 1 Napi. Masuk duluan = jadi bos sel!","stamps":{"pending":"MENUNGGU REGISTRASI SIPIR","verified":"SAH • TERCATAT DI BLOK","not_following":"BELUM FOLLOW / NAPI KABUR","impeached":"DIASINGKAN KE SEL ISOLASI"}},"theme":{"primary":"#ea580c","accent":"#64748b","background":"#f5f5f4","surface":"#ffffff","text":"#1c1917","muted":"#78716c","ground":"#d6d3d1","road":"#57534e"},"tiers":[{"id":"head","preset":"head","name":"Kepala Sipir","shortName":"KALAPAS","min":1,"max":1,"seatTitles":["Kepala Sipir Pulau"],"titlePool":[],"nametagColor":"#facc15","ktpBorder":"#d4a017","zone":"palace","look":{"outfit":"uniform","accessory":"cap","accentColor":"#1e3a8a"},"work":{"label":"Inspeksi Mendadak","reward":60},"perks":{"canAnnounce":true,"canCreatePoll":true,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":10,"incomeBonusPct":20}},{"id":"deputy","preset":"deputy","name":"Wakil Sipir","shortName":"WASIPIR","min":2,"max":2,"seatTitles":["Wakil Kepala Sipir"],"titlePool":[],"nametagColor":"#fde047","ktpBorder":"#d4a017","zone":"palace","look":{"outfit":"uniform","accessory":"star","accentColor":"#1e40af"},"work":{"label":"Hitung Napi","reward":50},"perks":{"canAnnounce":true,"canCreatePoll":true,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":10,"incomeBonusPct":15}},{"id":"cabinet","preset":"cabinet","name":"Bos Geng Sel","shortName":"BOS SEL","min":3,"max":30,"seatTitles":[],"titlePool":["Bos Blok A","Bos Blok B","Bos Blok C","Raja Dapur","Penguasa Lapangan"],"nametagColor":"#fbbf24","ktpBorder":"#c9a227","zone":"ring1","look":{"outfit":"prison","accessory":"sunglasses","accentColor":"#ea580c"},"work":{"label":"Atur Jatah Makan","reward":40},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":10}},{"id":"council","preset":"council","name":"Napi Senior","shortName":"SENIOR","min":31,"max":60,"seatTitles":[],"titlePool":["Napi Senior","Penasihat Sel","Tukang Cerita Masa Lalu","Jago Catur Sel"],"nametagColor":"#7dd3fc","ktpBorder":"#0ea5e9","zone":"parliament","look":{"outfit":"prison","accessory":"pin","accentColor":"#c2410c"},"work":{"label":"Kasih Wejangan","reward":35},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":5}},{"id":"elite","preset":"elite","name":"Penyelundup Ulung","shortName":"PENYELUNDUP","min":61,"max":100,"seatTitles":[],"titlePool":["Penyelundup Mie","Bandar Camilan","Pemilik Kantin Gelap","Makelar Kunjungan"],"nametagColor":"#c084fc","ktpBorder":"#9333ea","zone":"elite_complex","look":{"outfit":"prison","accessory":"sunglasses","accentColor":"#7c3aed"},"work":{"label":"Selundupkan Mie Instan","reward":45},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":20,"incomeBonusPct":10}},{"id":"ring2","preset":"ring2","name":"Koki & Tukang Cukur","shortName":"SKILL","min":101,"max":250,"seatTitles":[],"titlePool":["Koki Penjara","Tukang Cukur Sel","Tukang Jahit","Penjaga Perpus"],"nametagColor":"#2dd4bf","ktpBorder":"#0d9488","zone":"commercial","look":{"outfit":"prison","accessory":"hat","accentColor":"#f5f5f4"},"work":{"label":"Masak Nasi Cadong","reward":28},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":5}},{"id":"grassroot","preset":"grassroot","name":"Kepala Kamar","shortName":"KAMAR","min":251,"max":500,"seatTitles":[],"titlePool":["Kepala Kamar","Tamping","Pengurus Pengajian","Ketua Senam Pagi"],"nametagColor":"#fb923c","ktpBorder":"#c2410c","zone":"residential","look":{"outfit":"prison","accessory":"cap","accentColor":"#ea580c"},"work":{"label":"Bersihin Sel","reward":22},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":0}},{"id":"street","preset":"street","name":"Napi Pekerja","shortName":"PEKERJA","min":501,"max":1000,"seatTitles":[],"titlePool":["Pekerja Bengkel","Petani Kebun Lapas","Tukang Cuci","Penggali Rahasia"],"nametagColor":"#a3e635","ktpBorder":"#65a30d","zone":"gate","look":{"outfit":"prison","accessory":"none","accentColor":"#ea580c"},"work":{"label":"Kerja Bakti","reward":18},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}},{"id":"civil","preset":"civil","name":"Tahanan Baru","shortName":"TAHANAN","min":1001,"max":null,"seatTitles":[],"titlePool":["Tahanan Baru","Salah Tangkap","Napi Galau","Penghitung Hari","Pemimpi Kabur"],"nametagColor":"#e5e7eb","ktpBorder":"#6b7280","zone":"anywhere","look":{"outfit":"prison","accessory":"none","accentColor":"#ea580c"},"work":{"label":"Nyapu Lorong","reward":12},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}}],"impeachedTier":{"id":"impeached","preset":"civil","name":"Warga Gelap (Dimakzulkan)","shortName":"GELAP","min":0,"max":0,"seatTitles":[],"titlePool":[],"nametagColor":"#9ca3af","ktpBorder":"#4b5563","zone":"anywhere","look":{"outfit":"casual","accessory":"none","accentColor":"#64748b"},"work":{"label":"Nyapu Lorong","reward":9},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}},"buildings":[{"id":"sel_biasa","name":"Sel Biasa","category":"residential","emoji":"🔒","baseCost":100,"incomePerLevelPerDay":8,"color":"#78716c","upgradeMultiplier":1.6,"maxLevel":5},{"id":"sel_vip","name":"Sel VIP Ber-AC","category":"residential","emoji":"🛋️","baseCost":1200,"incomePerLevelPerDay":95,"color":"#d4a017","upgradeMultiplier":1.6,"maxLevel":5},{"id":"dapur","name":"Dapur Umum","category":"commercial","emoji":"🍲","baseCost":250,"incomePerLevelPerDay":22,"color":"#ea580c","upgradeMultiplier":1.6,"maxLevel":5},{"id":"kantin_gelap","name":"Kantin Gelap","category":"commercial","emoji":"🍜","baseCost":400,"incomePerLevelPerDay":34,"color":"#57534e","upgradeMultiplier":1.6,"maxLevel":5},{"id":"gym","name":"Gym Besi Bekas","category":"commercial","emoji":"🏋️","baseCost":600,"incomePerLevelPerDay":50,"color":"#1c1917","upgradeMultiplier":1.6,"maxLevel":5},{"id":"bengkel_lapas","name":"Bengkel Kerja","category":"commercial","emoji":"🔧","baseCost":800,"incomePerLevelPerDay":68,"color":"#64748b","upgradeMultiplier":1.6,"maxLevel":5},{"id":"pos_jaga","name":"Pos Jaga Sipir","category":"government","emoji":"🚨","baseCost":300,"incomePerLevelPerDay":25,"color":"#1e3a8a","upgradeMultiplier":1.6,"maxLevel":5,"requiresPerk":"canBuildGovernment"}],"projects":[{"id":"terowongan_kabur","name":"Gali Terowongan Kabur","description":"Sssst… jangan bilang sipir.","emoji":"🕳️","goal":50000},{"id":"lapangan_futsal","name":"Lapangan Futsal Lapas","description":"Turnamen antar blok!","emoji":"⚽","goal":120000},{"id":"kapal_kabur","name":"Kapal Kabur Massal","description":"Rencana besar, dimulai dari 1 sendok.","emoji":"🚤","goal":250000}],"landmarks":[{"id":"lapangan","kind":"plaza","name":"Lapangan Apel","emoji":"🏳️"},{"id":"kantor_sipir","kind":"palace","name":"Kantor Kepala Sipir","emoji":"🏢"},{"id":"aula","kind":"parliament","name":"Aula Pembinaan","emoji":"📢"},{"id":"blok_vip","kind":"elite_complex","name":"Blok VIP","emoji":"💎"},{"id":"koperasi","kind":"shop","name":"Koperasi Lapas","emoji":"🏪"},{"id":"dermaga","kind":"gate","name":"Dermaga Kunjungan","emoji":"⛴️"},{"id":"proyek","kind":"project_site","name":"Zona \"Renovasi\" Rahasia","emoji":"🚧"}],"economy":{"startingCoins":20,"workCooldownMinutes":120,"statusCooldownMinutes":10,"statusMaxLength":50,"announcementMaxLength":160,"igChangeCooldownMinutes":30,"recheckCooldownMinutes":60,"pollProposalCooldownMinutes":360,"land":{"basePrice":200,"ringDecayPct":25,"minPrice":50,"innerLayerBonusPct":20,"maxPlotsPerCitizen":5},"income":{"maxAccrualHours":24},"requireVerified":{"buyLand":true,"build":true,"donate":true,"vote":true,"governance":true}},"map":{"coreRadius":3,"layersPerRing":2,"ringMilestones":[0,100,500,1000,2500,5000,10000,25000,50000,100000],"occupancyUnlockPct":80,"ringNames":["Inti Pusat","Distrik Perintis","Distrik Kota Baru","Megapolitan"],"ringNameFallback":"Ekspansi Ring {n}"},"registration":{"softGateFollow":false,"softGateDelaySeconds":3,"displayNameMaxLength":16,"maxRegistrationsPerIp24h":2,"avatarColors":["#ef4444","#f97316","#eab308","#22c55e","#14b8a6","#3b82f6","#8b5cf6","#ec4899","#78716c","#0f172a"],"avatarAccessories":["none","cap","hat","sunglasses","helmet"]},"verification":{"checkWindowHours":24,"impeachAfterHours":48,"impeachMaxNumber":100},"sandbox":{"workCooldownMinutes":1,"statusCooldownMinutes":0.25,"igChangeCooldownMinutes":0.25,"recheckCooldownMinutes":0.25,"pollProposalCooldownMinutes":0.5}}$cfg$::jsonb, 'terowongan_kabur', 50000)
ON CONFLICT (world_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  ig_account_handle = EXCLUDED.ig_account_handle,
  config = EXCLUDED.config,
  active_project_goal = CASE WHEN public.world_states.active_project_id = '' THEN EXCLUDED.active_project_goal ELSE public.world_states.active_project_goal END,
  active_project_id = CASE WHEN public.world_states.active_project_id = '' THEN EXCLUDED.active_project_id ELSE public.world_states.active_project_id END,
  updated_at = now();

-- Koloni Mars (kolonimars.pages.dev)
INSERT INTO public.world_states (world_id, display_name, ig_account_handle, config, active_project_id, active_project_goal)
VALUES ('koloni-mars', 'Koloni Mars', 'kolonimars', $cfg${"worldId":"koloni-mars","igAccountHandle":"kolonimars","domain":"kolonimars.pages.dev","ktpPrefix":"KM","currency":{"code":"O2","name":"Tabung Oksigen"},"copy":{"citizenNoun":"Kolonis","guestLabel":"Sinyal","registerCta":"Ikut Misi","ktpTitle":"KARTU IDENTITAS KOLONIS","ktpDisclaimer":"Kartu kolonis virtual • fiksi ilmiah","nationName":"Koloni Mars","nationShort":"Koloni","tvName":"Transmisi Koloni","tagline":"1 Follower = 1 Kolonis. Mendarat duluan = jadi Komandan!","stamps":{"pending":"MENUNGGU KARANTINA","verified":"SAH • LOLOS KARANTINA","not_following":"BELUM FOLLOW / PENUMPANG GELAP","impeached":"DIKIRIM PULANG KE BUMI"}},"theme":{"primary":"#c2410c","accent":"#22d3ee","background":"#1c0f0a","surface":"#2a1810","text":"#ffedd5","muted":"#fdba74","ground":"#9a3412","road":"#57534e"},"tiers":[{"id":"head","preset":"head","name":"Komandan Koloni","shortName":"KOMANDAN","min":1,"max":1,"seatTitles":["Komandan Koloni Mars"],"titlePool":[],"nametagColor":"#facc15","ktpBorder":"#d4a017","zone":"palace","look":{"outfit":"spacesuit","accessory":"crown","accentColor":"#22d3ee"},"work":{"label":"Kirim Laporan ke Bumi","reward":60},"perks":{"canAnnounce":true,"canCreatePoll":true,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":10,"incomeBonusPct":20}},{"id":"deputy","preset":"deputy","name":"Wakil Komandan","shortName":"WAKOM","min":2,"max":2,"seatTitles":["Wakil Komandan"],"titlePool":[],"nametagColor":"#fde047","ktpBorder":"#d4a017","zone":"palace","look":{"outfit":"spacesuit","accessory":"star","accentColor":"#facc15"},"work":{"label":"Cek Kebocoran Kubah","reward":50},"perks":{"canAnnounce":true,"canCreatePoll":true,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":10,"incomeBonusPct":15}},{"id":"cabinet","preset":"cabinet","name":"Ilmuwan Utama","shortName":"ILMUWAN","min":3,"max":30,"seatTitles":[],"titlePool":["Kepala Botani","Ahli Geologi Mars","Dokter Koloni","Insinyur Reaktor","Ahli Terraform"],"nametagColor":"#fbbf24","ktpBorder":"#c9a227","zone":"ring1","look":{"outfit":"spacesuit","accessory":"antenna","accentColor":"#e5e7eb"},"work":{"label":"Eksperimen Tanaman Mars","reward":40},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":10}},{"id":"council","preset":"council","name":"Pilot Roket","shortName":"PILOT","min":31,"max":60,"seatTitles":[],"titlePool":["Pilot Roket","Navigator Orbit","Pilot Rover","Kapten Shuttle"],"nametagColor":"#7dd3fc","ktpBorder":"#0ea5e9","zone":"parliament","look":{"outfit":"spacesuit","accessory":"helmet","accentColor":"#0ea5e9"},"work":{"label":"Uji Terbang Roket","reward":35},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":5}},{"id":"elite","preset":"elite","name":"Investor Antariksa","shortName":"INVESTOR","min":61,"max":100,"seatTitles":[],"titlePool":["Miliarder Antariksa","Juragan Tambang Asteroid","Pemilik Kubah Pribadi"],"nametagColor":"#c084fc","ktpBorder":"#9333ea","zone":"elite_complex","look":{"outfit":"suit","accessory":"sunglasses","accentColor":"#7c3aed"},"work":{"label":"Jual Kavling Mars","reward":45},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":20,"incomeBonusPct":10}},{"id":"ring2","preset":"ring2","name":"Teknisi AI","shortName":"TEKNISI","min":101,"max":250,"seatTitles":[],"titlePool":["Teknisi AI","Programmer Rover","Operator Drone","Perakit Robot"],"nametagColor":"#2dd4bf","ktpBorder":"#0d9488","zone":"commercial","look":{"outfit":"casual","accessory":"sparkle","accentColor":"#14b8a6"},"work":{"label":"Update Firmware Robot","reward":28},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":5}},{"id":"grassroot","preset":"grassroot","name":"Kepala Habitat","shortName":"HABITAT","min":251,"max":500,"seatTitles":[],"titlePool":["Kepala Habitat","Petugas Logistik","Koordinator Air","Penjaga Greenhouse"],"nametagColor":"#fb923c","ktpBorder":"#c2410c","zone":"residential","look":{"outfit":"uniform","accessory":"cap","accentColor":"#ea580c"},"work":{"label":"Bagi Jatah Oksigen","reward":22},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":0}},{"id":"street","preset":"street","name":"Astronot","shortName":"ASTRONOT","min":501,"max":1000,"seatTitles":[],"titlePool":["Astronot Tambang","Pengumpul Sampel","Mekanik Rover","Koki Antariksa"],"nametagColor":"#a3e635","ktpBorder":"#65a30d","zone":"gate","look":{"outfit":"spacesuit","accessory":"helmet","accentColor":"#f97316"},"work":{"label":"Patroli Permukaan","reward":18},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}},{"id":"civil","preset":"civil","name":"Penumpang Gelap","shortName":"PENUMPANG","min":1001,"max":null,"seatTitles":[],"titlePool":["Penumpang Gelap","Turis Antariksa","Kolonis Lotre","Pemenang Undian Mars","Pencari Alien"],"nametagColor":"#e5e7eb","ktpBorder":"#6b7280","zone":"anywhere","look":{"outfit":"casual","accessory":"none","accentColor":"#64748b"},"work":{"label":"Bersihin Debu Panel Surya","reward":12},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}}],"impeachedTier":{"id":"impeached","preset":"civil","name":"Warga Gelap (Dimakzulkan)","shortName":"GELAP","min":0,"max":0,"seatTitles":[],"titlePool":[],"nametagColor":"#9ca3af","ktpBorder":"#4b5563","zone":"anywhere","look":{"outfit":"casual","accessory":"none","accentColor":"#64748b"},"work":{"label":"Bersihin Debu Panel Surya","reward":9},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}},"buildings":[{"id":"habitat_pod","name":"Habitat Pod","category":"residential","emoji":"🛸","baseCost":100,"incomePerLevelPerDay":8,"color":"#e5e7eb","upgradeMultiplier":1.6,"maxLevel":5},{"id":"kubah_keluarga","name":"Kubah Keluarga","category":"residential","emoji":"🫧","baseCost":500,"incomePerLevelPerDay":40,"color":"#22d3ee","upgradeMultiplier":1.6,"maxLevel":5},{"id":"panel_surya","name":"Ladang Panel Surya","category":"commercial","emoji":"🔆","baseCost":250,"incomePerLevelPerDay":22,"color":"#facc15","upgradeMultiplier":1.6,"maxLevel":5},{"id":"greenhouse","name":"Greenhouse Kentang","category":"commercial","emoji":"🥔","baseCost":400,"incomePerLevelPerDay":34,"color":"#16a34a","upgradeMultiplier":1.6,"maxLevel":5},{"id":"lab","name":"Laboratorium","category":"commercial","emoji":"🧬","baseCost":900,"incomePerLevelPerDay":75,"color":"#a855f7","upgradeMultiplier":1.6,"maxLevel":5},{"id":"pabrik_oksigen","name":"Pabrik Oksigen","category":"commercial","emoji":"🫁","baseCost":1800,"incomePerLevelPerDay":150,"color":"#0ea5e9","upgradeMultiplier":1.6,"maxLevel":5},{"id":"menara_komunikasi","name":"Menara Komunikasi","category":"government","emoji":"📡","baseCost":1000,"incomePerLevelPerDay":80,"color":"#64748b","upgradeMultiplier":1.6,"maxLevel":5,"requiresPerk":"canBuildGovernment"}],"projects":[{"id":"kubah_oksigen","name":"Kubah Oksigen Raksasa","description":"Napas lega untuk semua kolonis.","emoji":"🫧","goal":50000},{"id":"lift_orbit","name":"Lift Orbit","description":"Naik ke orbit tanpa roket.","emoji":"🛗","goal":120000},{"id":"roket_jupiter","name":"Roket ke Jupiter","description":"Ekspansi berikutnya!","emoji":"🚀","goal":250000}],"landmarks":[{"id":"plaza","kind":"plaza","name":"Plaza Pendaratan","emoji":"🛬"},{"id":"markas","kind":"palace","name":"Markas Komando","emoji":"🛰️"},{"id":"ruang_sidang","kind":"parliament","name":"Ruang Sidang Koloni","emoji":"🧑‍🚀"},{"id":"distrik_investor","kind":"elite_complex","name":"Kubah Investor","emoji":"💎"},{"id":"toko","kind":"shop","name":"Minimarket Antariksa","emoji":"🏪"},{"id":"landasan","kind":"gate","name":"Landasan Roket & Rover","emoji":"🚀"},{"id":"proyek","kind":"project_site","name":"Zona Konstruksi","emoji":"🚧"}],"economy":{"startingCoins":20,"workCooldownMinutes":120,"statusCooldownMinutes":10,"statusMaxLength":50,"announcementMaxLength":160,"igChangeCooldownMinutes":30,"recheckCooldownMinutes":60,"pollProposalCooldownMinutes":360,"land":{"basePrice":200,"ringDecayPct":25,"minPrice":50,"innerLayerBonusPct":20,"maxPlotsPerCitizen":5},"income":{"maxAccrualHours":24},"requireVerified":{"buyLand":true,"build":true,"donate":true,"vote":true,"governance":true}},"map":{"coreRadius":3,"layersPerRing":2,"ringMilestones":[0,100,500,1000,2500,5000,10000,25000,50000,100000],"occupancyUnlockPct":80,"ringNames":["Inti Pusat","Distrik Perintis","Distrik Kota Baru","Megapolitan"],"ringNameFallback":"Ekspansi Ring {n}"},"registration":{"softGateFollow":false,"softGateDelaySeconds":3,"displayNameMaxLength":16,"maxRegistrationsPerIp24h":2,"avatarColors":["#ef4444","#f97316","#eab308","#22c55e","#14b8a6","#3b82f6","#8b5cf6","#ec4899","#78716c","#0f172a"],"avatarAccessories":["none","cap","hat","sunglasses","helmet"]},"verification":{"checkWindowHours":24,"impeachAfterHours":48,"impeachMaxNumber":100},"sandbox":{"workCooldownMinutes":1,"statusCooldownMinutes":0.25,"igChangeCooldownMinutes":0.25,"recheckCooldownMinutes":0.25,"pollProposalCooldownMinutes":0.5}}$cfg$::jsonb, 'kubah_oksigen', 50000)
ON CONFLICT (world_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  ig_account_handle = EXCLUDED.ig_account_handle,
  config = EXCLUDED.config,
  active_project_goal = CASE WHEN public.world_states.active_project_id = '' THEN EXCLUDED.active_project_goal ELSE public.world_states.active_project_goal END,
  active_project_id = CASE WHEN public.world_states.active_project_id = '' THEN EXCLUDED.active_project_id ELSE public.world_states.active_project_id END,
  updated_at = now();

-- Kerajaan Kucing (kerajaankucing.pages.dev)
INSERT INTO public.world_states (world_id, display_name, ig_account_handle, config, active_project_id, active_project_goal)
VALUES ('kerajaan-kucing', 'Kerajaan Kucing', 'kerajaankucing', $cfg${"worldId":"kerajaan-kucing","igAccountHandle":"kerajaankucing","domain":"kerajaankucing.pages.dev","ktpPrefix":"KC","currency":{"code":"Whiskas","name":"Butir Whiskas"},"copy":{"citizenNoun":"Kucing","guestLabel":"Kucing Liar","registerCta":"Adopsi Diri","ktpTitle":"KARTU TANDA KUCING","ktpDisclaimer":"Kartu kucing virtual • bukan dokumen resmi","nationName":"Kerajaan Kucing","nationShort":"Kerajaan Meong","tvName":"Meong News","tagline":"1 Follower = 1 Kucing. Daftar duluan = jadi Raja Oren!","stamps":{"pending":"MENUNGGU DIELUS","verified":"SAH • KUCING RESMI","not_following":"BELUM FOLLOW / KUCING GARONG","impeached":"DIUSIR KE GOT"}},"theme":{"primary":"#f97316","accent":"#fde68a","background":"#fff7ed","surface":"#ffffff","text":"#431407","muted":"#9a3412","ground":"#bbf7d0","road":"#e7e5e4"},"tiers":[{"id":"head","preset":"head","name":"Raja Oren Barbar","shortName":"RAJA OREN","min":1,"max":1,"seatTitles":["Raja Kucing Oren Barbar"],"titlePool":[],"nametagColor":"#facc15","ktpBorder":"#d4a017","zone":"palace","look":{"outfit":"fur","accessory":"crown","accentColor":"#f97316"},"work":{"label":"Tidur 18 Jam","reward":60},"perks":{"canAnnounce":true,"canCreatePoll":true,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":10,"incomeBonusPct":20}},{"id":"deputy","preset":"deputy","name":"Permaisuri Calico","shortName":"PERMAISURI","min":2,"max":2,"seatTitles":["Permaisuri Calico"],"titlePool":[],"nametagColor":"#fde047","ktpBorder":"#d4a017","zone":"palace","look":{"outfit":"fur","accessory":"star","accentColor":"#fde68a"},"work":{"label":"Menjatuhkan Gelas","reward":50},"perks":{"canAnnounce":true,"canCreatePoll":true,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":10,"incomeBonusPct":15}},{"id":"cabinet","preset":"cabinet","name":"Kucing Oren Barbar","shortName":"OREN","min":3,"max":60,"seatTitles":[],"titlePool":["Oren Penguasa Gang","Oren Pencuri Ikan","Oren Tukang Tawuran","Oren Kebal Hujan","Oren Preman Pasar"],"nametagColor":"#fbbf24","ktpBorder":"#c9a227","zone":"ring1","look":{"outfit":"fur","accessory":"ears","accentColor":"#ea580c"},"work":{"label":"Rebut Ikan Tetangga","reward":40},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":true,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":10}},{"id":"elite","preset":"elite","name":"Kucing Ras","shortName":"RAS","min":61,"max":250,"seatTitles":[],"titlePool":["Persia Sultan","Anggora Selebgram","British Shorthair Bangsawan","Maine Coon Raksasa","Sphynx Misterius"],"nametagColor":"#c084fc","ktpBorder":"#9333ea","zone":"elite_complex","look":{"outfit":"fur","accessory":"sparkle","accentColor":"#c084fc"},"work":{"label":"Pose Buat Konten","reward":45},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":20,"incomeBonusPct":10}},{"id":"grassroot","preset":"grassroot","name":"Kucing Abu","shortName":"ABU","min":251,"max":1000,"seatTitles":[],"titlePool":["Abu Penjaga Atap","Abu Kalem","Abu Pemburu Cicak","Abu Penunggu Warung"],"nametagColor":"#fb923c","ktpBorder":"#c2410c","zone":"residential","look":{"outfit":"fur","accessory":"ears","accentColor":"#9ca3af"},"work":{"label":"Patroli Atap","reward":22},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":true,"landDiscountPct":0,"incomeBonusPct":0}},{"id":"street","preset":"street","name":"Kucing Kampung","shortName":"KAMPUNG","min":1001,"max":5000,"seatTitles":[],"titlePool":["Kucing Kampung Belang","Kucing Pasar","Kucing Masjid","Kucing Kosan"],"nametagColor":"#a3e635","ktpBorder":"#65a30d","zone":"gate","look":{"outfit":"fur","accessory":"none","accentColor":"#a16207"},"work":{"label":"Ngemis di Warteg","reward":18},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}},{"id":"civil","preset":"civil","name":"Kitten","shortName":"KITTEN","min":5001,"max":null,"seatTitles":[],"titlePool":["Kitten Gemoy","Kitten Penasaran","Kitten Hiperaktif","Kitten Ngantukan"],"nametagColor":"#e5e7eb","ktpBorder":"#6b7280","zone":"anywhere","look":{"outfit":"fur","accessory":"none","accentColor":"#fbbf24"},"work":{"label":"Kejar Ekor Sendiri","reward":12},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}}],"impeachedTier":{"id":"impeached","preset":"civil","name":"Warga Gelap (Dimakzulkan)","shortName":"GELAP","min":0,"max":0,"seatTitles":[],"titlePool":[],"nametagColor":"#9ca3af","ktpBorder":"#4b5563","zone":"anywhere","look":{"outfit":"casual","accessory":"none","accentColor":"#64748b"},"work":{"label":"Kejar Ekor Sendiri","reward":9},"perks":{"canAnnounce":false,"canCreatePoll":false,"canProposePoll":false,"canBuildGovernment":false,"landDiscountPct":0,"incomeBonusPct":0}},"buildings":[{"id":"kardus_bekas","name":"Kardus Bekas","category":"residential","emoji":"📦","baseCost":100,"incomePerLevelPerDay":8,"color":"#a16207","upgradeMultiplier":1.6,"maxLevel":5},{"id":"rumah_kucing","name":"Rumah Kucing Kayu","category":"residential","emoji":"🏠","baseCost":400,"incomePerLevelPerDay":30,"color":"#f97316","upgradeMultiplier":1.6,"maxLevel":5},{"id":"cat_tree","name":"Cat Tree Bertingkat","category":"residential","emoji":"🌳","baseCost":1200,"incomePerLevelPerDay":95,"color":"#92400e","upgradeMultiplier":1.6,"maxLevel":5},{"id":"toko_ikan","name":"Toko Ikan Asin","category":"commercial","emoji":"🐟","baseCost":250,"incomePerLevelPerDay":22,"color":"#0ea5e9","upgradeMultiplier":1.6,"maxLevel":5},{"id":"warung_whiskas","name":"Warung Whiskas","category":"commercial","emoji":"🥫","baseCost":500,"incomePerLevelPerDay":42,"color":"#7c3aed","upgradeMultiplier":1.6,"maxLevel":5},{"id":"salon_kucing","name":"Salon Grooming","category":"commercial","emoji":"✂️","baseCost":900,"incomePerLevelPerDay":75,"color":"#ec4899","upgradeMultiplier":1.6,"maxLevel":5},{"id":"pos_meong","name":"Pos Ronda Meong","category":"government","emoji":"🔔","baseCost":300,"incomePerLevelPerDay":25,"color":"#ea580c","upgradeMultiplier":1.6,"maxLevel":5,"requiresPerk":"canBuildGovernment"}],"projects":[{"id":"menara_kardus","name":"Menara Kardus Raksasa","description":"Tempat tidur tertinggi di dunia.","emoji":"📦","goal":50000},{"id":"kolam_ikan","name":"Kolam Ikan Nasional","description":"Ikan segar untuk semua.","emoji":"🐠","goal":120000},{"id":"laser_raksasa","name":"Titik Laser Raksasa","description":"Hiburan nasional tiada akhir.","emoji":"🔴","goal":250000}],"landmarks":[{"id":"taman","kind":"plaza","name":"Taman Jemur Matahari","emoji":"☀️"},{"id":"istana_kardus","kind":"palace","name":"Istana Kardus Raja","emoji":"👑"},{"id":"dewan_meong","kind":"parliament","name":"Dewan Meong (Sering Tidur)","emoji":"😴"},{"id":"distrik_ras","kind":"elite_complex","name":"Distrik Kucing Ras","emoji":"💎"},{"id":"pasar_ikan","kind":"shop","name":"Pasar Ikan 24 Jam","emoji":"🐟"},{"id":"pagar","kind":"gate","name":"Pagar Tembok & Got Utama","emoji":"🧱"},{"id":"proyek","kind":"project_site","name":"Zona Proyek Meong","emoji":"🚧"}],"economy":{"startingCoins":20,"workCooldownMinutes":120,"statusCooldownMinutes":10,"statusMaxLength":50,"announcementMaxLength":160,"igChangeCooldownMinutes":30,"recheckCooldownMinutes":60,"pollProposalCooldownMinutes":360,"land":{"basePrice":200,"ringDecayPct":25,"minPrice":50,"innerLayerBonusPct":20,"maxPlotsPerCitizen":5},"income":{"maxAccrualHours":24},"requireVerified":{"buyLand":true,"build":true,"donate":true,"vote":true,"governance":true}},"map":{"coreRadius":3,"layersPerRing":2,"ringMilestones":[0,100,500,1000,2500,5000,10000,25000,50000,100000],"occupancyUnlockPct":80,"ringNames":["Inti Pusat","Distrik Perintis","Distrik Kota Baru","Megapolitan"],"ringNameFallback":"Ekspansi Ring {n}"},"registration":{"softGateFollow":false,"softGateDelaySeconds":3,"displayNameMaxLength":16,"maxRegistrationsPerIp24h":2,"avatarColors":["#ef4444","#f97316","#eab308","#22c55e","#14b8a6","#3b82f6","#8b5cf6","#ec4899","#78716c","#0f172a"],"avatarAccessories":["none","cap","hat","sunglasses","helmet"]},"verification":{"checkWindowHours":24,"impeachAfterHours":48,"impeachMaxNumber":100},"sandbox":{"workCooldownMinutes":1,"statusCooldownMinutes":0.25,"igChangeCooldownMinutes":0.25,"recheckCooldownMinutes":0.25,"pollProposalCooldownMinutes":0.5}}$cfg$::jsonb, 'menara_kardus', 50000)
ON CONFLICT (world_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  ig_account_handle = EXCLUDED.ig_account_handle,
  config = EXCLUDED.config,
  active_project_goal = CASE WHEN public.world_states.active_project_id = '' THEN EXCLUDED.active_project_goal ELSE public.world_states.active_project_goal END,
  active_project_id = CASE WHEN public.world_states.active_project_id = '' THEN EXCLUDED.active_project_id ELSE public.world_states.active_project_id END,
  updated_at = now();

-- Generate kavling untuk ring yang sudah terbuka (idempotent)
SELECT public.nv_ensure_plots(world_id, current_ring_unlocked) FROM public.world_states WHERE world_id IN ('republik-konoha', 'pt-virtual', 'kampus-virtual', 'kampung-mistis', 'kerajaan-nusantara', 'guild-petualang', 'kota-mafia', 'pulau-penjara', 'koloni-mars', 'kerajaan-kucing');
