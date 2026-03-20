/**
 * routes/trades.js
 * GET    /trades       → get all trades for logged-in user
 * POST   /trades       → save a new trade
 * DELETE /trades/:id   → delete a trade
 */

const express     = require("express");
const router      = express.Router();
const db          = require("../db/database");
const requireAuth = require("../middleware/authMiddleware");

// ── GET all trades ──────────────────────────────
router.get("/", requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM trades WHERE user_id = $1 ORDER BY trade_date DESC`,
      [req.user.userId]
    );
    res.json({ success: true, trades: result.rows });
  } catch (err) {
    console.error("Get trades error:", err);
    res.status(500).json({ message: "Failed to fetch trades" });
  }
});

// ── POST save a trade ───────────────────────────
router.post("/", requireAuth, async (req, res) => {
  const { symbol, type, entry, exit, quantity, pnl, notes, trade_date } = req.body;

  try {
    const result = await db.query(
      `INSERT INTO trades (user_id, symbol, type, entry, exit, quantity, pnl, notes, trade_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user.userId, symbol, type, entry, exit, quantity, pnl, notes, trade_date]
    );
    res.json({ success: true, trade: result.rows[0] });
  } catch (err) {
    console.error("Save trade error:", err);
    res.status(500).json({ message: "Failed to save trade" });
  }
});

// ── DELETE a trade ──────────────────────────────
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    await db.query(
      `DELETE FROM trades WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Delete trade error:", err);
    res.status(500).json({ message: "Failed to delete trade" });
  }
});

module.exports = router;
