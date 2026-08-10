const crypto = require("crypto");
const Organization = require("../../models/organization");
const OrgMembership = require("../../models/orgMembership");
const OrgInvite = require("../../models/orgInvite");
const Conversation = require("../../models/conversation");
const User = require("../../models/user");
const Notification = require("../../models/notifications");
const { ORG_EVENTS } = require("../../shared/constants");
const { getIO } = require("./organization.controller");
const { sendInviteEmail } = require("../lib/email");
const { postSystemMessage } = require("../../shared/chatUtils");
const { recordAudit } = require("../lib/audit");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const maskEmail = (email) => {
  const [local, domain] = email.split("@");
  const visible = local.slice(0, 1);
  return `${visible}${"*".repeat(Math.max(local.length - 1, 2))}@${domain}`;
};

const buildInviteUrl = (token) =>
  `${process.env.CLIENT_URL || "http://localhost:3000"}/invite/${token}`;

// 1️⃣ Create Invite (admin+; inviting as admin requires owner)
const createInvite = async (req, res) => {
  try {
    const organization = req.organization;
    const actorId = req.user.id;
    const { email, role = "employee", message = "" } = req.body;

    if (!email || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({
        success: false,
        error: "A valid email address is required.",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    if (!["admin", "manager", "employee"].includes(role)) {
      return res.status(400).json({
        success: false,
        error: "Invite role must be admin, manager or employee.",
      });
    }

    if (role === "admin" && req.orgMembership.role !== "owner") {
      return res.status(403).json({
        success: false,
        error: "Only the owner can invite admins.",
      });
    }

    // Existing user with this email already a member?
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      const alreadyMember = await OrgMembership.exists({
        organization: organization._id,
        user: existingUser._id,
      });
      if (alreadyMember) {
        return res.status(409).json({
          success: false,
          error: "This user is already a member of the organization.",
        });
      }
    }

    // Duplicate pending invite?
    const pendingInvite = await OrgInvite.findOne({
      organization: organization._id,
      email: normalizedEmail,
      status: "pending",
    });
    if (pendingInvite) {
      return res.status(409).json({
        success: false,
        error: "A pending invite already exists for this email.",
        data: { inviteId: pendingInvite._id },
      });
    }

    const token = crypto.randomBytes(24).toString("hex");

    const invite = await OrgInvite.create({
      organization: organization._id,
      email: normalizedEmail,
      role,
      token,
      invitedBy: actorId,
      message,
    });

    await recordAudit({
      organization: organization._id,
      actor: actorId,
      action: "member.invited",
      targetLabel: normalizedEmail,
      details: { role },
    });

    // If the invitee already has an account, notify them in-app
    if (existingUser) {
      try {
        const notification = await Notification.createNotification({
          recipient: existingUser._id,
          sender: actorId,
          type: "group_invite",
          title: `You've been invited to join ${organization.name}`,
          body: message || `Join ${organization.name} on TeamSpace as ${role}.`,
          data: {
            kind: "organization",
            organizationId: organization._id.toString(),
            inviteToken: token,
          },
        });

        const io = getIO(req);
        if (io) {
          io.to(`user:${existingUser._id}`).emit(ORG_EVENTS.INVITE_RECEIVED, {
            invite: {
              token,
              role,
              organization: {
                _id: organization._id,
                name: organization.name,
                logo: organization.logo,
              },
            },
            notification,
          });
        }
      } catch (notifyErr) {
        // Invite still succeeds even if the notification fails
        console.error("Invite notification error:", notifyErr.message);
      }
    }

    // Send the invitation email via Resend (invite still succeeds if it fails)
    const inviteUrl = buildInviteUrl(token);
    const emailResult = await sendInviteEmail({
      to: normalizedEmail,
      organizationName: organization.name,
      inviterName: req.user.username,
      role,
      inviteUrl,
      personalMessage: message,
      expiresAt: invite.expiresAt,
    });

    res.status(201).json({
      success: true,
      message: emailResult.sent
        ? "Invitation email sent."
        : existingUser
          ? "Invite created and the user was notified in-app."
          : "Invite created. Share the invite link with the person.",
      data: {
        invite,
        inviteUrl,
        emailSent: emailResult.sent,
        ...(emailResult.sent ? {} : { emailSkippedReason: emailResult.reason }),
      },
    });
  } catch (err) {
    console.error("Create Invite Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to create invite.",
    });
  }
};

// 2️⃣ List Pending Invites (admin+)
const listInvites = async (req, res) => {
  try {
    const invites = await OrgInvite.find({
      organization: req.organization._id,
      status: "pending",
    })
      .populate("invitedBy", "username avatar")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: invites.length,
      data: invites,
    });
  } catch (err) {
    console.error("List Invites Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch invites.",
    });
  }
};

// 3️⃣ Revoke Invite (admin+)
const revokeInvite = async (req, res) => {
  try {
    const { inviteId } = req.params;

    const invite = await OrgInvite.findOne({
      _id: inviteId,
      organization: req.organization._id,
    });

    if (!invite) {
      return res.status(404).json({
        success: false,
        error: "Invite not found.",
      });
    }

    if (invite.status !== "pending") {
      return res.status(400).json({
        success: false,
        error: `Invite is already ${invite.status}.`,
      });
    }

    invite.status = "revoked";
    await invite.save();

    await recordAudit({
      organization: req.organization._id,
      actor: req.user.id,
      action: "invite.revoked",
      targetLabel: invite.email,
    });

    res.status(200).json({
      success: true,
      message: "Invite revoked.",
    });
  } catch (err) {
    console.error("Revoke Invite Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to revoke invite.",
    });
  }
};

