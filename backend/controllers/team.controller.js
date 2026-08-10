const Team = require("../../models/team");
const Department = require("../../models/department");
const OrgMembership = require("../../models/orgMembership");
const Conversation = require("../../models/conversation");
const Message = require("../../models/message");
const User = require("../../models/user");
const { TEAM_EVENTS, ORG_EVENTS } = require("../../shared/constants");
const { hasMinRole } = require("../../shared/permissions");
const { postSystemMessage } = require("../../shared/chatUtils");
const { getIO } = require("./organization.controller");
const { recordAudit } = require("../lib/audit");

// Admin+ of the org, or the team's own manager
const canManageTeam = (orgMembership, team, userId) =>
  hasMinRole(orgMembership.role, "admin") ||
  (team.manager && team.manager.toString() === userId.toString());

// Verify a list of user ids are all members of the org
const allOrgMembers = async (orgId, userIds) => {
  if (userIds.length === 0) return true;
  const count = await OrgMembership.countDocuments({
    organization: orgId,
    user: { $in: userIds },
  });
  return count === userIds.length;
};

// A department id is valid when it exists inside this organization
const validateDepartment = async (orgId, departmentId) => {
  if (!departmentId) return true;
  return !!(await Department.exists({
    _id: departmentId,
    organization: orgId,
  }));
};

// Keep ALL of the team's channels in sync with team membership.
// fallbackAdmin takes over channels whose admin was removed.
const syncTeamChannels = async (team, { add = [], remove = [], fallbackAdmin = null }) => {
  const channels = await Conversation.find({ teamId: team._id });

  for (const channel of channels) {
    add.forEach((id) => {
      const exists = channel.participants.some(
        (p) => p.toString() === id.toString()
      );
      if (!exists) {
        channel.participants.push(id);
        channel.unreadCount.set(id.toString(), 0);
      }
    });

    remove.forEach((id) => {
      channel.participants = channel.participants.filter(
        (p) => p.toString() !== id.toString()
      );
      channel.unreadCount.delete(id.toString());
      if (channel.groupAdmin && channel.groupAdmin.toString() === id.toString()) {
        channel.groupAdmin = fallbackAdmin || team.manager || team.createdBy;
      }
    });

    await channel.save();
  }

  return channels;
};

// If an employee is made a team manager, bump their org role to manager
const promoteToManagerRole = async (orgId, userId, io, actorId = null) => {
  const membership = await OrgMembership.findOne({
    organization: orgId,
    user: userId,
  });
  if (membership && membership.role === "employee") {
    membership.role = "manager";
    await membership.save();
    await recordAudit({
      organization: orgId,
      actor: actorId || userId,
      action: "member.role_changed",
      targetUser: userId,
      details: { from: "employee", to: "manager", auto: true },
    });
    if (io) {
      io.to(`org:${orgId}`).emit(ORG_EVENTS.MEMBER_ROLE_CHANGED, {
        organizationId: orgId,
        userId,
        oldRole: "employee",
        newRole: "manager",
      });
    }
  }
};

// 1️⃣ Create Team (admin+) — also creates the team's chat channel
const createTeam = async (req, res) => {
  try {
    const organization = req.organization;
    const creatorId = req.user.id;
    const {
      name,
      description = "",
      departmentId = null,
      managerId = null,
      memberIds = [],
    } = req.body;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: "Team name must be at least 2 characters.",
      });
    }

    if (!(await validateDepartment(organization._id, departmentId))) {
      return res.status(400).json({
        success: false,
        error: "Department not found in this organization.",
      });
    }

    // Build the member list: given members + manager; fall back to creator
    const memberSet = new Set(
      (Array.isArray(memberIds) ? memberIds : []).map((id) => id.toString())
    );
    if (managerId) memberSet.add(managerId.toString());
    if (memberSet.size === 0) memberSet.add(creatorId.toString());
    const members = [...memberSet];

    if (!(await allOrgMembers(organization._id, members))) {
      return res.status(400).json({
        success: false,
        error: "All team members must be members of the organization.",
      });
    }

    let team;
    try {
      team = await Team.create({
        organization: organization._id,
        name: name.trim(),
        description,
        department: departmentId,
        manager: managerId,
        members,
        createdBy: creatorId,
      });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({
          success: false,
          error: "A team with this name already exists in the organization.",
        });
      }
      throw err;
    }

    // Team chat channel (a group conversation linked to the team)
    const channel = await Conversation.create({
      participants: members,
      isGroup: true,
      groupName: team.name,
      groupAdmin: managerId || creatorId,
      organizationId: organization._id,
      teamId: team._id,
      channelType: "team",
      unreadCount: {},
    });
    members.forEach((id) => channel.unreadCount.set(id.toString(), 0));
    await channel.save();

    team.conversation = channel._id;
    await team.save();

    const io = getIO(req);

    await recordAudit({
      organization: organization._id,
      actor: creatorId,
      action: "team.created",
      targetLabel: team.name,
    });

    // Assigning a manager promotes an employee to the manager role
    if (managerId) {
      await promoteToManagerRole(organization._id, managerId, io, creatorId);
    }

    if (io) {
      members.forEach((memberId) => {
        io.in(`user:${memberId}`).socketsJoin(`team:${team._id}`);
      });
      io.to(`org:${organization._id}`).emit(TEAM_EVENTS.TEAM_CREATED, {
        organizationId: organization._id,
        team,
      });
    }

    await team.populate("manager", "username avatar");
    await team.populate("members", "username avatar status online");
    await team.populate("department", "name");

    res.status(201).json({
      success: true,
      message: "Team created.",
      data: { team, channel },
    });
  } catch (err) {
    console.error("Create Team Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to create team.",
    });
  }
};

