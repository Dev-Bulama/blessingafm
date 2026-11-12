# Blessing African Market & Beauty Store

Online store for **Blessing African Market & Beauty Store**, 77 Davis Drive, Newmarket, Ontario.
African and Caribbean groceries plus hair and beauty products, sold in CAD, with in-store pickup, local delivery
and Canada-wide shipping.

One Node.js app: Express, server-rendered EJS, Tailwind CSS (pre-built), MySQL 8 via Knex/mysql2. No Redis, Docker,
background workers or websockets, so it runs on Hostinger hPanel Node.js web app hosting.

- [What is included](#what-is-included)
- [Run it locally](#run-it-locally)
- [Deploy to Hostinger hPanel](#deploy-to-hostinger-hpanel)
- [Go-live checklist](#go-live-checklist)
- [Day-to-day operation](#day-to-day-operation)
- [How the money maths works](#how-the-money-maths-works)
- [Project structure](#project-structure)
- [Database schema](#database-schema)
- [Security notes](#security-notes)
- [Assumptions](#assumptions)

## What is included

**Storefront** - announcement bar, sticky header with live search, mega menu (Food Market / Beauty Store), hero slider,
department tiles, featured categories, best sellers, new arrivals, deals, store map, newsletter signup, floating
WhatsApp button. Category pages with filters (subcategory, brand, price, in stock, on sale), sorting and pagination.
FULLTEXT search over name, brand, SKU and tags. Product pages with zoomable gallery, variants, stock status, tabs,
related products and verified-buyer reviews. Wishlist.

**Cart and checkout** - guest and customer carts (merged on login), slide-out drawer, coupons, one-page checkout.
Pickup with day and time slots, local delivery by postal-code zone, flat-rate shipping by weight. Frozen, perishable
and pickup-only items are blocked from shipping and the customer is told which items are the cause. Ontario HST on
taxable items only. Stripe Checkout (cards, Apple Pay, Google Pay), PayPal, Interac e-Transfer and pay in store.
Guests can track an order with its number and email. Sold-out products offer "email me when it is back".

**Customer account** - register, login, email verification, password reset, order history and tracking, printable
invoice, reorder, address book, wishlist, profile and password.

**Admin panel** (`/admin`) - dashboard with sales chart, products (variants, images with drag reorder, CSV import and
export, bulk price/stock edit), categories, brands, inventory with logged history, orders with status flow and
customer emails, invoices and packing slips, customers, coupons, delivery zones, shipping rates, pickup slots,
banners, pages (rich text), FAQs, reviews, newsletter subscribers, contact messages, settings, staff roles, audit log,
orders CSV export.

**Alerts and reminders** (all switchable in Admin -> Settings):

| Who | Email | When |
| --- | --- | --- |
| Store | Low stock alert | The moment an order takes an item down to its low-stock level |
| Store | Daily summary | Each morning after 7 AM: orders to prepare, today's pickups, unpaid e-Transfers, low stock, yesterday's sales |
| Customer | Pickup reminder | The day before and the day of pickup |
| Customer | e-Transfer payment reminder | Order still unpaid after 24 hours (optional auto-cancel after a set number of hours) |
| Customer | Abandoned cart reminder | Signed-in customer left items in the cart for 24 hours (once per cart) |
| Customer | Review request | 5 days after an order is completed |
| Customer | Back in stock | A sold-out item they asked about is available again |

Reminders are sent by the hourly cron job (step 8) and need working email (step 6).

## Run it locally

Requires Node.js 20+ and MySQL 8.

```bash
cp .env.example .env
```

Edit `.env`: database details, `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`. For local HTTP set
`NODE_ENV=development`, `COOKIE_SECURE=0` and `APP_URL=http://localhost:3000`.

```bash
npm install
```

```bash
npm run migrate
```

```bash
npm run seed
```

```bash
npm run dev
```

Open <http://localhost:3000>. Sign in at `/account/login` with the admin email and password from `.env`, then go to
`/admin`.

| Script | What it does |
| --- | --- |
| `npm start` | Start the app (`node server.js`) |
| `npm run dev` | Start with auto-restart on file changes |
| `npm run build` | Compile Tailwind to `src/public/css/app.css` (a built copy is committed) |
| `npm run dev:css` | Rebuild the CSS on every change while developing |
| `npm run migrate` | Apply database migrations |
| `npm run seed` | Load default settings, the admin user and sample data (safe to re-run) |
| `npm test` | Unit tests for price, tax, coupon, shipping, alert and PayPal amount maths |

Only re-run `npm run build` when you change templates or `src/styles/app.css`, and commit the result.

## Deploy to Hostinger hPanel

Node.js web apps need a Business or Cloud hosting plan.

### 1. Create the MySQL database

hPanel -> **Websites** -> your site -> **Databases** -> **Management**. Create a database and a database user with a
strong password. Write down four values: host (usually `localhost` or `127.0.0.1`), database name, user name and
password. hPanel prefixes names, for example `u123456789_blessing`.

### 2. Create the Node.js app

hPanel -> **Websites** -> **Add website** -> **Node.js Apps**.

- **Source:** connect the GitHub repository and choose the branch to deploy (or upload a `.zip` of the project
  without `node_modules`).
- **Node.js version:** 20.
- **Entry file:** `server.js`.
- **Start command:** the `start` script.
- **Build command:** leave blank. The compiled CSS is already in the repository.

### 3. Add the environment variables

In the deployment form use **Import .env**, or add each variable by hand. Every variable in
[`.env.example`](.env.example) is listed here:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | Leave unset if hPanel assigns the port. The app listens on `process.env.PORT`. |
| `APP_URL` | `https://yourdomain.ca`, no trailing slash |
| `SESSION_SECRET` | A long random string (48+ characters). Never reuse the example. |
| `COOKIE_SECURE` | `1` |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | From step 1. Port is `3306`. |
| `DB_POOL_MAX` | `3` (the session store uses 2 more, 5 in total) |
| `AUTO_MIGRATE`, `AUTO_SEED` | See step 4 |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Login for the first admin. Password at least 10 characters. |
| `ADMIN_FIRST_NAME`, `ADMIN_LAST_NAME` | Optional |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | `smtp.hostinger.com`, `465`, `1` |
| `SMTP_USER`, `SMTP_PASSWORD` | The mailbox from step 6 |
| `MAIL_FROM` | `"Blessing African Market <orders@yourdomain.ca>"` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | From step 7 |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MODE` | From step 7. Leave the first two empty to hide PayPal. Mode is `sandbox` or `live`. |
| `MAIL_TRANSPORT` | Leave as `smtp`. (`log` is for local development: emails go to the log instead of being sent.) |
| `UPLOAD_DIR` | An absolute folder outside the app folder, e.g. `/home/u123456789/blessing-data/uploads` |
| `LOG_DIR` | Optional, e.g. `/home/u123456789/blessing-data/logs` |
| `CRON_TOKEN` | A random string for step 8 |

Generate random values with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Set `UPLOAD_DIR` before you upload any product photos. Files inside the app folder can be replaced when the app is
redeployed; a folder outside it is not touched.

### 4. Install dependencies, migrate and seed

hPanel installs dependencies when you click **Deploy**. Then set up the database one of two ways.

**With SSH** (hPanel -> **Advanced** -> **SSH Access**), from the app folder:

```bash
npm run migrate
```

```bash
npm run seed
```

**Without SSH:** set `AUTO_MIGRATE=1` and `AUTO_SEED=1`, deploy, and check that the site loads. Then set
`AUTO_SEED=0` and redeploy. `AUTO_MIGRATE=1` can stay on so future updates apply their migrations at start-up.

The seed creates the admin user from `ADMIN_EMAIL` / `ADMIN_PASSWORD`, default settings, the category tree, 58 sample
products with placeholder artwork, banners, York Region delivery zones, shipping rates, pickup slots, coupons
(`WELCOME10`, `SAVE5`), content pages and FAQs. It never overwrites existing data.

### 5. Point the domain, enable SSL, force HTTPS

1. hPanel -> **Domains**: point the domain at this hosting plan (Hostinger nameservers, or an A record to the
   server IP).
2. hPanel -> **Security** -> **SSL**: install the free SSL certificate for the domain.
3. Turn on **Force HTTPS**.
4. Check that `APP_URL` starts with `https://` and `COOKIE_SECURE=1`, then redeploy.

### 6. Create the mailbox and test email

1. hPanel -> **Emails**: create a mailbox such as `orders@yourdomain.ca`.
2. Put the address and password in `SMTP_USER` and `SMTP_PASSWORD`, set `MAIL_FROM`, redeploy.
3. Sign in to `/admin` -> **Settings** -> **Send a test email**. The System status box at the top of that page shows
   whether email, Stripe, the cron token and image conversion are configured.

### 7. Add Stripe

1. In the Stripe Dashboard copy the **secret key** (`sk_test_...` first) into `STRIPE_SECRET_KEY`.
2. Developers -> **Webhooks** -> **Add endpoint**: URL `https://<domain>/webhooks/stripe`, events
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`
   and `checkout.session.expired`.
3. Copy the endpoint's **signing secret** (`whsec_...`) into `STRIPE_WEBHOOK_SECRET` and redeploy.
4. Enable Apple Pay and Google Pay under Stripe -> Settings -> Payment methods. They then appear on the Stripe
   Checkout page automatically.

An order is marked paid only when Stripe calls the webhook with a valid signature. If the webhook is not registered,
card orders stay "Pending" and are cancelled after two hours.

**PayPal (optional)**

1. Sign in at <https://developer.paypal.com> with the store's PayPal Business account -> **Apps & Credentials**.
2. Create an app. Copy the **Client ID** and **Secret** into `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`.
3. Use the **Sandbox** credentials with `PAYPAL_MODE=sandbox` while testing, then the **Live** credentials with
   `PAYPAL_MODE=live`. Redeploy after each change.

No webhook is needed. The customer approves the payment at PayPal, comes back to the site, and the store captures
the payment directly with PayPal and checks the amount before marking the order paid. If the customer approves but
closes the window before returning, the hourly cron job finds the payment and completes the order.

### 8. Set up the cron job

hPanel -> **Advanced** -> **Cron Jobs** -> create a job that runs every hour:

```bash
curl -fsS "https://<domain>/cron/cleanup?token=<CRON_TOKEN>" > /dev/null
```

It deletes abandoned guest carts (14 days), expired sessions and used tokens, cancels card and PayPal orders that
were never paid so their stock goes back on sale, and sends the alerts and reminders listed above. A wrong or missing
token gets a 403. Hourly is the right frequency: reminders are sent at most once each, however often it runs.

### 9. Back up the database and uploads

- **Automatic:** hPanel -> **Files** -> **Backups** keeps weekly (or daily, depending on the plan) backups.
- **Database, manual:** hPanel -> **Databases** -> **phpMyAdmin** -> **Export**, or with SSH:

```bash
mysqldump -h "$DB_HOST" -u "$DB_USER" -p "$DB_NAME" | gzip > ~/backups/blessing-$(date +%F).sql.gz
```

- **Uploads:** download the `UPLOAD_DIR` folder with the File Manager, or with SSH:

```bash
tar czf ~/backups/uploads-$(date +%F).tar.gz -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
```

Take a backup before every update and keep a copy off the server at least once a month. To restore, import the
`.sql.gz` in phpMyAdmin and put the uploads folder back.

### Updating the site

Push to the deployed branch and click **Redeploy** in hPanel. With `AUTO_MIGRATE=1` new migrations apply at start-up;
otherwise run `npm run migrate` over SSH.

## Go-live checklist

- [ ] Admin -> Settings: replace every `[PLACEHOLDER]` value (phone, email, postal code, hours), add the WhatsApp
      number and social links, upload the real logo, set the e-Transfer email.
- [ ] Sign in as admin and **change the admin password** (My account -> Profile & password).
- [ ] Replace the sample products, prices, stock and photos with the real catalogue. Check the **Taxable** flag on
      each product with your accountant.
- [ ] Review delivery zones, fees, shipping rates and pickup slots.
- [ ] Read through the About, Shipping, Returns, Privacy and Terms pages and adjust them to the store's real policies.
- [ ] Send a test email from Settings.
- [ ] Test order: **pickup + pay in store**. Move it through Processing -> Ready for pickup -> Completed.
- [ ] Test order: **local delivery + Interac e-Transfer**. Mark it Paid in admin.
- [ ] Test order: **shipping + card** with Stripe test card `4242 4242 4242 4242`. Confirm it turns Paid by itself.
- [ ] Test order with **PayPal** using a sandbox buyer account (developer.paypal.com -> Sandbox -> Accounts).
- [ ] Add a frozen item and confirm shipping is blocked with the item named.
- [ ] Cancel a test order and confirm the stock returns.
- [ ] Confirm the customer and the store both receive emails for the orders above.
- [ ] Open the cron URL once in a browser and confirm it returns `{"ok":true,...}`.
- [ ] **Switch Stripe to live:** replace `STRIPE_SECRET_KEY` with the `sk_live_...` key, add the webhook endpoint
      again in live mode, update `STRIPE_WEBHOOK_SECRET`, redeploy. Settings should show "Stripe LIVE".
- [ ] **Switch PayPal to live:** put the Live Client ID and Secret in the environment, set `PAYPAL_MODE=live`,
      redeploy. Settings should show "PayPal LIVE".
- [ ] Admin -> Settings: review **Alerts for the store** and **Reminders for customers**, and decide whether unpaid
      e-Transfer orders should cancel automatically (off by default).
- [ ] Delete the test orders' stock effects if needed (Inventory) and remove test customers.
- [ ] Submit `https://<domain>/sitemap.xml` to Google Search Console.

## Day-to-day operation

- **Order status flow:** pending -> awaiting payment -> paid -> processing -> ready for pickup / out for delivery /
  shipped -> completed, plus cancelled and refunded. Every change can email the customer. Cancelling returns the
  items to stock.
- **e-Transfer orders** start as "Awaiting payment". When the transfer arrives, set the status to Paid.
- **Payment amount mismatch:** in the rare case Stripe or PayPal reports a different amount than the order total,
  the order is parked as "Awaiting payment" with a note. Check the payment account, then mark it Paid or refund it.
- **Pay-in-store orders** start as "Pending". Payment is recorded automatically when the order is marked Completed.
- **Refunds:** refund the money in Stripe (or by e-Transfer / in store), then set the order to Refunded.
- **Staff vs admin:** staff can use orders, products, categories, brands and inventory. Admins can do everything.
- **Logs:** `logs/access.log` and `logs/app.log`, rotated daily and kept for 14 days.

## How the money maths works

All amounts are integer cents. Everything is calculated on the server in `src/services` and covered by `npm test`.

- **Tax:** HST (rate from Settings, 13% by default) applies only to products with `is_taxable`. A coupon discount is
  spread across the lines in proportion to their value before tax is calculated. Tax is rounded once on the taxable
  total, then allocated to lines so the lines always add up.
- **Delivery and shipping fees** are taxed in proportion to the taxable share of the goods (a fee on a
  groceries-only order carries no tax). This can be turned off in Settings.
- **Coupons:** percentage or fixed, minimum spend, start and expiry dates, usage limit. The usage count is
  incremented with a guarded update so a limited coupon cannot be over-redeemed.
- **Stock:** taken inside the order transaction with `UPDATE ... WHERE stock_qty >= n`. If two customers buy the
  last unit at the same moment, one order succeeds and the other is told the item is gone.
- **Snapshots:** `order_items` stores the name, SKU, price, discount and tax at the time of sale, so later product
  edits never change an old order or invoice.

## Project structure

```
server.js            entry file: optional auto-migrate, then listen on process.env.PORT
knexfile.js          database config shared by the app, migrations and seeds
migrations/          schema (5 files)
seeds/               settings + admin, catalogue, zones/slots/pages; data in seeds/data
src/app.js           Express app: security headers, static files, sessions, CSRF, routes
src/config/          env, db, session, mail, stripe, logger, adminResources (CRUD definitions)
src/lib/             money, dates, slug, html sanitising, placeholder artwork
src/middleware/      auth, roles, csrf, validation (zod), rate limits, uploads, flash, locals, errors
src/models/          settings, categories, products, users, orders, reviews, content, audit
src/services/        pricing, tax, coupon, shipping, cart, checkout, order, inventory, paypal, notifications,
                     mail, image, csv, cleanup
src/controllers/     storefront, cart, checkout, auth, account, webhook, seo, admin/*
src/routes/          store, cart, checkout, account, admin, webhooks, cron, seo
src/views/           layouts, partials, store, account, admin, emails, errors
src/styles/app.css   Tailwind source and brand colour variables
src/public/          compiled css, js, self-hosted fonts, images
tests/               unit tests for the money maths
uploads/             product photos (gitignored; use UPLOAD_DIR in production)
```

**Brand colours** are CSS variables at the top of `src/styles/app.css` (`--brand-red`, `--brand-yellow`,
`--brand-green`, `--brand-black`, `--brand-white`). Change them there and run `npm run build`.

## Database schema

InnoDB, utf8mb4, foreign keys throughout, money as integer cents.

| Area | Tables |
| --- | --- |
| Identity | `users`, `user_tokens` (hashed verify/reset tokens), `addresses`, `sessions`, `audit_logs`, `settings` |
| Catalogue | `categories` (department -> category -> subcategory), `brands`, `products` (FULLTEXT index), `product_images`, `product_variants`, `product_tags`, `inventory_logs` |
| Selling | `carts`, `cart_items`, `wishlists`, `stock_alerts`, `coupons`, `coupon_redemptions`, `delivery_zones`, `shipping_rates`, `pickup_slots` |
| Orders | `orders`, `order_items`, `order_status_history`, `payments`, `reviews` |
| Content | `pages`, `banners`, `faqs`, `newsletter_subscribers`, `contact_messages` |

## Security notes

- Passwords hashed with bcrypt (cost 12). Session cookies are `httpOnly`, `secure`, `sameSite=lax`, stored in MySQL,
  and the session id is regenerated on login.
- CSRF protection on every state-changing request (signed double-submit cookie).
- Helmet with a strict Content-Security-Policy: no inline scripts or styles, no third-party scripts.
- Rate limits on login, registration, password reset, contact, checkout, newsletter, reviews and search.
- All input validated with zod; all queries parameterised through Knex; all template output escaped. Rich text from
  the admin editor is sanitised on the server.
- Uploads are limited to 5 MB, checked by MIME type and by file signature, renamed to random names and served with a
  header that prevents script execution.
- Stripe webhooks are verified against the signing secret using the raw request body, and the paid amount is checked
  against the order total.
- PayPal payments are captured server-to-server. The order is marked paid only from PayPal's own capture response,
  after checking it belongs to that order and matches the total and currency.
- Password reset and email verification tokens are stored only as SHA-256 hashes and are single-use.

## Assumptions

1. **bcrypt** is provided by `bcryptjs` (pure JavaScript, same algorithm) because native modules often fail to
   compile on shared hosting. `sharp` is an optional dependency: without it images are stored as uploaded.
2. **Guest carts** live in the database and the session holds the cart id, so guests and customers share one code
   path and abandoned carts can be cleaned up by cron.
3. **Card orders** reserve stock when the customer is sent to Stripe. The Stripe session lasts 60 minutes; unpaid
   orders are cancelled and restocked by the `checkout.session.expired` webhook or by the hourly cron.
4. **Order confirmation emails** for card orders are sent when payment is confirmed, not when the customer leaves
   for Stripe. e-Transfer and pay-in-store orders are confirmed immediately.
5. **Delivery fees are taxed** in proportion to the taxable goods in the order. Confirm this treatment, and the
   taxable flag on each product, with your accountant.
6. **Local delivery** accepts frozen and perishable items; only pickup-only items are excluded. Delivery is limited
   to Ontario addresses inside a defined zone.
7. **Pickup slots** are weekly windows with a per-day capacity. Customers can book up to 7 days ahead and same-day
   slots need 2 hours' notice. Both numbers are in Settings. Times are store time (America/Toronto).
8. **Refunds** are issued by staff in Stripe or by hand; the admin panel records the status and does not move money.
9. **Newsletter** signups are collected and exported as CSV for use in an email marketing tool. The site does not
   send bulk email.
10. **Customer email addresses** cannot be changed by the customer, to keep order history tied to a verified address.
11. **Sample data:** product names include real brands the store is likely to stock, with made-up prices, and
    locally generated placeholder artwork instead of brand photography. The store postal code, phone, email and
    hours are placeholders.
12. **Reviews** can be written once per product by a signed-in customer with a paid or completed order containing
    it, and appear after admin approval.
13. **Rate limits** are held in memory, which suits a single Node.js process. They reset when the app restarts.
14. **PayPal** uses the redirect flow (no PayPal script on the site) and charges the order total as one amount.
    PayPal's own "Pay Later" and card options appear on PayPal's page where the account supports them.
15. **Reminder emails and CASL:** abandoned-cart reminders go only to signed-in customers who subscribed to the
    newsletter or ordered in the last two years, once per cart, with a one-click opt-out. Review requests go only
    to account holders and respect the same opt-out. Order, pickup and payment reminders are transactional.
    Guests are never sent cart reminders.
16. **Unpaid e-Transfer orders** are reminded after 24 hours and are not cancelled automatically unless you set a
    number of hours in Settings.
17. **Low-stock alerts** are sent once, when an order takes an item across its threshold. The daily summary lists
    everything that is still low.
18. **Map:** the home and contact pages embed a Google Maps iframe for the store address, which needs no API key.