// 4️⃣ Get Invite Info by token (public — shown on the invite landing page)
const getInvite = async (req, res) => {
  try {
    const { token } = req.params;

    const invite = await OrgInvite.findOne({ token })
      .populate("organization", "name slug logo description isActive")
      .populate("invitedBy", "username avatar");

    if (!invite || !invite.organization) {
      return res.status(404).json({
        success: false,
        error: "Invite not found.",
      });
    }

    // Lazily mark expired pending invites
    if (
      invite.status === "pending" &&
      invite.expiresAt &&
      invite.expiresAt < new Date()
    ) {
      invite.status = "expired";
      await invite.save();
    }

    res.status(200).json({
      success: true,
      data: {
        organization: invite.organization,
        role: invite.role,
        invitedBy: invite.invitedBy,
        email: maskEmail(invite.email),
        message: invite.message,
        status: invite.status,
        expiresAt: invite.expiresAt,
      },
    });
  } catch (err) {
    console.error("Get Invite Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch invite.",
    });
  }
};

// 5️⃣ Accept Invite (authenticated; email must match the invite)
const acceptInvite = async (req, res) => {
  try {
    const { token } = req.params;
    const userId = req.user.id;

    const invite = await OrgInvite.findOne({ token });
    if (!invite) {
      return res.status(404).json({
        success: false,
        error: "Invite not found.",
      });
    }

    if (invite.status !== "pending") {
      return res.status(410).json({
        success: false,
        error: `This invite is ${invite.status}.`,
      });
    }

    if (invite.expiresAt && invite.expiresAt < new Date()) {
      invite.status = "expired";
      await invite.save();
      return res.status(410).json({
        success: false,
        error: "This invite has expired.",
      });
    }

    const organization = await Organization.findById(invite.organization);
    if (!organization || !organization.isActive) {
      return res.status(410).json({
        success: false,
        error: "This organization no longer exists.",
      });
    }

    // The invite is bound to an email address
    const me = await User.findById(userId);
    if (!me || me.email !== invite.email) {
      return res.status(403).json({
        success: false,
        error: "This invite was sent to a different email address.",
      });
    }

    // Already a member? Close out the invite quietly.
    const existingMembership = await OrgMembership.findOne({
      organization: organization._id,
      user: userId,
    });
    if (existingMembership) {
      invite.status = "accepted";
      invite.acceptedBy = userId;
      invite.expiresAt = undefined;
      await invite.save();
      return res.status(200).json({
        success: true,
        message: "You are already a member of this organization.",
        data: { organization, membership: existingMembership },
      });
    }

    // Invited users join with the role on the invite (employee by default)
    const membership = await OrgMembership.create({
      organization: organization._id,
      user: userId,
      role: invite.role,
      invitedBy: invite.invitedBy,
    });

    // Auto-join the org's default channels (#general, #announcements)
    const defaultChannels = await Conversation.find({
      organizationId: organization._id,
      isDefault: true,
    });
    for (const channel of defaultChannels) {
      const isParticipant = channel.participants.some(
        (p) => p.toString() === userId.toString()
      );
      if (!isParticipant) {
        channel.participants.push(userId);
        channel.unreadCount.set(userId.toString(), 0);
        await channel.save();
      }
    }

    invite.status = "accepted";
    invite.acceptedBy = userId;
    invite.expiresAt = undefined; // keep accepted invites out of TTL cleanup
    await invite.save();

    await recordAudit({
      organization: organization._id,
      actor: userId,
      action: "member.joined",
      details: { role: membership.role, invitedBy: invite.invitedBy.toString() },
    });

    const io = getIO(req);

    // Welcome system message in #general
    const generalChannel = defaultChannels.find(
      (c) => c.channelType === "general"
    );
    if (generalChannel) {
      await postSystemMessage(
        io,
        generalChannel._id,
        `👋 ${me.username} joined ${organization.name}`,
        userId
      );
    }

    if (io) {
      io.in(`user:${userId}`).socketsJoin(`org:${organization._id}`);
      io.to(`org:${organization._id}`).emit(ORG_EVENTS.MEMBER_JOINED, {
        organizationId: organization._id,
        userId,
        username: me.username,
        avatar: me.avatar,
        role: membership.role,
      });
      io.to(`user:${invite.invitedBy}`).emit(ORG_EVENTS.MEMBER_JOINED, {
        organizationId: organization._id,
        userId,
        username: me.username,
        role: membership.role,
      });
    }

    res.status(200).json({
      success: true,
      message: `Welcome to ${organization.name}!`,
      data: { organization, membership },
    });
  } catch (err) {
    console.error("Accept Invite Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to accept invite.",
    });
  }
};

// 6️⃣ Decline Invite (authenticated; email must match)
const declineInvite = async (req, res) => {
  try {
    const { token } = req.params;

    const invite = await OrgInvite.findOne({ token });
    if (!invite) {
      return res.status(404).json({
        success: false,
        error: "Invite not found.",
      });
    }

    if (invite.status !== "pending") {
      return res.status(410).json({
        success: false,
        error: `This invite is ${invite.status}.`,
      });
    }

    const me = await User.findById(req.user.id);
    if (!me || me.email !== invite.email) {
      return res.status(403).json({
        success: false,
        error: "This invite was sent to a different email address.",
      });
    }

    invite.status = "declined";
    await invite.save();

    res.status(200).json({
      success: true,
      message: "Invite declined.",
    });
  } catch (err) {
    console.error("Decline Invite Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to decline invite.",
    });
  }
};

module.exports = {
  createInvite,
  listInvites,
  revokeInvite,
  getInvite,
  acceptInvite,
  declineInvite,
};
