const express = require("express");
const crypto = require("crypto");
const Stripe = require("stripe");
const pool = require("../db/pool");

const router = express.Router();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * STRIPE WEBHOOK — this is the ONLY place an order is allowed to flip to "paid"
 * for card payments. Never trust a "success" redirect from the browser alone;
 * a user can land on your success page without actually paying. The signature
 * check below proves the event really came from Stripe.
 *
 * Mounted with express.raw() in server.js — do NOT apply express.json() to this route.
 */
router.post("/stripe", async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const orderId = session.metadata?.order_id;
    if (orderId) {
      await pool.query(
        "UPDATE orders SET status = 'paid', updated_at = now() WHERE id = $1 AND provider_reference = $2",
        [orderId, session.id]
      );
    }
  }

  if (event.type === "checkout.session.expired") {
    const session = event.data.object;
    const orderId = session.metadata?.order_id;
    if (orderId) {
      await pool.query("UPDATE orders SET status = 'cancelled', updated_at = now() WHERE id = $1", [orderId]);
    }
  }

  res.json({ received: true });
});

/**
 * CLICKPESA WEBHOOK — confirms M-Pesa / Airtel Money payments.
 * ClickPesa signs callbacks; verify against their documented scheme before
 * trusting the payload (check your ClickPesa dashboard for the exact header
 * name and signing method — this is the general HMAC pattern most Tanzanian
 * aggregators use, but confirm it against ClickPesa's current docs).
 */
router.post("/clickpesa", express.json(), async (req, res) => {
  const signature = req.headers["x-clickpesa-signature"];
  const expected = crypto
    .createHmac("sha256", process.env.CLICKPESA_WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (signature !== expected) {
    return res.status(400).json({ error: "Invalid webhook signature." });
  }

  const { orderReference, status, transactionId } = req.body;
  const newStatus = status === "SUCCESS" ? "paid" : status === "FAILED" ? "failed" : "pending";

  await pool.query(
    "UPDATE orders SET status = $1, provider_reference = COALESCE($2, provider_reference), updated_at = now() WHERE id = $3",
    [newStatus, transactionId, orderReference]
  );

  res.json({ received: true });
});

module.exports = router;
