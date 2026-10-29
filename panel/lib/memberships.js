import { supabase } from '@/lib/supabase';

// Kullanıcının üyesi olduğu distribütör ve market kuruluşlarını döndürür.
export async function loadMemberships(userId) {
  const { data, error } = await supabase
    .from('memberships')
    .select('role, organizations(id, name, type, district)')
    .eq('user_id', userId);
  if (error) return { error: error.message, distributor: null, retailer: null };
  const rows = data || [];
  const pick = (type) => {
    const m = rows.find((r) => r.organizations && r.organizations.type === type);
    return m ? { ...m.organizations, role: m.role } : null;
  };
  return { error: '', distributor: pick('distributor'), retailer: pick('retailer') };
}
