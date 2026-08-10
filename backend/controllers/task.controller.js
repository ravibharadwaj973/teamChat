const Task = require("../../models/task");
const Team = require("../../models/team");
const User = require("../../models/user");
const OrgMembership = require("../../models/orgMembership");
const Notification = require("../../models/notifications");
const { hasMinRole } = require("../../shared/permissions");
const { TASK_EVENTS } = require("../../shared/constants");
const { getIO } = require("./organization.controller");
const { emailUserIfEnabled } = require("../lib/email");

// Important assignment -> email via Resend (fire-and-forget)
const emailAssignee = async (assigneeId, task, assignerName) => {
  try {
    const user = await User.findById(assigneeId).select(
      "email username notificationSettings"
    );
    await emailUserIfEnabled(user, {
      subject: `📋 New task: ${task.title}`,
      heading: `📋 ${assignerName} assigned you a task`,
      body: `${task.title}${task.description ? `\n\n${task.description}` : ""}${
        task.dueDate ? `\n\nDeadline: ${new Date(task.dueDate).toDateString()}` : ""
      }`,
      ctaLabel: "View your tasks",
      footnote: `Priority: ${task.priority}`,
    });
  } catch (err) {
    console.error("Task email error:", err.message);
  }
};

const STATUSES = ["todo", "in_progress", "done"];
const PRIORITIES = ["low", "medium", "high"];

const POPULATE = [
  { path: "assignee", select: "username avatar online" },
  { path: "assignedBy", select: "username avatar" },
  { path: "team", select: "name" },
];

// Who can this actor assign work to?
// admin+ -> every org member; manager -> members of teams they manage (+ self)
const getAssignableUserIds = async (orgId, membership, userId) => {
  if (hasMinRole(membership.role, "admin")) {
    const all = await OrgMembership.find({ organization: orgId }).select("user");
    return all.map((m) => m.user.toString());
  }
  if (membership.role === "manager") {
    const teams = await Team.find({
      organization: orgId,
      manager: userId,
    }).select("members");
    const ids = new Set(
      teams.flatMap((t) => t.members.map((m) => m.toString()))
    );
    ids.add(userId.toString());
    return [...ids];
  }
  return [];
};

const notify = async (recipient, sender, title, body, taskId, orgId) => {
  try {
    await Notification.createNotification({
      recipient,
      sender,
      type: "system",
      title,
      body,
      data: {
        kind: "task",
        taskId: taskId.toString(),
        organizationId: orgId.toString(),
      },
    });
  } catch (err) {
    console.error("Task notification error:", err.message);
  }
};

const emitTask = (io, event, task) => {
  if (!io) return;
  const payload = { task };
  io.to(`user:${task.assignee._id || task.assignee}`).emit(event, payload);
  io.to(`user:${task.assignedBy._id || task.assignedBy}`).emit(event, payload);
};

// 1️⃣ Create & assign a task (manager+; managers only within their teams)
const createTask = async (req, res) => {
  try {
    const organization = req.organization;
    const actorId = req.user.id;
    const {
      title,
      description = "",
      assigneeId,
      teamId = null,
      priority = "medium",
      dueDate = null,
    } = req.body;

    if (!hasMinRole(req.orgMembership.role, "manager")) {
      return res.status(403).json({
        success: false,
        error: "Only managers and admins can assign tasks.",
      });
    }

    if (!title || title.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: "Task title must be at least 2 characters.",
      });
    }
    if (!PRIORITIES.includes(priority)) {
      return res.status(400).json({
        success: false,
        error: "Priority must be low, medium or high.",
      });
    }
    if (!assigneeId) {
      return res.status(400).json({
        success: false,
        error: "An assignee is required.",
      });
    }

    const assignable = await getAssignableUserIds(
      organization._id,
      req.orgMembership,
      actorId
    );
    if (!assignable.includes(assigneeId.toString())) {
      return res.status(403).json({
        success: false,
        error:
          "You can only assign tasks to members of teams you manage.",
      });
    }

    if (teamId) {
      const teamOk = await Team.exists({
        _id: teamId,
        organization: organization._id,
      });
      if (!teamOk) {
        return res.status(400).json({
          success: false,
          error: "Team not found in this organization.",
        });
      }
    }

    let due = null;
    if (dueDate) {
      due = new Date(dueDate);
      if (isNaN(due.getTime())) {
        return res.status(400).json({
          success: false,
          error: "Invalid due date.",
        });
      }
    }

    const task = await Task.create({
      organization: organization._id,
      team: teamId,
      title: title.trim(),
      description,
      assignee: assigneeId,
      assignedBy: actorId,
      priority,
      dueDate: due,
    });
    await task.populate(POPULATE);

    if (assigneeId.toString() !== actorId.toString()) {
      await notify(
        assigneeId,
        actorId,
        `📋 New task: ${task.title}`,
        due
          ? `Due ${due.toDateString()} · assigned by ${task.assignedBy.username}`
          : `Assigned by ${task.assignedBy.username}`,
        task._id,
        organization._id
      );
      emailAssignee(assigneeId, task, task.assignedBy.username);
    }

    emitTask(getIO(req), TASK_EVENTS.CREATED, task);

    res.status(201).json({
      success: true,
      message: "Task assigned.",
      data: task,
    });
  } catch (err) {
    console.error("Create Task Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to create task.",
    });
  }
};

