/**
 * middleware/authMiddleware.js
 *
 * Protects routes that require a logged-in user.
 * Verifies the Google ID token sent in the Authorization header.
 *
 * Usage in routes:
 *   router.post("/create-order", requireAuth, handler);
 */

const { OAuth2Client } = require("google-auth-library");

// Create Google OAuth client with your Client ID
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * Express middleware that checks for a valid Google token.
 * Attaches the verified user payload to req.user if valid.
 */
async function requireAuth(req, res, next) {
  // Get token from "Authorization: Bearer <token>" header
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();

  if (!token) {
    return res.status(401).json({ message: "No authentication token provided" });
  }

  try {
    // Verify the Google ID token
    const ticket = await googleClient.verifyIdToken({
      idToken:  token,
      audience: process.env.GOOGLE_CLIENT_ID  // Must match what Google gave you
    });

    const payload = ticket.getPayload();

    // Attach user info to request for use in route handlers
    req.user = {
      googleId: payload.sub,       // Google's unique user ID
      email:    payload.email,
      name:     payload.name,
      picture:  payload.picture
    };

    next();  // Proceed to the route handler

  } catch (err) {
    console.error("Token verification failed:", err.message);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

module.exports = requireAuth;
