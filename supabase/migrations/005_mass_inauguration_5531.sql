-- =====================================================================================================
-- 005 — Pelantikan massal 5.531 warga Republik Konoha + perbaikan gerbang Iuran/Beli.
--
-- AKAR BUG: E-KTP menampilkan "SAH DILANTIK" berdasarkan nomor kursi, tetapi semua RPC ekonomi
-- (donate_to_project, buy_land_plot, buy_property, build_or_upgrade_property, cast_poll_vote, ...)
-- lewat nv_require_verified yang HANYA lolos bila follow_status = 'verified'. Di production hanya 1 dari
-- 5.553 warga yang 'verified' (sisanya 'pending' / 'recheck_requested'), jadi warga "dilantik" tetap
-- ditolak server.
--
-- PERBAIKAN (satu sumber kebenaran, sama dengan isInaugurated() di src/lib/inauguration.ts):
--   lolos bila follow_status = 'verified'
--        ATAU (follow_status <> 'impeached' AND citizen_number <= config.economy.inauguratedUpto)
--
-- 5.531 warga pertama = citizen_number <= 5535 (nomor #3347, #4185, #4335, #4347 kosong).
--   #0001–#1000  Perintis 1K   · #1001–#5535 Gelombang 2   · #5536+ antrean gelombang berikutnya
--
-- ZERO DATA LOSS: tidak ada DELETE/TRUNCATE; saldo, kavling & properti tidak disentuh.
-- Hemat Disk IO: 1 UPDATE bulk untuk warga (tanpa trigger, tabel citizens tidak di publikasi realtime).
-- Aman dijalankan ulang (idempoten).
-- =====================================================================================================
BEGIN;

-- 0) Pengaman: batas nomor harus tepat mencakup 5.531 warga. Kalau data berubah, batalkan semuanya.
DO $$
DECLARE v_n INTEGER;
BEGIN
  SELECT count(*) INTO v_n FROM public.citizens WHERE world_id = 'republik-konoha' AND citizen_number <= 5535;
  IF v_n <> 5531 THEN
    RAISE EXCEPTION 'Batal: citizen_number <= 5535 berisi % warga (harus 5531). Hitung ulang batas nomor.', v_n;
  END IF;
END;
$$;

-- 1) Batas pelantikan disimpan di config dunia (juga ada di config frontend → seed.sql tetap sinkron).
UPDATE public.world_states
SET config = jsonb_set(config, '{economy,inauguratedUpto}', '5535'::jsonb, true),
    updated_at = now()
WHERE world_id = 'republik-konoha'
  AND (config->'economy'->>'inauguratedUpto') IS DISTINCT FROM '5535';

-- 2) Gerbang hak akses: verifikasi follow ATAU nomor kursi sudah dilantik (dimakzulkan selalu terkunci).
CREATE OR REPLACE FUNCTION public.nv_require_verified(p_world public.world_states, p_c public.citizens, p_action TEXT)
RETURNS VOID LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_upto INTEGER := coalesce(nullif(p_world.config->'economy'->>'inauguratedUpto', '')::integer, 0);
BEGIN
  IF NOT coalesce((p_world.config->'economy'->'requireVerified'->>p_action)::boolean, TRUE) THEN RETURN; END IF;
  IF p_c.follow_status = 'verified' THEN RETURN; END IF;
  IF p_c.follow_status = 'impeached' THEN
    RAISE EXCEPTION 'Akses terkunci: kamu sudah dimakzulkan. Hubungi admin untuk pemulihan status.';
  END IF;
  IF p_c.citizen_number <= v_upto THEN RETURN; END IF; -- resmi dilantik lewat pelantikan massal

  IF p_c.follow_status = 'not_following' THEN
    RAISE EXCEPTION 'Akun @% belum terdeteksi follow @%. Follow dulu lalu klik Cek Ulang atau Ganti Instagram.',
      p_c.ig_username, p_world.ig_account_handle;
  END IF;
  RAISE EXCEPTION 'Kursi #% masih antre pelantikan gelombang berikutnya. Fitur ini terbuka setelah resmi dilantik (atau verifikasi follow @% otomatis maks. 1x24 jam).',
    lpad(p_c.citizen_number::text, 4, '0'), p_world.ig_account_handle;
END;
$$;

-- 3) Pelantikan massal: 1 UPDATE bulk. Hanya kolom status follow; tidak menyentuh warga yang dimakzulkan.
UPDATE public.citizens
SET follow_status = 'verified',
    follow_checked_at = coalesce(follow_checked_at, now())
WHERE world_id = 'republik-konoha'
  AND citizen_number <= 5535
  AND follow_status IN ('pending', 'recheck_requested', 'not_following');

COMMIT;

NOTIFY pgrst, 'reload schema';
