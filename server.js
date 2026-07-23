require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./routes/auth");
const bookRoutes = require("./routes/books");
const paymentRoutes = require("./routes/payments");
const webhookRoutes = require("./routes/webhooks");
const accountRoutes = require("./routes/account");

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

// Stripe webhook needs the RAW request body to verify its signature,
// so it must be mounted BEFORE express.json() and excluded from it.
app.use("/api/webhooks/stripe", express.raw({ type: "application/json" }));
app.use("/api/webhooks", webhookRoutes);

app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/books", bookRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/account", accountRoutes);

app.get("/health", (req, res) => res.json({ ok: true }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our end." });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Marginalia API running on port ${port}`));
