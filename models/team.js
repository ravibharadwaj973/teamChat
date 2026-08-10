const mongoose = require("mongoose");
const { connection } = require("mongoose");

const teamSchema = new mongoose.Schema(
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
    // The department this team belongs to (Organization -> Department -> Team)
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
      index: true,
    },
    manager: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    // The team's chat channel (a group Conversation)
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      default: null,
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

// Team names unique inside an organization
teamSchema.index({ organization: 1, name: 1 }, { unique: true });
teamSchema.index({ organization: 1, members: 1 });

teamSchema.virtual("memberCount").get(function () {
  return this.members ? this.members.length : 0;
});

// Virtual: all chat channels of this team (default + custom)
teamSchema.virtual("channels", {
  ref: "Conversation",
  localField: "_id",
  foreignField: "teamId",
});

module.exports = connection.models.Team || connection.model("Team", teamSchema);