// 2️⃣ Get all Teams in the org (grouped by department on the client)
const getTeams = async (req, res) => {
  try {
    const teams = await Team.find({ organization: req.organization._id })
      .populate("manager", "username avatar status online")
      .populate("department", "name")
      .populate("conversation", "groupName channelType lastMessage")
      .sort({ name: 1 });

    res.status(200).json({
      success: true,
      count: teams.length,
      data: teams,
    });
  } catch (err) {
    console.error("Get Teams Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch teams.",
    });
  }
};

// 3️⃣ Get the teams I belong to
const getMyTeams = async (req, res) => {
  try {
    const teams = await Team.find({
      organization: req.organization._id,
      members: req.user.id,
    })
      .populate("manager", "username avatar status online")
      .populate("department", "name")
      .populate("conversation", "groupName channelType lastMessage")
      .sort({ name: 1 });

    res.status(200).json({
      success: true,
      count: teams.length,
      data: teams,
    });
  } catch (err) {
    console.error("Get My Teams Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch your teams.",
    });
  }
};

// 4️⃣ Get Team by ID
const getTeamById = async (req, res) => {
  try {
    const { teamId } = req.params;

    const team = await Team.findOne({
      _id: teamId,
      organization: req.organization._id,
    })
      .populate("manager", "username avatar status online lastSeen")
      .populate("members", "username avatar status online lastSeen")
      .populate("department", "name description head")
      .populate("conversation", "groupName channelType lastMessage")
      .populate("channels", "groupName channelType metadata updatedAt")
      .populate("createdBy", "username avatar");

    if (!team) {
      return res.status(404).json({
        success: false,
        error: "Team not found.",
      });
    }

    res.status(200).json({
      success: true,
      data: team,
    });
  } catch (err) {
    console.error("Get Team Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch team.",
    });
  }
};

// 5️⃣ Update Team (admin+ or the team's manager)
const updateTeam = async (req, res) => {
  try {
    const { teamId } = req.params;
    const { name, description, departmentId } = req.body;
    const userId = req.user.id;

    const team = await Team.findOne({
      _id: teamId,
      organization: req.organization._id,
    });

    if (!team) {
      return res.status(404).json({
        success: false,
        error: "Team not found.",
      });
    }

    if (!canManageTeam(req.orgMembership, team, userId)) {
      return res.status(403).json({
        success: false,
        error: "Only org admins or the team manager can update this team.",
      });
    }

    const nameChanged = name !== undefined && name.trim() !== team.name;
    if (name !== undefined) {
      if (!name || name.trim().length < 2) {
        return res.status(400).json({
          success: false,
          error: "Team name must be at least 2 characters.",
        });
      }
      team.name = name.trim();
    }
    if (description !== undefined) team.description = description;
    // Move the team to another department (or null to unassign)
    if (departmentId !== undefined) {
      if (!(await validateDepartment(req.organization._id, departmentId))) {
        return res.status(400).json({
          success: false,
          error: "Department not found in this organization.",
        });
      }
      team.department = departmentId || null;
    }

    try {
      await team.save();
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({
          success: false,
          error: "A team with this name already exists in the organization.",
        });
      }
      throw err;
    }

    // Keep the channel name in sync with the team name
    if (nameChanged && team.conversation) {
      await Conversation.findByIdAndUpdate(team.conversation, {
        groupName: team.name,
      });
    }

    const io = getIO(req);
    if (io) {
      io.to(`org:${req.organization._id}`).emit(TEAM_EVENTS.TEAM_UPDATED, {
        organizationId: req.organization._id,
        team,
      });
    }

    res.status(200).json({
      success: true,
      message: "Team updated.",
      data: team,
    });
  } catch (err) {
    console.error("Update Team Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to update team.",
    });
  }
};

