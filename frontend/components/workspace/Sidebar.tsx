"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "./WorkspaceContext";
import { useAuth } from "@/lib/auth";
import type { Conversation } from "@/lib/types";
import { ROLE_LABEL, ROLE_TONE } from "@/lib/format";
import { Avatar, Badge, IconButton, SectionLabel, cx } from "@/components/ui";
import {
  Bell,
  Building,
  Calendar,
  ChartBar,
  Chevron,
  Clipboard,
  Hash,
  Logout,
  Mail,
  Megaphone,
  Plus,
  Search,
  Shield,
  Sparkle,
  Users,
} from "@/components/icons";

export function channelIcon(c: Conversation, size = 15) {
  if (c.channelType === "announcement") return <Megaphone size={size} />;
  return <Hash size={size} />;
}

function ChannelRow({ conv }: { conv: Conversation }) {
  const { activeConvId, selectConversation } = useWorkspace();
  const active = activeConvId === conv._id;
  const unread = conv.unreadCount || 0;
  return (
    <button
      onClick={() => selectConversation(conv._id)}
      className={cx(
        "group flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-left text-[13.5px] transition-colors",
        active
          ? "bg-accent-500/15 text-mist-100"
          : unread > 0
            ? "text-mist-100 hover:bg-ink-700"
            : "text-mist-500 hover:bg-ink-700 hover:text-mist-300"
      )}
    >
      <span className={cx("shrink-0", active ? "text-accent-300" : "text-mist-600")}>
        {channelIcon(conv)}
      </span>
      <span className={cx("min-w-0 flex-1 truncate", unread > 0 && !active && "font-semibold")}>
        {conv.displayName || conv.groupName}
      </span>
      {unread > 0 && !active && (
        <span className="rounded-full bg-accent-500 px-1.5 py-px text-[10.5px] font-bold text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}

export default function Sidebar({
  open = true,
  onOpenDirectory,
  onOpenInvite,
  onOpenMembers,
  onOpenAnnouncements,
  onOpenTasks,
  onOpenNotifications,
  onOpenCalendar,
  onOpenPeople,
  onOpenDashboard,
  onOpenAssistant,
  onCreateChannel,
}: {
  open?: boolean;
  onOpenDirectory: () => void;
  onOpenInvite: () => void;
  onOpenMembers: () => void;
  onOpenAnnouncements: () => void;
  onOpenTasks: () => void;
  onOpenNotifications: () => void;
  onOpenCalendar: () => void;
  onOpenPeople: () => void;
  onOpenDashboard: () => void;
  onOpenAssistant: () => void;
  onCreateChannel: (teamId: string) => void;
}) {
  const {
    orgs,
    activeOrgId,
    selectOrg,
    myRole,
    conversations,
    structure,
    members,
    unackedCount,
    openTaskCount,
    notifUnread,
    me,
  } = useWorkspace();
  const { logout } = useAuth();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const activeOrg = orgs.find((o) => o.organization._id === activeOrgId);
  const isAdmin = myRole === "owner" || myRole === "admin";

  const { orgChannels, teamGroups } = useMemo(() => {
    const orgChannels = conversations.filter((c) => !c.teamId);
    const byTeam = new Map<string, Conversation[]>();
    conversations
      .filter((c) => c.teamId)
      .forEach((c) => {
        const key = c.teamId as string;
        byTeam.set(key, [...(byTeam.get(key) || []), c]);
      });

    const teamName = (teamId: string): { name: string; managed: boolean } => {
      const all = [
        ...(structure?.departments.flatMap((d) => d.teams) || []),
        ...(structure?.unassignedTeams || []),
      ];
      const t = all.find((x) => x._id === teamId);
      const managed =
        isAdmin || (t?.manager && (t.manager as any)._id === me._id) || false;
      return { name: t?.name || "Team", managed: !!managed };
    };

    const teamGroups = [...byTeam.entries()]
      .map(([teamId, channels]) => ({
        teamId,
        ...teamName(teamId),
        channels: channels.sort(
          (a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0)
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { orgChannels, teamGroups };
  }, [conversations, structure, isAdmin, me._id]);

  return (
    <div className="flex h-full">
      {/* Org rail */}
      <div className="flex w-[60px] flex-col items-center gap-2 border-r border-line bg-ink-950 py-3">
        {orgs.map((o) => {
          const active = o.organization._id === activeOrgId;
          return (
            <button
              key={o.organization._id}
              onClick={() => selectOrg(o.organization._id)}
              title={o.organization.name}
              className={cx(
                "relative rounded-xl transition-all",
                active
                  ? "ring-2 ring-accent-400 ring-offset-2 ring-offset-ink-950"
                  : "opacity-60 hover:opacity-100"
              )}
            >
              <Avatar
                name={o.organization.name}
                src={o.organization.logo}
                size={38}
                square
              />
            </button>
          );
        })}
        <button
          onClick={() => router.push("/onboarding")}
          title="New organization"
          className="mt-1 flex h-[38px] w-[38px] items-center justify-center rounded-xl border border-dashed border-line-strong text-mist-600 transition-colors hover:border-accent-500/60 hover:text-accent-300"
        >
          <Plus size={16} />
        </button>
        <div className="mt-auto flex flex-col items-center gap-2.5">
          <button
            onClick={onOpenNotifications}
            title="Notifications"
            aria-label="Notifications"
            className="relative flex h-9 w-9 items-center justify-center rounded-xl text-mist-500 transition-colors hover:bg-ink-700 hover:text-mist-100"
          >
            <Bell size={17} />
            {notifUnread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9.5px] font-bold text-white">
                {notifUnread > 99 ? "99" : notifUnread}
              </span>
            )}
          </button>
          <Avatar name={me.username} src={me.avatar} size={34} online />
        </div>
      </div>

      {/* Panel — slides closed/open */}
      <div
        className={cx(
          "overflow-hidden bg-ink-900 transition-all duration-200 ease-out",
          open ? "w-[248px] border-r border-line" : "w-0"
        )}
      >
        <div className="flex h-full w-[248px] flex-col">
        {/* Org header */}
        <div className="border-b border-line px-4 py-3.5">
          <div className="flex items-center justify-between">
            <h2 className="truncate text-[15px] font-semibold tracking-tight">
              {activeOrg?.organization.name || "…"}
            </h2>
            {myRole && (
              <Badge className={ROLE_TONE[myRole]}>{ROLE_LABEL[myRole]}</Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-mist-600">
            {members.length || activeOrg?.memberCount || 0} member
            {(members.length || activeOrg?.memberCount || 0) === 1 ? "" : "s"}
          </p>
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          <SectionLabel>Channels</SectionLabel>
          <div className="space-y-px">
            {orgChannels.map((c) => (
              <ChannelRow key={c._id} conv={c} />
            ))}
          </div>

          <SectionLabel
            action={
              <span className="text-[11px] text-mist-600">
                {structure?.counts.teams || 0}
              </span>
            }
          >
            Teams
          </SectionLabel>
          <div className="space-y-1">
            {teamGroups.length === 0 && (
              <p className="px-2 py-1 text-xs leading-relaxed text-mist-600">
                No team channels yet.
                {isAdmin && " Create a team from the directory below."}
              </p>
            )}
            {teamGroups.map((group) => {
              const isCollapsed = collapsed[group.teamId];
              return (
                <div key={group.teamId}>
                  <div className="group flex items-center gap-1 rounded-md px-1 py-0.5 text-mist-500">
                    <button
                      className="flex min-w-0 flex-1 items-center gap-1 text-left"
                      onClick={() =>
                        setCollapsed((p) => ({
                          ...p,
                          [group.teamId]: !p[group.teamId],
                        }))
                      }
                    >
                      <Chevron size={12} open={!isCollapsed} />
                      <Users size={13} className="shrink-0" />
                      <span className="truncate text-xs font-semibold uppercase tracking-wide">
                        {group.name}
                      </span>
                    </button>
                    {group.managed && (
                      <IconButton
                        label="New channel"
                        className="h-5 w-5 opacity-0 group-hover:opacity-100"
                        onClick={() => onCreateChannel(group.teamId)}
                      >
                        <Plus size={12} />
                      </IconButton>
                    )}
                  </div>
                  {!isCollapsed && (
                    <div className="ml-2 space-y-px border-l border-line pl-2">
                      {group.channels.map((c) => (
                        <ChannelRow key={c._id} conv={c} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <SectionLabel>Workspace</SectionLabel>
          <div className="space-y-px">
            <button
              onClick={onOpenAssistant}
              className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[13.5px] transition-colors hover:bg-accent-500/10"
            >
              <span className="flex h-[17px] w-[17px] items-center justify-center rounded bg-gradient-to-br from-accent-500 to-violet-600">
                <Sparkle size={11} className="text-white" />
              </span>
              <span className="bg-gradient-to-r from-accent-300 to-violet-300 bg-clip-text font-medium text-transparent">
                Assistant
              </span>
            </button>
            <button
              onClick={onOpenTasks}
              className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[13.5px] text-mist-500 transition-colors hover:bg-ink-700 hover:text-mist-300"
            >
              <Clipboard size={15} className="text-mist-600" />
              <span className="flex-1 text-left">Tasks</span>
              {openTaskCount > 0 && (
                <span className="rounded-full bg-accent-500 px-1.5 py-px text-[10.5px] font-bold text-white">
                  {openTaskCount}
                </span>
              )}
            </button>
            <button
              onClick={onOpenCalendar}
              className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[13.5px] text-mist-500 transition-colors hover:bg-ink-700 hover:text-mist-300"
            >
              <Calendar size={15} className="text-mist-600" />
              <span className="flex-1 text-left">Calendar</span>
            </button>
            <button
              onClick={onOpenAnnouncements}
              className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[13.5px] text-mist-500 transition-colors hover:bg-ink-700 hover:text-mist-300"
            >
              <Megaphone size={15} className="text-mist-600" />
              <span className="flex-1 text-left">Notices</span>
              {unackedCount > 0 && (
                <span className="rounded-full bg-danger px-1.5 py-px text-[10.5px] font-bold text-white">
                  {unackedCount}
                </span>
              )}
            </button>
            <button
              onClick={onOpenPeople}
              className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[13.5px] text-mist-500 transition-colors hover:bg-ink-700 hover:text-mist-300"
            >
              <Search size={15} className="text-mist-600" />
              People
            </button>
            <button
              onClick={onOpenDirectory}
              className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[13.5px] text-mist-500 transition-colors hover:bg-ink-700 hover:text-mist-300"
            >
              <Building size={15} className="text-mist-600" />
              Directory
            </button>
            <button
              onClick={onOpenMembers}
              className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[13.5px] text-mist-500 transition-colors hover:bg-ink-700 hover:text-mist-300"
            >
              <Users size={15} className="text-mist-600" />
              Members
            </button>
            {isAdmin && (
              <button
                onClick={onOpenDashboard}
                className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[13.5px] text-mist-500 transition-colors hover:bg-ink-700 hover:text-mist-300"
              >
                <ChartBar size={15} className="text-mist-600" />
                Dashboard
              </button>
            )}
            {isAdmin && (
              <button
                onClick={onOpenInvite}
                className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[13.5px] text-accent-300 transition-colors hover:bg-accent-500/10"
              >
                <Mail size={15} />
                Invite people
              </button>
            )}
            {me.isSuperAdmin && (
              <button
                onClick={() => router.push("/admin")}
                className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[13.5px] text-warn transition-colors hover:bg-warn/10"
              >
                <Shield size={15} />
                Platform admin
              </button>
            )}
          </div>
        </div>

        {/* User footer */}
        <div className="flex items-center gap-2.5 border-t border-line px-3 py-2.5">
          <Avatar name={me.username} src={me.avatar} size={30} online />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium leading-4">
              {me.username}
            </p>
            <p className="truncate text-[11px] text-mist-600">{me.email}</p>
          </div>
          <IconButton
            label="Sign out"
            onClick={async () => {
              await logout();
              router.replace("/login");
            }}
          >
            <Logout size={15} />
          </IconButton>
        </div>
        </div>
      </div>
    </div>
  );
}
