const mongoose = require("mongoose");
const { connection } = require("mongoose");

// Immutable record of important org actions (role changes, removals, ...)
const auditLogSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    // Who performed the action
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Machine-readable action key, e.g. "member.role_changed"
    action: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60,
      index: true,
    },
    // Affected user, when the action targets a person
    targetUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    // Affected entity name (team, channel, file, email…)
    targetLabel: {
      type: String,
      trim: true,
      maxlength: 200,
      default: "",
    },
    // Small structured context ({from, to}, {role}, …)
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

auditLogSchema.index({ organization: 1, createdAt: -1 });
auditLogSchema.index({ organization: 1, action: 1, createdAt: -1 });

module.exports =
  connection.models.AuditLog || connection.model("AuditLog", auditLogSchema);
