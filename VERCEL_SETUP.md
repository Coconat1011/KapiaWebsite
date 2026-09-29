# Order Dashboard Setup on Vercel

The storefront is static, so orders need a hosted database to be visible across customers' devices. This project uses a Vercel serverless API and Neon Postgres.

1. Create or connect a Neon Postgres database to the Vercel project. Copy its connection string as `DATABASE_URL`.
2. In Vercel Project Settings > Environment Variables, add `DATABASE_URL` for Production (and Preview if you use preview deployments). The admin password defaults to `kapiaadmin`; you can override it with `ADMIN_PASSWORD` in Vercel.
3. Redeploy the project. The API creates its `kapia_orders` table on the first request.
4. Open `/admin.html`, sign in using `ADMIN_PASSWORD`, then open the Orders tab. New customer orders begin as `Awaiting Payment`; a customer's payment report appears as `Payment Reported`. Use **Confirm payment** only after you verify payment in your payment provider.

The API is served from the same Vercel project at `/api/orders` and `/api/admin-login`. The admin login token expires after eight hours. If `DATABASE_URL` is missing or invalid, order submission reports an error instead of silently saving only in the customer's browser.

Orders submitted before this API is deployed remain in the browser that submitted them. Orders from other customers' browsers cannot be recovered; new orders submitted after deployment will be shared with the admin dashboard.
