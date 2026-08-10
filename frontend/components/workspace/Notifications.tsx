"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "./WorkspaceContext";
import { get, patch } from "@/lib/api";
import { cx, Badge, IconButton, Modal, Spinner, useToast, EmptyState } from "@/components/ui";
import {
  Bell,
  Calendar,
  Check,
  Clipboard,
  Hash,
  Mail,
  Megaphone,
  Sparkle,
  Trash,
} from "@/components/icons";
import { del } from "@/lib/api";

interface Notif {
  _id: string;
  type: string;
  title: string;
  body?: string;
  read: boolean;
  timeAgo?: string;
  createdAt: string;
  sender?: { username: string; avatar?: string | null } | null;
  data?: Record<string, any>;
}

// Icon + tone by the notification's kind
const kindOf = (n: Notif): { icon: React.ReactNode; tone: string; label: string } => {
  const kind = n.data?.kind;
  if (n.type === "mention")
    return { icon: <Hash size={14} />, tone: "text-accent-300 bg-accent-500/10", label: "Mention" };
  if (kind === "task")
    return { icon: <Clipboard size={14} />, tone: "text-ok bg-ok/10", label: "Task" };
  if (kind === "announcement")
    return { icon: <Megaphone size={14} />, tone: "text-warn bg-warn/10", label: "Notice" };
  if (kind === "event")
    return { icon: <Calendar size={14} />, tone: "text-accent-300 bg-accent-500/10", label: "Calendar" };
  if (n.type === "group_invite" || kind === "organization")
    return { icon: <Mail size={14} />, tone: "text-accent-300 bg-accent-500/10", label: "Invite" };
  return { icon: <Sparkle size={14} />, tone: "text-mist-400 bg-ink-700/60", label: "Update" };
};

export default function NotificationsModal({
  open,
  onClose,
  onOpenAnnouncements,
  onOpenTasks,
}: {
  open: boolean;
  onClose: () => void;
  onOpenAnnouncements: () => void;
  onOpenTasks: () => void;
}) {
  const { selectConversation, refetchNotifCount, conversations } = useWorkspace();
  const toast = useToast();
  const router = useRouter();
  const [items, setItems] = useState<Notif[] | null>(null);
  const [emailEnabled, setEmailEnabled] = useState<boolean | null>(null);

  const load = () => {
    get<{ data: Notif[] }>("/notifications?limit=30")
      .then((res) => setItems(res.data))
      .catch(() => setItems([]));
  };

  useEffect(() => {
    if (!open) return;
    setItems(null);
    load();
    get<{ data: { emailEnabled?: boolean } }>("/notifications/settings")
      .then((res) => setEmailEnabled(res.data?.emailEnabled !== false))
      .catch(() => setEmailEnabled(true));
  }, [open]);

  const markRead = async (n: Notif) => {
    if (n.read) return;
    try {
      await patch(`/notifications/${n._id}/read`);
      setItems((prev) =>
        prev ? prev.map((x) => (x._id === n._id ? { ...x, read: true } : x)) : prev
      );
      refetchNotifCount();
    } catch {
      /* non-fatal */
    }
  };

  const openTarget = async (n: Notif) => {
    await markRead(n);
    const d = n.data || {};
    if (d.kind === "announcement") {
      onClose();
      onOpenAnnouncements();
      return;
    }
    if (d.kind === "task") {
      onClose();
      onOpenTasks();
      return;
    }
    if (d.inviteToken) {
      router.push(`/invite/${d.inviteToken}`);
      return;
    }
    if (d.conversationId) {
      const exists = conversations.some((c) => c._id === d.conversationId);
      if (exists) {
        selectConversation(d.conversationId);
        onClose();
        return;
      }
    }
  };

  const markAll = async () => {
    try {
      await patch("/notifications/read/all");
      setItems((prev) => (prev ? prev.map((x) => ({ ...x, read: true })) : prev));
      refetchNotifCount();
      toast("All caught up ✓");
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  const clearAll = async () => {
    if (!confirm("Clear all notifications?")) return;
    try {
      await del("/notifications");
      setItems([]);
      refetchNotifCount();
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  const toggleEmail = async () => {
    const next = !(emailEnabled !== false);
    setEmailEnabled(next);
    try {
      await patch("/notifications/settings", { emailEnabled: next });
      toast(next ? "📧 Email notifications on" : "Email notifications off");
    } catch (err: any) {
      setEmailEnabled(!next);
      toast(err.message, "error");
    }
  };

  const unread = (items || []).filter((n) => !n.read).length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Bell size={15} className="text-accent-300" /> Notifications
          {unread > 0 && (
            <Badge className="border-accent-500/30 bg-accent-500/10 text-accent-300">
              {unread} new
            </Badge>
          )}
        </span>
      }
      width={520}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          onClick={toggleEmail}
          className={cx(
            "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
            emailEnabled !== false
              ? "border-ok/30 bg-ok/10 text-ok"
              : "border-line bg-ink-800 text-mist-500 hover:text-mist-300"
          )}
          title="Important notifications (mentions, tasks, urgent notices) are also emailed via Resend"
        >
          <Mail size={13} />
          Email alerts {emailEnabled === null ? "…" : emailEnabled !== false ? "on" : "off"}
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={markAll}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-mist-500 transition-colors hover:bg-ink-700 hover:text-mist-100"
          >
            <Check size={13} /> Mark all read
          </button>
          <IconButton label="Clear all" onClick={clearAll}>
            <Trash size={13} />
          </IconButton>
        </div>
      </div>

      <div className="max-h-[55vh] space-y-1.5 overflow-y-auto pr-1">
        {items === null ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Bell size={22} />}
            title="No notifications"
            hint="Mentions, task assignments, notices and invites will land here."
          />
        ) : (
          items.map((n) => {
            const kind = kindOf(n);
            return (
              <button
                key={n._id}
                onClick={() => openTarget(n)}
                className={cx(
                  "flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                  n.read
                    ? "border-line bg-ink-850 opacity-75 hover:opacity-100"
                    : "border-accent-500/25 bg-ink-800 hover:border-accent-500/50"
                )}
              >
                <span
                  className={cx(
                    "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                    kind.tone
                  )}
                >
                  {kind.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span
                      className={cx(
                        "truncate text-[13.5px] leading-5",
                        n.read ? "text-mist-400" : "font-semibold text-mist-100"
                      )}
                    >
                      {n.title}
                    </span>
                    {!n.read && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400" />
                    )}
                  </span>
                  {n.body && (
                    <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-mist-600">
                      {n.body}
                    </span>
                  )}
                  <span className="mt-1 block text-[10.5px] text-mist-600">
                    {kind.label}
                    {n.sender?.username ? ` · from ${n.sender.username}` : ""} ·{" "}
                    {n.timeAgo || ""}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </Modal>
  );
}
