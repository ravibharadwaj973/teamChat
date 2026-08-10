const Message = require("../../models/message");
const Conversation = require("../../models/conversation");
const OrgMembership = require("../../models/orgMembership");
const mongoose = require("mongoose");
const redisClient =require("../lib/redis")
const { canPostToChannel, hasMinRole, canViewConversation } = require("../../shared/permissions");
const { resolveMentions, notifyMentions } = require("../../shared/chatUtils");
const { MESSAGE_EVENTS } = require("../../shared/constants");

const escapeRegex = (str = "") => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Moderation: sender, the channel admin, or an org admin+ may delete a message
const canModerateMessage = async (message, conversation, userId) => {
  if (message.sender.toString() === userId.toString()) return true;
  if (conversation.groupAdmin && conversation.groupAdmin.toString() === userId.toString()) {
    return true;
  }
  if (conversation.organizationId) {
    const membership = await OrgMembership.findOne({
      organization: conversation.organizationId,
      user: userId,
    }).lean();
    return !!membership && hasMinRole(membership.role, "admin");
  }
  return false;
};

// Pinning: any participant in DMs/groups; manager+ (or channel admin) in org channels
const canPinInConversation = async (conversation, userId) => {
  if (!conversation.organizationId) return true;
  if (conversation.groupAdmin && conversation.groupAdmin.toString() === userId.toString()) {
    return true;
  }
  const membership = await OrgMembership.findOne({
    organization: conversation.organizationId,
    user: userId,
  }).lean();
  return !!membership && hasMinRole(membership.role, "manager");
};


const sendMessage = async (req, res) => {
  try {
    const { content, conversationId, type, mediaUrl = null, repliedTo = null } = req.body;
    const userId = req.user.id;

    // 1. Verify conversation exists and user is a participant
    const conversation = await Conversation.findById(conversationId);
    if (conversation && !(await canViewConversation(conversation, userId))) {
      return res.status(404).json({ success: false, error: "Conversation not found." });
    }

    if (!conversation) {
      return res.status(404).json({ success: false, error: "Conversation not found." });
    }

    // TeamSpace: announcement channels are manager+ only
    const postCheck = await canPostToChannel(conversation, userId);
    if (!postCheck.allowed) {
      return res.status(403).json({ success: false, error: postCheck.reason });
    }

    // 2. Resolve @mentions among the participants
    const mentionedUsers = await resolveMentions(content, conversation);

    // 3. Create and save message
    const newMessage = new Message({
      conversationId,
      sender: userId,
      content,
      messageType: type || "text",
      mediaUrl,
      repliedTo: repliedTo || null, // Ensure this matches your Schema field name
      mentions: mentionedUsers.map((u) => u._id),
    });
    await newMessage.save();

    // 3. Populate correctly (Using the field name 'repliedTo')
    const populatedMessage = await Message.findById(newMessage._id)
      .populate("sender", "username avatar")
      .populate({
        path: "repliedTo",
        populate: { path: "sender", select: "username avatar" },
      });

    // 4. Update conversation metadata
    conversation.lastMessage = newMessage._id;
    // You should know this: We increment unread count for everyone EXCEPT the sender
    conversation.participants.forEach(pId => {
      if (pId.toString() !== userId.toString()) {
        const currentCount = conversation.unreadCount.get(pId.toString()) || 0;
        conversation.unreadCount.set(pId.toString(), currentCount + 1);
      }
    });
    await conversation.save();

    // 5. --- SOCKET REAL-TIME NOTIFICATION ---
    const socketServer = req.app.get("socketServer");
    if (socketServer) {
      // Send to the conversation room (same payload shape as the socket send path)
      socketServer.io
        .to(`conversation:${conversationId}`)
        .emit("new-message", {
          message: populatedMessage,
          conversationId: conversationId.toString(),
        });

      // Notify participants who aren't in the room to update their sidebar/unread count
      conversation.participants.forEach(pId => {
        if (pId.toString() !== userId.toString()) {
          socketServer.io.to(`user:${pId}`).emit("update-conversation-list", {
            conversationId,
            lastMessage: populatedMessage,
          });
        }
      });
    }

    // 6. --- REDIS CACHE INVALIDATION (best-effort; never block the send) ---
    const redis = req.app.get("redis");
    if (redis && redis.isReady) {
      try {
        await Promise.all(
          conversation.participants.map(pId => redis.del(`conversations:${pId}`))
        );
      } catch (cacheErr) {
        console.error("Cache invalidation skipped:", cacheErr.message);
      }
    }

    // 7. --- MENTION NOTIFICATIONS ---
    if (mentionedUsers.length > 0) {
      await notifyMentions({
        io: socketServer ? socketServer.io : null,
        mentionedUsers,
        message: populatedMessage,
        conversation,
        senderId: userId,
        senderName: populatedMessage.sender.username,
      });
    }

    return res.status(201).json({
      success: true,
      data: populatedMessage,
    });

  } catch (err) {
    console.error("Send Message Error:", err);
    return res.status(500).json({ success: false, error: "Failed to send message." });
  }
};
// -------------------------
// 1. GET MESSAGE HISTORY
// -------------------------
const getmessage = async (req,res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const skip = (page - 1) * limit;

    // Validate conversation
    const conversation = await Conversation.findById(conversationId);
    if (conversation && !(await canViewConversation(conversation, userId))) {
      return res.status(404).json({ success: false, error: "Conversation not found." });
    }

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Conversation not found.",
      });
    }

    // Fetch messages (skip ones this user deleted for themselves)
    const messages = await Message.find({
      conversationId,
      deletedBy: { $ne: userId },
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("sender", "username avatar")
      .populate("mentions", "username avatar")
      .populate({
        path: "repliedTo",
        select: "content sender type mediaUrl",
        populate: { path: "sender", select: "username avatar" },
      });

    const total = await Message.countDocuments({
      conversationId,
      deletedBy: { $ne: userId },
    });

    res.status(200).json({
      success: true,
      page,
      totalPages: Math.ceil(total / limit),
      count: messages.length,
      data: messages.reverse(),
    });
  } catch (err) {
    console.error("Get Messages Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch messages.",
    });
  }
};

