import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = {
  api: {
    bodyParser: false,
  },
};

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
        console.log("Checkout completed");
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
