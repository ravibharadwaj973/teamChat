// Chat helpers shared by the backend (REST) and the socket server:
// @mention resolution/notification and system messages.

const { MESSAGE_EVENTS } = require("./constants");

// Extract unique @username tokens from message text
const extractMentionUsernames = (content = "") => {
  const matches = String(content).match(/@([a-zA-Z0-9_.-]{3,20})/g) || [];
  return [...new Set(matches.map((m) => m.slice(1).toLowerCase()))];
};

// Resolve @mentions to users who are participants of the conversation
const resolveMentions = async (content, conversation) => {
  const names = extractMentionUsernames(content);
  if (names.length === 0) return [];

  const User = require("../models/user");
  const users = await User.find({
    _id: { $in: conversation.participants },
  }).select("username avatar email notificationSettings");

  return users.filter((u) => names.includes(u.username.toLowerCase()));
};

// Create mention notifications + real-time pings. Never throws.
const notifyMentions = async ({
  io,
  mentionedUsers,
  message,
  conversation,
  senderId,
  senderName,
}) => {
  try {
    const Notification = require("../models/notifications");
    const targets = (mentionedUsers || []).filter(
      (u) => u._id.toString() !== senderId.toString()
    );

    for (const user of targets) {
      const body =
        message.content && message.content.length > 80
          ? `${message.content.substring(0, 77)}...`
          : message.content || "";

      const notification = await Notification.createNotification({
        recipient: user._id,
        sender: senderId,
        type: "mention",
        title: `${senderName} mentioned you`,
        body,
        data: {
          conversationId: conversation._id.toString(),
          messageId: message._id.toString(),
        },
      });

      if (io) {
        io.to(`user:${user._id}`).emit(MESSAGE_EVENTS.MENTION, {
          conversationId: conversation._id,
          messageId: message._id,
          notification,
        });
      }

      // Important message -> email via Resend (honors user preference)
      const { emailUserIfEnabled } = require("../backend/lib/email");
      const channelName =
        conversation.groupName || conversation.displayName || "a conversation";
      emailUserIfEnabled(user, {
        subject: `${senderName} mentioned you in #${channelName}`,
        heading: `💬 ${senderName} mentioned you`,
        body: `In #${channelName}:\n\n"${message.content || ""}"`,
        ctaLabel: "Open the conversation",
      }).catch(() => {});
    }
  } catch (err) {
    console.error("Mention notify error:", err.message);
  }
};

// Post a system message into a conversation ("X joined", renames, membership
// changes). System messages do not bump unread counters. Never throws.
const postSystemMessage = async (io, conversationId, content, actorId) => {
  try {
    const Message = require("../models/message");
    const Conversation = require("../models/conversation");

    const message = await Message.create({
      conversationId,
      sender: actorId,
      content,
      messageType: "system",
    });

    await Conversation.findByIdAndUpdate(conversationId, {
      lastMessage: message._id,
    });

    if (io) {
      io.to(`conversation:${conversationId}`).emit(MESSAGE_EVENTS.NEW_MESSAGE, {
        message: message.toObject(),
        conversationId,
        system: true,
      });
    }

    return message;
  } catch (err) {
    console.error("System message error:", err.message);
    return null;
  }
};

module.exports = {
  extractMentionUsernames,
  resolveMentions,
  notifyMentions,
  postSystemMessage,
};
