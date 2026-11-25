"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Department, StaffUser } from "../lib/api";

interface StaffEdit {
  role: StaffUser["role"];
  departmentId: number | null;
}

export function StaffAdminPanel() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [edits, setEdits] = useState<Record<number, StaffEdit>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.auth.staff();
      setUsers(data.users);
      setDepartments(data.departments);
      setEdits(
        Object.fromEntries(
          data.users.map((user) => [
            user.id,
            { role: user.role, departmentId: user.department_id },
          ]),
        ),
      );
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load staff accounts.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function updateEdit(userId: number, patch: Partial<StaffEdit>) {
    setEdits((current) => ({ ...current, [userId]: { ...current[userId], ...patch } }));
  }

  async function save(user: StaffUser) {
    const edit = edits[user.id];
    if (!edit) return;
    setSavingId(user.id);
    setError(null);
    setMessage(null);
    try {
      await api.auth.updateStaff(user.id, edit.role, edit.role === "department" ? edit.departmentId : null);
      setMessage(`Updated institutional access for ${user.name}.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update this account.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="dashboard-card space-y-5 p-6 sm:p-7 dark:border-slate-800 dark:bg-[#012667]">
      <header className="border-b border-slate-100 pb-4 dark:border-slate-800">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#075B67] dark:text-[#05D7E5]">
          SolveKey Administration
        </p>
        <h2 className="mt-1 text-xl font-bold text-[#012667] dark:text-white">
          Department Staff & Role Access
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Assign verified staff members to responsible municipal departments. Permissions take effect immediately.
        </p>
      </header>

      {error && (
        <p className="rounded-xl border border-red-200 bg-[#FDF2F2] px-4 py-3 text-sm text-[#DC4C4C] dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="rounded-xl border border-emerald-200 bg-[#EAF7F0] px-4 py-3 text-sm text-[#047353] dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300" role="status">
          {message}
        </p>
      )}

      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {users.map((user) => {
          const edit = edits[user.id] ?? { role: user.role, departmentId: user.department_id };
          return (
            <li
              className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_10rem_14rem_auto] sm:items-center"
              key={user.id}
            >
              <div className="min-w-0">
                <p className="truncate font-bold text-[#012667] dark:text-white">{user.name}</p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user.email}</p>
              </div>

              <label className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                System Role
                <select
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-[#012667] outline-none transition focus:border-[#05D7E5] dark:border-slate-700 dark:bg-[#0241A3] dark:text-white"
                  onChange={(event) =>
                    updateEdit(user.id, { role: event.target.value as StaffUser["role"] })
                  }
                  value={edit.role}
                >
                  <option value="citizen">Citizen</option>
                  <option value="department">Department Staff</option>
                  <option value="admin">Platform Admin</option>
                </select>
              </label>

              <label className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                Assigned Department
                <select
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-[#012667] outline-none transition focus:border-[#05D7E5] disabled:opacity-40 dark:border-slate-700 dark:bg-[#0241A3] dark:text-white"
                  disabled={edit.role !== "department"}
                  onChange={(event) =>
                    updateEdit(user.id, {
                      departmentId: event.target.value ? Number(event.target.value) : null,
                    })
                  }
                  value={edit.departmentId ?? ""}
                >
                  <option value="">Select department</option>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex items-end">
                <button
                  className="rounded-xl bg-[#012667] px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#0241A3] disabled:opacity-50 dark:bg-[#05D7E5] dark:text-[#07162F] dark:hover:bg-[#0279CE]"
                  disabled={savingId === user.id}
                  onClick={() => void save(user)}
                  type="button"
                >
                  {savingId === user.id ? "Saving…" : "Save"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
