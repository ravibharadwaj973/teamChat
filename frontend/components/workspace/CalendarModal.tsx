"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { del, get, post } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import type { EventType, OrgEvent, TaskDeadline } from "@/lib/types";
import { timeOf } from "@/lib/format";
import {
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
import {
  Calendar as CalendarIcon,
  Chevron,
  Clipboard,
  Plus,
  Trash,
  Users,
} from "@/components/icons";

const TYPE_META: Record<EventType, { label: string; dot: string; chip: string }> = {
  meeting: {
    label: "Meeting",
    dot: "bg-accent-400",
    chip: "border-accent-500/40 bg-accent-500/10 text-accent-300",
  },
  event: {
    label: "Event",
    dot: "bg-ok",
    chip: "border-ok/40 bg-ok/10 text-ok",
  },
  deadline: {
    label: "Deadline",
    dot: "bg-danger",
    chip: "border-danger/40 bg-danger/10 text-danger",
  },
};

const dayKey = (d: Date) => d.toDateString();

export default function CalendarModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { activeOrgId, me, myRole, structure } = useWorkspace();
  const toast = useToast();

  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selected, setSelected] = useState<Date>(new Date());
  const [events, setEvents] = useState<OrgEvent[] | null>(null);
  const [deadlines, setDeadlines] = useState<TaskDeadline[]>([]);
  const [canCompanyWide, setCanCompanyWide] = useState(false);
  const [composing, setComposing] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<EventType>("meeting");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [teamId, setTeamId] = useState("");
  const [busy, setBusy] = useState(false);

  const isAdmin = myRole === "owner" || myRole === "admin";

  const myTeams = useMemo(() => {
    const all = [
      ...(structure?.departments.flatMap((d) => d.teams) || []),
      ...(structure?.unassignedTeams || []),
    ];
    if (isAdmin) return all;
    return all.filter(
      (t) =>
        (t.members || []).some((m: any) => (typeof m === "object" ? m._id : m) === me._id) ||
        (t.manager && (t.manager as any)._id === me._id)
    );
  }, [structure, isAdmin, me._id]);

  const load = useCallback(() => {
    const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59);
    get<{
      data: { events: OrgEvent[]; taskDeadlines: TaskDeadline[] };
      canCreateCompanyWide: boolean;
    }>(
      `/organizations/${activeOrgId}/events?from=${from.toISOString()}&to=${to.toISOString()}`
    )
      .then((res) => {
        setEvents(res.data.events);
        setDeadlines(res.data.taskDeadlines);
        setCanCompanyWide(res.canCreateCompanyWide);
      })
      .catch(() => {
        setEvents([]);
        setDeadlines([]);
      });
  }, [activeOrgId, cursor]);

  useEffect(() => {
    if (!open) return;
    setEvents(null);
    load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const socket = getSocket();
    const refresh = () => load();
    socket.on("event:created", refresh);
    socket.on("event:updated", refresh);
    socket.on("event:deleted", refresh);
    return () => {
      socket.off("event:created", refresh);
      socket.off("event:updated", refresh);
      socket.off("event:deleted", refresh);
    };
  }, [open, load]);

  /* ---- month grid ---- */
  const weeks = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    const grid: Date[][] = [];
    const d = new Date(start);
    for (let w = 0; w < 6; w++) {
      const week: Date[] = [];
      for (let i = 0; i < 7; i++) {
        week.push(new Date(d));
        d.setDate(d.getDate() + 1);
      }
      grid.push(week);
    }
    return grid;
  }, [cursor]);

  const byDay = useMemo(() => {
    const map = new Map<string, { events: OrgEvent[]; deadlines: TaskDeadline[] }>();
    (events || []).forEach((e) => {
      const key = dayKey(new Date(e.startAt));
      if (!map.has(key)) map.set(key, { events: [], deadlines: [] });
      map.get(key)!.events.push(e);
    });
    deadlines.forEach((t) => {
      const key = dayKey(new Date(t.dueDate));
      if (!map.has(key)) map.set(key, { events: [], deadlines: [] });
      map.get(key)!.deadlines.push(t);
    });
    return map;
  }, [events, deadlines]);

  const selectedDay = byDay.get(dayKey(selected)) || { events: [], deadlines: [] };
  const monthLabel = cursor.toLocaleDateString([], { month: "long", year: "numeric" });
  const today = new Date();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!date) return;
    setBusy(true);
    try {
      const startAt = new Date(`${date}T${time || "09:00"}`);
      const endAt = endTime ? new Date(`${date}T${endTime}`) : null;
      await post(`/organizations/${activeOrgId}/events`, {
        title: title.trim(),
        description,
        type,
        startAt: startAt.toISOString(),
        endAt: endAt ? endAt.toISOString() : null,
        location,
        teamId: teamId || null,
      });
      toast("📅 Event scheduled");
      setTitle("");
      setDescription("");
      setLocation("");
      setComposing(false);
      load();
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const removeEvent = async (ev: OrgEvent) => {
    if (!confirm(`Delete "${ev.title}"?`)) return;
    try {
      await del(`/organizations/${activeOrgId}/events/${ev._id}`);
      toast("Event deleted");
      load();
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  const canCreateAnything = canCompanyWide || myTeams.length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <CalendarIcon size={15} className="text-accent-300" /> Calendar
        </span>
      }
      width={640}
    >
      {/* Month header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            onClick={() =>
              setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
            }
            className="flex h-7 w-7 items-center justify-center rounded-md text-mist-500 hover:bg-ink-700 hover:text-mist-100"
            aria-label="Previous month"
          >
            <Chevron size={13} style={{ transform: "rotate(180deg)" }} />
          </button>
          <button
            onClick={() =>
              setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
            }
            className="flex h-7 w-7 items-center justify-center rounded-md text-mist-500 hover:bg-ink-700 hover:text-mist-100"
            aria-label="Next month"
          >
            <Chevron size={13} />
          </button>
          <h4 className="ml-2 text-[15px] font-semibold tracking-tight">
            {monthLabel}
          </h4>
        </div>
        {canCreateAnything && (
          <Button
            className="h-8 px-3 text-xs"
            onClick={() => {
              setDate(selected.toISOString().slice(0, 10));
              setComposing((v) => !v);
            }}
          >
            <Plus size={13} /> New event
          </Button>
        )}
      </div>

      {composing && (
        <form
          onSubmit={submit}
          className="mb-4 space-y-3 rounded-xl border border-accent-500/30 bg-ink-800 p-4"
        >
          <div className="grid grid-cols-[1fr_140px] gap-3">
            <Field label="Title">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Sprint planning"
                minLength={2}
                maxLength={140}
                required
                autoFocus
              />
            </Field>
            <Field label="Type">
              <Select value={type} onChange={(e) => setType(e.target.value as EventType)}>
                <option value="meeting">Meeting</option>
                <option value="event">Event</option>
                <option value="deadline">Deadline</option>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Date">
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </Field>
            <Field label="Start">
              <Input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </Field>
            <Field label="End (optional)">
              <Input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Scope">
              <Select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                {canCompanyWide && <option value="">🏢 Company-wide</option>}
                {!canCompanyWide && <option value="">Choose a team…</option>}
                {myTeams.map((t) => (
                  <option key={t._id} value={t._id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Location / link">
              <Input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Meet room 2 or https://…"
                maxLength={300}
              />
            </Field>
          </div>
          <Field label="Details">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Agenda, notes… (optional)"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => setComposing(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!canCompanyWide && !teamId}>
              Schedule
            </Button>
          </div>
        </form>
      )}

      {events === null ? (
        <div className="flex justify-center py-14">
          <Spinner size={20} />
        </div>
      ) : (
        <div className="grid grid-cols-[1.4fr_1fr] gap-4">
          {/* Month grid */}
          <div>
            <div className="mb-1 grid grid-cols-7 text-center text-[10.5px] font-semibold uppercase tracking-wide text-mist-600">
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                <span key={i} className="py-1">
                  {d}
                </span>
              ))}
            </div>
            <div className="overflow-hidden rounded-xl border border-line">
              {weeks.map((week, wi) => (
                <div key={wi} className="grid grid-cols-7 border-b border-line last:border-b-0">
                  {week.map((day) => {
                    const inMonth = day.getMonth() === cursor.getMonth();
                    const isToday = dayKey(day) === dayKey(today);
                    const isSelected = dayKey(day) === dayKey(selected);
                    const dayData = byDay.get(dayKey(day));
                    const dots = [
                      ...(dayData?.events.slice(0, 3).map((e) => TYPE_META[e.type].dot) || []),
                      ...((dayData?.deadlines.length || 0) > 0 ? ["bg-warn"] : []),
                    ].slice(0, 4);
                    return (
                      <button
                        key={day.toISOString()}
                        onClick={() => setSelected(new Date(day))}
                        className={cx(
                          "flex h-12 flex-col items-center justify-center gap-0.5 border-r border-line text-[12px] transition-colors last:border-r-0",
                          !inMonth && "text-mist-600/50",
                          inMonth && "text-mist-300 hover:bg-ink-700",
                          isSelected && "bg-accent-500/15 text-mist-100",
                          isToday && !isSelected && "bg-ink-750"
                        )}
                      >
                        <span
                          className={cx(
                            "flex h-5 w-5 items-center justify-center rounded-full leading-none",
                            isToday && "bg-accent-600 font-bold text-white"
                          )}
                        >
                          {day.getDate()}
                        </span>
                        <span className="flex h-1.5 gap-0.5">
                          {dots.map((tone, i) => (
                            <span key={i} className={cx("h-1.5 w-1.5 rounded-full", tone)} />
                          ))}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-3 px-1 text-[10.5px] text-mist-600">
              {(Object.keys(TYPE_META) as EventType[]).map((t) => (
                <span key={t} className="flex items-center gap-1">
                  <span className={cx("h-1.5 w-1.5 rounded-full", TYPE_META[t].dot)} />
                  {TYPE_META[t].label}
                </span>
              ))}
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-warn" />
                My task due
              </span>
            </div>
          </div>

          {/* Day agenda */}
          <div className="min-w-0">
            <p className="mb-2 text-[13px] font-semibold">
              {selected.toLocaleDateString([], {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </p>
            <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
              {selectedDay.events.length === 0 && selectedDay.deadlines.length === 0 && (
                <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-mist-600">
                  Nothing scheduled.
                </p>
              )}
              {selectedDay.events.map((ev) => {
                const canManage =
                  ev.createdBy?._id === me._id || isAdmin;
                return (
                  <div
                    key={ev._id}
                    className="group rounded-lg border border-line bg-ink-800 p-2.5"
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[13px] font-semibold leading-5">
                            {ev.title}
                          </span>
                          <Badge className={TYPE_META[ev.type].chip}>
                            {TYPE_META[ev.type].label}
                          </Badge>
                        </p>
                        <p className="mt-0.5 text-[11.5px] text-mist-600">
                          {ev.allDay
                            ? "All day"
                            : `${timeOf(ev.startAt)}${ev.endAt ? ` – ${timeOf(ev.endAt)}` : ""}`}
                          {ev.team ? (
                            <span className="ml-1.5 inline-flex items-center gap-1">
                              <Users size={10} /> {ev.team.name}
                            </span>
                          ) : (
                            " · Company-wide"
                          )}
                        </p>
                        {ev.location && (
                          <p className="mt-0.5 truncate text-[11.5px] text-accent-300">
                            📍 {ev.location}
                          </p>
                        )}
                        {ev.description && (
                          <p className="mt-1 line-clamp-2 text-xs text-mist-500">
                            {ev.description}
                          </p>
                        )}
                      </div>
                      {canManage && (
                        <button
                          title="Delete event"
                          onClick={() => removeEvent(ev)}
                          className="hidden text-mist-600 hover:text-danger group-hover:block"
                        >
                          <Trash size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {selectedDay.deadlines.map((t) => (
                <div
                  key={t._id}
                  className="flex items-center gap-2 rounded-lg border border-warn/25 bg-warn/5 p-2.5"
                >
                  <Clipboard size={14} className="shrink-0 text-warn" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{t.title}</p>
                    <p className="text-[11px] text-mist-600">
                      My task · due {timeOf(t.dueDate)} ·{" "}
                      {t.status === "done" ? "done ✓" : t.status.replace("_", " ")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
