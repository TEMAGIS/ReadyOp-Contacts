# AWS Lambda relay — setup (Console, no CLI needed)

This does the same job as `cloudflare-worker/`, using AWS instead. Since
you already have AWS, and the Console avoids another round of CLI/PATH
troubleshooting, these steps use the AWS Console directly — no AWS CLI or
SAM required.

## 1. Create the function

1. Sign in to the [AWS Console](https://console.aws.amazon.com/) → search
   for **Lambda** → **Create function**.
2. Choose **Author from scratch**.
   - Function name: `readyop-contacts-relay`
   - Runtime: **Node.js 20.x** (or newer — needs the built-in `fetch`,
     which Node 18+ has)
   - Architecture: default (arm64 or x86_64, either is fine)
3. Click **Create function**.

## 2. Add the code

1. In the function's **Code** tab, open `index.mjs` in the built-in editor
   and replace its contents with this project's `aws-lambda/index.mjs`
   (copy/paste the whole file).
2. Click **Deploy** (top of the code editor) to save it.

## 3. Turn on a public URL with CORS

1. Go to the **Configuration** tab → **Function URL** → **Create function
   URL**.
2. Auth type: **NONE** (this endpoint holds no secrets itself — see the
   trust-model note in the main README).
3. Expand **Additional settings** → check **Configure cross-origin
   resource sharing (CORS)** and set:
   - Allow origin: `https://temagis.github.io`
   - Allow methods: `GET`, `POST`
   - Allow headers: `authorization`, `content-type`
   - Max age: `86400`
4. Save.

AWS will show you the Function URL, something like:
```
https://abc123xyz.lambda-url.us-east-1.on.aws/
```

With CORS configured here, AWS answers the browser's OPTIONS preflight
request automatically — your function code never even runs for those, it
only runs for the actual GET/POST calls.

## 4. Wire it into the app

Copy the Function URL into `config.js`:
```js
READYOP_API_BASE_URL: "https://abc123xyz.lambda-url.us-east-1.on.aws",
```
(no trailing slash — the client code appends its own paths).

## 5. Sanity-check it

```bash
curl -i https://abc123xyz.lambda-url.us-east-1.on.aws/api/2013-12-01/Contacts/1/ \
  -H "Origin: https://temagis.github.io" \
  -H "Authorization: Basic dGVzdDp0ZXN0"
```
You should get ReadyOp's own 401 "Account ID and/or Token were missing or
invalid" JSON back — confirms the relay is correctly forwarding to
`tn.readyop.com`, independent of your real credentials.

## Notes

- **Cost**: Lambda's free tier includes 1M requests/month and 400,000
  GB-seconds of compute — this relay will not come close to that for a
  contact-editing tool.
- **Region**: pick whatever region you'd normally use; it doesn't need to
  match anything ReadyOp- or ArcGIS-side.
- **Redeploying after a code change**: edit `index.mjs` in the Console
  again and click **Deploy** — no CLI step required.
- This function, like the Cloudflare version, is a pass-through with no
  authorization of its own beyond the CORS origin check (which only
  browsers honor — it doesn't stop a direct script-to-Lambda request from
  bypassing it). That's an accepted limitation shared with the Cloudflare
  version, consistent with the client-side trust model already chosen for
  this app.
