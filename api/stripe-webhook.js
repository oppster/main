import Stripe from "stripe";
import { randomUUID } from "crypto";
import nodemailer from "nodemailer";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const siteUrl = process.env.SITE_URL || "https://oppster.com";

export const config = {
  api: {
    bodyParser: false,
  },
};

function getMailer() {
  return nodemailer.createTransport({
    host: "smtp.zoho.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.ZOHO_EMAIL_USER,
      pass: process.env.ZOHO_EMAIL_PASS,
    },
  });
}

async function sendEmail({ to, subject, html }) {
  const transporter = getMailer();

  await transporter.sendMail({
    from: `"Oppster" <${process.env.ZOHO_EMAIL_USER}>`,
    to,
    replyTo: "hello@oppster.com",
    subject,
    html,
  });
}

async function getCheckoutPlan(session) {
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
    limit: 1,
    expand: ["data.price"],
  });

  const price = lineItems.data?.[0]?.price;
  const lookupKey = String(price?.lookup_key || "").toLowerCase();
  const unitAmount = Number(price?.unit_amount || 0);

  let tier = "CORE";
  let accountLimit = 1;

  if (lookupKey.includes("premium") || unitAmount >= 3900) {
    tier = "PREMIUM";
    accountLimit = 5;
  } else if (lookupKey.includes("pro") || unitAmount >= 1900) {
    tier = "PRO";
    accountLimit = 3;
  }

  return { tier, accountLimit };
}

async function getSubscriptionDetails(session) {
  if (!session.subscription) {
    throw new Error("Missing Stripe subscription ID from checkout session");
  }

  const subscription = await stripe.subscriptions.retrieve(
    session.subscription
  );

  if (!subscription.current_period_end) {
    throw new Error("Missing subscription period end from Stripe");
  }

  return {
    subscriptionId: subscription.id,
    customerId: String(subscription.customer || session.customer || ""),
    currentPeriodEnd: new Date(
      subscription.current_period_end * 1000
    )
      .toISOString()
      .slice(0, 10),
  };
}

async function getCheckoutEmail(session) {
  let email = String(
    session.customer_details?.email || session.customer_email || ""
  )
    .trim()
    .toLowerCase();

  if (!email && session.customer) {
    email = await getCustomerEmail(session.customer);
  }

  if (!email) {
    throw new Error("Missing customer email from checkout session");
  }

  return email;
}

