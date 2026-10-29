// Supabase Edge Function: approve-login
// Registers a login request for the authenticated user. Approval still must be
// checked by the app before exposing data; this endpoint does not bypass RLS.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method !== "POST") return respond({ error: "POST required" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const auth = req.headers.get("Authorization");
  if (!url || !anon || !auth) return respond({ error: "Missing configuration or authorization" }, 401);
  const client = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError || !user) return respond({ error: "Unauthorized" }, 401);
  if ((user.email ?? "").toLowerCase() === "m3152268@gmail.com") return respond({ status: "approved", role: "owner" });
  const { data: profile, error: profileError } = await client
    .from("user_profiles").select("role").eq("user_id", user.id).maybeSingle();
  if (profileError) return respond({ error: profileError.message }, 400);
  if (profile?.role === "rejected") return respond({ status: "rejected" }, 403);
  if (profile?.role !== "approved" && profile?.role !== "owner") {
    const { error } = await client.from("login_requests").insert({ user_id: user.id, status: "pending" });
    if (error) return respond({ error: error.message }, 400);
    return respond({ status: "pending" }, 202);
  }
  return respond({ status: "approved" });
});
