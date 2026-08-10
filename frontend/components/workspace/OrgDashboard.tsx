"use client";
import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { del, get } from "@/lib/api";
import type { OrgRole, User } from "@/lib/types";
import { ROLE_LABEL, ROLE_TONE, dayLabel, prettyBytes } from "@/lib/format";
import {
  Avatar,
  Badge,
  Button,
  Modal,
  Spinner,
  cx,
  useToast,
} from "@/components/ui";
import {
  Calendar,
  ChartBar,
  Clipboard,
  Crown,
  Folder,
  Hash,
  Mail,
  Megaphone,
  Users,
  X,
} from "@/components/icons";

interface DashboardData {
  organization: { name: string; slug: string; createdAt?: string };
  members: {
    total: number;
    byRole: Record<OrgRole, number>;
    recentJoins: { _id: string; user: User; role: OrgRole; joinedAt: string }[];
  };
  teams: {
    total: number;
    departments: number;
    top: { _id: string; name: string; memberCount: number; manager: User | null }[];
  };
  channels: { total: number };
  invites: {
    pending: number;
    list: {
      _id: string;
      email: string;
      role: OrgRole;
      invitedBy?: { username: string };
      createdAt: string;
    }[];
  };
  activity: {
    messagesTotal: number;
    messagesToday: number;
    messagesWeek: number;
    tasksOpen: number;
    tasksDone: number;
    tasksOverdue: number;
    filesCount: number;
    filesBytes: number;
    eventsUpcoming: number;
    announcements: number;
  };
}

function Stat({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-ink-800 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-mist-600">
        {icon} {label}
      </p>
      <p className={cx("mt-1 text-xl font-semibold tracking-tight", tone)}>{value}</p>
      {sub && <p className="text-[11px] text-mist-600">{sub}</p>}
    </div>
  );
}

