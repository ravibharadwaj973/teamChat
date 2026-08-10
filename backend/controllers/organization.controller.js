const crypto = require("crypto");
const Organization = require("../../models/organization");
const OrgMembership = require("../../models/orgMembership");
const OrgInvite = require("../../models/orgInvite");
const Team = require("../../models/team");
const Department = require("../../models/department");
const Conversation = require("../../models/conversation");
const Message = require("../../models/message");
const { ORG_EVENTS } = require("../../shared/constants");
const { ROLE_LEVELS, hasMinRole } = require("../../shared/permissions");
const { recordAudit } = require("../lib/audit");

const escapeRegex = (str = "") => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------- helpers ----------

const getIO = (req) => {
  const socketServer = req.app.get("socketServer");
  return socketServer ? socketServer.io : null;
};

// Normalizes an industry value ("technology" -> "TECHNOLOGY").
// Returns { ok, value } — ok=false when the value isn't a valid industry.
const normalizeIndustry = (industry) => {
  if (industry === undefined || industry === null || industry === "") {
    return { ok: true, value: null };
  }
  const value = String(industry).trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!Organization.INDUSTRIES.includes(value)) {
    return { ok: false, value: null };
  }
  return { ok: true, value };
};

const slugify = (name) =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 40) || "org";

const generateUniqueSlug = async (name) => {
  const base = slugify(name);
  let slug = base;
  while (await Organization.exists({ slug })) {
    slug = `${base}-${crypto.randomBytes(3).toString("hex")}`;
  }
  return slug;
};

// Creates a default org channel by reusing the group-conversation pipeline
const createOrgChannel = async ({
  orgId,
  name,
  channelType,
  adminId,
  participants,
}) => {
  const conversation = await Conversation.create({
    participants,
    isGroup: true,
    groupName: name,
    groupAdmin: adminId,
    organizationId: orgId,
    channelType,
    isDefault: true,
    unreadCount: {},
  });

  participants.forEach((id) => {
    conversation.unreadCount.set(id.toString(), 0);
  });
  await conversation.save();

  return conversation;
};

// Removes a user from every org structure: teams, channels, membership, rooms.
// Shared by removeMember and leaveOrganization.
const detachUserFromOrg = async (organization, userId, io) => {
  const orgId = organization._id;
  const roomsToLeave = [`org:${orgId}`];

  // 1. Teams (member or manager)
  const teams = await Team.find({
    organization: orgId,
    $or: [{ members: userId }, { manager: userId }],
  });

  for (const team of teams) {
    team.members = team.members.filter(
      (m) => m.toString() !== userId.toString()
    );
    if (team.manager && team.manager.toString() === userId.toString()) {
      team.manager = null;
    }
    await team.save();
    roomsToLeave.push(`team:${team._id}`);
  }

  // 2. Org channels (incl. team channels)
  const channels = await Conversation.find({
    organizationId: orgId,
    participants: userId,
  });

  for (const channel of channels) {
    channel.participants = channel.participants.filter(
      (p) => p.toString() !== userId.toString()
    );
    channel.unreadCount.delete(userId.toString());
    if (channel.groupAdmin && channel.groupAdmin.toString() === userId.toString()) {
      channel.groupAdmin = organization.owner;
    }
    await channel.save();
  }

  // 3. Their assigned work goes with them
  const Task = require("../../models/task");
  await Task.deleteMany({ organization: orgId, assignee: userId });

  // 4. Membership
  await OrgMembership.deleteOne({ organization: orgId, user: userId });

  // 4. Socket rooms
  if (io) {
    io.in(`user:${userId}`).socketsLeave(roomsToLeave);
  }
};

// ---------- controllers ----------

