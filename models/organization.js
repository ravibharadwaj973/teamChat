const mongoose = require("mongoose");
const { connection } = require("mongoose");

// Allowed industries for an organization
const INDUSTRIES = [
  "TECHNOLOGY",
  "FINANCE",
  "HEALTHCARE",
  "EDUCATION",
  "RETAIL",
  "ECOMMERCE",
  "MANUFACTURING",
  "CONSTRUCTION",
  "REAL_ESTATE",
  "LOGISTICS",
  "HOSPITALITY",
  "MEDIA",
  "MARKETING",
  "CONSULTING",
  "NON_PROFIT",
  "GOVERNMENT",
  "LEGAL",
  "OTHER",
];

const organizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 60,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    logo: {
      type: String,
      default: null,
    },
    industry: {
      type: String,
      trim: true,
      enum: INDUSTRIES,
      default: null,
    },
    size: {
      type: String,
      enum: ["1-10", "11-50", "51-200", "201-500", "500+"],
      default: "1-10",
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    settings: {
      allowMemberInvites: {
        type: Boolean,
        default: false,
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual: all memberships of this organization
organizationSchema.virtual("members", {
  ref: "OrgMembership",
  localField: "_id",
  foreignField: "organization",
});

// Virtual: all teams of this organization
organizationSchema.virtual("teams", {
  ref: "Team",
  localField: "_id",
  foreignField: "organization",
});

const Organization =
  connection.models.Organization ||
  connection.model("Organization", organizationSchema);

module.exports = Organization;
module.exports.INDUSTRIES = INDUSTRIES;
