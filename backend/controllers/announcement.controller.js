const Announcement = require("../../models/announcement");
const OrgMembership = require("../../models/orgMembership");
const Conversation = require("../../models/conversation");
const Message = require("../../models/message");
const Notification = require("../../models/notifications");
const {
  canPostAnnouncements,
  hasMinRole,
} = require("../../shared/permissions");
const {
  ANNOUNCEMENT_EVENTS,
  MESSAGE_EVENTS,
} = require("../../shared/constants");
const { getIO } = require("./organization.controller");
const { emailUserIfEnabled } = require("../lib/email");
const { recordAudit } = require("../lib/audit");

// Mirrors an announcement into the org #announcements channel
const mirrorToChannel = async (io, orgId, announcement, authorId) => {
  const channel = await Conversation.findOne({
    organizationId: orgId,
    channelType: "announcement",
    teamId: null,
  });
  if (!channel) return null;

  const message = await Message.create({
    conversationId: channel._id,
    sender: authorId,
    content: `📢 ${announcement.title}\n\n${announcement.body}`,
    messageType: "text",
  });

  channel.lastMessage = message._id;
  channel.participants.forEach((p) => {
    if (p.toString() !== authorId.toString()) {
      channel.unreadCount.set(
        p.toString(),
        (channel.unreadCount.get(p.toString()) || 0) + 1
      );
    }
  });
  await channel.save();

  const populated = await Message.findById(message._id).populate(
    "sender",
    "username avatar"
  );

  if (io) {
    io.to(`conversation:${channel._id}`).emit(MESSAGE_EVENTS.NEW_MESSAGE, {
      message: populated,
      conversationId: channel._id.toString(),
    });
  }

  return message;
};

// 1️⃣ Create Announcement (owner/admin/manager or HR members)
const createAnnouncement = async (req, res) => {
  try {
    const organization = req.organization;
    const userId = req.user.id;
    const { title, body, priority = "normal", expiresAt = null } = req.body;

    const allowed = await canPostAnnouncements(
      organization._id,
      req.orgMembership.role,
      userId
    );
    if (!allowed) {
      return res.status(403).json({
        success: false,
        error:
          "Only owners, admins, managers or HR members can send company-wide notices.",
      });
    }

    if (!title || title.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: "Announcement title must be at least 2 characters.",
      });
    }
    if (!body || body.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: "Announcement body is required.",
      });
    }
    if (!["normal", "important", "urgent"].includes(priority)) {
      return res.status(400).json({
        success: false,
        error: "Priority must be normal, important or urgent.",
      });
    }

    const announcement = await Announcement.create({
      organization: organization._id,
      title: title.trim(),
      body: body.trim(),
      priority,
      createdBy: userId,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    });

    const io = getIO(req);

    // Mirror into the #announcements channel
    const message = await mirrorToChannel(io, organization._id, announcement, userId);
    if (message) {
      announcement.channelMessage = message._id;
      await announcement.save();
    }

    // In-app notification for every other member
    const memberships = await OrgMembership.find({
      organization: organization._id,
      user: { $ne: userId },
    }).populate("user", "email username notificationSettings");

    if (memberships.length > 0) {
      const shortBody =
        announcement.body.length > 90
          ? `${announcement.body.substring(0, 87)}...`
          : announcement.body;
      await Notification.insertMany(
        memberships.map((m) => ({
          recipient: m.user._id || m.user,
          sender: userId,
          type: "system",
          title: `📢 ${announcement.title}`,
          body: shortBody,
          data: {
            kind: "announcement",
            organizationId: organization._id.toString(),
            announcementId: announcement._id.toString(),
          },
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        }))
      );

      // Important/urgent notices also go out by email via Resend
      if (priority !== "normal") {
        Promise.allSettled(
          memberships.map((m) =>
            emailUserIfEnabled(m.user, {
              subject: `📢 [${priority.toUpperCase()}] ${announcement.title}`,
              heading: `📢 ${announcement.title}`,
              body: announcement.body,
              ctaLabel: "Read in TeamSpace",
              footnote: `Company notice from ${organization.name} · priority: ${priority}`,
            })
          )
        ).catch(() => {});
      }
    }

    await announcement.populate("createdBy", "username avatar");

    await recordAudit({
      organization: organization._id,
      actor: userId,
      action: "announcement.created",
      targetLabel: announcement.title,
      details: { priority },
    });

    if (io) {
      io.to(`org:${organization._id}`).emit(ANNOUNCEMENT_EVENTS.NEW, {
        organizationId: organization._id,
        announcement,
      });
    }

    res.status(201).json({
      success: true,
      message: "Announcement published to the whole organization.",
      data: announcement,
    });
  } catch (err) {
    console.error("Create Announcement Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to create announcement.",
    });
  }
};

