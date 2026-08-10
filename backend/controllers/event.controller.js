const Event = require("../../models/event");
const Team = require("../../models/team");
const Task = require("../../models/task");
const OrgMembership = require("../../models/orgMembership");
const Notification = require("../../models/notifications");
const {
  hasMinRole,
  canPostAnnouncements,
} = require("../../shared/permissions");
const { CALENDAR_EVENTS } = require("../../shared/constants");
const { getIO } = require("./organization.controller");

const TYPES = ["meeting", "event", "deadline"];

const POPULATE = [
  { path: "createdBy", select: "username avatar" },
  { path: "team", select: "name" },
];

const isTeamMember = (orgId, teamId, userId) =>
  Team.exists({
    _id: teamId,
    organization: orgId,
    $or: [{ members: userId }, { manager: userId }],
  });

// Creator, that team's manager, or admin+ may modify an event
const canManageEvent = async (event, userId, membershipRole) => {
  if (event.createdBy.toString() === userId.toString()) return true;
  if (hasMinRole(membershipRole, "admin")) return true;
  if (event.team) {
    return !!(await Team.exists({ _id: event.team, manager: userId }));
  }
  return false;
};

// 1️⃣ Create event
// Company-wide (no team): owner/admin/manager or HR. Team event: team members.
const createEvent = async (req, res) => {
  try {
    const organization = req.organization;
    const userId = req.user.id;
    const {
      title,
      description = "",
      type = "meeting",
      startAt,
      endAt = null,
      allDay = false,
      location = "",
      teamId = null,
    } = req.body;

    if (!title || title.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: "Event title must be at least 2 characters.",
      });
    }
    if (!TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        error: "Type must be meeting, event or deadline.",
      });
    }
    const start = new Date(startAt);
    if (!startAt || isNaN(start.getTime())) {
      return res.status(400).json({
        success: false,
        error: "A valid start date/time is required.",
      });
    }
    let end = null;
    if (endAt) {
      end = new Date(endAt);
      if (isNaN(end.getTime()) || end < start) {
        return res.status(400).json({
          success: false,
          error: "End time must be after the start time.",
        });
      }
    }

    if (teamId) {
      if (!(await isTeamMember(organization._id, teamId, userId)) &&
          !hasMinRole(req.orgMembership.role, "admin")) {
        return res.status(403).json({
          success: false,
          error: "Only team members can schedule events for this team.",
        });
      }
    } else {
      const allowed = await canPostAnnouncements(
        organization._id,
        req.orgMembership.role,
        userId
      );
      if (!allowed) {
        return res.status(403).json({
          success: false,
          error:
            "Only owners, admins, managers or HR can schedule company-wide events.",
        });
      }
    }

    const event = await Event.create({
      organization: organization._id,
      team: teamId,
      title: title.trim(),
      description,
      type,
      startAt: start,
      endAt: end,
      allDay: !!allDay,
      location,
      createdBy: userId,
    });
    await event.populate(POPULATE);

    // In-app notifications: company-wide -> everyone; team -> team members
    try {
      let recipientIds = [];
      if (teamId) {
        const team = await Team.findById(teamId).select("members manager");
        const set = new Set(
          [...(team?.members || []), team?.manager]
            .filter(Boolean)
            .map((m) => m.toString())
        );
        set.delete(userId.toString());
        recipientIds = [...set];
      } else {
        const memberships = await OrgMembership.find({
          organization: organization._id,
          user: { $ne: userId },
        }).select("user");
        recipientIds = memberships.map((m) => m.user.toString());
      }
      if (recipientIds.length > 0) {
        const when = start.toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        await Notification.insertMany(
          recipientIds.map((rid) => ({
            recipient: rid,
            sender: userId,
            type: "system",
            title: `📅 ${type === "deadline" ? "Deadline" : "Event"}: ${event.title}`,
            body: `${when}${location ? ` · ${location}` : ""}`,
            data: {
              kind: "event",
              organizationId: organization._id.toString(),
              eventId: event._id.toString(),
            },
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          }))
        );
      }
    } catch (notifyErr) {
      console.error("Event notification error:", notifyErr.message);
    }

    const io = getIO(req);
    if (io) {
      const room = teamId ? `team:${teamId}` : `org:${organization._id}`;
      io.to(room).emit(CALENDAR_EVENTS.CREATED, {
        organizationId: organization._id,
        event,
      });
    }

    res.status(201).json({
      success: true,
      message: "Event scheduled.",
      data: event,
    });
  } catch (err) {
    console.error("Create Event Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to create event.",
    });
  }
};

