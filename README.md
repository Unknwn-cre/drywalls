# Gypsos Loutraki — gypsos-loutraki.com

Live (Worker "drywalls"): https://drywalls.unknwn-creation.workers.dev

Static two-language site (Greek at `/`, English at `/en/`) for drywall installation in Loutraki and Corinthia.
Built with the same pattern as the other sites: a Python generator writes plain HTML to `site/`, served by a Cloudflare Worker with static assets.

## Build

```
pip install pillow
python3 src/build.py      # writes site/, checks links and image captions
```

- Texts: `src/pages_el.py`, `src/pages_en.py` (same page keys in both).
- Business details (phone, email, address, name): `CONFIG` block at the top of `src/build.py`.
- Illustrations (own SVGs): `tools/make_ill.py` -> `src/ill/`.
- Photos: `src/photos/*.jpg`, resized to jpg/webp by the build.

## Deploy (Cloudflare)

```
npx wrangler deploy
```

`worker.js` handles `POST /api/lead` and sends each request to every channel that has variables set
(Worker → Settings → Variables and Secrets), same as gutters-toronto:

- **Telegram (simplest):** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
- **Email via resend.com:** `RESEND_API_KEY`, `LEAD_EMAIL_TO` (comma-separated), optional `LEAD_EMAIL_FROM`.
- **Webhook (Zapier, Make, Google Sheets):** `LEAD_WEBHOOK_URL`, gets JSON with all fields.
- **Cloudflare Email Routing:** `LEAD_TO` (a verified destination address), sent through the `send_email` binding `LEAD`.

With no channel set the form reports a failure and offers WhatsApp/Viber/email with the same text.
Set `REDIRECT` to `"on"` in `wrangler.jsonc` once gypsos-loutraki.com is attached, so www/workers.dev redirect to the main host.

## To confirm before launch

- Leads: in Cloudflare, enable Email Routing on gypsos-loutraki.com, verify the owner's inbox as a destination,
  forward info@gypsos-loutraki.com to it, and set the Worker variable `LEAD_TO` to that inbox. The address is kept out of the code.
- Street address and the company's legal name.
- Replace stock photos with the crew's own work when available.

## Photo credits

All photos are from Unsplash under the Unsplash License (free for commercial use, no attribution required).
The site says so on the privacy page. File -> Unsplash photo ID (`https://unsplash.com/photos/<id>`, image `images.unsplash.com/photo-<id>`):

| File | Unsplash ID |
|---|---|
| saloni-kryfos-fotismos | 1662454420647-3d20ddcdb8f8 |
| diadromos-kryfos-fotismos | 1643913592529-9989c485507a |
| kogches-rafia-saloni | 1697457643599-77b5d074121f |
| kogchi-ntous | 1780544241838-7b54189f01b0 |
| diadromos-xenodocheiou | 1631049780150-c197bf723954 |
| stokarisma-armon | 1768839725085-829e6ac7ac26 |