// 1️⃣ Create Organization — creator automatically becomes OWNER
const createOrganization = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, description = "", industry = null, size, logo = null } =
      req.body;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: "Organization name must be at least 2 characters.",
      });
    }

    const industryCheck = normalizeIndustry(industry);
    if (!industryCheck.ok) {
      return res.status(400).json({
        success: false,
        error: `Invalid industry. Valid values: ${Organization.INDUSTRIES.join(", ")}`,
      });
    }

    const slug = await generateUniqueSlug(name);

    const organization = await Organization.create({
      name: name.trim(),
      slug,
      description,
      industry: industryCheck.value,
      ...(size ? { size } : {}),
      logo,
      owner: userId,
    });

    // Creator automatically becomes OWNER
    const membership = await OrgMembership.create({
      organization: organization._id,
      user: userId,
      role: "owner",
    });

    // Default channels: #general (everyone) + #announcements (manager+ can post)
    const general = await createOrgChannel({
      orgId: organization._id,
      name: "general",
      channelType: "general",
      adminId: userId,
      participants: [userId],
    });
    const announcements = await createOrgChannel({
      orgId: organization._id,
      name: "announcements",
      channelType: "announcement",
      adminId: userId,
      participants: [userId],
    });

    await recordAudit({
      organization: organization._id,
      actor: userId,
      action: "org.created",
      targetLabel: organization.name,
    });

    const io = getIO(req);
    if (io) {
      // Join the creator's connected sockets to the org room
      io.in(`user:${userId}`).socketsJoin(`org:${organization._id}`);
      io.to(`user:${userId}`).emit(ORG_EVENTS.ORG_CREATED, {
        organization,
        membership,
      });
    }

    res.status(201).json({
      success: true,
      message: "Organization created. You are the owner.",
      data: {
        organization,
        membership,
        defaultChannels: [general, announcements],
      },
    });
  } catch (err) {
    console.error("Create Organization Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to create organization.",
    });
  }
};

// 2️⃣ Get My Organizations
const getMyOrganizations = async (req, res) => {
  try {
    const userId = req.user.id;

    const memberships = await OrgMembership.find({ user: userId })
      .populate(
        "organization",
        "name slug description logo industry size owner isActive createdAt"
      )
      .sort({ joinedAt: -1 });

    const active = memberships.filter(
      (m) => m.organization && m.organization.isActive
    );
    const orgIds = active.map((m) => m.organization._id);

    const counts = await OrgMembership.aggregate([
      { $match: { organization: { $in: orgIds } } },
      { $group: { _id: "$organization", count: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((c) => [c._id.toString(), c.count]));

    const data = active.map((m) => ({
      organization: m.organization,
      role: m.role,
      jobTitle: m.jobTitle,
      department: m.department,
      joinedAt: m.joinedAt,
      memberCount: countMap.get(m.organization._id.toString()) || 0,
    }));

    res.status(200).json({
      success: true,
      count: data.length,
      data,
    });
  } catch (err) {
    console.error("Get My Organizations Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch organizations.",
    });
  }
};

// 3️⃣ Get Organization by ID
const getOrganizationById = async (req, res) => {
  try {
    const organization = req.organization;

    const [memberCount, teamCount, departmentCount] = await Promise.all([
      OrgMembership.countDocuments({ organization: organization._id }),
      Team.countDocuments({ organization: organization._id }),
      Department.countDocuments({ organization: organization._id }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        organization,
        myMembership: req.orgMembership,
        memberCount,
        teamCount,
        departmentCount,
      },
    });
  } catch (err) {
    console.error("Get Organization Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch organization.",
    });
  }
};

// 4️⃣ Update Organization (admin+)
const updateOrganization = async (req, res) => {
  try {
    const organization = req.organization;
    const { name, description, logo, industry, size, settings } = req.body;

    if (name !== undefined) {
      if (!name || name.trim().length < 2) {
        return res.status(400).json({
          success: false,
          error: "Organization name must be at least 2 characters.",
        });
      }
      organization.name = name.trim();
    }
    if (description !== undefined) organization.description = description;
    if (logo !== undefined) organization.logo = logo;
    if (industry !== undefined) {
      const industryCheck = normalizeIndustry(industry);
      if (!industryCheck.ok) {
        return res.status(400).json({
          success: false,
          error: `Invalid industry. Valid values: ${Organization.INDUSTRIES.join(", ")}`,
        });
      }
      organization.industry = industryCheck.value;
    }
    if (size !== undefined) organization.size = size;
    if (settings && settings.allowMemberInvites !== undefined) {
      organization.settings.allowMemberInvites = !!settings.allowMemberInvites;
    }

    await organization.save();

    await recordAudit({
      organization: organization._id,
      actor: req.user.id,
      action: "org.updated",
      targetLabel: organization.name,
    });

    const io = getIO(req);
    if (io) {
      io.to(`org:${organization._id}`).emit(ORG_EVENTS.ORG_UPDATED, {
        organizationId: organization._id,
        organization,
      });
    }

    res.status(200).json({
      success: true,
      message: "Organization updated.",
      data: organization,
    });
  } catch (err) {
    console.error("Update Organization Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to update organization.",
    });
  }
};

