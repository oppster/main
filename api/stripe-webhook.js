import Stripe from "stripe";
import { randomUUID } from "crypto";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = {
  api: {
    bodyParser: false,
  },
};

async function upsertLicenseFromCheckout(session) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const email = String(session.customer_details?.email || "").trim().toLowerCase();

  if (!email) {
    throw new Error("Missing customer email from checkout session");
  }

  const amountTotal = Number(session.amount_total || 0);

  let tier = "CORE";
  let accountLimit = 1;

  if (amountTotal >= 3900) {
    tier = "PREMIUM";
    accountLimit = 5;
  } else if (amountTotal >= 1900) {
    tier = "PRO";
    accountLimit = 3;
  } else {
    tier = "CORE";
    accountLimit = 1;
  }

  const periodEnd = new Date();
  periodEnd.setDate(periodEnd.getDate() + 30);

  const licenseKey =
    "OPP-" +
    Math.random().toString(36).substring(2, 8).toUpperCase() +
    "-" +
    Math.random().toString(36).substring(2, 8).toUpperCase();

  const body = {
    email,
    license_key: licenseKey,
    tier,
    status: "ACTIVE",
    current_period_end: periodEnd.toISOString().slice(0, 10),
    account_limit: accountLimit,
    stripe_customer_id: session.customer,
    stripe_subscription_id: session.subscription,
    download_token: randomUUID(),
    last_downloaded_at: null,
    updated_at: new Date().toISOString(),
  };

  const response = await fetch(`${supabaseUrl}/rest/v1/licenses`, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase license upsert failed: ${errorText}`);
  }
}

async function buffer(readable) {
  const chunks = [];

  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const sig = req.headers["stripe-signature"];

  let event;

  try {
    const rawBody = await buffer(req);

    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {

    switch (event.type) {

      case "checkout.session.completed":
        await upsertLicenseFromCheckout(event.data.object);
        console.log("Checkout completed and license updated");
        break;

      case "invoice.paid":
        console.log("Invoice paid");
        break;

      case "customer.subscription.updated":
        console.log("Subscription updated");
        break;

      case "customer.subscription.deleted":
        console.log("Subscription canceled");
        break;

      case "invoice.payment_failed":
        console.log("Payment failed");
        break;

      default:
        console.log(`Unhandled event: ${event.type}`);
    }

    return res.status(200).json({ received: true });

  } catch (err) {

    return res.status(500).json({
      error: err.message,
    });

  }
}
