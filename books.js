const express = require("express");
const { body, validationResult } = require("express-validator");
const pool = require("../db/pool");
const { requireAuth, requireLibrarian } = require("../middleware/auth");

const router = express.Router();

// Public: list books (covers/details still gated client-side to logged-in users if you want)
router.get("/", async (req, res) => {
  const { type } = req.query; // 'free' | 'sale' | undefined
  const result = type
    ? await pool.query("SELECT * FROM books WHERE book_type = $1 ORDER BY created_at DESC", [type])
    : await pool.query("SELECT * FROM books ORDER BY created_at DESC");
  res.json(result.rows);
});

router.get("/:id", async (req, res) => {
  const result = await pool.query("SELECT * FROM books WHERE id = $1", [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: "Book not found." });
  res.json(result.rows[0]);
});

// Librarian-only: upload a new book
router.post(
  "/",
  requireAuth,
  requireLibrarian,
  [
    body("title").trim().notEmpty(),
    body("author").trim().notEmpty(),
    body("book_type").isIn(["free", "sale"]),
    body("price_cents").if(body("book_type").equals("sale")).isInt({ min: 1 }).withMessage("Set a price for a book that's for sale.")
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { title, author, cover_url, call_number, description, book_type, price_cents = 0, currency = "USD", price_tzs } = req.body;

    const result = await pool.query(
      `INSERT INTO books (title, author, cover_url, call_number, description, book_type, price_cents, currency, price_tzs, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [title, author, cover_url, call_number, description, book_type, book_type === "sale" ? price_cents : 0, currency, price_tzs || null, req.user.id]
    );

    res.status(201).json(result.rows[0]);
  }
);

module.exports = router;