// Destroys an organization and every piece of its data.
// Shared by the owner route and the super-admin API.
const destroyOrganization = async (organization, io) => {
  const orgId = organization._id;

  const channels = await Conversation.find({ organizationId: orgId }).select(
    "_id"
  );
  const channelIds = channels.map((c) => c._id);

  await Message.deleteMany({ conversationId: { $in: channelIds } });
  await Conversation.deleteMany({ organizationId: orgId });
  await Team.deleteMany({ organization: orgId });
  await Department.deleteMany({ organization: orgId });
  await OrgInvite.deleteMany({ organization: orgId });
  await OrgMembership.deleteMany({ organization: orgId });
  const Announcement = require("../../models/announcement");
  await Announcement.deleteMany({ organization: orgId });
  const Task = require("../../models/task");
  await Task.deleteMany({ organization: orgId });
  const Event = require("../../models/event");
  await Event.deleteMany({ organization: orgId });
  const AuditLog = require("../../models/auditLog");
  await AuditLog.deleteMany({ organization: orgId });
  // Shared files: remove Cloudinary assets + docs (lazy require avoids a cycle)
  const { destroyFilesByQuery } = require("./file.controller");
  await destroyFilesByQuery({ organization: orgId });
  await organization.deleteOne();

  if (io) {
    io.to(`org:${orgId}`).emit(ORG_EVENTS.ORG_DELETED, {
      organizationId: orgId,
    });
    io.in(`org:${orgId}`).socketsLeave(`org:${orgId}`);
  }
};

// 5️⃣ Delete Organization (owner only)
const deleteOrganization = async (req, res) => {
  try {
    await destroyOrganization(req.organization, getIO(req));

    res.status(200).json({
      success: true,
      message: "Organization permanently deleted.",
    });
  } catch (err) {
    console.error("Delete Organization Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to delete organization.",
    });
  }
};

// 6️⃣ Get Members
const getMembers = async (req, res) => {
  try {
    const memberships = await OrgMembership.find({
      organization: req.organization._id,
    })
      .populate("user", "username email avatar status online lastSeen")
      .populate("invitedBy", "username");

    // Sort by role hierarchy (owner first), then join date
    const sorted = memberships.sort((a, b) => {
      const diff = (ROLE_LEVELS[b.role] || 0) - (ROLE_LEVELS[a.role] || 0);
      return diff !== 0 ? diff : a.joinedAt - b.joinedAt;
    });

    res.status(200).json({
      success: true,
      count: sorted.length,
      data: sorted,
    });
  } catch (err) {
    console.error("Get Members Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch members.",
    });
  }
};

// 6️⃣b Employee directory — search by name/email/job title,
//     filter by department, team or role. Any member can browse.
const getDirectory = async (req, res) => {
  try {
    const orgId = req.organization._id;
    const { q = "", departmentId, teamId, role } = req.query;

    const [memberships, teams] = await Promise.all([
      OrgMembership.find({ organization: orgId }).populate(
        "user",
        "username email avatar online lastSeen"
      ),
      Team.find({ organization: orgId })
        .populate("department", "name")
        .select("name members manager department"),
    ]);

    // userId -> the teams (and their departments) that person belongs to
    const teamsByUser = new Map();
    const push = (uid, team, isManager) => {
      const key = uid.toString();
      if (!teamsByUser.has(key)) teamsByUser.set(key, []);
      if (teamsByUser.get(key).some((t) => t._id.toString() === team._id.toString()))
        return;
      teamsByUser.get(key).push({
        _id: team._id,
        name: team.name,
        isManager,
        department: team.department
          ? { _id: team.department._id, name: team.department.name }
          : null,
      });
    };
    teams.forEach((t) => {
      const managerId = t.manager ? t.manager.toString() : null;
      (t.members || []).forEach((m) => push(m, t, managerId === m.toString()));
      if (managerId && !(t.members || []).some((m) => m.toString() === managerId)) {
        push(t.manager, t, true);
      }
    });

    let entries = memberships
      .filter((m) => m.user)
      .map((m) => {
        const userTeams = teamsByUser.get(m.user._id.toString()) || [];
        const departments = [
          ...new Map(
            userTeams
              .filter((t) => t.department)
              .map((t) => [t.department._id.toString(), t.department])
          ).values(),
        ];
        return {
          user: m.user,
          role: m.role,
          jobTitle: m.jobTitle || "",
          joinedAt: m.joinedAt,
          teams: userTeams.map((t) => ({
            _id: t._id,
            name: t.name,
            isManager: t.isManager,
          })),
          departments,
        };
      });

    if (role) entries = entries.filter((e) => e.role === role);
    if (teamId) {
      entries = entries.filter((e) =>
        e.teams.some((t) => t._id.toString() === teamId)
      );
    }
    if (departmentId) {
      entries = entries.filter((e) =>
        e.departments.some((d) => d._id.toString() === departmentId)
      );
    }
    if (q.trim()) {
      const rx = new RegExp(escapeRegex(q.trim()), "i");
      entries = entries.filter(
        (e) =>
          rx.test(e.user.username) ||
          rx.test(e.user.email || "") ||
          rx.test(e.jobTitle)
      );
    }

    entries.sort(
      (a, b) =>
        (ROLE_LEVELS[b.role] || 0) - (ROLE_LEVELS[a.role] || 0) ||
        a.user.username.localeCompare(b.user.username)
    );

    res.status(200).json({
      success: true,
      count: entries.length,
      data: entries,
    });
  } catch (err) {
    console.error("Directory Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to load the employee directory.",
    });
  }
};

