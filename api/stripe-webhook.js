const Stripe = require("stripe");
const { randomUUID } = require("crypto");
const nodemailer = require("nodemailer");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const siteUrl = process.env.SITE_URL || "https://oppster.com";

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
  const lineItems = await stripe.checkout.sessions.listLineItems(
    session.id,
    {
      limit: 1,
      expand: ["data.price"],
    }
  );

  const price = lineItems.data?.[0]?.price;
  const lookupKey = String(
    price?.lookup_key || ""
  ).toLowerCase();

  const unitAmount = Number(
    price?.unit_amount || 0
  );

  let tier = "CORE";
  let accountLimit = 1;

  if (
    lookupKey.includes("premium") ||
    unitAmount >= 3900
  ) {
    tier = "PREMIUM";
    accountLimit = 5;
  } else if (
    lookupKey.includes("pro") ||
    unitAmount >= 1900
  ) {
    tier = "PRO";
    accountLimit = 3;
  }

  return {
    tier,
    accountLimit,
  };
}

async function upsertLicenseFromCheckout(session) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  const email = String(
    session.customer_details?.email || ""
  )
    .trim()
    .toLowerCase();

  if (!email) {
    throw new Error(
      "Missing customer email from checkout session"
    );
  }

  const billingCountry =
    session.customer_details?.address?.country || null;

  const billingPostalCode =
    session.customer_details?.address?.postal_code ||
    null;

  const { tier, accountLimit } =
    await getCheckoutPlan(session);

  const subscription =
    await stripe.subscriptions.retrieve(
      session.subscription
    );

  const periodEndTimestamp =
    subscription.items?.data?.[0]
      ?.current_period_end;

  if (!periodEndTimestamp) {
    throw new Error(
      "Missing subscription item current_period_end from Stripe"
    );
  }

  const periodEnd = new Date(
    periodEndTimestamp * 1000
  );

  if (Number.isNaN(periodEnd.getTime())) {
    throw new Error(
      "Invalid current_period_end from Stripe"
    );
  }

  const licenseKey =
    "OPP-" +
    Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase() +
    "-" +
    Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase();

  const downloadToken = randomUUID();

  const body = {
    email,
    license_key: licenseKey,
    tier,
    status: "ACTIVE",
    current_period_end: periodEnd
      .toISOString()
      .slice(0, 10),
    account_limit: accountLimit,
    billing_country: billingCountry,
    billing_postal_code: billingPostalCode,
    stripe_customer_id: session.customer,
    stripe_subscription_id:
      session.subscription,
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
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Supabase license upsert failed: ${errorText}`
    );
  }

  await sendEmail({
    to: email,
    subject: "Welcome to Oppster",
    html: `
      <h2>Welcome to Oppster</h2>

      <p>
        Your subscription is active and your Oppster workbook access
        is ready.
      </p>

      <p><strong>Account Email:</strong> ${email}</p>
      <p><strong>Workbook Access Key:</strong> ${licenseKey}</p>
      <p><strong>Plan:</strong> Oppster ${tier}</p>

      <p>
        <a href="${siteUrl}/download.html?token=${downloadToken}">
          Download your Oppster workbook
        </a>
      </p>

      <p><strong>Before you begin:</strong></p>

      <ul>
        <li>
          Download and save your Oppster workbook to a permanent folder.
        </li>
        <li>
          Move it out of your Downloads folder before opening it.
        </li>
        <li>Enable macros when prompted by Excel.</li>
        <li>Complete your account setup.</li>
      </ul>

      <p>Need help? Email hello@oppster.com.</p>

      <p>Thank you for joining Oppster.</p>
      <p>— The Oppster Team</p>
    `,
  });
}

async function getCustomerEmail(customerId) {
  const customer =
    await stripe.customers.retrieve(customerId);

  return String(customer.email || "")
    .trim()
    .toLowerCase();
}

async function sendTrialEndingEmail(subscription) {
  const email = await getCustomerEmail(
    subscription.customer
  );

  if (!email) {
    return;
  }

  await sendEmail({
    to: email,
    subject: "Your Oppster trial ends soon",
    html: `
      <h2>Your Oppster trial ends soon</h2>

      <p>
        Your Oppster trial is scheduled to end in 2 days.
      </p>

      <p>
        Your subscription will automatically continue unless you cancel
        before the trial ends.
      </p>

      <p>Need help? Email hello@oppster.com.</p>
      <p>— The Oppster Team</p>
    `,
  });
}

async function updateLicenseFromRenewal(invoice) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  const subscriptionId =
    invoice.subscription ||
    invoice.parent?.subscription_details
      ?.subscription;

  if (!subscriptionId) {
    throw new Error(
      "Missing Stripe subscription ID from renewal invoice"
    );
  }

  const subscription =
    await stripe.subscriptions.retrieve(
      subscriptionId
    );

  const metadata = subscription.metadata || {};

  const purchaseType = String(
    metadata.purchase_type || ""
  )
    .trim()
    .toUpperCase();

  const existingLicenseKey = String(
    metadata.existing_license_key || ""
  )
    .split(",")[0]
    .trim();

  const activatedWorkbookId = String(
    metadata.activated_workbook_id || ""
  )
    .split(",")[0]
    .trim();

  if (purchaseType !== "RENEWAL") {
    throw new Error(
      `Subscription ${subscriptionId} is not marked as a renewal`
    );
  }

  if (
    !existingLicenseKey ||
    !activatedWorkbookId
  ) {
    throw new Error(
      "Renewal subscription metadata is missing the existing license key or workbook ID"
    );
  }

  const periodEndTimestamp =
    subscription.items?.data?.[0]
      ?.current_period_end;

  if (!periodEndTimestamp) {
    throw new Error(
      "Missing subscription item current_period_end from Stripe renewal"
    );
  }

  const periodEnd = new Date(
    periodEndTimestamp * 1000
  );

  if (Number.isNaN(periodEnd.getTime())) {
    throw new Error(
      "Invalid renewal current_period_end from Stripe"
    );
  }

  const updateUrl =
    `${supabaseUrl}/rest/v1/licenses` +
    `?license_key=eq.${encodeURIComponent(
      existingLicenseKey
    )}` +
    `&activated_workbook_id=eq.${encodeURIComponent(
      activatedWorkbookId
    )}`;

  const response = await fetch(updateUrl, {
    method: "PATCH",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      status: "ACTIVE",
      current_period_end: periodEnd
        .toISOString()
        .slice(0, 10),

      stripe_customer_id:
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer?.id || null,

      stripe_subscription_id: subscriptionId,

      updated_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Supabase renewal update failed: ${errorText}`
    );
  }

  const updatedRows = await response.json();

  if (
    !Array.isArray(updatedRows) ||
    updatedRows.length === 0
  ) {
    throw new Error(
      `No Oppster renewal license found for ${existingLicenseKey} and workbook ${activatedWorkbookId}`
    );
  }

  return {
    subscriptionId,
    periodEndTimestamp,
    periodEnd,
    existingLicenseKey,
    activatedWorkbookId,
  };
}

