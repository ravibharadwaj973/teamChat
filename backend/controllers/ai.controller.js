const User = require("../../models/user");
const OrgMembership = require("../../models/orgMembership");
const Department = require("../../models/department");
const Team = require("../../models/team");
const Conversation = require("../../models/conversation");
const Message = require("../../models/message");
const Announcement = require("../../models/announcement");
const Task = require("../../models/task");
const Event = require("../../models/event");
const File = require("../../models/file");
const OrgInvite = require("../../models/orgInvite");
const AuditLog = require("../../models/auditLog");
const { hasMinRole } = require("../../shared/permissions");
const { chatCompletion } = require("../lib/groq");

const clip = (str = "", max = 220) =>
  String(str).length > max ? `${String(str).slice(0, max - 1)}…` : String(str);

// Builds the workspace context for THIS user — every query below applies the
// same authorization rules as the REST endpoints, so the LLM only ever sees
// data the requester is already allowed to read.
const buildContext = async (organization, membership, userId) => {
  const orgId = organization._id;
  const isAdmin = hasMinRole(membership.role, "admin");
  const isManagerPlus = hasMinRole(membership.role, "manager");
  const now = new Date();
  const in14d = new Date(now.getTime() + 14 * 24 * 3600 * 1000);

  const [me, memberships, departments, teams, myConvs, announcements, myTasks] =
    await Promise.all([
      User.findById(userId).select("username email"),
      OrgMembership.find({ organization: orgId })
        .select("role jobTitle user")
        .populate("user", "username"),
      Department.find({ organization: orgId })
        .select("name head")
        .populate("head", "username"),
      Team.find({ organization: orgId })
        .select("name members manager department")
        .populate("manager", "username")
        .populate("department", "name"),
      // Conversations the user can access (admins have org-wide oversight)
      Conversation.find(
        isAdmin
          ? { organizationId: orgId }
          : { organizationId: orgId, participants: userId }
      ).select("groupName channelType teamId"),
      Announcement.find({ organization: orgId })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("createdBy", "username"),
      Task.find({ organization: orgId, assignee: userId })
        .sort({ createdAt: -1 })
        .limit(20)
        .populate("assignedBy", "username"),
    ]);

  const myTeamIds = teams
    .filter(
      (t) =>
        (t.members || []).some((m) => m.toString() === userId.toString()) ||
        (t.manager && t.manager._id.toString() === userId.toString())
    )
    .map((t) => t._id);

  const myConvIds = myConvs.map((c) => c._id);

  const [assignedTasks, events, files, recentMessages, pendingInvites, audit] =
    await Promise.all([
      isManagerPlus
        ? Task.find({ organization: orgId, assignedBy: userId })
            .sort({ createdAt: -1 })
            .limit(20)
            .populate("assignee", "username")
        : [],
      // Company-wide events + my teams' events only
      Event.find({
        organization: orgId,
        startAt: { $gte: now, $lte: in14d },
        $or: [{ team: null }, { team: { $in: myTeamIds } }],
      })
        .sort({ startAt: 1 })
        .limit(20)
        .populate("team", "name"),
      // Org-wide files + my teams' files only
      File.find({
        organization: orgId,
        $or: [{ team: null }, { team: { $in: myTeamIds } }],
      })
        .sort({ createdAt: -1 })
        .limit(20)
        .populate("team", "name")
        .populate("uploadedBy", "username"),
      // Only messages from channels the user is in
      Message.find({
        conversationId: { $in: myConvIds },
        deleted: { $ne: true },
        messageType: { $nin: ["system"] },
      })
        .sort({ createdAt: -1 })
        .limit(15)
        .populate("sender", "username"),
      isAdmin
        ? OrgInvite.find({ organization: orgId, status: "pending" })
            .select("email role")
            .limit(10)
        : [],
      isAdmin
        ? AuditLog.find({ organization: orgId })
            .sort({ createdAt: -1 })
            .limit(8)
            .populate("actor", "username")
            .populate("targetUser", "username")
        : [],
    ]);

  const convName = new Map(myConvs.map((c) => [c._id.toString(), c.groupName]));

  const lines = [];
  lines.push(
    `ORGANIZATION: ${organization.name}${organization.industry ? ` · industry ${organization.industry}` : ""}${organization.size ? ` · size ${organization.size}` : ""}. ${clip(organization.description || "", 150)}`
  );
  lines.push(
    `CURRENT USER: ${me.username} — role ${membership.role}${membership.jobTitle ? `, job title "${membership.jobTitle}"` : ""}`
  );

  lines.push(
    `MEMBERS (${memberships.length}): ` +
      memberships
        .filter((m) => m.user)
        .map(
          (m) =>
            `${m.user.username} (${m.role}${m.jobTitle ? `, ${m.jobTitle}` : ""})`
        )
        .join("; ")
  );

  if (departments.length) {
    lines.push(
      `DEPARTMENTS: ` +
        departments
          .map((d) => `${d.name}${d.head ? ` (head: ${d.head.username})` : ""}`)
          .join("; ")
    );
  }

  if (teams.length) {
    lines.push(
      `TEAMS: ` +
        teams
          .map(
            (t) =>
              `${t.name}${t.department ? ` [dept ${t.department.name}]` : ""} — manager: ${t.manager ? t.manager.username : "none"}, ${(t.members || []).length} member(s)`
          )
          .join("; ")
    );
  }

  if (myConvs.length) {
    lines.push(
      `USER'S CHANNELS: ` +
        myConvs.map((c) => `#${c.groupName} (${c.channelType || "chat"})`).join(", ")
    );
  }

  if (recentMessages.length) {
    lines.push(`RECENT MESSAGES visible to this user (newest first):`);
    recentMessages.forEach((m) => {
      lines.push(
        `  [#${convName.get(m.conversationId.toString()) || "channel"}] ${m.sender?.username || "?"}: ${clip(m.content, 140)}`
      );
    });
  }

  if (announcements.length) {
    lines.push(`ANNOUNCEMENTS (latest):`);
    announcements.forEach((a) => {
      lines.push(
        `  [${a.priority}] "${a.title}" — ${clip(a.body, 160)} (by ${a.createdBy?.username}, ${new Date(a.createdAt).toDateString()})`
      );
    });
  }

  if (myTasks.length) {
    lines.push(`USER'S TASKS:`);
    myTasks.forEach((t) => {
      lines.push(
        `  [${t.status}, ${t.priority}${t.dueDate ? `, due ${new Date(t.dueDate).toDateString()}` : ""}] "${t.title}" (assigned by ${t.assignedBy?.username})`
      );
    });
  } else {
    lines.push(`USER'S TASKS: none assigned.`);
  }

  if (assignedTasks.length) {
    lines.push(`TASKS THIS USER ASSIGNED TO OTHERS:`);
    assignedTasks.forEach((t) => {
      lines.push(
        `  [${t.status}${t.dueDate ? `, due ${new Date(t.dueDate).toDateString()}` : ""}] "${t.title}" → ${t.assignee?.username}`
      );
    });
  }

  if (events.length) {
    lines.push(`UPCOMING EVENTS (next 14 days, visible to this user):`);
    events.forEach((e) => {
      lines.push(
        `  [${e.type}] "${e.title}" — ${new Date(e.startAt).toLocaleString()}${e.location ? ` @ ${e.location}` : ""} (${e.team ? `team ${e.team.name}` : "company-wide"})`
      );
    });
  }

  if (files.length) {
    lines.push(
      `FILES visible to this user: ` +
        files
          .map(
            (f) =>
              `"${f.name}" (${f.team ? `team ${f.team.name}` : "org-wide"}, by ${f.uploadedBy?.username})`
          )
          .join("; ")
    );
  }

  if (isAdmin && pendingInvites.length) {
    lines.push(
      `PENDING INVITES (admin-only info): ` +
        pendingInvites.map((i) => `${i.email} as ${i.role}`).join("; ")
    );
  }

  if (isAdmin && audit.length) {
    lines.push(`RECENT AUDIT LOG (admin-only info):`);
    audit.forEach((e) => {
      lines.push(
        `  ${e.actor?.username || "?"} → ${e.action}${e.targetUser ? ` (${e.targetUser.username})` : ""}${e.targetLabel ? ` "${e.targetLabel}"` : ""}`
      );
    });
  }

  // Hard cap the context size
  return lines.join("\n").slice(0, 9000);
};

