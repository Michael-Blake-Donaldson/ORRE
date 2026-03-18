import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

type AuthUser = {
  id: string;
  email: string;
  displayName: string;
};

let supabaseClient: SupabaseClient | null = null;

function getConfiguredUrl() {
  return process.env.SUPABASE_URL?.trim() ?? "";
}

function getConfiguredAnonKey() {
  const anon = process.env.SUPABASE_ANON_KEY?.trim() ?? "";
  if (anon) {
    return anon;
  }

  return process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
}

export function isSupabaseAuthConfigured() {
  return Boolean(getConfiguredUrl() && getConfiguredAnonKey());
}

function getSupabaseClient() {
  if (!isSupabaseAuthConfigured()) {
    return null;
  }

  if (supabaseClient) {
    return supabaseClient;
  }

  supabaseClient = createClient(getConfiguredUrl(), getConfiguredAnonKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return supabaseClient;
}

function resolveDisplayName(user: User) {
  const metadata = user.user_metadata ?? {};
  const displayName =
    (typeof metadata.display_name === "string" && metadata.display_name.trim()) ||
    (typeof metadata.full_name === "string" && metadata.full_name.trim()) ||
    user.email?.split("@")[0] ||
    "Memora User";

  return displayName;
}

function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email ?? "",
    displayName: resolveDisplayName(user),
  };
}

export async function registerWithSupabase(email: string, password: string, displayName: string) {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false as const, reason: "Supabase is not configured." };
  }

  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName,
      },
    },
  });

  if (error) {
    return { ok: false as const, reason: error.message };
  }

  if (!data.user) {
    return { ok: false as const, reason: "Account was created but user payload is missing." };
  }

  return {
    ok: true as const,
    user: toAuthUser(data.user),
  };
}

export async function loginWithSupabase(email: string, password: string) {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false as const, reason: "Supabase is not configured." };
  }

  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { ok: false as const, reason: error.message };
  }

  if (!data.user) {
    return { ok: false as const, reason: "Login succeeded but user payload is missing." };
  }

  return {
    ok: true as const,
    user: toAuthUser(data.user),
  };
}

export async function logoutFromSupabase() {
  const client = getSupabaseClient();
  if (!client) {
    return;
  }

  await client.auth.signOut();
}