// -------------------------
// 2. SEARCH MESSAGES
// -------------------------
const searchmessage = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { query } = req.query;
    const userId = req.user.id;

    if (!query || query.trim().length < 1) {
      return res.status(400).json({
        success: false,
        error: "Search query is required.",
      });
    }

    const conversation = await Conversation.findById(conversationId);
    if (conversation && !(await canViewConversation(conversation, userId))) {
      return res.status(404).json({ success: false, error: "Conversation not found." });
    }

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Conversation not found.",
      });
    }

    const messages = await Message.find({
      conversationId,
      content: { $regex: escapeRegex(query), $options: "i" },
      deletedBy: { $ne: userId },
    })
      .sort({ createdAt: -1 })
      .populate("sender", "username avatar");

    res.status(200).json({
      success: true,
      count: messages.length,
      data: messages,
    });
  } catch (err) {
    console.error("Search Messages Error:", err);
    res.status(500).json({
      success: false,
      error: "Search failed.",
    });
  }
};

// -------------------------
// 3. GET SINGLE MESSAGE
// -------------------------
const getMessageById = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    const message = await Message.findById(messageId)
      .populate("sender", "username avatar")
      .populate("mentions", "username avatar")
      .populate({
        path: "repliedTo",
        select: "content sender type mediaUrl",
        populate: { path: "sender", select: "username avatar" },
      });

    if (!message) {
      return res.status(404).json({
        success: false,
        error: "Message not found.",
      });
    }

    // Participants — or org admins with oversight access — can read a message
    const parentConv = await Conversation.findById(message.conversationId);
    const hasAccess = await canViewConversation(parentConv, userId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: "You do not have access to this message.",
      });
    }

    res.status(200).json({
      success: true,
      data: message,
    });
  } catch (err) {
    console.error("Get Message Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch message.",
    });
  }
};

