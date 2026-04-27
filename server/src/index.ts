import "dotenv/config";
import "express-async-errors";
import express from "express";
import cors from "cors";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { openaiRouter } from "./routes/openai.js";
import { anthropicRouter } from "./routes/anthropic.js";
import { adminRouter } from "./routes/admin.js";
import { oauthAdminRouter, oauthPublicRouter } from "./routes/oauth.js";
import { requireGatewayKey, requireAdminPassword } from "./middleware/auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

// ─── Middleware ────────────────────────────────────────────────────────────────

const corsOrigins = process.env.CORS_ORIGINS ?? "*";
app.use(
  cors({
    origin:
      corsOrigins === "*" ? true : corsOrigins.split(",").map((s) => s.trim()),
    credentials: true,
  }),
);

app.use(express.json({ limit: process.env.MAX_BODY_SIZE ?? "10mb" }));

// ─── Health check ──────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

// ─── API routes ────────────────────────────────────────────────────────────────

// OpenAI-compatible (no anthropic-version header needed)
app.use("/v1", requireGatewayKey, openaiRouter);

// Anthropic-compatible (clients that set anthropic-version header)
// Also mounted at /anthropic/v1 for explicit targeting
app.use("/anthropic/v1", requireGatewayKey, anthropicRouter);

// Admin API (protected by admin password)
app.use("/api/oauth", requireAdminPassword, oauthAdminRouter);
app.use("/api", requireAdminPassword, adminRouter);

// OAuth callback routes cannot require custom headers because providers redirect here.
app.use("/oauth", oauthPublicRouter);
app.use("/", oauthPublicRouter);

// Chrome extension CORS-free cookie push endpoint
app.post("/ext/cookies/:providerId", (req, res) => {
  // Extension uses its own simple token from env
  const token = req.headers["x-extension-token"] as string | undefined;
  const extToken = process.env.EXTENSION_TOKEN ?? "ext-token-change-me";
  if (token !== extToken) {
    res.status(401).json({ error: "Invalid extension token" });
    return;
  }
  // Delegate to admin route handler logic inline
  const { cookies } = req.body as { cookies: Record<string, string> };
  if (!cookies) {
    res.status(400).json({ error: "cookies required" });
    return;
  }

  // Dynamic import to avoid circular — just use db directly
  import("./db/index.js").then(({ db }) => {
    const p = db
      .prepare("SELECT id FROM providers WHERE id = ?")
      .get(req.params.providerId);
    if (!p) {
      res.status(404).json({ error: "Provider not found" });
      return;
    }
    db.prepare(
      "UPDATE providers SET cookies = ?, updated_at = ? WHERE id = ?",
    ).run(JSON.stringify(cookies), Date.now(), req.params.providerId);
    res.json({ ok: true });
  });
});

// ─── Static dashboard ─────────────────────────────────────────────────────────

const dashboardDist = join(__dirname, "../../dashboard/dist");
app.use(express.static(dashboardDist));
app.get("*", (_req, res) => {
  res.sendFile(join(dashboardDist, "index.html"), (err) => {
    if (err)
      res
        .status(200)
        .send("AI Gateway is running. Build the dashboard to serve the UI.");
  });
});

// ─── Error handler ────────────────────────────────────────────────────────────

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("[Gateway Error]", err.message);
    res
      .status(500)
      .json({ error: { message: err.message, type: "internal_error" } });
  },
);

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, HOST, () => {
  console.log(`
  Server  : http://${HOST}:${PORT}
  Dashboard: http://localhost:${PORT}
  OpenAI  : /v1/chat/completions
  Anthropic: /anthropic/v1/messages
  Admin   : /api (x-admin-password)
  `);
});

export default app;
