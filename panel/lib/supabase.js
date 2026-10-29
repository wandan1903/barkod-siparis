import { createClient } from '@supabase/supabase-js';

// Bu iki değer herkese açıktır (tarayıcıda zaten görünür). Veri güvenliğini
// veritabanındaki satır bazlı kurallar (RLS) sağlar, bu anahtar değil.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// Çıkış: sunucu yanıt vermese bile yerel oturumu mutlaka temizler
// (aksi halde giriş sayfası oturumu hâlâ açık görüp ana sayfaya geri atar)
export async function signOutSafely() {
  try {
    await supabase.auth.signOut();
  } catch (e) {
    // sunucuya ulaşılamadı; yerel temizlik aşağıda
  }
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch (e) {
    // yok say
  }
}