// -------------------------
// 4. DELETE MESSAGE (HTTP)
// -------------------------
const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({
        success: false,
        error: "Message not found.",
      });
    }

    const conversation = await Conversation.findById(message.conversationId);
    if (conversation && !(await canViewConversation(conversation, userId))) {
      return res.status(403).json({
        success: false,
        error: "You are not a participant of this conversation.",
      });
    }
    if (!conversation) {
      return res.status(403).json({
        success: false,
        error: "You are not a participant of this conversation.",
      });
    }

    // Sender always; channel admin / org admin+ may moderate
    if (!(await canModerateMessage(message, conversation, userId))) {
      return res.status(403).json({
        success: false,
        error: "You can delete only your own messages.",
      });
    }

    message.deleted = true;
    message.deletedAt = new Date();
    message.content = "This message was deleted";
    message.mediaUrl = null;
    message.pinned = false;
    message.pinnedBy = null;
    message.pinnedAt = null;

    await message.save();

    // Let everyone in the conversation see the deletion live
    const socketServer = req.app.get("socketServer");
    if (socketServer) {
      socketServer.io
        .to(`conversation:${message.conversationId}`)
        .emit(MESSAGE_EVENTS.MESSAGE_DELETED_FOR_EVERYONE, {
          messageId: message._id,
          conversationId: message.conversationId,
          deletedBy: userId,
          deletedAt: message.deletedAt,
        });
    }

    res.status(200).json({
      success: true,
      message: "Message deleted.",
    });
  } catch (err) {
    console.error("Delete Message Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to delete message.",
    });
  }
};
// -------------------------
// 5. EDIT MESSAGE (sender only, text messages)
// -------------------------
const editMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { content } = req.body;
    const userId = req.user.id;

    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        error: "Message content is required.",
      });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        error: "Message not found.",
      });
    }

    if (message.sender.toString() !== userId) {
      return res.status(403).json({
        success: false,
        error: "You can edit only your own messages.",
      });
    }

    if (message.deleted) {
      return res.status(400).json({
        success: false,
        error: "Deleted messages cannot be edited.",
      });
    }

    if (message.messageType !== "text") {
      return res.status(400).json({
        success: false,
        error: "Only text messages can be edited.",
      });
    }

    const conversation = await Conversation.findById(message.conversationId);
    if (conversation && !(await canViewConversation(conversation, userId))) {
      return res.status(403).json({
        success: false,
        error: "You are not a participant of this conversation.",
      });
    }
    if (!conversation) {
      return res.status(403).json({
        success: false,
        error: "You are not a participant of this conversation.",
      });
    }

    message.content = content.trim();
    message.edited = true;
    message.editedAt = new Date();
    // Refresh mentions to match the new text (no re-notification on edit)
    const mentionedUsers = await resolveMentions(message.content, conversation);
    message.mentions = mentionedUsers.map((u) => u._id);
    await message.save();

    const populated = await Message.findById(message._id)
      .populate("sender", "username avatar")
      .populate("mentions", "username avatar");

    const socketServer = req.app.get("socketServer");
    if (socketServer) {
      socketServer.io
        .to(`conversation:${message.conversationId}`)
        .emit(MESSAGE_EVENTS.MESSAGE_EDITED, {
          message: populated,
          conversationId: message.conversationId,
        });
    }

    res.status(200).json({
      success: true,
      message: "Message edited.",
      data: populated,
    });
  } catch (err) {
    console.error("Edit Message Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to edit message.",
    });
  }
};

// -------------------------
// 6. PIN / UNPIN MESSAGE
// -------------------------
const setMessagePinned = (pinned) => async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        error: "Message not found.",
      });
    }

    const conversation = await Conversation.findById(message.conversationId);
    if (conversation && !(await canViewConversation(conversation, userId))) {
      return res.status(403).json({
        success: false,
        error: "You are not a participant of this conversation.",
      });
    }
    if (!conversation) {
      return res.status(403).json({
        success: false,
        error: "You are not a participant of this conversation.",
      });
    }

    if (!(await canPinInConversation(conversation, userId))) {
      return res.status(403).json({
        success: false,
        error: "Only managers and admins can pin messages in org channels.",
      });
    }

    if (pinned && message.deleted) {
      return res.status(400).json({
        success: false,
        error: "Deleted messages cannot be pinned.",
      });
    }

    message.pinned = pinned;
    message.pinnedBy = pinned ? userId : null;
    message.pinnedAt = pinned ? new Date() : null;
    await message.save();

    const socketServer = req.app.get("socketServer");
    if (socketServer) {
      socketServer.io
        .to(`conversation:${message.conversationId}`)
        .emit(
          pinned ? MESSAGE_EVENTS.MESSAGE_PINNED : MESSAGE_EVENTS.MESSAGE_UNPINNED,
          {
            messageId: message._id,
            conversationId: message.conversationId,
            pinnedBy: pinned ? userId : null,
          }
        );
    }

    res.status(200).json({
      success: true,
      message: pinned ? "Message pinned." : "Message unpinned.",
      data: { messageId: message._id, pinned },
    });
  } catch (err) {
    console.error("Pin Message Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to update pin.",
    });
  }
};