export default function OrgDashboardModal({
  open,
  onClose,
  onOpenInvite,
  onOpenAudit,
}: {
  open: boolean;
  onClose: () => void;
  onOpenInvite: () => void;
  onOpenAudit: () => void;
}) {
  const { activeOrgId } = useWorkspace();
  const toast = useToast();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!activeOrgId) return;
    get<{ data: DashboardData }>(`/organizations/${activeOrgId}/dashboard`)
      .then((res) => setData(res.data))
      .catch((err) => setError(err.message));
  }, [activeOrgId]);

  useEffect(() => {
    if (open) {
      setData(null);
      setError(null);
      load();
    }
  }, [open, load]);

  const revokeInvite = async (inviteId: string, email: string) => {
    try {
      await del(`/organizations/${activeOrgId}/invites/${inviteId}`);
      toast(`Invite to ${email} revoked`);
      load();
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  const a = data?.activity;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <ChartBar size={15} className="text-accent-300" /> Admin dashboard
          {data && (
            <span className="text-xs font-normal text-mist-600">
              {data.organization.name}
            </span>
          )}
        </span>
      }
      width={720}
    >
      <div className="-mt-1 mb-3 flex justify-end">
        <Button
          variant="outline"
          className="h-7 px-2.5 text-[11px]"
          onClick={() => {
            onClose();
            onOpenAudit();
          }}
        >
          🛡 Audit log
        </Button>
      </div>
      {error ? (
        <p className="rounded-lg border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : !data ? (
        <div className="flex justify-center py-16">
          <Spinner size={20} />
        </div>
      ) : (
        <div className="max-h-[68vh] space-y-4 overflow-y-auto pr-1">
          {/* Top stats */}
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <Stat
              icon={<Users size={12} />}
              label="Members"
              value={data.members.total}
              sub={`${data.invites.pending} invite${data.invites.pending === 1 ? "" : "s"} pending`}
            />
            <Stat
              icon={<Users size={12} />}
              label="Teams"
              value={data.teams.total}
              sub={`${data.teams.departments} department${data.teams.departments === 1 ? "" : "s"}`}
            />
            <Stat
              icon={<Hash size={12} />}
              label="Channels"
              value={data.channels.total}
            />
            <Stat
              icon={<Folder size={12} />}
              label="Files"
              value={a!.filesCount}
              sub={prettyBytes(a!.filesBytes)}
            />
          </div>

          {/* Activity */}
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <Stat
              icon={<Hash size={12} />}
              label="Messages"
              value={a!.messagesTotal}
              sub={`${a!.messagesToday} today · ${a!.messagesWeek} this week`}
            />
            <Stat
              icon={<Clipboard size={12} />}
              label="Open tasks"
              value={a!.tasksOpen}
              sub={`${a!.tasksDone} completed`}
            />
            <Stat
              icon={<Clipboard size={12} />}
              label="Overdue"
              value={a!.tasksOverdue}
              tone={a!.tasksOverdue > 0 ? "text-danger" : "text-ok"}
              sub={a!.tasksOverdue > 0 ? "needs attention" : "all on track"}
            />
            <Stat
              icon={<Calendar size={12} />}
              label="Events (7d)"
              value={a!.eventsUpcoming}
              sub={`${a!.announcements} notice${a!.announcements === 1 ? "" : "s"} total`}
            />
          </div>

          {/* Members by role */}
          <div className="rounded-xl border border-line bg-ink-800 p-3.5">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-mist-600">
              Members by role
            </p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(data.members.byRole) as OrgRole[]).map((r) => (
                <Badge key={r} className={ROLE_TONE[r]}>
                  {ROLE_LABEL[r]} · {data.members.byRole[r]}
                </Badge>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Recent joins */}
            <div className="rounded-xl border border-line bg-ink-800 p-3.5">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-mist-600">
                Recent joins
              </p>
              <div className="space-y-2">
                {data.members.recentJoins.length === 0 && (
                  <p className="text-xs text-mist-600">Nobody yet.</p>
                )}
                {data.members.recentJoins.map((m) =>
                  m.user ? (
                    <div key={m._id} className="flex items-center gap-2.5">
                      <Avatar
                        name={m.user.username}
                        src={m.user.avatar}
                        size={26}
                        online={m.user.online}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium leading-4">
                          {m.user.username}
                        </p>
                        <p className="text-[10.5px] text-mist-600">
                          joined {dayLabel(m.joinedAt)}
                        </p>
                      </div>
                      <Badge className={ROLE_TONE[m.role]}>{ROLE_LABEL[m.role]}</Badge>
                    </div>
                  ) : null
                )}
              </div>
            </div>

            {/* Pending invites */}
            <div className="rounded-xl border border-line bg-ink-800 p-3.5">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-mist-600">
                  Pending invites ({data.invites.pending})
                </p>
                <Button
                  variant="outline"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => {
                    onClose();
                    onOpenInvite();
                  }}
                >
                  <Mail size={11} /> Invite
                </Button>
              </div>
              <div className="space-y-1.5">
                {data.invites.list.length === 0 && (
                  <p className="text-xs text-mist-600">No pending invites.</p>
                )}
                {data.invites.list.map((inv) => (
                  <div
                    key={inv._id}
                    className="flex items-center gap-2 rounded-lg border border-line bg-ink-750 px-2.5 py-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-xs">{inv.email}</span>
                    <Badge className={ROLE_TONE[inv.role]}>{ROLE_LABEL[inv.role]}</Badge>
                    <button
                      title="Revoke invite"
                      className="text-mist-600 hover:text-danger"
                      onClick={() => revokeInvite(inv._id, inv.email)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Teams by size */}
          <div className="rounded-xl border border-line bg-ink-800 p-3.5">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-mist-600">
              Teams by size
            </p>
            {data.teams.top.length === 0 ? (
              <p className="text-xs text-mist-600">No teams yet.</p>
            ) : (
              <div className="space-y-1.5">
                {data.teams.top.map((t) => {
                  const max = data.teams.top[0]?.memberCount || 1;
                  return (
                    <div key={t._id} className="flex items-center gap-2.5">
                      <span className="w-28 truncate text-[12.5px] font-medium">
                        {t.name}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-700">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-accent-600 to-accent-400"
                          style={{
                            width: `${Math.max((t.memberCount / max) * 100, 4)}%`,
                          }}
                        />
                      </div>
                      <span className="w-8 text-right text-[11px] text-mist-500">
                        {t.memberCount}
                      </span>
                      {t.manager && (
                        <span className="flex w-24 items-center gap-1 truncate text-[11px] text-mist-600">
                          <Crown size={10} className="shrink-0 text-warn" />
                          {t.manager.username}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
