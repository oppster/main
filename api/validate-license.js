export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ valid: false, error: "Method not allowed" });
  }

  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const license_key = String(req.body?.license_key || "").trim();

    if (!email) {
      return res.status(400).json({
        valid: false,
        error: "Email is required",
      });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const todayStr = new Date().toISOString().slice(0, 10);

    let query =
      `${supabaseUrl}/rest/v1/licenses` +
      `?email=ilike.${encodeURIComponent(email)}` +
      `&status=in.(ACTIVE,TRIALING,GRACE)` +
      `&current_period_end=gte.${todayStr}` +
      `&select=*` +
      `&order=current_period_end.desc` +
      `&limit=1`;
    
    if (license_key) {
      query =
        `${supabaseUrl}/rest/v1/licenses` +
        `?email=ilike.${encodeURIComponent(email)}` +
        `&license_key=eq.${encodeURIComponent(license_key)}` +
        `&select=*` +
        `&limit=1`;
    }
    
    const response = await fetch(query, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });

    const rows = await response.json();

    if (!response.ok || !Array.isArray(rows) || rows.length === 0) {
      return res.status(404).json({
        valid: false,
        status: "NOT_FOUND",
      });
    }

    const license = rows[0];
    const today = new Date();
    const expires = license.current_period_end
      ? new Date(license.current_period_end)
      : null;

    const activeStatuses = ["ACTIVE", "TRIALING", "GRACE"];
    const isActiveStatus = activeStatuses.includes(
      String(license.status || "").toUpperCase()
    );

    const notExpired = !expires || expires >= today;

    return res.status(200).json({
      valid: isActiveStatus && notExpired,
      email: license.email,
      tier: license.tier,
      status: license.status,
      expires: license.current_period_end,
      account_limit: license.account_limit,
    });
  } catch (err) {
    return res.status(500).json({
      valid: false,
      error: "Server error",
      detail: String(err?.message || err),
    });
  }
}
