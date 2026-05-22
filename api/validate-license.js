export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ valid: false, error: "Method not allowed" });
  }

  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const license_key = String(req.body?.license_key || "").trim();

    if (!email || !license_key) {
      return res.status(400).json({
        valid: false,
        error: "Email and license key are required",
      });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const testUrl = `${supabaseUrl}/rest/v1/licenses?select=*`;

    const response = await fetch(testUrl, {
      method: "GET",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });
    
    const text = await response.text();
    
    return res.status(response.status).send(text);

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
