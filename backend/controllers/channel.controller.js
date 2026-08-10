const Team = require("../../models/team");
const Conversation = require("../../models/conversation");
const Message = require("../../models/message");
const { CHANNEL_EVENTS } = require("../../shared/constants");
const { getIO } = require("./organization.controller");
const { canManageTeam } = require("./team.controller");
const { postSystemMessage } = require("../../shared/chatUtils");
const { recordAudit } = require("../lib/audit");

// Loads a team inside the current org, or null
const loadTeam = (req) =>
  Team.findOne({
    _id: req.params.teamId,
    organization: req.organization._id,
  });

const isTeamMember = (team, userId) =>
  team.members.some((m) => m.toString() === userId.toString());

// 1️⃣ Create Team Channel (org admin+ or team manager)
// type: "text" (default, everyone posts) | "announcement" (manager+ posts)
const createTeamChannel = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, description = "", type = "text" } = req.body;

    const team = await loadTeam(req);
    if (!team) {
      return res.status(404).json({
        success: false,
        error: "Team not found.",
      });
    }

    if (!canManageTeam(req.orgMembership, team, userId)) {
      return res.status(403).json({
        success: false,
        error: "Only org admins or the team manager can create channels.",
      });
    }

    if (!name || name.trim().length < 2 || name.trim().length > 60) {
      return res.status(400).json({
        success: false,
        error: "Channel name must be 2-60 characters.",
      });
    }

    if (!["text", "announcement"].includes(type)) {
      return res.status(400).json({
        success: false,
        error: "Channel type must be text or announcement.",
      });
    }

    const channelName = name.trim();

    const duplicate = await Conversation.exists({
      teamId: team._id,
      groupName: channelName,
    });
    if (duplicate) {
      return res.status(409).json({
        success: false,
        error: "A channel with this name already exists in the team.",
      });
    }

    const channel = await Conversation.create({
      participants: team.members,
      isGroup: true,
      groupName: channelName,
      groupAdmin: team.manager || userId,
      organizationId: req.organization._id,
      teamId: team._id,
      channelType: type === "announcement" ? "announcement" : "custom",
      metadata: { description },
      unreadCount: {},
    });
    team.members.forEach((id) => channel.unreadCount.set(id.toString(), 0));
    await channel.save();

    await recordAudit({
      organization: req.organization._id,
      actor: userId,
      action: "channel.created",
      targetLabel: `${team.name} / ${channelName}`,
    });

    const io = getIO(req);
    if (io) {
      io.to(`team:${team._id}`).emit(CHANNEL_EVENTS.CHANNEL_CREATED, {
        organizationId: req.organization._id,
        teamId: team._id,
        channel,
      });
    }

    res.status(201).json({
      success: true,
      message: "Channel created.",
      data: channel,
    });
  } catch (err) {
    console.error("Create Team Channel Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to create channel.",
    });
  }
};

// 2️⃣ List Team Channels (team members or org admins)
const getTeamChannels = async (req, res) => {
  try {
    const userId = req.user.id;

    const team = await loadTeam(req);
    if (!team) {
      return res.status(404).json({
        success: false,
        error: "Team not found.",
      });
    }

    if (
      !isTeamMember(team, userId) &&
      !canManageTeam(req.orgMembership, team, userId)
    ) {
      return res.status(403).json({
        success: false,
        error: "Only team members can view the team's channels.",
      });
    }

    const channels = await Conversation.find({ teamId: team._id })
      .select(
        "groupName channelType metadata participants lastMessage updatedAt createdAt"
      )
      .populate({
        path: "lastMessage",
        select: "content sender messageType createdAt",
        populate: { path: "sender", select: "username avatar" },
      })
      .sort({ createdAt: 1 });

    const defaultId = team.conversation ? team.conversation.toString() : null;
    const data = channels.map((channel) => {
      const obj = channel.toObject();
      obj.isDefault = channel._id.toString() === defaultId;
      obj.memberCount = channel.participants.length;
      obj.description = channel.metadata?.description || "";
      return obj;
    });

    // Default channel first, then by creation date
    data.sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0));

    res.status(200).json({
      success: true,
      count: data.length,
      data,
    });
  } catch (err) {
    console.error("Get Team Channels Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch channels.",
    });
  }
};