// 6️⃣ Delete Team (admin+) — removes the team channel and its messages
const deleteTeam = async (req, res) => {
  try {
    const { teamId } = req.params;

    const team = await Team.findOne({
      _id: teamId,
      organization: req.organization._id,
    });

    if (!team) {
      return res.status(404).json({
        success: false,
        error: "Team not found.",
      });
    }

    // Delete ALL of the team's channels (default + custom) and their messages
    const channels = await Conversation.find({ teamId: team._id }).select("_id");
    const channelIds = channels.map((c) => c._id);
    await Message.deleteMany({ conversationId: { $in: channelIds } });
    await Conversation.deleteMany({ teamId: team._id });
    // Team files: remove Cloudinary assets + docs (lazy require avoids a cycle)
    const { destroyFilesByQuery } = require("./file.controller");
    await destroyFilesByQuery({ team: team._id });
    const Event = require("../../models/event");
    await Event.deleteMany({ team: team._id });
    await team.deleteOne();

    await recordAudit({
      organization: req.organization._id,
      actor: req.user.id,
      action: "team.deleted",
      targetLabel: team.name,
    });

    const io = getIO(req);
    if (io) {
      io.to(`org:${req.organization._id}`).emit(TEAM_EVENTS.TEAM_DELETED, {
        organizationId: req.organization._id,
        teamId: team._id,
      });
      io.in(`team:${team._id}`).socketsLeave(`team:${team._id}`);
    }

    res.status(200).json({
      success: true,
      message: "Team deleted.",
    });
  } catch (err) {
    console.error("Delete Team Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to delete team.",
    });
  }
};

// 7️⃣ Add Team Member (admin+ or team manager)
const addTeamMember = async (req, res) => {
  try {
    const { teamId } = req.params;
    const { userId: newMemberId } = req.body;
    const actorId = req.user.id;

    if (!newMemberId) {
      return res.status(400).json({
        success: false,
        error: "userId is required.",
      });
    }

    const team = await Team.findOne({
      _id: teamId,
      organization: req.organization._id,
    });

    if (!team) {
      return res.status(404).json({
        success: false,
        error: "Team not found.",
      });
    }

    if (!canManageTeam(req.orgMembership, team, actorId)) {
      return res.status(403).json({
        success: false,
        error: "Only org admins or the team manager can add members.",
      });
    }

    const isOrgMember = await OrgMembership.exists({
      organization: req.organization._id,
      user: newMemberId,
    });
    if (!isOrgMember) {
      return res.status(400).json({
        success: false,
        error: "User must be a member of the organization first.",
      });
    }

    const alreadyInTeam = team.members.some(
      (m) => m.toString() === newMemberId.toString()
    );
    if (alreadyInTeam) {
      return res.status(400).json({
        success: false,
        error: "User is already in this team.",
      });
    }

    team.members.push(newMemberId);
    await team.save();
    await syncTeamChannels(team, { add: [newMemberId] });

    await recordAudit({
      organization: req.organization._id,
      actor: actorId,
      action: "team.member_added",
      targetUser: newMemberId,
      targetLabel: team.name,
    });

    const io = getIO(req);

    // System message in the team's default channel
    if (team.conversation) {
      const newUser = await User.findById(newMemberId).select("username");
      if (newUser) {
        await postSystemMessage(
          io,
          team.conversation,
          `${newUser.username} was added to the team`,
          actorId
        );
      }
    }

    if (io) {
      io.in(`user:${newMemberId}`).socketsJoin(`team:${team._id}`);
      const payload = {
        organizationId: req.organization._id,
        teamId: team._id,
        userId: newMemberId,
        addedBy: actorId,
      };
      io.to(`team:${team._id}`).emit(TEAM_EVENTS.TEAM_MEMBER_ADDED, payload);
      io.to(`user:${newMemberId}`).emit(TEAM_EVENTS.TEAM_MEMBER_ADDED, payload);
    }

    res.status(200).json({
      success: true,
      message: "Member added to team.",
      data: { teamId: team._id, userId: newMemberId },
    });
  } catch (err) {
    console.error("Add Team Member Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to add team member.",
    });
  }
};

