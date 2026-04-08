import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = https://bpliqzpctywaffylwecp.supabase.co;
const supabaseAnonKey = sb_publishable_fswS37eMayTr6XRqv4coaA_Hkaao4Cc;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function ensureSignedIn() {
  const {  sessionData } = await supabase.auth.getSession();

  if (sessionData.session) return sessionData.session;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;

  return data.session;
}
