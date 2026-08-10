"use client";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { del, get, patch, post, put } from "@/lib/api";
import type { Department, Membership, OrgInvite, Team, User } from "@/lib/types";
import { ROLE_LABEL, ROLE_TONE } from "@/lib/format";
import {
  Avatar,
  Badge,
  Button,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  cx,
  useToast,
} from "@/components/ui";
import {
  Check,
  Chevron,
  Copy,
  Crown,
  Folder,
  Hash,
  Megaphone,
  Plus,
  Trash,
  Users,
  X,
} from "@/components/icons";

const asUser = (u: User | string | null | undefined): User | null =>
  u && typeof u === "object" ? u : null;

/* ================= Invite people ================= */

export function InviteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { activeOrgId, myRole } = useWorkspace();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("employee");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ url: string; emailSent: boolean } | null>(null);
  const [pending, setPending] = useState<OrgInvite[] | null>(null);
  const [copied, setCopied] = useState(false);

  const loadPending = () => {
    if (!activeOrgId) return;
    get<{ data: OrgInvite[] }>(`/organizations/${activeOrgId}/invites`)
      .then((res) => setPending(res.data))
      .catch(() => setPending([]));
  };

  useEffect(() => {
    if (open) {
      setResult(null);
      setEmail("");
      setNote("");
      loadPending();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeOrgId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await post<{
        data: { inviteUrl: string; emailSent: boolean };
      }>(`/organizations/${activeOrgId}/invites`, {
        email: email.trim(),
        role,
        message: note,
      });
      setResult({ url: res.data.inviteUrl, emailSent: res.data.emailSent });
      toast(
        res.data.emailSent
          ? "Invitation email sent"
          : "Invite created — share the link"
      );
      loadPending();
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Invite people" width={480}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-[1fr_130px] gap-3">
          <Field label="Email">
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.com"
              autoFocus
            />
          </Field>
          <Field label="Role">
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="employee">Employee</option>
              <option value="manager">Manager</option>
              {myRole === "owner" && <option value="admin">Admin</option>}
            </Select>
          </Field>
        </div>
        <Field label="Personal note" hint="Optional — shown on the invite">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="Come join our workspace!"
          />
        </Field>
        <Button type="submit" loading={busy} className="w-full">
          Send invitation
        </Button>
      </form>

      {result && (
        <div className="mt-4 rounded-lg border border-ok/25 bg-ok/10 p-3">
          <p className="text-[13px] font-medium text-ok">
            {result.emailSent
              ? "Email sent — they can also use this link:"
              : "Share this invite link:"}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-ink-900 px-2.5 py-1.5 text-xs text-mist-300">
              {result.url}
            </code>
            <Button
              variant="subtle"
              className="h-8 px-2.5"
              onClick={() => {
                navigator.clipboard.writeText(result.url);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
            </Button>
          </div>
        </div>
      )}

      <div className="mt-5">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-mist-600">
          Pending invites
        </p>
        {pending === null ? (
          <Spinner />
        ) : pending.length === 0 ? (
          <p className="text-[13px] text-mist-600">No pending invites.</p>
        ) : (
          <div className="space-y-1.5">
            {pending.map((inv) => (
              <div
                key={inv._id}
                className="flex items-center gap-2.5 rounded-lg border border-line bg-ink-800 px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-[13px]">{inv.email}</span>
                <Badge className={ROLE_TONE[inv.role]}>{ROLE_LABEL[inv.role]}</Badge>
                <button
                  title="Revoke"
                  className="text-mist-600 hover:text-danger"
                  onClick={async () => {
                    try {
                      await del(`/organizations/${activeOrgId}/invites/${inv._id}`);
                      setPending((p) => (p ? p.filter((x) => x._id !== inv._id) : p));
                      toast("Invite revoked");
                    } catch (err: any) {
                      toast(err.message, "error");
                    }
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ================= Members ================= */

export function MembersModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { activeOrgId, members, myRole, me, refetchOrg } = useWorkspace();
  const toast = useToast();
  const canManage = myRole === "owner" || myRole === "admin";

  const changeRole = async (userId: string, role: string) => {
    try {
      await patch(`/organizations/${activeOrgId}/members/${userId}/role`, { role });
      toast("Role updated");
      refetchOrg();
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  const removeMember = async (userId: string, name: string) => {
    if (!confirm(`Remove ${name} from the organization?`)) return;
    try {
      await del(`/organizations/${activeOrgId}/members/${userId}`);
      toast(`${name} removed`);
      refetchOrg();
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Members · ${members.length}`} width={520}>
      <div className="max-h-[55vh] space-y-1 overflow-y-auto pr-1">
        {members.map((m: Membership) => {
          const u = asUser(m.user);
          if (!u) return null;
          const isMe = u._id === me._id;
          return (
            <div
              key={m._id}
              className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-ink-800"
            >
              <Avatar name={u.username} src={u.avatar} size={32} online={u.online} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-[13.5px] font-medium">
                  {u.username}
                  {m.role === "owner" && <Crown size={12} className="text-warn" />}
                  {isMe && <span className="text-[11px] text-mist-600">(you)</span>}
                </p>
                <p className="truncate text-xs text-mist-600">{u.email}</p>
              </div>
              {canManage && m.role !== "owner" && !isMe ? (
                <>
                  <Select
                    className="w-[110px] py-1 text-xs"
                    value={m.role}
                    onChange={(e) => changeRole(u._id, e.target.value)}
                  >
                    {myRole === "owner" && <option value="admin">Admin</option>}
                    {m.role === "admin" && myRole !== "owner" && (
                      <option value="admin">Admin</option>
                    )}
                    <option value="manager">Manager</option>
                    <option value="employee">Employee</option>
                  </Select>
                  <button
                    title="Remove from org"
                    className="text-mist-600 hover:text-danger"
                    onClick={() => removeMember(u._id, u.username)}
                  >
                    <Trash size={14} />
                  </button>
                </>
              ) : (
                <Badge className={ROLE_TONE[m.role]}>{ROLE_LABEL[m.role]}</Badge>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/* ================= Create channel ================= */

export function CreateChannelModal({
  teamId,
  onClose,
}: {
  teamId: string | null;
  onClose: () => void;
}) {
  const { activeOrgId, refetchOrg, structure } = useWorkspace();
  const toast = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState("text");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const teamName = useMemo(() => {
    const all = [
      ...(structure?.departments.flatMap((d) => d.teams) || []),
      ...(structure?.unassignedTeams || []),
    ];
    return all.find((t) => t._id === teamId)?.name || "team";
  }, [structure, teamId]);

  useEffect(() => {
    if (teamId) {
      setName("");
      setType("text");
      setDescription("");
    }
  }, [teamId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await post(`/organizations/${activeOrgId}/teams/${teamId}/channels`, {
        name: name.trim(),
        type,
        description,
      });
      toast(`#${name.trim()} created`);
      await refetchOrg();
      onClose();
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!teamId} onClose={onClose} title={`New channel in ${teamName}`}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Channel name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="standup"
            minLength={2}
            maxLength={60}
            required
            autoFocus
          />
        </Field>
        <Field label="Type">
          <div className="grid grid-cols-2 gap-2">
            {[
              { v: "text", icon: <Hash size={14} />, label: "Text", hint: "Everyone posts" },
              {
                v: "announcement",
                icon: <Megaphone size={14} />,
                label: "Announcement",
                hint: "Managers post",
              },
            ].map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => setType(o.v)}
                className={cx(
                  "rounded-lg border px-3 py-2.5 text-left transition-colors",
                  type === o.v
                    ? "border-accent-500/60 bg-accent-500/10"
                    : "border-line bg-ink-800 hover:border-line-strong"
                )}
              >
                <span className="flex items-center gap-1.5 text-[13px] font-medium">
                  {o.icon} {o.label}
                </span>
                <span className="text-[11px] text-mist-600">{o.hint}</span>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Description" hint="Optional">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this channel about?"
          />
        </Field>
        <Button type="submit" loading={busy} className="w-full">
          Create channel
        </Button>
      </form>
    </Modal>
  );
}

/* ================= Directory (departments & teams) ================= */

function TeamRow({ team, deptTeams }: { team: Team; deptTeams?: boolean }) {
  const { activeOrgId, myRole, me, members, refetchOrg, conversations, selectConversation } =
    useWorkspace();
  const toast = useToast();
  const [openRow, setOpenRow] = useState(false);
  const [adding, setAdding] = useState("");

  const manager = asUser(team.manager as any);
  const isAdmin = myRole === "owner" || myRole === "admin";
  const canManage = isAdmin || manager?._id === me._id;
  const teamMemberIds = new Set(
    (team.members || []).map((m: any) => (typeof m === "object" ? m._id : m))
  );
  const candidates = members.filter((m) => {
    const u = asUser(m.user);
    return u && !teamMemberIds.has(u._id);
  });
  const teamChannel = conversations.find(
    (c) => c.teamId === team._id && c.isGroup
  );

  const addMember = async () => {
    if (!adding) return;
    try {
      await post(`/organizations/${activeOrgId}/teams/${team._id}/members`, {
        userId: adding,
      });
      setAdding("");
      toast("Member added");
      refetchOrg();
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  const removeMember = async (userId: string) => {
    try {
      await del(`/organizations/${activeOrgId}/teams/${team._id}/members/${userId}`);
      toast("Member removed");
      refetchOrg();
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  return (
    <div className={cx("rounded-lg border border-line bg-ink-800", deptTeams && "ml-5")}>
      <button
        onClick={() => setOpenRow((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
      >
        <Chevron size={13} open={openRow} className="text-mist-600" />
        <Users size={14} className="text-accent-300" />
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
          {team.name}
        </span>
        {manager && (
          <span className="flex items-center gap-1.5 text-xs text-mist-600">
            <Avatar name={manager.username} size={18} />
            {manager.username}
          </span>
        )}
        <Badge>
          {(team.members || []).length} member{(team.members || []).length === 1 ? "" : "s"}
        </Badge>
      </button>
      {openRow && (
        <div className="space-y-2 border-t border-line px-3 py-2.5">
          {team.description && (
            <p className="text-xs text-mist-500">{team.description}</p>
          )}
          {teamChannel && teamMemberIds.has(me._id) && (
            <button
              className="text-xs font-medium text-accent-300 hover:underline"
              onClick={() => selectConversation(teamChannel._id)}
            >
              Open #{teamChannel.groupName} →
            </button>
          )}
          <div className="flex flex-wrap gap-1.5">
            {(team.members || []).map((m: any) => {
              const u = asUser(m);
              if (!u) return null;
              return (
                <span
                  key={u._id}
                  className="group flex items-center gap-1.5 rounded-full border border-line bg-ink-750 py-0.5 pl-1 pr-2 text-xs"
                >
                  <Avatar name={u.username} size={16} />
                  {u.username}
                  {manager?._id === u._id && <Crown size={10} className="text-warn" />}
                  {canManage && manager?._id !== u._id && (
                    <button
                      className="hidden text-mist-600 hover:text-danger group-hover:inline"
                      onClick={() => removeMember(u._id)}
                    >
                      <X size={10} />
                    </button>
                  )}
                </span>
              );
            })}
          </div>
          {canManage && candidates.length > 0 && (
            <div className="flex items-center gap-2 pt-1">
              <Select
                className="flex-1 py-1.5 text-xs"
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
              >
                <option value="">Add a member…</option>
                {candidates.map((m) => {
                  const u = asUser(m.user)!;
                  return (
                    <option key={u._id} value={u._id}>
                      {u.username}
                    </option>
                  );
                })}
              </Select>
              <Button variant="subtle" className="h-8 px-2.5" onClick={addMember} disabled={!adding}>
                <Plus size={13} />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DirectoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { structure, myRole, activeOrgId, members, refetchOrg } = useWorkspace();
  const toast = useToast();
  const isAdmin = myRole === "owner" || myRole === "admin";

  const [showNewDept, setShowNewDept] = useState(false);
  const [showNewTeam, setShowNewTeam] = useState(false);
  const [deptName, setDeptName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teamDept, setTeamDept] = useState("");
  const [teamManager, setTeamManager] = useState("");
  const [busy, setBusy] = useState(false);

  const createDept = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await post(`/organizations/${activeOrgId}/departments`, { name: deptName.trim() });
      toast(`${deptName.trim()} department created`);
      setDeptName("");
      setShowNewDept(false);
      refetchOrg();
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const createTeam = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await post(`/organizations/${activeOrgId}/teams`, {
        name: teamName.trim(),
        departmentId: teamDept || null,
        managerId: teamManager || null,
      });
      toast(`${teamName.trim()} team created`);
      setTeamName("");
      setTeamManager("");
      setShowNewTeam(false);
      refetchOrg();
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Organization directory" width={560}>
      {isAdmin && (
        <div className="mb-4 flex gap-2">
          <Button variant="outline" className="h-8 px-3 text-xs" onClick={() => setShowNewDept((v) => !v)}>
            <Folder size={13} /> New department
          </Button>
          <Button variant="outline" className="h-8 px-3 text-xs" onClick={() => setShowNewTeam((v) => !v)}>
            <Users size={13} /> New team
          </Button>
        </div>
      )}

      {showNewDept && (
        <form onSubmit={createDept} className="mb-4 flex gap-2 rounded-lg border border-line bg-ink-800 p-3">
          <Input
            value={deptName}
            onChange={(e) => setDeptName(e.target.value)}
            placeholder="Engineering"
            minLength={2}
            required
            autoFocus
          />
          <Button type="submit" loading={busy} className="shrink-0">
            Create
          </Button>
        </form>
      )}

      {showNewTeam && (
        <form onSubmit={createTeam} className="mb-4 space-y-2.5 rounded-lg border border-line bg-ink-800 p-3">
          <Input
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="Backend Team"
            minLength={2}
            required
            autoFocus
          />
          <div className="grid grid-cols-2 gap-2">
            <Select value={teamDept} onChange={(e) => setTeamDept(e.target.value)}>
              <option value="">No department</option>
              {structure?.departments.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.name}
                </option>
              ))}
            </Select>
            <Select value={teamManager} onChange={(e) => setTeamManager(e.target.value)}>
              <option value="">No manager yet</option>
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
          <Button type="submit" loading={busy} className="w-full">
            Create team
          </Button>
        </form>
      )}

      <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
        {structure?.departments.length === 0 &&
          structure?.unassignedTeams.length === 0 && (
            <p className="py-6 text-center text-sm text-mist-600">
              No departments or teams yet.
              {isAdmin && " Create your first department above."}
            </p>
          )}

        {structure?.departments.map((dept: Department) => (
          <div key={dept._id}>
            <div className="mb-1.5 flex items-center gap-2 px-1">
              <Folder size={14} className="text-warn" />
              <span className="text-[13px] font-semibold">{dept.name}</span>
              <span className="text-xs text-mist-600">
                {dept.teams.length} team{dept.teams.length === 1 ? "" : "s"}
              </span>
              {asUser(dept.head as any) && (
                <span className="ml-auto text-xs text-mist-600">
                  Head: {asUser(dept.head as any)!.username}
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              {dept.teams.map((t) => (
                <TeamRow key={t._id} team={t} deptTeams />
              ))}
              {dept.teams.length === 0 && (
                <p className="ml-5 rounded-lg border border-dashed border-line px-3 py-2 text-xs text-mist-600">
                  No teams in this department yet.
                </p>
              )}
            </div>
          </div>
        ))}

        {(structure?.unassignedTeams.length || 0) > 0 && (
          <div>
            <div className="mb-1.5 flex items-center gap-2 px-1">
              <Users size={14} className="text-mist-500" />
              <span className="text-[13px] font-semibold">Unassigned teams</span>
            </div>
            <div className="space-y-1.5">
              {structure!.unassignedTeams.map((t) => (
                <TeamRow key={t._id} team={t} />
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
