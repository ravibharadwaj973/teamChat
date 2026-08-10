// Message Events
const MESSAGE_EVENTS = {
  // Client emits these
  SEND_MESSAGE: 'send-message',
  MESSAGE_DELIVERED: 'message-delivered',
  MESSAGE_READ: 'message-read',
  ADD_REACTION: 'add-reaction',
  REMOVE_REACTION: 'reaction:remove',
  REPLY_MESSAGE: 'reply-message',
  DELETE_MESSAGE: 'delete-message',
  
  // Server emits these
  NEW_MESSAGE: 'new-message',
  MESSAGE_SENT: 'message-sent',
  MESSAGE_DELIVERY_UPDATE: 'message-delivery-update',
  MESSAGE_READ_UPDATE: 'message-read-update',
  REACTION_ADDED: 'reaction-added',
  REACTION_REMOVED: 'reaction-removed',
  MESSAGE_DELETED: 'message-deleted',
  MESSAGE_DELETED_FOR_EVERYONE: 'message-deleted-for-everyone',
  
  // Typing events
  TYPING_START: 'typing-start',
  TYPING_STOP: 'typing-stop',
  USER_TYPING: 'user-typing',
  
  // Error events
  MESSAGE_ERROR: 'message-error',
  REACTION_ERROR: 'reaction-error',
  REPLY_ERROR: 'reply-error',
  DELETE_ERROR: 'delete-error',

  // TeamSpace chat events
  MESSAGE_EDITED: 'message-edited',
  MESSAGE_PINNED: 'message-pinned',
  MESSAGE_UNPINNED: 'message-unpinned',
  MENTION: 'message-mention',
  CONVERSATION_READ: 'conversation-read',
};

// User Events
const USER_EVENTS = {
  USER_ONLINE: 'user-online',
  USER_OFFLINE: 'user-offline',
  USER_STATUS_CHANGE: 'user-status-change',
  FRIEND_ONLINE: 'friend-online',
  FRIEND_OFFLINE: 'friend-offline',
};

// Conversation Events
const CONVERSATION_EVENTS = {
  JOIN_CONVERSATION: 'join-conversation',
  LEAVE_CONVERSATION: 'leave-conversation',
  NEW_PARTICIPANT: 'new-participant',
  PARTICIPANT_LEFT: 'participant-left',
  CONVERSATION_CREATED: 'conversation-created',
  CONVERSATION_UPDATED: 'conversation-updated',
};

// Connection Events
const CONNECTION_EVENTS = {
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  CONNECT_ERROR: 'connect_error',
  PING: 'ping',
  PONG: 'pong',
};

// Event constants
FRIEND_EVENTS = {
  REQUEST_RECEIVED: 'friend-request-received',
  REQUEST_ACCEPTED: 'friend-request-accepted',
  REQUEST_REJECTED: 'friend-request-rejected',
  REQUEST_CANCELLED: 'friend-request-cancelled',
  FRIEND_ADDED: 'friend-added',
  FRIEND_REMOVED: 'friend-removed',
  USER_BLOCKED_YOU: 'user-blocked-you',
  FRIEND_STATUS_CHANGED: 'friend-status-changed',
  FRIENDS_LIST_UPDATED: 'friends-list-updated'
};


// Organization (TeamSpace) Events
const ORG_EVENTS = {
  // Server emits these
  ORG_CREATED: 'org:created',
  ORG_UPDATED: 'org:updated',
  ORG_DELETED: 'org:deleted',
  MEMBER_JOINED: 'org:member-joined',
  MEMBER_LEFT: 'org:member-left',
  MEMBER_REMOVED: 'org:member-removed',
  MEMBER_ROLE_CHANGED: 'org:member-role-changed',
  MEMBER_PROFILE_UPDATED: 'org:member-profile-updated',
  OWNERSHIP_TRANSFERRED: 'org:ownership-transferred',
  INVITE_RECEIVED: 'org:invite-received',
  INVITE_REVOKED: 'org:invite-revoked',

  // Client emits these
  JOIN_ORG: 'org:join',
  LEAVE_ORG: 'org:leave',
};

// Department Events
const DEPARTMENT_EVENTS = {
  // Server emits these
  DEPARTMENT_CREATED: 'department:created',
  DEPARTMENT_UPDATED: 'department:updated',
  DEPARTMENT_DELETED: 'department:deleted',
};

// Team Events
const TEAM_EVENTS = {
  // Server emits these
  TEAM_CREATED: 'team:created',
  TEAM_UPDATED: 'team:updated',
  TEAM_DELETED: 'team:deleted',
  TEAM_MEMBER_ADDED: 'team:member-added',
  TEAM_MEMBER_REMOVED: 'team:member-removed',
  TEAM_MANAGER_CHANGED: 'team:manager-changed',

  // Client emits these
  JOIN_TEAM: 'team:join',
  LEAVE_TEAM: 'team:leave',
};

// Task Events (manager-assigned work)
const TASK_EVENTS = {
  // Server emits these
  CREATED: 'task:created',
  UPDATED: 'task:updated',
  DELETED: 'task:deleted',
};

// Calendar Events (meetings, events, deadlines)
const CALENDAR_EVENTS = {
  // Server emits these
  CREATED: 'event:created',
  UPDATED: 'event:updated',
  DELETED: 'event:deleted',
};

// File sharing Events
const FILE_EVENTS = {
  // Server emits these
  UPLOADED: 'file:uploaded',
  DELETED: 'file:deleted',
};

// Announcement (company-wide notices) Events
const ANNOUNCEMENT_EVENTS = {
  // Server emits these
  NEW: 'announcement:new',
  ACKED: 'announcement:acked',
  DELETED: 'announcement:deleted',
};

// Team Channel Events
const CHANNEL_EVENTS = {
  // Server emits these
  CHANNEL_CREATED: 'channel:created',
  CHANNEL_UPDATED: 'channel:updated',
  CHANNEL_DELETED: 'channel:deleted',
};

module.exports = {
  MESSAGE_EVENTS,
  USER_EVENTS,
  CONVERSATION_EVENTS,
  CONNECTION_EVENTS,
  FRIEND_EVENTS,
  ORG_EVENTS,
  TEAM_EVENTS,
  DEPARTMENT_EVENTS,
  CHANNEL_EVENTS,
  ANNOUNCEMENT_EVENTS,
  TASK_EVENTS,
  FILE_EVENTS,
  CALENDAR_EVENTS,
};