// 2️⃣ List events in a range (?from&to&teamId) + my task deadlines
const listEvents = async (req, res) => {
  try {
    const organization = req.organization;
    const userId = req.user.id;
    const { teamId } = req.query;

    const from = req.query.from ? new Date(req.query.from) : new Date();
    const to = req.query.to
      ? new Date(req.query.to)
      : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return res.status(400).json({
        success: false,
        error: "Invalid date range.",
      });
    }

    const query = {
      organization: organization._id,
      startAt: { $gte: from, $lte: to },
    };

    if (teamId) {
      if (!(await isTeamMember(organization._id, teamId, userId)) &&
          !hasMinRole(req.orgMembership.role, "admin")) {
        return res.status(403).json({
          success: false,
          error: "Only team members can view this team's calendar.",
        });
      }
      query.team = teamId;
    } else if (!hasMinRole(req.orgMembership.role, "admin")) {
      const myTeams = await Team.find({
        organization: organization._id,
        $or: [{ members: userId }, { manager: userId }],
      }).select("_id");
      query.$or = [
        { team: null },
        { team: { $in: myTeams.map((t) => t._id) } },
      ];
    }

    const [events, myDueTasks, canCreateCompanyWide] = await Promise.all([
      Event.find(query).populate(POPULATE).sort({ startAt: 1 }).limit(300),
      Task.find({
        organization: organization._id,
        assignee: userId,
        dueDate: { $gte: from, $lte: to },
      })
        .select("title dueDate status priority")
        .sort({ dueDate: 1 })
        .limit(100),
      canPostAnnouncements(organization._id, req.orgMembership.role, userId),
    ]);

    res.status(200).json({
      success: true,
      canCreateCompanyWide,
      count: events.length,
      data: {
        events,
        taskDeadlines: myDueTasks,
      },
    });
  } catch (err) {
    console.error("List Events Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch events.",
    });
  }
};

// 3️⃣ Update event (creator, team manager or admin+)
const updateEvent = async (req, res) => {
  try {
    const userId = req.user.id;
    const event = await Event.findOne({
      _id: req.params.eventId,
      organization: req.organization._id,
    });
    if (!event) {
      return res.status(404).json({ success: false, error: "Event not found." });
    }
    if (!(await canManageEvent(event, userId, req.orgMembership.role))) {
      return res.status(403).json({
        success: false,
        error: "Only the organizer, the team manager or admins can edit this event.",
      });
    }

    const { title, description, type, startAt, endAt, allDay, location } =
      req.body;
    if (title !== undefined) {
      if (!title || title.trim().length < 2) {
        return res.status(400).json({
          success: false,
          error: "Event title must be at least 2 characters.",
        });
      }
      event.title = title.trim();
    }
    if (description !== undefined) event.description = description;
    if (type !== undefined) {
      if (!TYPES.includes(type)) {
        return res.status(400).json({
          success: false,
          error: "Type must be meeting, event or deadline.",
        });
      }
      event.type = type;
    }
    if (startAt !== undefined) {
      const start = new Date(startAt);
      if (isNaN(start.getTime())) {
        return res.status(400).json({ success: false, error: "Invalid start time." });
      }
      event.startAt = start;
    }
    if (endAt !== undefined) {
      if (!endAt) event.endAt = null;
      else {
        const end = new Date(endAt);
        if (isNaN(end.getTime()) || end < event.startAt) {
          return res.status(400).json({
            success: false,
            error: "End time must be after the start time.",
          });
        }
        event.endAt = end;
      }
    }
    if (allDay !== undefined) event.allDay = !!allDay;
    if (location !== undefined) event.location = location;

    await event.save();
    await event.populate(POPULATE);

    const io = getIO(req);
    if (io) {
      const room = event.team
        ? `team:${event.team._id || event.team}`
        : `org:${req.organization._id}`;
      io.to(room).emit(CALENDAR_EVENTS.UPDATED, {
        organizationId: req.organization._id,
        event,
      });
    }

    res.status(200).json({
      success: true,
      message: "Event updated.",
      data: event,
    });
  } catch (err) {
    console.error("Update Event Error:", err);
    res.status(500).json({ success: false, error: "Failed to update event." });
  }
};

// 4️⃣ Delete event (creator, team manager or admin+)
const deleteEvent = async (req, res) => {
  try {
    const userId = req.user.id;
    const event = await Event.findOne({
      _id: req.params.eventId,
      organization: req.organization._id,
    });
    if (!event) {
      return res.status(404).json({ success: false, error: "Event not found." });
    }
    if (!(await canManageEvent(event, userId, req.orgMembership.role))) {
      return res.status(403).json({
        success: false,
        error: "Only the organizer, the team manager or admins can delete this event.",
      });
    }

    const teamId = event.team ? event.team.toString() : null;
    await event.deleteOne();

    const io = getIO(req);
    if (io) {
      const room = teamId ? `team:${teamId}` : `org:${req.organization._id}`;
      io.to(room).emit(CALENDAR_EVENTS.DELETED, {
        organizationId: req.organization._id,
        eventId: req.params.eventId,
      });
    }

    res.status(200).json({
      success: true,
      message: "Event deleted.",
    });
  } catch (err) {
    console.error("Delete Event Error:", err);
    res.status(500).json({ success: false, error: "Failed to delete event." });
  }
};

module.exports = {
  createEvent,
  listEvents,
  updateEvent,
  deleteEvent,
};