// 6️⃣c Update a member's profile (job title) — self or admin+
const updateMemberProfile = async (req, res) => {
  try {
    const { userId: targetUserId } = req.params;
    const { jobTitle } = req.body;
    const actorId = req.user.id;

    const isSelf = targetUserId === actorId;
    if (!isSelf && !hasMinRole(req.orgMembership.role, "admin")) {
      return res.status(403).json({
        success: false,
        error: "You can only edit your own profile.",
      });
    }

    const target = await OrgMembership.findOne({
      organization: req.organization._id,
      user: targetUserId,
    });
    if (!target) {
      return res.status(404).json({
        success: false,
        error: "Member not found in this organization.",
      });
    }

    if (jobTitle !== undefined) {
      const value = String(jobTitle).trim();
      if (value.length > 60) {
        return res.status(400).json({
          success: false,
          error: "Job title must be 60 characters or fewer.",
        });
      }
      target.jobTitle = value;
    }

    await target.save();

    const io = getIO(req);
    if (io) {
      io.to(`org:${req.organization._id}`).emit(
        ORG_EVENTS.MEMBER_PROFILE_UPDATED,
        {
          organizationId: req.organization._id,
          userId: targetUserId,
          jobTitle: target.jobTitle,
        }
      );
    }

    res.status(200).json({
      success: true,
      message: "Profile updated.",
      data: target,
    });
  } catch (err) {
    console.error("Update Member Profile Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to update profile.",
    });
  }
};

// 7️⃣ Update Member Role (admin+; admin changes require owner)
const updateMemberRole = async (req, res) => {
  try {
    const { userId: targetUserId } = req.params;
    const { role: newRole } = req.body;
    const actorId = req.user.id;
    const organization = req.organization;

    if (!["admin", "manager", "employee"].includes(newRole)) {
      return res.status(400).json({
        success: false,
        error: "Role must be admin, manager or employee.",
      });
    }

    if (targetUserId === actorId) {
      return res.status(400).json({
        success: false,
        error: "You cannot change your own role.",
      });
    }

    const target = await OrgMembership.findOne({
      organization: organization._id,
      user: targetUserId,
    });

    if (!target) {
      return res.status(404).json({
        success: false,
        error: "Member not found in this organization.",
      });
    }

    if (target.role === "owner") {
      return res.status(400).json({
        success: false,
        error: "The owner's role cannot be changed. Use transfer-ownership.",
      });
    }

    // Only the owner can grant or revoke admin
    if (
      (target.role === "admin" || newRole === "admin") &&
      req.orgMembership.role !== "owner"
    ) {
      return res.status(403).json({
        success: false,
        error: "Only the owner can manage admin roles.",
      });
    }

    const oldRole = target.role;
    target.role = newRole;
    await target.save();

    await recordAudit({
      organization: organization._id,
      actor: actorId,
      action: "member.role_changed",
      targetUser: targetUserId,
      details: { from: oldRole, to: newRole },
    });

    const io = getIO(req);
    if (io) {
      const payload = {
        organizationId: organization._id,
        userId: targetUserId,
        oldRole,
        newRole,
        changedBy: actorId,
      };
      io.to(`org:${organization._id}`).emit(
        ORG_EVENTS.MEMBER_ROLE_CHANGED,
        payload
      );
      io.to(`user:${targetUserId}`).emit(ORG_EVENTS.MEMBER_ROLE_CHANGED, payload);
    }

    res.status(200).json({
      success: true,
      message: `Role updated to ${newRole}.`,
      data: target,
    });
  } catch (err) {
    console.error("Update Member Role Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to update member role.",
    });
  }
};

