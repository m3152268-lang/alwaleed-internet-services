// Supabase Edge Function: admin-users
// New username-only accounts use an internal, non-deliverable Auth email alias.
// Keep SUPABASE_SERVICE_ROLE_KEY server-side only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OWNER_EMAIL = "m3152268@gmail.com";
const USER_DOMAIN = "users.alwaleed.invalid";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const normalizeUsername = (value: unknown) => String(value ?? "").trim().toLowerCase();
const usernamePattern = /^[a-z0-9._-]{3,32}$/;
const usernameFromAuthEmail = (email: string) => {
  const suffix = `@${USER_DOMAIN}`;
  return email.toLowerCase().endsWith(suffix) ? email.slice(0, -suffix.length) : null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("ALWALEED_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const authHeader = req.headers.get("Authorization");
  if (!url || !serviceKey || !anonKey || !authHeader) return json({ error: "Function configuration missing" }, 500);

  const admin = createClient(url, serviceKey);
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user: caller }, error: callerError } = await userClient.auth.getUser();
  if (callerError || !caller || (caller.email ?? "").toLowerCase() !== OWNER_EMAIL) return json({ error: "Owner only" }, 403);

  let body: { action?: string; email?: string; username?: string; password?: string; user_id?: string; decision?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  if (body.action === "list_users") {
    const { data: page, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (listError) return json({ error: listError.message }, 400);
    const { data: profiles, error: profileError } = await admin.from("user_profiles").select("user_id,email,role");
    if (profileError) return json({ error: profileError.message }, 400);
    const profileMap = new Map((profiles ?? []).map((p: { user_id: string; email: string; role: string }) => [p.user_id, p]));
    const users = (page.users ?? []).filter((u) => (u.email ?? "").toLowerCase() !== OWNER_EMAIL).map((u) => {
      const email = u.email ?? "";
      const username = usernameFromAuthEmail(email);
      return { id: u.id, email: username ? "" : email, username: username ?? email, role: profileMap.get(u.id)?.role ?? "pending" };
    });
    return json({ users });
  }

  if (body.action === "create_user") {
    const username = normalizeUsername(body.username);
    const password = body.password ?? "";
    if (!usernamePattern.test(username)) return json({ error: "Username must be 3-32 characters: letters, numbers, dot, underscore or hyphen" }, 400);
    if (password.length < 10) return json({ error: "Password must be at least 10 characters" }, 400);
    const email = `${username}@${USER_DOMAIN}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username } });
    if (error) return json({ error: error.message }, 400);
    const { error: profileError } = await admin.from("user_profiles").upsert({ user_id: data.user.id, email, role: "pending" });
    if (profileError) {
      await admin.auth.admin.deleteUser(data.user.id);
      return json({ error: "Could not create user profile: " + profileError.message }, 500);
    }
    return json({ user_id: data.user.id, username, role: "pending" }, 201);
  }

  if (body.action === "delete_user") {
    const userId = String(body.user_id ?? "").trim();
    if (!userId) return json({ error: "user_id is required" }, 400);
    const { data: target, error: targetError } = await admin.auth.admin.getUserById(userId);
    if (targetError || !target.user) return json({ error: "User not found" }, 404);
    if ((target.user.email ?? "").toLowerCase() === OWNER_EMAIL) return json({ error: "The owner account cannot be deleted here" }, 400);
    const { error: requestError } = await admin.from("login_requests").delete().eq("user_id", userId);
    if (requestError) return json({ error: "Could not remove login requests: " + requestError.message }, 400);
    const { error: profileError } = await admin.from("user_profiles").delete().eq("user_id", userId);
    if (profileError) return json({ error: "Could not remove user profile: " + profileError.message }, 400);
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) return json({ error: "Could not delete authentication account: " + deleteError.message }, 400);
    return json({ deleted: true, user_id: userId });
  }

  if (body.action === "decide_user") {
    const userId = String(body.user_id ?? "").trim();
    const decision = body.decision;
    if (!userId || !["approved", "rejected"].includes(decision ?? "")) return json({ error: "user_id and approved/rejected decision required" }, 400);
    const { data: target, error: targetError } = await admin.auth.admin.getUserById(userId);
    if (targetError || !target.user) return json({ error: "User not found" }, 404);
    if ((target.user.email ?? "").toLowerCase() === OWNER_EMAIL) return json({ error: "Owner profile cannot be changed here" }, 400);
    const { error } = await admin.from("user_profiles").upsert({ user_id: userId, email: target.user.email ?? "", role: decision });
    if (error) return json({ error: error.message }, 400);
    return json({ user_id: userId, role: decision });
  }
  return json({ error: "Unknown action" }, 400);
});
