import { describe, it, expect } from "vitest";
import { scheduleRule, scheduleLabel } from "../src/lib/automations";
describe("recurring schedule serialization", () => {
  it("keeps weekday schedules in account local time", () => {
    expect(scheduleRule("weekdays", "08:30")).toBe(
      "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=8;BYMINUTE=30;BYSECOND=0",
    );
  });
  it("hourly schedules are not limited to one hour per day", () => {
    expect(scheduleRule("hourly", "09:15")).toBe(
      "RRULE:FREQ=HOURLY;BYMINUTE=15;BYSECOND=0",
    );
  });
  it("preserves weekly and monthly choices", () => {
    expect(scheduleRule("weekly", "16:00", "FR")).toContain(
      "BYDAY=FR;BYHOUR=16",
    );
    expect(scheduleRule("monthly", "09:00", "MO", 28)).toContain(
      "BYMONTHDAY=28",
    );
  });
  it("rejects invalid dates and times", () => {
    expect(() => scheduleRule("daily", "25:00")).toThrow();
    expect(() => scheduleRule("monthly", "09:00", "MO", 31)).toThrow();
  });
  it("renders readable schedule labels", () => {
    expect(scheduleLabel(scheduleRule("weekdays", "08:30"))).toBe(
      "Weekdays at 08:30",
    );
    expect(scheduleLabel(scheduleRule("hourly", "09:15"))).toBe(
      "Hourly at :15",
    );
  });
});
