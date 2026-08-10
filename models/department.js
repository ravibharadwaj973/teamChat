const mongoose = require("mongoose");
const { connection } = require("mongoose");

const departmentSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 60,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 300,
      default: "",
    },
    // Department head (informational lead; org member)
    head: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Department names unique inside an organization
departmentSchema.index({ organization: 1, name: 1 }, { unique: true });

// Virtual: teams that belong to this department
departmentSchema.virtual("teams", {
  ref: "Team",
  localField: "_id",
  foreignField: "department",
});

module.exports =
  connection.models.Department ||
  connection.model("Department", departmentSchema);
