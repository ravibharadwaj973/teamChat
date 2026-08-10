const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth.middleware");

const {
  getmessage,
  searchmessage,
  getMessageById,
  deleteMessage,
  sendMessage,
  editMessage,
  pinMessage,
  unpinMessage,
  getPinnedMessages,
  markConversationRead,
} = require("../../backend/controllers/message.controller");

// All message APIs require auth
router.use(authenticate);

// Fetch messages
router.get("/:conversationId", getmessage);
router.post("/send", sendMessage);

// Search messages
router.get("/:conversationId/search", searchmessage);

// Pinned messages of a conversation
router.get("/:conversationId/pins", getPinnedMessages);

// Mark a whole conversation/channel as read
router.post("/:conversationId/read", markConversationRead);

// Get single message
router.get("/single/:messageId", getMessageById);

// Edit message (sender only)
router.put("/single/:messageId", editMessage);

// Pin / unpin
router.patch("/single/:messageId/pin", pinMessage);
router.patch("/single/:messageId/unpin", unpinMessage);

// Delete message (sender, channel admin, or org admin)
router.delete("/:messageId", deleteMessage);

module.exports = router;
