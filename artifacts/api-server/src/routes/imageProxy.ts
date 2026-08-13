import { Router, type IRouter } from "express";

const router: IRouter = Router();

const ALLOWED_HOSTS = new Set([
  "images.pokemontcg.io",
  "product-images.tcgplayer.com",
  "en.onepiece-cardgame.com",
  "cards.scryfall.io",
]);

router.get("/image-proxy", async (req, res) => {
  const raw = req.query.url;
  if (typeof raw !== "string" || !raw) {
    res.status(400).json({ error: "Missing url query parameter" });
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    res.status(400).json({ error: "Invalid url" });
    return;
  }

  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    res.status(403).json({ error: `Host not allowed: ${parsed.hostname}` });
    return;
  }

  try {
    const upstream = await fetch(raw, {
      headers: {
        "User-Agent": "VerifiedTCG-Proxy/1.0",
        Accept: "image/*",
      },
    });

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: "Upstream error" });
      return;
    }

    const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");

    const buffer = await upstream.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(502).json({ error: "Failed to fetch upstream image" });
  }
});

export default router;