// 2️⃣ List Announcements (any member)
const listAnnouncements = async (req, res) => {
  try {
    const organization = req.organization;
    const userId = req.user.id;
    const includeExpired = req.query.includeExpired === "true";

    const query = { organization: organization._id };
    if (!includeExpired) {
      query.$or = [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }];
    }

    const [announcements, memberCount, canPost] = await Promise.all([
      Announcement.find(query)
        .populate("createdBy", "username avatar")
        .sort({ createdAt: -1 })
        .limit(50),
      OrgMembership.countDocuments({ organization: organization._id }),
      canPostAnnouncements(organization._id, req.orgMembership.role, userId),
    ]);

    const data = announcements.map((a) => {
      const obj = a.toObject();
      obj.ackCount = a.acks.length;
      obj.acked = a.acks.some((x) => x.user.toString() === userId.toString());
      obj.memberCount = memberCount;
      delete obj.acks; // detail comes from the acks endpoint
      return obj;
    });

    res.status(200).json({
      success: true,
      canPost,
      count: data.length,
      data,
    });
  } catch (err) {
    console.error("List Announcements Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch announcements.",
    });
  }
};

// 3️⃣ Acknowledge an announcement (any member, once)
const ackAnnouncement = async (req, res) => {
  try {
    const { announcementId } = req.params;
    const userId = req.user.id;

    const announcement = await Announcement.findOne({
      _id: announcementId,
      organization: req.organization._id,
    });
    if (!announcement) {
      return res.status(404).json({
        success: false,
        error: "Announcement not found.",
      });
    }

    const already = announcement.acks.some(
      (a) => a.user.toString() === userId.toString()
    );
    if (!already) {
      announcement.acks.push({ user: userId, at: new Date() });
      await announcement.save();

      const io = getIO(req);
      if (io) {
        io.to(`org:${req.organization._id}`).emit(ANNOUNCEMENT_EVENTS.ACKED, {
          organizationId: req.organization._id,
          announcementId: announcement._id,
          userId,
          ackCount: announcement.acks.length,
        });
      }
    }

    res.status(200).json({
      success: true,
      message: "Acknowledged.",
      data: { announcementId: announcement._id, ackCount: announcement.acks.length },
    });
  } catch (err) {
    console.error("Ack Announcement Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to acknowledge announcement.",
    });
  }
};

// 4️⃣ Who has (and hasn't) acknowledged — author or admin+
const getAnnouncementAcks = async (req, res) => {
  try {
    const { announcementId } = req.params;
    const userId = req.user.id;

    const announcement = await Announcement.findOne({
      _id: announcementId,
      organization: req.organization._id,
    }).populate("acks.user", "username avatar");
    if (!announcement) {
      return res.status(404).json({
        success: false,
        error: "Announcement not found.",
      });
    }

    const isAuthor = announcement.createdBy.toString() === userId.toString();
    if (!isAuthor && !hasMinRole(req.orgMembership.role, "admin")) {
      return res.status(403).json({
        success: false,
        error: "Only the author or admins can view acknowledgements.",
      });
    }

    const memberships = await OrgMembership.find({
      organization: req.organization._id,
    }).populate("user", "username avatar");

    const ackedIds = new Set(
      announcement.acks.map((a) => a.user?._id?.toString()).filter(Boolean)
    );
    const pending = memberships
      .map((m) => m.user)
      .filter(
        (u) =>
          u &&
          !ackedIds.has(u._id.toString()) &&
          u._id.toString() !== announcement.createdBy.toString()
      );

    res.status(200).json({
      success: true,
      data: {
        acked: announcement.acks,
        pending,
      },
    });
  } catch (err) {
    console.error("Get Acks Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch acknowledgements.",
    });
  }
};

// 5️⃣ Delete Announcement (author or admin+)
const deleteAnnouncement = async (req, res) => {
  try {
    const { announcementId } = req.params;
    const userId = req.user.id;

    const announcement = await Announcement.findOne({
      _id: announcementId,
      organization: req.organization._id,
    });
    if (!announcement) {
      return res.status(404).json({
        success: false,
        error: "Announcement not found.",
      });
    }

    const isAuthor = announcement.createdBy.toString() === userId.toString();
    if (!isAuthor && !hasMinRole(req.orgMembership.role, "admin")) {
      return res.status(403).json({
        success: false,
        error: "Only the author or admins can delete an announcement.",
      });
    }

    // Soft-delete the mirrored channel message too
    if (announcement.channelMessage) {
      await Message.findByIdAndUpdate(announcement.channelMessage, {
        deleted: true,
        content: "This message was deleted",
        pinned: false,
      });
    }
    await announcement.deleteOne();

    await recordAudit({
      organization: req.organization._id,
      actor: userId,
      action: "announcement.deleted",
      targetLabel: announcement.title,
    });

    const io = getIO(req);
    if (io) {
      io.to(`org:${req.organization._id}`).emit(ANNOUNCEMENT_EVENTS.DELETED, {
        organizationId: req.organization._id,
        announcementId,
      });
    }

    res.status(200).json({
      success: true,
      message: "Announcement deleted.",
    });
  } catch (err) {
    console.error("Delete Announcement Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to delete announcement.",
    });
  }
};

module.exports = {
  createAnnouncement,
  listAnnouncements,
  ackAnnouncement,
  getAnnouncementAcks,
  deleteAnnouncement,
};
