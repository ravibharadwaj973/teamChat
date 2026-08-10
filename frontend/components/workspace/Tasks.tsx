"use client";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { del, get, patch, post } from "@/lib/api";
import type { Task, TaskPriority, TaskStatus, User } from "@/lib/types";
import { dueLabel } from "@/lib/format";
import {
  Avatar,
  Badge,
  Button,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Textarea,
  cx,
  useToast,
} from "@/components/ui";
import { Check, Clipboard, Plus, Trash } from "@/components/icons";

const STATUS_META: Record<TaskStatus, { label: string; tone: string }> = {
  todo: { label: "To do", tone: "border-line-strong bg-ink-700/60 text-mist-300" },
  in_progress: {
    label: "In progress",
    tone: "border-accent-500/40 bg-accent-500/10 text-accent-300",
  },
  done: { label: "Done", tone: "border-ok/40 bg-ok/10 text-ok" },
};

const PRIORITY_META: Record<TaskPriority, { label: string; tone: string }> = {
  high: { label: "High", tone: "border-danger/40 bg-danger/10 text-danger" },
  medium: { label: "Medium", tone: "border-warn/40 bg-warn/10 text-warn" },
  low: { label: "Low", tone: "border-line-strong bg-ink-700/60 text-mist-500" },
};

