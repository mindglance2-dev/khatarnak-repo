/**
 * routes/payment.js
 *
 * POST /create-order   â?? create Razorpay order, store pending payment
 * POST /verify-payment â?? verify Razorpay signature, activate subscription
 */

const express      = require("express");
const router       = express.Router();
const Razorpay     = require("razorpay");
const crypto       = require("crypto");
const db           = require("../db/database");
const requireAuth  = require("../middleware/authMiddleware");

// â??â??â?? RAZORPAY INSTANCE â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??
// Created with your secret keys â?? NEVER expose these to frontend
const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_SECRET
});

// ─── COUPON DEFINITIONS (server-side only — never sent to frontend) ───
const COUPONS = {
  'EARLYBIRD25': { discount: 25, active: true },
};

// ─── POST /validate-coupon ─────────────────────────────────────────────
// Body: { code }  → returns { valid, discount } — never reveals the full coupon list
router.post("/validate-coupon", (req, res) => {
  const code = (req.body.code || '').trim().toUpperCase();
  const coupon = COUPONS[code];
  if (coupon && coupon.active) {
    return res.json({ valid: true, discount: coupon.discount });
  }
  return res.json({ valid: false });
});

// ─── PLAN DEFINITIONS (server-side source of truth) ──
// IMPORTANT: Always validate plan amounts on the server.
// Never trust the amount sent from the frontend.
const PLANS = {
  monthly: {
    key:          "monthly",
    label:        "Monthly",
    amountRupees: 299,
    durationDays: 30
  },
  quarterly: {
    key:          "quarterly",
    label:        "Quarterly",
    amountRupees: 799,
    durationDays: 30 * 3 + 14   // 3 months + 14 bonus days = 104 days
  },
  halfyearly: {
    key:          "halfyearly",
    label:        "6 Months",
    amountRupees: 1399,
    durationDays: 30 * 7        // 6 + 1 bonus = 7 months = 210 days
  },
  yearly: {
    key:          "yearly",
    label:        "Yearly",
    amountRupees: 2499,
    durationDays: 30 * 14       // 12 + 2 bonus = 14 months = 420 days
  }
};

// â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??
// POST /create-order
// Creates a Razorpay order and stores it as a pending payment in DB.
// Requires: Authorization header with Google token
// Body: { planKey, userId }
// â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??
router.post("/create-order", requireAuth, async (req, res) => {
  const { planKey, userId, couponCode } = req.body;

  // Validate plan from frontend request (create-order uses frontend planKey — this is OK here)
  const plan = PLANS[planKey];
  if (!plan) {
    return res.status(400).json({ message: 'Invalid plan: ' + planKey });
  }

  // Apply coupon discount server-side
  let finalAmount = plan.amountRupees;
  let appliedCoupon = null;
  if (couponCode) {
    const coupon = COUPONS[(couponCode || '').trim().toUpperCase()];
    if (coupon && coupon.active) {
      finalAmount = Math.round(finalAmount * (1 - coupon.discount / 100));
      appliedCoupon = coupon;
    }
  }

  // Verify user exists in DB â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??
  const userResult = await db.query(
    "SELECT * FROM users WHERE id = $1 AND google_id = $2",
    [userId, req.user.googleId]  // req.user set by requireAuth middleware
  );

  if (userResult.rows.length === 0) {
    return res.status(403).json({ message: "User not found or unauthorized" });
  }

  try {
    // ── Create Razorpay order ─────────────────────────────────
    // Amount must be in paise (1 rupee = 100 paise)
    const razorpayOrder = await razorpay.orders.create({
      amount:   finalAmount * 100,   // Convert rupees → paise
      currency: "INR",
      receipt:  `tl_${userId}_${Date.now()}`,  // Unique reference
      notes: {
        plan_key: plan.key,
        user_id:  String(userId)
      }
    });

    // ── Store pending payment in DB ─────────────────────────
    await db.query(
      `INSERT INTO payments
        (user_id, razorpay_order_id, plan_key, amount, status)
       VALUES ($1, $2, $3, $4, 'created')`,
      [userId, razorpayOrder.id, plan.key, finalAmount]
    );

    console.log(`Order created: ${razorpayOrder.id} for user ${userId}, plan ${plan.key}, amount ₹${finalAmount}`);

    // ── Return order ID and key to frontend ──────────────────
    // We only send the KEY_ID (safe to expose), NOT the secret
    return res.json({
      orderId:      razorpayOrder.id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,  // Key ID is safe to send
      currency:     "INR",
      amount:       finalAmount
    });

  } catch (err) {
    console.error("Razorpay order creation failed:", err);
    return res.status(500).json({ message: "Failed to create payment order" });
  }
});

