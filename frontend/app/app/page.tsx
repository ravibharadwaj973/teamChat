"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { FullPageLoader } from "@/components/ui";
import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/WorkspaceContext";
import Sidebar from "@/components/workspace/Sidebar";
import ChatView from "@/components/workspace/ChatView";
import {
  CreateChannelModal,
  DirectoryModal,
  InviteModal,
  MembersModal,
} from "@/components/workspace/Modals";
import AnnouncementsModal from "@/components/workspace/Announcements";
import TasksModal from "@/components/workspace/Tasks";
import NotificationsModal from "@/components/workspace/Notifications";
import CalendarModal from "@/components/workspace/CalendarModal";
import PeopleModal from "@/components/workspace/People";
import OrgDashboardModal from "@/components/workspace/OrgDashboard";
import AuditLogModal from "@/components/workspace/AuditLog";
import AssistantModal from "@/components/workspace/Assistant";

function WorkspaceShell() {
  const { ready, orgs } = useWorkspace();
  const router = useRouter();
  const [showDirectory, setShowDirectory] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showAnnouncements, setShowAnnouncements] = useState(false);
  const [showTasks, setShowTasks] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showPeople, setShowPeople] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [showAssistant, setShowAssistant] = useState(false);
  const [channelTeamId, setChannelTeamId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Restore preference; default collapsed on narrow screens
  useEffect(() => {
    const saved = localStorage.getItem("ts.sidebarOpen");
    if (saved !== null) setSidebarOpen(saved === "1");
    else if (window.innerWidth < 900) setSidebarOpen(false);
  }, []);

  const toggleSidebar = () =>
    setSidebarOpen((v) => {
      localStorage.setItem("ts.sidebarOpen", v ? "0" : "1");
      return !v;
    });

  useEffect(() => {
    if (ready && orgs.length === 0) router.replace("/onboarding");
  }, [ready, orgs.length, router]);

  if (!ready) return <FullPageLoader label="Opening your workspace…" />;

  return (
    <div className="flex h-screen overflow-hidden bg-ink-950 text-mist-100">
      <Sidebar
        open={sidebarOpen}
        onOpenDirectory={() => setShowDirectory(true)}
        onOpenInvite={() => setShowInvite(true)}
        onOpenMembers={() => setShowMembers(true)}
        onOpenAnnouncements={() => setShowAnnouncements(true)}
        onOpenTasks={() => setShowTasks(true)}
        onOpenNotifications={() => setShowNotifications(true)}
        onOpenCalendar={() => setShowCalendar(true)}
        onOpenPeople={() => setShowPeople(true)}
        onOpenDashboard={() => setShowDashboard(true)}
        onOpenAssistant={() => setShowAssistant(true)}
        onCreateChannel={(teamId) => setChannelTeamId(teamId)}
      />
      <ChatView
        onOpenAnnouncements={() => setShowAnnouncements(true)}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
      />

      <DirectoryModal open={showDirectory} onClose={() => setShowDirectory(false)} />
      <InviteModal open={showInvite} onClose={() => setShowInvite(false)} />
      <MembersModal open={showMembers} onClose={() => setShowMembers(false)} />
      <AnnouncementsModal
        open={showAnnouncements}
        onClose={() => setShowAnnouncements(false)}
      />
      <TasksModal open={showTasks} onClose={() => setShowTasks(false)} />
      <NotificationsModal
        open={showNotifications}
        onClose={() => setShowNotifications(false)}
        onOpenAnnouncements={() => setShowAnnouncements(true)}
        onOpenTasks={() => setShowTasks(true)}
      />
      <CalendarModal open={showCalendar} onClose={() => setShowCalendar(false)} />
      <PeopleModal open={showPeople} onClose={() => setShowPeople(false)} />
      <OrgDashboardModal
        open={showDashboard}
        onClose={() => setShowDashboard(false)}
        onOpenInvite={() => setShowInvite(true)}
        onOpenAudit={() => setShowAudit(true)}
      />
      <AuditLogModal open={showAudit} onClose={() => setShowAudit(false)} />
      <AssistantModal
        open={showAssistant}
        onClose={() => setShowAssistant(false)}
      />
      <CreateChannelModal
        teamId={channelTeamId}
        onClose={() => setChannelTeamId(null)}
      />
    </div>
  );
}

export default function AppPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) return <FullPageLoader label="Signing you in…" />;

  return (
    <WorkspaceProvider me={{ ...user, _id: (user as any)._id || (user as any).id }}>
      <WorkspaceShell />
    </WorkspaceProvider>
  );
}
