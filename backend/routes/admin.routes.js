const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth.middleware");
const { requireSuperAdmin } = require("../middleware/admin.middleware");
const {
  getPlatformStats,
  listOrganizations,
  getOrganizationMembers,
  adminDeleteOrganization,
  adminRemoveMember,
} = require("../controllers/admin.controller");

// Every admin API requires an authenticated super admin
router.use(authenticate, requireSuperAdmin);

router.get("/stats", getPlatformStats);
router.get("/organizations", listOrganizations);
router.get("/organizations/:orgId/members", getOrganizationMembers);
router.delete("/organizations/:orgId", adminDeleteOrganization);
router.delete("/organizations/:orgId/members/:userId", adminRemoveMember);

module.exports = router;
