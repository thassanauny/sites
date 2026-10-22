import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { configError, supabase } from "../cloud/client";

let starting: Promise<User> | null = null;
async function ensureSession(): Promise<User> {
  if (starting) return starting;
  const client = supabase;
  if (!client) throw new Error("Supabase is not configured.");
  const start = async () => {
    if (!navigator.onLine) {
      const saved = JSON.parse(localStorage.getItem('blueprint-auth') || 'null');
      if (saved?.access_token && saved?.refresh_token && typeof saved?.user?.id === 'string') return saved.user as User;
      throw new Error('Connect once to start a Blueprint device session.');
    }
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
    const online = () => setRetry(value => value + 1);
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, []);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    let sessionChanged = false;
    setChecking(true);
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      // INITIAL_SESSION may be empty while startup is creating an anonymous session.
      if (event !== "INITIAL_SESSION") sessionChanged = true;
      setUser(session?.user ?? null);
      if (session?.user) setAuthError("");
      else if (event === "SIGNED_OUT") setAuthError("Your device session ended. Retry to reconnect, or rejoin using your invitation.");
    });
    ensureSession()
      .then((value) => {
        if (active && !sessionChanged) {
          setUser(value);
          setAuthError("");
        }
      })
      .catch((error) => {
        if (active && !sessionChanged)
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
