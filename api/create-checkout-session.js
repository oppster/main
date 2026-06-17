const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const lookup_key = req.body.lookup_key;
    const access_days = Number(req.body.access_days || 30);

    const prices = await stripe.prices.list({
      lookup_keys: [lookup_key],
      expand: ['data.product'],
    });

    if (!prices.data.length) {
      return res.status(400).send('Invalid price lookup key');
    }

    const sessionConfig = {
      billing_address_collection: 'auto',
      line_items: [
        {
          price: prices.data[0].id,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: 'https://oppster.com/success.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://oppster.com/cancel.html',
      metadata: {
        access_days: String(access_days),
      },
      subscription_data: {
        metadata: {
          access_days: String(access_days),
        },
      },
    };

    const session = await stripe.checkout.sessions.create(sessionConfig);

    res.redirect(303, session.url);

  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
};
