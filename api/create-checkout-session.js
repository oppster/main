const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const lookup_key = req.body.lookup_key;

    const prices = await stripe.prices.list({
      lookup_keys: [lookup_key],
      expand: ['data.product'],
    });

    const session = await stripe.checkout.sessions.create({
      billing_address_collection: 'auto',
      line_items: [
        {
          price: prices.data[0].id,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: 'https://oppster.com/success.html',
      cancel_url: 'https://oppster.com/cancel.html',
    });

    res.redirect(303, session.url);

  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
};
