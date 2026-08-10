const mongoose = require('mongoose');
const {connection}=require("mongoose")

const conversationSchema = new mongoose.Schema(
  {
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],
    isGroup: {
      type: Boolean,
      default: false,
    },
    groupName: {
      type: String,
      trim: true,
    },
    groupAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    groupAvatar: {
      type: String,
      trim: true,
    },
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    mutedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    archivedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  unreadCount: {
  type: Map,
  of: Number,
  default: () => new Map()
},
    typingUsers: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        typingAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    bannedUsers: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        bannedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        bannedAt: {
          type: Date,
          default: Date.now,
        },
        reason: {
          type: String,
          trim: true,
        },
      },
    ],
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // --- TeamSpace (organization) fields ---
    // Set only for org channels; personal DMs/groups leave these null
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      default: null,
      index: true,
    },
    channelType: {
      type: String,
      enum: ["general", "announcement", "team", "custom"],
    },
    // Default org channels (e.g. #general) auto-add new members on join
    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes for better query performance
conversationSchema.index({ participants: 1 });
conversationSchema.index({ isGroup: 1 });
conversationSchema.index({ updatedAt: -1 });
conversationSchema.index({ 'mutedBy': 1 });
conversationSchema.index({ 'archivedBy': 1 });

// Virtual for messages
conversationSchema.virtual('messages', {
  ref: 'Message',
  localField: '_id',
  foreignField: 'conversationId',
});

// Virtual for last message details
conversationSchema.virtual('lastMessageDetails', {
  ref: 'Message',
  localField: 'lastMessage',
  foreignField: '_id',
  justOne: true,
});

module.exports = connection.models.Conversation || connection.model('Conversation', conversationSchema);