const pinMessage = setMessagePinned(true);
const unpinMessage = setMessagePinned(false);

// -------------------------
// 7. GET PINNED MESSAGES
// -------------------------
const getPinnedMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    const conversation = await Conversation.findById(conversationId);
    if (conversation && !(await canViewConversation(conversation, userId))) {
      return res.status(404).json({ success: false, error: "Conversation not found." });
    }
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Conversation not found.",
      });
    }

    const pins = await Message.find({
      conversationId,
      pinned: true,
      deleted: false,
    })
      .sort({ pinnedAt: -1 })
      .populate("sender", "username avatar")
      .populate("pinnedBy", "username avatar");

    res.status(200).json({
      success: true,
      count: pins.length,
      data: pins,
    });
  } catch (err) {
    console.error("Get Pins Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch pinned messages.",
    });
  }
};

// -------------------------
// 8. MARK CONVERSATION READ (zero my unread counter, stamp readBy)
// -------------------------
const markConversationRead = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    const conversation = await Conversation.findById(conversationId);
    if (conversation && !(await canViewConversation(conversation, userId))) {
      return res.status(404).json({ success: false, error: "Conversation not found." });
    }
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Conversation not found.",
      });
    }

    conversation.unreadCount.set(userId.toString(), 0);
    await conversation.save();

    const result = await Message.updateMany(
      {
        conversationId,
        sender: { $ne: userId },
        "readBy.user": { $ne: userId },
      },
      { $addToSet: { readBy: { user: userId, readAt: new Date() } } }
    );

    const socketServer = req.app.get("socketServer");
    if (socketServer) {
      socketServer.io
        .to(`conversation:${conversationId}`)
        .emit(MESSAGE_EVENTS.CONVERSATION_READ, {
          conversationId,
          userId,
        });
    }

    res.status(200).json({
      success: true,
      message: "Conversation marked as read.",
      data: { markedRead: result.modifiedCount },
    });
  } catch (err) {
    console.error("Mark Conversation Read Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to mark conversation as read.",
    });
  }
};

module.exports = {
  sendMessage,
  getMessageById,
  deleteMessage,
  getmessage,
  searchmessage,
  editMessage,
  pinMessage,
  unpinMessage,
  getPinnedMessages,
  markConversationRead,
};
{/**
   console.log(conversation.participants)
    const participantArray = conversation.participants || [];
   
    const recipients = participantArray.filter(
      (p) => p.toString() !== userId.toString()
    );

    // Create notifications and publish to Redis if there are recipients
    if (recipients.length > 0) {
      const notificationPromises = recipients.map(async (recipientId) => {
        if (!recipientId) return null;

        return await Notification.create({
          recipient: "697c3faa070b5310004252a0",
          sender: userId,
          type: "message",
          title: `New message from ${populatedMessage.sender.username}`,
          body: content.length > 50 ? content.substring(0, 47) + "..." : content,
          data: {
            conversationId: conversationId,
            messageId: newMessage._id,
          }
        });
      });

      const savedNotifications = await Promise.all(notificationPromises);

      // Publish each notification to Redis
      savedNotifications.forEach(async (notif) => {
        if (notif) {
          await redisClient.publish('NEW_NOTIFICATION', JSON.stringify({
            recipientId: notif.recipient.toString(),
            notification: notif
          }));
        }
      });
    }
 */}