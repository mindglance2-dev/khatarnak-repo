const express     = require("express");
const router      = express.Router();
const db          = require("../db/database");
const requireAuth = require("../middleware/authMiddleware");

// ── Helper: get user id from googleId ──
async function getUserId(googleId) {
  const result = await db.query(
    "SELECT id FROM users WHERE google_id = $1",
    [googleId]
  );
  return result.rows[0]?.id;
}

// ── GET all trades ──
router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = await getUserId(req.user.googleId);
    const result = await db.query(
      "SELECT * FROM trades WHERE user_id = $1 ORDER BY trade_date DESC",
      [userId]
    );
    res.json({ success: true, trades: result.rows });
  } catch (err) {
    console.error("Get trades error:", err);
    res.status(500).json({ message: "Failed to fetch trades" });
  }
});

// ── POST save trade ──
router.post("/", requireAuth, async (req, res) => {
  const { symbol, type, entry, exit, quantity, pnl, notes, trade_date } = req.body;
  try {
    const userId = await getUserId(req.user.googleId);
    const result = await db.query(
      `INSERT INTO trades (user_id, symbol, type, entry, exit, quantity, pnl, notes, trade_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [userId, symbol, type, entry, exit, quantity, pnl, notes, trade_date]
    );
    res.json({ success: true, trade: result.rows[0] });
  } catch (err) {
    console.error("Save trade error:", err);
    res.status(500).json({ message: "Failed to save trade" });
  }
});
// ── PUT update trade ──
router.put("/:id", requireAuth, async (req, res) => {
  const { 
    symbol, type, entry, exit, 
    quantity, pnl, notes, trade_date 
  } = req.body;
  try {
    const userId = await getUserId(req.user.googleId);
    const result = await db.query(
      `UPDATE trades 
       SET symbol=$1, type=$2, entry=$3, exit=$4,
           quantity=$5, pnl=$6, notes=$7, trade_date=$8
       WHERE id=$9 AND user_id=$10
       RETURNING *`,
      [symbol, type, entry, exit, 
       quantity, pnl, notes, trade_date, 
       req.params.id, userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Trade not found" });
    }
    res.json({ success: true, trade: result.rows[0] });
  } catch (err) {
    console.error("Update trade error:", err);
    res.status(500).json({ message: "Failed to update trade" });
  }
});
// ── DELETE trade ──
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const userId = await getUserId(req.user.googleId);
    await db.query(
      "DELETE FROM trades WHERE id = $1 AND user_id = $2",
      [req.params.id, userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Delete trade error:", err);
    res.status(500).json({ message: "Failed to delete trade" });
  }
});

module.exports = router;
