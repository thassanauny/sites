import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { configError, supabase } from "../cloud/client";

let starting: Promise<User> | null = null;
async function ensureSession(): Promise<User> {
  if (starting) return starting;
  const client = supabase;
  if (!client) throw new Error("Supabase is not configured.");
  const start = async () => {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (data.session?.user) return data.session.user;
    const signedIn = await client.auth.signInAnonymously();
    if (signedIn.error) throw signedIn.error;
    if (!signedIn.data.user)
      throw new Error("Could not start a device session.");
    return signedIn.data.user;
  };
  starting = (async () => {
    if (typeof navigator === "undefined" || !navigator.locks) return start();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      return await navigator.locks.request(
        "blueprint-session-start",
        { mode: "exclusive", signal: controller.signal },
        start,
      );
    } catch (error) {
      if (controller.signal.aborted)
        throw new Error(
          "Another tab is opening your session. Close it or wait a moment, then retry.",
        );
      throw error;
    } finally {
      clearTimeout(timer);
    }
  })().finally(() => {
    starting = null;
  });
  return starting;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(Boolean(supabase));
  const [authError, setAuthError] = useState(configError);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    setChecking(true);
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active && session?.user) setUser(session.user);
    });
    ensureSession()
      .then((value) => {
        if (active) {
          setUser(value);
          setAuthError("");
        }
      })
      .catch((error) => {
        if (active)
          setAuthError(
            error instanceof Error
              ? error.message
              : "Could not open your device session. Check your connection and retry.",
          );
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [retry]);
  return {
    user,
    checking,
    configured: Boolean(supabase),
    authError,
    retrySession: () => setRetry((v) => v + 1),
  };
}
