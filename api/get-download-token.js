const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const sessionId = req.query.session_id;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: "Missing checkout session."
      });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const email =
      session.customer_details?.email ||
      session.customer_email;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Unable to locate checkout email."
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const { data: license, error } = await supabase
      .from("licenses")
      .select("email, license_key, tier, status")
      .eq("email", normalizedEmail)
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !license) {
      return res.status(404).json({
        success: false,
        error: "Download access is not ready yet. Please check your email or contact Team Oppster."
      });
    }

    if (String(license.status || "").toLowerCase() !== "active") {
      return res.status(403).json({
        success: false,
        error: "Your subscription is not currently active."
      });
    }

    const rawToken = crypto.randomUUID();

    const tokenHash = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");
    
    const expiresAt = new Date(
      Date.now() + (30 * 24 * 60 * 60 * 1000)
    ).toISOString();

    const { error: deactivateError } = await supabase
      .from("download_tokens")
      .update({ is_active: false })
      .eq("email", license.email)
      .eq("license_key", license.license_key)
      .eq("is_active", true);
    
    if (deactivateError) {
      console.error(
        "Old token deactivate failed:",
        deactivateError
      );
    
      return res.status(500).json({
        success: false,
        error: "Unable to refresh secure download access."
      });
    }
    
    const { error: tokenInsertError } = await supabase
      .from("download_tokens")
      .insert({
        email: license.email,
        license_key: license.license_key,
        token_hash: tokenHash,
        workbook_path: "founder-member/oppster-founder-member-edition-2026.xlsm",
        workbook_version: "2026-founder",
        expires_at: expiresAt,
        max_downloads: 3,
        download_count: 0,
        is_active: true
      });
    
    if (tokenInsertError) {
      console.error(
        "Download token insert failed:",
        tokenInsertError
      );
    
      return res.status(500).json({
        success: false,
        error: "Unable to create secure download access."
      });
    }
    
    return res.status(200).json({
      success: true,
      downloadToken: rawToken,
      tier: license.tier
    });

  } catch (err) {
    console.error("Get download token failed:", err);

    return res.status(500).json({
      success: false,
      error: "Unable to retrieve download access."
    });
  }
};
