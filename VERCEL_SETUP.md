# Order Dashboard Setup on Vercel

The storefront uses a Vercel serverless API and MongoDB Atlas so orders submitted by customers on different devices appear in the same admin dashboard.

The `mongorestore`, `mongodump`, `mongostat`, `mongotop`, `mongoimport`, and `mongoexport` commands are database maintenance tools. They do not connect the running Vercel website. The website connects through the MongoDB Node.js driver using the `MONGODB_URI` environment variable.

1. Create an Atlas cluster and a database user with read/write access to the orders database.
2. In Atlas Network Access, allow connections from your Vercel deployment. For a quick setup, Atlas can allow `0.0.0.0/0`; use a strong database-user password and a restricted database role. If your Vercel plan supports static egress, allowlist those IP addresses instead.
3. In Vercel Project Settings > Environment Variables, add `MONGODB_URI` with the URI for `kapiafarmcafe.jhkz1ol.mongodb.net`. Replace `REPLACE_WITH_URL_ENCODED_PASSWORD` in `.env.example` with the password for `nathaniel100ramirez_db_user`. Do not include the angle brackets from the earlier `<PASSWORD>` placeholder. If the password contains characters such as `@`, `:`, `/`, `?`, `#`, `[`, `]`, or `$`, URL-encode those characters before using it in the URI. Enter the completed URI directly into Vercel; do not commit it to source control.
4. Optionally set `MONGODB_DB_NAME` to `kapia_farm_cafe`. Set both variables for Production (and Preview if you test preview deployments).
5. The admin password defaults to `kapiaadmin`; you can override it with `ADMIN_PASSWORD` in Vercel. Use a private value for a public production site.
6. Redeploy the Vercel project after adding or changing environment variables. MongoDB creates the `orders` collection when the first order is placed. The API code already reads `MONGODB_URI`; no connection string needs to be added to the HTML or JavaScript files.
7. Open `/admin.html` and sign in. The dashboard opens on Orders. New orders begin as `Awaiting Payment`; customer payment reports become `Payment Reported`. Use **Confirm payment** only after you verify payment in your payment provider.

The API is served from the same Vercel project at `/api/orders` and `/api/admin-login`. The admin login token expires after eight hours. If `MONGODB_URI` is missing or invalid, order submission displays an error instead of silently saving only in the customer's browser.

Orders submitted before this API is deployed remain in the browser that submitted them. Orders from other customers' browsers cannot be recovered; new orders submitted after deployment will be shared with the admin dashboard.