async function sendPaymentConfirmationEmail(
  invoice,
  periodEndTimestamp
) {
  const amountPaid = Number(
    invoice.amount_paid || 0
  );

  if (amountPaid <= 0) {
    return;
  }

  const email =
    String(invoice.customer_email || "")
      .trim()
      .toLowerCase() ||
    (await getCustomerEmail(invoice.customer));

  if (!email) {
    throw new Error(
      "Unable to determine customer email for renewal"
    );
  }

  const currency = String(
    invoice.currency || "usd"
  ).toUpperCase();

  const amount = new Intl.NumberFormat(
    "en-US",
    {
      style: "currency",
      currency,
    }
  ).format(amountPaid / 100);

  const renewedThrough = new Date(
    periodEndTimestamp * 1000
  ).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  await sendEmail({
    to: email,
    subject:
      "Your Oppster subscription has renewed",
    html: `
      <h2>Your Oppster subscription has renewed</h2>

      <p>
        Your Oppster subscription renewal was processed successfully.
      </p>

      <p><strong>Amount charged:</strong> ${amount}</p>

      <p>
        <strong>Access renewed through:</strong>
        ${renewedThrough}
      </p>

      <p>
        Your existing Oppster workbook and Workbook Access Key remain
        active. You do not need to download or activate a new workbook.
      </p>

      <p>
        Open your workbook and select
        <strong>Refresh License</strong> to display the updated
        subscription period.
      </p>

      <p>Need help? Email hello@oppster.com.</p>

      <p>Thank you for continuing with Oppster.</p>
      <p>— The Oppster Team</p>
    `,
  });
}

