"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { get } from "@/lib/api";
import type { User } from "@/lib/types";
import { dayLabel, timeOf } from "@/lib/format";
import { Avatar, Button, Modal, Select, Spinner, cx } from "@/components/ui";
import {
  Building,
  FileDoc,
  Folder,
  Hash,
  Mail,
  Megaphone,
  Shield,
  Users,
} from "@/components/icons";

interface AuditEntry {
  _id: string;
  action: string;
  actor: User | null;
  targetUser: User | null;
  targetLabel: string;
  details: Record<string, any>;
  createdAt: string;
}

const CATEGORIES = [
  { value: "", label: "All actions" },
  { value: "member.", label: "Members & roles" },
  { value: "invite.", label: "Invites" },
  { value: "ownership.", label: "Ownership" },
  { value: "team.", label: "Teams" },
  { value: "department.", label: "Departments" },
  { value: "channel.", label: "Channels" },
  { value: "announcement.", label: "Announcements" },
  { value: "file.", label: "Files" },
  { value: "org.", label: "Organization" },
];

const iconFor = (action: string) => {
  if (action.startsWith("member.") || action.startsWith("ownership."))
    return <Users size={13} />;
  if (action.startsWith("invite.")) return <Mail size={13} />;
  if (action.startsWith("team.")) return <Users size={13} />;
  if (action.startsWith("department.")) return <Folder size={13} />;
  if (action.startsWith("channel.")) return <Hash size={13} />;
  if (action.startsWith("announcement.")) return <Megaphone size={13} />;
  if (action.startsWith("file.")) return <FileDoc size={13} />;
  return <Building size={13} />;
};

const toneFor = (action: string) => {
  if (action.includes("removed") || action.includes("deleted"))
    return "text-danger bg-danger/10";
  if (action.includes("role_changed") || action.includes("transferred"))
    return "text-warn bg-warn/10";
  return "text-accent-300 bg-accent-500/10";
};

// Human sentence for each action key
function sentence(e: AuditEntry) {
  const target = e.targetUser ? (
    <strong className="text-mist-100">{e.targetUser.username}</strong>
  ) : null;
  const label = e.targetLabel ? (
    <strong className="text-mist-100">{e.targetLabel}</strong>
  ) : null;
  const d = e.details || {};

  switch (e.action) {
    case "org.created":
      return <>created the organization {label}</>;
    case "org.updated":
      return <>updated organization settings</>;
    case "member.invited":
      return (
        <>
          invited {label} as {d.role || "employee"}
        </>
      );
    case "invite.revoked":
      return <>revoked the invite to {label}</>;
    case "member.joined":
      return <>joined the organization{d.role ? ` as ${d.role}` : ""}</>;
    case "member.role_changed":
      return (
        <>
          changed {target}&apos;s role: {d.from} → {d.to}
          {d.auto ? " (auto — made team manager)" : ""}
        </>
      );
    case "member.removed":
      return (
        <>
          removed {target} from the organization
          {d.bySuperAdmin ? " (platform admin)" : ""}
        </>
      );
    case "member.left":
      return <>left the organization</>;
    case "ownership.transferred":
      return <>transferred ownership to {target}</>;
    case "team.created":
      return <>created team {label}</>;
    case "team.deleted":
      return <>deleted team {label}</>;
    case "team.member_added":
      return (
        <>
          added {target} to {label}
        </>
      );
    case "team.member_removed":
      return (
        <>
          removed {target} from {label}
        </>
      );
    case "team.manager_changed":
      return (
        <>
          made {target} the manager of {label}
        </>
      );
    case "department.created":
      return <>created department {label}</>;
    case "department.deleted":
      return <>deleted department {label}</>;
    case "channel.created":
      return <>created channel {label}</>;
    case "channel.deleted":
      return <>deleted channel {label}</>;
    case "announcement.created":
      return (
        <>
          published notice {label}
          {d.priority && d.priority !== "normal" ? ` (${d.priority})` : ""}
        </>
      );
    case "announcement.deleted":
      return <>deleted notice {label}</>;
    case "file.deleted":
      return <>deleted file {label}</>;
    default:
      return (
        <>
          {e.action} {label}
        </>
      );
  }
}

export default function AuditLogModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { activeOrgId, members } = useWorkspace();
  const [category, setCategory] = useState("");
  const [userId, setUserId] = useState("");
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    (p = 1, append = false) => {
      if (!activeOrgId) return;
      const params = new URLSearchParams({ page: String(p) });
      if (category) params.set("action", category);
      if (userId) params.set("userId", userId);
      if (append) setLoadingMore(true);
      get<{ data: AuditEntry[]; page: number; totalPages: number; total: number }>(
        `/organizations/${activeOrgId}/audit?${params.toString()}`
      )
        .then((res) => {
          setEntries((prev) =>
            append && prev ? [...prev, ...res.data] : res.data
          );
          setPage(res.page);
          setTotalPages(res.totalPages);
          setTotal(res.total);
        })
        .catch(() => setEntries([]))
        .finally(() => setLoadingMore(false));
    },
    [activeOrgId, category, userId]
  );

  useEffect(() => {
    if (open) {
      setEntries(null);
      load(1);
    }
  }, [open, load]);

  const asUser = (u: any): User | null => (u && typeof u === "object" ? u : null);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Shield size={15} className="text-accent-300" /> Audit log
          <span className="text-xs font-normal text-mist-600">
            {total} record{total === 1 ? "" : "s"}
          </span>
        </span>
      }
      width={620}
    >
      <div className="mb-3 grid grid-cols-2 gap-2">
        <Select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="py-1.5 text-xs"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
        <Select
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className="py-1.5 text-xs"
        >
          <option value="">Everyone</option>
          {members.map((m) => {
            const u = asUser(m.user);
            return u ? (
              <option key={u._id} value={u._id}>
                {u.username}
              </option>
            ) : null;
          })}
        </Select>
      </div>

      <div className="max-h-[56vh] space-y-1 overflow-y-auto pr-1">
        {entries === null ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : entries.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-mist-600">
            No audit records match.
          </p>
        ) : (
          entries.map((e, i) => {
            const prev = entries[i - 1];
            const newDay =
              !prev || dayLabel(prev.createdAt) !== dayLabel(e.createdAt);
            return (
              <Fragment key={e._id}>
                {newDay && (
                  <p className="px-1 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-wide text-mist-600">
                    {dayLabel(e.createdAt)}
                  </p>
                )}
                <div className="flex items-start gap-2.5 rounded-lg border border-line bg-ink-800 px-3 py-2">
                  <span
                    className={cx(
                      "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                      toneFor(e.action)
                    )}
                  >
                    {iconFor(e.action)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-relaxed text-mist-400">
                      <span className="mr-1 inline-flex items-center gap-1 align-middle">
                        <Avatar name={e.actor?.username || "?"} size={16} />
                        <strong className="text-mist-100">
                          {e.actor?.username || "someone"}
                        </strong>
                      </span>
                      {sentence(e)}
                    </p>
                  </div>
                  <span className="shrink-0 pt-0.5 text-[10.5px] text-mist-600">
                    {timeOf(e.createdAt)}
                  </span>
                </div>
              </Fragment>
            );
          })
        )}
        {entries && page < totalPages && (
          <div className="flex justify-center pt-2">
            <Button
              variant="subtle"
              className="h-7 px-3 text-xs"
              loading={loadingMore}
              onClick={() => load(page + 1, true)}
            >
              Load older records
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
