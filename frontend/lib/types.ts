export interface User {
  _id: string;
  id?: string;
  username: string;
  email?: string;
  avatar?: string | null;
  status?: string;
  online?: boolean;
  lastSeen?: string;
  isSuperAdmin?: boolean;
}

export type OrgRole = "owner" | "admin" | "manager" | "employee";

export interface Organization {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  logo?: string | null;
  industry?: string | null;
  size?: string;
  owner?: string;
}

export interface Membership {
  _id: string;
  organization: string | Organization;
  user: string | User;
  role: OrgRole;
  jobTitle?: string;
  department?: string;
  joinedAt?: string;
}

export interface MyOrg {
  organization: Organization;
  role: OrgRole;
  memberCount: number;
  joinedAt?: string;
}

export interface Department {
  _id: string;
  name: string;
  description?: string;
  head?: User | null;
  teams: Team[];
}

export interface Team {
  _id: string;
  name: string;
  description?: string;
  department?: { _id: string; name: string } | string | null;
  manager?: User | null;
  members: (User | string)[];
  conversation?: string | { _id: string } | null;
  memberCount?: number;
}

export interface Structure {
  organization: { _id: string; name: string };
  departments: Department[];
  unassignedTeams: Team[];
  counts: { departments: number; teams: number };
}

export type ChannelType = "general" | "announcement" | "team" | "custom" | undefined;

export interface Conversation {
  _id: string;
  isGroup: boolean;
  groupName?: string;
  groupAdmin?: string | User | null;
  organizationId?: string | null;
  teamId?: string | null;
  channelType?: ChannelType;
  isDefault?: boolean;
  participants: User[];
  displayName?: string;
  unreadCount?: number;
  lastMessage?: Message | null;
  metadata?: { description?: string };
  updatedAt?: string;
}

export interface Message {
  _id: string;
  conversationId: string;
  sender: User;
  content?: string;
  messageType: "text" | "image" | "video" | "file" | "audio" | "system";
  mediaUrl?: string | null;
  mentions?: User[];
  edited?: boolean;
  editedAt?: string | null;
  pinned?: boolean;
  pinnedBy?: User | string | null;
  deleted?: boolean;
  createdAt: string;
  repliedTo?: Message | null;
}

export interface OrgInvite {
  _id: string;
  email: string;
  role: OrgRole;
  status: string;
  token?: string;
  invitedBy?: User;
  createdAt?: string;
  expiresAt?: string;
}

export interface InviteInfo {
  organization: Organization;
  role: OrgRole;
  invitedBy?: User;
  email: string;
  message?: string;
  status: string;
  expiresAt?: string;
}

export type AnnouncementPriority = "normal" | "important" | "urgent";

export interface Announcement {
  _id: string;
  title: string;
  body: string;
  priority: AnnouncementPriority;
  createdBy: User;
  createdAt: string;
  ackCount: number;
  memberCount: number;
  acked: boolean;
  expiresAt?: string | null;
}

export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskPriority = "low" | "medium" | "high";

export interface Task {
  _id: string;
  title: string;
  description?: string;
  assignee: User;
  assignedBy: User;
  team?: { _id: string; name: string } | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string | null;
  completedAt?: string | null;
  createdAt: string;
}

export interface SharedFile {
  _id: string;
  name: string;
  description?: string;
  url: string;
  resourceType: "image" | "video" | "raw";
  format?: string | null;
  bytes: number;
  team?: { _id: string; name: string } | null;
  uploadedBy: User;
  createdAt: string;
}

export type EventType = "meeting" | "event" | "deadline";

export interface OrgEvent {
  _id: string;
  title: string;
  description?: string;
  type: EventType;
  startAt: string;
  endAt?: string | null;
  allDay?: boolean;
  location?: string;
  team?: { _id: string; name: string } | null;
  createdBy: User;
}

export interface TaskDeadline {
  _id: string;
  title: string;
  dueDate: string;
  status: string;
  priority: string;
}

export const INDUSTRIES = [
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

export const ORG_SIZES = ["1-10", "11-50", "51-200", "201-500", "500+"];
