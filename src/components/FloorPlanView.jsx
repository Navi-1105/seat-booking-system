import { useMemo, useState } from 'react';

function toSeatId(seatNumber) {
  if (seatNumber <= 40) return `D${String(seatNumber).padStart(2, '0')}`;
  return `F${String(seatNumber - 40).padStart(2, '0')}`;
}

function getSeatType(seatNumber) {
  return seatNumber <= 40 ? 'designated' : 'floater';
}

function getSeatStatus({ seatNumber, bookingsForDate, releasesForDate, blockedForDate }) {
  const seatId = toSeatId(seatNumber);
  const type = getSeatType(seatNumber);
  const booking = bookingsForDate[seatId];
  const isReleased = releasesForDate.includes(seatId);
  const isBlocked = blockedForDate && type === 'floater' && !booking;

  if (booking) return { status: 'booked', seatId, type, booking };
  if (isReleased) return { status: 'released', seatId, type, booking: null };
  if (isBlocked) return { status: 'blocked', seatId, type, booking: null };
  if (type === 'floater') return { status: 'floater', seatId, type, booking: null };
  return { status: 'designated', seatId, type, booking: null };
}

export default function FloorPlanView({
  selectedDate,
  bookingsForDate,
  releasesForDate,
  blockedForDate,
  onRequestBooking,
  assignedSeatId,
  currentMemberName
}) {
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [actionState, setActionState] = useState({ kind: 'idle', message: '' });

  const rows = useMemo(
    () => [
      { label: 'Row 1', seats: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      { label: 'Row 2', seats: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20] },
      { label: 'Row 3', seats: [21, 22, 23, 24, 25, 26, 27, 28, 29, 30] },
      { label: 'Row 4', seats: [31, 32, 33, 34, 35, 36, 37, 38, 39, 40] },
      { label: 'Floater Row', seats: [41, 42, 43, 44, 45, 46, 47, 48, 49, 50] }
    ],
    []
  );

  const seatMetaByNumber = useMemo(() => {
    const map = {};
    for (let seatNumber = 1; seatNumber <= 50; seatNumber += 1) {
      map[seatNumber] = getSeatStatus({
        seatNumber,
        bookingsForDate,
        releasesForDate,
        blockedForDate
      });
    }
    return map;
  }, [bookingsForDate, releasesForDate, blockedForDate]);

  function openSeatModal(nextSelectedSeat) {
    setSelectedSeat(nextSelectedSeat);
    setActionState({ kind: 'idle', message: '' });
    setModalOpen(true);
  }

  function closeSeatModal() {
    setModalOpen(false);
    setActionState({ kind: 'idle', message: '' });
  }

  function handleSeatClick(seatNumber) {
    const meta = seatMetaByNumber[seatNumber];
    openSeatModal({ seatNumber, ...meta });
  }

  function getClassNameByStatus(status) {
    return `seat-chip seat-${status}`;
  }

  async function handleBookFromModal() {
    if (!selectedSeat) return;
    if (selectedSeat.status === 'booked') return;

    if (selectedSeat.status === 'blocked') {
      setActionState({ kind: 'error', message: 'This seat is blocked for this date.' });
      return;
    }

    setActionState({ kind: 'pending', message: 'Booking…' });
    try {
      const result = await onRequestBooking?.(selectedSeat);
      if (result?.ok === true) {
        setActionState({ kind: 'success', message: result.message || 'Booked.' });
        window.setTimeout(() => closeSeatModal(), 650);
        return;
      }
      setActionState({ kind: 'error', message: result?.message || 'Seat booking failed.' });
    } catch {
      setActionState({ kind: 'error', message: 'Seat booking failed due to a system error.' });
    }
  }

  const seatStatusLabel =
    selectedSeat?.status === 'floater'
      ? 'available (floater)'
      : selectedSeat?.status === 'designated'
        ? 'available (designated)'
        : selectedSeat?.status || '';

  const modalPrimaryActionVisible =
    selectedSeat && selectedSeat.status !== 'booked' && selectedSeat.status !== 'blocked';

  return (
    <section className="panel panel-wide floor-plan-card">
      <div className="floor-plan-head">
        <div className="floor-plan-title">
          <h2>Floor Plan — {selectedDate}</h2>
          <div className="floor-plan-sub">
            Booking as <strong>{currentMemberName || 'Member'}</strong>
            {assignedSeatId ? (
              <>
                {' '}
                • Assigned seat <strong>{assignedSeatId}</strong>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className="floor-legend">
        <span className="legend-item">
          <i className="legend-dot seat-designated" />
          Designated
        </span>
        <span className="legend-item">
          <i className="legend-dot seat-floater" />
          Floater (Available)
        </span>
        <span className="legend-item">
          <i className="legend-dot seat-booked" />
          Booked
        </span>
        <span className="legend-item">
          <i className="legend-dot seat-released" />
          Vacation Release
        </span>
        <span className="legend-item">
          <i className="legend-dot seat-blocked" />
          Blocked
        </span>
      </div>

      <div className="floor-rows">
        {rows.map((row) => (
          <div key={row.label} className="floor-row">
            <div className="row-label">{row.label}</div>
            <div className="row-seats">
              {row.seats.map((seatNumber) => {
                const seatMeta = seatMetaByNumber[seatNumber];
                const isAssigned = assignedSeatId && seatMeta.seatId === assignedSeatId;
                const bookedLabel = seatMeta.booking?.memberName
                  ? seatMeta.booking.memberName.split(' ').slice(0, 1).join(' ')
                  : '';

                return (
                  <button
                    key={seatNumber}
                    type="button"
                    className={`${getClassNameByStatus(seatMeta.status)} ${
                      selectedSeat?.seatNumber === seatNumber ? 'seat-selected' : ''
                    } ${isAssigned ? 'seat-assigned' : ''}`}
                    onClick={() => handleSeatClick(seatNumber)}
                    title={
                      seatMeta.status === 'booked'
                        ? `Seat ${seatNumber} (${seatMeta.seatId}) — ${seatMeta.booking.memberName}`
                        : `Seat ${seatNumber} (${seatMeta.seatId})`
                    }
                  >
                    <span className="seat-number">{seatNumber}</span>
                    {seatMeta.status === 'booked' ? <span className="seat-label">{bookedLabel}</span> : null}
                    {isAssigned ? <span className="seat-badge">Yours</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {modalOpen && selectedSeat ? (
        <div
          className="seat-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeSeatModal();
          }}
        >
          <div className="seat-modal" role="dialog" aria-modal="true" aria-label="Seat details">
            <div className="seat-modal-head">
              <div>
                <div className="seat-modal-title">
                  Seat {selectedSeat.seatNumber} <span className="seat-modal-sub">({selectedSeat.seatId})</span>
                </div>
                <div className="seat-modal-meta">
                  {selectedDate} • {selectedSeat.type === 'designated' ? 'Designated' : 'Floater'}
                </div>
              </div>
              <button type="button" className="btn" onClick={closeSeatModal}>
                Close
              </button>
            </div>

            <div className="seat-modal-body">
              <div className="seat-modal-status">
                <span className={`seat-modal-pill seat-pill-${selectedSeat.status}`}>{seatStatusLabel}</span>
                {assignedSeatId && selectedSeat.seatId === assignedSeatId ? (
                  <span className="seat-modal-pill seat-pill-you">Your seat</span>
                ) : null}
              </div>

              {selectedSeat.status === 'booked' ? (
                <div className="seat-modal-card">
                  <div className="seat-modal-row">
                    <strong>Member</strong>
                    <span>{selectedSeat.booking.memberName}</span>
                  </div>
                  <div className="seat-modal-row">
                    <strong>Booking type</strong>
                    <span>{selectedSeat.booking.type}</span>
                  </div>
                </div>
              ) : null}

              {selectedSeat.status === 'blocked' ? (
                <div className="seat-modal-card seat-modal-card-warn">
                  <strong>Blocked</strong>
                  <div className="seat-modal-help">
                    Non-designated booking is blocked for this date (post 3 PM next-working-day rule).
                  </div>
                </div>
              ) : null}

              {selectedSeat.status === 'released' ? (
                <div className="seat-modal-card">
                  <strong>Vacation released seat</strong>
                  <div className="seat-modal-help">
                    This designated seat is released and can be booked by non-designated members.
                  </div>
                </div>
              ) : null}

              {selectedSeat.status === 'designated' || selectedSeat.status === 'floater' ? (
                <div className="seat-modal-card">
                  <strong>Available</strong>
                  <div className="seat-modal-help">Tap “Book Seat” to confirm booking with current context.</div>
                </div>
              ) : null}

              {actionState.kind !== 'idle' ? (
                <div className={`seat-modal-toast seat-toast-${actionState.kind}`} role="status" aria-live="polite">
                  {actionState.message}
                </div>
              ) : null}
            </div>

            <div className="seat-modal-actions">
              {modalPrimaryActionVisible ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleBookFromModal}
                  disabled={actionState.kind === 'pending'}
                >
                  Book Seat
                </button>
              ) : (
                <button type="button" className="btn" onClick={closeSeatModal}>
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <style>{`
        .seat-selected {
          box-shadow: 0 0 0 2px #1f4a8b inset, 0 10px 20px rgba(31, 74, 139, 0.2);
        }

        .seat-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(9, 20, 16, 0.55);
          display: grid;
          place-items: center;
          padding: 18px;
          z-index: 50;
          backdrop-filter: blur(4px);
        }

        .seat-modal {
          width: min(520px, 100%);
          background: #ffffff;
          border-radius: 16px;
          border: 1px solid rgba(214, 226, 220, 0.9);
          box-shadow: 0 30px 70px rgba(16, 35, 26, 0.22);
          overflow: hidden;
        }

        .seat-modal-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 14px 14px 12px;
          background: linear-gradient(180deg, #ffffff, #f7fbf9);
          border-bottom: 1px solid rgba(214, 226, 220, 0.9);
        }

        .seat-modal-title {
          font-weight: 900;
          font-size: 1.02rem;
          color: #10231a;
        }

        .seat-modal-sub {
          font-weight: 800;
          color: rgba(16, 35, 26, 0.65);
        }

        .seat-modal-meta {
          margin-top: 4px;
          font-weight: 700;
          font-size: 0.86rem;
          color: rgba(16, 35, 26, 0.55);
        }

        .seat-modal-body {
          padding: 14px;
          display: grid;
          gap: 10px;
        }

        .seat-modal-status {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
        }

        .seat-modal-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 10px;
          border-radius: 999px;
          font-weight: 900;
          font-size: 0.74rem;
          text-transform: capitalize;
          border: 1px solid rgba(214, 226, 220, 0.9);
        }

        .seat-pill-booked { background: #f2eaff; color: #3a257a; }
        .seat-pill-released { background: #fff6cf; color: #6b5400; }
        .seat-pill-blocked { background: #ffe1e1; color: #7a1f1f; }
        .seat-pill-floater { background: #e8ffe8; color: #155c36; }
        .seat-pill-designated { background: #e9f3ff; color: #294878; }
        .seat-pill-you { background: rgba(16, 121, 93, 0.14); color: #0a5d48; border-color: rgba(16, 121, 93, 0.24); }

        .seat-modal-card {
          border: 1px solid rgba(214, 226, 220, 0.9);
          background: #ffffff;
          border-radius: 14px;
          padding: 12px;
          display: grid;
          gap: 8px;
        }

        .seat-modal-card-warn {
          background: #fff4ed;
          border-color: #ecc3af;
        }

        .seat-modal-row {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: center;
          color: #2d473d;
          font-weight: 700;
        }

        .seat-modal-row span {
          font-weight: 800;
          color: rgba(16, 35, 26, 0.7);
          text-align: right;
        }

        .seat-modal-help {
          color: rgba(16, 35, 26, 0.62);
          font-weight: 700;
          font-size: 0.9rem;
          line-height: 1.35;
        }

        .seat-modal-actions {
          padding: 12px 14px 14px;
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          border-top: 1px solid rgba(214, 226, 220, 0.9);
          background: #ffffff;
        }

        .seat-modal-toast {
          border-radius: 12px;
          padding: 10px 12px;
          font-weight: 900;
          font-size: 0.86rem;
          border: 1px solid;
        }

        .seat-toast-pending { background: #f2f6ff; border-color: #ccd6f7; color: #294878; }
        .seat-toast-success { background: #f0fff5; border-color: #b8e5ca; color: #155c36; }
        .seat-toast-error { background: #fff1f1; border-color: #f0b5b5; color: #8e2a2a; }
      `}</style>
    </section>
  );
}