async function sendPaymentFailedEmail(invoice) {
  const email =
    String(invoice.customer_email || "")
      .trim()
      .toLowerCase() ||
    (await getCustomerEmail(invoice.customer));

  if (!email) {
    return;
  }

  await sendEmail({
    to: email,
    subject:
      "Action needed: Oppster payment failed",
    html: `
      <h2>Action needed</h2>

      <p>
        We were unable to process your Oppster subscription payment.
      </p>

      <p>
        Please update your payment method to avoid interruption
        of access.
      </p>

      <p>Need help? Email hello@oppster.com.</p>
      <p>— The Oppster Team</p>
    `,
  });
}

async function buffer(readable) {
  const chunks = [];

  for await (const chunk of readable) {
    chunks.push(
      typeof chunk === "string"
        ? Buffer.from(chunk)
        : chunk
    );
  }

  return Buffer.concat(chunks);
}

async function handler(req, res) {
  if (req.method !== "POST") {
    return res
      .status(405)
      .send("Method Not Allowed");
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
    return res
      .status(400)
      .send(`Webhook Error: ${err.message}`);
  }

  console.log("Stripe Event:", event.type);

  try {
    switch (event.type) {

      case "checkout.session.completed": {
      const session = event.data.object;
    
      const purchaseType = String(
        session.metadata?.purchase_type || "NEW"
      )
        .trim()
        .toUpperCase();
    
      if (purchaseType === "RENEWAL") {
        console.log(
          "Renewal checkout completed; no new license or workbook created"
        );
      } else {
        await upsertLicenseFromCheckout(session);
    
        console.log(
          "New checkout completed, license created, welcome email sent"
        );
      }
    
      break;
    }

      case "customer.subscription.trial_will_end":
        // await sendTrialEndingEmail(
        //   event.data.object
        // );
        // console.log("Trial ending email sent");
        break;

      case "invoice.paid": {
        const invoice = event.data.object;

        const amountPaid = Number(
          invoice.amount_paid || 0
        );

        const billingReason = String(
          invoice.billing_reason || ""
        );

        if (
          amountPaid <= 0 ||
          billingReason !== "subscription_cycle"
        ) {
          console.log(
            `Invoice paid renewal skipped: billing_reason=${billingReason}, amount_paid=${amountPaid}`
          );

          break;
        }

        const renewal =
          await updateLicenseFromRenewal(invoice);

        await sendPaymentConfirmationEmail(
          invoice,
          renewal.periodEndTimestamp
        );

        console.log(
          `Renewal completed through ${renewal.periodEnd
            .toISOString()
            .slice(0, 10)}`
        );

        break;
      }

      case "invoice.payment_failed":
        await sendPaymentFailedEmail(
          event.data.object
        );

        console.log(
          "Payment failed email sent"
        );

        break;

      case "customer.subscription.updated":
        console.log(
          "Subscription updated"
        );
        break;

      case "customer.subscription.deleted":
        console.log(
          "Subscription canceled"
        );
        break;

      default:
        console.log(
          `Unhandled event: ${event.type}`
        );
    }

    return res.status(200).json({
      received: true,
    });
  } catch (err) {
    console.error(
      "Stripe webhook processing error:",
      err
    );

    return res.status(500).json({
      error: err.message,
    });
  }
}

module.exports = handler;

module.exports.config = {
  api: {
    bodyParser: false,
  },
};
