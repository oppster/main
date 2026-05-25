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

    const { data, error } = await supabase.storage
      .from("oppster-downloads")
      .createSignedUrl(
        "founder-member/oppster-founder-member-v1.xlsm",
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
      downloadUrl: data.signedUrl
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || "Unexpected server error"
    });
  }
}