async function createNewLicense(session) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase environment variables are missing");
  }

  const email = await getCheckoutEmail(session);

  const billingCountry =
    session.customer_details?.address?.country || null;

  const billingPostalCode =
    session.customer_details?.address?.postal_code || null;

  const { tier, accountLimit } = await getCheckoutPlan(session);

  const {
    subscriptionId,
    customerId,
    currentPeriodEnd,
  } = await getSubscriptionDetails(session);

  const licenseKey =
    "OPP-" +
    Math.random().toString(36).substring(2, 8).toUpperCase() +
    "-" +
    Math.random().toString(36).substring(2, 8).toUpperCase();

  const downloadToken = randomUUID();

  const body = {
    email,
    license_key: licenseKey,
    tier,
    status: "ACTIVE",
    current_period_end: currentPeriodEnd,
    account_limit: accountLimit,
    billing_country: billingCountry,
    billing_postal_code: billingPostalCode,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    download_token: downloadToken,
    last_downloaded_at: null,
    updated_at: new Date().toISOString(),
  };

  const response = await fetch(
    `${supabaseUrl}/rest/v1/licenses`,
    {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(body),
    }
  );

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Supabase license creation failed: ${response.status} ${responseText}`
    );
  }

  await sendEmail({
    to: email,
    subject: "Welcome to Oppster",
    html: `
      <h2>Welcome to Oppster</h2>

      <p>Your subscription is active and your Oppster workbook access is ready.</p>

      <p><strong>Account Email:</strong> ${email}</p>
      <p><strong>Workbook Access Key:</strong> ${licenseKey}</p>
      <p><strong>Plan:</strong> Oppster ${tier}</p>

      <p>
        <a href="${siteUrl}/download.html?code=${downloadToken}">
          Download your Oppster workbook
        </a>
      </p>

      <p><strong>Before you begin:</strong></p>

      <ul>
        <li>Download and save your Oppster workbook to a permanent folder.</li>
        <li>Move it out of your Downloads folder before opening it.</li>
        <li>Enable macros when prompted by Excel.</li>
        <li>Complete your account setup.</li>
      </ul>

      <p>Need help? Email hello@oppster.com.</p>

      <p>Thank you for joining Oppster.</p>
      <p>— The Oppster Team</p>
    `,
  });

  console.log(
    `New Oppster license created: ${licenseKey}`
  );
}

async function renewExistingLicense(session) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase environment variables are missing");
  }

  const existingLicenseKey = String(
    session.metadata?.existing_license_key || ""
  ).trim();

  const activatedWorkbookId = String(
    session.metadata?.activated_workbook_id || ""
  ).trim();

  if (!existingLicenseKey) {
    throw new Error(
      "Renewal checkout is missing existing_license_key metadata"
    );
  }

  if (!activatedWorkbookId) {
    throw new Error(
      "Renewal checkout is missing activated_workbook_id metadata"
    );
  }

  const email = await getCheckoutEmail(session);

  const billingCountry =
    session.customer_details?.address?.country || null;

  const billingPostalCode =
    session.customer_details?.address?.postal_code || null;

  const { tier, accountLimit } = await getCheckoutPlan(session);

  const {
    subscriptionId,
    customerId,
    currentPeriodEnd,
  } = await getSubscriptionDetails(session);

  const licenseQuery =
    `${supabaseUrl}/rest/v1/licenses` +
    `?license_key=eq.${encodeURIComponent(existingLicenseKey)}` +
    `&activated_workbook_id=eq.${encodeURIComponent(
      activatedWorkbookId
    )}` +
    `&select=email,license_key,activated_workbook_id` +
    `&limit=1`;

  const lookupResponse = await fetch(licenseQuery, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
  });

  const licenseRows = await lookupResponse.json();

  if (!lookupResponse.ok) {
    throw new Error(
      `Renewal license lookup failed: ${lookupResponse.status} ${JSON.stringify(
        licenseRows
      )}`
    );
  }

  if (!Array.isArray(licenseRows) || licenseRows.length !== 1) {
    throw new Error(
      "The renewal license and workbook association was not found"
    );
  }

  const storedEmail = String(licenseRows[0].email || "")
    .trim()
    .toLowerCase();

  if (storedEmail && storedEmail !== email) {
    throw new Error(
      "The checkout email does not match the existing license email"
    );
  }

  const updateBody = {
    email,
    tier,
    status: "ACTIVE",
    current_period_end: currentPeriodEnd,
    account_limit: accountLimit,
    billing_country: billingCountry,
    billing_postal_code: billingPostalCode,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    updated_at: new Date().toISOString(),
  };

  const updateUrl =
    `${supabaseUrl}/rest/v1/licenses` +
    `?license_key=eq.${encodeURIComponent(existingLicenseKey)}` +
    `&activated_workbook_id=eq.${encodeURIComponent(
      activatedWorkbookId
    )}`;

  const updateResponse = await fetch(updateUrl, {
    method: "PATCH",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(updateBody),
  });

  const updatedRows = await updateResponse.json();

  if (!updateResponse.ok) {
    throw new Error(
      `Supabase license renewal failed: ${updateResponse.status} ${JSON.stringify(
        updatedRows
      )}`
    );
  }

  if (!Array.isArray(updatedRows) || updatedRows.length !== 1) {
    throw new Error(
      "Oppster renewal did not update exactly one license"
    );
  }

  await sendEmail({
    to: email,
    subject: "Your Oppster membership has been renewed",
    html: `
      <h2>Your Oppster membership is active</h2>

      <p>Thank you for renewing your Oppster membership.</p>

      <p><strong>Account Email:</strong> ${email}</p>
      <p><strong>Workbook Access Key:</strong> ${existingLicenseKey}</p>
      <p><strong>Plan:</strong> Oppster ${tier}</p>
      <p><strong>Access Through:</strong> ${currentPeriodEnd}</p>

      <p>
        Open your existing Oppster workbook and refresh your license
        to restore full access.
      </p>

      <p>You do not need to download a new workbook.</p>

      <p>Need help? Email hello@oppster.com.</p>

      <p>Thank you for continuing with Oppster.</p>
      <p>— The Oppster Team</p>
    `,
  });

  console.log(
    `Oppster license renewed: ${existingLicenseKey}`
  );
}

async function processCompletedCheckout(session) {
  const purchaseType = String(
    session.metadata?.purchase_type || "NEW"
  )
    .trim()
    .toUpperCase();

  if (purchaseType === "RENEWAL") {
    await renewExistingLicense(session);
    return;
  }

  if (purchaseType === "NEW") {
    await createNewLicense(session);
    return;
  }

  throw new Error(
    `Unsupported checkout purchase type: ${purchaseType}`
  );
}

  

async function getCustomerEmail(customerId) {
  const customer = await stripe.customers.retrieve(customerId);
  return String(customer.email || "").trim().toLowerCase();
}

async function sendTrialEndingEmail(subscription) {
  const email = await getCustomerEmail(subscription.customer);
  if (!email) return;

  await sendEmail({
    to: email,
    subject: "Your Oppster trial ends soon",
    html: `
      <h2>Your Oppster trial ends soon</h2>
      <p>Your Oppster trial is scheduled to end in 2 days.</p>
      <p>Your subscription will automatically continue unless you cancel before the trial ends.</p>
      <p>Need help? Email hello@oppster.com.</p>
      <p>— The Oppster Team</p>
    `,
  });
}

async function sendPaymentConfirmationEmail(invoice) {
  if (Number(invoice.amount_paid || 0) <= 0) return;

  const email =
    String(invoice.customer_email || "").trim().toLowerCase() ||
    await getCustomerEmail(invoice.customer);

  if (!email) return;

  const amount = (Number(invoice.amount_paid || 0) / 100).toFixed(2);

  await sendEmail({
    to: email,
    subject: "Your Oppster subscription is active",
    html: `
      <h2>Thank you for being an Oppster member</h2>
      <p>Your subscription payment was successful.</p>
      <p><strong>Amount charged:</strong> $${amount}</p>
      <p>Need help? Email hello@oppster.com.</p>
      <p>— The Oppster Team</p>
    `,
  });
}

async function sendPaymentFailedEmail(invoice) {
  const email =
    String(invoice.customer_email || "").trim().toLowerCase() ||
    await getCustomerEmail(invoice.customer);

  if (!email) return;

  await sendEmail({
    to: email,
    subject: "Action needed: Oppster payment failed",
    html: `
      <h2>Action needed</h2>
      <p>We were unable to process your Oppster subscription payment.</p>
      <p>Please update your payment method to avoid interruption of access.</p>
      <p>Need help? Email hello@oppster.com.</p>
      <p>— The Oppster Team</p>
    `,
  });
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
        await processCompletedCheckout(event.data.object);
        console.log("Checkout completed successfully");
        break;

      case "customer.subscription.trial_will_end":
        //await sendTrialEndingEmail(event.data.object);
        //console.log("Trial ending email sent");
        break;

      case "invoice.paid":
        await sendPaymentConfirmationEmail(event.data.object);
        console.log("Invoice paid email handled");
        break;

      case "invoice.payment_failed":
        await sendPaymentFailedEmail(event.data.object);
        console.log("Payment failed email sent");
        break;

      case "customer.subscription.updated":
        console.log("Subscription updated");
        break;

      case "customer.subscription.deleted":
        console.log("Subscription canceled");
        break;

      default:
        console.log(`Unhandled event: ${event.type}`);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Stripe webhook processing error:", err);

    return res.status(500).json({
      error: err.message,
    });
  }
}
