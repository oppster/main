import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(
  supabaseUrl,
  supabaseServiceRoleKey
);

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

    const { data: license, error: licenseError } = await supabase
      .from("licenses")
      .select("email, license_key, tier, status, current_period_end, account_limit")
      .eq("email", normalizedEmail)
      .eq("license_key", normalizedKey)
      .single();

    if (licenseError || !license) {
      return res.status(403).json({
        success: false,
        error: "We could not validate that email and license key combination."
      });
    }

    const status = String(license.status || "").toLowerCase();

    if (status !== "active") {
      return res.status(403).json({
        success: false,
        error: "This license is not currently active."
      });
    }

    if (license.current_period_end) {
      const expiresAt = new Date(license.current_period_end);
      const now = new Date();

      if (expiresAt < now) {
        return res.status(403).json({
          success: false,
          error: "This license has expired."
        });
      }
    }

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
