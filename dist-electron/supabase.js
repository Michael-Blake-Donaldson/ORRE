import { createClient } from "@supabase/supabase-js";
let supabaseClient = null;
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
function resolveDisplayName(user) {
    const metadata = user.user_metadata ?? {};
    const displayName = (typeof metadata.display_name === "string" && metadata.display_name.trim()) ||
        (typeof metadata.full_name === "string" && metadata.full_name.trim()) ||
        user.email?.split("@")[0] ||
        "Memora User";
    return displayName;
}
function toAuthUser(user) {
    return {
        id: user.id,
        email: user.email ?? "",
        displayName: resolveDisplayName(user),
    };
}
export async function registerWithSupabase(email, password, displayName) {
    const client = getSupabaseClient();
    if (!client) {
        return { ok: false, reason: "Supabase is not configured." };
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
        return { ok: false, reason: error.message };
    }
    if (!data.user) {
        return { ok: false, reason: "Account was created but user payload is missing." };
    }
    return {
        ok: true,
        user: toAuthUser(data.user),
        requiresEmailVerification: !Boolean(data.user.email_confirmed_at),
    };
}
export async function loginWithSupabase(email, password) {
    const client = getSupabaseClient();
    if (!client) {
        return { ok: false, reason: "Supabase is not configured." };
    }
    const { data, error } = await client.auth.signInWithPassword({
        email,
        password,
    });
    if (error) {
        return { ok: false, reason: error.message };
    }
    if (!data.user) {
        return { ok: false, reason: "Login succeeded but user payload is missing." };
    }
    if (!data.user.email_confirmed_at) {
        return { ok: false, reason: "email-not-confirmed" };
    }
    const factorResponse = await client.auth.mfa.listFactors();
    if (factorResponse.error) {
        return { ok: false, reason: factorResponse.error.message };
    }
    const verifiedTotp = (factorResponse.data.totp ?? []).filter((factor) => factor.status === "verified");
    if (verifiedTotp.length > 0) {
        const primaryFactor = verifiedTotp[0];
        const challengeResponse = await client.auth.mfa.challenge({ factorId: primaryFactor.id });
        if (challengeResponse.error || !challengeResponse.data?.id) {
            return {
                ok: false,
                reason: challengeResponse.error?.message ?? "Could not initialize MFA challenge.",
            };
        }
        return {
            ok: false,
            reason: "mfa-required",
            factorId: primaryFactor.id,
            challengeId: challengeResponse.data.id,
        };
    }
    return {
        ok: true,
        user: toAuthUser(data.user),
    };
}
export async function verifySupabaseMfaCode(factorId, challengeId, code) {
    const client = getSupabaseClient();
    if (!client) {
        return { ok: false, reason: "Supabase is not configured." };
    }
    const response = await client.auth.mfa.verify({
        factorId,
        challengeId,
        code,
    });
    if (response.error) {
        return { ok: false, reason: response.error.message };
    }
    const userResponse = await client.auth.getUser();
    if (userResponse.error || !userResponse.data.user) {
        return {
            ok: false,
            reason: userResponse.error?.message ?? "Could not load authenticated user.",
        };
    }
    if (!userResponse.data.user.email_confirmed_at) {
        return { ok: false, reason: "email-not-confirmed" };
    }
    return {
        ok: true,
        user: toAuthUser(userResponse.data.user),
    };
}
export async function resendSupabaseVerification(email) {
    const client = getSupabaseClient();
    if (!client) {
        return { ok: false, reason: "Supabase is not configured." };
    }
    const response = await client.auth.resend({
        type: "signup",
        email,
    });
    if (response.error) {
        return { ok: false, reason: response.error.message };
    }
    return { ok: true };
}
export async function logoutFromSupabase() {
    const client = getSupabaseClient();
    if (!client) {
        return;
    }
    await client.auth.signOut();
}
