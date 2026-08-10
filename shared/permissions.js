// Organization (TeamSpace) role hierarchy and permission helpers.
// Used by both the backend (REST) and the socket server.

const ORG_ROLES = ["owner", "admin", "manager", "employee"];

const ROLE_LEVELS = {
  owner: 4,
  admin: 3,
  manager: 2,
  employee: 1,
};

// true when `role` is at least `minRole` in the hierarchy
const hasMinRole = (role, minRole) =>
  (ROLE_LEVELS[role] || 0) >= (ROLE_LEVELS[minRole] || 0);

// Matches departments that count as HR ("HR", "Human Resources", "People")
const HR_DEPT_PATTERN = /^(hr|human[ -]?resources|people)$/i;

// True when the user belongs to (or heads) an HR department of the org
const isHrMember = async (orgId, userId) => {
  const Department = require("../models/department");
  const Team = require("../models/team");

  const hrDepts = await Department.find({
    organization: orgId,
    name: { $regex: HR_DEPT_PATTERN },
  }).select("_id head");

  if (hrDepts.length === 0) return false;
  if (
    hrDepts.some((d) => d.head && d.head.toString() === userId.toString())
  ) {
    return true;
  }

  const inHrTeam = await Team.exists({
    organization: orgId,
    department: { $in: hrDepts.map((d) => d._id) },
    members: userId,
  });
  return !!inHrTeam;
};

// Business rule: company-wide notices come from owner/admin/manager or HR
const canPostAnnouncements = async (orgId, membershipRole, userId) => {
  if (hasMinRole(membershipRole, "manager")) return true;
  return isHrMember(orgId, userId);
};

// Conversation access: participants always; org owners/admins may also
// view and post in ANY channel of their organization (oversight access).
const canViewConversation = async (conversation, userId) => {
  if (!conversation) return false;
  const uid = userId.toString();
  const pid = (p) => (p && p._id ? p._id.toString() : p.toString());
  if ((conversation.participants || []).some((p) => pid(p) === uid)) return true;
  if (!conversation.organizationId) return false;

  const OrgMembership = require("../models/orgMembership");
  const membership = await OrgMembership.findOne({
    organization: conversation.organizationId,
    user: userId,
  }).lean();
  return !!membership && hasMinRole(membership.role, "admin");
};

// Channel posting rules:
// - org-wide "announcement" channels: manager+ or HR members
// - team "announcement" channels: manager and above
// - every other conversation: any participant
const canPostToChannel = async (conversation, userId) => {
  if (
    !conversation ||
    conversation.channelType !== "announcement" ||
    !conversation.organizationId
  ) {
    return { allowed: true };
  }

  const OrgMembership = require("../models/orgMembership");
  const membership = await OrgMembership.findOne({
    organization: conversation.organizationId,
    user: userId,
  }).lean();

  if (membership && hasMinRole(membership.role, "manager")) {
    return { allowed: true };
  }

  // Org-wide announcement channels also accept HR members
  if (
    membership &&
    !conversation.teamId &&
    (await isHrMember(conversation.organizationId, userId))
  ) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: "Only managers, admins and HR can post in announcement channels.",
  };
};

module.exports = {
  ORG_ROLES,
  ROLE_LEVELS,
  hasMinRole,
  canPostToChannel,
  canPostAnnouncements,
  canViewConversation,
  isHrMember,
};
