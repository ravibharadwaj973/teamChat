"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { del, get } from "@/lib/api";
import type { Membership, Organization, User } from "@/lib/types";
import { ROLE_LABEL, ROLE_TONE, prettyIndustry } from "@/lib/format";
import {
  Avatar,
  Badge,
  Button,
  FullPageLoader,
  Input,
  Modal,
  Spinner,
  cx,
  useToast,
} from "@/components/ui";
import {
  ArrowLeft,
  Building,
  Chevron,
  Crown,
  Hash,
  Lock,
  Search,
  Shield,
  Trash,
  Users,
  X,
} from "@/components/icons";

interface AdminOrg extends Omit<Organization, "owner"> {
  owner: User;
  memberCount: number;
  createdAt?: string;
}

interface Stats {
  users: number;
  organizations: number;
  teams: number;
  messages: number;
  departments: number;
  channels: number;
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | undefined;
}) {
  return (
    <div className="rounded-xl border border-line bg-ink-850 p-4">
      <div className="flex items-center gap-2 text-mist-600">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight">
        {value === undefined ? "—" : value.toLocaleString()}
      </p>
    </div>
  );
}

function OrgRow({
  org,
  onDeleted,
}: {
  org: AdminOrg;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<Membership[] | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  const loadMembers = useCallback(() => {
    get<{ data: { members: Membership[] } }>(
      `/admin/organizations/${org._id}/members`
    )
      .then((res) => setMembers(res.data.members))
      .catch(() => setMembers([]));
  }, [org._id]);

  // Refetch every time the row is expanded (admin data should be fresh)
  useEffect(() => {
    if (open) {
      setMembers(null);
      loadMembers();
    }
  }, [open, loadMembers]);

  const removeMember = async (userId: string, name: string) => {
    try {
      await del(`/admin/organizations/${org._id}/members/${userId}`);
      toast(`${name} removed from ${org.name}`);
      loadMembers();
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  const deleteOrg = async () => {
    setBusy(true);
    try {
      await del(`/admin/organizations/${org._id}`);
      toast(`"${org.name}" deleted`);
      setConfirmOpen(false);
      onDeleted();
    } catch (err: any) {
      toast(err.message, "error");
      setBusy(false);
    }
  };

  const asUser = (u: any): User | null => (u && typeof u === "object" ? u : null);

  return (
    <div className="rounded-xl border border-line bg-ink-850">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <Chevron size={13} open={open} className="shrink-0 text-mist-600" />
          <Avatar name={org.name} src={org.logo} square size={34} />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold leading-5">
              {org.name}
            </p>
            <p className="truncate text-xs text-mist-600">
              /{org.slug}
              {org.industry ? ` · ${prettyIndustry(org.industry)}` : ""}
            </p>
          </div>
        </button>
        <div className="hidden items-center gap-2 text-xs text-mist-500 sm:flex">
          <Crown size={12} className="text-warn" />
          {org.owner?.username || "—"}
        </div>
        <Badge>
          <Users size={11} /> {org.memberCount}
        </Badge>
        <Button
          variant="danger"
          className="h-8 px-2.5 text-xs"
          onClick={() => {
            setConfirmText("");
            setConfirmOpen(true);
          }}
        >
          <Trash size={13} /> Delete
        </Button>
      </div>

      {open && (
        <div className="border-t border-line px-4 py-3">
          {members === null ? (
            <div className="flex justify-center py-4">
              <Spinner />
            </div>
          ) : members.length === 0 ? (
            <p className="py-2 text-sm text-mist-600">No members.</p>
          ) : (
            <div className="space-y-1">
              {members.map((m) => {
                const u = asUser(m.user);
                if (!u) return null;
                return (
                  <div
                    key={m._id}
                    className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-ink-800"
                  >
                    <Avatar name={u.username} src={u.avatar} size={26} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium leading-4">
                        {u.username}
                      </p>
                      <p className="truncate text-[11px] text-mist-600">{u.email}</p>
                    </div>
                    <Badge className={ROLE_TONE[m.role]}>{ROLE_LABEL[m.role]}</Badge>
                    {m.role !== "owner" ? (
                      <button
                        title="Remove from organization"
                        className="text-mist-600 transition-colors hover:text-danger"
                        onClick={() => removeMember(u._id, u.username)}
                      >
                        <X size={14} />
                      </button>
                    ) : (
                      <span className="w-[14px]" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Delete organization"
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-danger/25 bg-danger/10 px-3.5 py-3 text-[13px] leading-relaxed text-danger">
            This permanently deletes <strong>{org.name}</strong> — every channel,
            message, team, department, membership and invite. This cannot be
            undone.
          </div>
          <div>
            <p className="mb-1.5 text-[13px] text-mist-300">
              Type <code className="rounded bg-ink-700 px-1.5 py-0.5 text-danger">{org.name}</code>{" "}
              to confirm:
            </p>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={org.name}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={confirmText !== org.name}
              loading={busy}
              onClick={deleteOrg}
            >
              Delete permanently
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default function AdminPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const toast = useToast();

  const [stats, setStats] = useState<Stats | null>(null);
  const [orgs, setOrgs] = useState<AdminOrg[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  const loadStats = useCallback(() => {
    get<{ data: Stats }>("/admin/stats")
      .then((res) => setStats(res.data))
      .catch(() => {});
  }, []);

  const loadOrgs = useCallback(
    (p = 1, q = "") => {
      setOrgs(null);
      get<{ data: AdminOrg[]; total: number; page: number; totalPages: number }>(
        `/admin/organizations?page=${p}&search=${encodeURIComponent(q)}`
      )
        .then((res) => {
          setOrgs(res.data);
          setTotal(res.total);
          setPage(res.page);
          setTotalPages(res.totalPages);
        })
        .catch((err) => {
          toast(err.message, "error");
          setOrgs([]);
        });
    },
    [toast]
  );

  useEffect(() => {
    if (!loading && user?.isSuperAdmin) {
      loadStats();
      loadOrgs(1, "");
    }
  }, [loading, user?.isSuperAdmin, loadStats, loadOrgs]);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => {
      if (query !== search) {
        setSearch(query);
        loadOrgs(1, query);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query, search, loadOrgs]);

  if (loading) return <FullPageLoader />;

  if (!user || !user.isSuperAdmin) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-ink-950 px-6 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-ink-800 text-danger">
          <Lock size={22} />
        </span>
        <h1 className="text-lg font-semibold">Restricted area</h1>
        <p className="max-w-[320px] text-sm text-mist-500">
          The platform console is only available to TeamSpace super admins.
        </p>
        <Button className="mt-2" onClick={() => router.push("/app")}>
          Back to workspace
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-950">
      {/* Top bar */}
      <div className="sticky top-0 z-10 border-b border-line bg-ink-900/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-danger/80 to-accent-600 text-white">
            <Shield size={16} />
          </span>
          <div>
            <h1 className="text-[15px] font-semibold leading-5 tracking-tight">
              Platform administration
            </h1>
            <p className="text-[11px] text-mist-600">
              Signed in as {user.username} · super admin
            </p>
          </div>
          <button
            onClick={() => router.push("/app")}
            className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] text-mist-400 transition-colors hover:bg-ink-700 hover:text-mist-100"
          >
            <ArrowLeft size={14} /> Back to workspace
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-5 py-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard icon={<Building size={14} />} label="Organizations" value={stats?.organizations} />
          <StatCard icon={<Users size={14} />} label="Users" value={stats?.users} />
          <StatCard icon={<Users size={14} />} label="Teams" value={stats?.teams} />
          <StatCard icon={<Hash size={14} />} label="Messages" value={stats?.messages} />
        </div>

        {/* Org list */}
        <div className="mt-8">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-[15px] font-semibold tracking-tight">
              Organizations{" "}
              <span className="text-sm font-normal text-mist-600">({total})</span>
            </h2>
            <div className="relative w-64">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist-600"
              />
              <Input
                className="pl-8"
                placeholder="Search organizations…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          {orgs === null ? (
            <div className="flex justify-center py-16">
              <Spinner size={20} />
            </div>
          ) : orgs.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-mist-600">
              No organizations{search ? ` matching “${search}”` : " yet"}.
            </p>
          ) : (
            <div className="space-y-2">
              {orgs.map((org) => (
                <OrgRow
                  key={org._id}
                  org={org}
                  onDeleted={() => {
                    loadOrgs(page, search);
                    loadStats();
                  }}
                />
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-3 text-sm">
              <Button
                variant="subtle"
                className="h-8 px-3 text-xs"
                disabled={page <= 1}
                onClick={() => loadOrgs(page - 1, search)}
              >
                Previous
              </Button>
              <span className="text-mist-500">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="subtle"
                className="h-8 px-3 text-xs"
                disabled={page >= totalPages}
                onClick={() => loadOrgs(page + 1, search)}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
