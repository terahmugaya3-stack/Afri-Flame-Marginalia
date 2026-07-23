# Marginalia Library — Backend

Real accounts, a real database, and real payments (Visa/Mastercard via Stripe,
M-Pesa/Airtel Money via ClickPesa). This README is the step-by-step to get it
actually receiving money — the code alone won't do that until you complete
the signups below.

## What "receiving payments" actually requires

Nobody — including this code — can make money land in your pocket just by
typing an account number into a web form. Money moves through **licensed
payment institutions** (Stripe, ClickPesa) who've done the banking/regulatory
work. Your job is:
1. Open an account with each provider (they verify your identity — this is
   required by law, not optional friction).
2. Tell *them* where to settle your money (your bank account or mobile wallet).
3. Point this code at your API keys so it can ask them to charge people on
   your behalf.

Steps 1–2 happen on their websites, not here.

## 1. Set up the database

Pick a host with a free/cheap Postgres tier: **Supabase**, **Neon**, or
**Railway** all work well and give you a `DATABASE_URL` in about a minute.

```bash
npm install
cp .env.example .env
# paste your DATABASE_URL into .env
npm run db:migrate    # runs db/schema.sql against your database
```

## 2. Deploy the backend

Any Node host works — **Railway** or **Render** are the simplest (connect
your GitHub repo, set the environment variables from `.env`, deploy). You'll
get a URL like `https://marginalia-api.onrender.com` — that's your `API_BASE`
in the frontend.

## 3. Set up Stripe (Visa / Mastercard, global)

1. Go to **stripe.com** and create an account.
   - **Check your eligibility first**: visit stripe.com/global. As an
     individual/sole trader, whether Tanzania is currently supported for
     opening an account is genuinely in flux — confirm before building
     further around it. If it's not available to you directly, ClickPesa
     (below) also accepts Visa/Mastercard, and you could run everything
     through one provider instead — the code isolates this so swapping is
     a small change, not a rewrite.
2. In the Stripe Dashboard: **Settings → Bank accounts and scheduling** — this
   is where you tell Stripe which bank account to pay you into. This is the
   actual "set my account to receive payments" step for cards.
3. **Developers → API keys** → copy your secret key into `STRIPE_SECRET_KEY`.
4. **Developers → Webhooks** → add an endpoint pointing at
   `https://your-api-domain.com/api/webhooks/stripe`, listening for
   `checkout.session.completed` and `checkout.session.expired`. Copy the
   signing secret into `STRIPE_WEBHOOK_SECRET`.

## 4. Set up ClickPesa (M-Pesa, Airtel Money — Tanzania)

1. Go to **clickpesa.com** and register as a merchant. They'll ask for your ID
   and (as an individual) whatever KYC they require for a sole-trader
   merchant account — this is their compliance step, not this code's.
2. In your ClickPesa merchant portal, set your **settlement account** — the
   mobile money number or bank account that collected payments get paid out
   to. This is the actual "set my account to receive payments" step for
   mobile money.
3. From **API settings**, copy your API key into `CLICKPESA_API_KEY` and note
   your webhook signing secret into `CLICKPESA_WEBHOOK_SECRET`.
4. Give ClickPesa your callback URL: `https://your-api-domain.com/api/webhooks/clickpesa`.
5. **Double-check the request/response field names in ClickPesa's current
   API docs before going live** — `routes/payments.js` and `routes/webhooks.js`
   use the field names from their published docs at the time this was
   written, but payment APIs do change their contracts over time.

## 5. Wire up the frontend

See `FRONTEND-INTEGRATION.md` — it shows exactly what to change in your
existing `index.html` to call this backend instead of using the in-memory
demo data.

## 6. Test before going live

- Stripe: use their documented test card numbers in **test mode** first
  (switch `STRIPE_SECRET_KEY` to your test key). Don't use real cards until
  you flip to live keys.
- ClickPesa: ask them about their sandbox/test environment before your first
  real transaction.
- Confirm a full round trip: register → browse a book for sale → pay with a
  test card → land on `checkout-confirm.html` → see it flip to "Payment
  confirmed" → check the `orders` table shows `status = 'paid'`.

## How the payment confirmation "slot" works

`checkout-confirm.html` polls `GET /api/payments/orders/:id` every few
seconds. That endpoint only ever reflects what's in the `orders` table — and
the *only* things allowed to write `status = 'paid'` there are the Stripe and
ClickPesa webhook handlers, after verifying the request really came from
them. This is deliberate: a browser redirect alone is not proof of payment
(anyone can visit a "success" URL), so the confirmation always comes from the
payment provider's server-to-server callback, never from the customer's
browser.

## Money safety notes

- Card numbers never touch your server — Stripe Checkout hosts that page.
- Amounts are stored as integer cents/whole TZS, never floating point.
- Every write to `orders.status` should be traceable to a webhook event —
  if you ever add a "mark as paid manually" admin button for edge cases,
  log who did it and when.
