"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { get, patch } from "@/lib/api";
import type { OrgRole, User } from "@/lib/types";
import { ROLE_LABEL, ROLE_TONE } from "@/lib/format";
import {
  Avatar,
  Badge,
  Input,
  Modal,
  Select,
  Spinner,
  cx,
  useToast,
} from "@/components/ui";
import { Check, Crown, Edit, Search, Users, X } from "@/components/icons";

interface DirectoryEntry {
  user: User;
  role: OrgRole;
  jobTitle: string;
  teams: { _id: string; name: string; isManager: boolean }[];
  departments: { _id: string; name: string }[];
}

function TitleEditor({
  entry,
  onSaved,
}: {
  entry: DirectoryEntry;
  onSaved: () => void;
}) {
  const { activeOrgId } = useWorkspace();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(entry.jobTitle);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await patch(
        `/organizations/${activeOrgId}/members/${entry.user._id}/profile`,
        { jobTitle: value.trim() }
      );
      toast("Title updated");
      setEditing(false);
      onSaved();
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <button
        className="group/title flex items-center gap-1.5 text-left"
        onClick={() => {
          setValue(entry.jobTitle);
          setEditing(true);
        }}
        title="Edit job title"
      >
        <span
          className={cx(
            "text-[12.5px]",
            entry.jobTitle ? "text-mist-400" : "italic text-mist-600"
          )}
        >
          {entry.jobTitle || "Add job title…"}
        </span>
        <Edit
          size={11}
          className="text-mist-600 opacity-0 transition-opacity group-hover/title:opacity-100"
        />
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1.5">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={60}
        placeholder="e.g. Backend Developer"
        className="h-7 w-44 px-2 py-1 text-xs"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
      />
      <button onClick={save} disabled={busy} className="text-ok" title="Save">
        {busy ? <Spinner size={12} /> : <Check size={14} />}
      </button>
      <button
        onClick={() => setEditing(false)}
        className="text-mist-600 hover:text-mist-300"
        title="Cancel"
      >
        <X size={13} />
      </button>
    </span>
  );
}

export default function PeopleModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { activeOrgId, structure, me, myRole } = useWorkspace();
  const [q, setQ] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [role, setRole] = useState("");
  const [entries, setEntries] = useState<DirectoryEntry[] | null>(null);

  const isAdmin = myRole === "owner" || myRole === "admin";

  const teamsForFilter = useMemo(() => {
    const all = [
      ...(structure?.departments.flatMap((d) =>
        d.teams.map((t) => ({ ...t, deptId: d._id }))
      ) || []),
      ...(structure?.unassignedTeams.map((t) => ({ ...t, deptId: "" })) || []),
    ];
    return departmentId ? all.filter((t) => t.deptId === departmentId) : all;
  }, [structure, departmentId]);

  const load = useCallback(() => {
    if (!activeOrgId) return;
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (departmentId) params.set("departmentId", departmentId);
    if (teamId) params.set("teamId", teamId);
    if (role) params.set("role", role);
    get<{ data: DirectoryEntry[] }>(
      `/organizations/${activeOrgId}/directory?${params.toString()}`
    )
      .then((res) => setEntries(res.data))
      .catch(() => setEntries([]));
  }, [activeOrgId, q, departmentId, teamId, role]);

  // Debounced reload when the query/filters change
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [open, load]);

  useEffect(() => {
    if (open) {
      setEntries(null);
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Users size={15} className="text-accent-300" /> People
          {entries && (
            <span className="text-xs font-normal text-mist-600">
              {entries.length} {entries.length === 1 ? "person" : "people"}
            </span>
          )}
        </span>
      }
      width={620}
    >
      {/* Search + filters */}
      <div className="mb-4 space-y-2.5">
        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist-600"
          />
          <Input
            className="pl-8"
            placeholder="Search by name, email or job title…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Select
            value={departmentId}
            onChange={(e) => {
              setDepartmentId(e.target.value);
              setTeamId("");
            }}
            className="py-1.5 text-xs"
          >
            <option value="">All departments</option>
            {structure?.departments.map((d) => (
              <option key={d._id} value={d._id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            className="py-1.5 text-xs"
          >
            <option value="">All teams</option>
            {teamsForFilter.map((t) => (
              <option key={t._id} value={t._id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="py-1.5 text-xs"
          >
            <option value="">All roles</option>
            <option value="owner">Owner</option>
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="employee">Employee</option>
          </Select>
        </div>
      </div>

      {/* Results */}
      <div className="max-h-[52vh] space-y-1.5 overflow-y-auto pr-1">
        {entries === null ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : entries.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-mist-600">
            Nobody matches this search.
          </p>
        ) : (
          entries.map((entry) => {
            const canEditTitle = entry.user._id === me._id || isAdmin;
            return (
              <div
                key={entry.user._id}
                className="flex items-start gap-3 rounded-xl border border-line bg-ink-800 px-3.5 py-3"
              >
                <Avatar
                  name={entry.user.username}
                  src={entry.user.avatar}
                  size={38}
                  online={entry.user.online}
                />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 leading-5">
                    <span className="text-[14px] font-semibold">
                      {entry.user.username}
                    </span>
                    <Badge className={ROLE_TONE[entry.role]}>
                      {ROLE_LABEL[entry.role]}
                    </Badge>
                    {entry.user._id === me._id && (
                      <span className="text-[11px] text-mist-600">(you)</span>
                    )}
                  </p>
                  <div className="mt-0.5">
                    {canEditTitle ? (
                      <TitleEditor entry={entry} onSaved={load} />
                    ) : (
                      <span
                        className={cx(
                          "text-[12.5px]",
                          entry.jobTitle ? "text-mist-400" : "italic text-mist-600"
                        )}
                      >
                        {entry.jobTitle || "No title yet"}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[11.5px] text-mist-600">
                    {entry.user.email}
                    {entry.departments.length > 0 &&
                      ` · ${entry.departments.map((d) => d.name).join(", ")}`}
                  </p>
                  {entry.teams.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {entry.teams.map((t) => (
                        <span
                          key={t._id}
                          className="flex items-center gap-1 rounded-full border border-line bg-ink-750 px-2 py-0.5 text-[10.5px] text-mist-400"
                        >
                          {t.name}
                          {t.isManager && <Crown size={9} className="text-warn" />}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
}
