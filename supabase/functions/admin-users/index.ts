// Supabase Edge Function: admin-users
// Deploy as a Supabase Edge Function. Configure SUPABASE_URL and
// ALWALEED_SERVICE_ROLE_KEY as server-side secret only; NEVER put them in index.html.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("ALWALEED_SERVICE_ROLE_KEY");
  const authHeader = req.headers.get("Authorization");
  if (!url || !serviceKey || !authHeader) return json({ error: "Function configuration missing" }, 500);

  const admin = createClient(url, serviceKey);
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: caller }, error: callerError } = await userClient.auth.getUser();
  if (callerError || !caller || (caller.email ?? "").toLowerCase() !== "m3152268@gmail.com") {
    return json({ error: "Owner only" }, 403);
  }

  let body: { action?: string; email?: string; password?: string; user_id?: string; decision?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  if (body.action === "list_users") {
    const { data: page, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (listError) return json({ error: listError.message }, 400);
    const { data: profiles, error: profileListError } = await admin.from("user_profiles").select("user_id,email,role");
    if (profileListError) return json({ error: profileListError.message }, 400);
    const profileMap = new Map((profiles ?? []).map((p: {user_id:string;email:string;role:string}) => [p.user_id, p]));
    const users = (page.users ?? []).filter((u) => (u.email ?? "").toLowerCase() !== "m3152268@gmail.com").map((u) => ({
      id: u.id, email: u.email ?? "", role: profileMap.get(u.id)?.role ?? "pending"
    }));
    return json({ users });
  }

  if (body.action === "create_user") {
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    if (!email || password.length < 10) return json({ error: "Email required; password must be at least 10 characters" }, 400);
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) return json({ error: error.message }, 400);
    const { error: profileError } = await admin.from("user_profiles").upsert({
      user_id: data.user.id, email, role: "pending"
    });
    if (profileError) return json({ error: "User created but profile setup failed: " + profileError.message }, 500);
    return json({ user_id: data.user.id, email, role: "pending" }, 201);
  }

  if (body.action === "decide_user") {
    const user_id = body.user_id ?? "";
    const decision = body.decision;
    if (!user_id || !["approved", "rejected"].includes(decision ?? "")) return json({ error: "user_id and approved/rejected decision required" }, 400);
    const { data: target, error: targetError } = await admin.auth.admin.getUserById(user_id);
    if (targetError || !target.user) return json({ error: "User not found" }, 404);
    if ((target.user.email ?? "").toLowerCase() === "m3152268@gmail.com") return json({ error: "Owner profile cannot be changed here" }, 400);
    const { error } = await admin.from("user_profiles").upsert({
      user_id, email: target.user.email ?? "", role: decision
    });
    if (error) return json({ error: error.message }, 400);
    return json({ user_id, role: decision });
  }
  return json({ error: "Unknown action" }, 400);
});
