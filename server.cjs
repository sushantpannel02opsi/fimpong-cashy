// server.cjs
const express = require("express");
const cors = require("cors");
const path = require("path");
const { chromium } = require("playwright");

const app = express();
const PORT = process.env.PORT || 3000;

// --------------------
// Middleware
// --------------------
app.use(cors());
app.use(express.json());

// Serve static files (contact-pay.html, images, etc.) from the same folder as server.cjs
app.use(express.static(__dirname));

// Optional: health check for Railway
app.get("/health", (req, res) => {
  res.status(200).send("ok");
});

// --------------------
// Helpers
// --------------------
function normalizeUrl(u) {
  if (!u) return null;
  let url = String(u).trim();
  if (url.startsWith("//")) url = "https:" + url;
  return url;
}

// --------------------
// Proxy Image (TikTok hotlink bypass)
// --------------------
app.get("/proxy-image", async (req, res) => {
  try {
    let imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).send("Missing url");

    imageUrl = normalizeUrl(imageUrl);

    const r = await fetch(imageUrl, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        referer: "https://www.tiktok.com/",
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
      redirect: "follow",
    });

    if (!r.ok) {
      console.error("proxy-image failed:", imageUrl, r.status);
      return res.status(502).send(`proxy failed: ${r.status}`);
    }

    const contentType = r.headers.get("content-type") || "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");

    const arrayBuffer = await r.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (e) {
    console.error("proxy-image error:", e);
    res.status(500).send("proxy error");
  }
});

// --------------------
// TikTok (Playwright)
// --------------------
app.get("/tiktok", async (req, res) => {
  let user = (req.query.user || "").toString().trim();
  if (!user) return res.status(400).json({ error: "Missing username" });

  user = user.replace(/^@/, "");
  const profileUrl = `https://www.tiktok.com/@${user}?lang=en`;

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      locale: "en-US",
    });

    await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 45000 });

    // 1) Try og:image meta
    let avatar = await page
      .locator('meta[property="og:image"]')
      .getAttribute("content")
      .catch(() => null);

    // 2) Fallback: scan page HTML for avatar fields
    if (!avatar) {
      const html = await page.content();
      const m =
        html.match(/"avatarLarger":"([^"]+)"/) ||
        html.match(/"avatarMedium":"([^"]+)"/) ||
        html.match(/"avatarThumb":"([^"]+)"/);
      if (m) avatar = m[1];
    }

    if (avatar) {
      avatar = avatar
        .replace(/\\u002F/g, "/")
        .replace(/\\u0026/g, "&")
        .replace(/\\\//g, "/");

      avatar = normalizeUrl(avatar);

      return res.json({
        name: user,
        avatar: `/proxy-image?url=${encodeURIComponent(avatar)}`,
        blocked: false,
      });
    }

    return res.json({ name: user, avatar: null, blocked: true });
  } catch (e) {
    console.error("TikTok Playwright error:", e);
    return res.status(500).json({ error: "TikTok fetch failed", details: String(e) });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

// --------------------
// Cash (safe - no scraping)
// --------------------
app.get("/cash", (req, res) => {
  let tag = (req.query.tag || "").toString().trim();
  if (!tag) return res.status(400).json({ error: "Missing tag" });

  if (!tag.startsWith("$")) tag = "$" + tag;
  const name = tag.replace(/^\$/, "");

  res.json({ name, avatar: null });
});

// --------------------
// Start server (Railway friendly)
// --------------------
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Try: /health`);
  console.log(`Try: /tiktok?user=@tiktok`);
});
