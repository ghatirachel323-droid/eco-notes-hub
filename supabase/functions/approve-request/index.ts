// ============================================================
// EDGE FUNCTION: approve-request
// Called only from the admin dashboard. It:
//   1. Verifies the caller is actually logged in as an admin
//   2. Creates the student's real login (email + the password
//      the admin typed in)
//   3. Marks their access request as approved
//   4. Emails the password to the student automatically
//
// Deploy with the Supabase CLI:
//   supabase functions deploy approve-request
//
// Set these secrets first (Dashboard → Edge Functions → Secrets,
// or via CLI: supabase secrets set KEY=value):
//   RESEND_API_KEY   — from resend.com
//   SITE_FROM_EMAIL  — e.g. "ECO Notes Hub <notes@yourdomain.com>"
//     (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided
//      automatically by Supabase, no need to set them yourself)
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("SITE_FROM_EMAIL") ?? "onboarding@resend.dev";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Not authenticated" }, 401);
    }

    // Client bound to the CALLER's own token — used only to find out who they are
    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user: caller },
    } = await callerClient.auth.getUser();

    if (!caller) return json({ error: "Not authenticated" }, 401);

    // Privileged client, used for the actual admin actions below
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: callerProfile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .single();

    if (!callerProfile || callerProfile.role !== "admin") {
      return json({ error: "Only the admin can approve requests" }, 403);
    }

    const { requestId, password } = await req.json();
    if (!requestId || !password || password.length < 8) {
      return json({ error: "requestId and an 8+ character password are required" }, 400);
    }

    const { data: request, error: reqErr } = await admin
      .from("access_requests")
      .select("*")
      .eq("id", requestId)
      .single();

    if (reqErr || !request) return json({ error: "Request not found" }, 404);
    if (request.status === "approved") return json({ error: "Already approved" }, 400);

    // 1. Create the real login
    const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
      email: request.email,
      password,
      email_confirm: true,
    });
    if (createErr) return json({ error: createErr.message }, 400);

    // 2. Give them a student profile
    await admin.from("profiles").insert({
      id: newUser.user.id,
      email: request.email,
      role: "student",
    });

    // 3. Mark the request approved
    await admin.from("access_requests").update({ status: "approved" }).eq("id", requestId);

    // 4. Email the password to the student
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: request.email,
        subject: "Your ECO Notes Hub access has been approved",
        html: `
          <p>Hi ${escapeHtml(request.name)},</p>
          <p>Your access to ECO Notes Hub has been approved. Here are your login details:</p>
          <p><b>Email:</b> ${escapeHtml(request.email)}<br>
             <b>Password:</b> ${escapeHtml(password)}</p>
          <p>Please log in and keep this password safe.</p>
        `,
      }),
    });

    if (!emailRes.ok) {
      const detail = await emailRes.text();
      return json({ success: true, emailWarning: `Account created, but email failed: ${detail}` });
    }

    return json({ success: true });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(str: string) {
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  } as Record<string, string>)[c]);
}