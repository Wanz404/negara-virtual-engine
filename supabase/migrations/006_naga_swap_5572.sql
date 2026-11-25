-- =====================================================================================================
-- 006 — Permintaan admin: kursi #5572 (Dika) masuk Daftar Naga (tier 'elite' / Konglomerat),
-- menggantikan #61 (Juliando): Naga paling tidak aktif (hanya aktif saat daftar 25-11, saldo 20 RpK,
-- 0 iuran, 0 kavling/usaha). Bukan admin/pejabat inti (#1/#2/kabinet tidak disentuh).
--
-- Mekanisme Naga = citizens.tier_id ('elite') + role_title. Yang ditukar HANYA tier_id & role_title.
-- ZERO DATA LOSS: akun, nomor kursi, saldo, kavling, properti #61 & #5572 tetap utuh.
-- #5572 di luar batch pelantikan (#0001–#5535) → ditandai 'verified' agar langsung Resmi Dilantik
-- (nv_require_verified loloskan follow_status = 'verified').
-- Daftar Naga di Kompleks Konglomerat dibaca dari DB lewat get_tier_members (di bawah).
-- =====================================================================================================
BEGIN;

DO $$
DECLARE
  w CONSTANT TEXT := 'republik-konoha';
  v_old public.citizens;
  v_new public.citizens;
BEGIN
  SELECT * INTO v_old FROM public.citizens WHERE world_id = w AND citizen_number = 61 FOR UPDATE;
  SELECT * INTO v_new FROM public.citizens WHERE world_id = w AND citizen_number = 5572 FOR UPDATE;
  IF v_old.id IS NULL OR v_new.id IS NULL THEN RAISE EXCEPTION 'Batal: kursi #61 / #5572 tidak ditemukan.'; END IF;
  IF v_old.tier_id = 'civil' AND v_new.tier_id = 'elite' THEN RETURN; END IF; -- sudah pernah dijalankan
  IF v_old.tier_id <> 'elite' OR v_new.tier_id <> 'civil' THEN
    RAISE EXCEPTION 'Batal: tier tak terduga (#61=%, #5572=%).', v_old.tier_id, v_new.tier_id;
  END IF;

  UPDATE public.citizens SET tier_id = v_new.tier_id, role_title = v_new.role_title WHERE id = v_old.id;
  UPDATE public.citizens
  SET tier_id = v_old.tier_id,
      role_title = v_old.role_title,
      follow_status = CASE WHEN follow_status = 'impeached' THEN follow_status ELSE 'verified' END,
      follow_checked_at = coalesce(follow_checked_at, now())
  WHERE id = v_new.id;

  PERFORM public.nv_news(w, v_new.id, 'verification',
    format('NAGA BARU! %s resmi masuk Daftar Naga sebagai %s.', public.nv_tag(v_new.username, v_new.citizen_number), v_old.role_title));
END;
$$;

-- Daftar anggota 1 tier (cth. Naga) urut nomor kursi. Ringan: maks 100 baris, hanya dipanggil saat
-- popup Kompleks Konglomerat dibuka (tidak masuk /api/snapshot).
CREATE OR REPLACE FUNCTION public.get_tier_members(p_world_id TEXT, p_tier_id TEXT, p_limit INTEGER DEFAULT 50)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(jsonb_agg(public.nv_citizen_public(c) ORDER BY c.citizen_number), '[]'::jsonb)
  FROM (
    SELECT * FROM public.citizens
    WHERE world_id = p_world_id AND tier_id = p_tier_id
    ORDER BY citizen_number
    LIMIT least(greatest(coalesce(p_limit, 50), 1), 100)
  ) c
$$;
REVOKE ALL ON FUNCTION public.get_tier_members(TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tier_members(TEXT, TEXT, INTEGER) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