// 8️⃣ Remove Team Member (admin+ or team manager)
const removeTeamMember = async (req, res) => {
  try {
    const { teamId, userId: removeUserId } = req.params;
    const actorId = req.user.id;

    const team = await Team.findOne({
      _id: teamId,
      organization: req.organization._id,
    });

    if (!team) {
      return res.status(404).json({
        success: false,
        error: "Team not found.",
      });
    }

    if (!canManageTeam(req.orgMembership, team, actorId)) {
      return res.status(403).json({
        success: false,
        error: "Only org admins or the team manager can remove members.",
      });
    }

    const inTeam = team.members.some(
      (m) => m.toString() === removeUserId.toString()
    );
    if (!inTeam) {
      return res.status(404).json({
        success: false,
        error: "User is not in this team.",
      });
    }

    team.members = team.members.filter(
      (m) => m.toString() !== removeUserId.toString()
    );
    if (team.manager && team.manager.toString() === removeUserId.toString()) {
      team.manager = null;
    }
    await team.save();

    await syncTeamChannels(team, {
      remove: [removeUserId],
      fallbackAdmin: actorId,
    });

    await recordAudit({
      organization: req.organization._id,
      actor: actorId,
      action: "team.member_removed",
      targetUser: removeUserId,
      targetLabel: team.name,
    });

    const io = getIO(req);

    // System message in the team's default channel
    if (team.conversation) {
      const removedUser = await User.findById(removeUserId).select("username");
      if (removedUser) {
        await postSystemMessage(
          io,
          team.conversation,
          `${removedUser.username} was removed from the team`,
          actorId
        );
      }
    }

    if (io) {
      io.in(`user:${removeUserId}`).socketsLeave(`team:${team._id}`);
      const payload = {
        organizationId: req.organization._id,
        teamId: team._id,
        userId: removeUserId,
        removedBy: actorId,
      };
      io.to(`team:${team._id}`).emit(TEAM_EVENTS.TEAM_MEMBER_REMOVED, payload);
      io.to(`user:${removeUserId}`).emit(
        TEAM_EVENTS.TEAM_MEMBER_REMOVED,
        payload
      );
    }

    res.status(200).json({
      success: true,
      message: "Member removed from team.",
    });
  } catch (err) {
    console.error("Remove Team Member Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to remove team member.",
    });
  }
};

// 9️⃣ Set / Clear Team Manager (admin+)
const setTeamManager = async (req, res) => {
  try {
    const { teamId } = req.params;
    const { userId: newManagerId = null } = req.body;

    const team = await Team.findOne({
      _id: teamId,
      organization: req.organization._id,
    });

    if (!team) {
      return res.status(404).json({
        success: false,
        error: "Team not found.",
      });
    }

    const io = getIO(req);

    // Clearing the manager
    if (!newManagerId) {
      team.manager = null;
      await team.save();

      if (io) {
        io.to(`team:${team._id}`).emit(TEAM_EVENTS.TEAM_MANAGER_CHANGED, {
          organizationId: req.organization._id,
          teamId: team._id,
          managerId: null,
        });
      }

      return res.status(200).json({
        success: true,
        message: "Team manager cleared.",
        data: team,
      });
    }

    const isOrgMember = await OrgMembership.exists({
      organization: req.organization._id,
      user: newManagerId,
    });
    if (!isOrgMember) {
      return res.status(400).json({
        success: false,
        error: "Manager must be a member of the organization.",
      });
    }

    // Manager should also be a team member
    const inTeam = team.members.some(
      (m) => m.toString() === newManagerId.toString()
    );
    if (!inTeam) {
      team.members.push(newManagerId);
      await syncTeamChannels(team, { add: [newManagerId] });
      if (io) {
        io.in(`user:${newManagerId}`).socketsJoin(`team:${team._id}`);
      }
    }

    team.manager = newManagerId;
    await team.save();

    // Admin of every team channel follows the manager
    await Conversation.updateMany(
      { teamId: team._id },
      { groupAdmin: newManagerId }
    );

    // System message in the team's default channel
    if (team.conversation) {
      const managerUser = await User.findById(newManagerId).select("username");
      if (managerUser) {
        await postSystemMessage(
          io,
          team.conversation,
          `${managerUser.username} is now the team manager`,
          req.user.id
        );
      }
    }

    await promoteToManagerRole(req.organization._id, newManagerId, io, req.user.id);

    await recordAudit({
      organization: req.organization._id,
      actor: req.user.id,
      action: "team.manager_changed",
      targetUser: newManagerId,
      targetLabel: team.name,
    });

    if (io) {
      const payload = {
        organizationId: req.organization._id,
        teamId: team._id,
        managerId: newManagerId,
      };
      io.to(`team:${team._id}`).emit(TEAM_EVENTS.TEAM_MANAGER_CHANGED, payload);
      io.to(`org:${req.organization._id}`).emit(
        TEAM_EVENTS.TEAM_MANAGER_CHANGED,
        payload
      );
    }

    res.status(200).json({
      success: true,
      message: "Team manager assigned.",
      data: team,
    });
  } catch (err) {
    console.error("Set Team Manager Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to set team manager.",
    });
  }
};

module.exports = {
  createTeam,
  getTeams,
  getMyTeams,
  getTeamById,
  updateTeam,
  deleteTeam,
  addTeamMember,
  removeTeamMember,
  setTeamManager,
  // shared with department controller (dept heads act at manager level)
  promoteToManagerRole,
  // shared with channel controller
  canManageTeam,
};
