const OrgMembership = require("../../models/orgMembership");
const Team = require("../../models/team");

class OrganizationEventsHandler {
  constructor(io) {
    this.io = io;
  }

  // Called on connection: join a room per org/team the user belongs to,
  // so REST controllers can broadcast with io.to(`org:${id}`) / io.to(`team:${id}`)
  async joinOrgRooms(socket) {
    const userId = socket.userId;
    try {
      const memberships = await OrgMembership.find({ user: userId }).select(
        "organization"
      );
      memberships.forEach((m) => socket.join(`org:${m.organization}`));

      const teams = await Team.find({ members: userId }).select("_id");
      teams.forEach((t) => socket.join(`team:${t._id}`));

      if (memberships.length || teams.length) {
        console.log(
          `🏢 User ${userId} joined ${memberships.length} org room(s), ${teams.length} team room(s)`
        );
      }
    } catch (err) {
      console.error("Failed to join org rooms:", err.message);
    }
  }

  registerEvents(socket) {
    const userId = socket.userId;

    // Re-join an org room after joining an org without reconnecting
    socket.on("org:join", async (orgId) => {
      try {
        const isMember = await OrgMembership.exists({
          organization: orgId,
          user: userId,
        });
        if (isMember) socket.join(`org:${orgId}`);
      } catch (err) {
        console.error("org:join error:", err.message);
      }
    });

    socket.on("org:leave", (orgId) => {
      socket.leave(`org:${orgId}`);
    });

    socket.on("team:join", async (teamId) => {
      try {
        const isMember = await Team.exists({ _id: teamId, members: userId });
        if (isMember) socket.join(`team:${teamId}`);
      } catch (err) {
        console.error("team:join error:", err.message);
      }
    });

    socket.on("team:leave", (teamId) => {
      socket.leave(`team:${teamId}`);
    });
  }
}

module.exports = OrganizationEventsHandler;
