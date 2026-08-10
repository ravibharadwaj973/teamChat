const mongoose = require("mongoose");
const { connection } = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    content: {
      type: String,
      trim: true,
      required: function() {
        return this.messageType === "text"; // Required only for text messages
      },
    },
    messageType: {
      type: String,
      enum: ["text", "image", "video", "file", "audio", "system"],
      default: "text",
      required: true,
    },
    mediaUrl: {
      type: String,
      default: null,
    },
    repliedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    reactions: [
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    emoji: { type: String, required: true },
    addedAt: { type: Date, default: Date.now }
  }
],
    readBy: [{
      user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      readAt: { type: Date, default: Date.now }
    }],
    deliveredTo: [{
      user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      deliveredAt: { type: Date, default: Date.now }
    }],
    // Users the message was mentioned to via @username
    mentions: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    }],
    // Edited-message tracking
    edited: {
      type: Boolean,
      default: false,
    },
    editedAt: {
      type: Date,
      default: null,
    },
    // Pinned messages (channels)
    pinned: {
      type: Boolean,
      default: false,
    },
    pinnedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    pinnedAt: {
      type: Date,
      default: null,
    },
    // "Delete for me": users who hid this message for themselves
    deletedBy: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    }],
    deleted: {
      type: Boolean,
      default: false,
    },
    // Keep this only if you want messages to auto-delete after 30 days
    expiresAt: {
      type: Date,
      default: null, // Set to null by default so messages stay forever
    }
  },
  { 
    timestamps: true, // Use standard timestamps (createdAt, updatedAt)
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// --- INDEXES ---
messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ conversationId: 1, pinned: 1 });
messageSchema.index({ mentions: 1 });
// TTL Index: Only deletes if expiresAt is set to a date
messageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// --- VIRTUAL: Time Ago ---
messageSchema.virtual('timeAgo').get(function() {
  if (!this.createdAt) return "just now";
  const seconds = Math.floor((new Date() - this.createdAt) / 1000);
  
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + " years ago";
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + " months ago";
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + " days ago";
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + " hours ago";
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + " minutes ago";
  
  return seconds < 5 ? "just now" : Math.floor(seconds) + " seconds ago";
});

// --- VIRTUAL: Formatted Date ---
messageSchema.virtual('formattedDate').get(function() {
  if (!this.createdAt) return "";
  return this.createdAt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
});

const Message = connection.models.Message || connection.model("Message", messageSchema);

module.exports = Message;