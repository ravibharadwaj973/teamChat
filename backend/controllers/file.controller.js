const cloudinary = require("../lib/cloudnary");
const File = require("../../models/file");
const Team = require("../../models/team");
const Conversation = require("../../models/conversation");
const Message = require("../../models/message");
const { hasMinRole, canPostToChannel } = require("../../shared/permissions");
const { FILE_EVENTS, MESSAGE_EVENTS } = require("../../shared/constants");
const { getIO } = require("./organization.controller");
const { recordAudit } = require("../lib/audit");

// mimetype -> cloudinary resource type
const resourceTypeOf = (mimetype = "") => {
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  return "raw";
};

const messageTypeOf = (resourceType) =>
  resourceType === "image" ? "image" : resourceType === "video" ? "video" : "file";

// Streams a buffer to Cloudinary. Raw files keep their extension in the id
// so downloads come back with the right filename.
const uploadBufferToCloudinary = (buffer, { folder, filename, resourceType }) =>
  new Promise((resolve, reject) => {
    const ext = (filename.match(/\.([a-zA-Z0-9]+)$/) || [])[1];
    const base =
      filename
        .replace(/\.[^.]+$/, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .substring(0, 60) || "file";
    const publicId =
      resourceType === "raw" && ext
        ? `${base}-${Date.now()}.${ext}`
        : `${base}-${Date.now()}`;

    const stream = cloudinary.uploader.upload_stream(
      { folder, public_id: publicId, resource_type: resourceType },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });

// True when the user may touch a team's file space
const canAccessTeamFiles = async (orgId, teamId, userId, membershipRole) => {
  if (hasMinRole(membershipRole, "admin")) return true;
  return !!(await Team.exists({
    _id: teamId,
    organization: orgId,
    $or: [{ members: userId }, { manager: userId }],
  }));
};

// 1️⃣ Upload a file (multipart field "file"; optional teamId / conversationId / description)
const uploadFile = async (req, res) => {
  try {
    const organization = req.organization;
    const userId = req.user.id;
    const { teamId = null, conversationId = null, description = "" } = req.body;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "A file is required (multipart field \"file\").",
      });
    }

    if (teamId) {
      const ok = await canAccessTeamFiles(
        organization._id,
        teamId,
        userId,
        req.orgMembership.role
      );
      if (!ok) {
        return res.status(403).json({
          success: false,
          error: "Only team members can share files with this team.",
        });
      }
    }

    // If sharing into a channel, validate posting rights up-front
    let conversation = null;
    if (conversationId) {
      conversation = await Conversation.findOne({
        _id: conversationId,
        organizationId: organization._id,
        participants: userId,
      });
      if (!conversation) {
        return res.status(404).json({
          success: false,
          error: "Channel not found or you are not a participant.",
        });
      }
      const postCheck = await canPostToChannel(conversation, userId);
      if (!postCheck.allowed) {
        return res.status(403).json({ success: false, error: postCheck.reason });
      }
    }

    const resourceType = resourceTypeOf(req.file.mimetype);
    const folder = `teamspace/${organization._id}/${teamId || "org"}`;

    const uploaded = await uploadBufferToCloudinary(req.file.buffer, {
      folder,
      filename: req.file.originalname || "file",
      resourceType,
    });

    const file = await File.create({
      organization: organization._id,
      team: teamId,
      conversation: conversation ? conversation._id : null,
      uploadedBy: userId,
      name: req.file.originalname || uploaded.public_id,
      description,
      url: uploaded.secure_url,
      publicId: uploaded.public_id,
      resourceType,
      format: uploaded.format || null,
      bytes: uploaded.bytes || req.file.size || 0,
    });

    const io = getIO(req);
    let message = null;

    // Share into the channel as a real chat message
    if (conversation) {
      message = await Message.create({
        conversationId: conversation._id,
        sender: userId,
        content: file.name,
        messageType: messageTypeOf(resourceType),
        mediaUrl: file.url,
      });
      file.message = message._id;
      await file.save();

      conversation.lastMessage = message._id;
      conversation.participants.forEach((p) => {
        if (p.toString() !== userId.toString()) {
          conversation.unreadCount.set(
            p.toString(),
            (conversation.unreadCount.get(p.toString()) || 0) + 1
          );
        }
      });
      await conversation.save();

      message = await Message.findById(message._id).populate(
        "sender",
        "username avatar"
      );
      if (io) {
        io.to(`conversation:${conversation._id}`).emit(
          MESSAGE_EVENTS.NEW_MESSAGE,
          { message, conversationId: conversation._id.toString() }
        );
      }
    }

    await file.populate([
      { path: "uploadedBy", select: "username avatar" },
      { path: "team", select: "name" },
    ]);

    if (io) {
      const room = teamId ? `team:${teamId}` : `org:${organization._id}`;
      io.to(room).emit(FILE_EVENTS.UPLOADED, {
        organizationId: organization._id,
        teamId,
        file,
      });
    }

    res.status(201).json({
      success: true,
      message: "File shared.",
      data: { file, message },
    });
  } catch (err) {
    console.error("Upload File Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to upload file. Check Cloudinary configuration.",
    });
  }
};

