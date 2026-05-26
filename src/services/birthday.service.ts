import { v4 as uuidv4 } from "uuid";
import { getSupabase } from "../db/supabase";
import type { BirthdayRow, UpcomingBirthday } from "../types";

/**
 * Store a birthday for a person Heoster knows.
 */
export async function storeBirthday(
  userId: string,
  personName: string,
  birthDate: string,
  relation?: string,
  notes?: string
): Promise<string> {
  const supabase = getSupabase();
  const id = uuidv4();

  const { error } = await supabase.from("birthdays").insert({
    id,
    user_id: userId,
    person_name: personName,
    relation: relation ?? null,
    birth_date: birthDate,
    notes: notes ?? null,
    created_at: new Date().toISOString(),
  });

  if (error) throw new Error(`Failed to store birthday: ${error.message}`);
  return id;
}

/**
 * Get all birthdays occurring within the next N days.
 * Handles year wrap-around (e.g. Dec 30 → Jan 2).
 */
export async function getUpcomingBirthdays(
  userId: string,
  daysAhead = 7
): Promise<UpcomingBirthday[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("birthdays")
    .select("*")
    .eq("user_id", userId)
    .order("birth_date");

  if (error) throw new Error(`Failed to fetch birthdays: ${error.message}`);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcoming: UpcomingBirthday[] = [];

  for (const row of (data ?? []) as BirthdayRow[]) {
    const [, month, day] = row.birth_date.split("-").map(Number);

    // Build this year's occurrence
    const thisYear = new Date(today.getFullYear(), month - 1, day);
    // If already passed this year, use next year
    const nextOccurrence = thisYear < today
      ? new Date(today.getFullYear() + 1, month - 1, day)
      : thisYear;

    const diffMs = nextOccurrence.getTime() - today.getTime();
    const daysUntil = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (daysUntil <= daysAhead) {
      upcoming.push({ ...row, days_until: daysUntil });
    }
  }

  return upcoming.sort((a, b) => a.days_until - b.days_until);
}

/**
 * Delete a birthday record.
 */
export async function deleteBirthday(userId: string, id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("birthdays")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw new Error(`Failed to delete birthday: ${error.message}`);
}
