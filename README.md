# Pixel Wall (Ko-fi edition)

One million pixels. One pixel per person. One euro each. Permanent. Powered by Ko-fi.

## Why Ko-fi

Ko-fi is the merchant of record. You do not need a KvK or business account. You sign up as a creator, link your bank, and Ko-fi handles all payment processing. Buyers pay €1 with iDEAL or card; Ko-fi sends the money to your bank weekly.

## How it works

1. User clicks an empty pixel and picks a color.
2. The server creates a reservation with a short token like `PXL-A7K3MN5Q` (valid for 30 minutes).
3. A modal shows the token and an "Open Ko-fi to pay" button.
4. The user pays €1 on Ko-fi and pastes the token into the message field.
5. Ko-fi sends a webhook to our server with the message.
6. The server matches the token to the reservation and places the pixel.
7. The original tab polls and shows the pixel as placed.

## Stack

- Node.js + Express server
- SQLite database (single file)
- Ko-fi for payments via webhook
- Static HTML, CSS, JavaScript frontend
- No build step

## File structure

```
pixel-wall-kofi/
├── server.js           Express server with reservation system + Ko-fi webhook
├── package.json
├── .env.example
├── public/
│   ├── index.html      Landing page with payment modal
│   ├── style.css
│   └── app.js          Canvas, zoom, modal-based payment flow
└── data/
    └── pixels.db       SQLite db, created on first run
```

## Setup

### 1. Create your Ko-fi page

If you don't have one yet:
1. Sign up at https://ko-fi.com
2. Note your page username (the part after ko-fi.com/, e.g., `matthewj`)
3. Connect your bank account in Ko-fi settings → Payouts

### 2. Configure the Ko-fi webhook

1. Go to https://ko-fi.com/manage/webhooks
2. Set the webhook URL to: `https://your-domain.com/api/webhook/kofi`
3. Copy the verification token shown on that page

### 3. Local setup

1. Install Node.js 20 or higher.
2. In this folder:
   ```
   npm install
   ```
3. Copy `.env.example` to `.env`:
   ```
   cp .env.example .env
   ```
4. Edit `.env` and fill in:
   - `KOFI_USERNAME` (your Ko-fi page username)
   - `KOFI_VERIFICATION_TOKEN` (from step 2)
5. Start the server:
   ```
   npm start
   ```
6. Open http://localhost:3000

For local Ko-fi webhook testing, use ngrok:
```
ngrok http 3000
```
Set `BASE_URL` in `.env` to the ngrok URL, then update the Ko-fi webhook URL to point to that ngrok URL plus `/api/webhook/kofi`.

## Deploying

### Railway (easiest)

1. Push this folder to GitHub.
2. Connect the repo in Railway.
3. Add a persistent volume mounted at `/data`.
4. Set environment variables: `KOFI_USERNAME`, `KOFI_VERIFICATION_TOKEN`, `BASE_URL`, `DB_PATH=/data/pixels.db`.
5. After deploy, update the Ko-fi webhook URL to point to `https://your-app.up.railway.app/api/webhook/kofi`.

### Fly.io

1. `fly launch` then `fly volumes create pixel_data --size 1`.
2. Mount in `fly.toml`:
   ```
   [mounts]
     source = "pixel_data"
     destination = "/data"
   ```
3. `fly secrets set KOFI_USERNAME=... KOFI_VERIFICATION_TOKEN=... BASE_URL=https://your-app.fly.dev DB_PATH=/data/pixels.db`
4. `fly deploy`

### VPS

Standard Node.js deployment. PM2 + nginx + Let's Encrypt.

## Costs

- Hosting: about €5 per month
- Ko-fi platform fee: 0% on the free tier
- Stripe processing fees (Ko-fi uses Stripe under the hood):
  - iDEAL: about €0.27 per transaction
  - Card: about 2.9% + €0.25
- Net per pixel via iDEAL: roughly €0.73

## Important Ko-fi limitations

- Ko-fi is the merchant. Money goes to Ko-fi first and is paid out to your bank weekly.
- Ko-fi takes 0% on the free tier but Stripe still charges processing fees.
- The "message" field on Ko-fi donations is optional. If a buyer forgets to paste the token, you'll get the money but no pixel will be placed automatically. Refund manually via Ko-fi or place the pixel by hand.
- Ko-fi is in English by default. Buyers see a Ko-fi-branded payment page, not your site.

## Testing the webhook locally

Ko-fi has a "Send a test webhook" button on the webhooks page. After running ngrok and updating the URL, click it. You should see `[kofi] no token found in message` in your server logs (because the test webhook has an empty message). That confirms the webhook is reaching your server and the verification token is correct.

For end-to-end testing, you have to make a real €1 donation to your own page with a valid `PXL-XXXXXXXX` token in the message. Ko-fi has no proper test mode like Mollie does.

## Going public

1. Add Terms of Service and Refund Policy linked from the footer (Ko-fi may require this).
2. Set up daily backups of `data/pixels.db`.
3. Consider adding a "report this pixel" link for moderation if your wall goes viral.

## Using Claude Code to deploy

This codebase is designed to be deployed by Claude Code. After unzipping:

```
cd pixel-wall-kofi
claude
```

Then paste this prompt into Claude Code:

> I want to deploy the Pixel Wall (Ko-fi edition) to production. The code is already in this folder. Walk me through:
> 1. Installing dependencies and testing locally with ngrok
> 2. Setting up the Ko-fi webhook
> 3. Deploying to Railway with a persistent volume
> 4. Updating the production webhook URL
> Ask me for any information you need (Ko-fi username, verification token, Railway tokens, domain name) one step at a time.

Claude Code will handle: `npm install`, ngrok setup, Git repo + GitHub push, Railway deploy, environment variable configuration, webhook URL update, and a final smoke test.

What it cannot do for you:
- Create your Ko-fi account (you do this once)
- Configure the Ko-fi webhook (you click through their UI once)
- Buy a domain (you choose and pay)
- Bank verification on Ko-fi (you submit your own ID)

Total time from zero to live: about 2 to 4 hours of mostly clicking, plus 1 to 2 days for Ko-fi to verify your bank account before payouts work.

## License

Yours.
