const mongoose = require("mongoose");
const { connection } = require("mongoose");

const orgInviteSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    // Owner is never assignable via invite
    role: {
      type: String,
      enum: ["admin", "manager", "employee"],
      default: "employee",
    },
    token: {
      type: String,
      required: true,
      unique: true,
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "declined", "revoked", "expired"],
      default: "pending",
      index: true,
    },
    acceptedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    message: {
      type: String,
      trim: true,
      maxlength: 200,
      default: "",
    },
    // Pending invites auto-expire after 7 days (unset on accept to keep history)
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Only one pending invite per email per organization
orgInviteSchema.index(
  { organization: 1, email: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } }
);
// TTL cleanup (only deletes docs where expiresAt is set)
orgInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports =
  connection.models.OrgInvite || connection.model("OrgInvite", orgInviteSchema);