// 2️⃣ List tasks — scope: my (default) | assigned | team | all
const listTasks = async (req, res) => {
  try {
    const organization = req.organization;
    const userId = req.user.id;
    const { scope = "my", status, teamId } = req.query;

    const query = { organization: organization._id };

    if (scope === "my") {
      query.assignee = userId;
    } else if (scope === "assigned") {
      query.assignedBy = userId;
    } else if (scope === "team") {
      if (!teamId) {
        return res.status(400).json({
          success: false,
          error: "teamId is required for team scope.",
        });
      }
      const team = await Team.findOne({
        _id: teamId,
        organization: organization._id,
      }).select("manager");
      if (!team) {
        return res.status(404).json({
          success: false,
          error: "Team not found.",
        });
      }
      const allowed =
        hasMinRole(req.orgMembership.role, "admin") ||
        (team.manager && team.manager.toString() === userId.toString());
      if (!allowed) {
        return res.status(403).json({
          success: false,
          error: "Only the team manager or admins can view team tasks.",
        });
      }
      query.team = teamId;
    } else if (scope === "all") {
      if (!hasMinRole(req.orgMembership.role, "admin")) {
        return res.status(403).json({
          success: false,
          error: "Only admins can view all tasks.",
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        error: "Invalid scope.",
      });
    }

    if (status) {
      if (!STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          error: "Invalid status filter.",
        });
      }
      query.status = status;
    }

    const tasks = await Task.find(query)
      .populate(POPULATE)
      .sort({ createdAt: -1 })
      .limit(200);

    res.status(200).json({
      success: true,
      canAssign: hasMinRole(req.orgMembership.role, "manager"),
      count: tasks.length,
      data: tasks,
    });
  } catch (err) {
    console.error("List Tasks Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch tasks.",
    });
  }
};

// 3️⃣ Members the actor may assign tasks to (for the compose form)
const getAssignableMembers = async (req, res) => {
  try {
    const ids = await getAssignableUserIds(
      req.organization._id,
      req.orgMembership,
      req.user.id
    );

    const memberships = await OrgMembership.find({
      organization: req.organization._id,
      user: { $in: ids },
    }).populate("user", "username avatar email online");

    res.status(200).json({
      success: true,
      canAssign: ids.length > 0,
      data: memberships.map((m) => m.user).filter(Boolean),
    });
  } catch (err) {
    console.error("Assignable Members Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch assignable members.",
    });
  }
};

// Loads a task within the org, or null
const loadTask = (req) =>
  Task.findOne({
    _id: req.params.taskId,
    organization: req.organization._id,
  });

const isTaskParty = (task, userId) =>
  task.assignee.toString() === userId.toString() ||
  task.assignedBy.toString() === userId.toString();

// 4️⃣ Get one task (assignee, assigner or admin+)
const getTaskById = async (req, res) => {
  try {
    const task = await loadTask(req);
    if (!task) {
      return res.status(404).json({ success: false, error: "Task not found." });
    }
    if (
      !isTaskParty(task, req.user.id) &&
      !hasMinRole(req.orgMembership.role, "admin")
    ) {
      return res.status(403).json({
        success: false,
        error: "You do not have access to this task.",
      });
    }
    await task.populate(POPULATE);
    res.status(200).json({ success: true, data: task });
  } catch (err) {
    console.error("Get Task Error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch task." });
  }
};

