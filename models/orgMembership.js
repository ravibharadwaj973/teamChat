const mongoose = require("mongoose");
const { connection } = require("mongoose");

// Role hierarchy: owner > admin > manager > employee
// (levels live in shared/permissions.js)
const orgMembershipSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ["owner", "admin", "manager", "employee"],
      default: "employee",
      index: true,
    },
    jobTitle: {
      type: String,
      trim: true,
      maxlength: 60,
      default: "",
    },
    department: {
      type: String,
      trim: true,
      maxlength: 60,
      default: "",
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// One membership per user per organization
orgMembershipSchema.index({ organization: 1, user: 1 }, { unique: true });
orgMembershipSchema.index({ user: 1, role: 1 });

module.exports =
  connection.models.OrgMembership ||
  connection.model("OrgMembership", orgMembershipSchema);
