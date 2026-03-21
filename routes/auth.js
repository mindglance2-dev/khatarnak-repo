/**
 * routes/auth.js
 *
 * POST /auth/google
 *   â†’ Receives a Google ID token from the frontend
 *   â†’ Verifies it with Google
 *   â†’ Creates or finds the user in our database
 *   â†’ Returns user data to frontend
 */

const express    = require("express");
const router     = express.Router();
const { OAuth2Client } = require("google-auth-library");
const db         = require("../db/database");

// Google OAuth client â€” uses your Client ID to verify tokens
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * POST /auth/google
 * Body: { idToken: "..." }
 */
router.post("/google", async (req, res) => {
  const { idToken } = req.body;

  // Validate input
  if (!idToken) {
    return res.status(400).json({ message: "idToken is required" });
  }

  try {
    // â”€â”€ Step 1: Verify token with Google â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // This confirms the token is genuine and not tampered with
    const ticket = await googleClient.verifyIdToken({
      idToken:  idToken,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();

    // Extract user info from verified token
    const googleId = payload.sub;       // Unique Google user ID
    const email    = payload.email;
    const name     = payload.name;
    const picture  = payload.picture || null;

    // â”€â”€ Step 2: Find or create user in our DB â”€â”€â”€â”€â”€
    // Try to find existing user first
    let result = await db.query(
      "SELECT * FROM users WHERE google_id = $1",
      [googleId]
    );

    let user = result.rows[0];

    if (!user) {
      // New user â€” create them
      result = await db.query(
        `INSERT INTO users (google_id, name, email, picture)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [googleId, name, email, picture]
      );
      user = result.rows[0];
      console.log(`New user created: ${email}`);
    } else {
      // Existing user â€” update their name/picture in case it changed
      await db.query(
        `UPDATE users SET name=$1, picture=$2, updated_at=NOW() WHERE id=$3`,
        [name, picture, user.id]
      );
      console.log(`User logged in: ${email}`);
    }

    // â”€â”€ Step 3: Check active subscription â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const subResult = await db.query(
      `SELECT * FROM subscriptions
       WHERE user_id = $1 AND status = 'active' AND expires_at > NOW()
       ORDER BY expires_at DESC LIMIT 1`,
      [user.id]
    );
    const activeSubscription = subResult.rows[0] || null;

    // â”€â”€ Step 4: Return user data to frontend â”€â”€â”€â”€â”€â”€
    return res.json({
      success: true,
      user: {
        id:          user.id,
        name:        user.name,
        email:       user.email,
        picture:     user.picture,
        createdAt:   user.created_at
      },
      subscription: activeSubscription ? {
        plan:      activeSubscription.plan_label,
        expiresAt: activeSubscription.expires_at
      } : null
    });

  } catch (err) {
    console.error("Google auth error:", err);

    // Don't expose internal errors to client
    if (err.message.includes("Token used too late") ||
        err.message.includes("Invalid token")) {
      return res.status(401).json({ message: "Invalid or expired Google token" });
    }

    return res.status(500).json({ message: "Authentication failed" });
  }
});

module.exports = router;
