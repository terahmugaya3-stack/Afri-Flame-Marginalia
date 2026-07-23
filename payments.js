const express = require("express");
const axios = require("axios");
const Stripe = require("stripe");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * CARD PAYMENT (Visa / Mastercard, global) via Stripe Checkout.
 * Flow: frontend calls this -> we create a Stripe-hosted checkout page ->
 * redirect the buyer there -> Stripe collects the card details (we never touch
 * raw card numbers, which keeps you out of PCI-compliance scope) -> Stripe
 * redirects back and fires a webhook that confirms payment (see webhooks.js).
 */
router.post("/card/checkout", requireAuth, async (req, res) => {
  const { book_id } = req.body;
  const bookResult = await pool.query("SELECT * FROM books WHERE id = $1", [book_id]);
  const book = bookResult.rows[0];
  if (!book) return res.status(404).json({ error: "Book not found." });
  if (book.book_type !== "sale") return res.status(400).json({ error: "This book is free — no payment needed." });

  const orderResult = await pool.query(
    `INSERT INTO orders (buyer_id, book_id, amount_cents, currency, method, provider, status)
     VALUES ($1,$2,$3,$4,'card','stripe','pending') RETURNING id`,
    [req.user.id, book.id, book.price_cents, book.currency]
  );
  const orderId = orderResult.rows[0].id;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: book.currency.toLowerCase(),
          product_data: { name: book.title },
          unit_amount: book.price_cents
        },
        quantity: 1
      }
    ],
    metadata: { order_id: orderId }, // lets the webhook find this order again
    success_url: `${process.env.FRONTEND_URL}/checkout-confirm.html?order=${orderId}&status=success`,
    cancel_url: `${process.env.FRONTEND_URL}/checkout-confirm.html?order=${orderId}&status=cancelled`
  });

  await pool.query("UPDATE orders SET provider_reference = $1 WHERE id = $2", [session.id, orderId]);

  res.json({ order_id: orderId, checkout_url: session.url });
});

/**
 * MOBILE MONEY PAYMENT (M-Pesa / Airtel Money, Tanzania) via ClickPesa USSD Push.
 * Flow: buyer enters their phone number -> we ask ClickPesa to push a payment
 * prompt to that phone -> buyer approves with their mobile money PIN ->
 * ClickPesa calls our webhook with the final result (see webhooks.js).
 */
router.post("/mobilemoney/checkout", requireAuth, async (req, res) => {
  const { book_id, phone, network } = req.body; // network: 'mpesa' | 'airtel_money'
  if (!phone || !/^255\d{9}$/.test(phone)) {
    return res.status(400).json({ error: "Enter the phone number in the format 2557XXXXXXXX." });
  }

  const bookResult = await pool.query("SELECT * FROM books WHERE id = $1", [book_id]);
  const book = bookResult.rows[0];
  if (!book) return res.status(404).json({ error: "Book not found." });
  if (book.book_type !== "sale") return res.status(400).json({ error: "This book is free — no payment needed." });
  if (!book.price_tzs) return res.status(400).json({ error: "This book doesn't have a TZS price set yet." });

  const orderResult = await pool.query(
    `INSERT INTO orders (buyer_id, book_id, amount_cents, currency, method, provider, status, payer_phone)
     VALUES ($1,$2,$3,'TZS',$4,'clickpesa','pending',$5) RETURNING id`,
    [req.user.id, book.id, book.price_tzs, network === "airtel_money" ? "airtel_money" : "mpesa", phone]
  );
  const orderId = orderResult.rows[0].id;

  try {
    const clickpesaResp = await axios.post(
      `${process.env.CLICKPESA_BASE_URL}/third-parties/payments/initiate-ussd-push-request`,
      {
        amount: String(book.price_tzs),
        currency: "TZS",
        orderReference: orderId,
        phoneNumber: phone
      },
      { headers: { Authorization: `Bearer ${process.env.CLICKPESA_API_KEY}` } }
    );

    await pool.query("UPDATE orders SET provider_reference = $1 WHERE id = $2", [
      clickpesaResp.data.id || clickpesaResp.data.transactionId,
      orderId
    ]);

    res.json({ order_id: orderId, status: "pending", message: "Check your phone to approve the payment." });
  } catch (err) {
    await pool.query("UPDATE orders SET status = 'failed' WHERE id = $1", [orderId]);
    res.status(502).json({ error: "Couldn't reach the mobile money provider. Try again." });
  }
});

/**
 * PAYMENT CONFIRMATION SLOT
 * The frontend polls this after redirecting back from checkout / after the
 * USSD push, so the buyer sees "payment confirmed" the moment the webhook
 * updates the order — this endpoint never marks anything paid itself.
 */
router.get("/orders/:id", requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT o.*, b.title, b.author FROM orders o JOIN books b ON b.id = o.book_id WHERE o.id = $1`,
    [req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: "Order not found." });
  const order = result.rows[0];
  if (order.buyer_id !== req.user.id) return res.status(403).json({ error: "Not your order." });
  res.json(order);
});

module.exports = router;
