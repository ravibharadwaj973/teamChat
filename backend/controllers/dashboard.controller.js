const OrgMembership = require("../../models/orgMembership");
const Team = require("../../models/team");
const Department = require("../../models/department");
const OrgInvite = require("../../models/orgInvite");
const Conversation = require("../../models/conversation");
const Message = require("../../models/message");
const Task = require("../../models/task");
const File = require("../../models/file");
const Event = require("../../models/event");
const Announcement = require("../../models/announcement");
const AuditLog = require("../../models/auditLog");

const escapeRegex = (str = "") => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Org admin dashboard: one call returns membership, structure,
// activity and invite stats for the overview screen. Admin+ only (route guard).
const getDashboard = async (req, res) => {
  try {
    const organization = req.organization;
    const orgId = organization._id;

    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    const weekAhead = new Date(now.getTime() + 7 * 24 * 3600 * 1000);

    const channels = await Conversation.find({ organizationId: orgId }).select("_id");
    const channelIds = channels.map((c) => c._id);

    const [
      roleAgg,
      recentJoins,
      teams,
      departmentsCount,
      pendingInvites,
      pendingCount,
      messagesTotal,
      messagesToday,
      messagesWeek,
      tasksOpen,
      tasksDone,
      tasksOverdue,
      filesAgg,
      eventsUpcoming,
      announcementsCount,
    ] = await Promise.all([
      OrgMembership.aggregate([
        { $match: { organization: orgId } },
        { $group: { _id: "$role", count: { $sum: 1 } } },
      ]),
      OrgMembership.find({ organization: orgId })
        .sort({ joinedAt: -1 })
        .limit(5)
        .populate("user", "username avatar email online"),
      Team.find({ organization: orgId })
        .select("name members manager")
        .populate("manager", "username avatar"),
      Department.countDocuments({ organization: orgId }),
      OrgInvite.find({ organization: orgId, status: "pending" })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate("invitedBy", "username"),
      OrgInvite.countDocuments({ organization: orgId, status: "pending" }),
      Message.countDocuments({ conversationId: { $in: channelIds } }),
      Message.countDocuments({
        conversationId: { $in: channelIds },
        createdAt: { $gte: dayStart },
      }),
      Message.countDocuments({
        conversationId: { $in: channelIds },
        createdAt: { $gte: weekAgo },
      }),
      Task.countDocuments({ organization: orgId, status: { $ne: "done" } }),
      Task.countDocuments({ organization: orgId, status: "done" }),
      Task.countDocuments({
        organization: orgId,
        status: { $ne: "done" },
        dueDate: { $ne: null, $lt: now },
      }),
      File.aggregate([
        { $match: { organization: orgId } },
        { $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: "$bytes" } } },
      ]),
      Event.countDocuments({
        organization: orgId,
        startAt: { $gte: now, $lte: weekAhead },
      }),
      Announcement.countDocuments({ organization: orgId }),
    ]);

    const byRole = { owner: 0, admin: 0, manager: 0, employee: 0 };
    roleAgg.forEach((r) => {
      if (byRole[r._id] !== undefined) byRole[r._id] = r.count;
    });
    const membersTotal = Object.values(byRole).reduce((a, b) => a + b, 0);

    const topTeams = teams
      .map((t) => ({
        _id: t._id,
        name: t.name,
        memberCount: (t.members || []).length,
        manager: t.manager || null,
      }))
      .sort((a, b) => b.memberCount - a.memberCount)
      .slice(0, 6);

    res.status(200).json({
      success: true,
      data: {
        organization: {
          _id: organization._id,
          name: organization.name,
          slug: organization.slug,
          createdAt: organization.createdAt,
        },
        members: { total: membersTotal, byRole, recentJoins },
        teams: { total: teams.length, departments: departmentsCount, top: topTeams },
        channels: { total: channelIds.length },
        invites: { pending: pendingCount, list: pendingInvites },
        activity: {
          messagesTotal,
          messagesToday,
          messagesWeek,
          tasksOpen,
          tasksDone,
          tasksOverdue,
          filesCount: filesAgg[0]?.count || 0,
          filesBytes: filesAgg[0]?.bytes || 0,
          eventsUpcoming,
          announcements: announcementsCount,
        },
      },
    });
  } catch (err) {
    console.error("Org Dashboard Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to load the dashboard.",
    });
  }
};

// Audit trail (admin+): ?action=member. (prefix) or exact key, ?userId= actor/target
const getAuditLogs = async (req, res) => {
  try {
    const orgId = req.organization._id;
    const { action, userId } = req.query;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 25, 50);

    const query = { organization: orgId };
    if (action) {
      query.action = action.endsWith(".")
        ? { $regex: `^${escapeRegex(action)}` }
        : action;
    }
    if (userId) {
      query.$or = [{ actor: userId }, { targetUser: userId }];
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("actor", "username avatar")
        .populate("targetUser", "username avatar"),
      AuditLog.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      page,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      total,
      data: logs,
    });
  } catch (err) {
    console.error("Audit Logs Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to load the audit log.",
    });
  }
};

module.exports = { getDashboard, getAuditLogs };
