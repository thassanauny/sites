import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
export let supabase: SupabaseClient | null = null;
export let configError = "";
if (url && key) {
  try {
    supabase = createClient(url, key, { auth: { storageKey: "blueprint-auth" } });
  } catch {
    configError = "Check the public Supabase settings for Blueprint.";
  }
}
