const express = require("express");
const pool = require("../db/pool");
const { requireAuth, requireLibrarian } = require("../middleware/auth");

const router = express.Router();

/**
 * These endpoints store a REFERENCE COPY of your payout details for your own
 * admin screen. They do not move money and do not "connect" anything financially —
 * that connection is made once, directly in:
 *   - Stripe Dashboard > Settings > Bank accounts and scheduling (for card payouts)
 *   - ClickPesa merchant portal > Settlement account (for mobile money payouts)
 * Set it up in both those places using this same account/number so your records match.
 */
router.get("/payout-settings", requireAuth, requireLibrarian, async (req, res) => {
  const result = await pool.query("SELECT * FROM payout_settings WHERE owner_id = $1", [req.user.id]);
  res.json(result.rows[0] || null);
});

router.put("/payout-settings", requireAuth, requireLibrarian, async (req, res) => {
  const { card_payout_label, mobile_money_number, mobile_money_network } = req.body;

  const result = await pool.query(
    `INSERT INTO payout_settings (owner_id, card_payout_label, mobile_money_number, mobile_money_network, updated_at)
     VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (owner_id) DO UPDATE SET
       card_payout_label = EXCLUDED.card_payout_label,
       mobile_money_number = EXCLUDED.mobile_money_number,
       mobile_money_network = EXCLUDED.mobile_money_network,
       updated_at = now()
     RETURNING *`,
    [req.user.id, card_payout_label, mobile_money_number, mobile_money_network]
  );

  res.json(result.rows[0]);
});

module.exports = router;
