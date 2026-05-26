import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

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

    const { email, licenseKey, token } = req.body || {};

    if (!token && (!email || !licenseKey)) {

      return res.status(400).json({
        success:false,
        error:"Email and license key are required"
      });
    
    }

    let normalizedEmail = email?.trim().toLowerCase();
    let normalizedKey = licenseKey?.trim();

    if (token) {

        const {
            data: tokenLicense,
            error: tokenError
        } = await supabase
            .from("licenses")
            .select(
                "email,license_key"
            )
            .eq(
                "download_token",
                token
            )
            .single();
    
        if (
            tokenError ||
            !tokenLicense
        ) {
    
            return res.status(403)
            .json({
    
                success:false,
                error:
                "Invalid download link."
    
            });
    
        }
    
        normalizedEmail =
            tokenLicense.email;
    
        normalizedKey =
            tokenLicense.license_key;
    
    }    

    const ipAddress =
      req.headers["x-forwarded-for"] ||
      req.socket.remoteAddress ||
      "Unknown";

    const browserInfo =
      req.headers["user-agent"] ||
      "Unknown";

    const downloadCountry =
      req.headers["x-vercel-ip-country"] ||
      req.headers["cf-ipcountry"] ||
      "Unknown";
    
    const { data: previousDownloads } = await supabase
      .from("download_events")
      .select("download_ip")
      .eq("email", normalizedEmail)
      .order("downloaded_at", { ascending: false })
      .limit(3);
    
    let ipMatchScore = 0;
    
    if (previousDownloads?.length > 0) {
    
      const matchCount =
        previousDownloads.filter(
          x => x.download_ip === ipAddress
        ).length;
    
      ipMatchScore =
        Math.round(
          (matchCount / previousDownloads.length) * 100
        );
    
    }
    
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
        tier: "UNKNOWN",
        download_ip: ipAddress,
        download_country: downloadCountry,
        user_agent: browserInfo,
        ip_match_score: ipMatchScore,
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
        download_country: downloadCountry,
        user_agent: browserInfo,
        ip_match_score: ipMatchScore,
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
          download_country: downloadCountry,
          user_agent: browserInfo,
          ip_match_score: ipMatchScore,
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
      download_country: downloadCountry,
      user_agent: browserInfo,
      ip_match_score: ipMatchScore,
      status: "SUCCESS",
      downloaded_at: new Date()
    });

    const newToken = crypto.randomUUID();

    await supabase
      .from("licenses")
      .update({
          download_token: newToken,
          last_downloaded_at: new Date()
      })
      .eq("email", normalizedEmail)
      .eq("license_key", normalizedKey);
    
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
