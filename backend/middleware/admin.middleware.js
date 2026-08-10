const User = require("../../models/user");

// Emails granted super-admin without the DB flag (comma-separated env)
const superAdminEmails = () =>
  (process.env.SUPER_ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const isSuperAdminUser = (user) =>
  !!user &&
  (user.isSuperAdmin === true ||
    superAdminEmails().includes((user.email || "").toLowerCase()));

// Platform-level guard. Runs after authenticate.
const requireSuperAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select("email isSuperAdmin username");
    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Account not found.",
      });
    }

    if (!isSuperAdminUser(user)) {
      return res.status(403).json({
        success: false,
        error: "Super admin access required.",
      });
    }

    req.superAdmin = user;
    next();
  } catch (err) {
    console.error("Super Admin Middleware Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to verify admin access.",
    });
  }
};

module.exports = { requireSuperAdmin, isSuperAdminUser };