// 8️⃣ Remove Member (admin+; removing an admin requires owner)
const removeMember = async (req, res) => {
  try {
    const { userId: targetUserId } = req.params;
    const actorId = req.user.id;
    const organization = req.organization;

    if (targetUserId === actorId) {
      return res.status(400).json({
        success: false,
        error: "You cannot remove yourself. Use leave instead.",
      });
    }

    const target = await OrgMembership.findOne({
      organization: organization._id,
      user: targetUserId,
    });

    if (!target) {
      return res.status(404).json({
        success: false,
        error: "Member not found in this organization.",
      });
    }

    if (target.role === "owner") {
      return res.status(400).json({
        success: false,
        error: "The owner cannot be removed.",
      });
    }

    if (target.role === "admin" && req.orgMembership.role !== "owner") {
      return res.status(403).json({
        success: false,
        error: "Only the owner can remove an admin.",
      });
    }

    const io = getIO(req);
    await detachUserFromOrg(organization, targetUserId, io);

    await recordAudit({
      organization: organization._id,
      actor: actorId,
      action: "member.removed",
      targetUser: targetUserId,
      details: { role: target.role },
    });

    if (io) {
      const payload = {
        organizationId: organization._id,
        userId: targetUserId,
        removedBy: actorId,
      };
      io.to(`org:${organization._id}`).emit(ORG_EVENTS.MEMBER_REMOVED, payload);
      io.to(`user:${targetUserId}`).emit(ORG_EVENTS.MEMBER_REMOVED, payload);
    }

    res.status(200).json({
      success: true,
      message: "Member removed from organization.",
    });
  } catch (err) {
    console.error("Remove Member Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to remove member.",
    });
  }
};

// 9️⃣ Leave Organization (anyone except the owner)
const leaveOrganization = async (req, res) => {
  try {
    const userId = req.user.id;
    const organization = req.organization;

    if (req.orgMembership.role === "owner") {
      return res.status(400).json({
        success: false,
        error: "The owner cannot leave. Transfer ownership first.",
      });
    }

    const io = getIO(req);
    await detachUserFromOrg(organization, userId, io);

    await recordAudit({
      organization: organization._id,
      actor: userId,
      action: "member.left",
    });

    if (io) {
      io.to(`org:${organization._id}`).emit(ORG_EVENTS.MEMBER_LEFT, {
        organizationId: organization._id,
        userId,
      });
    }

    res.status(200).json({
      success: true,
      message: "You have left the organization.",
    });
  } catch (err) {
    console.error("Leave Organization Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to leave organization.",
    });
  }
};

// 🔟 Transfer Ownership (owner only)
const transferOwnership = async (req, res) => {
  try {
    const { userId: newOwnerId } = req.body;
    const actorId = req.user.id;
    const organization = req.organization;

    if (!newOwnerId || newOwnerId === actorId) {
      return res.status(400).json({
        success: false,
        error: "A different member must be specified as the new owner.",
      });
    }

    const newOwnerMembership = await OrgMembership.findOne({
      organization: organization._id,
      user: newOwnerId,
    });

    if (!newOwnerMembership) {
      return res.status(404).json({
        success: false,
        error: "New owner must be a member of this organization.",
      });
    }

    newOwnerMembership.role = "owner";
    req.orgMembership.role = "admin";
    organization.owner = newOwnerId;

    await Promise.all([
      newOwnerMembership.save(),
      req.orgMembership.save(),
      organization.save(),
    ]);

    await recordAudit({
      organization: organization._id,
      actor: actorId,
      action: "ownership.transferred",
      targetUser: newOwnerId,
    });

    const io = getIO(req);
    if (io) {
      io.to(`org:${organization._id}`).emit(ORG_EVENTS.OWNERSHIP_TRANSFERRED, {
        organizationId: organization._id,
        previousOwnerId: actorId,
        newOwnerId,
      });
    }

    res.status(200).json({
      success: true,
      message: "Ownership transferred.",
      data: {
        previousOwnerId: actorId,
        newOwnerId,
      },
    });
  } catch (err) {
    console.error("Transfer Ownership Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to transfer ownership.",
    });
  }
};

module.exports = {
  createOrganization,
  getMyOrganizations,
  getOrganizationById,
  updateOrganization,
  deleteOrganization,
  getMembers,
  getDirectory,
  updateMemberProfile,
  updateMemberRole,
  removeMember,
  leaveOrganization,
  transferOwnership,
  // shared helpers for other controllers
  getIO,
  createOrgChannel,
  destroyOrganization,
  detachUserFromOrg,
};
