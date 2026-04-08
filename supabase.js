import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = "https://bpliqzpctywaffylwecp.supabase.co";
const supabaseAnonKey = "sb_publishable_fswS37eMayTr6XRqv4coaA_Hkaao4Cc";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function ensureSignedIn() {
  const { data, error } = await supabase.auth.getSession();

  if (data.session) return data.session;

  const { data: signInData, error: signInError } = await supabase.auth.signInAnonymously();
  if (signInError) throw signInError;

  return signInData.session;
}

export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;

  return data.user;
}