// POST /organizations/:orgId/ai/ask — the ONLY path to the LLM.
// Auth (cookie) + org membership are enforced by the route middleware.
const askAssistant = async (req, res) => {
  try {
    const { question, history = [] } = req.body;

    if (!question || String(question).trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: "A question is required.",
      });
    }
    if (String(question).length > 600) {
      return res.status(400).json({
        success: false,
        error: "Question is too long (600 characters max).",
      });
    }

    // Sanitize client-sent history: last 6 turns, valid roles only
    const safeHistory = (Array.isArray(history) ? history : [])
      .filter(
        (m) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string"
      )
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 1200) }));

    const context = await buildContext(
      req.organization,
      req.orgMembership,
      req.user.id
    );

    const system = `You are the TeamSpace Assistant for the organization "${req.organization.name}".

Strict rules:
- Answer using ONLY the WORKSPACE CONTEXT below. It contains exactly the data this user is authorized to see — nothing else exists for you.
- If the answer is not in the context, say you don't have that information. Never guess or invent names, dates, counts or facts.
- Only answer questions about this workspace/company (people, teams, departments, tasks, events, files, announcements, channels, messages). For unrelated questions, politely decline in one sentence and offer to help with workspace topics instead.
- Be concise and friendly. Use short bullet points when listing several items.
- Today's date: ${new Date().toDateString()}.

WORKSPACE CONTEXT:
${context}`;

    const result = await chatCompletion({
      system,
      messages: [...safeHistory, { role: "user", content: String(question).trim() }],
    });

    if (!result.ok) {
      return res.status(502).json({
        success: false,
        error: result.error,
      });
    }

    res.status(200).json({
      success: true,
      data: {
        answer: result.answer,
        model: result.model,
      },
    });
  } catch (err) {
    console.error("AI Assistant Error:", err);
    res.status(500).json({
      success: false,
      error: "The assistant failed to answer.",
    });
  }
};

module.exports = { askAssistant };
