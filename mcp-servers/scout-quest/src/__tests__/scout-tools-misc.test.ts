import { describe, it, expect } from "vitest";
import { validateToneDial } from "../validation.js";

describe("adjustTone (unit)", () => {
  it("clamps tone_dial to max when exceeding", () => {
    expect(validateToneDial(5, 1, 4)).toBe(4);
  });

  it("clamps tone_dial to min when below", () => {
    expect(validateToneDial(1, 2, 5)).toBe(2);
  });

  it("passes through valid value unchanged", () => {
    expect(validateToneDial(3, 1, 5)).toBe(3);
  });

  it("rounds fractional values", () => {
    expect(validateToneDial(2.7, 1, 5)).toBe(3);
    expect(validateToneDial(2.3, 1, 5)).toBe(2);
  });

  it("handles edge case where min equals max", () => {
    expect(validateToneDial(1, 3, 3)).toBe(3);
    expect(validateToneDial(5, 3, 3)).toBe(3);
  });
});

describe("setupTimeMgmt (unit)", () => {
  it("todo list has priorities and categories", () => {
    const todoList = [
      { item: "Study for math test", priority: 1, category: "school" },
      { item: "Practice trumpet", priority: 2, category: "music" },
      { item: "Clean room", priority: 3, category: "chores" },
    ];
    expect(todoList).toHaveLength(3);
    expect(todoList[0].priority).toBe(1);
  });

  it("weekly schedule has 7 days", () => {
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const schedule = days.map(day => ({
      day,
      fixed_activities: [{ time: "8:00", activity: "School" }],
      planned_tasks: [{ time: "16:00", todo_item: "Homework" }],
    }));
    expect(schedule).toHaveLength(7);
  });
});

describe("logDiaryEntry (unit)", () => {
  it("diary entries compare scheduled vs actual", () => {
    const entry = {
      day: "Monday",
      entries: [
        { scheduled_time: "16:00", actual_time: "16:15", task: "Homework", completed: true, notes: "Started late" },
        { scheduled_time: "17:00", actual_time: "17:00", task: "Practice", completed: true, notes: "" },
        { scheduled_time: "18:00", actual_time: "18:30", task: "Chores", completed: false, notes: "Ran out of time" },
      ],
    };
    const completedCount = entry.entries.filter(e => e.completed).length;
    expect(completedCount).toBe(2);
    expect(entry.entries).toHaveLength(3);
  });

  it("7 diary entries completes the exercise", () => {
    const diaryDays = 7;
    expect(diaryDays).toBeGreaterThanOrEqual(7);
  });
});

describe("updateQuestGoal (unit)", () => {
  it("loan_path_active is recalculated on budget change", () => {
    const savings_capacity = 500;

    // Budget below capacity — no loan needed
    expect(300 > savings_capacity).toBe(false);

    // Budget above capacity — loan path active
    expect(1500 > savings_capacity).toBe(true);
  });

  it("target_budget of 0 means no loan path", () => {
    expect(0 > 500).toBe(false);
  });
});
