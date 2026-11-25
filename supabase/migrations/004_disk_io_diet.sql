-- =============================================================================
-- 004 — Diet Disk IO — NON-DESTRUKTIF
--   * get_my_citizen hanya menulis last_active_at bila nilai lamanya > 10 menit.
--     Dulu: 1 UPDATE per warga online per ±1 menit. last_active_at ber-index
--     (idx_citizens_world_active) → setiap UPDATE menulis ulang baris + index + WAL
--     (tidak bisa HOT update) + baris mati untuk autovacuum. Sekarang mayoritas panggilan = baca saja.
--   * Index tambahan kecil untuk query yang paling sering dipanggil edge snapshot & chat.
--   Tidak ada data warga yang diubah/dihapus; hanya CREATE OR REPLACE FUNCTION + CREATE INDEX IF NOT EXISTS.
--   Aman dijalankan berulang kali.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_my_citizen(p_world_id TEXT, p_citizen_id UUID, p_token UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_c public.citizens;
BEGIN
  v_c := public.nv_auth_citizen(p_world_id, p_citizen_id, p_token, FALSE);
  IF v_c.last_active_at < now() - interval '10 minutes' THEN
    UPDATE public.citizens SET last_active_at = now()
    WHERE id = v_c.id AND last_active_at < now() - interval '10 minutes'
    RETURNING * INTO v_c;
    -- Balapan dengan request lain yang sudah memperbarui → baris tidak ter-update, baca ulang saja.
    IF NOT FOUND THEN
      v_c := public.nv_auth_citizen(p_world_id, p_citizen_id, p_token, FALSE);
    END IF;
  END IF;
  RETURN public.nv_citizen_private(v_c);
END;
$$;

-- /api/snapshot: land_plots?world_id=eq.X&owner_citizen_id=not.is.null (tiap refresh edge)
CREATE INDEX IF NOT EXISTS idx_plots_world_owned
  ON public.land_plots (world_id, ring_level)
  WHERE owner_citizen_id IS NOT NULL;

-- Chat: urutan waktu (moderasi / pembersihan) — urutan utama tetap (world_id, id DESC).
-- (Dibungkus cek: di bundle, file ini berjalan sebelum upgrade_v2 yang membuat tabel chat.)
DO $$
BEGIN
  IF to_regclass('public.global_chat_messages') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_global_chat_world_time
      ON public.global_chat_messages (world_id, created_at DESC);
  END IF;
END $$;

-- Index yang SUDAH ADA (dicek, tidak dibuat ulang):
--   citizens (world_id, citizen_number) UNIQUE · citizens (world_id, lower(username)) [003]
--   citizens (world_id, last_active_at DESC) · citizens (world_id, coins DESC, citizen_number)
--   news_feed (world_id, created_at DESC) · land_plots (world_id, ring_level) · land_plots (world_id, owner_citizen_id)
--   world_states PRIMARY KEY (world_id) · global_chat_messages (world_id, id DESC)
