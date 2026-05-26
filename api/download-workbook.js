import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(
  supabaseUrl,
  supabaseServiceRoleKey
);

async function logDownloadEvent(eventData) {
  const { error } = await supabase
    .from("download_events")
    .insert(eventData);

  if (error) {
    console.error("Download event log failed:", error.message);
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed"
      });
    }

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return res.status(500).json({
        success: false,
        error: "Missing Supabase environment variables"
      });
    }

    const { email, licenseKey } = req.body || {};

    if (!email || !licenseKey) {
      return res.status(400).json({
        success: false,
        error: "Email and license key are required"
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedKey = licenseKey.trim();

    const ipAddress =
      req.headers["x-forwarded-for"] ||
      req.socket.remoteAddress ||
      "Unknown";

    const browserInfo =
      req.headers["user-agent"] ||
      "Unknown";

    const { data: license, error: licenseError } = await supabase
      .from("licenses")
      .select("email, license_key, tier, status, current_period_end, account_limit")
      .eq("email", normalizedEmail)
      .eq("license_key", normalizedKey)
      .single();

    if (licenseError || !license) {
      await logDownloadEvent({
        email: normalizedEmail,
        license_key: normalizedKey,
        tier: null,
        download_ip: ipAddress,
        download_country: "Unknown",
        user_agent: browserInfo,
        ip_match_score: 0,
        status: "INVALID_LICENSE",
        downloaded_at: new Date()
      });

      return res.status(403).json({
        success: false,
        error: "We could not validate that email and license key combination."
      });
    }

    const status = String(license.status || "").toLowerCase();

    if (status !== "active") {
      await logDownloadEvent({
        email: normalizedEmail,
        license_key: normalizedKey,
        tier: license.tier,
        download_ip: ipAddress,
        download_country: "Unknown",
        user_agent: browserInfo,
        ip_match_score: 0,
        status: "INACTIVE_LICENSE",
        downloaded_at: new Date()
      });

      return res.status(403).json({
        success: false,
        error: "This license is not currently active."
      });
    }

    if (license.current_period_end) {
      const expiresAt = new Date(license.current_period_end);
      const now = new Date();

      if (expiresAt < now) {
        await logDownloadEvent({
          email: normalizedEmail,
          license_key: normalizedKey,
          tier: license.tier,
          download_ip: ipAddress,
          download_country: "Unknown",
          user_agent: browserInfo,
          ip_match_score: 0,
          status: "EXPIRED_LICENSE",
          downloaded_at: new Date()
        });

        return res.status(403).json({
          success: false,
          error: "This license has expired."
        });
      }
    }

    await logDownloadEvent({
      email: normalizedEmail,
      license_key: normalizedKey,
      tier: license.tier,
      download_ip: ipAddress,
      download_country: "Unknown",
      user_agent: browserInfo,
      ip_match_score: 0,
      status: "SUCCESS",
      downloaded_at: new Date()
    });

    const { data, error } = await supabase.storage
      .from("oppster-downloads")
      .createSignedUrl(
        "founder-member/oppster-founder-member-edition-2026.xlsm",
        600
      );

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    return res.status(200).json({
      success: true,
      downloadUrl: data.signedUrl,
      tier: license.tier,
      accountLimit: license.account_limit
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || "Unexpected server error"
    });
  }
}
