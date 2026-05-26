const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { createClient } = require("@supabase/supabase-js");

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
      .select("email, tier, status, download_token")
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

    return res.status(200).json({
      success: true,
      downloadToken: license.download_token,
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
