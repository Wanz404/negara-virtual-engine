-- =====================================================================================================
-- 008 — Serah terima Wakil Presiden #0002 (Wanz) → #2552 (Adias, @adprji_) + Pelantikan Gelombang 3.
--
-- A. WAPRES: Wanz #0002 mengundurkan diri (skandal jual kursi 10K); Adias #2552 menang Pemilu Komentar
--    Cawapres (86 like). Jabatan = citizens.tier_id ('deputy') + role_title; perk Wapres (pidato, voting
--    langsung, bangun gedung pemerintah, diskon tanah 10%, bonus income 15%) ikut tier_id via nv_tier_perk.
--    - #2552 → tier 'deputy', 'Wakil Presiden Konoha', follow_status 'verified' (Resmi Dilantik).
--    - #0002 → tier lama #2552, role 'Mantan Wakil Presiden Konoha'. Tetap Perintis (stempel dihitung dari
--      nomor kursi #0001–#1000), tetap 'verified'. Akun, PIN, saldo RpK, kavling & warung TIDAK disentuh.
--    - Pesan Global Chat lama keduanya ikut diperbarui (kolom tier/role_title) agar badge WAPRES pindah.
--    - Bonus gaji jabatan kini dari tier_id (dulu nomor kursi <= 2), get_map_citizens selalu memuat
--      RI-1 & RI-2 (Istana di peta/popup menampilkan Wapres walau nomornya #2552).
--
-- B. PELANTIKAN GELOMBANG 3: #5536–MAX(citizen_number) saat dijalankan.
--    #0001–#1000 Perintis · #1001–#5535 Gelombang 2 (migrasi 005) · #5536–MAX Gelombang 3 ·
--    di atas MAX antrean Gelombang 4.
--    1 UPDATE bulk yang HANYA menyentuh baris belum dilantik di rentang Gelombang 3 (5.531 baris lama tidak
--    ditulis ulang) + world_states.config.economy.inauguratedUpto = MAX (dibaca nv_require_verified).
--
-- ZERO DATA LOSS: tidak ada DELETE/TRUNCATE. Hemat Disk IO: tanpa loop, 1 index kecil baru.
-- Aman dijalankan ulang (idempoten).
-- =====================================================================================================
BEGIN;

-- A1) Serah terima jabatan Wapres
DO $$
DECLARE
  w CONSTANT TEXT := 'republik-konoha';
  v_old public.citizens; -- Wanz #0002
  v_new public.citizens; -- Adias #2552
BEGIN
  SELECT * INTO v_old FROM public.citizens WHERE world_id = w AND citizen_number = 2 FOR UPDATE;
  SELECT * INTO v_new FROM public.citizens WHERE world_id = w AND citizen_number = 2552 FOR UPDATE;
  IF v_old.id IS NULL OR v_new.id IS NULL THEN RAISE EXCEPTION 'Batal: kursi #0002 / #2552 tidak ditemukan.'; END IF;
  IF v_new.tier_id = 'deputy' AND v_old.tier_id <> 'deputy' THEN RETURN; END IF; -- sudah pernah dijalankan
  IF v_old.tier_id <> 'deputy' OR v_new.tier_id IN ('head', 'deputy', 'impeached') THEN
    RAISE EXCEPTION 'Batal: tier tak terduga (#0002=%, #2552=%).', v_old.tier_id, v_new.tier_id;
  END IF;
  IF lower(coalesce(v_new.ig_username, '')) <> 'adprji_' THEN
    RAISE EXCEPTION 'Batal: #2552 bukan @adprji_ (ig=%).', v_new.ig_username;
  END IF;
  IF (SELECT count(*) FROM public.citizens WHERE world_id = w AND tier_id = 'deputy') <> 1 THEN
    RAISE EXCEPTION 'Batal: jumlah Wapres aktif bukan 1.';
  END IF;

  UPDATE public.citizens
  SET tier_id = v_new.tier_id, role_title = 'Mantan Wakil Presiden Konoha'
  WHERE id = v_old.id;

  UPDATE public.citizens
  SET tier_id = 'deputy',
      role_title = 'Wakil Presiden Konoha',
      follow_status = 'verified',
      follow_checked_at = coalesce(follow_checked_at, now())
  WHERE id = v_new.id;

  UPDATE public.global_chat_messages
  SET tier = v_new.tier_id, role_title = 'Mantan Wakil Presiden Konoha'
  WHERE world_id = w AND citizen_id = v_old.id AND tier = 'deputy';
  UPDATE public.global_chat_messages
  SET tier = 'deputy', role_title = 'Wakil Presiden Konoha'
  WHERE world_id = w AND citizen_id = v_new.id;

  PERFORM public.nv_news(w, v_new.id, 'verification',
    format('WAPRES BARU! %s resmi dilantik sebagai Wakil Presiden Konoha usai menang Pemilu Komentar Cawapres, menggantikan %s yang mengundurkan diri.',
      public.nv_tag(v_new.username, v_new.citizen_number), public.nv_tag(v_old.username, v_old.citizen_number)));
END;
$$;

-- A2) Bonus gaji jabatan dari tier_id (cermin rankSalaryBonus di src/lib/economy.ts)
CREATE OR REPLACE FUNCTION public.nv_rank_salary_bonus_tier(p_tier_id TEXT)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_tier_id IN ('head', 'deputy') THEN 40
    WHEN p_tier_id = 'cabinet' THEN 25
    WHEN p_tier_id IN ('council', 'elite') THEN 15
    ELSE 0 END
