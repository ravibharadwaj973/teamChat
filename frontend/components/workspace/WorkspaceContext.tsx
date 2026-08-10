"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { get, post } from "@/lib/api";
import { connectSocket, getSocket } from "@/lib/socket";
import { useAuth } from "@/lib/auth";
import type {
  Announcement,
  Conversation,
  Membership,
  Message,
  MyOrg,
  OrgRole,
  Structure,
  Task,
  User,
} from "@/lib/types";

interface MessagesPage {
  items: Message[];
  page: number;
  totalPages: number;
  loading: boolean;
}

interface WorkspaceState {
  me: User;
  orgs: MyOrg[];
  activeOrgId: string | null;
  myRole: OrgRole | null;
  structure: Structure | null;
  conversations: Conversation[];
  members: Membership[];
  activeConvId: string | null;
  activeConv: Conversation | null;
  messages: MessagesPage | null;
  announcements: Announcement[];
  annCanPost: boolean;
  unackedCount: number;
  refetchAnnouncements: () => Promise<void>;
  myTasks: Task[];
  taskCanAssign: boolean;
  openTaskCount: number;
  refetchTasks: () => Promise<void>;
  notifUnread: number;
  refetchNotifCount: () => Promise<void>;
  ready: boolean;
  selectOrg: (orgId: string) => void;
  selectConversation: (convId: string | null) => void;
  loadOlder: () => Promise<boolean>;
  sendMessage: (content: string) => Promise<void>;
  refetchOrg: () => Promise<void>;
  refetchOrgs: () => Promise<MyOrg[]>;
  updateMessage: (convId: string, msg: Message) => void;
  removeMessagePin: (messageId: string, pinned: boolean) => void;
  markDeleted: (messageId: string) => void;
}

const Ctx = createContext<WorkspaceState | null>(null);
export const useWorkspace = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace outside provider");
  return ctx;
};

