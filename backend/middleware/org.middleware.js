const Organization = require("../../models/organization");
const OrgMembership = require("../../models/orgMembership");
const { hasMinRole } = require("../../shared/permissions");

// Loads the organization (:orgId) and the requester's membership.
// Attaches req.organization and req.orgMembership.
const requireOrgMember = async (req, res, next) => {
  try {
    const { orgId } = req.params;
    const userId = req.user.id;

    const organization = await Organization.findById(orgId);
    if (!organization || !organization.isActive) {
      return res.status(404).json({
        success: false,
        error: "Organization not found.",
      });
    }

    const membership = await OrgMembership.findOne({
      organization: orgId,
      user: userId,
    });

    if (!membership) {
      return res.status(403).json({
        success: false,
        error: "You are not a member of this organization.",
      });
    }

    req.organization = organization;
    req.orgMembership = membership;
    next();
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(400).json({
        success: false,
        error: "Invalid organization ID.",
      });
    }
    console.error("Org Middleware Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to verify organization access.",
    });
  }
};

// Requires a minimum org role. Must run after requireOrgMember.
const requireOrgRole = (minRole) => (req, res, next) => {
  if (!req.orgMembership || !hasMinRole(req.orgMembership.role, minRole)) {
    return res.status(403).json({
      success: false,
      error: `This action requires ${minRole} access or higher.`,
    });
  }
  next();
};

module.exports = { requireOrgMember, requireOrgRole };
