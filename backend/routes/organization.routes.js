const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth.middleware");
const {
  requireOrgMember,
  requireOrgRole,
} = require("../middleware/org.middleware");

const {
  createOrganization,
  getMyOrganizations,
  getOrganizationById,
  updateOrganization,
  deleteOrganization,
  getMembers,
  getDirectory,
  updateMemberProfile,
  updateMemberRole,
  removeMember,
  leaveOrganization,
  transferOwnership,
} = require("../controllers/organization.controller");

const {
  createInvite,
  listInvites,
  revokeInvite,
} = require("../controllers/invite.controller");

const {
  createTeam,
  getTeams,
  getMyTeams,
  getTeamById,
  updateTeam,
  deleteTeam,
  addTeamMember,
  removeTeamMember,
  setTeamManager,
} = require("../controllers/team.controller");

const {
  createDepartment,
  getDepartments,
  getDepartmentById,
  updateDepartment,
  deleteDepartment,
  getOrgStructure,
} = require("../controllers/department.controller");

const {
  createTeamChannel,
  getTeamChannels,
  updateTeamChannel,
  deleteTeamChannel,
} = require("../controllers/channel.controller");

const {
  createAnnouncement,
  listAnnouncements,
  ackAnnouncement,
  getAnnouncementAcks,
  deleteAnnouncement,
} = require("../controllers/announcement.controller");

const {
  createTask,
  listTasks,
  getAssignableMembers,
  getTaskById,
  updateTaskStatus,
  updateTask,
  deleteTask,
} = require("../controllers/task.controller");

const {
  uploadFile,
  listFiles,
  deleteFile,
} = require("../controllers/file.controller");

const {
  createEvent,
  listEvents,
  updateEvent,
  deleteEvent,
} = require("../controllers/event.controller");

const { getDashboard, getAuditLogs } = require("../controllers/dashboard.controller");
const { askAssistant } = require("../controllers/ai.controller");

// Multipart parsing for file sharing (memory -> Cloudinary stream)
const multer = require("multer");
const MAX_FILE_BYTES = parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024;
const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
});
const parseFileUpload = (req, res, next) =>
  fileUpload.single("file")(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        error:
          err.code === "LIMIT_FILE_SIZE"
            ? `File too large (max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB).`
            : err.message,
      });
    }
    next();
  });

// All organization APIs require auth
router.use(authenticate);

// --- Organizations ---
router.post("/", createOrganization);
router.get("/", getMyOrganizations);
router.get("/:orgId", requireOrgMember, getOrganizationById);
router.put("/:orgId", requireOrgMember, requireOrgRole("admin"), updateOrganization);
router.delete("/:orgId", requireOrgMember, requireOrgRole("owner"), deleteOrganization);

// --- AI assistant (backend-mediated Groq; context is permission-scoped) ---
router.post("/:orgId/ai/ask", requireOrgMember, askAssistant);

// --- Admin dashboard (org-level overview) ---
router.get(
  "/:orgId/dashboard",
  requireOrgMember,
  requireOrgRole("admin"),
  getDashboard
);
// Audit trail of important actions (role changes, removals, structure changes)
router.get(
  "/:orgId/audit",
  requireOrgMember,
  requireOrgRole("admin"),
  getAuditLogs
);

// --- Membership ---
router.get("/:orgId/members", requireOrgMember, getMembers);
// Employee directory: search by department, team, role or job title
router.get("/:orgId/directory", requireOrgMember, getDirectory);
router.patch(
  "/:orgId/members/:userId/profile",
  requireOrgMember,
  updateMemberProfile
);
router.patch(
  "/:orgId/members/:userId/role",
  requireOrgMember,
  requireOrgRole("admin"),
  updateMemberRole
);
router.delete(
  "/:orgId/members/:userId",
  requireOrgMember,
  requireOrgRole("admin"),
  removeMember
);
router.post("/:orgId/leave", requireOrgMember, leaveOrganization);
router.post(
  "/:orgId/transfer-ownership",
  requireOrgMember,
  requireOrgRole("owner"),
  transferOwnership
);

// --- Invites (org-scoped; accept/decline live in /api/invites) ---
router.post("/:orgId/invites", requireOrgMember, requireOrgRole("admin"), createInvite);
router.get("/:orgId/invites", requireOrgMember, requireOrgRole("admin"), listInvites);
router.delete(
  "/:orgId/invites/:inviteId",
  requireOrgMember,
  requireOrgRole("admin"),
  revokeInvite
);

