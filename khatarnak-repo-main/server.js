/**
 * server.js — TradeLog Pro Backend
 *
 * Endpoints:
 *   POST /auth/google      → verify Google ID token, create/find user
 *   POST /create-order     → create Razorpay order
 *   POST /verify-payment   → verify Razorpay signature, store payment, activate plan
 *   GET  /health           → health check
 */

// ─── LOAD ENVIRONMENT VARIABLES ────────────────
require("dotenv").config();

// ─── IMPORTS ───────────────────────────────────
const express    = require("express");
const cors       = require("cors");
const rateLimit  = require("express-rate-limit");
const authRoutes   = require("./routes/auth");
const payRoutes    = require("./routes/payment");
const tradeRoutes  = require("./routes/trades");
const db         = require("./db/database");

const app  = express();
const PORT = process.env.PORT || 5000;

// ─── MIDDLEWARE ─────────────────────────────────
// Allow requests from your frontend domain
// In production, replace "*" with your actual Netlify URL
app.use(cors({
  origin: process.env.FRONTEND_URL || "https://secondjournal.space",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
// Parse JSON request bodies
app.use(express.json());

// ─── RATE LIMITING ──────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // max 20 login attempts per window
  message: { message: "Too many login attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,                  // general API limit
  message: { message: "Too many requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Simple request logger (helpful for debugging)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── ROUTES ─────────────────────────────────────
app.use("/auth",    authLimiter, authRoutes);
app.use("/",        apiLimiter,  payRoutes);
app.use("/trades",  apiLimiter,  tradeRoutes);

// Health check — useful for Railway deployment monitoring
app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// ─── 404 HANDLER ────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// ─── ERROR HANDLER ──────────────────────────────
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ message: "Internal server error" });
});

// ─── START SERVER ───────────────────────────────
async function startServer() {
  try {
    // Initialize database tables
    await db.initTables();
    console.log("✅ Database tables ready");

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`   Health: http://localhost:${PORT}/health`);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
}

startServer();
