const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const lookupKey = String(req.body?.lookup_key || "").trim();

    const existingLicenseKey = String(
      req.body?.existing_license_key || ""
    ).trim();

    const activatedWorkbookId = String(
      req.body?.activated_workbook_id || ""
    ).trim();

    if (!lookupKey) {
      return res.status(400).send("Missing price lookup key");
    }

    const prices = await stripe.prices.list({
      lookup_keys: [lookupKey],
      expand: ["data.product"],
      limit: 1,
    });

    if (!prices.data.length) {
      return res.status(400).send("Invalid price lookup key");
    }

    let purchaseType = "NEW";
    let renewalEmail = "";
    let existingStripeCustomerId = "";

    // ---------------------------------------------------------
    // RENEWAL VALIDATION
    // A renewal must identify the exact existing license and
    // the workbook already activated against that license.
    // ---------------------------------------------------------
    if (existingLicenseKey || activatedWorkbookId) {
      if (!existingLicenseKey || !activatedWorkbookId) {
        return res.status(400).send(
          "Both existing license key and activated workbook ID are required for renewal"
        );
      }

      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!supabaseUrl || !supabaseKey) {
        throw new Error("Supabase environment variables are missing");
      }

      const licenseQuery =
        `${supabaseUrl}/rest/v1/licenses` +
        `?license_key=eq.${encodeURIComponent(existingLicenseKey)}` +
        `&activated_workbook_id=eq.${encodeURIComponent(activatedWorkbookId)}` +
        `&select=email,license_key,activated_workbook_id,stripe_customer_id` +
        `&limit=1`;

      const licenseResponse = await fetch(licenseQuery, {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      });

      const licenseRows = await licenseResponse.json();

      if (!licenseResponse.ok) {
        throw new Error(
          `License lookup failed: ${licenseResponse.status} ${JSON.stringify(
            licenseRows
          )}`
        );
      }

      if (!Array.isArray(licenseRows) || licenseRows.length !== 1) {
        return res.status(404).send(
          "Existing Oppster license and workbook association not found"
        );
      }

      purchaseType = "RENEWAL";

      renewalEmail = String(licenseRows[0].email || "")
        .trim()
        .toLowerCase();

      existingStripeCustomerId = String(
        licenseRows[0].stripe_customer_id || ""
      ).trim();
    }

    const checkoutMetadata = {
      purchase_type: purchaseType,
      existing_license_key: existingLicenseKey,
      activated_workbook_id: activatedWorkbookId,
    };

    const sessionConfig = {
      billing_address_collection: "auto",

      line_items: [
        {
          price: prices.data[0].id,
          quantity: 1,
        },
      ],

      mode: "subscription",

      success_url:
        "https://oppster.com/success.html?session_id={CHECKOUT_SESSION_ID}",

      cancel_url: "https://oppster.com/cancel.html",

      metadata: checkoutMetadata,

      subscription_data: {
        metadata: checkoutMetadata,
      },
    };

    // Reuse the existing Stripe customer for renewals when available.
    // Otherwise prefill the email from the matched license.
    if (purchaseType === "RENEWAL") {
      if (existingStripeCustomerId) {
        sessionConfig.customer = existingStripeCustomerId;
      } else if (renewalEmail) {
        sessionConfig.customer_email = renewalEmail;
      }
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    return res.redirect(303, session.url);
  } catch (err) {
    console.error("Create Checkout Session error:", err);

    return res.status(500).send("Server error");
  }
};
