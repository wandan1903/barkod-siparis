import { createClient } from '@supabase/supabase-js';

// Bu iki değer herkese açıktır (tarayıcıda zaten görünür). Veri güvenliğini
// veritabanındaki satır bazlı kurallar (RLS) sağlar, bu anahtar değil.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});
