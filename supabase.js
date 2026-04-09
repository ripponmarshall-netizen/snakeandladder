import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://bpliqzpctywaffylwecp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwbGlxenBjdHl3YWZmeWx3ZWNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2ODc4MzQsImV4cCI6MjA5MTI2MzgzNH0.-aND4CjaAgBpo0Zp3U1F2kGxBeSCk4DHBt8aGm4LS8k";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function ensureSignedIn() {
  const {
    data: { session },
    error: sessionError
  } = await supabase.auth.getSession();

  if (sessionError) throw sessionError;
  if (session) return session;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;

  return data.session;
}

export async function getCurrentUser() {
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error) throw error;
  return user;
}