// â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??
// POST /verify-payment
// Verifies Razorpay payment signature (HMAC-SHA256).
// If valid, activates the subscription.
// Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature, planKey, userId }
// â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??
router.post("/verify-payment", requireAuth, async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    planKey,
    userId
  } = req.body;

  // â??â?? Validate inputs â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ message: "Missing payment verification fields" });
  }

  // SECURITY FIX: Get planKey from DB not from frontend
  // Prevents a user paying ₹299 (monthly) then sending planKey:'yearly' to get 14 months
  let plan;
  try {
    const payRec = await db.query(
      'SELECT plan_key FROM payments WHERE razorpay_order_id = $1',
      [razorpay_order_id]
    );
    if (payRec.rows.length === 0) {
      return res.status(400).json({ message: 'Order not found' });
    }
    plan = PLANS[payRec.rows[0].plan_key];
    if (!plan) {
      return res.status(400).json({ message: 'Invalid plan on record' });
    }
  } catch (err) {
    console.error('Plan DB lookup error:', err);
    return res.status(500).json({ message: 'Could not verify order plan' });
  }

  // Verify signature â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??â??
  // Razorpay signs: order_id + "|" + payment_id using your secret key
  // We must verify this matches the signature Razorpay sends
  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  const isValid = expectedSignature === razorpay_signature;

  if (!isValid) {
    // Signature mismatch â?? could be tampered payment
    console.warn(`âš?ï??  Invalid signature for order: ${razorpay_order_id}`);
    await db.query(
      `UPDATE payments SET status='failed' WHERE razorpay_order_id=$1`,
      [razorpay_order_id]
    );
    return res.status(400).json({ message: "Payment signature verification failed" });
  }

  // â??â?? Signature is valid â?? activate subscription â??â??
  try {
    // Calculate subscription expiry
    const now       = new Date();
    const expiresAt = new Date(now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);

    // Create subscription record
    const subResult = await db.query(
      `INSERT INTO subscriptions
        (user_id, plan_key, plan_label, amount_paid, duration_days, starts_at, expires_at, status)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6, 'active')
       RETURNING *`,
      [userId, plan.key, plan.label, plan.amountRupees, plan.durationDays, expiresAt]
    );

    const subscription = subResult.rows[0];

    // Update payment record to mark as verified/paid
    await db.query(
      `UPDATE payments
       SET status='paid',
           razorpay_payment_id=$1,
           razorpay_signature=$2,
           verified_at=NOW(),
           subscription_id=$3
       WHERE razorpay_order_id=$4`,
      [razorpay_payment_id, razorpay_signature, subscription.id, razorpay_order_id]
    );

    console.log(`âœ? Payment verified! User ${userId} â?? ${plan.label} plan, expires ${expiresAt.toISOString()}`);

    // Format expiry date for display
    const expiresFormatted = expiresAt.toLocaleDateString("en-IN", {
      day:   "2-digit",
      month: "short",
      year:  "numeric"
    });

    return res.json({
      success:   true,
      message:   "Payment verified successfully",
      plan:      plan.label,
      expiresAt: expiresFormatted,
      durationDays: plan.durationDays
    });

  } catch (err) {
    console.error("Subscription creation failed:", err);
    return res.status(500).json({ message: "Payment verified but subscription activation failed. Please contact support." });
  }
});

module.exports = router;
