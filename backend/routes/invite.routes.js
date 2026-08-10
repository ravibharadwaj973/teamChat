const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth.middleware");
const {
  getInvite,
  acceptInvite,
  declineInvite,
} = require("../controllers/invite.controller");

// Public: invite landing-page info (org name, role, masked email)
router.get("/:token", getInvite);

// Authenticated: the logged-in user's email must match the invite
router.post("/:token/accept", authenticate, acceptInvite);
router.post("/:token/decline", authenticate, declineInvite);

module.exports = router;
