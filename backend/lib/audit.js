// Audit trail recorder. Never throws — a failed audit write must not
// break the action being audited.
const recordAudit = async ({
  organization,
  actor,
  action,
  targetUser = null,
  targetLabel = "",
  details = {},
}) => {
  try {
    const AuditLog = require("../../models/auditLog");
    await AuditLog.create({
      organization,
      actor,
      action,
      targetUser,
      targetLabel,
      details,
    });
  } catch (err) {
    console.error("Audit log error:", err.message);
  }
};

module.exports = { recordAudit };
