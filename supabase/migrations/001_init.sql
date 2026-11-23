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
