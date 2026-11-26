-- =============================================================================
-- 007 — Login & muat KTP tanpa tulis ke disk — NON-DESTRUKTIF
--   * get_my_citizen   : BACA SAJA. Tidak ada lagi UPDATE last_active_at (aksi lain — kerja, chat,
--                        beli, donasi — tetap memperbarui last_active_at, jadi "warga aktif" tetap akurat).
--   * quick_login      : tidak ada SELECT ... FOR UPDATE (penguncian baris = tulis halaman ke disk) dan
--                        tidak ada UPDATE saat PIN benar, kecuali bila penghitung salah-PIN perlu di-reset.
--                        Sekarang juga mengembalikan data KTP (kolom 'citizen') → klien tidak perlu
--                        request kedua get_my_citizen setelah login.
--   * recover_session  : sama (tanpa FOR UPDATE / UPDATE rutin) + index upper(ktp_code) agar tidak seq scan.
--   Tidak ada data warga, PIN, saldo, maupun kavling yang diubah/dihapus.
--   Hanya CREATE OR REPLACE FUNCTION + CREATE INDEX IF NOT EXISTS. Aman dijalankan berulang kali.
-- =============================================================================

-- recover_session mencari upper(ktp_code) → index ekspresi supaya Index Scan, bukan Seq Scan.
CREATE INDEX IF NOT EXISTS idx_citizens_upper_ktp ON public.citizens (world_id, upper(ktp_code));

CREATE OR REPLACE FUNCTION public.get_my_citizen(p_world_id TEXT, p_citizen_id UUID, p_token UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_c public.citizens;
BEGIN
  -- PK lookup (id) + cek token, tanpa kunci baris dan tanpa UPDATE.
  v_c := public.nv_auth_citizen(p_world_id, p_citizen_id, p_token, FALSE);
  RETURN public.nv_citizen_private(v_c);
END;
$$;

CREATE OR REPLACE FUNCTION public.quick_login(p_world_id TEXT, p_username TEXT, p_pin TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  r JSONB := public.nv_quick_resolve(p_world_id, p_username);
  v public.citizens;
  v_left INTEGER;
BEGIN
  IF r->>'status' = 'ambiguous' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ada beberapa warga dengan nama itu. Ketik username Instagram-mu.');
  ELSIF r->>'status' <> 'found' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Username tidak ditemukan.');
  END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,6}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PIN harus 4–6 digit angka.');
  END IF;

  -- Baca biasa (PK) — tanpa FOR UPDATE.
  SELECT * INTO v FROM public.citizens WHERE id = (r->>'id')::uuid;

  -- Akun belum punya PIN: klaim dengan PIN baru (bukan untuk kursi VIP #001–#010).
  IF v.recovery_pin_hash IS NULL THEN
    IF v.citizen_number <= 10 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Akun ini dilindungi pengaman khusus. Gunakan pemulihan akun.');
    END IF;
    -- WHERE ... IS NULL menjaga balapan: hanya permintaan pertama yang menyimpan PIN.
    UPDATE public.citizens
    SET recovery_pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)),
        recovery_failed_attempts = 0, recovery_locked_until = NULL
    WHERE id = v.id AND recovery_pin_hash IS NULL
    RETURNING * INTO v;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'PIN akun ini baru saja dibuat. Masukkan PIN tersebut.');
    END IF;
    RETURN jsonb_build_object('ok', true, 'citizen_id', v.id, 'secret_token', v.secret_token, 'pin_created', true,
      'citizen', public.nv_citizen_private(v));
  END IF;

  -- Akun ber-PIN: verifikasi dengan kunci 1 jam setelah 5x salah (sama seperti recover_session).
  IF v.recovery_locked_until IS NOT NULL AND v.recovery_locked_until > now() THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'Terlalu banyak percobaan. Coba lagi dalam ' || public.nv_fmt_wait(v.recovery_locked_until - now()) || '.');
  END IF;
  IF extensions.crypt(p_pin, v.recovery_pin_hash) = v.recovery_pin_hash THEN
    -- Tulis HANYA bila memang ada sisa salah-PIN / kunci kedaluwarsa yang perlu dibersihkan.
    IF v.recovery_failed_attempts <> 0 OR v.recovery_locked_until IS NOT NULL THEN
      UPDATE public.citizens SET recovery_failed_attempts = 0, recovery_locked_until = NULL WHERE id = v.id;
    END IF;
    RETURN jsonb_build_object('ok', true, 'citizen_id', v.id, 'secret_token', v.secret_token, 'pin_created', false,
      'citizen', public.nv_citizen_private(v));
  END IF;

  -- PIN salah: penghitung dinaikkan secara atomik di UPDATE (aman tanpa FOR UPDATE).
  UPDATE public.citizens
  SET recovery_failed_attempts = CASE WHEN recovery_failed_attempts + 1 >= 5 THEN 0 ELSE recovery_failed_attempts + 1 END,
      recovery_locked_until = CASE WHEN recovery_failed_attempts + 1 >= 5 THEN now() + INTERVAL '1 hour' ELSE recovery_locked_until END
  WHERE id = v.id
  RETURNING recovery_failed_attempts, recovery_locked_until INTO v.recovery_failed_attempts, v.recovery_locked_until;
  v_left := CASE WHEN v.recovery_locked_until > now() THEN 0 ELSE 5 - v.recovery_failed_attempts END;
  RETURN jsonb_build_object('ok', false, 'error',
    CASE WHEN v_left <= 0 THEN 'PIN salah. KTP dikunci 1 jam.' ELSE 'PIN salah. Sisa ' || v_left || ' percobaan.' END);
END;
$$;

CREATE OR REPLACE FUNCTION public.recover_session(p_world_id TEXT, p_ktp_code TEXT, p_pin TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v public.citizens;
  v_left INTEGER;
BEGIN
  SELECT * INTO v FROM public.citizens
  WHERE world_id = p_world_id AND upper(ktp_code) = upper(btrim(coalesce(p_ktp_code, '')));
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
    IF v.recovery_failed_attempts <> 0 OR v.recovery_locked_until IS NOT NULL THEN
      UPDATE public.citizens SET recovery_failed_attempts = 0, recovery_locked_until = NULL WHERE id = v.id;
    END IF;
    RETURN jsonb_build_object('ok', true, 'citizen_id', v.id, 'secret_token', v.secret_token,
      'citizen', public.nv_citizen_private(v));
  END IF;
  UPDATE public.citizens
  SET recovery_failed_attempts = CASE WHEN recovery_failed_attempts + 1 >= 5 THEN 0 ELSE recovery_failed_attempts + 1 END,
      recovery_locked_until = CASE WHEN recovery_failed_attempts + 1 >= 5 THEN now() + INTERVAL '1 hour' ELSE recovery_locked_until END
  WHERE id = v.id
  RETURNING recovery_failed_attempts, recovery_locked_until INTO v.recovery_failed_attempts, v.recovery_locked_until;
  v_left := CASE WHEN v.recovery_locked_until > now() THEN 0 ELSE 5 - v.recovery_failed_attempts END;
  RETURN jsonb_build_object('ok', false, 'error',
    CASE WHEN v_left <= 0 THEN 'PIN salah. KTP dikunci 1 jam.' ELSE 'PIN salah. Sisa ' || v_left || ' percobaan.' END);
END;
$$;

-- Hak akses tetap sama seperti sebelumnya (CREATE OR REPLACE mempertahankan GRANT, ini hanya penegasan).
REVOKE ALL ON FUNCTION public.quick_login(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quick_login(TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_citizen(TEXT, UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_session(TEXT, TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
