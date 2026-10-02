// Turns a doctor's weekly hours, breaks, buffers, leave, and existing bookings into bookable slots.
import { ACTIVE_APPOINTMENT, type Data } from '../shared/schemas';
import { addDays, addMinutes, istAt, istDate, istWeekday } from '../shared/time';
import { invalid } from './context';

type SlotQuery = { doctorId: string; typeId: string; from: string; days: number; excludeAppointmentId?: string; now?: Date };

export function computeSlots(data: Data, q: SlotQuery): string[] {
  const type = data.appointmentTypes.find(t => t.id === q.typeId && t.doctorId === q.doctorId);
  if (!type) return [];
  const now = (q.now ?? new Date()).getTime();
  const busy = data.appointments.filter(a => a.doctorId === q.doctorId && a.id !== q.excludeAppointmentId && (ACTIVE_APPOINTMENT as readonly string[]).includes(a.status));
  const slots: string[] = [];
  for (let i = 0; i < Math.min(q.days, 60); i++) {
    const date = addDays(q.from, i);
    if (data.leaves.some(l => l.doctorId === q.doctorId && l.startDate <= date && date <= l.endDate)) continue;
    for (const s of data.schedules.filter(s => s.doctorId === q.doctorId && s.weekday === istWeekday(date))) {
      const dayEnd = Date.parse(istAt(date, s.end));
      const breakStart = s.breakStart ? Date.parse(istAt(date, s.breakStart)) : undefined;
      const breakEnd = s.breakEnd ? Date.parse(istAt(date, s.breakEnd)) : undefined;
      const buffer = s.bufferMinutes * 60_000;
      let cursor = Date.parse(istAt(date, s.start));
      while (cursor + type.durationMinutes * 60_000 <= dayEnd) {
        const end = cursor + type.durationMinutes * 60_000;
        if (breakStart !== undefined && breakEnd !== undefined && cursor < breakEnd && end > breakStart) { cursor = breakEnd; continue; }
        const clash = busy.some(a => cursor < Date.parse(a.end) + buffer && Date.parse(a.start) < end + buffer);
        if (cursor > now && !clash) slots.push(new Date(cursor).toISOString());
        cursor = end + buffer;
      }
    }
  }
  return slots.sort();
}

export function nextAvailable(data: Data, doctorId: string, now = new Date()): string | undefined {
  const types = data.appointmentTypes.filter(t => t.doctorId === doctorId).sort((a, b) => a.durationMinutes - b.durationMinutes);
  return types.length ? computeSlots(data, { doctorId, typeId: types[0].id, from: istDate(now), days: 21, now })[0] : undefined;
}

/** Ensures a booking or reschedule lands on a free slot of a verified doctor; returns the computed end time. */
export function validateSlot(data: Data, doctorId: string, typeId: string, start: string, excludeAppointmentId?: string): { end: string; fee: number } {
  const doctor = data.doctors.find(d => d.id === doctorId);
  if (!doctor || doctor.verification !== 'verified') throw invalid('This doctor is not accepting bookings.', { doctorId: ['Choose a verified doctor.'] });
  const type = data.appointmentTypes.find(t => t.id === typeId && t.doctorId === doctorId);
  if (!type) throw invalid('Choose an appointment type offered by this doctor.', { typeId: ['Unknown appointment type.'] });
  const startIso = new Date(start).toISOString();
  const day = istDate(startIso);
  if (!computeSlots(data, { doctorId, typeId, from: day, days: 1, excludeAppointmentId }).includes(startIso)) {
    throw invalid('That time is no longer available. Choose another slot.', { start: ['Slot unavailable.'] });
  }
  return { end: addMinutes(startIso, type.durationMinutes), fee: type.fee };
}
