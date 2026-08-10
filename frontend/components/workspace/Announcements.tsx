"use client";
import { FormEvent, useState } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { del, get, post } from "@/lib/api";
import type { Announcement, AnnouncementPriority, User } from "@/lib/types";
import { dayLabel, timeOf } from "@/lib/format";
import {
  Avatar,
  Badge,
  Button,
  Field,
  Input,
  Modal,
  Textarea,
  cx,
  useToast,
} from "@/components/ui";
import { Check, Megaphone, Trash, Users } from "@/components/icons";

const PRIORITY_TONE: Record<AnnouncementPriority, string> = {
  urgent: "border-danger/40 bg-danger/10 text-danger",
  important: "border-warn/40 bg-warn/10 text-warn",
  normal: "border-line-strong bg-ink-700/60 text-mist-300",
};

const PRIORITY_BAR: Record<AnnouncementPriority, string> = {
  urgent: "bg-danger",
  important: "bg-warn",
  normal: "bg-accent-500",
};

function AckDetails({ announcementId }: { announcementId: string }) {
  const { activeOrgId } = useWorkspace();
  const [data, setData] = useState<{
    acked: { user: User; at: string }[];
    pending: User[];
  } | null>(null);
  const [open, setOpen] = useState(false);

  const toggle = async () => {
    if (!open && !data) {
      try {
        const res = await get<{ data: any }>(
          `/organizations/${activeOrgId}/announcements/${announcementId}/acks`
        );
        setData(res.data);
      } catch {
        setData({ acked: [], pending: [] });
      }
    }
    setOpen((v) => !v);
  };

  return (
    <div className="mt-2">
      <button
        onClick={toggle}
        className="text-xs font-medium text-accent-300 hover:underline"
      >
        {open ? "Hide" : "See"} who acknowledged
      </button>
      {open && data && (
        <div className="mt-2 space-y-2 rounded-lg border border-line bg-ink-900 p-2.5 text-xs">
          <div>
            <p className="mb-1 font-semibold text-ok">
              Acknowledged ({data.acked.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {data.acked.length === 0 && (
                <span className="text-mist-600">Nobody yet.</span>
              )}
              {data.acked.map((a) => (
                <span
                  key={a.user?._id}
                  className="flex items-center gap-1 rounded-full border border-line bg-ink-750 py-0.5 pl-1 pr-2"
                >
                  <Avatar name={a.user?.username || "?"} size={14} />
                  {a.user?.username}
                </span>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 font-semibold text-warn">
              Pending ({data.pending.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {data.pending.length === 0 && (
                <span className="text-mist-600">Everyone has seen it 🎉</span>
              )}
              {data.pending.map((u) => (
                <span
                  key={u._id}
                  className="flex items-center gap-1 rounded-full border border-line bg-ink-750 py-0.5 pl-1 pr-2"
                >
                  <Avatar name={u.username} size={14} />
                  {u.username}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AnnouncementCard({ a }: { a: Announcement }) {
  const { activeOrgId, me, myRole, refetchAnnouncements } = useWorkspace();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const mine = a.createdBy?._id === me._id;
  const isAdmin = myRole === "owner" || myRole === "admin";
  const canSeeAcks = mine || isAdmin;

  const ack = async () => {
    setBusy(true);
    try {
      await post(
        `/organizations/${activeOrgId}/announcements/${a._id}/ack`
      );
      await refetchAnnouncements();
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete "${a.title}"?`)) return;
    try {
      await del(`/organizations/${activeOrgId}/announcements/${a._id}`);
      toast("Announcement deleted");
      refetchAnnouncements();
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-ink-800">
      <div className="flex">
        <span className={cx("w-1 shrink-0", PRIORITY_BAR[a.priority])} />
        <div className="min-w-0 flex-1 p-3.5">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-[14px] font-semibold leading-5">{a.title}</h4>
                <Badge className={PRIORITY_TONE[a.priority]}>
                  {a.priority}
                </Badge>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-mist-300">
                {a.body}
              </p>
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-mist-600">
                <Avatar name={a.createdBy?.username || "?"} size={16} />
                {a.createdBy?.username} · {dayLabel(a.createdAt)}{" "}
                {timeOf(a.createdAt)}
                <span className="ml-2 flex items-center gap-1">
                  <Users size={11} /> {a.ackCount}/{Math.max(a.memberCount - 1, 0)}{" "}
                  acknowledged
                </span>
              </p>
              {canSeeAcks && <AckDetails announcementId={a._id} />}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              {!mine &&
                (a.acked ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-ok">
                    <Check size={13} /> Acknowledged
                  </span>
                ) : (
                  <Button
                    className="h-7 px-2.5 text-xs"
                    loading={busy}
                    onClick={ack}
                  >
                    Acknowledge
                  </Button>
                ))}
              {(mine || isAdmin) && (
                <button
                  title="Delete announcement"
                  className="text-mist-600 hover:text-danger"
                  onClick={remove}
                >
                  <Trash size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AnnouncementsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { activeOrgId, announcements, annCanPost, refetchAnnouncements } =
    useWorkspace();
  const toast = useToast();
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<AnnouncementPriority>("normal");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await post(`/organizations/${activeOrgId}/announcements`, {
        title: title.trim(),
        body: body.trim(),
        priority,
      });
      toast("📢 Announcement published to everyone");
      setTitle("");
      setBody("");
      setPriority("normal");
      setComposing(false);
      refetchAnnouncements();
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Megaphone size={15} className="text-accent-300" /> Company notices
        </span>
      }
      width={560}
    >
      {annCanPost && !composing && (
        <Button className="mb-4 w-full" onClick={() => setComposing(true)}>
          <Megaphone size={14} /> New announcement
        </Button>
      )}

      {composing && (
        <form
          onSubmit={submit}
          className="mb-4 space-y-3 rounded-xl border border-accent-500/30 bg-ink-800 p-4"
        >
          <Field label="Title">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Office closed on Friday"
              minLength={2}
              maxLength={120}
              required
              autoFocus
            />
          </Field>
          <Field label="Message">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write the full notice…"
              rows={4}
              maxLength={2000}
              required
            />
          </Field>
          <Field label="Priority">
            <div className="grid grid-cols-3 gap-2">
              {(["normal", "important", "urgent"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={cx(
                    "rounded-lg border px-3 py-1.5 text-[13px] font-medium capitalize transition-colors",
                    priority === p
                      ? PRIORITY_TONE[p]
                      : "border-line bg-ink-750 text-mist-500 hover:border-line-strong"
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => setComposing(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Publish to everyone
            </Button>
          </div>
        </form>
      )}

      <div className="max-h-[55vh] space-y-2.5 overflow-y-auto pr-1">
        {announcements.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center">
            <Megaphone size={22} className="mx-auto mb-2 text-mist-600" />
            <p className="text-sm font-medium text-mist-300">No notices yet</p>
            <p className="mt-1 text-[13px] text-mist-600">
              Company-wide announcements from owners, managers and HR will show
              up here.
            </p>
          </div>
        ) : (
          announcements.map((a) => <AnnouncementCard key={a._id} a={a} />)
        )}
      </div>
    </Modal>
  );
}
