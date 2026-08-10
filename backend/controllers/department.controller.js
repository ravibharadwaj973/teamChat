const Department = require("../../models/department");
const Team = require("../../models/team");
const OrgMembership = require("../../models/orgMembership");
const { DEPARTMENT_EVENTS } = require("../../shared/constants");
const { getIO } = require("./organization.controller");
const { promoteToManagerRole } = require("./team.controller");
const { recordAudit } = require("../lib/audit");

// Validates an optional department head: must be an org member
const validateHead = async (orgId, headId) => {
  if (!headId) return true;
  return !!(await OrgMembership.exists({ organization: orgId, user: headId }));
};

// 1️⃣ Create Department (admin+)
const createDepartment = async (req, res) => {
  try {
    const organization = req.organization;
    const { name, description = "", headId = null } = req.body;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: "Department name must be at least 2 characters.",
      });
    }

    if (!(await validateHead(organization._id, headId))) {
      return res.status(400).json({
        success: false,
        error: "Department head must be a member of the organization.",
      });
    }

    let department;
    try {
      department = await Department.create({
        organization: organization._id,
        name: name.trim(),
        description,
        head: headId,
        createdBy: req.user.id,
      });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({
          success: false,
          error: "A department with this name already exists.",
        });
      }
      throw err;
    }

    const io = getIO(req);

    await recordAudit({
      organization: organization._id,
      actor: req.user.id,
      action: "department.created",
      targetLabel: department.name,
    });

    // A department head acts at manager level
    if (headId) {
      await promoteToManagerRole(organization._id, headId, io, req.user.id);
    }

    if (io) {
      io.to(`org:${organization._id}`).emit(
        DEPARTMENT_EVENTS.DEPARTMENT_CREATED,
        {
          organizationId: organization._id,
          department,
        }
      );
    }

    res.status(201).json({
      success: true,
      message: "Department created.",
      data: department,
    });
  } catch (err) {
    console.error("Create Department Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to create department.",
    });
  }
};

// 2️⃣ Get Departments (each with its teams)
const getDepartments = async (req, res) => {
  try {
    const departments = await Department.find({
      organization: req.organization._id,
    })
      .populate("head", "username avatar status online")
      .populate({
        path: "teams",
        select: "name description manager members conversation",
        populate: { path: "manager", select: "username avatar" },
      })
      .sort({ name: 1 });

    res.status(200).json({
      success: true,
      count: departments.length,
      data: departments,
    });
  } catch (err) {
    console.error("Get Departments Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch departments.",
    });
  }
};

// 3️⃣ Get Department by ID
const getDepartmentById = async (req, res) => {
  try {
    const { departmentId } = req.params;

    const department = await Department.findOne({
      _id: departmentId,
      organization: req.organization._id,
    })
      .populate("head", "username avatar status online lastSeen")
      .populate("createdBy", "username avatar")
      .populate({
        path: "teams",
        select: "name description manager members conversation createdAt",
        populate: { path: "manager", select: "username avatar" },
      });

    if (!department) {
      return res.status(404).json({
        success: false,
        error: "Department not found.",
      });
    }

    res.status(200).json({
      success: true,
      data: department,
    });
  } catch (err) {
    console.error("Get Department Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch department.",
    });
  }
};

