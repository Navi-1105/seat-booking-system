import { useEffect, useMemo, useRef, useState } from 'react';
import FloorPlanView from './components/FloorPlanView';

const TOTAL_SEATS = 50;
const DESIGNATED_SEATS = 40;
const FLOATER_SEATS = 10;
const DESIGNATED_PREFIX = 'D';
const FLOATER_PREFIX = 'F';
const STORAGE_KEY = 'seat-booking-state-v1'; // kept as offline fallback

const squads = Array.from({ length: 10 }, (_, i) => ({
  id: i + 1,
  name: `Squad ${i + 1}`,
  batch: i < 5 ? 1 : 2,
  members: Array.from({ length: 8 }, (_, m) => ({
    id: `S${i + 1}-M${m + 1}`,
    name: `S${i + 1} Member ${m + 1}`,
    squadId: i + 1,
    batch: i < 5 ? 1 : 2
  }))
}));

const defaultMember = squads[0].members[0];

function pad(value) {
  return String(value).padStart(2, '0');
}

function seatLabel(prefix, index) {
  return `${prefix}${pad(index)}`;
}

function toDateKey(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  return `${year}-${month}-${day}`;
}

function fromDateKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function startOfWeekMonday(date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function isWorkingDay(date, holidaysSet) {
  return !isWeekend(date) && !holidaysSet.has(toDateKey(date));
}

function formatHumanDate(date) {
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function getCycleWeek(date) {
  const anchorMonday = new Date('2026-01-05T00:00:00');
  const currentMonday = startOfWeekMonday(date);
  const diff = Math.floor((currentMonday - anchorMonday) / (1000 * 60 * 60 * 24 * 7));
  const normalized = ((diff % 2) + 2) % 2;
  return normalized === 0 ? 1 : 2;
}

function isDesignatedDay(batch, date) {
  const week = getCycleWeek(date);
  const day = date.getDay();

  if (week === 1) {
    if (batch === 1) return day >= 1 && day <= 3;
    return day === 4 || day === 5;
  }

  if (batch === 1) return day === 4 || day === 5;
  return day >= 1 && day <= 3;
}

function getSquadByMember(memberId) {
  return squads.find((s) => s.members.some((m) => m.id === memberId)) || squads[0];
}

function getMemberById(memberId) {
  for (const squad of squads) {
    const member = squad.members.find((m) => m.id === memberId);
    if (member) return member;
  }
  return defaultMember;
}

function getNextWorkingDay(baseDate, holidaysSet) {
  let probe = addDays(baseDate, 1);
  while (!isWorkingDay(probe, holidaysSet)) {
    probe = addDays(probe, 1);
  }
  return probe;
}

function getInitialState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

async function apiGetState() {
  const res = await fetch('/api/state');
  if (!res.ok) throw new Error('Failed to load state');
  return res.json();
}

async function apiPutState(payload) {
  const res = await fetch('/api/state', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('Failed to save state');
  return res.json();
}

function getDesignatedSeatForMember(member) {
  const relativeSquadIndex = member.batch === 1 ? member.squadId - 1 : member.squadId - 6;
  const seatNo = relativeSquadIndex * 8 + Number(member.id.split('M')[1]);
  return seatLabel(DESIGNATED_PREFIX, seatNo);
}

function App() {
  const persisted = getInitialState();
  const [selectedWeekStart, setSelectedWeekStart] = useState(startOfWeekMonday(new Date()));
  const [employeeType, setEmployeeType] = useState('designated');
  const [selectedSquadId, setSelectedSquadId] = useState(1);
  const [selectedMemberId, setSelectedMemberId] = useState(defaultMember.id);
  const [selectedDate, setSelectedDate] = useState(toDateKey(new Date()));
  const [holidays, setHolidays] = useState(persisted?.holidays || []);
  const [bookings, setBookings] = useState(persisted?.bookings || {});
  const [releases, setReleases] = useState(persisted?.releases || {});
  const [blockedNextDay, setBlockedNextDay] = useState(persisted?.blockedNextDay || {});
  const [message, setMessage] = useState('');
  const [selectedCalendarDateKey, setSelectedCalendarDateKey] = useState(null);
  const messageTimerRef = useRef(null);
  const saveTimerRef = useRef(null);
  const hasLoadedFromApiRef = useRef(false);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        holidays,
        bookings,
        releases,
        blockedNextDay
      })
    );
  }, [holidays, bookings, releases, blockedNextDay]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const remote = await apiGetState();
        if (cancelled) return;
        if (remote && typeof remote === 'object') {
          setHolidays(Array.isArray(remote.holidays) ? remote.holidays : []);
          setBookings(remote.bookings && typeof remote.bookings === 'object' ? remote.bookings : {});
          setReleases(remote.releases && typeof remote.releases === 'object' ? remote.releases : {});
          setBlockedNextDay(
            remote.blockedNextDay && typeof remote.blockedNextDay === 'object' ? remote.blockedNextDay : {}
          );
          hasLoadedFromApiRef.current = true;
          setInfo('Loaded state from MongoDB.');
        }
      } catch {
        hasLoadedFromApiRef.current = true;
        setInfo('Backend not reachable. Using local data (offline mode).');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hasLoadedFromApiRef.current) return;
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      apiPutState({ holidays, bookings, releases, blockedNextDay }).catch(() => {
        // Keep working offline if backend is down
      });
    }, 350);
  }, [holidays, bookings, releases, blockedNextDay]);

  useEffect(() => {
    const squad = squads.find((s) => s.id === Number(selectedSquadId)) || squads[0];
    if (!squad.members.some((m) => m.id === selectedMemberId)) {
      setSelectedMemberId(squad.members[0].id);
    }
  }, [selectedSquadId, selectedMemberId]);

  const holidaySet = useMemo(() => new Set(holidays), [holidays]);

  const selectedSquad = useMemo(
    () => squads.find((s) => s.id === Number(selectedSquadId)) || squads[0],
    [selectedSquadId]
  );

  const memberOptions = selectedSquad.members;

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(selectedWeekStart, i));
  }, [selectedWeekStart]);
  const todayDateKey = toDateKey(new Date());

  const today = new Date();

  function readDayBooking(dateKey) {
    return bookings[dateKey] || {};
  }

  function writeDayBooking(dateKey, next) {
    setBookings((prev) => ({ ...prev, [dateKey]: next }));
  }

  function setInfo(nextMessage) {
    setMessage(nextMessage);
    window.clearTimeout(messageTimerRef.current);
    messageTimerRef.current = window.setTimeout(() => setMessage(''), 3500);
  }

  function isBlockedForDate(dateKey) {
    return blockedNextDay[dateKey] === true;
  }

  function canBook(dateObj, type, member) {
    const dateKey = toDateKey(dateObj);

    if (!isWorkingDay(dateObj, holidaySet)) {
      return { ok: false, reason: 'Booking not allowed on holiday/weekend.' };
    }

    if (isBlockedForDate(dateKey) && type === 'non_designated') {
      return { ok: false, reason: 'Non-designated booking blocked for this day after 3 PM rule.' };
    }

    if (type === 'designated') {
      const squad = getSquadByMember(member.id);
      if (!isDesignatedDay(squad.batch, dateObj)) {
        return { ok: false, reason: 'This member is non-designated on the selected day.' };
      }
    }

    return { ok: true };
  }

  function bookSeat() {
    const dateObj = fromDateKey(selectedDate);
    const member = getMemberById(selectedMemberId);
    const dateKey = toDateKey(dateObj);

    const eligibility = canBook(dateObj, employeeType, member);
    if (!eligibility.ok) {
      setInfo(eligibility.reason);
      return;
    }

    const dayBooking = { ...readDayBooking(dateKey) };

    for (const seat of Object.keys(dayBooking)) {
      if (dayBooking[seat]?.memberId === member.id) {
        setInfo(`Already booked: ${seat}`);
        return;
      }
    }

    if (employeeType === 'designated') {
      const seat = getDesignatedSeatForMember(member);
      if (dayBooking[seat]) {
        setInfo(`Seat ${seat} is already occupied.`);
        return;
      }
      dayBooking[seat] = {
        seat,
        memberId: member.id,
        memberName: member.name,
        type: 'designated'
      };
      writeDayBooking(dateKey, dayBooking);
      setInfo(`Booked ${seat} for ${member.name}.`);
      return;
    }

    const floaterSeats = Array.from({ length: FLOATER_SEATS }, (_, i) => seatLabel(FLOATER_PREFIX, i + 1));
    const freeFloater = floaterSeats.find((seat) => !dayBooking[seat]);

    if (freeFloater) {
      dayBooking[freeFloater] = {
        seat: freeFloater,
        memberId: member.id,
        memberName: member.name,
        type: 'non_designated'
      };
      writeDayBooking(dateKey, dayBooking);
      setInfo(`Booked floater ${freeFloater} for ${member.name}.`);
      return;
    }

    const releasable = releases[dateKey] || [];
    const freeReleased = releasable.find((seat) => !dayBooking[seat]);

    if (freeReleased) {
      dayBooking[freeReleased] = {
        seat: freeReleased,
        memberId: member.id,
        memberName: member.name,
        type: 'non_designated_release'
      };
      writeDayBooking(dateKey, dayBooking);
      setInfo(`Booked released seat ${freeReleased} for ${member.name}.`);
      return;
    }

    setInfo('No floater or released seats available.');
  }

  function bookSpecificSeatById(seatId) {
    const dateObj = fromDateKey(selectedDate);
    const member = getMemberById(selectedMemberId);
    const dateKey = toDateKey(dateObj);

    const eligibility = canBook(dateObj, employeeType, member);
    if (!eligibility.ok) {
      const messageText = eligibility.reason;
      setInfo(messageText);
      return { ok: false, message: messageText };
    }

    const dayBooking = { ...readDayBooking(dateKey) };

    for (const seat of Object.keys(dayBooking)) {
      if (dayBooking[seat]?.memberId === member.id) {
        const messageText = `Already booked: ${seat}`;
        setInfo(messageText);
        return { ok: false, message: messageText };
      }
    }

    if (dayBooking[seatId]) {
      const messageText = `Seat ${seatId} is already occupied.`;
      setInfo(messageText);
      return { ok: false, message: messageText };
    }

    const isDesignatedSeat = seatId.startsWith(DESIGNATED_PREFIX);
    const isFloaterSeat = seatId.startsWith(FLOATER_PREFIX);
    const releasedForDay = releases[dateKey] || [];
    const isReleasedSeat = releasedForDay.includes(seatId);

    if (isFloaterSeat) {
      if (employeeType !== 'non_designated') {
        const messageText = 'Only non-designated members can book floater seats.';
        setInfo(messageText);
        return { ok: false, message: messageText };
      }

      if (isBlockedForDate(dateKey)) {
        const messageText = 'Non-designated booking blocked for this day after 3 PM rule.';
        setInfo(messageText);
        return { ok: false, message: messageText };
      }

      dayBooking[seatId] = {
        seat: seatId,
        memberId: member.id,
        memberName: member.name,
        type: 'non_designated'
      };
      writeDayBooking(dateKey, dayBooking);
      const messageText = `Booked floater ${seatId} for ${member.name}.`;
      setInfo(messageText);
      return { ok: true, message: messageText };
    }

    if (isDesignatedSeat) {
      if (isReleasedSeat) {
        if (employeeType !== 'non_designated') {
          const messageText = 'Released designated seats are reserved for non-designated booking.';
          setInfo(messageText);
          return { ok: false, message: messageText };
        }

        dayBooking[seatId] = {
          seat: seatId,
          memberId: member.id,
          memberName: member.name,
          type: 'non_designated_release'
        };
        writeDayBooking(dateKey, dayBooking);
        const messageText = `Booked released seat ${seatId} for ${member.name}.`;
        setInfo(messageText);
        return { ok: true, message: messageText };
      }

      if (employeeType !== 'designated') {
        const messageText = 'Only designated members can book designated seats (unless released).';
        setInfo(messageText);
        return { ok: false, message: messageText };
      }

      const designatedSeat = getDesignatedSeatForMember(member);
      if (seatId !== designatedSeat) {
        const messageText = `You can only book your assigned seat (${designatedSeat}).`;
        setInfo(messageText);
        return { ok: false, message: messageText };
      }

      dayBooking[seatId] = {
        seat: seatId,
        memberId: member.id,
        memberName: member.name,
        type: 'designated'
      };
      writeDayBooking(dateKey, dayBooking);
      const messageText = `Booked ${seatId} for ${member.name}.`;
      setInfo(messageText);
      return { ok: true, message: messageText };
    }

    const messageText = 'Unknown seat type.';
    setInfo(messageText);
    return { ok: false, message: messageText };
  }

  function releaseSeatForVacation() {
    const member = getMemberById(selectedMemberId);
    const dateObj = fromDateKey(selectedDate);
    const dateKey = toDateKey(dateObj);

    if (!isWorkingDay(dateObj, holidaySet)) {
      setInfo('Cannot release on holiday/weekend.');
      return;
    }

    const squad = getSquadByMember(member.id);
    if (!isDesignatedDay(squad.batch, dateObj)) {
      setInfo('Release is only for designated days.');
      return;
    }

    const seat = getDesignatedSeatForMember(member);

    setReleases((prev) => ({
      ...prev,
      [dateKey]: Array.from(new Set([...(prev[dateKey] || []), seat]))
    }));

    setBookings((prev) => {
      const dayBooking = { ...(prev[dateKey] || {}) };
      if (dayBooking[seat]?.memberId === member.id) {
        delete dayBooking[seat];
      }
      return { ...prev, [dateKey]: dayBooking };
    });

    setInfo(`${seat} released for non-designated booking.`);
  }

  function runThreePmBlock() {
    const now = new Date();
    const hour = now.getHours();

    if (hour < 15) {
      setInfo('3 PM rule can be run only after 3:00 PM local time.');
      return;
    }

    const target = getNextWorkingDay(now, holidaySet);
    const targetKey = toDateKey(target);

    setBlockedNextDay((prev) => ({ ...prev, [targetKey]: true }));
    setInfo(`Next working day (${targetKey}) blocked for non-designated booking.`);
  }

  function weekAllocationForDate(dateObj) {
    const dateKey = toDateKey(dateObj);
    const dayBooking = readDayBooking(dateKey);
    const designatedBooked = Object.values(dayBooking).filter((b) => b.type === 'designated').length;
    const nonDesignatedBooked = Object.values(dayBooking).filter((b) => b.type !== 'designated').length;

    const activeSquads = squads
      .filter((s) => isDesignatedDay(s.batch, dateObj))
      .map((s) => s.name)
      .join(', ');

    const releasesForDay = releases[dateKey] || [];

    return {
      dateKey,
      designatedBooked,
      nonDesignatedBooked,
      designatedCapacity: DESIGNATED_SEATS,
      floaterCapacity: FLOATER_SEATS,
      releasesCount: releasesForDay.length,
      blocked: blockedNextDay[dateKey] === true,
      isHoliday: !isWorkingDay(dateObj, holidaySet),
      activeSquads
    };
  }

  function changeWeek(offset) {
    setSelectedWeekStart((prev) => addDays(prev, offset * 7));
  }

  function setCurrentWeek() {
    setSelectedWeekStart(startOfWeekMonday(new Date()));
  }

  function handleFloorPlanBookingRequest(seat) {
    if (!seat?.seatId) return { ok: false, message: 'Invalid seat.' };
    return bookSpecificSeatById(seat.seatId);
  }

  const selectedCalendarDetails = selectedCalendarDateKey
    ? weekAllocationForDate(fromDateKey(selectedCalendarDateKey))
    : null;

  return (
    <div className="page">
      <div className="bg-shape shape-a" />
      <div className="bg-shape shape-b" />

      <header className="hero">
        <div>
          <p className="eyebrow">Org Space Engine</p>
          <h1>Seat Booking System</h1>
        </div>

        <div className="kpi-grid">
          <div className="kpi-card">
            <span>Total Seats</span>
            <strong>{TOTAL_SEATS}</strong>
          </div>
          <div className="kpi-card">
            <span>Designated</span>
            <strong>{DESIGNATED_SEATS}</strong>
          </div>
          <div className="kpi-card">
            <span>Floater</span>
            <strong>{FLOATER_SEATS}</strong>
          </div>
          <div className="kpi-card">
            <span>Squads</span>
            <strong>10 x 8</strong>
          </div>
        </div>
      </header>

      <main className="grid">
        <section className="panel booking-context">
          <h2>Booking Context</h2>
          <p className="seat-hint">Select member context below, then book directly from the seating plan.</p>

          <div className="fields">
            <label>
              Employee Type
              <select value={employeeType} onChange={(e) => setEmployeeType(e.target.value)}>
                <option value="designated">Designated (Squad Member)</option>
                <option value="non_designated">Non-Designated</option>
              </select>
            </label>

            <label>
              Squad
              <select
                value={selectedSquadId}
                onChange={(e) => {
                  const squadId = Number(e.target.value);
                  setSelectedSquadId(squadId);
                  const firstMember = squads.find((s) => s.id === squadId)?.members[0]?.id;
                  if (firstMember) setSelectedMemberId(firstMember);
                }}
              >
                {squads.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} (Batch {s.batch})
                  </option>
                ))}
              </select>
            </label>

            <label>
              Member
              <select value={selectedMemberId} onChange={(e) => setSelectedMemberId(e.target.value)}>
                {memberOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Date
              <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
            </label>
          </div>

          <div className="action-row">
            <button className="btn" onClick={releaseSeatForVacation}>
              Release for Vacation
            </button>
            <button className="btn btn-warning" onClick={runThreePmBlock}>
              Run 3 PM Next-Day Block
            </button>
          </div>

          <p className="message">{message || 'Ready'}</p>
        </section>

        <section className="panel">
          <h2>Holiday List</h2>
          <p className="seat-hint">
            Source: Static mode - no external holiday API
          </p>
          {holidays.length === 0 ? (
            <p className="seat-hint">No holidays configured.</p>
          ) : (
            <ul className="rules">
              {holidays.map((holiday) => (
                <li key={`list-${holiday}`}>{holiday}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel panel-wide">
          <div className="week-head">
            <h2>Week-wise Allocation View</h2>
            <div className="week-nav">
              <button className="btn" onClick={() => changeWeek(-1)}>
                Previous
              </button>
              <button className="btn" onClick={setCurrentWeek}>
                Current
              </button>
              <button className="btn" onClick={() => changeWeek(1)}>
                Next
              </button>
            </div>
          </div>

          <p className="week-label">
            Week starts {formatHumanDate(selectedWeekStart)} (Cycle Week {getCycleWeek(selectedWeekStart)})
          </p>

          <div className="calendar-head">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => (
              <div key={label} className="calendar-head-cell">
                {label}
              </div>
            ))}
          </div>

          <div className="calendar-grid">
            {weekDays.map((day) => {
              const data = weekAllocationForDate(day);
              const isToday = data.dateKey === todayDateKey;
              const isWeekendDay = day.getDay() === 0 || day.getDay() === 6;
              const seatCount = data.designatedBooked + data.nonDesignatedBooked;
              const statusLabel = data.isHoliday
                ? 'Holiday/Weekend'
                : data.blocked
                  ? 'Blocked'
                  : seatCount === 0
                    ? 'Open'
                    : 'Active';
              const statusClass = data.isHoliday
                ? 'status-holiday'
                : data.blocked
                  ? 'status-blocked'
                  : seatCount === 0
                    ? 'status-open'
                    : 'status-active';

              return (
                <button
                  key={data.dateKey}
                  type="button"
                  className={`calendar-cell ${data.isHoliday ? 'holiday' : ''} ${isToday ? 'today' : ''}`}
                  onClick={() => !isWeekendDay && setSelectedCalendarDateKey(data.dateKey)}
                  disabled={isWeekendDay}
                >
                  <div className="calendar-date-row">
                    <span className="calendar-date">{day.getDate()}</span>
                    <span className={`calendar-dot ${statusClass}`} />
                  </div>
                  <div className="calendar-meta">{formatHumanDate(day)}</div>
                  <div className="calendar-meta">
                    Seats: <strong>{seatCount}</strong>
                  </div>
                  <div className={`calendar-status ${statusClass}`}>{statusLabel}</div>
                </button>
              );
            })}
          </div>

          {selectedCalendarDetails ? (
            <aside className="detail-panel">
              <div className="detail-head">
                <h3>Date Details</h3>
                <button type="button" className="btn" onClick={() => setSelectedCalendarDateKey(null)}>
                  Close
                </button>
              </div>
              <div className="detail-grid">
                <p>
                  <strong>Date:</strong> {selectedCalendarDetails.dateKey}
                </p>
                <p>
                  <strong>Designated seats:</strong> {selectedCalendarDetails.designatedBooked} /{' '}
                  {selectedCalendarDetails.designatedCapacity}
                </p>
                <p>
                  <strong>Non-designated seats:</strong> {selectedCalendarDetails.nonDesignatedBooked} /{' '}
                  {selectedCalendarDetails.floaterCapacity}
                </p>
                <p>
                  <strong>Released seats:</strong> {selectedCalendarDetails.releasesCount}
                </p>
                <p>
                  <strong>Next-day block status:</strong> {selectedCalendarDetails.blocked ? 'Blocked' : 'Open'}
                </p>
                <p>
                  <strong>Active squads:</strong>{' '}
                  {selectedCalendarDetails.isHoliday ? 'Holiday/Weekend' : selectedCalendarDetails.activeSquads}
                </p>
              </div>
            </aside>
          ) : null}
        </section>

        <FloorPlanView
          selectedDate={selectedDate}
          bookingsForDate={readDayBooking(selectedDate)}
          releasesForDate={releases[selectedDate] || []}
          blockedForDate={isBlockedForDate(selectedDate)}
          onRequestBooking={handleFloorPlanBookingRequest}
          assignedSeatId={employeeType === 'designated' ? getDesignatedSeatForMember(getMemberById(selectedMemberId)) : null}
          currentMemberName={getMemberById(selectedMemberId).name}
        />
      </main>
    </div>
  );
}

export default App;