// 5️⃣ Update status (assignee, assigner or admin+)
const updateTaskStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const userId = req.user.id;

    if (!STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Status must be todo, in_progress or done.",
      });
    }

    const task = await loadTask(req);
    if (!task) {
      return res.status(404).json({ success: false, error: "Task not found." });
    }

    if (
      !isTaskParty(task, userId) &&
      !hasMinRole(req.orgMembership.role, "admin")
    ) {
      return res.status(403).json({
        success: false,
        error: "Only the assignee, the assigner or admins can update this task.",
      });
    }

    const wasDone = task.status === "done";
    task.status = status;
    task.completedAt = status === "done" ? new Date() : null;
    await task.save();
    await task.populate(POPULATE);

    // Tell the manager their assignment is finished
    if (
      status === "done" &&
      !wasDone &&
      task.assignedBy._id.toString() !== userId.toString()
    ) {
      await notify(
        task.assignedBy._id,
        userId,
        `✅ Task completed: ${task.title}`,
        `Finished by ${task.assignee.username}`,
        task._id,
        req.organization._id
      );
    }

    emitTask(getIO(req), TASK_EVENTS.UPDATED, task);

    res.status(200).json({
      success: true,
      message: "Status updated.",
      data: task,
    });
  } catch (err) {
    console.error("Update Task Status Error:", err);
    res.status(500).json({ success: false, error: "Failed to update status." });
  }
};

// 6️⃣ Edit a task (assigner or admin+) — details, deadline, reassignment
const updateTask = async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, description, priority, dueDate, assigneeId, teamId } =
      req.body;

    const task = await loadTask(req);
    if (!task) {
      return res.status(404).json({ success: false, error: "Task not found." });
    }

    const isAssigner = task.assignedBy.toString() === userId.toString();
    if (!isAssigner && !hasMinRole(req.orgMembership.role, "admin")) {
      return res.status(403).json({
        success: false,
        error: "Only the assigner or admins can edit this task.",
      });
    }

    if (title !== undefined) {
      if (!title || title.trim().length < 2) {
        return res.status(400).json({
          success: false,
          error: "Task title must be at least 2 characters.",
        });
      }
      task.title = title.trim();
    }
    if (description !== undefined) task.description = description;
    if (priority !== undefined) {
      if (!PRIORITIES.includes(priority)) {
        return res.status(400).json({
          success: false,
          error: "Priority must be low, medium or high.",
        });
      }
      task.priority = priority;
    }
    if (dueDate !== undefined) {
      if (dueDate === null || dueDate === "") {
        task.dueDate = null;
      } else {
        const due = new Date(dueDate);
        if (isNaN(due.getTime())) {
          return res.status(400).json({
            success: false,
            error: "Invalid due date.",
          });
        }
        task.dueDate = due;
      }
    }
    if (teamId !== undefined) {
      if (teamId) {
        const teamOk = await Team.exists({
          _id: teamId,
          organization: req.organization._id,
        });
        if (!teamOk) {
          return res.status(400).json({
            success: false,
            error: "Team not found in this organization.",
          });
        }
      }
      task.team = teamId || null;
    }
    if (assigneeId !== undefined && assigneeId.toString() !== task.assignee.toString()) {
      const assignable = await getAssignableUserIds(
        req.organization._id,
        req.orgMembership,
        userId
      );
      if (!assignable.includes(assigneeId.toString())) {
        return res.status(403).json({
          success: false,
          error: "You can only reassign to members of teams you manage.",
        });
      }
      task.assignee = assigneeId;
      await notify(
        assigneeId,
        userId,
        `📋 Task reassigned to you: ${task.title}`,
        task.dueDate ? `Due ${task.dueDate.toDateString()}` : "",
        task._id,
        req.organization._id
      );
      emailAssignee(assigneeId, task, req.user.username);
    }

    await task.save();
    await task.populate(POPULATE);

    emitTask(getIO(req), TASK_EVENTS.UPDATED, task);

    res.status(200).json({
      success: true,
      message: "Task updated.",
      data: task,
    });
  } catch (err) {
    console.error("Update Task Error:", err);
    res.status(500).json({ success: false, error: "Failed to update task." });
  }
};

// 7️⃣ Delete a task (assigner or admin+)
const deleteTask = async (req, res) => {
  try {
    const userId = req.user.id;
    const task = await loadTask(req);
    if (!task) {
      return res.status(404).json({ success: false, error: "Task not found." });
    }

    const isAssigner = task.assignedBy.toString() === userId.toString();
    if (!isAssigner && !hasMinRole(req.orgMembership.role, "admin")) {
      return res.status(403).json({
        success: false,
        error: "Only the assigner or admins can delete this task.",
      });
    }

    await task.populate(POPULATE);
    await task.deleteOne();

    emitTask(getIO(req), TASK_EVENTS.DELETED, task);

    res.status(200).json({
      success: true,
      message: "Task deleted.",
    });
  } catch (err) {
    console.error("Delete Task Error:", err);
    res.status(500).json({ success: false, error: "Failed to delete task." });
  }
};

module.exports = {
  createTask,
  listTasks,
  getAssignableMembers,
  getTaskById,
  updateTaskStatus,
  updateTask,
  deleteTask,
};