// --- Structure (departments with their teams, as a tree) ---
router.get("/:orgId/structure", requireOrgMember, getOrgStructure);

// --- Departments ---
router.post(
  "/:orgId/departments",
  requireOrgMember,
  requireOrgRole("admin"),
  createDepartment
);
router.get("/:orgId/departments", requireOrgMember, getDepartments);
router.get(
  "/:orgId/departments/:departmentId",
  requireOrgMember,
  getDepartmentById
);
router.put(
  "/:orgId/departments/:departmentId",
  requireOrgMember,
  requireOrgRole("admin"),
  updateDepartment
);
router.delete(
  "/:orgId/departments/:departmentId",
  requireOrgMember,
  requireOrgRole("admin"),
  deleteDepartment
);

// --- Teams ---
router.post("/:orgId/teams", requireOrgMember, requireOrgRole("admin"), createTeam);
router.get("/:orgId/teams", requireOrgMember, getTeams);
router.get("/:orgId/teams/my", requireOrgMember, getMyTeams);
router.get("/:orgId/teams/:teamId", requireOrgMember, getTeamById);
router.put("/:orgId/teams/:teamId", requireOrgMember, updateTeam);
router.delete(
  "/:orgId/teams/:teamId",
  requireOrgMember,
  requireOrgRole("admin"),
  deleteTeam
);
router.post("/:orgId/teams/:teamId/members", requireOrgMember, addTeamMember);
router.delete(
  "/:orgId/teams/:teamId/members/:userId",
  requireOrgMember,
  removeTeamMember
);
router.patch(
  "/:orgId/teams/:teamId/manager",
  requireOrgMember,
  requireOrgRole("admin"),
  setTeamManager
);

// --- Announcements (company-wide notices; posting rule checked inside:
//     owner/admin/manager or HR-department members) ---
router.post("/:orgId/announcements", requireOrgMember, createAnnouncement);
router.get("/:orgId/announcements", requireOrgMember, listAnnouncements);
router.post(
  "/:orgId/announcements/:announcementId/ack",
  requireOrgMember,
  ackAnnouncement
);
router.get(
  "/:orgId/announcements/:announcementId/acks",
  requireOrgMember,
  getAnnouncementAcks
);
router.delete(
  "/:orgId/announcements/:announcementId",
  requireOrgMember,
  deleteAnnouncement
);

// --- Tasks (managers assign work; role/scope checks inside) ---
router.post("/:orgId/tasks", requireOrgMember, createTask);
router.get("/:orgId/tasks", requireOrgMember, listTasks);
router.get("/:orgId/tasks/assignable", requireOrgMember, getAssignableMembers);
router.get("/:orgId/tasks/:taskId", requireOrgMember, getTaskById);
router.patch("/:orgId/tasks/:taskId/status", requireOrgMember, updateTaskStatus);
router.put("/:orgId/tasks/:taskId", requireOrgMember, updateTask);
router.delete("/:orgId/tasks/:taskId", requireOrgMember, deleteTask);

// --- Calendar (meetings, events, deadlines; scope checks inside) ---
router.post("/:orgId/events", requireOrgMember, createEvent);
router.get("/:orgId/events", requireOrgMember, listEvents);
router.put("/:orgId/events/:eventId", requireOrgMember, updateEvent);
router.delete("/:orgId/events/:eventId", requireOrgMember, deleteEvent);

// --- File sharing (Cloudinary; team-scoped or org-wide) ---
router.post(
  "/:orgId/files",
  requireOrgMember,
  parseFileUpload,
  uploadFile
);
router.get("/:orgId/files", requireOrgMember, listFiles);
router.delete("/:orgId/files/:fileId", requireOrgMember, deleteFile);

// --- Team Channels (manage checks inside: org admin+ or team manager) ---
router.post(
  "/:orgId/teams/:teamId/channels",
  requireOrgMember,
  createTeamChannel
);
router.get("/:orgId/teams/:teamId/channels", requireOrgMember, getTeamChannels);
router.put(
  "/:orgId/teams/:teamId/channels/:channelId",
  requireOrgMember,
  updateTeamChannel
);
router.delete(
  "/:orgId/teams/:teamId/channels/:channelId",
  requireOrgMember,
  deleteTeamChannel
);

module.exports = router;