// 2️⃣ List files — ?teamId= for one team, ?scope=org for org-wide only,
//     default: everything the member can see (org files + their teams' files)
const listFiles = async (req, res) => {
  try {
    const organization = req.organization;
    const userId = req.user.id;
    const { teamId, scope } = req.query;

    const query = { organization: organization._id };

    if (teamId) {
      const ok = await canAccessTeamFiles(
        organization._id,
        teamId,
        userId,
        req.orgMembership.role
      );
      if (!ok) {
        return res.status(403).json({
          success: false,
          error: "Only team members can view this team's files.",
        });
      }
      query.team = teamId;
    } else if (scope === "org") {
      query.team = null;
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

    const files = await File.find(query)
      .populate("uploadedBy", "username avatar")
      .populate("team", "name")
      .sort({ createdAt: -1 })
      .limit(100);

    res.status(200).json({
      success: true,
      count: files.length,
      data: files,
    });
  } catch (err) {
    console.error("List Files Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch files.",
    });
  }
};

// 3️⃣ Delete a file (uploader, that team's manager, or admin+) — removes the asset too
const deleteFile = async (req, res) => {
  try {
    const userId = req.user.id;
    const file = await File.findOne({
      _id: req.params.fileId,
      organization: req.organization._id,
    });
    if (!file) {
      return res.status(404).json({ success: false, error: "File not found." });
    }

    const isUploader = file.uploadedBy.toString() === userId.toString();
    let isTeamManager = false;
    if (!isUploader && file.team) {
      isTeamManager = !!(await Team.exists({
        _id: file.team,
        manager: userId,
      }));
    }

    if (
      !isUploader &&
      !isTeamManager &&
      !hasMinRole(req.orgMembership.role, "admin")
    ) {
      return res.status(403).json({
        success: false,
        error: "Only the uploader, the team manager or admins can delete files.",
      });
    }

    try {
      await cloudinary.uploader.destroy(file.publicId, {
        resource_type: file.resourceType,
      });
    } catch (cloudErr) {
      console.error("Cloudinary destroy error:", cloudErr.message);
    }

    // Soft-delete the shared chat message, if any
    if (file.message) {
      await Message.findByIdAndUpdate(file.message, {
        deleted: true,
        content: "This message was deleted",
        mediaUrl: null,
        pinned: false,
      });
    }

    const teamId = file.team ? file.team.toString() : null;
    await file.deleteOne();

    await recordAudit({
      organization: req.organization._id,
      actor: userId,
      action: "file.deleted",
      targetLabel: file.name,
    });

    const io = getIO(req);
    if (io) {
      const room = teamId
        ? `team:${teamId}`
        : `org:${req.organization._id}`;
      io.to(room).emit(FILE_EVENTS.DELETED, {
        organizationId: req.organization._id,
        teamId,
        fileId: req.params.fileId,
      });
    }

    res.status(200).json({
      success: true,
      message: "File deleted.",
    });
  } catch (err) {
    console.error("Delete File Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to delete file.",
    });
  }
};

// Destroys file docs + Cloudinary assets for a query.
// Used by org/team deletion (lazy-required there to avoid import cycles).
const destroyFilesByQuery = async (query) => {
  const files = await File.find(query).select("publicId resourceType");
  await Promise.allSettled(
    files.map((f) =>
      cloudinary.uploader.destroy(f.publicId, { resource_type: f.resourceType })
    )
  );
  await File.deleteMany(query);
  return files.length;
};

module.exports = {
  uploadFile,
  listFiles,
  deleteFile,
  destroyFilesByQuery,
};
