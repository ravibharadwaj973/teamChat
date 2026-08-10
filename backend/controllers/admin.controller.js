const User = require("../../models/user");
const Organization = require("../../models/organization");
const OrgMembership = require("../../models/orgMembership");
const Team = require("../../models/team");
const Department = require("../../models/department");
const Conversation = require("../../models/conversation");
const Message = require("../../models/message");
const { ORG_EVENTS } = require("../../shared/constants");
const { ROLE_LEVELS } = require("../../shared/permissions");
const {
  getIO,
  destroyOrganization,
  detachUserFromOrg,
} = require("./organization.controller");

const escapeRegex = (str = "") => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 1️⃣ Platform stats
const getPlatformStats = async (req, res) => {
  try {
    const [users, organizations, memberships, teams, departments, channels, messages] =
      await Promise.all([
        User.countDocuments(),
        Organization.countDocuments(),
        OrgMembership.countDocuments(),
        Team.countDocuments(),
        Department.countDocuments(),
        Conversation.countDocuments({ organizationId: { $ne: null } }),
        Message.countDocuments(),
      ]);

    res.status(200).json({
      success: true,
      data: { users, organizations, memberships, teams, departments, channels, messages },
    });
  } catch (err) {
    console.error("Platform Stats Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch platform stats.",
    });
  }
};

// 2️⃣ List ALL organizations (search + pagination)
const listOrganizations = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const search = (req.query.search || "").trim();

    const query = search
      ? {
          $or: [
            { name: { $regex: escapeRegex(search), $options: "i" } },
            { slug: { $regex: escapeRegex(search), $options: "i" } },
          ],
        }
      : {};

    const [orgs, total] = await Promise.all([
      Organization.find(query)
        .populate("owner", "username email avatar")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Organization.countDocuments(query),
    ]);

    const orgIds = orgs.map((o) => o._id);
    const counts = await OrgMembership.aggregate([
      { $match: { organization: { $in: orgIds } } },
      { $group: { _id: "$organization", count: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((c) => [c._id.toString(), c.count]));

    res.status(200).json({
      success: true,
      page,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      total,
      data: orgs.map((o) => ({
        ...o.toObject(),
        memberCount: countMap.get(o._id.toString()) || 0,
      })),
    });
  } catch (err) {
    console.error("Admin List Orgs Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to list organizations.",
    });
  }
};

// 3️⃣ Members of any organization
const getOrganizationMembers = async (req, res) => {
  try {
    const { orgId } = req.params;

    const organization = await Organization.findById(orgId).select("name slug");
    if (!organization) {
      return res.status(404).json({
        success: false,
        error: "Organization not found.",
      });
    }

    const memberships = await OrgMembership.find({ organization: orgId })
      .populate("user", "username email avatar online lastSeen")
      .sort({ joinedAt: 1 });

    const sorted = memberships.sort(
      (a, b) => (ROLE_LEVELS[b.role] || 0) - (ROLE_LEVELS[a.role] || 0)
    );

    res.status(200).json({
      success: true,
      count: sorted.length,
      data: { organization, members: sorted },
    });
  } catch (err) {
    console.error("Admin Org Members Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch members.",
    });
  }
};

// 4️⃣ Delete ANY organization (super admin)
const adminDeleteOrganization = async (req, res) => {
  try {
    const { orgId } = req.params;

    const organization = await Organization.findById(orgId);
    if (!organization) {
      return res.status(404).json({
        success: false,
        error: "Organization not found.",
      });
    }

    const name = organization.name;
    await destroyOrganization(organization, getIO(req));
    console.log(
      `🛡️ SUPER ADMIN ${req.superAdmin.email} deleted organization "${name}" (${orgId})`
    );

    res.status(200).json({
      success: true,
      message: `Organization "${name}" permanently deleted.`,
    });
  } catch (err) {
    console.error("Admin Delete Org Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to delete organization.",
    });
  }
};

// 5️⃣ Remove ANY member from an organization (super admin)
// Owners cannot be removed — delete the org or transfer ownership instead.
const adminRemoveMember = async (req, res) => {
  try {
    const { orgId, userId } = req.params;

    const organization = await Organization.findById(orgId);
    if (!organization) {
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
      return res.status(404).json({
        success: false,
        error: "Member not found in this organization.",
      });
    }

    if (membership.role === "owner") {
      return res.status(400).json({
        success: false,
        error:
          "The owner cannot be removed. Delete the organization or transfer ownership first.",
      });
    }

    const io = getIO(req);
    await detachUserFromOrg(organization, userId, io);

    const { recordAudit } = require("../lib/audit");
    await recordAudit({
      organization: organization._id,
      actor: req.superAdmin._id,
      action: "member.removed",
      targetUser: userId,
      details: { role: membership.role, bySuperAdmin: true },
    });

    if (io) {
      const payload = {
        organizationId: organization._id,
        userId,
        removedBy: req.superAdmin._id,
        bySuperAdmin: true,
      };
      io.to(`org:${organization._id}`).emit(ORG_EVENTS.MEMBER_REMOVED, payload);
      io.to(`user:${userId}`).emit(ORG_EVENTS.MEMBER_REMOVED, payload);
    }

    console.log(
      `🛡️ SUPER ADMIN ${req.superAdmin.email} removed user ${userId} from "${organization.name}"`
    );

    res.status(200).json({
      success: true,
      message: "Member removed from organization.",
    });
  } catch (err) {
    console.error("Admin Remove Member Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to remove member.",
    });
  }
};

module.exports = {
  getPlatformStats,
  listOrganizations,
  getOrganizationMembers,
  adminDeleteOrganization,
  adminRemoveMember,
};
