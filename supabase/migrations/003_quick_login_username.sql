-- =============================================================================
-- 003 — Masuk Cepat pakai Username (2 langkah) — NON-DESTRUKTIF
--   Langkah 1  quick_login_check(world, username) → status akun:
--              not_found | ambiguous | has_pin | needs_pin_setup | vip_protected
--   Langkah 2  quick_login(world, username, pin)
--              has_pin          → PIN wajib cocok (kunci 1 jam setelah 5x salah, sama seperti recover_session)
--              needs_pin_setup  → PIN baru disimpan (hanya bila masih NULL) lalu langsung masuk
--              vip_protected    → #001–#010 tanpa PIN tidak bisa diklaim dari halaman publik
--   Username dicocokkan ke username Instagram (unik) lebih dulu, lalu nama tampilan bila hasilnya tepat 1.
--   Token sesi lama TIDAK diganti → perangkat lain yang masih login tetap login.
--   Tidak ada kolom/tabel warga yang diubah; hanya fungsi + index baru.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_citizens_lower_username ON public.citizens (world_id, lower(username));

-- Resolusi username → id warga (IG username unik dulu, lalu nama tampilan bila tepat 1).
CREATE OR REPLACE FUNCTION public.nv_quick_resolve(p_world_id TEXT, p_username TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_q TEXT := lower(btrim(regexp_replace(coalesce(p_username, ''), '^[\s@]+', '')));
  v_id UUID;
  v_n INTEGER;
BEGIN
  IF v_q = '' OR char_length(v_q) > 40 THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  SELECT id INTO v_id FROM public.citizens WHERE world_id = p_world_id AND ig_username = v_q;
  IF v_id IS NULL THEN
    SELECT count(*), min(id::text)::uuid INTO v_n, v_id
    FROM public.citizens WHERE world_id = p_world_id AND lower(username) = v_q;
    IF v_n = 0 THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
    IF v_n > 1 THEN RETURN jsonb_build_object('status', 'ambiguous'); END IF;
  END IF;
  RETURN jsonb_build_object('status', 'found', 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.quick_login_check(p_world_id TEXT, p_username TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r JSONB := public.nv_quick_resolve(p_world_id, p_username);
  v public.citizens;
BEGIN
  IF r->>'status' <> 'found' THEN
    RETURN jsonb_build_object('ok', true, 'status', r->>'status');
  END IF;
  SELECT * INTO v FROM public.citizens WHERE id = (r->>'id')::uuid;
  RETURN jsonb_build_object(
    'ok', true,
    'status', CASE
      WHEN v.recovery_pin_hash IS NOT NULL THEN 'has_pin'
      WHEN v.citizen_number <= 10 THEN 'vip_protected'
      ELSE 'needs_pin_setup' END,
    'citizen_number', v.citizen_number,
    'username', v.username,
    'locked_minutes', CASE WHEN v.recovery_locked_until > now()
      THEN ceil(extract(epoch FROM v.recovery_locked_until - now()) / 60)::int END
  );
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

  SELECT * INTO v FROM public.citizens WHERE id = (r->>'id')::uuid FOR UPDATE;

  -- Akun belum punya PIN: klaim dengan PIN baru (bukan untuk kursi VIP #001–#010).
  IF v.recovery_pin_hash IS NULL THEN
    IF v.citizen_number <= 10 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Akun ini dilindungi pengaman khusus. Gunakan pemulihan akun.');
    END IF;
    UPDATE public.citizens
    SET recovery_pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)),
        recovery_failed_attempts = 0, recovery_locked_until = NULL, last_active_at = now()
    WHERE id = v.id AND recovery_pin_hash IS NULL;
    RETURN jsonb_build_object('ok', true, 'citizen_id', v.id, 'secret_token', v.secret_token, 'pin_created', true);
  END IF;

  -- Akun ber-PIN: verifikasi dengan kunci 1 jam setelah 5x salah (sama seperti recover_session).
  IF v.recovery_locked_until IS NOT NULL AND v.recovery_locked_until > now() THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'Terlalu banyak percobaan. Coba lagi dalam ' || public.nv_fmt_wait(v.recovery_locked_until - now()) || '.');
  END IF;
  IF extensions.crypt(p_pin, v.recovery_pin_hash) = v.recovery_pin_hash THEN
    UPDATE public.citizens SET recovery_failed_attempts = 0, recovery_locked_until = NULL, last_active_at = now()
    WHERE id = v.id;
    RETURN jsonb_build_object('ok', true, 'citizen_id', v.id, 'secret_token', v.secret_token, 'pin_created', false);
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

REVOKE ALL ON FUNCTION public.nv_quick_resolve(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.quick_login_check(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.quick_login(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quick_login_check(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quick_login(TEXT, TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