function TaskCard({
  task,
  view,
  onChanged,
}: {
  task: Task;
  view: "my" | "assigned";
  onChanged: () => void;
}) {
  const { activeOrgId, me, myRole } = useWorkspace();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const isAssigner = task.assignedBy?._id === me._id;
  const isAdmin = myRole === "owner" || myRole === "admin";
  const canDelete = isAssigner || isAdmin;
  const due = dueLabel(task.dueDate, task.status === "done");

  const setStatus = async (status: TaskStatus) => {
    if (status === task.status) return;
    setBusy(true);
    try {
      await patch(
        `/organizations/${activeOrgId}/tasks/${task._id}/status`,
        { status }
      );
      onChanged();
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete task "${task.title}"?`)) return;
    try {
      await del(`/organizations/${activeOrgId}/tasks/${task._id}`);
      toast("Task deleted");
      onChanged();
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  return (
    <div
      className={cx(
        "rounded-xl border border-line bg-ink-800 p-3.5",
        task.status === "done" && "opacity-70"
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4
              className={cx(
                "text-[14px] font-semibold leading-5",
                task.status === "done" && "line-through decoration-mist-600"
              )}
            >
              {task.title}
            </h4>
            <Badge className={PRIORITY_META[task.priority].tone}>
              {PRIORITY_META[task.priority].label}
            </Badge>
            {task.team && <Badge>{task.team.name}</Badge>}
          </div>
          {task.description && (
            <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-mist-500">
              {task.description}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-mist-600">
            {view === "my" ? (
              <span className="flex items-center gap-1.5">
                <Avatar name={task.assignedBy?.username || "?"} size={16} />
                from {task.assignedBy?.username}
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Avatar name={task.assignee?.username || "?"} size={16} />
                to {task.assignee?.username}
              </span>
            )}
            {due && (
              <span
                className={cx(
                  "font-medium",
                  due.tone === "danger" && "text-danger",
                  due.tone === "warn" && "text-warn"
                )}
              >
                {due.text}
              </span>
            )}
            {task.status === "done" && task.completedAt && (
              <span className="flex items-center gap-1 text-ok">
                <Check size={11} /> completed
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <Select
            className={cx("w-[122px] py-1 text-xs", STATUS_META[task.status].tone)}
            value={task.status}
            disabled={busy}
            onChange={(e) => setStatus(e.target.value as TaskStatus)}
          >
            <option value="todo">To do</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done ✓</option>
          </Select>
          {canDelete && (
            <button
              title="Delete task"
              className="text-mist-600 hover:text-danger"
              onClick={remove}
            >
              <Trash size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TasksModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { activeOrgId, myTasks, taskCanAssign, refetchTasks, structure } =
    useWorkspace();
  const toast = useToast();

  const [tab, setTab] = useState<"my" | "assigned">("my");
  const [assignedTasks, setAssignedTasks] = useState<Task[] | null>(null);
  const [composing, setComposing] = useState(false);
  const [assignable, setAssignable] = useState<User[]>([]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);

  const teams = useMemo(
    () => [
      ...(structure?.departments.flatMap((d) => d.teams) || []),
      ...(structure?.unassignedTeams || []),
    ],
    [structure]
  );

  const loadAssigned = () => {
    setAssignedTasks(null);
    get<{ data: Task[] }>(`/organizations/${activeOrgId}/tasks?scope=assigned`)
      .then((res) => setAssignedTasks(res.data))
      .catch(() => setAssignedTasks([]));
  };

  useEffect(() => {
    if (!open) return;
    setTab("my");
    setComposing(false);
    refetchTasks();
    if (taskCanAssign) {
      get<{ data: User[] }>(`/organizations/${activeOrgId}/tasks/assignable`)
        .then((res) => setAssignable(res.data))
        .catch(() => setAssignable([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeOrgId, taskCanAssign]);

  useEffect(() => {
    if (open && tab === "assigned") loadAssigned();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await post(`/organizations/${activeOrgId}/tasks`, {
        title: title.trim(),
        description,
        assigneeId,
        teamId: teamId || null,
        priority,
        dueDate: dueDate || null,
      });
      toast("📋 Task assigned");
      setTitle("");
      setDescription("");
      setAssigneeId("");
      setTeamId("");
      setPriority("medium");
      setDueDate("");
      setComposing(false);
      refetchTasks();
      if (tab === "assigned") loadAssigned();
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const sortTasks = (list: Task[]) =>
    [...list].sort((a, b) => {
      const doneDiff = (a.status === "done" ? 1 : 0) - (b.status === "done" ? 1 : 0);
      if (doneDiff !== 0) return doneDiff;
      const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      return aDue - bDue;
    });

  const refreshBoth = () => {
    refetchTasks();
    if (tab === "assigned") loadAssigned();
  };

  const list = tab === "my" ? sortTasks(myTasks) : sortTasks(assignedTasks || []);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Clipboard size={15} className="text-accent-300" /> Tasks
        </span>
      }
      width={580}
    >
      <div className="mb-4 flex items-center gap-2">
        <div className="flex flex-1 rounded-lg border border-line bg-ink-800 p-0.5">
          {(
            [
              ["my", "My tasks"],
              ["assigned", "Assigned by me"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cx(
                "flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
                tab === key
                  ? "bg-ink-600 text-mist-100"
                  : "text-mist-500 hover:text-mist-300"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {taskCanAssign && (
          <Button className="h-8 px-3 text-xs" onClick={() => setComposing((v) => !v)}>
            <Plus size={13} /> Assign task
          </Button>
        )}
      </div>

      {composing && (
        <form
          onSubmit={submit}
          className="mb-4 space-y-3 rounded-xl border border-accent-500/30 bg-ink-800 p-4"
        >
          <Field label="Task">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ship the login page"
              minLength={2}
              maxLength={140}
              required
              autoFocus
            />
          </Field>
          <Field label="Details">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What needs to happen? (optional)"
              rows={3}
              maxLength={2000}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Assign to">
              <Select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                required
              >
                <option value="">Choose member…</option>
                {assignable.map((u) => (
                  <option key={u._id} value={u._id}>
                    {u.username}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Team (optional)">
              <Select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                <option value="">No team</option>
                {teams.map((t) => (
                  <option key={t._id} value={t._id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Priority">
              <Select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </Select>
            </Field>
            <Field label="Deadline">
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => setComposing(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Assign task
            </Button>
          </div>
        </form>
      )}

      <div className="max-h-[52vh] space-y-2.5 overflow-y-auto pr-1">
        {tab === "assigned" && assignedTasks === null ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : list.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center">
            <Clipboard size={22} className="mx-auto mb-2 text-mist-600" />
            <p className="text-sm font-medium text-mist-300">
              {tab === "my" ? "No tasks assigned to you" : "You haven't assigned any tasks"}
            </p>
            <p className="mt-1 text-[13px] text-mist-600">
              {tab === "my"
                ? "Work your manager assigns will show up here."
                : taskCanAssign
                  ? "Use “Assign task” to hand out work with a deadline."
                  : ""}
            </p>
          </div>
        ) : (
          list.map((t) => (
            <TaskCard key={t._id} task={t} view={tab} onChanged={refreshBoth} />
          ))
        )}
      </div>
    </Modal>
  );
}