$$;
REVOKE ALL ON FUNCTION public.nv_rank_salary_bonus_tier(TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_daily_salary(p_world_id TEXT, p_citizen_id UUID, p_token UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_c public.citizens;
  v_next TIMESTAMPTZ;
  v_rank INTEGER;
  v_prop BIGINT;
  v_total BIGINT;
  v_now TIMESTAMPTZ := now();
BEGIN
  PERFORM public.nv_get_world(p_world_id);
  v_c := public.nv_auth_citizen(p_world_id, p_citizen_id, p_token); -- FOR UPDATE: anti klaim ganda paralel
  v_next := v_c.last_salary_at + INTERVAL '24 hours';
  IF v_next IS NOT NULL AND v_next > v_now THEN
    RAISE EXCEPTION 'Gaji hari ini sudah diambil. Tersedia lagi dalam %.', public.nv_fmt_wait(v_next - v_now);
  END IF;
  v_rank := public.nv_rank_salary_bonus_tier(v_c.tier_id);
  v_prop := public.nv_property_salary_bonus(p_world_id, v_c.id);
  v_total := 50 + v_rank + v_prop;
  UPDATE public.citizens
  SET coins = coins + v_total, last_salary_at = v_now, last_active_at = v_now
  WHERE id = v_c.id
  RETURNING * INTO v_c;
  RETURN jsonb_build_object(
    'reward', v_total, 'base', 50, 'rank_bonus', v_rank, 'property_bonus', v_prop,
    'coins', v_c.coins, 'citizen', public.nv_citizen_private(v_c));
END;
$$;

-- A3) Peta & Istana: RI-1/RI-2 selalu ikut di get_map_citizens (dibaca /api/snapshot), apa pun nomornya.
CREATE INDEX IF NOT EXISTS idx_citizens_world_tier ON public.citizens (world_id, tier_id, citizen_number);

CREATE OR REPLACE FUNCTION public.get_map_citizens(p_world_id TEXT, p_me UUID DEFAULT NULL, p_limit INTEGER DEFAULT 120)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH lim AS (SELECT least(greatest(coalesce(p_limit, 120), 1), 200) AS n),
  picks AS (
    SELECT 0 AS pri, c.id FROM public.citizens c WHERE c.world_id = p_world_id AND c.id = p_me
    UNION ALL
    (SELECT 0, c.id FROM public.citizens c WHERE c.world_id = p_world_id AND c.tier_id IN ('head', 'deputy') LIMIT 4)
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

-- B) Pelantikan Gelombang 3: batas = MAX(citizen_number) saat dijalankan. 1 UPDATE bulk yang HANYA menyentuh
--    baris belum dilantik di #5536..MAX (dimakzulkan tidak disentuh). Batas disimpan di config
--    (dibaca nv_require_verified dari migrasi 005 — fungsi itu tidak berubah).
CREATE TEMP TABLE IF NOT EXISTS nv_008_report (k TEXT PRIMARY KEY, v BIGINT);

DO $$
DECLARE
  w CONSTANT TEXT := 'republik-konoha';
  v_upto INTEGER;
  v_prev INTEGER;
  v_new BIGINT;
  v_total BIGINT;
BEGIN
  SELECT coalesce(nullif(config->'economy'->>'inauguratedUpto', '')::integer, 0) INTO v_prev
  FROM public.world_states WHERE world_id = w;
  SELECT max(citizen_number) INTO v_upto FROM public.citizens WHERE world_id = w;
  IF v_prev > 5535 THEN v_upto := v_prev; END IF; -- sudah pernah dijalankan → pakai batas yang sama
  IF v_upto IS NULL OR v_upto <= 5535 THEN RAISE EXCEPTION 'Batal: MAX(citizen_number)=% tidak masuk akal.', v_upto; END IF;

  UPDATE public.world_states
  SET config = jsonb_set(config, '{economy,inauguratedUpto}', to_jsonb(v_upto), true),
      updated_at = now()
  WHERE world_id = w AND v_prev IS DISTINCT FROM v_upto;

  UPDATE public.citizens
  SET follow_status = 'verified',
      follow_checked_at = coalesce(follow_checked_at, now())
  WHERE world_id = w
    AND citizen_number BETWEEN 5536 AND v_upto
    AND follow_status IN ('pending', 'recheck_requested', 'not_following');
  GET DIAGNOSTICS v_new = ROW_COUNT;

  SELECT count(*) INTO v_total FROM public.citizens
  WHERE world_id = w AND citizen_number <= v_upto AND follow_status <> 'impeached';

  IF v_new > 0 THEN
    PERFORM public.nv_news(w, NULL, 'verification',
      format('PELANTIKAN GELOMBANG 3! Warga #5536–#%s resmi dilantik — total %s+ Warga Resmi Dilantik, bebas Iuran Proyek & Beli Warung, Kavling RT & Item.',
        v_upto, to_char(v_total, 'FM999G999G999')));
  END IF;

  INSERT INTO nv_008_report VALUES ('inaugurated_upto', v_upto), ('newly_inaugurated', v_new), ('total_inaugurated', v_total),
    ('wave3_citizens', (SELECT count(*) FROM public.citizens WHERE world_id = w AND citizen_number BETWEEN 5536 AND v_upto))
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Laporan (salin hasil tabel ini ke Claude)
SELECT k AS item, v::text AS nilai FROM nv_008_report
UNION ALL
SELECT 'seat_' || lpad(citizen_number::text, 4, '0'), username || ' | ' || tier_id || ' | ' || role_title || ' | ' || follow_status
FROM public.citizens WHERE world_id = 'republik-konoha' AND citizen_number IN (1, 2, 2552, 5572)
ORDER BY 1;
