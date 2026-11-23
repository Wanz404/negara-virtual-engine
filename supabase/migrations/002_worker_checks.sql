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
