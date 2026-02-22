import mongoose, { Schema } from "mongoose";

const timeMgmtSchema = new Schema({
  scout_email: { type: String, required: true, index: true },
  exercise_week_start: Date,
  todo_list: [{ item: String, priority: Number, category: String }],
  weekly_schedule: [
    {
      day: String,
      fixed_activities: [{ time: String, activity: String }],
      planned_tasks: [{ time: String, todo_item: String }],
    },
  ],
  daily_diary: [
    {
      day: String,
      entries: [
        {
          scheduled_time: String,
          actual_time: String,
          task: String,
          completed: Boolean,
          notes: String,
        },
      ],
    },
  ],
  reflection: String,
});

export const TimeMgmt = mongoose.model("TimeMgmt", timeMgmtSchema, "time_mgmt");
