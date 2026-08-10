"use client";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { useWorkspace } from "./WorkspaceContext";
import { channelIcon } from "./Sidebar";
import { del, get, patch, post, put, uploadForm } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import type { Message, SharedFile, User } from "@/lib/types";
import { dayLabel, prettyBytes, timeOf } from "@/lib/format";
import {
  Avatar,
  Button,
  EmptyState,
  IconButton,
  Spinner,
  cx,
  useToast,
} from "@/components/ui";
import {
  Download,
  Edit,
  FileDoc,
  Folder,
  Hash,
  Lock,
  Megaphone,
  PanelLeft,
  Paperclip,
  Pin,
  Send,
  Trash,
  Users,
  X,
} from "@/components/icons";

/* ---------- content rendering with @mention highlights ---------- */

function renderContent(msg: Message) {
  const content = msg.content || "";
  const names = (msg.mentions || []).map((m) => m.username).filter(Boolean);
  if (names.length === 0) return content;
  const pattern = new RegExp(
    `@(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi"
  );
  const parts = content.split(pattern);
  return parts.map((part, i) =>
    names.some((n) => n.toLowerCase() === part.toLowerCase()) ? (
      <span
        key={i}
        className="rounded bg-accent-500/20 px-1 py-px font-medium text-accent-300"
      >
        @{part}
      </span>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  );
}

/* ---------- single message row ---------- */

function MessageRow({
  msg,
  compact,
  canModerate,
  canPin,
  meId,
  flash,
}: {
  msg: Message;
  compact: boolean;
  canModerate: boolean;
  canPin: boolean;
  meId: string;
  flash?: boolean;
}) {
  const { updateMessage, markDeleted, removeMessagePin, activeConvId } =
    useWorkspace();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const mine = msg.sender?._id === meId;

  if (msg.messageType === "system") {
    return (
      <div className="my-1.5 flex justify-center">
        <span className="rounded-full border border-line bg-ink-800/70 px-3 py-1 text-xs text-mist-600">
          {msg.content}
        </span>
      </div>
    );
  }

  const saveEdit = async () => {
    try {
      const res = await put<{ data: Message }>(`/messages/single/${msg._id}`, {
        content: draft,
      });
      updateMessage(activeConvId!, res.data);
      setEditing(false);
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  const togglePin = async () => {
    try {
      await patch(`/messages/single/${msg._id}/${msg.pinned ? "unpin" : "pin"}`);
      removeMessagePin(msg._id, !msg.pinned);
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  const remove = async () => {
    try {
      await del(`/messages/${msg._id}`);
      markDeleted(msg._id);
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  return (
    <div
      data-msg-id={msg._id}
      className={cx(
        "group relative flex gap-3 px-5 py-0.5 transition-colors duration-500 hover:bg-ink-850/70",
        !compact && "mt-3",
        flash && "bg-accent-500/20"
      )}
    >
      <div className="w-9 shrink-0 pt-0.5">
        {!compact && (
          <Avatar name={msg.sender?.username || "?"} src={msg.sender?.avatar} size={34} />
        )}
        {compact && (
          <span className="hidden select-none pt-1 text-right text-[10px] leading-5 text-mist-600 group-hover:block">
            {timeOf(msg.createdAt)}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!compact && (
          <p className="flex items-baseline gap-2 leading-5">
            <span className="text-[13.5px] font-semibold">
              {msg.sender?.username}
            </span>
            <span className="text-[11px] text-mist-600">
              {timeOf(msg.createdAt)}
            </span>
            {msg.pinned && (
              <span className="flex items-center gap-1 text-[11px] text-warn">
                <Pin size={11} /> pinned
              </span>
            )}
          </p>
        )}

        {editing ? (
          <div className="mt-1 space-y-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  saveEdit();
                }
                if (e.key === "Escape") setEditing(false);
              }}
              rows={2}
              autoFocus
              className="w-full rounded-lg border border-accent-500/50 bg-ink-800 px-3 py-2 text-sm"
            />
            <div className="flex gap-2 text-xs">
              <button className="text-accent-300 hover:underline" onClick={saveEdit}>
                Save (Enter)
              </button>
              <button
                className="text-mist-600 hover:underline"
                onClick={() => setEditing(false)}
              >
                Cancel (Esc)
              </button>
            </div>
          </div>
        ) : (
          <>
            {(msg.messageType === "text" || msg.deleted || !msg.mediaUrl) && (
              <p
                className={cx(
                  "whitespace-pre-wrap break-words text-[13.5px] leading-[1.55]",
                  msg.deleted ? "italic text-mist-600" : "text-mist-300",
                  compact && msg.pinned && "border-l-2 border-warn/50 pl-2"
                )}
              >
                {msg.deleted ? "This message was deleted" : renderContent(msg)}
                {msg.edited && !msg.deleted && (
                  <span className="ml-1.5 text-[10.5px] text-mist-600">
                    (edited)
                  </span>
                )}
              </p>
            )}
            {!msg.deleted && msg.mediaUrl && msg.messageType === "image" && (
              <a href={msg.mediaUrl} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={msg.mediaUrl}
                  alt={msg.content || "image"}
                  className="mt-1 max-h-64 max-w-[340px] rounded-lg border border-line object-cover transition-opacity hover:opacity-90"
                />
              </a>
            )}
            {!msg.deleted &&
              msg.mediaUrl &&
              msg.messageType !== "image" &&
              msg.messageType !== "text" && (
                <a
                  href={msg.mediaUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 flex w-fit max-w-full items-center gap-2.5 rounded-lg border border-line bg-ink-750 px-3 py-2 transition-colors hover:border-accent-500/50"
                >
                  <FileDoc size={18} className="shrink-0 text-accent-300" />
                  <span className="truncate text-[13px] font-medium">
                    {msg.content || "attachment"}
                  </span>
                  <Download size={13} className="shrink-0 text-mist-600" />
                </a>
              )}
          </>
        )}
      </div>

      {/* hover actions */}
      {!msg.deleted && !editing && (
        <div className="absolute -top-3 right-4 hidden items-center gap-0.5 rounded-lg border border-line bg-ink-800 p-0.5 shadow-lg shadow-black/30 group-hover:flex">
          {mine && msg.messageType === "text" && (
            <IconButton
              label="Edit"
              onClick={() => {
                setDraft(msg.content || "");
                setEditing(true);
              }}
            >
              <Edit size={13} />
            </IconButton>
          )}
          {canPin && (
            <IconButton label={msg.pinned ? "Unpin" : "Pin"} onClick={togglePin}>
              <Pin size={13} className={msg.pinned ? "text-warn" : undefined} />
            </IconButton>
          )}
          {(mine || canModerate) && (
            <IconButton label="Delete" onClick={remove}>
              <Trash size={13} className="text-danger/80" />
            </IconButton>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- composer ---------- */

function Composer() {
  const { activeConv, activeOrgId, sendMessage, me } = useWorkspace();
  const toast = useToast();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const attach = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (!picked || !activeConv || !activeOrgId) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", picked);
      if (activeConv.teamId) form.append("teamId", activeConv.teamId);
      form.append("conversationId", activeConv._id);
      await uploadForm(`/organizations/${activeOrgId}/files`, form);
      toast(`📎 ${picked.name} shared`);
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setValue("");
    setMentionQuery(null);
    taRef.current?.focus();
  }, [activeConv?._id]);

  const participants: User[] = useMemo(
    () => (activeConv?.participants || []).filter((p) => p && p.username),
    [activeConv]
  );

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    return participants
      .filter((p) =>
        p.username.toLowerCase().startsWith(mentionQuery.toLowerCase())
      )
      .slice(0, 5);
  }, [mentionQuery, participants]);

  const detectMention = (text: string) => {
    const m = text.match(/(?:^|\s)@([a-zA-Z0-9_.-]*)$/);
    setMentionQuery(m ? m[1] : null);
    setMentionIndex(0);
  };

  const insertMention = (username: string) => {
    setValue((v) => v.replace(/@([a-zA-Z0-9_.-]*)$/, `@${username} `));
    setMentionQuery(null);
    taRef.current?.focus();
  };

  const submit = async () => {
    const content = value.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      await sendMessage(content);
      setValue("");
      setMentionQuery(null);
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
      taRef.current?.focus();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && mentionMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex(
          (i) => (i - 1 + mentionMatches.length) % mentionMatches.length
        );
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        insertMention(mentionMatches[mentionIndex].username);
        return;
      }
      if (e.key === "Escape") {
        setMentionQuery(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const name = activeConv?.displayName || activeConv?.groupName || "";

  return (
    <div className="relative px-5 pb-5 pt-2">
      {/* mention popover */}
      {mentionQuery !== null && mentionMatches.length > 0 && (
        <div className="absolute bottom-full left-5 z-10 mb-1 w-64 overflow-hidden rounded-xl border border-line bg-ink-800 shadow-2xl shadow-black/50">
          <p className="border-b border-line px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-mist-600">
            Mention someone
          </p>
          {mentionMatches.map((p, i) => (
            <button
              key={p._id}
              onMouseEnter={() => setMentionIndex(i)}
              onClick={() => insertMention(p.username)}
              className={cx(
                "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm",
                i === mentionIndex ? "bg-accent-500/15" : ""
              )}
            >
              <Avatar name={p.username} src={p.avatar} size={22} />
              <span className="font-medium">{p.username}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 rounded-xl border border-line bg-ink-800 px-3 py-2 transition-colors focus-within:border-accent-500/50">
        {activeConv?.organizationId && (
          <>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={attach}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              title="Share a file"
              aria-label="Share a file"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-mist-600 transition-colors hover:bg-ink-700 hover:text-mist-100"
            >
              {uploading ? <Spinner size={14} /> : <Paperclip size={15} />}
            </button>
          </>
        )}
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            detectMention(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
          }}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={`Message ${name ? `#${name}` : ""}  ·  @ to mention`}
          className="max-h-40 flex-1 resize-none bg-transparent py-1 text-sm text-mist-100 placeholder:text-mist-600 focus:outline-none"
        />
        <button
          onClick={submit}
          disabled={!value.trim() || busy}
          className={cx(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all",
            value.trim()
              ? "bg-accent-600 text-white hover:bg-accent-500"
              : "bg-ink-700 text-mist-600"
          )}
          aria-label="Send"
        >
          {busy ? <Spinner size={14} /> : <Send size={15} />}
        </button>
      </div>
      <p className="mt-1.5 px-1 text-[11px] text-mist-600">
        <span className="text-mist-500">Enter</span> to send ·{" "}
        <span className="text-mist-500">Shift+Enter</span> for a new line
        <span className="float-right">{me.username}</span>
      </p>
    </div>
  );
}

/* ---------- pins drawer ---------- */

function PinsDrawer({ onClose }: { onClose: () => void }) {
  const { activeConvId, removeMessagePin } = useWorkspace();
  const [pins, setPins] = useState<Message[] | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (!activeConvId) return;
    setPins(null);
    get<{ data: Message[] }>(`/messages/${activeConvId}/pins`)
      .then((res) => setPins(res.data))
      .catch(() => setPins([]));
  }, [activeConvId]);

  return (
    <div className="flex w-[300px] shrink-0 flex-col border-l border-line bg-ink-900">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Pin size={14} className="text-warn" /> Pinned messages
        </p>
        <IconButton label="Close" onClick={onClose}>
          <X size={14} />
        </IconButton>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {pins === null ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : pins.length === 0 ? (
          <EmptyState
            icon={<Pin size={22} />}
            title="Nothing pinned yet"
            hint="Pin important messages so the team can find them fast."
          />
        ) : (
          <div className="space-y-2">
            {pins.map((p) => (
              <div
                key={p._id}
                className="group rounded-lg border border-line bg-ink-800 p-3"
              >
                <div className="flex items-center gap-2">
                  <Avatar name={p.sender?.username || "?"} size={20} />
                  <span className="text-xs font-semibold">
                    {p.sender?.username}
                  </span>
                  <span className="text-[10px] text-mist-600">
                    {dayLabel(p.createdAt)}
                  </span>
                  <button
                    className="ml-auto hidden text-[11px] text-mist-600 hover:text-danger group-hover:block"
                    onClick={async () => {
                      try {
                        await patch(`/messages/single/${p._id}/unpin`);
                        setPins((prev) =>
                          prev ? prev.filter((x) => x._id !== p._id) : prev
                        );
                        removeMessagePin(p._id, false);
                      } catch (err: any) {
                        toast(err.message, "error");
                      }
                    }}
                  >
                    unpin
                  </button>
                </div>
                <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-mist-300">
                  {p.content}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- files drawer ---------- */

function FilesDrawer({ onClose }: { onClose: () => void }) {
  const { activeConv, activeOrgId, me, myRole } = useWorkspace();
  const toast = useToast();
  const [files, setFiles] = useState<SharedFile[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const teamId = activeConv?.teamId || null;
  const isAdmin = myRole === "owner" || myRole === "admin";

  const load = useCallback(() => {
    const q = teamId ? `?teamId=${teamId}` : `?scope=org`;
    get<{ data: SharedFile[] }>(`/organizations/${activeOrgId}/files${q}`)
      .then((res) => setFiles(res.data))
      .catch(() => setFiles([]));
  }, [activeOrgId, teamId]);

  useEffect(() => {
    setFiles(null);
    load();
  }, [load]);

  // Live refresh when anyone shares or deletes a file
  useEffect(() => {
    const socket = getSocket();
    const refresh = () => load();
    socket.on("file:uploaded", refresh);
    socket.on("file:deleted", refresh);
    return () => {
      socket.off("file:uploaded", refresh);
      socket.off("file:deleted", refresh);
    };
  }, [load]);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (!picked) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", picked);
      if (teamId) form.append("teamId", teamId);
      if (activeConv) form.append("conversationId", activeConv._id);
      await uploadForm(`/organizations/${activeOrgId}/files`, form);
      toast(`📎 ${picked.name} shared`);
      load();
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (file: SharedFile) => {
    if (!confirm(`Delete "${file.name}"?`)) return;
    try {
      await del(`/organizations/${activeOrgId}/files/${file._id}`);
      toast("File deleted");
      load();
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  return (
    <div className="flex w-[320px] shrink-0 flex-col border-l border-line bg-ink-900">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Folder size={14} className="text-accent-300" />
          {teamId ? "Team files" : "Org files"}
        </p>
        <IconButton label="Close" onClick={onClose}>
          <X size={14} />
        </IconButton>
      </div>

      <div className="border-b border-line p-3">
        <input ref={inputRef} type="file" className="hidden" onChange={pick} />
        <Button
          className="w-full"
          loading={uploading}
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip size={14} /> Share a file
        </Button>
        <p className="mt-1.5 text-center text-[11px] text-mist-600">
          Also posts into this channel · max 10MB
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {files === null ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : files.length === 0 ? (
          <EmptyState
            icon={<Folder size={22} />}
            title="No files yet"
            hint={
              teamId
                ? "Project files your team shares will live here."
                : "Files shared with the whole org will live here."
            }
          />
        ) : (
          <div className="space-y-2">
            {files.map((f) => {
              const canDelete = f.uploadedBy?._id === me._id || isAdmin;
              return (
                <div
                  key={f._id}
                  className="group rounded-lg border border-line bg-ink-800 p-2.5"
                >
                  <div className="flex items-center gap-2.5">
                    {f.resourceType === "image" ? (
                      <a href={f.url} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={f.url}
                          alt={f.name}
                          className="h-10 w-10 shrink-0 rounded-md border border-line object-cover"
                        />
                      </a>
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-ink-750 text-accent-300">
                        <FileDoc size={18} />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-[13px] font-medium hover:text-accent-300"
                        title={f.name}
                      >
                        {f.name}
                      </a>
                      <p className="truncate text-[11px] text-mist-600">
                        {prettyBytes(f.bytes)} · {f.uploadedBy?.username} ·{" "}
                        {dayLabel(f.createdAt)}
                      </p>
                    </div>
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                      title="Open / download"
                      className="hidden text-mist-600 hover:text-mist-100 group-hover:block"
                    >
                      <Download size={14} />
                    </a>
                    {canDelete && (
                      <button
                        title="Delete file"
                        className="hidden text-mist-600 hover:text-danger group-hover:block"
                        onClick={() => remove(f)}
                      >
                        <Trash size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- main chat view ---------- */

export default function ChatView({
  onOpenAnnouncements,
  sidebarOpen = true,
  onToggleSidebar,
}: {
  onOpenAnnouncements?: () => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}) {
  const { activeConv, activeConvId, messages, myRole, me, loadOlder, unackedCount } =
    useWorkspace();
  const [showPins, setShowPins] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [pins, setPins] = useState<Message[]>([]);
  const [pinIdx, setPinIdx] = useState(0);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const convIdRef = useRef<string | null>(null);
  convIdRef.current = activeConvId;

  // Pinned banner data — refreshed on channel switch and live pin events
  const refreshPins = useCallback(() => {
    const convId = convIdRef.current;
    if (!convId) {
      setPins([]);
      return;
    }
    get<{ data: Message[] }>(`/messages/${convId}/pins`)
      .then((res) => {
        if (convIdRef.current === convId) setPins(res.data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setPins([]);
    setPinIdx(0);
    refreshPins();
  }, [activeConvId, refreshPins]);

  useEffect(() => {
    const socket = getSocket();
    const onPinChange = (p: any) => {
      if ((p?.conversationId || "").toString() === convIdRef.current) {
        refreshPins();
      }
    };
    socket.on("message-pinned", onPinChange);
    socket.on("message-unpinned", onPinChange);
    return () => {
      socket.off("message-pinned", onPinChange);
      socket.off("message-unpinned", onPinChange);
    };
  }, [refreshPins]);

  // Scrolls to a message, loading older pages until it's in the DOM
  const scrollToMessage = async (messageId: string) => {
    if (locating) return;
    setLocating(true);
    try {
      for (let attempt = 0; attempt < 30; attempt++) {
        const el = scrollRef.current?.querySelector(
          `[data-msg-id="${messageId}"]`
        ) as HTMLElement | null;
        if (el) {
          stickToBottom.current = false;
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          setFlashId(messageId);
          setTimeout(() => setFlashId(null), 1800);
          return;
        }
        const loadedMore = await loadOlder();
        if (!loadedMore) return;
        // Give React a moment to paint the prepended page
        await new Promise((r) => setTimeout(r, 80));
      }
    } finally {
      setLocating(false);
    }
  };

  const meId = me._id?.toString();
  const isManagerPlus =
    myRole === "owner" || myRole === "admin" || myRole === "manager";
  const canModerate = myRole === "owner" || myRole === "admin";
  const isOrgChannel = !!activeConv?.organizationId;
  const canPin = isOrgChannel ? isManagerPlus : true;
  const announcementLocked =
    activeConv?.channelType === "announcement" && !isManagerPlus;

  // Track whether the user is near the bottom
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages?.items.length, activeConv?._id]);

  useEffect(() => {
    stickToBottom.current = true;
    setShowPins(false);
    setShowFiles(false);
  }, [activeConv?._id]);

  if (!activeConv) {
    return (
      <div className="flex min-w-0 flex-1 flex-col bg-ink-950">
        <div className="flex h-[54px] shrink-0 items-center border-b border-line px-4">
          {onToggleSidebar && (
            <IconButton
              label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              onClick={onToggleSidebar}
            >
              <PanelLeft size={16} />
            </IconButton>
          )}
        </div>
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={<Hash size={26} />}
            title="Pick a channel"
            hint="Choose a channel from the sidebar to start the conversation."
          />
        </div>
      </div>
    );
  }

  const name = activeConv.displayName || activeConv.groupName || "channel";
  const description =
    activeConv.metadata?.description ||
    (activeConv.channelType === "general"
      ? "Org-wide conversation for everyone."
      : activeConv.channelType === "announcement"
        ? "Official announcements — managers and admins post here."
        : activeConv.channelType === "team"
          ? "Team home channel."
          : "");
  const memberCount = (activeConv.participants?.length || 0) + 1;

  const items = messages?.items || [];

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col bg-ink-950">
        {/* unacknowledged company notices */}
        {unackedCount > 0 && onOpenAnnouncements && (
          <button
            onClick={onOpenAnnouncements}
            className="flex items-center gap-2.5 border-b border-warn/25 bg-warn/10 px-5 py-2 text-left text-[13px] text-warn transition-colors hover:bg-warn/15"
          >
            <Megaphone size={14} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {unackedCount} company notice{unackedCount === 1 ? "" : "s"} need
              {unackedCount === 1 ? "s" : ""} your attention
            </span>
            <span className="shrink-0 font-semibold underline-offset-2 hover:underline">
              Review
            </span>
          </button>
        )}

        {/* header */}
        <div className="flex h-[54px] shrink-0 items-center gap-3 border-b border-line px-4">
          {onToggleSidebar && (
            <IconButton
              label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              onClick={onToggleSidebar}
              className="shrink-0"
            >
              <PanelLeft size={16} />
            </IconButton>
          )}
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-ink-800 text-accent-300">
            {activeConv.channelType === "announcement" ? (
              <Megaphone size={15} />
            ) : (
              <Hash size={15} />
            )}
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold leading-5 tracking-tight">
              {name}
            </h3>
            {description && (
              <p className="truncate text-xs text-mist-600">{description}</p>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <span className="mr-1 flex items-center gap-1.5 text-xs text-mist-600">
              <Users size={13} /> {memberCount}
            </span>
            {activeConv.organizationId && (
              <IconButton
                label="Shared files"
                onClick={() => {
                  setShowFiles((v) => !v);
                  setShowPins(false);
                }}
                className={showFiles ? "bg-ink-600 text-accent-300" : ""}
              >
                <Folder size={15} />
              </IconButton>
            )}
            <IconButton
              label="Pinned messages"
              onClick={() => {
                setShowPins((v) => !v);
                setShowFiles(false);
              }}
              className={showPins ? "bg-ink-600 text-warn" : ""}
            >
              <Pin size={15} />
            </IconButton>
          </div>
        </div>

        {/* pinned banner — click jumps to the message */}
        {pins.length > 0 && (
          <button
            onClick={() => {
              const pin = pins[pinIdx % pins.length];
              scrollToMessage(pin._id);
              setPinIdx((pinIdx + 1) % pins.length);
            }}
            className="flex shrink-0 items-center gap-2.5 border-b border-line bg-ink-850 px-5 py-2 text-left transition-colors hover:bg-ink-800"
          >
            <Pin size={13} className="shrink-0 text-warn" />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-mist-400">
              <strong className="font-semibold text-mist-200">
                {pins[pinIdx % pins.length].sender?.username}:
              </strong>{" "}
              {pins[pinIdx % pins.length].content}
            </span>
            {locating ? (
              <Spinner size={12} />
            ) : (
              pins.length > 1 && (
                <span className="shrink-0 text-[10.5px] text-mist-600">
                  {(pinIdx % pins.length) + 1}/{pins.length}
                </span>
              )
            )}
            <span className="shrink-0 text-[10.5px] font-semibold text-accent-300">
              Jump ↑
            </span>
          </button>
        )}

        {/* messages */}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex-1 overflow-y-auto pb-3"
        >
          {messages?.loading ? (
            <div className="flex h-full items-center justify-center">
              <Spinner size={20} />
            </div>
          ) : (
            <>
              {messages && messages.page < messages.totalPages && (
                <div className="flex justify-center pt-4">
                  <Button variant="subtle" className="h-7 px-3 text-xs" onClick={loadOlder}>
                    Load earlier messages
                  </Button>
                </div>
              )}
              {items.length === 0 && (
                <div className="px-5 pt-10">
                  <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-ink-800 text-accent-300">
                    <Hash size={22} />
                  </span>
                  <h4 className="text-lg font-semibold">Welcome to #{name}</h4>
                  <p className="mt-1 max-w-sm text-sm text-mist-500">
                    {description || "This is the very beginning of the channel."}{" "}
                    Say hello 👋
                  </p>
                </div>
              )}
              {items.map((msg, i) => {
                const prev = items[i - 1];
                const newDay =
                  !prev ||
                  dayLabel(prev.createdAt) !== dayLabel(msg.createdAt);
                const compact =
                  !newDay &&
                  prev &&
                  prev.messageType !== "system" &&
                  msg.messageType !== "system" &&
                  prev.sender?._id === msg.sender?._id &&
                  new Date(msg.createdAt).getTime() -
                    new Date(prev.createdAt).getTime() <
                    5 * 60 * 1000;
                return (
                  <Fragment key={msg._id}>
                    {newDay && (
                      <div className="relative my-4 flex items-center px-5">
                        <span className="h-px flex-1 bg-line" />
                        <span className="mx-3 rounded-full border border-line bg-ink-800 px-2.5 py-0.5 text-[11px] font-medium text-mist-500">
                          {dayLabel(msg.createdAt)}
                        </span>
                        <span className="h-px flex-1 bg-line" />
                      </div>
                    )}
                    <MessageRow
                      msg={msg}
                      compact={!!compact}
                      canModerate={canModerate}
                      canPin={canPin}
                      meId={meId}
                      flash={flashId === msg._id}
                    />
                  </Fragment>
                );
              })}
            </>
          )}
        </div>

        {/* composer / lock */}
        {announcementLocked ? (
          <div className="px-5 pb-5 pt-2">
            <div className="flex items-center gap-2.5 rounded-xl border border-line bg-ink-800 px-4 py-3 text-sm text-mist-500">
              <Lock size={15} className="shrink-0 text-warn" />
              Only managers and admins can post in announcement channels.
            </div>
          </div>
        ) : (
          <Composer />
        )}
      </div>

      {showPins && <PinsDrawer onClose={() => setShowPins(false)} />}
      {showFiles && <FilesDrawer onClose={() => setShowFiles(false)} />}
    </div>
  );
}