// 4️⃣ Update Department (admin+) — name, description, head
const updateDepartment = async (req, res) => {
  try {
    const { departmentId } = req.params;
    const { name, description, headId } = req.body;
    const organization = req.organization;

    const department = await Department.findOne({
      _id: departmentId,
      organization: organization._id,
    });

    if (!department) {
      return res.status(404).json({
        success: false,
        error: "Department not found.",
      });
    }

    if (name !== undefined) {
      if (!name || name.trim().length < 2) {
        return res.status(400).json({
          success: false,
          error: "Department name must be at least 2 characters.",
        });
      }
      department.name = name.trim();
    }
    if (description !== undefined) department.description = description;

    const io = getIO(req);

    if (headId !== undefined) {
      if (headId && !(await validateHead(organization._id, headId))) {
        return res.status(400).json({
          success: false,
          error: "Department head must be a member of the organization.",
        });
      }
      department.head = headId || null;
      if (headId) {
        await promoteToManagerRole(organization._id, headId, io);
      }
    }

    try {
      await department.save();
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({
          success: false,
          error: "A department with this name already exists.",
        });
      }
      throw err;
    }

    if (io) {
      io.to(`org:${organization._id}`).emit(
        DEPARTMENT_EVENTS.DEPARTMENT_UPDATED,
        {
          organizationId: organization._id,
          department,
        }
      );
    }

    res.status(200).json({
      success: true,
      message: "Department updated.",
      data: department,
    });
  } catch (err) {
    console.error("Update Department Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to update department.",
    });
  }
};

// 5️⃣ Delete Department (admin+)
// Blocks when teams still belong to it unless ?force=true (teams become unassigned)
const deleteDepartment = async (req, res) => {
  try {
    const { departmentId } = req.params;
    const organization = req.organization;
    const force = req.query.force === "true";

    const department = await Department.findOne({
      _id: departmentId,
      organization: organization._id,
    });

    if (!department) {
      return res.status(404).json({
        success: false,
        error: "Department not found.",
      });
    }

    const teamCount = await Team.countDocuments({
      organization: organization._id,
      department: departmentId,
    });

    if (teamCount > 0 && !force) {
      return res.status(400).json({
        success: false,
        error: `Department has ${teamCount} team(s). Move them to another department first, or pass ?force=true to unassign them.`,
        data: { teamCount },
      });
    }

    if (teamCount > 0) {
      await Team.updateMany(
        { organization: organization._id, department: departmentId },
        { $set: { department: null } }
      );
    }

    await department.deleteOne();

    await recordAudit({
      organization: organization._id,
      actor: req.user.id,
      action: "department.deleted",
      targetLabel: department.name,
      details: { unassignedTeams: teamCount },
    });

    const io = getIO(req);
    if (io) {
      io.to(`org:${organization._id}`).emit(
        DEPARTMENT_EVENTS.DEPARTMENT_DELETED,
        {
          organizationId: organization._id,
          departmentId: department._id,
          unassignedTeams: teamCount,
        }
      );
    }

    res.status(200).json({
      success: true,
      message:
        teamCount > 0
          ? `Department deleted. ${teamCount} team(s) are now unassigned.`
          : "Department deleted.",
    });
  } catch (err) {
    console.error("Delete Department Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to delete department.",
    });
  }
};

// 6️⃣ Org Structure — the full tree: departments with their teams + unassigned teams
const getOrgStructure = async (req, res) => {
  try {
    const orgId = req.organization._id;

    const [departments, teams] = await Promise.all([
      Department.find({ organization: orgId })
        .populate("head", "username avatar")
        .sort({ name: 1 }),
      Team.find({ organization: orgId })
        .populate("manager", "username avatar")
        .select("name description department manager members conversation")
        .sort({ name: 1 }),
    ]);

    const byDept = new Map(
      departments.map((d) => [d._id.toString(), { ...d.toObject(), teams: [] }])
    );
    const unassignedTeams = [];

    teams.forEach((team) => {
      const key = team.department ? team.department.toString() : null;
      if (key && byDept.has(key)) {
        byDept.get(key).teams.push(team);
      } else {
        unassignedTeams.push(team);
      }
    });

    res.status(200).json({
      success: true,
      data: {
        organization: {
          _id: req.organization._id,
          name: req.organization.name,
        },
        departments: [...byDept.values()],
        unassignedTeams,
        counts: {
          departments: departments.length,
          teams: teams.length,
        },
      },
    });
  } catch (err) {
    console.error("Get Org Structure Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch organization structure.",
    });
  }
};

module.exports = {
  createDepartment,
  getDepartments,
  getDepartmentById,
  updateDepartment,
  deleteDepartment,
  getOrgStructure,
};