// 3️⃣ Update Team Channel (org admin+ or team manager) — name, description
const updateTeamChannel = async (req, res) => {
  try {
    const userId = req.user.id;
    const { channelId } = req.params;
    const { name, description } = req.body;

    const team = await loadTeam(req);
    if (!team) {
      return res.status(404).json({
        success: false,
        error: "Team not found.",
      });
    }

    if (!canManageTeam(req.orgMembership, team, userId)) {
      return res.status(403).json({
        success: false,
        error: "Only org admins or the team manager can update channels.",
      });
    }

    const channel = await Conversation.findOne({
      _id: channelId,
      teamId: team._id,
    });
    if (!channel) {
      return res.status(404).json({
        success: false,
        error: "Channel not found in this team.",
      });
    }

    let renamedTo = null;
    if (name !== undefined) {
      const channelName = String(name).trim();
      if (channelName.length < 2 || channelName.length > 60) {
        return res.status(400).json({
          success: false,
          error: "Channel name must be 2-60 characters.",
        });
      }
      const duplicate = await Conversation.exists({
        teamId: team._id,
        groupName: channelName,
        _id: { $ne: channel._id },
      });
      if (duplicate) {
        return res.status(409).json({
          success: false,
          error: "A channel with this name already exists in the team.",
        });
      }
      if (channel.groupName !== channelName) renamedTo = channelName;
      channel.groupName = channelName;
    }

    if (description !== undefined) {
      channel.metadata = { ...(channel.metadata || {}), description };
      channel.markModified("metadata");
    }

    await channel.save();

    const io = getIO(req);

    if (renamedTo) {
      await postSystemMessage(
        io,
        channel._id,
        `Channel renamed to #${renamedTo}`,
        userId
      );
    }

    if (io) {
      io.to(`team:${team._id}`).emit(CHANNEL_EVENTS.CHANNEL_UPDATED, {
        organizationId: req.organization._id,
        teamId: team._id,
        channel,
      });
    }

    res.status(200).json({
      success: true,
      message: "Channel updated.",
      data: channel,
    });
  } catch (err) {
    console.error("Update Team Channel Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to update channel.",
    });
  }
};

// 4️⃣ Delete Team Channel (org admin+ or team manager)
// The team's default channel cannot be deleted (delete the team instead)
const deleteTeamChannel = async (req, res) => {
  try {
    const userId = req.user.id;
    const { channelId } = req.params;

    const team = await loadTeam(req);
    if (!team) {
      return res.status(404).json({
        success: false,
        error: "Team not found.",
      });
    }

    if (!canManageTeam(req.orgMembership, team, userId)) {
      return res.status(403).json({
        success: false,
        error: "Only org admins or the team manager can delete channels.",
      });
    }

    if (team.conversation && team.conversation.toString() === channelId) {
      return res.status(400).json({
        success: false,
        error:
          "The team's default channel cannot be deleted. Delete the team instead.",
      });
    }

    const channel = await Conversation.findOne({
      _id: channelId,
      teamId: team._id,
    });
    if (!channel) {
      return res.status(404).json({
        success: false,
        error: "Channel not found in this team.",
      });
    }

    await Message.deleteMany({ conversationId: channel._id });
    await channel.deleteOne();

    await recordAudit({
      organization: req.organization._id,
      actor: userId,
      action: "channel.deleted",
      targetLabel: `${team.name} / ${channel.groupName}`,
    });

    const io = getIO(req);
    if (io) {
      io.to(`team:${team._id}`).emit(CHANNEL_EVENTS.CHANNEL_DELETED, {
        organizationId: req.organization._id,
        teamId: team._id,
        channelId: channel._id,
      });
    }

    res.status(200).json({
      success: true,
      message: "Channel deleted.",
    });
  } catch (err) {
    console.error("Delete Team Channel Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to delete channel.",
    });
  }
};

module.exports = {
  createTeamChannel,
  getTeamChannels,
  updateTeamChannel,
  deleteTeamChannel,
};