export function WorkspaceProvider({
  me,
  children,
}: {
  me: User;
  children: ReactNode;
}) {
  const { user } = useAuth();
  const myId = (user?._id || (user as any)?.id || "").toString();

  const [orgs, setOrgs] = useState<MyOrg[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [structure, setStructure] = useState<Structure | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessagesPage | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [annCanPost, setAnnCanPost] = useState(false);
  const [myTasks, setMyTasks] = useState<Task[]>([]);
  const [taskCanAssign, setTaskCanAssign] = useState(false);
  const [notifUnread, setNotifUnread] = useState(0);
  const [ready, setReady] = useState(false);

  const activeConvRef = useRef<string | null>(null);
  activeConvRef.current = activeConvId;
  const orgRef = useRef<string | null>(null);
  orgRef.current = activeOrgId;

  /* ---------- data loading ---------- */

  const refetchOrgs = useCallback(async () => {
    const res = await get<{ data: MyOrg[] }>("/organizations");
    setOrgs(res.data);
    return res.data;
  }, []);

  const loadOrgData = useCallback(async (orgId: string) => {
    const [structureRes, convRes, membersRes, annRes, taskRes] = await Promise.all([
      get<{ data: Structure }>(`/organizations/${orgId}/structure`),
      get<{ data: Conversation[] }>(`/conversations?organizationId=${orgId}`),
      get<{ data: Membership[] }>(`/organizations/${orgId}/members`),
      get<{ data: Announcement[]; canPost: boolean }>(
        `/organizations/${orgId}/announcements`
      ),
      get<{ data: Task[]; canAssign: boolean }>(
        `/organizations/${orgId}/tasks?scope=my`
      ),
    ]);
    // Ignore stale responses after an org switch
    if (orgRef.current !== orgId) return;
    setStructure(structureRes.data);
    setConversations(convRes.data);
    setMembers(membersRes.data);
    setAnnouncements(annRes.data);
    setAnnCanPost(annRes.canPost);
    setMyTasks(taskRes.data);
    setTaskCanAssign(taskRes.canAssign);

    const socket = getSocket();
    if (socket.connected) {
      socket.emit(
        "join-conversations",
        convRes.data.map((c) => c._id)
      );
    }
  }, []);

  const refetchOrg = useCallback(async () => {
    if (orgRef.current) await loadOrgData(orgRef.current);
  }, [loadOrgData]);

  const refetchAnnouncements = useCallback(async () => {
    const orgId = orgRef.current;
    if (!orgId) return;
    const res = await get<{ data: Announcement[]; canPost: boolean }>(
      `/organizations/${orgId}/announcements`
    );
    if (orgRef.current !== orgId) return;
    setAnnouncements(res.data);
    setAnnCanPost(res.canPost);
  }, []);

  const refetchTasks = useCallback(async () => {
    const orgId = orgRef.current;
    if (!orgId) return;
    const res = await get<{ data: Task[]; canAssign: boolean }>(
      `/organizations/${orgId}/tasks?scope=my`
    );
    if (orgRef.current !== orgId) return;
    setMyTasks(res.data);
    setTaskCanAssign(res.canAssign);
  }, []);

  // Notifications are global (not org-scoped)
  const refetchNotifCount = useCallback(async () => {
    try {
      const res = await get<{ data: { total: number } }>(
        "/notifications/unread-count"
      );
      setNotifUnread(res.data.total || 0);
    } catch {
      /* endpoint unavailable — keep last value */
    }
  }, []);

  useEffect(() => {
    refetchNotifCount();
  }, [refetchNotifCount]);

  /* ---------- boot ---------- */

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await refetchOrgs();
      if (cancelled) return;
      const saved = localStorage.getItem("ts.activeOrg");
      const first =
        list.find((o) => o.organization._id === saved)?.organization._id ||
        list[0]?.organization._id ||
        null;
      setActiveOrgId(first);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [refetchOrgs]);

  // Load org data + reset selection when the org changes
  useEffect(() => {
    if (!activeOrgId) return;
    localStorage.setItem("ts.activeOrg", activeOrgId);
    setStructure(null);
    setConversations([]);
    setMembers([]);
    setAnnouncements([]);
    setMyTasks([]);
    setActiveConvId(null);
    setMessages(null);
    loadOrgData(activeOrgId);
  }, [activeOrgId, loadOrgData]);

  // Auto-select #general once conversations arrive
  useEffect(() => {
    if (activeConvId || conversations.length === 0) return;
    const general =
      conversations.find((c) => c.channelType === "general") || conversations[0];
    if (general) selectConversation(general._id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations]);

  /* ---------- messages ---------- */

  const loadMessages = useCallback(async (convId: string) => {
    setMessages({ items: [], page: 1, totalPages: 1, loading: true });
    const res = await get<{
      data: Message[];
      page: number;
      totalPages: number;
    }>(`/messages/${convId}?limit=40&page=1`);
    if (activeConvRef.current !== convId) return;
    setMessages({
      items: res.data,
      page: res.page,
      totalPages: res.totalPages,
      loading: false,
    });
  }, []);

  const selectConversation = useCallback(
    (convId: string | null) => {
      setActiveConvId(convId);
      if (!convId) {
        setMessages(null);
        return;
      }
      loadMessages(convId);
      getSocket().emit("join-conversation", convId);
      // Zero my unread badge optimistically, then persist
      setConversations((prev) =>
        prev.map((c) => (c._id === convId ? { ...c, unreadCount: 0 } : c))
      );
      post(`/messages/${convId}/read`).catch(() => {});
    },
    [loadMessages]
  );

  // Returns true when an older page was actually loaded
  const loadOlder = useCallback(async (): Promise<boolean> => {
    const convId = activeConvRef.current;
    if (!convId || !messages || messages.page >= messages.totalPages) return false;
    const nextPage = messages.page + 1;
    const res = await get<{
      data: Message[];
      page: number;
      totalPages: number;
    }>(`/messages/${convId}?limit=40&page=${nextPage}`);
    if (activeConvRef.current !== convId) return false;
    setMessages((prev) =>
      prev
        ? {
            ...prev,
            items: [...res.data, ...prev.items],
            page: res.page,
            totalPages: res.totalPages,
          }
        : prev
    );
    return res.data.length > 0;
  }, [messages]);

  const appendMessage = useCallback(
    (convId: string, msg: Message) => {
      setMessages((prev) => {
        if (activeConvRef.current !== convId || !prev) return prev;
        if (prev.items.some((m) => m._id === msg._id)) return prev;
        return { ...prev, items: [...prev.items, msg] };
      });
      setConversations((prev) =>
        prev.map((c) =>
          c._id === convId
            ? {
                ...c,
                lastMessage: msg,
                unreadCount:
                  convId === activeConvRef.current ||
                  msg.sender?._id === myId
                    ? c.unreadCount || 0
                    : (c.unreadCount || 0) + 1,
              }
            : c
        )
      );
    },
    [myId]
  );

  const sendMessage = useCallback(
    async (content: string) => {
      const convId = activeConvRef.current;
      if (!convId) return;
      const res = await post<{ data: Message }>("/messages/send", {
        conversationId: convId,
        content,
      });
      appendMessage(convId, res.data);
    },
    [appendMessage]
  );

  const updateMessage = useCallback((convId: string, msg: Message) => {
    setMessages((prev) => {
      if (!prev || activeConvRef.current !== convId) return prev;
      return {
        ...prev,
        items: prev.items.map((m) => (m._id === msg._id ? { ...m, ...msg } : m)),
      };
    });
  }, []);

  const removeMessagePin = useCallback((messageId: string, pinned: boolean) => {
    setMessages((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((m) =>
              m._id === messageId ? { ...m, pinned } : m
            ),
          }
        : prev
    );
  }, []);

  const markDeleted = useCallback((messageId: string) => {
    setMessages((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((m) =>
              m._id === messageId
                ? {
                    ...m,
                    deleted: true,
                    pinned: false,
                    content: "This message was deleted",
                  }
                : m
            ),
          }
        : prev
    );
  }, []);

  /* ---------- socket wiring ---------- */

  useEffect(() => {
    const socket = connectSocket();

    const onConnect = () => {
      setConversations((prev) => {
        if (prev.length)
          socket.emit(
            "join-conversations",
            prev.map((c) => c._id)
          );
        return prev;
      });
    };

    const onNewMessage = (payload: any) => {
      // Tolerate both payload shapes: { message, conversationId } or a bare message
      const msg: Message | null = payload?.message || (payload?._id ? payload : null);
      if (!msg) return;
      const convId = (payload?.conversationId || msg.conversationId)?.toString();
      if (!convId) return;

      appendMessage(convId, msg);
      // Reading happens implicitly when the channel is open
      if (convId === activeConvRef.current && msg.sender?._id !== myId) {
        post(`/messages/${convId}/read`).catch(() => {});
      }
    };

    const onEdited = (payload: { message: Message; conversationId: string }) => {
      if (payload?.message)
        updateMessage(payload.conversationId.toString(), payload.message);
    };

    const onDeleted = (payload: { messageId: string }) => {
      if (payload?.messageId) markDeleted(payload.messageId.toString());
    };

    const onPinned = (p: { messageId: string }) =>
      p?.messageId && removeMessagePin(p.messageId.toString(), true);
    const onUnpinned = (p: { messageId: string }) =>
      p?.messageId && removeMessagePin(p.messageId.toString(), false);

    const onStructureChange = () => {
      if (orgRef.current) loadOrgData(orgRef.current);
    };

    const structureEvents = [
      "org:updated",
      "org:member-joined",
      "org:member-left",
      "org:member-removed",
      "org:member-role-changed",
      "org:member-profile-updated",
      "org:ownership-transferred",
      "department:created",
      "department:updated",
      "department:deleted",
      "team:created",
      "team:updated",
      "team:deleted",
      "team:member-added",
      "team:member-removed",
      "team:manager-changed",
      "channel:created",
      "channel:updated",
      "channel:deleted",
    ];

    const onAnnouncementChange = () => {
      refetchAnnouncements().catch(() => {});
    };

    const onTaskChange = () => {
      refetchTasks().catch(() => {});
      refetchNotifCount().catch(() => {});
    };

    const onNotifBump = () => {
      refetchNotifCount().catch(() => {});
    };

    socket.on("connect", onConnect);
    socket.on("new-message", onNewMessage);
    socket.on("message-edited", onEdited);
    socket.on("message-deleted-for-everyone", onDeleted);
    socket.on("message-pinned", onPinned);
    socket.on("message-unpinned", onUnpinned);
    socket.on("announcement:new", onAnnouncementChange);
    socket.on("announcement:acked", onAnnouncementChange);
    socket.on("announcement:deleted", onAnnouncementChange);
    socket.on("task:created", onTaskChange);
    socket.on("task:updated", onTaskChange);
    socket.on("task:deleted", onTaskChange);
    socket.on("message-mention", onNotifBump);
    socket.on("announcement:new", onNotifBump);
    socket.on("org:invite-received", onNotifBump);
    structureEvents.forEach((ev) => socket.on(ev, onStructureChange));

    return () => {
      socket.off("connect", onConnect);
      socket.off("new-message", onNewMessage);
      socket.off("message-edited", onEdited);
      socket.off("message-deleted-for-everyone", onDeleted);
      socket.off("message-pinned", onPinned);
      socket.off("message-unpinned", onUnpinned);
      socket.off("announcement:new", onAnnouncementChange);
      socket.off("announcement:acked", onAnnouncementChange);
      socket.off("announcement:deleted", onAnnouncementChange);
      socket.off("task:created", onTaskChange);
      socket.off("task:updated", onTaskChange);
      socket.off("task:deleted", onTaskChange);
      socket.off("message-mention", onNotifBump);
      socket.off("announcement:new", onNotifBump);
      socket.off("org:invite-received", onNotifBump);
      structureEvents.forEach((ev) => socket.off(ev, onStructureChange));
    };
  }, [appendMessage, updateMessage, markDeleted, removeMessagePin, loadOrgData, refetchAnnouncements, refetchTasks, refetchNotifCount, myId]);

  /* ---------- derived ---------- */

  const myRole = useMemo(
    () =>
      orgs.find((o) => o.organization._id === activeOrgId)?.role || null,
    [orgs, activeOrgId]
  );

  const activeConv = useMemo(
    () => conversations.find((c) => c._id === activeConvId) || null,
    [conversations, activeConvId]
  );

  const unackedCount = useMemo(
    () =>
      announcements.filter((a) => !a.acked && a.createdBy?._id !== myId).length,
    [announcements, myId]
  );

  const openTaskCount = useMemo(
    () => myTasks.filter((t) => t.status !== "done").length,
    [myTasks]
  );

  const value: WorkspaceState = {
    me,
    orgs,
    activeOrgId,
    myRole,
    structure,
    conversations,
    members,
    activeConvId,
    activeConv,
    messages,
    announcements,
    annCanPost,
    unackedCount,
    refetchAnnouncements,
    myTasks,
    taskCanAssign,
    openTaskCount,
    refetchTasks,
    notifUnread,
    refetchNotifCount,
    ready,
    selectOrg: setActiveOrgId,
    selectConversation,
    loadOlder,
    sendMessage,
    refetchOrg,
    refetchOrgs,
    updateMessage,
    removeMessagePin,
    markDeleted,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
